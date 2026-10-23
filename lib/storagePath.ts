// 스토리지에 저장된 **주소 또는 경로**에서 버킷 안의 경로만 뽑는다.
//
// 이 저장소에는 「업로드한 뒤 getPublicUrl() 로 만든 공개 주소를 그대로 DB 에 넣는」 자리가
// 여럿 있었다. 버킷이 비공개가 되면 그 주소는 열리지 않는다(프로필 사진이 그래서 1년 가까이
// 깨져 있었다 — 2026-10-23 확인: HTTP 400).
//
// 고치는 방식은 하나다 — **저장은 경로만, 보여 줄 때 서명 URL**. 다만 지난 행에는 공개 주소가
// 남아 있으므로 **읽을 때 경로로 바꿔** 받아들인다(DB 를 고치지 않는다).
//
// 이 파일은 그 변환만 한다. 버킷마다 같은 일을 다시 쓰지 않으려고 따로 두었다
// (lib/profileImage.ts · lib/deviceImage.ts 가 쓴다).
//
// 순수 함수만 둔다 — 하네스가 그대로 돌린다.

/**
 * 저장된 값 → 버킷 안의 경로.
 *
 * 세 가지가 들어올 수 있다.
 *   · 경로만 — 지금 저장하는 꼴. 그대로 돌려준다.
 *   · 공개 주소 — `…/storage/v1/object/public/<버킷>/<파일>`
 *   · 서명 주소 — `…/object/sign/<버킷>/<파일>?token=…` · `…/render/image/sign/<버킷>/<파일>?width=…`
 *
 * 다른 버킷의 주소나 우리 것이 아닌 주소는 **null** 이다 — 쓸 수 없는 값을 경로인 척
 * 넘기면 라우트가 엉뚱한 파일을 서명하려 든다.
 *
 * 경로에 `/` 가 섞여 있으면 마지막 조각만 남긴다. 지금 세 버킷 모두 평평하게 올리고,
 * 라우트도 `/` 없는 이름만 받는다.
 */
export function storageObjectPath(stored: string | null | undefined, bucket: string): string | null {
  const s = (stored ?? '').trim()
  if (!s) return null
  const marker = `/${bucket}/`
  const at = s.indexOf(marker)
  let rest = at >= 0 ? s.slice(at + marker.length) : s
  rest = rest.split('?')[0].split('#')[0]
  // 주소인데 우리 버킷 이름이 없으면 다른 데 것이다.
  if (at < 0 && /^https?:\/\//i.test(rest)) return null
  const name = rest.split('/').filter(Boolean).pop() ?? ''
  if (!name) return null
  try { return decodeURIComponent(name) } catch { return name }
}

/** 라우트가 받아도 되는 이름인가 — 글자·숫자·점·밑줄·붙임표만. */
export function isSafeStorageName(name: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(name) && !name.includes('..')
}
