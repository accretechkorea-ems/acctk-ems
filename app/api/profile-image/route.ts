import { loadCaller } from '@/lib/apiCaller'
import { NextRequest, NextResponse } from 'next/server'
import {
  AVATAR_WIDTHS, PROFILE_BUCKET, isSafeProfileImageName, isOwnProfileImageName, profileImagePath,
} from '@/lib/profileImage'

/** 서명 URL 만료 — 코드베이스의 다른 서명 URL 과 같은 1시간. */
const TAG = 'profile-image'

const SIGNED_URL_TTL = 60 * 60

/**
 * 프로필 사진 한 장의 서명 URL.
 *
 *   GET /api/profile-image?path=profile-20-1790139458648.jpg&w=160
 *
 * 버킷(profile-images)은 **비공개**다. 그래서 화면은 주소를 직접 만들 수 없고 여기를 지난다.
 * w 를 주면 **변환된 작은 그림**을 서명한다 — 72px 아바타에 324KB 원본을 내려보낼 이유가 없다
 * (2026-10-23 실측: 원본 323,711바이트 → width=80 변환 2,190바이트).
 */
export async function GET(req: NextRequest) {
  // 로그인·재직 확인 + service role 클라이언트를 한 줄로(lib/apiCaller.ts).
  // 프로필 사진은 사내 직원끼리 보는 것이 정상이라 메뉴 권한은 보지 않는다 — Need 는 login 이다.
  // (종전에도 「engineers 행이 있는가」만 보았다. 그 조회가 loadCaller 안으로 들어갔다.)
  const { error: authErr, caller, sb: supabaseAdmin } = await loadCaller({ kind: 'login' }, { tag: TAG, method: 'GET' })
  if (authErr) return authErr

  const raw = req.nextUrl.searchParams.get('path')
  if (!raw) return NextResponse.json({ error: 'path required' }, { status: 400 })

  // 저장된 값이 옛 공개 URL 인 행도 있으므로 화면이 그대로 넘겨도 되게 여기서도 경로를 뽑는다.
  const safePath = profileImagePath(raw)
  if (!safePath || !isSafeProfileImageName(safePath)) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  }

  const wParam = req.nextUrl.searchParams.get('w')
  const width = wParam ? Number(wParam) : null
  if (width !== null && !(AVATAR_WIDTHS as readonly number[]).includes(width)) {
    return NextResponse.json({ error: 'Invalid w' }, { status: 400 })
  }

  // 서명 대상이 실제 프로필 이미지 경로인지 확인한다(버킷 안의 임의 객체를 서명하지 않게).
  //
  // 저장된 값이 **경로일 수도, 옛 공개 URL 일 수도** 있어 `eq` 하나로는 못 찾는다.
  // 행이 43개뿐이라 그 칸만 통째로 읽어 코드에서 경로로 바꿔 맞춘다 — DB 를 고치지 않고
  // 옛 행을 받아들이는 자리가 여기다(lib/profileImage.ts 머리말).
  const { data: owners, error: ownerErr } = await supabaseAdmin
    .from('engineers')
    .select('profile_image_url')
    .not('profile_image_url', 'is', null)
  if (ownerErr) {
    console.error('[profile-image] 소유 확인 실패', ownerErr)
    return NextResponse.json({ error: '파일을 불러오지 못했습니다.' }, { status: 500 })
  }
  const known = (owners ?? []).some(r => profileImagePath(r.profile_image_url) === safePath)
  if (!known) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data, error } = await supabaseAdmin.storage
    .from(PROFILE_BUCKET)
    .createSignedUrl(safePath, SIGNED_URL_TTL,
      width ? { transform: { width, height: width, resize: 'cover' } } : undefined)

  if (error || !data) {
    console.error('[profile-image] signed url 발급 실패', error)
    return NextResponse.json({ error: '파일을 불러오지 못했습니다.' }, { status: 500 })
  }

  try {
    await supabaseAdmin.from('audit_log').insert({
      actor_email: caller.email, action: 'READ', table_name: PROFILE_BUCKET, row_id: safePath,
    })
  } catch { /* best-effort */ }

  // 만료 시각을 함께 준다 — 화면의 캐시(hooks/useAvatarUrl.ts)가 이 값을 보고 다시 받는다.
  return NextResponse.json({ signedUrl: data.signedUrl, expiresIn: SIGNED_URL_TTL })
}

