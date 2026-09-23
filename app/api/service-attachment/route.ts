// 서비스 레포트 첨부파일 — 업로드(POST) · 삭제(DELETE) · 열기(GET 서명 URL).
//
// 왜 라우트인가 —
//   · service_attachments 에는 읽기 정책만 있다. 쓰기는 service role 로만 이뤄져야 한다.
//   · 파일명을 서버가 정한다(클라이언트가 보낸 이름은 표시용으로만 쓴다 — 경로 조작·덮어쓰기 방지).
//   · 버킷이 비공개라 열람도 서명 URL 이 필요하고, 그 발급 전에 권한을 다시 본다.
//     (리드 명함 /api/lead-card, 장비 사진 /api/device-image 와 같은 방식이다.)
//
// 접근 권한은 고객사 열람 권한(canViewCustomers)을 기준으로 한다 — 고객 현장 자료다.
// 개별 삭제만 올린 사람 본인 또는 superadmin 으로 좁힌다(남이 올린 자료를 함부로 지우지 못하게).
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { canViewMenu, isSuperAdmin } from '@/lib/permissions'
import { withTeamPerm } from '@/lib/teamPermsServer'
import { parseDataUrlImage } from '@/lib/imageUpload'

const BUCKET = 'service-attachments'
/** 서비스 기록 1건당 첨부 상한. 화면도 같은 값으로 추가 버튼을 잠근다. */
const MAX_PER_SERVICE = 10
/** 파일 하나의 상한(디코딩 후). 패킹리스트·서비스 레포트와 같은 20MB. */
const MAX_BYTES = 20 * 1024 * 1024
/** 서명 URL 만료 — 코드베이스의 다른 서명 URL 과 같은 1시간. */
const SIGNED_URL_TTL = 60 * 60
/** 표시용 파일명 상한. 넘치면 잘라 저장한다. */
const NAME_MAX = 200

const ATTACHMENT_COLUMNS =
  'attachment_id, service_id, file_path, file_name, content_type, byte_size, sort_order, uploaded_by, created_at, engineers(name, position)'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

type Caller = { engineer_id: number; permission_level: string | null; teams: string | null }

/** 로그인 + 고객사 열람 권한. 통과하면 caller 를 돌려준다. */
async function authorize(): Promise<{ error: NextResponse; caller: null } | { error: null; caller: Caller }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return { error: bad('Unauthorized', 401), caller: null }

  const { data: row, error } = await supabase
    .from('engineers')
    .select('engineer_id, permission_level, teams')
    .eq('email', user.email)
    .single()
  if (error) console.error('[service-attachment] caller lookup failed', { email: user.email, error })
  const caller = await withTeamPerm((row ?? null) as Caller | null)
  if (!caller || !canViewMenu(caller, 'customers')) return { error: bad('Forbidden', 403), caller: null }
  return { error: null, caller }
}

// ── 파일 검증 ───────────────────────────────────────────────────────
// 패킹리스트와 같은 화이트리스트(pdf·엑셀·워드·이미지)다. 다만 그쪽은 브라우저에서 MIME 만 보므로,
// 여기서는 앞머리 바이트로 실제 형식까지 확인한다. 이미지는 lib/imageUpload.ts 의 검사를 그대로 쓰고,
// 문서(pdf·office)는 그 모듈이 이미지 전용이라 아래에서 같은 방식으로 본다.
type Parsed = { bytes: Buffer; ext: string; contentType: string }

function isZip(b: Buffer): boolean {
  return b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07)
}
function isOle2(b: Buffer): boolean {
  return b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
}

const DOC_TYPES: Record<string, { ext: string; sniff: (b: Buffer) => boolean }> = {
  'application/pdf': { ext: 'pdf', sniff: b => b.subarray(0, 4).toString('latin1') === '%PDF' },
  // xlsx·docx 는 zip 컨테이너다(PK..). 안쪽까지 열어 보지는 않는다.
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { ext: 'xlsx', sniff: isZip },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: 'docx', sniff: isZip },
  // 옛 xls·doc 은 OLE2 복합문서다.
  'application/vnd.ms-excel': { ext: 'xls', sniff: isOle2 },
  'application/msword': { ext: 'doc', sniff: isOle2 },
}

