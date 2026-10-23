// 프로필 사진 — **버킷 안의 경로만** 저장한다.
//
// 왜 경로만인가 — profile-images 버킷은 **비공개**다. 그런데 예전에는 업로드한 뒤
// getPublicUrl() 로 만든 공개 주소를 engineers.profile_image_url 에 넣었다. 비공개 버킷의
// 공개 주소는 열리지 않으므로(2026-10-23 확인: HTTP 400) 사진이 늘 깨져 있었다.
//
// 지금 규칙:
//   저장 — 파일 이름만(예: profile-20-1790139458648.jpg)
//   표시 — /api/profile-image 가 1시간 서명 URL 을 준다(hooks/useAvatarUrl.ts)
//
// 버킷을 공개로 바꾸는 쪽이 더 쉽지만 그러지 않았다 — 직원 얼굴 사진이라 주소만 알면
// 밖에서 열리는 상태가 된다(지금 device-images 가 그런 상태이고 docs/audit-2026-10.md 에
// 위험으로 적혀 있다). 같은 자리를 하나 더 만들 이유가 없다.

/** 사진이 사는 버킷. */
export const PROFILE_BUCKET = 'profile-images'

/** 업로드를 허용하는 형식. 화면과 라우트가 같은 목록을 본다. */
export const PROFILE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const

/** 5MB. */
export const PROFILE_IMAGE_MAX_BYTES = 5 * 1024 * 1024

/**
 * 표시 크기별로 받을 변환 폭. 라우트가 이 목록 안의 값만 받는다
 * (아무 숫자나 받으면 변환 캐시가 쓸데없이 갈라진다).
 */
export const AVATAR_WIDTHS = [80, 160, 320] as const
export type AvatarWidth = (typeof AVATAR_WIDTHS)[number]

/** css 크기 → 받을 변환 폭. 2배수로 올려 잡고(선명하게) 목록 안으로 맞춘다. */
export function avatarWidthFor(cssSize: number): AvatarWidth {
  const want = cssSize * 2
  return AVATAR_WIDTHS.find(w => w >= want) ?? AVATAR_WIDTHS[AVATAR_WIDTHS.length - 1]
}

/**
 * 저장된 값 → 버킷 안의 경로.
 *
 * 세 가지가 들어올 수 있다.
 *   · 경로만 — 지금 저장하는 꼴. 그대로 돌려준다.
 *   · 옛 공개 URL — `…/storage/v1/object/public/profile-images/<파일>`. 뒤를 떼어 쓴다.
 *   · 서명 URL — `…/object/sign/profile-images/<파일>?token=…`. 같은 방식으로 뗀다.
 *
 * **DB 를 고치지 않고 읽을 때 변환한다** — 옛 행이 하나뿐이라 UPDATE 를 돌릴 이유가 없고,
 * 돌리지 않아도 화면이 맞게 동작하는 쪽이 안전하다.
 *
 * 경로에 `/` 가 섞여 들어오면(폴더를 쓰게 되면) 마지막 조각만 남긴다 — 지금 업로드는
 * 버킷 루트에 평평하게 올리고, 라우트도 `/` 없는 이름만 받는다.
 */
export function profileImagePath(stored: string | null | undefined): string | null {
  const s = (stored ?? '').trim()
  if (!s) return null
  // 버킷 이름이 보이면 그 뒤가 경로다(공개·서명 어느 꼴이든).
  const marker = `/${PROFILE_BUCKET}/`
  const at = s.indexOf(marker)
  let rest = at >= 0 ? s.slice(at + marker.length) : s
  // 질의 문자열(서명 토큰 등)과 조각 식별자는 떼어 낸다.
  rest = rest.split('?')[0].split('#')[0]
  // 주소가 아닌데 http 로 시작하면 우리 버킷이 아니다 — 쓸 수 없다.
  if (at < 0 && /^https?:\/\//i.test(rest)) return null
  const name = rest.split('/').filter(Boolean).pop() ?? ''
  if (!name) return null
  try { return decodeURIComponent(name) } catch { return name }
}

/** 라우트가 받아도 되는 이름인가 — 글자·숫자·점·밑줄·붙임표만. */
export function isSafeProfileImageName(name: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(name) && !name.includes('..')
}

/**
 * 올릴 파일 이름. 사람마다 한 장이지만 이름에 시각을 넣는다 —
 * 같은 이름으로 덮으면 브라우저·CDN 이 옛 사진을 계속 보여 준다.
 */
export function profileImageFileName(engineerId: number, originalName: string, now: number): string {
  const ext = (originalName.split('.').pop() ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext) ? ext : 'jpg'
  return `profile-${engineerId}-${now}.${safeExt}`
}
