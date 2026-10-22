// 스토리지 사진을 **화면에 필요한 폭만큼** 받는다.
//
// 쇼룸 장비 카드 여덟 장이 원본 그대로 내려와 한 화면에서 1.1MB 였다
// (default_SNEX040.png 한 장이 319KB — docs/perf/latest.md 의 쇼룸 항목).
// 카드는 240px 폭이라 그 화소가 쓰이지 않는다.
//
// Supabase 스토리지는 변환 주소를 따로 둔다.
//   원본  /storage/v1/object/public/<버킷>/<파일>
//   변환  /storage/v1/render/image/public/<버킷>/<파일>?width=240&quality=70
// 변환 쪽은 브라우저가 webp 를 받을 수 있다고 하면 webp 로 바꿔 준다 — 같은 사진이
// 319KB → 7.7KB 다(실측: 240px·quality 70).
//
// **원본이 필요한 자리는 그대로 둔다** — 확대·상세·PDF 는 thumbUrl 을 쓰지 않는다.

/** 변환을 걸 수 있는 주소인가 — 스토리지 공개 주소만 바꾼다(외부 주소·서명 주소는 그대로). */
const PUBLIC_MARK = '/storage/v1/object/public/'

/**
 * 목록 카드용 축소 주소.
 *
 * @param url   원본 주소(없으면 null 을 그대로 돌려준다)
 * @param width 받을 폭(px). 카드 폭에 맞춘다 — 그보다 크게 받아도 화면에서 쓰이지 않는다.
 */
export function thumbUrl(url: string | null | undefined, width = 240, quality = 70): string | null {
  if (!url) return null
  if (!url.includes(PUBLIC_MARK)) return url
  const [base, query] = url.split('?')
  const rendered = base.replace(PUBLIC_MARK, '/storage/v1/render/image/public/')
  // 원래 주소에 붙어 있던 질의(버전 꼬리표 등)는 지키고 뒤에 변환 값을 붙인다.
  const parts = [query, `width=${width}`, `quality=${quality}`, 'resize=contain'].filter(Boolean)
  return `${rendered}?${parts.join('&')}`
}
