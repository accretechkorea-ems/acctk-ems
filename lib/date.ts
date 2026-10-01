// 날짜 계산 공용 유틸. 이 시스템의 「오늘」은 언제나 한국(Asia/Seoul) 기준이다.
//
// 왜 필요한가 —
//   · new Date().toISOString().slice(0, 10) 은 UTC 날짜라, 한국 시간 00:00~09:00 에는
//     어제 날짜가 나온다. 한국에서 아침에 써도 하루가 밀린다.
//   · new Date().getFullYear()/getMonth()/getDate() 는 브라우저 시간대를 따라
//     한국 밖에서 열면 어긋난다. 서버(Vercel)는 UTC 라 서버 계산도 같은 문제를 갖는다.
// 어느 쪽도 업무 날짜(방문일·견적일·퇴사일 …)의 기준이 될 수 없어, 한국으로 고정한다.
//
// ※ timestamptz 컬럼에 넣는 '시각 기록'(updated_at·closed_at 등)은 UTC 저장이 정상이므로
//    여기 함수를 쓰지 않는다. 이 파일은 'YYYY-MM-DD' 업무 날짜 전용이다.

/**
 * 오늘 날짜(한국 기준) 'YYYY-MM-DD'.
 * sv-SE 로케일이 곧 YYYY-MM-DD 형식이라 따로 조립하지 않는다.
 */
export const todayKST = (): string =>
  new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })

/**
 * 'YYYY-MM-DD' 두 날짜의 차이(일). to − from.
 * 형식이 아니면 0.
 *
 * UTC 로 환산해 재기 때문에 브라우저 시간대·서머타임과 무관하게 정확하다
 * (문자열 두 개를 비교할 뿐이라 시간대가 끼어들 이유가 없다).
 */
export function daysBetween(from: string, to: string): number {
  const a = parseYmd(from)
  const b = parseYmd(to)
  if (a === null || b === null) return 0
  return Math.round((b - a) / 86400000)
}

/**
 * 'YYYY-MM-DD' 에 일수를 더한 날짜. 음수면 과거로 간다.
 * 형식이 아니면 받은 값을 그대로 돌려준다.
 */
export function addDays(date: string, delta: number): string {
  const t = parseYmd(date)
  if (t === null) return date
  return new Date(t + delta * 86400000).toISOString().slice(0, 10)
}

/** 'YYYY-MM-DD' → UTC 자정의 epoch ms. 형식이 아니면 null. */
function parseYmd(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? '').trim())
  if (!m) return null
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(t) ? null : t
}

/**
 * 지금(한국 기준)의 연·월·일. 월은 1~12.
 * '이번 달', '올해' 처럼 지금이 기준인 계산에 쓴다.
 */
export function nowKSTParts(): { y: number; m: number; d: number } {
  return ymdParts(todayKST())
}

/**
 * 어느 시각을 한국 기준 'YYYY-MM-DD' 로 읽는다.
 * timestamptz 문자열('…T17:00:00+00:00')이든 날짜 문자열('2026-04-01')이든 받는다.
 * 형식이 아니면 빈 문자열.
 */
export function kstYmd(at: Date | string): string {
  const d = at instanceof Date ? at : new Date(at)
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
}

/** 'YYYY-MM-DD' → { y, m, d }. 형식이 아니면 전부 NaN. */
export function ymdParts(s: string): { y: number; m: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? '').trim())
  if (!m) return { y: NaN, m: NaN, d: NaN }
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }
}

/**
 * 지금(한국 기준)의 시:분 'HH:MM'.
 * DB 의 time 컬럼('HH:MM:SS')과 앞 5자리를 문자열로 그대로 비교하려고 초는 넣지 않는다.
 */
export const nowHmKST = (): string =>
  new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false })

/**
 * timestamptz 를 화면에 보여줄 'YYYY.MM.DD HH:MM'(한국 기준).
 *
 * 이 파일의 다른 함수와 달리 **표시 전용**이다 — 계산이나 저장에 쓰지 마라(머리말 참고).
 * 처리 시각처럼 「언제 눌렀나」를 분까지 보여 주는 자리에 쓴다. 초는 넣지 않는다.
 *
 * 시간대를 toLocaleString 에 못 박으므로 브라우저·서버(UTC)의 로컬 시간대와 무관하다.
 * 손으로 +9시간을 더하지 않는 이유는 같은 파일의 todayKST·kstYmd·nowHmKST 와 방식을 맞추기
 * 위해서다 — 「한국 시간」 규칙이 파일 안에서 두 갈래로 갈리면 나중에 한쪽만 고치게 된다.
 * sv-SE 로케일이 'YYYY-MM-DD HH:MM:SS' 라 점 표기로 바꾸고 초만 떼면 된다.
 *
 * 값이 없거나 형식이 아니면 빈 문자열 — 부르는 쪽이 '기록 없음' 같은 자리표시를 고른다.
 */
export function kstStamp(at: Date | string | null | undefined): string {
  if (at === null || at === undefined || at === '') return ''
  const d = at instanceof Date ? at : new Date(at)
  if (isNaN(d.getTime())) return ''
  const s = d.toLocaleString('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
  // 'YYYY-MM-DD HH:MM' → 'YYYY.MM.DD HH:MM'. 날짜 쪽 하이픈만 바꾼다.
  return s.replace(/^(\d{4})-(\d{2})-(\d{2})/, '$1.$2.$3')
}
