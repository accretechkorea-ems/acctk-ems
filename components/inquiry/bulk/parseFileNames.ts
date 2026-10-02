// ───────────────────────── TEMP-BULK-IMPORT ─────────────────────────
// 일괄 등록 전용. 지난 파일을 한 번에 넣고 나면 이 폴더째 지운다.
// 바깥에서 import 하는 곳을 늘리지 마라 — 지울 때 걸린다.
// ─────────────────────────────────────────────────────────────────────
//
// 파일 이름에서 의뢰서 번호를 찾아낸다. 순수 함수만 둔다(DOM·네트워크 없음).
//
// 왜 이름만 보는가 — 파일 내용은 올리기 전까지 읽지 않는다(수십 MB 를 미리보기 때문에 읽을 수
// 없다). 사람들이 파일명에 번호를 적어 두는 관행이 이미 있어서 그것으로 충분하다.
//
// 찾은 값으로 번호 문자열을 **직접 이어 붙이지 않는다**. 반드시 buildInquiryNo 를 거친다 —
// 자릿수(001)·접두(#PO-T4)·연도 자리는 그 함수 하나가 정하고, 여기서 또 정하면 두 벌이 된다.

import {
  buildInquiryNo, REQ80_SERIES, type InquiryType,
} from '@/lib/inquiries'

/** 파일 하나에서 찾은 번호 후보. */
export type Hit = {
  type: InquiryType
  seq: number
  /** 번호에 연도가 들어가는 종류만(req80·req20·claim·domestic_po). hq_repair·spare80 은 없다. */
  year?: number
  /** req80 만(81·83·84). */
  series?: string
  /** spare80 만. 'YYYY-MM-DD' — 번호에 박힌 날짜이자 발행일이다. */
  date?: string
  /** 이름에서 실제로 잡힌 조각. 사람이 「이게 왜 이 번호가 됐나」를 볼 때 쓴다. */
  matched: string
}

/**
 * 이름 정규화.
 *
 *   · NFKC — 전각(ＢＹ２６)과 반각을 한 모양으로 만든다. 일본에서 온 파일에 흔하다.
 *   · 하이픈 — 유니코드에는 '-' 처럼 보이는 글자가 여럿이다(‐‑‒–—―, 빼기 −, 전각 －).
 *     NFKC 가 전각만 처리하므로 나머지는 손으로 '-' 로 통일한다.
 *   · 구분자 — 밑줄·공백·괄호는 전부 공백으로 바꿔 경계로 쓴다. 그래야
 *     「…問合せ_022-K260930_RONDCOM…」에서 번호 앞뒤가 경계로 끊긴다.
 */
export function normalizeName(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/[‐-―−﹘﹣－]/g, '-')
    .replace(/[_()[\]{}]/g, ' ')
}

/**
 * 번호 조각의 앞뒤가 다른 글자에 붙어 있지 않은지 본다.
 *
 * \b 를 쓰지 않는 이유 — 자바스크립트의 \b 는 [A-Za-z0-9_] 만 낱말로 보아 한글·일본어
 * 앞뒤에서 엉뚱하게 경계로 잡힌다. 여기서 막고 싶은 것은 **숫자·영문에 붙은 우연한 일치**
 * 하나뿐이다(예: 'X239-00123' 의 239-0012). 그래서 그 두 가지만 직접 본다.
 */
const edgeOk = (s: string, start: number, end: number): boolean => {
  const before = start > 0 ? s[start - 1] : ''
  const after = end < s.length ? s[end] : ''
  return !/[0-9A-Za-z]/.test(before) && !/[0-9A-Za-z]/.test(after)
}

/** 'YYMMDD' 가 실제로 있는 날짜인가. 있으면 'YYYY-MM-DD', 아니면 null. */
export function yymmddToYmd(v: string): string | null {
  const m = /^(\d{2})(\d{2})(\d{2})$/.exec(v)
  if (!m) return null
  // 두 자리 연도는 2000년대로 읽는다 — 이 번호 체계가 그렇게 쓰이고 있다.
  const y = 2000 + Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, mo - 1, d))
  // 2월 30일 같은 값은 Date 가 다음 달로 넘겨 버린다 — 되읽어 같은지 확인한다.
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  const p = (n: number) => String(n).padStart(2, '0')
  return `${y}-${p(mo)}-${p(d)}`
}

/**
 * 종류별 패턴. 순서가 중요하다 — 더 긴 것(PO-T4-2026-001)을 먼저 본다.
 * 전부 대소문자를 무시한다(g 는 모든 자리를 훑기 위해, i 는 by/acctk 소문자 때문에).
 */
