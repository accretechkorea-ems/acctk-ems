// 공지 작성·수정·삭제. 읽기는 화면이 RLS(authenticated SELECT)로 직접 하고, 쓰기는 전부 여기로 온다.
//
// 라우트로 둔 이유:
//   · notices 에는 INSERT/UPDATE/DELETE 정책이 없다 — 쓰기는 service role 로만 이뤄져야 한다.
//   · 스토리지 업로드도 서버가 한다(파일명을 서버가 정해 경로 조작·덮어쓰기를 막는다).
//   · 삭제할 때 스토리지 이미지까지 함께 지워야 해서, 두 작업을 한곳에서 묶는다.
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { isSuperAdmin } from '@/lib/permissions'
import { parseDataUrlImage } from '@/lib/imageUpload'
import {
  NOTICE_BUCKET, NOTICE_MAX_IMAGES, NOTICE_IMAGE_MAX_BYTES,
  NOTICE_TITLE_MAX, NOTICE_BODY_MAX,
} from '@/lib/notices'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/** 'YYYY-MM-DD' 이고 실재하는 날짜인지(2026-02-30 차단). */
function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() + 1 === m && dt.getUTCDate() === d
}

/**
 * 화면이 보낸 이미지 목록을 스토리지에 올리고 최종 URL 배열을 만든다.
 * 항목은 둘 중 하나다 —
 *   · 'https://...' 로 시작하면 이미 올라간 이미지(수정 시 그대로 두는 것). 그대로 통과시킨다.
 *   · 'data:image/...' 면 새로 올릴 이미지.
 * 배열 순서가 곧 표시 순서라, 받은 순서를 그대로 지킨다.
 */