/**
 * 더 쓰지 않는 프로필 사진 한 장을 버킷에서 지운다.
 *
 *   DELETE /api/profile-image?path=profile-20-1790139385313.jpg
 *
 * 왜 라우트인가 — 버킷이 비공개라 지우기도 정책을 타고, 무엇보다 **지우기는 되돌릴 수
 * 없다**. service role 로 하는 대신 네 가지를 여기서 확인한다.
 *   ① 로그인한 직원인가(engineers 행이 있는가)
 *   ② 이름이 버킷 안의 평평한 파일 이름인가(경로 올라가기·슬래시 금지)
 *   ③ **그 사람 자기 사진인가** — profile-<engineer_id>-… 이름 규칙으로 본다
 *   ④ **어느 행도 더 가리키지 않는가** — 지금 쓰는 사진은 절대 지우지 않는다
 *      (사진을 갈아 끼운 **뒤에** 부르므로, 옛 파일은 이미 아무도 가리키지 않는다)
 *
 * 화면은 결과를 기다리지 않는다 — 실패해도 교체 자체는 끝난 일이라 고아 파일만 남는다
 * (app/account/page.tsx). 그래서 여기서도 막지 않고 기록만 남긴다.
 */
export async function DELETE(req: NextRequest) {
  // ① 누가 부르는가 — 로그인·재직 확인(lib/apiCaller.ts). sb 는 service role 이다.
  const { error: authErr, caller, sb: supabaseAdmin } = await loadCaller({ kind: 'login' }, { tag: TAG, req })
  if (authErr) return authErr

  const raw = req.nextUrl.searchParams.get('path')
  if (!raw) return NextResponse.json({ error: 'path required' }, { status: 400 })

  const safePath = profileImagePath(raw)
  if (!safePath || !isSafeProfileImageName(safePath)) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  }

  // ③ 자기 사진만.
  if (!isOwnProfileImageName(safePath, caller.engineer_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // ④ 아직 쓰는 사진이면 지우지 않는다. GET 과 같은 방식으로 본다 — 저장된 값이 경로일
  //    수도 옛 공개 URL 일 수도 있어 칸을 통째로 읽어 코드에서 맞춘다(행이 43개뿐이다).
  const { data: owners, error: ownerErr } = await supabaseAdmin
    .from('engineers')
    .select('profile_image_url')
    .not('profile_image_url', 'is', null)
  if (ownerErr) {
    console.error('[profile-image] 참조 확인 실패', ownerErr)
    return NextResponse.json({ error: '파일을 정리하지 못했습니다.' }, { status: 500 })
  }
  if ((owners ?? []).some(r => profileImagePath(r.profile_image_url) === safePath)) {
    return NextResponse.json({ error: 'In use' }, { status: 409 })
  }

  const { error } = await supabaseAdmin.storage.from(PROFILE_BUCKET).remove([safePath])
  if (error) {
    console.error('[profile-image] 옛 파일 삭제 실패 — 고아 파일이 남는다', { path: safePath, error })
    return NextResponse.json({ error: '파일을 지우지 못했습니다.' }, { status: 500 })
  }

  try {
    await supabaseAdmin.from('audit_log').insert({
      actor_email: caller.email, action: 'DELETE', table_name: PROFILE_BUCKET, row_id: safePath,
    })
  } catch { /* best-effort */ }

  return NextResponse.json({ ok: true })
}