const PATTERNS: { type: InquiryType; re: RegExp; pick: (m: RegExpExecArray) => Omit<Hit, 'matched'> | null }[] = [
  {
    // #PO-T4-2026-001 / PO-T4-2026-001 — '#' 는 있어도 없어도 된다.
    type: 'domestic_po',
    re: /#?PO-T4-(\d{4})-(\d{3,})/gi,
    pick: m => ({ type: 'domestic_po', year: Number(m[1]), seq: Number(m[2]) }),
  },
  {
    // ACCTK26-001
    type: 'claim',
    re: /ACCTK(\d{2})-(\d{3,})/gi,
    pick: m => ({ type: 'claim', year: 2000 + Number(m[1]), seq: Number(m[2]) }),
  },
  {
    // BY26-81-001 / BY26-20-001 — 가운데 값으로 80·20 을 가른다.
    type: 'req80',
    re: /BY(\d{2})-(\d{2})-(\d{3,})/gi,
    pick: m => {
      const mid = m[2]
      const year = 2000 + Number(m[1])
      const seq = Number(m[3])
      if (REQ80_SERIES.includes(mid)) return { type: 'req80', year, seq, series: mid }
      if (mid === '20') return { type: 'req20', year, seq }
      return null
    },
  },
  {
    // 022-K260930 — 번호가 앞, 날짜가 뒤. 날짜가 실재해야 한다.
    type: 'spare80',
    re: /(\d{3,})-K(\d{6})/gi,
    pick: m => {
      const date = yymmddToYmd(m[2])
      return date ? { type: 'spare80', seq: Number(m[1]), date } : null
    },
  },
  {
    // 239-0001 — 연도가 없다. 네 자리 이상이라 다른 번호와 겹치지 않는다.
    type: 'hq_repair',
    re: /239-(\d{4,})/g,
    pick: m => ({ type: 'hq_repair', seq: Number(m[1]) }),
  },
]

/** 같은 번호를 가리키는 두 Hit 인가. 한 파일에서 같은 번호가 두 번 적힌 경우를 모호로 보지 않으려고. */
const sameHit = (a: Hit, b: Hit): boolean =>
  a.type === b.type && a.seq === b.seq && a.year === b.year && a.series === b.series && a.date === b.date

/**
 * 파일 이름에서 번호 후보를 전부 찾는다. 찾은 순서대로, 같은 번호는 한 번만.
 * 결과가 0개면 「미분류」, 2개 이상이면 「확인 필요(모호)」다 — 부르는 쪽이 판단한다.
 */
export function parseFileName(name: string): Hit[] {
  const s = normalizeName(name)
  const hits: Hit[] = []
  for (const p of PATTERNS) {
    // 정규식에 g 가 붙어 lastIndex 가 남는다. 매번 새로 만든다.
    const re = new RegExp(p.re.source, p.re.flags)
    let m: RegExpExecArray | null
    while ((m = re.exec(s)) !== null) {
      if (m[0].length === 0) { re.lastIndex += 1; continue }
      if (!edgeOk(s, m.index, m.index + m[0].length)) continue
      const got = p.pick(m)
      if (!got) continue
      const hit: Hit = { ...got, matched: m[0] }
      if (!hits.some(h => sameHit(h, hit))) hits.push(hit)
    }
  }
  return hits
}

/** Hit 하나를 실제 번호 문자열로. 형식·자릿수는 buildInquiryNo 가 정한다. */
export function hitToNo(hit: Hit): string {
  return buildInquiryNo(hit.type, {
    seq: hit.seq,
    // hq_repair·spare80 은 연도를 쓰지 않는다 — buildInquiryNo 가 무시한다.
    year: hit.year ?? (hit.date ? Number(hit.date.slice(0, 4)) : 0),
    series: hit.series ?? null,
    issuedDate: hit.date,
  })
}

/** 묶음 키 — 같은 번호의 파일을 한 행으로 모은다. 번호 문자열 자체를 키로 쓴다. */
export const hitKey = (hit: Hit): string => hitToNo(hit)

export type ParsedFile =
  | { kind: 'matched'; file: File; hit: Hit; no: string }
  | { kind: 'ambiguous'; file: File; hits: Hit[] }
  | { kind: 'unmatched'; file: File }

/** 파일 목록을 한 번에 분류한다. */
export function parseFiles(files: File[]): ParsedFile[] {
  return files.map(file => {
    const hits = parseFileName(file.name)
    if (hits.length === 0) return { kind: 'unmatched', file }
    if (hits.length > 1) return { kind: 'ambiguous', file, hits }
    return { kind: 'matched', file, hit: hits[0], no: hitToNo(hits[0]) }
  })
}
