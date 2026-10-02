// 의뢰서 내용 기록 첨부파일 — 업로드(POST) · 삭제(DELETE) · 열기(GET 서명 URL).
//
// app/api/service-attachment/route.ts 를 그대로 본떴다. 앞머리 바이트 판정과 문서 형식 표는
// lib/fileTypes.ts 로 함께 쓴다.
//
// 왜 /api/inquiry 에 action 을 더하지 않고 라우트를 나눴는가
//   · 첨부는 GET(서명 URL)·DELETE 가 필요하다. /api/inquiry 는 POST 하나에 action 으로만
//     갈리는 구조라, 거기에 GET·DELETE 를 섞으면 한 파일에 두 가지 규약이 공존한다.
//   · service-attachment 가 이미 「POST·GET·DELETE 세 메서드」 규약을 갖고 있다.
//     그 형제 파일로 두면 나란히 놓고 비교하기 쉽다.
//
// 왜 라우트인가 (service-attachment 와 같은 이유)
//   · inquiry_attachments 에는 읽기 정책만 있다. 쓰기는 service role 로만 이뤄져야 한다.
//   · 파일명을 서버가 정한다(클라이언트 이름은 표시용으로만 — 경로 조작·덮어쓰기 방지).
//   · 버킷이 비공개라 열람도 서명 URL 이 필요하고, 그 발급 전에 권한을 다시 본다.
//
// 접근 권한은 의뢰서 메뉴 권한(inquiries)을 기준으로 한다.
// 개별 삭제만 올린 사람 본인 또는 superadmin 으로 좁힌다(남이 올린 자료를 함부로 지우지 못하게).
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { canViewMenu, isSuperAdmin } from '@/lib/permissions'
import { withTeamPerm } from '@/lib/teamPermsServer'
import { parseDataUrlImage } from '@/lib/imageUpload'
import { headOf, isOle2, isZip, OFFICE_DOC_TYPES, type DocType } from '@/lib/fileTypes'

const TAG = 'inquiry-attachment'
const BUCKET = 'inquiry-attachments'

/** 내용 기록 한 건당 첨부 상한. 화면도 같은 값으로 추가 버튼을 잠근다. */
const MAX_PER_MESSAGE = 10
/** 파일 하나의 상한(디코딩 후). 서비스 레포트 첨부와 같은 20MB. */
const MAX_BYTES = 20 * 1024 * 1024
/** 서명 URL 만료 — 코드베이스의 다른 서명 URL 과 같은 1시간. */
const SIGNED_URL_TTL = 60 * 60
/** 표시용 파일명 상한. 넘치면 잘라 저장한다. */
const NAME_MAX = 200

const ATTACHMENT_COLUMNS =
  'id, message_id, inquiry_id, file_path, file_name, content_type, byte_size, sort_order, uploaded_by, created_at'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

/**
 * supabase 오류를 사람이 읽을 한 줄로. message 와 code 만 싣는다 —
 * 화면에 그대로 뜨므로 키·경로·SQL 같은 값은 넣지 않는다.
 */
function reasonOf(e: unknown): string {
  const o = (e ?? {}) as { message?: unknown; code?: unknown }
  const msg = typeof o.message === 'string' && o.message ? o.message : '알 수 없는 오류'
  const code = typeof o.code === 'string' && o.code ? ` (${o.code})` : ''
  return `${msg}${code}`
}

/**
 * 서버 설정이 갖춰졌는지. 없으면 supabase 클라이언트가 모듈을 읽는 시점에 던져
 * 라우트가 JSON 이 아닌 500 을 내보낸다 — 그러면 화면에 이유가 아예 남지 않는다.
 * 부르는 쪽에서 먼저 확인해 사유가 실린 JSON 으로 돌려준다.
 */
const envReady = (): boolean =>
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY

type Caller = { engineer_id: number; permission_level: string | null; teams: string | null }