/** data URL 하나를 검증해 바이트·확장자·형식을 돌려준다. 막히면 { error }. */
function parseAttachment(raw: unknown): { error: string } | { value: Parsed } {
  if (typeof raw !== 'string' || !raw.startsWith('data:')) return { error: '첨부파일을 읽을 수 없습니다.' }
  const semi = raw.indexOf(';')
  const mime = semi > 5 ? raw.slice(5, semi).trim() : ''

  if (mime.startsWith('image/')) {
    // 이미지는 기존 검사(매직바이트 + 크기 + 선언 MIME 일치)를 그대로 쓴다.
    const r = parseDataUrlImage(raw, MAX_BYTES, '첨부파일')
    if (!r.ok) return { error: r.error }
    if (!r.image) return { error: '첨부파일을 읽을 수 없습니다.' }
    return { value: { bytes: r.image.bytes, ext: r.image.ext, contentType: r.image.contentType } }
  }

  const doc = DOC_TYPES[mime]
  if (!doc) return { error: 'PDF, 엑셀, 워드, 이미지 파일만 올릴 수 있습니다.' }

  const m = /^data:[^;]+;base64,([A-Za-z0-9+/=]+)$/.exec(raw)
  if (!m) return { error: '첨부파일을 읽을 수 없습니다.' }
  let bytes: Buffer
  try { bytes = Buffer.from(m[1], 'base64') } catch { return { error: '첨부파일을 읽을 수 없습니다.' } }
  if (bytes.length === 0) return { error: '첨부파일을 읽을 수 없습니다.' }
  if (bytes.length > MAX_BYTES) return { error: `첨부파일은 ${MAX_BYTES / (1024 * 1024)}MB 를 넘을 수 없습니다.` }
  if (!doc.sniff(bytes)) return { error: '파일 형식이 확장자와 다릅니다.' }
  return { value: { bytes, ext: doc.ext, contentType: mime } }
}

/** 스토리지 파일 삭제. 실패해도 DB 행은 지운다 — 가리키는 행이 없는 파일보다 낫다(로그로 남긴다). */
async function removeFiles(paths: string[]): Promise<void> {
  const { error } = await supabaseAdmin.storage.from(BUCKET).remove(paths)
  if (error) console.error('[service-attachment] 파일 삭제 실패 — 고아 파일이 남는다', { paths, error })
}

// ── POST: 업로드 (여러 개) ──────────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await authorize()
  if (auth.error) return auth.error
  const caller = auth.caller

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const serviceId = Number(body.serviceId)
  if (!Number.isInteger(serviceId) || serviceId <= 0) return bad('서비스 기록을 지정해주세요.')

  const list = Array.isArray(body.files) ? body.files : []
  if (list.length === 0) return bad('올릴 파일이 없습니다.')

  const { data: service, error: svcErr } = await supabaseAdmin
    .from('service_history').select('service_id').eq('service_id', serviceId).maybeSingle()
  if (svcErr) {
    console.error('[service-attachment] service lookup failed', { serviceId, error: svcErr })
    return bad('서비스 기록을 확인하지 못했습니다.', 500)
  }
  if (!service) return bad('서비스 기록을 찾을 수 없습니다.', 404)

  const { count, error: cntErr } = await supabaseAdmin
    .from('service_attachments')
    .select('attachment_id', { count: 'exact', head: true })
    .eq('service_id', serviceId)
  if (cntErr) {
    console.error('[service-attachment] count failed', { serviceId, error: cntErr })
    return bad('첨부 개수를 확인하지 못했습니다.', 500)
  }
  const already = count ?? 0
  if (already + list.length > MAX_PER_SERVICE) {
    return bad(`첨부파일은 ${MAX_PER_SERVICE}개까지 올릴 수 있습니다 (현재 ${already}개).`)
  }

  // 먼저 전부 검증한다 — 반쯤 올리고 막히는 것보다 시작 전에 막는 편이 낫다.
  const stamp = Date.now()
  const prepared: { path: string; parsed: Parsed; name: string }[] = []
  for (let i = 0; i < list.length; i++) {
    const item = list[i] as { name?: unknown; dataUrl?: unknown }
    const parsed = parseAttachment(item?.dataUrl)
    if ('error' in parsed) return bad(parsed.error)
    const rawName = typeof item?.name === 'string' ? item.name.trim() : ''
    prepared.push({
      path: `svc-${serviceId}-${stamp}-${i}.${parsed.value.ext}`,
      parsed: parsed.value,
      name: (rawName || `첨부-${i + 1}.${parsed.value.ext}`).slice(0, NAME_MAX),
    })
  }

  const uploaded: string[] = []
  for (const p of prepared) {
    const { error } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(p.path, p.parsed.bytes, { contentType: p.parsed.contentType, upsert: false })
    if (error) {
      console.error('[service-attachment] 업로드 실패', { serviceId, path: p.path, error })
      if (uploaded.length > 0) await removeFiles(uploaded)
      return bad('첨부파일을 저장하지 못했습니다.', 500)
    }
    uploaded.push(p.path)
  }

  // uploaded_by 는 호출자로 강제한다(본문 값을 쓰지 않는다).
  const { data: rows, error: insErr } = await supabaseAdmin
    .from('service_attachments')
    .insert(prepared.map((p, i) => ({
      service_id: serviceId,
      file_path: p.path,
      file_name: p.name,
      content_type: p.parsed.contentType,
      byte_size: p.parsed.bytes.length,
      sort_order: already + i,
      uploaded_by: caller.engineer_id,
    })))
    .select(ATTACHMENT_COLUMNS)
  if (insErr || !rows) {
    // 파일은 올라갔는데 행이 없으면 아무도 찾을 수 없는 파일이 된다 — 올린 것을 지운다.
    console.error('[service-attachment] insert 실패, 올린 파일을 지운다', { serviceId, error: insErr })
    await removeFiles(uploaded)
    return bad('첨부파일 정보를 저장하지 못했습니다.', 500)
  }

  console.log('[service-attachment] 업로드', { serviceId, count: rows.length, by: caller.engineer_id })
  return NextResponse.json({ success: true, attachments: rows })
}

