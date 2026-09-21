// 건의사항 스크린샷 — 업로드(POST) · 삭제(DELETE) · 열기(GET 서명 URL).
//
// 건의 본문은 화면에서 직접 쓰지만 이미지는 여기를 거친다.
//   · 버킷이 비공개라 업로드·열기 모두 service role 이 필요하다
//   · 파일명을 서버가 정한다(클라이언트 이름은 쓰지 않는다 — 경로 조작·덮어쓰기 방지)
//   · image_urls 배열을 화면이 직접 고치면 남의 파일명을 넣을 수 있다
//
// 공지 이미지(/api/notice)와 같은 text[] 방식이되, 배열에는 전체 URL 이 아니라
// 버킷 안 파일명만 담는다(비공개 버킷이므로 열 때 서명 URL 을 발급한다).
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { isSuperAdmin } from '@/lib/permissions'
import { parseDataUrlImage } from '@/lib/imageUpload'

const BUCKET = 'suggestion-images'
/** 건의 1건당 스크린샷 상한. 화면도 같은 값으로 추가를 막는다. */
const MAX_IMAGES = 3
/** 한 장의 상한(디코딩 후). 버킷 제한과 같은 5MB. */
const MAX_BYTES = 5 * 1024 * 1024
/** 서명 URL 만료 — 코드베이스의 다른 서명 URL 과 같은 1시간. */
const SIGNED_URL_TTL = 60 * 60

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

type Caller = { engineer_id: number; permission_level: string | null; teams: string | null }
type Row = { suggestion_id: number; engineer_id: number; image_urls: string[] | null }

/** 로그인 확인. 건의사항 화면은 로그인 전원 열람이라 별도 권한 판정이 없다. */
async function authorize(): Promise<{ error: NextResponse; caller: null } | { error: null; caller: Caller }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return { error: bad('Unauthorized', 401), caller: null }

  const { data: row, error } = await supabase
    .from('engineers')
    .select('engineer_id, permission_level, teams')
    .eq('email', user.email)
    .single()
  if (error) console.error('[suggestion-image] caller lookup failed', { email: user.email, error })
  if (!row) return { error: bad('Forbidden', 403), caller: null }
  return { error: null, caller: row as Caller }
}

/** 건의 1건을 service role 로 읽는다. */
async function loadSuggestion(suggestionId: number): Promise<{ error: NextResponse; row: null } | { error: null; row: Row }> {
  const { data, error } = await supabaseAdmin
    .from('suggestions')
    .select('suggestion_id, engineer_id, image_urls')
    .eq('suggestion_id', suggestionId)
    .maybeSingle()
  if (error) {
    console.error('[suggestion-image] suggestion lookup failed', { suggestionId, error })
    return { error: bad('건의사항을 확인하지 못했습니다.', 500), row: null }
  }
  if (!data) return { error: bad('건의사항을 찾을 수 없습니다.', 404), row: null }
  return { error: null, row: data as Row }
}

/** 스토리지 파일 삭제. 실패해도 배열은 정리한다 — 가리키는 행이 없는 파일보다 낫다(로그로 남긴다). */
async function removeFiles(paths: string[]): Promise<void> {
  if (paths.length === 0) return
  const { error } = await supabaseAdmin.storage.from(BUCKET).remove(paths)
  if (error) console.error('[suggestion-image] 파일 삭제 실패 — 고아 파일이 남는다', { paths, error })
}

// ── POST: 업로드 (여러 장) ──────────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await authorize()
  if (auth.error) return auth.error
  const caller = auth.caller

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const suggestionId = Number(body.suggestionId)
  if (!Number.isInteger(suggestionId) || suggestionId < 1) return bad('건의사항을 지정해주세요.')

  const images = Array.isArray(body.images) ? body.images : []
  if (images.length === 0) return bad('올릴 이미지가 없습니다.')

  const found = await loadSuggestion(suggestionId)
  if (found.error) return found.error
  const row = found.row

  // 스크린샷은 작성자만 붙인다(관리자도 남의 건의에 이미지를 더하지는 않는다).
  if (row.engineer_id !== caller.engineer_id) return bad('작성자만 올릴 수 있습니다.', 403)

  const existing = row.image_urls ?? []
  if (existing.length + images.length > MAX_IMAGES) {
    return bad(`스크린샷은 ${MAX_IMAGES}장까지 올릴 수 있습니다 (현재 ${existing.length}장).`)
  }

  // 먼저 전부 검증한다 — 반쯤 올리고 막히는 것보다 시작 전에 막는 편이 낫다.
  const stamp = Date.now()
  const prepared: { path: string; bytes: Buffer; contentType: string }[] = []
  for (let i = 0; i < images.length; i++) {
    const parsed = parseDataUrlImage(images[i], MAX_BYTES, '스크린샷')
    if (!parsed.ok) return bad(parsed.error)
    if (!parsed.image) return bad('스크린샷을 읽을 수 없습니다.')
    prepared.push({
      path: `sug-${suggestionId}-${stamp}-${i}.${parsed.image.ext}`,
      bytes: parsed.image.bytes,
      contentType: parsed.image.contentType,
    })
  }

  const uploaded: string[] = []
  for (const p of prepared) {
    const { error } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(p.path, p.bytes, { contentType: p.contentType, upsert: false })
    if (error) {
      console.error('[suggestion-image] 업로드 실패', { suggestionId, path: p.path, error })
      await removeFiles(uploaded)
      return bad('스크린샷을 저장하지 못했습니다.', 500)
    }
    uploaded.push(p.path)
  }

  const nextUrls = [...existing, ...uploaded]
  const { error: updErr } = await supabaseAdmin
    .from('suggestions').update({ image_urls: nextUrls }).eq('suggestion_id', suggestionId)
  if (updErr) {
    // 파일은 올라갔는데 배열이 비면 아무도 찾을 수 없는 파일이 된다 — 올린 것을 지운다.
    console.error('[suggestion-image] 배열 갱신 실패, 올린 파일을 지운다', { suggestionId, error: updErr })
    await removeFiles(uploaded)
    return bad('스크린샷 정보를 저장하지 못했습니다.', 500)
  }

  console.log('[suggestion-image] 업로드', { suggestionId, count: uploaded.length, by: caller.engineer_id })
  return NextResponse.json({ success: true, imageUrls: nextUrls })
}