/** 로그인 + 의뢰서 메뉴 권한. */
async function authorize(): Promise<{ error: NextResponse; caller: null } | { error: null; caller: Caller }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return { error: bad('로그인이 필요합니다. 다시 로그인해 주세요.', 401), caller: null }

  const { data: row, error } = await supabase
    .from('engineers').select('engineer_id, permission_level, teams').eq('email', user.email).single()
  if (error) console.error(`[${TAG}] caller lookup failed`, { email: user.email, error })
  const caller = await withTeamPerm((row ?? null) as Caller | null)
  if (!caller || !canViewMenu(caller, 'inquiries')) {
    return { error: bad('이 메뉴를 사용할 권한이 없습니다.', 403), caller: null }
  }
  return { error: null, caller }
}

// ── 파일 검증 ───────────────────────────────────────────────────────
//
// service-attachment 와 다른 점이 하나 있다: 형식을 **확장자로** 찾고 MIME 은 참고만 한다.
//
// 그쪽은 MIME 으로 표를 찾는데, 일본 본사와 주고받는 메일 파일(.msg·.eml)은 브라우저가
// 형식을 몰라 application/octet-stream 이나 빈 값으로 보낸다. MIME 으로만 찾으면 그 둘이
// 영영 막힌다. 그래서 사용자가 고른 파일 이름의 확장자를 기준으로 삼고, 매직 넘버가 있는
// 형식은 그 확장자에 맞는 sniff 를 그대로 돌려 「확장자만 바꾼 파일」을 걸러낸다.
//
// 확장자는 아래 표에 있는 값만 쓰므로 경로에 이상한 글자가 섞일 수 없다.
type Parsed = { bytes: Buffer; ext: string; contentType: string }

/** 앞머리로는 가릴 수 없는 형식. 통과 기준은 확장자와 크기뿐이다. */
const noSniff = () => true

/**
 * 확장자 → 판정. OFFICE_DOC_TYPES(서비스 첨부와 공용)를 확장자 키로 뒤집고, 의뢰서에서만
 * 필요한 셋(zip·msg·eml)을 더한다.
 */
const EXT_TYPES: Record<string, DocType & { contentType: string }> = {
  ...Object.fromEntries(
    Object.entries(OFFICE_DOC_TYPES).map(([mime, d]) => [d.ext, { ...d, contentType: mime }]),
  ),
  // 본사가 도면·부품 목록을 묶어 보낼 때 쓴다. xlsx·docx 와 같은 zip 컨테이너다.
  zip: { ext: 'zip', sniff: isZip, contentType: 'application/zip' },
  // 아웃룩 메일 파일. OLE2 복합문서라 xls·doc 과 같은 앞머리를 갖는다.
  msg: { ext: 'msg', sniff: isOle2, contentType: 'application/vnd.ms-outlook' },
  // RFC822 메일. 평문이라 매직 넘버가 없다 — 앞머리로 가릴 방법이 없어 확장자·크기만 본다.
  // 대신 내려받을 때 Content-Disposition 을 attachment 로 못 박아 브라우저가 열어 보지 않게 한다
  // (아래 GET 의 download 옵션). 평문에 스크립트를 섞어도 실행될 자리가 없다.
  eml: { ext: 'eml', sniff: noSniff, contentType: 'message/rfc822' },
}

/** 사람이 읽을 허용 목록 — 오류 문구에 그대로 쓴다. */
const ALLOWED_TEXT = 'PDF, 엑셀, 워드, 이미지, zip, 메일 파일(msg·eml)'

