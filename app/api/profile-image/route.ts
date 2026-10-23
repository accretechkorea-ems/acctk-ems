import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import {
  AVATAR_WIDTHS, PROFILE_BUCKET, isSafeProfileImageName, profileImagePath,
} from '@/lib/profileImage'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/** 서명 URL 만료 — 코드베이스의 다른 서명 URL 과 같은 1시간. */
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
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

  // 권한: 프로필 사진은 사내 직원끼리 열람하는 것이 정상이므로 '인증된 직원' 이면 허용한다.
  // RLS 에 의존하지 않도록 service role 로 caller 가 실제 engineers 행인지 명시적으로 확인한다.
  const { data: caller } = await supabaseAdmin
    .from('engineers')
    .select('engineer_id')
    .eq('email', user.email!)
    .single()
  if (!caller) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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
      actor_email: user.email, action: 'READ', table_name: PROFILE_BUCKET, row_id: safePath,
    })
  } catch { /* best-effort */ }

  // 만료 시각을 함께 준다 — 화면의 캐시(hooks/useAvatarUrl.ts)가 이 값을 보고 다시 받는다.
  return NextResponse.json({ signedUrl: data.signedUrl, expiresIn: SIGNED_URL_TTL })
}