// ── DELETE: 1장 또는 전부 ───────────────────────────────────────────
// fileName — 작성자 본인 또는 superadmin.
// all      — 건의를 지우기 전 정리용. 권한은 같다.
export async function DELETE(req: NextRequest) {
  const auth = await authorize()
  if (auth.error) return auth.error
  const caller = auth.caller

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const suggestionId = Number(body.suggestionId)
  if (!Number.isInteger(suggestionId) || suggestionId < 1) return bad('건의사항을 지정해주세요.')

  const found = await loadSuggestion(suggestionId)
  if (found.error) return found.error
  const row = found.row

  if (row.engineer_id !== caller.engineer_id && !isSuperAdmin(caller)) {
    return bad('작성자만 지울 수 있습니다.', 403)
  }

  const existing = row.image_urls ?? []

  if (body.all === true) {
    if (existing.length === 0) return NextResponse.json({ success: true, imageUrls: [] })
    await removeFiles(existing)
    const { error } = await supabaseAdmin
      .from('suggestions').update({ image_urls: [] }).eq('suggestion_id', suggestionId)
    if (error) {
      console.error('[suggestion-image] 배열 비우기 실패', { suggestionId, error })
      return bad('스크린샷을 지우지 못했습니다.', 500)
    }
    console.log('[suggestion-image] 전체 정리', { suggestionId, removed: existing.length })
    return NextResponse.json({ success: true, imageUrls: [] })
  }

  const fileName = typeof body.fileName === 'string' ? body.fileName : ''
  // 이 건의가 가진 파일만 지운다 — 이름을 지어내 남의 파일을 지우지 못하게 한다.
  if (!fileName || !existing.includes(fileName)) return bad('스크린샷을 찾을 수 없습니다.', 404)

  await removeFiles([fileName])
  const nextUrls = existing.filter(n => n !== fileName)
  const { error } = await supabaseAdmin
    .from('suggestions').update({ image_urls: nextUrls }).eq('suggestion_id', suggestionId)
  if (error) {
    console.error('[suggestion-image] 배열 갱신 실패', { suggestionId, fileName, error })
    return bad('스크린샷을 지우지 못했습니다.', 500)
  }
  return NextResponse.json({ success: true, imageUrls: nextUrls })
}

// ── GET: 서명 URL ───────────────────────────────────────────────────
// 건의사항은 로그인 전원이 열람하므로 읽기는 작성자로 좁히지 않는다.
export async function GET(req: NextRequest) {
  const auth = await authorize()
  if (auth.error) return auth.error

  const suggestionId = Number(req.nextUrl.searchParams.get('suggestionId'))
  const fileName = req.nextUrl.searchParams.get('fileName') ?? ''
  if (!Number.isInteger(suggestionId) || suggestionId < 1) return bad('건의사항을 지정해주세요.')
  if (!fileName) return bad('파일을 지정해주세요.')

  const found = await loadSuggestion(suggestionId)
  if (found.error) return found.error
  // 그 건의가 실제로 가진 파일인지 본다(다른 건의 파일을 넘겨보는 것을 막는다).
  if (!(found.row.image_urls ?? []).includes(fileName)) return bad('스크린샷을 찾을 수 없습니다.', 404)

  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET).createSignedUrl(fileName, SIGNED_URL_TTL)
  if (error || !data?.signedUrl) {
    console.error('[suggestion-image] signed url 발급 실패', { suggestionId, fileName, error })
    return bad('스크린샷을 열 수 없습니다.', 500)
  }
  return NextResponse.json({ signedUrl: data.signedUrl })
}