// ── DELETE: 첨부 1건 또는 서비스 기록의 전부 ────────────────────────
// attachmentId — 올린 사람 본인 또는 superadmin.
// serviceId    — 서비스 기록·고객사를 지울 때 파일까지 정리하는 용도다. 기록을 지울 수 있는 사람
//                (고객사 권한자)이면 통과시킨다. 행은 CASCADE 로 지워지지만 파일은 남기 때문이다.
export async function DELETE(req: NextRequest) {
  const auth = await authorize()
  if (auth.error) return auth.error
  const caller = auth.caller

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const attachmentId = Number(body.attachmentId)
  const serviceId = Number(body.serviceId)

  if (Number.isInteger(attachmentId) && attachmentId > 0) {
    const { data: row, error } = await supabaseAdmin
      .from('service_attachments')
      .select('attachment_id, file_path, uploaded_by')
      .eq('attachment_id', attachmentId)
      .maybeSingle()
    if (error) {
      console.error('[service-attachment] lookup failed', { attachmentId, error })
      return bad('첨부파일을 확인하지 못했습니다.', 500)
    }
    if (!row) return bad('첨부파일을 찾을 수 없습니다.', 404)
    const att = row as { file_path: string; uploaded_by: number | null }
    if (att.uploaded_by !== caller.engineer_id && !isSuperAdmin(caller)) {
      return bad('올린 사람만 지울 수 있습니다.', 403)
    }
    await removeFiles([att.file_path])
    const { error: delErr } = await supabaseAdmin
      .from('service_attachments').delete().eq('attachment_id', attachmentId)
    if (delErr) {
      console.error('[service-attachment] row delete failed', { attachmentId, error: delErr })
      return bad('첨부파일을 지우지 못했습니다.', 500)
    }
    return NextResponse.json({ success: true, removed: 1 })
  }

  if (Number.isInteger(serviceId) && serviceId > 0) {
    const { data: rows, error } = await supabaseAdmin
      .from('service_attachments').select('attachment_id, file_path').eq('service_id', serviceId)
    if (error) {
      console.error('[service-attachment] list failed', { serviceId, error })
      return bad('첨부파일을 확인하지 못했습니다.', 500)
    }
    const list = (rows ?? []) as { file_path: string }[]
    if (list.length === 0) return NextResponse.json({ success: true, removed: 0 })
    await removeFiles(list.map(r => r.file_path))
    const { error: delErr } = await supabaseAdmin
      .from('service_attachments').delete().eq('service_id', serviceId)
    if (delErr) {
      console.error('[service-attachment] rows delete failed', { serviceId, error: delErr })
      return bad('첨부파일을 지우지 못했습니다.', 500)
    }
    console.log('[service-attachment] 서비스 기록 첨부 정리', { serviceId, removed: list.length })
    return NextResponse.json({ success: true, removed: list.length })
  }

  return bad('지울 대상을 지정해주세요.')
}

// ── GET: 서명 URL ───────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await authorize()
  if (auth.error) return auth.error

  const attachmentId = Number(req.nextUrl.searchParams.get('attachmentId'))
  if (!Number.isInteger(attachmentId) || attachmentId <= 0) return bad('첨부파일을 지정해주세요.')

  const { data: row, error } = await supabaseAdmin
    .from('service_attachments').select('file_path, file_name').eq('attachment_id', attachmentId).maybeSingle()
  if (error) {
    console.error('[service-attachment] lookup failed', { attachmentId, error })
    return bad('첨부파일을 확인하지 못했습니다.', 500)
  }
  if (!row) return bad('첨부파일을 찾을 수 없습니다.', 404)
  const att = row as { file_path: string; file_name: string }

  const { data, error: signErr } = await supabaseAdmin.storage
    .from(BUCKET).createSignedUrl(att.file_path, SIGNED_URL_TTL)
  if (signErr || !data?.signedUrl) {
    console.error('[service-attachment] signed url 발급 실패', { attachmentId, error: signErr })
    return bad('첨부파일을 열 수 없습니다.', 500)
  }
  return NextResponse.json({ signedUrl: data.signedUrl, fileName: att.file_name })
}
