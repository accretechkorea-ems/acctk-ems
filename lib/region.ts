// 지역(시도) — **정본은 17개 약칭 하나뿐**이다.
//
// ── 왜 한곳에 두는가 ───────────────────────────────────────────────────────
//   `customers.region1` 에는 「경남」 같은 약칭과 「남부」·「중부」 같은 사내 구역이
//   섞여 있었고, 비어 있는 줄은 화면이 **주소 첫 토큰을 그대로** 써서 필터에
//   「경기도」·「강원특별자치도」·「갈산리」가 칩으로 떴다(2026-11-19 실측).
//   값을 만들어 내는 자리가 셋(등록·수정, 리드 전환, 화면의 주소 추출)이라 각자 다른
//   규칙을 쓰면 또 갈린다. 그래서 **들어오는 값은 전부 이 함수를 지난다.**
//
// ── 규칙 ──────────────────────────────────────────────────────────────────
//   · 정본은 아래 REGIONS 17개. 그 밖의 값은 **버린다**(null) — 틀린 값을 남겨 두면
//     필터가 그 값을 칩으로 만들어 또 늘어난다.
//   · 주소에서 뽑을 때는 **첫 토막**만 본다. 「갈산리 437-7」처럼 시도로 시작하지 않는
//     주소는 알 길이 없으므로 null 이다(화면은 「없음」으로 묶는다).
//   · 저장된 값이 정본이면 그대로 둔다 — 주소보다 사람이 적은 값이 우선이다.
//
// db/region1_normalize_20261119.sql 이 **같은 매핑표**로 저장된 값을 맞춘다.
// 한쪽만 고치면 조용히 갈리므로 둘을 함께 고친다.

/** 정본 17개 시도 약칭. 필터 목록도 이 순서 그대로다(행정 순서). */
export const REGIONS = [
  '서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종',
  '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주',
] as const

export type Region = typeof REGIONS[number]

/** 지역이 없는 줄을 필터에서 부르는 이름. */
export const NO_REGION = '없음'

const SET = new Set<string>(REGIONS)

/**
 * 긴 이름·옛 이름 → 약칭. 주소 첫 토막과 저장된 값 둘 다 이 표를 지난다.
 * (「남부」·「중부」 같은 사내 구역은 **여기 없다** — 시도가 아니므로 버려진다.)
 */
const SIDO_MAP: Record<string, Region> = {
  서울특별시: '서울', 서울시: '서울', 서울: '서울',
  부산광역시: '부산', 부산시: '부산', 부산: '부산',
  대구광역시: '대구', 대구시: '대구', 대구: '대구',
  인천광역시: '인천', 인천시: '인천', 인천: '인천',
  광주광역시: '광주', 광주시: '광주', 광주: '광주',
  대전광역시: '대전', 대전시: '대전', 대전: '대전',
  울산광역시: '울산', 울산시: '울산', 울산: '울산',
  세종특별자치시: '세종', 세종시: '세종', 세종: '세종',
  경기도: '경기', 경기: '경기',
  강원특별자치도: '강원', 강원도: '강원', 강원: '강원',
  충청북도: '충북', 충북: '충북',
  충청남도: '충남', 충남: '충남',
  전북특별자치도: '전북', 전라북도: '전북', 전북: '전북',
  전라남도: '전남', 전남: '전남',
  경상북도: '경북', 경북: '경북',
  경상남도: '경남', 경남: '경남',
  제주특별자치도: '제주', 제주도: '제주', 제주: '제주',
}

/** 한 토막을 약칭으로. 표에 없으면 null. */
export function regionOfToken(token: string | null | undefined): Region | null {
  const t = (token ?? '').trim()
  if (!t) return null
  return SIDO_MAP[t] ?? (SET.has(t) ? (t as Region) : null)
}

/**
 * **저장할 지역1** — 적혀 있던 값이 정본이면 그대로, 아니면 주소 첫 토막에서 뽑는다.
 * 둘 다 안 되면 null 이다(「남부」처럼 시도가 아닌 값은 여기서 사라진다).
 */
export function normalizeRegion(
  region: string | null | undefined,
  address?: string | null,
): Region | null {
  const own = regionOfToken(region)
  if (own) return own
  const first = (address ?? '').trim().split(/\s+/)[0]
  return regionOfToken(first)
}

/** 화면에 찍는 글자 — 없으면 「없음」. */
export const regionLabel = (region: string | null | undefined): string =>
  normalizeRegion(region) ?? NO_REGION

/** 필터가 거는 값 — 정본이면 그 값, 아니면 「없음」. 칩 목록과 같은 어휘를 쓴다. */
export const regionKey = (
  region: string | null | undefined,
  address?: string | null,
): string => normalizeRegion(region, address) ?? NO_REGION

/** 필터 칩의 고정 목록 — 데이터에 무엇이 들어 있든 늘 같다(17 + 없음). */
export const REGION_FILTER_OPTIONS: readonly string[] = [...REGIONS, NO_REGION]