async function uploadImages(raw: unknown, noticeId: number): Promise<{ ok: true; urls: string[] } | { ok: false; error: string }> {
  const list = Array.isArray(raw) ? raw : []
  if (list.length > NOTICE_MAX_IMAGES) {
    return { ok: false, error: `이미지는 최대 ${NOTICE_MAX_IMAGES}장까지 올릴 수 있습니다.` }
  }
  const urls: string[] = []
  for (let i = 0; i < list.length; i++) {
    const item = list[i]
    if (typeof item === 'string' && /^https?:\/\//.test(item)) { urls.push(item); continue }

    const parsed = parseDataUrlImage(item, NOTICE_IMAGE_MAX_BYTES, '공지 이미지')
    if (!parsed.ok) return { ok: false, error: parsed.error }
    if (!parsed.image) continue

    // 파일명은 서버가 정한다. 같은 공지를 여러 번 고쳐도 겹치지 않도록 시각을 붙인다.
    const name = `notice-${noticeId}-${Date.now()}-${i}.${parsed.image.ext}`
    const { error } = await supabaseAdmin.storage
      .from(NOTICE_BUCKET)
      .upload(name, parsed.image.bytes, { contentType: parsed.image.contentType, upsert: false })
    if (error) {
      console.error('[notice] 이미지 업로드 실패', { noticeId, name, error })
      return { ok: false, error: '이미지를 저장하지 못했습니다.' }
    }
    const { data } = supabaseAdmin.storage.from(NOTICE_BUCKET).getPublicUrl(name)
    urls.push(data.publicUrl)
  }
  return { ok: true, urls }
}

/** 공개 URL 에서 버킷 안 파일명만 뽑는다. 우리 버킷의 URL 이 아니면 null(남의 경로를 지우지 않는다). */
function fileNameOf(url: string): string | null {
  const marker = `/storage/v1/object/public/${NOTICE_BUCKET}/`
  const at = url.indexOf(marker)
  if (at < 0) return null
  const name = decodeURIComponent(url.slice(at + marker.length))
  // 버킷 루트의 단일 파일명만 허용한다.
  return name && !name.includes('/') ? name : null
}

/** 더 이상 쓰이지 않는 이미지를 지운다. 실패해도 본체 작업은 막지 않고 로그만 남긴다. */
async function removeImages(urls: string[]): Promise<void> {
  const names = urls.map(fileNameOf).filter((n): n is string => !!n)
  if (names.length === 0) return
  const { data, error } = await supabaseAdmin.storage.from(NOTICE_BUCKET).remove(names)
  if (error) { console.error('[notice] 이미지 삭제 실패', { names, error }); return }
  // remove 는 없는 파일에도 오류를 내지 않는다. 실제로 몇 개가 지워졌는지 남긴다.
  console.log('[notice] 이미지 삭제', { 요청: names.length, 삭제됨: data?.length ?? 0 })
}

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: caller } = await supabase
    .from('engineers')
    .select('engineer_id, permission_level')
    .eq('email', user.email!)
    .single()
  if (!caller || !isSuperAdmin(caller)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const action: string = body?.action ?? ''

  // ── 삭제 ──
  if (action === 'delete') {
    const noticeId = Number(body?.noticeId)
    if (!Number.isInteger(noticeId) || noticeId <= 0) return bad('공지를 지정해주세요.')
    const { data: row } = await supabaseAdmin
      .from('notices').select('notice_id, image_urls').eq('notice_id', noticeId).maybeSingle()
    if (!row) return bad('공지를 찾을 수 없습니다.', 404)

    // 이미지를 먼저 지운다 — 행이 사라지면 어떤 파일이 딸려 있었는지 알 수 없다.
    await removeImages((row.image_urls ?? []) as string[])
    const { error } = await supabaseAdmin.from('notices').delete().eq('notice_id', noticeId)
    if (error) {
      console.error('[notice] delete failed', { noticeId, error })
      return bad('삭제하지 못했습니다.', 500)
    }
    console.log('[notice] delete', { noticeId, by: user.email })
    return NextResponse.json({ success: true })
  }

  // ── 작성·수정 공통 검증 ──
  const title = str(body?.title)
  if (!title) return bad('제목을 입력해주세요.')
  if (title.length > NOTICE_TITLE_MAX) return bad(`제목은 ${NOTICE_TITLE_MAX}자를 넘을 수 없습니다.`)

  const noticeBody = str(body?.body)
  if (noticeBody.length > NOTICE_BODY_MAX) return bad(`본문은 ${NOTICE_BODY_MAX}자를 넘을 수 없습니다.`)

  const startsAt = str(body?.starts_at)
  const endsAt = str(body?.ends_at)
  if (!isValidDate(startsAt)) return bad('게시 시작일을 확인해주세요.')
  if (!isValidDate(endsAt)) return bad('게시 종료일을 확인해주세요.')
  if (endsAt < startsAt) return bad('게시 종료일이 시작일보다 앞설 수 없습니다.')

  // ── 작성 ──
  if (action === 'create') {
    // 이미지 파일명에 notice_id 를 쓰므로 행을 먼저 만들고 URL 을 채운다.
    const { data: created, error: insErr } = await supabaseAdmin
      .from('notices')
      .insert({ title, body: noticeBody || null, image_urls: [], starts_at: startsAt, ends_at: endsAt, created_by: caller.engineer_id })
      .select('notice_id')
      .single()
    if (insErr || !created) {
      console.error('[notice] insert failed', insErr)
      return bad('공지를 등록하지 못했습니다.', 500)
    }
    const up = await uploadImages(body?.images, created.notice_id)
    if (!up.ok) {
      // 이미지가 실패하면 방금 만든 행도 되돌린다 — 반쪽짜리 공지를 남기지 않는다.
      await supabaseAdmin.from('notices').delete().eq('notice_id', created.notice_id)
      return bad(up.error)
    }
    if (up.urls.length > 0) {
      await supabaseAdmin.from('notices').update({ image_urls: up.urls }).eq('notice_id', created.notice_id)
    }
    console.log('[notice] create', { noticeId: created.notice_id, images: up.urls.length, by: user.email })
    return NextResponse.json({ success: true, noticeId: created.notice_id })
  }

  // ── 수정 ──
  if (action === 'update') {
    const noticeId = Number(body?.noticeId)
    if (!Number.isInteger(noticeId) || noticeId <= 0) return bad('공지를 지정해주세요.')
    const { data: row } = await supabaseAdmin
      .from('notices').select('notice_id, image_urls').eq('notice_id', noticeId).maybeSingle()
    if (!row) return bad('공지를 찾을 수 없습니다.', 404)

    const up = await uploadImages(body?.images, noticeId)
    if (!up.ok) return bad(up.error)

    const { error } = await supabaseAdmin
      .from('notices')
      .update({ title, body: noticeBody || null, image_urls: up.urls, starts_at: startsAt, ends_at: endsAt, updated_at: new Date().toISOString() })
      .eq('notice_id', noticeId)
    if (error) {
      console.error('[notice] update failed', { noticeId, error })
      return bad('수정하지 못했습니다.', 500)
    }
    // 목록에서 빠진 옛 이미지는 스토리지에서도 지운다.
    const before = ((row.image_urls ?? []) as string[])
    await removeImages(before.filter(u => !up.urls.includes(u)))
    console.log('[notice] update', { noticeId, images: up.urls.length, by: user.email })
    return NextResponse.json({ success: true })
  }

  return bad('알 수 없는 요청입니다.')
}