/** 파일 이름에서 확장자만. 소문자로, 마지막 점 뒤만 본다. */
const extOf = (name: string): string => {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

/** data URL 하나를 검증해 바이트·확장자·형식을 돌려준다. 막히면 { error }. */
export function parseInquiryFile(rawName: unknown, raw: unknown): { error: string } | { value: Parsed } {
  if (typeof raw !== 'string' || !raw.startsWith('data:')) return { error: '첨부파일을 읽을 수 없습니다.' }
  const name = typeof rawName === 'string' ? rawName.trim() : ''
  const ext = extOf(name)

  // 이미지는 기존 검사(매직바이트 + 크기 + 선언 MIME 일치)를 그대로 쓴다.
  const semi = raw.indexOf(';')
  const mime = semi > 5 ? raw.slice(5, semi).trim() : ''
  if (mime.startsWith('image/')) {
    const r = parseDataUrlImage(raw, MAX_BYTES, '첨부파일')
    if (!r.ok) return { error: r.error }
    if (!r.image) return { error: '첨부파일을 읽을 수 없습니다.' }
    return { value: { bytes: r.image.bytes, ext: r.image.ext, contentType: r.image.contentType } }
  }

  const type = EXT_TYPES[ext]
  if (!type) return { error: `${ALLOWED_TEXT} 만 올릴 수 있습니다.` }

  const m = /^data:[^;]*;base64,([A-Za-z0-9+/=]+)$/.exec(raw)
  if (!m) return { error: '첨부파일을 읽을 수 없습니다.' }
  let bytes: Buffer
  try { bytes = Buffer.from(m[1], 'base64') } catch { return { error: '첨부파일을 읽을 수 없습니다.' } }
  if (bytes.length === 0) return { error: '첨부파일을 읽을 수 없습니다.' }
  if (bytes.length > MAX_BYTES) return { error: `첨부파일은 ${MAX_BYTES / (1024 * 1024)}MB 를 넘을 수 없습니다.` }
  // 판정에는 앞머리만 넘긴다 — 큰 파일이어도 판정이 만지는 바이트 수는 늘 같다.
  if (!type.sniff(headOf(bytes))) return { error: '파일 형식이 확장자와 다릅니다.' }
  return { value: { bytes, ext: type.ext, contentType: type.contentType } }
}

/** 스토리지 파일 삭제. 실패해도 DB 행은 지운다 — 가리키는 행이 없는 파일보다 낫다(로그로 남긴다). */
async function removeFiles(paths: string[]): Promise<void> {
  if (paths.length === 0) return
  const { error } = await supabaseAdmin.storage.from(BUCKET).remove(paths)
  if (error) console.error(`[${TAG}] 파일 삭제 실패 — 고아 파일이 남는다`, { paths, error })
}

// ── POST: 업로드 (여러 개) ──────────────────────────────────────────
//
// 통째로 try/catch 로 감싼다. 예상 못 한 예외가 새어 나가면 Next 가 자기 형식으로 500 을
// 내보내는데, 그 본문에는 error 필드가 없어 화면이 「서버 오류 (HTTP 500)」밖에 못 보여 준다.
// 무슨 일이 있어도 사유가 실린 JSON 으로 돌려준다.
export async function POST(req: NextRequest) {
  try {
    return await upload(req)
  } catch (e) {
    console.error(`[${TAG}] POST 처리 중 예외`, e)
    return bad(`첨부파일 처리 중 오류: ${reasonOf(e)}`, 500)
  }
}

async function upload(req: NextRequest) {
  if (!envReady()) {
    console.error(`[${TAG}] 환경 변수 누락 — SUPABASE URL 또는 SERVICE_ROLE_KEY`)
    return bad('서버 설정 오류', 500)
  }
  const auth = await authorize()
  if (auth.error) return auth.error
  const caller = auth.caller

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const messageId = Number(body.messageId)
  if (!Number.isInteger(messageId) || messageId <= 0) return bad('내용 기록을 지정해주세요.')

  const list = Array.isArray(body.files) ? body.files : []
  if (list.length === 0) return bad('올릴 파일이 없습니다.')

  // inquiry_id 는 클라이언트 값을 믿지 않고 내용 기록에서 읽는다.
  // 그래야 첨부의 inquiry_id 와 내용 기록의 inquiry_id 가 어긋나지 않는다(DB 복합 FK 도 같은 것을 본다).
  const { data: msg, error: msgErr } = await supabaseAdmin
    .from('inquiry_messages')
    .select('id, inquiry_id, inquiries!inner(status)')
    .eq('id', messageId)
    .maybeSingle()
  if (msgErr) {
    console.error(`[${TAG}] 단계=내용기록조회 messageId=${messageId}`, msgErr)
    return bad(`내용 기록 조회 실패: ${reasonOf(msgErr)}`, 500)
  }
  if (!msg) return bad('내용 기록을 찾을 수 없습니다.', 404)
  const row = msg as unknown as { inquiry_id: string; inquiries: { status: string } | { status: string }[] }
  const status = Array.isArray(row.inquiries) ? row.inquiries[0]?.status : row.inquiries?.status
  // 취소된 의뢰서는 읽기 전용이다(내용 기록 추가·수정·삭제와 같은 규칙).
  if (status === 'cancelled') return bad('취소된 의뢰서에는 파일을 올릴 수 없습니다.', 409)

  const { count, error: cntErr } = await supabaseAdmin
    .from('inquiry_attachments')
    .select('id', { count: 'exact', head: true })
    .eq('message_id', messageId)
  if (cntErr) {
    console.error(`[${TAG}] 단계=첨부개수조회 messageId=${messageId}`, cntErr)
    return bad(`첨부 개수 조회 실패: ${reasonOf(cntErr)}`, 500)
  }
  const already = count ?? 0
  if (already + list.length > MAX_PER_MESSAGE) {
    return bad(`첨부파일은 내용 기록 하나에 ${MAX_PER_MESSAGE}개까지 올릴 수 있습니다 (현재 ${already}개).`)
  }

  // 먼저 전부 검증한다 — 반쯤 올리고 막히는 것보다 시작 전에 막는 편이 낫다.
  const stamp = Date.now()
  const prepared: { path: string; parsed: Parsed; name: string }[] = []
  for (let i = 0; i < list.length; i++) {
    const item = list[i] as { name?: unknown; dataUrl?: unknown }
    const parsed = parseInquiryFile(item?.name, item?.dataUrl)
    if ('error' in parsed) return bad(parsed.error)
    const rawName = typeof item?.name === 'string' ? item.name.trim() : ''
    prepared.push({
      // 파일명은 서버가 정한다. 원래 이름은 file_name 에만 남긴다.
      path: `iq-${messageId}-${stamp}-${already + i}.${parsed.value.ext}`,
      parsed: parsed.value,
      name: (rawName || `첨부-${i + 1}.${parsed.value.ext}`).slice(0, NAME_MAX),
    })
  }

  const uploaded: string[] = []
  for (const p of prepared) {
    const { error } = await supabaseAdmin.storage
      .from(BUCKET)
      // Buffer 를 그대로 넘긴다 — 문자열·배열로 바꾸지 않는다(큰 파일에서 스택이 터진다).
      .upload(p.path, p.parsed.bytes, { contentType: p.parsed.contentType, upsert: false })
    if (error) {
      // 버킷 이름이 다르거나 없으면 여기서 'Bucket not found' 가 온다. 그대로 실어 보낸다.
      console.error(`[${TAG}] 단계=저장소업로드 버킷=${BUCKET} 경로=${p.path}`, error)
      await removeFiles(uploaded)
      return bad(`저장소 업로드 실패: ${reasonOf(error)}`, 500)
    }
    uploaded.push(p.path)
  }

  // uploaded_by 는 호출자로 강제한다(본문 값을 쓰지 않는다).
  const { data: rows, error: insErr } = await supabaseAdmin
    .from('inquiry_attachments')
    .insert(prepared.map((p, i) => ({
      message_id: messageId,
      inquiry_id: row.inquiry_id,
      file_path: p.path,
      file_name: p.name,
      content_type: p.parsed.contentType,
      byte_size: p.parsed.bytes.length,
      sort_order: already + i,
      uploaded_by: caller.engineer_id,
    })))
    .select(ATTACHMENT_COLUMNS)
  if (insErr) {
    // 컬럼이 표와 다르면 여기서 42703(undefined_column) 같은 코드가 온다.
    console.error(`[${TAG}] 단계=첨부행저장 messageId=${messageId}`, insErr)
    await removeFiles(uploaded)
    return bad(`첨부 정보 저장 실패: ${reasonOf(insErr)}`, 500)
  }

  return NextResponse.json({ attachments: rows ?? [] })
}

// ── DELETE: 첨부 1건 ────────────────────────────────────────────────
// 올린 사람 본인 또는 superadmin (service-attachment 의 개별 삭제와 같은 기준).
export async function DELETE(req: NextRequest) {
  const auth = await authorize()
  if (auth.error) return auth.error
  const caller = auth.caller

  const attachmentId = Number(req.nextUrl.searchParams.get('attachmentId'))
  if (!Number.isInteger(attachmentId) || attachmentId <= 0) return bad('첨부파일을 지정해주세요.')

  const { data: found, error } = await supabaseAdmin
    .from('inquiry_attachments')
    .select('id, file_path, uploaded_by, inquiries!inner(status)')
    .eq('id', attachmentId)
    .maybeSingle()
  if (error) {
    console.error(`[${TAG}] 단계=첨부조회(삭제) attachmentId=${attachmentId}`, error)
    return bad(`첨부 조회 실패: ${reasonOf(error)}`, 500)
  }
  if (!found) return bad('첨부파일을 찾을 수 없습니다.', 404)
  const att = found as unknown as {
    file_path: string; uploaded_by: number | null
    inquiries: { status: string } | { status: string }[]
  }
  const status = Array.isArray(att.inquiries) ? att.inquiries[0]?.status : att.inquiries?.status
  if (status === 'cancelled') return bad('취소된 의뢰서의 첨부는 지울 수 없습니다.', 409)
  if (att.uploaded_by !== caller.engineer_id && !isSuperAdmin(caller)) {
    return bad('올린 사람만 지울 수 있습니다.', 403)
  }

  // 스토리지 먼저, 그다음 행. 순서를 뒤집으면 경로를 잃어 고아 파일이 남는다.
  await removeFiles([att.file_path])
  const { error: delErr } = await supabaseAdmin
    .from('inquiry_attachments').delete().eq('id', attachmentId)
  if (delErr) {
    console.error(`[${TAG}] 단계=첨부행삭제 attachmentId=${attachmentId}`, delErr)
    return bad(`첨부 정보 삭제 실패: ${reasonOf(delErr)}`, 500)
  }
  return NextResponse.json({ success: true })
}

// ── GET: 서명 URL ───────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await authorize()
  if (auth.error) return auth.error

  const attachmentId = Number(req.nextUrl.searchParams.get('attachmentId'))
  if (!Number.isInteger(attachmentId) || attachmentId <= 0) return bad('첨부파일을 지정해주세요.')

  const { data: row, error } = await supabaseAdmin
    .from('inquiry_attachments').select('file_path, file_name').eq('id', attachmentId).maybeSingle()
  if (error) {
    console.error(`[${TAG}] 단계=첨부조회(열기) attachmentId=${attachmentId}`, error)
    return bad(`첨부 조회 실패: ${reasonOf(error)}`, 500)
  }
  if (!row) return bad('첨부파일을 찾을 수 없습니다.', 404)
  const att = row as { file_path: string; file_name: string }

  // download 옵션이 Content-Disposition: attachment 를 붙인다.
  // 형식을 가리지 않고 전부 붙이는 이유 — 이 버킷의 파일은 본사와 주고받은 문서라 저장이 목적이고,
  // .eml 처럼 앞머리로 형식을 가릴 수 없는 파일이 섞여 있다. 브라우저가 열어 보지 않게 못 박는다.
  // 원래 파일 이름으로 내려받게 이름도 함께 넘긴다(경로는 서버가 정한 iq-… 이라 사람이 못 읽는다).
  const { data, error: signErr } = await supabaseAdmin.storage
    .from(BUCKET).createSignedUrl(att.file_path, SIGNED_URL_TTL, { download: att.file_name })
  if (signErr || !data?.signedUrl) {
    console.error(`[${TAG}] 단계=서명URL발급 버킷=${BUCKET} attachmentId=${attachmentId}`, signErr)
    return bad(`저장소 열기 실패: ${reasonOf(signErr)}`, 500)
  }
  return NextResponse.json({ signedUrl: data.signedUrl, fileName: att.file_name })
}
