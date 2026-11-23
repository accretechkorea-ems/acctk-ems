/**
 * 명함에서 읽은 글자를 **칸에 나눠 담는다** (2026-11-23).
 *
 * 글자를 읽는 일(tesseract.js)은 브라우저가 하고, 이 파일은 **그 결과 글자만** 받는다.
 * 그래서 사진이 없어도 돌릴 수 있고, 하네스가 샘플 글자로 규칙을 지킨다.
 *
 * ── 어떻게 나누나 ─────────────────────────────────────────────────────────
 * 줄 단위로 본다. 확실한 것부터 집어 가며 그 줄을 **쓴 것으로 표시**한다 —
 * 한 줄이 두 칸에 들어가지 않게.
 *   ① 이메일 · 홈페이지 — 모양이 뚜렷하다
 *   ② 팩스 → 휴대폰 → 전화 — 팩스를 먼저 집어야 전화로 새지 않는다
 *   ③ 주소 — 시·구·로·길이 들어간 줄
 *   ④ 직급 — 사전에 있는 낱말
 *   ⑤ 부서 — 팀·파트·실·부·그룹·본부로 끝나는 줄
 *   ⑥ 회사 — ㈜·(주)·Co.·Ltd·Inc 가 든 줄, 없으면 **가장 긴 남은 줄**
 *   ⑦ 이름 — 한글 2~4자만 있는 줄
 *
 * ── 못 읽은 칸은 비운다 ──────────────────────────────────────────────────
 * 억지로 채우지 않는다. 자동으로 채운 칸은 화면이 **파란 바탕 + 「사진에서 읽음 · 확인 필요」**
 * 띠로 표시하고, 사람이 보고 고친다.
 *
 * ── 뒷면 ─────────────────────────────────────────────────────────────────
 * 영문 뒷면은 한 번 더 읽어 **빈 칸만** 채운다(mergeBack) — 앞면 값을 덮지 않는다.
 */

import type { CardField } from './businessCard'

/** 자동으로 채운 칸의 안내. */
export const OCR_NOTICE = '사진에서 읽음 · 확인 필요'

/** 직급 사전 — 명함에 흔한 것부터. 긴 낱말을 먼저 둔다(「대표이사」가 「이사」로 잡히지 않게). */
export const POSITIONS = [
  '대표이사', '부사장', '전무이사', '상무이사', '본부장', '연구소장', '공장장',
  '팀장', '파트장', '실장', '그룹장', '센터장', '지점장', '소장',
  '회장', '사장', '전무', '상무', '이사', '부장', '차장', '과장', '대리', '주임', '사원',
  '책임', '선임', '수석', '프로', '매니저', '반장', '기장', '기사', '대표',
] as const

/** 부서 줄의 끝말. 영문 뒷면도 보므로 영어 꼬리도 둔다. */
const DEPT_TAILS = [
  '팀', '파트', '실', '부', '그룹', '본부', '센터', '지원실', '연구소',
  'Team', 'team', 'Dept', 'Dept.', 'Division', 'Group',
]

/** 회사 줄의 표시. */
const COMPANY_MARKS = ['㈜', '(주)', '（주）', '주식회사', '(유)', '㈲', 'Co.', 'Co,', 'Ltd', 'LTD', 'Inc', 'INC', 'Corp', 'CORP', 'GmbH']

/** 주소 줄의 표시. */
const ADDRESS_MARKS = ['시 ', '시,', '군 ', '구 ', '로 ', '길 ', '동 ', '읍 ', '면 ', '층', '번지', '단지', '산업단지', '테크노']

export type OcrFields = Partial<Record<CardField, string>>

/** 한 줄로 다듬는다 — 앞뒤 공백·가운뎃점·콜론을 턴다. */
const clean = (s: string) => s.replace(/[ \t]+/g, ' ').replace(/^[\s·:|/\-—]+|[\s·:|/\-—]+$/g, '').trim()

/** 읽은 글자를 줄로. 빈 줄과 글자 한 개짜리 줄은 버린다(잡티다). */
export function toLines(text: string): string[] {
  return String(text ?? '')
    .split(/\r?\n/)
    .map(clean)
    .filter(l => l.length >= 2)
}

/** 전화 꼴에서 번호만 — 「T. 02-1234-5678」 → 「02-1234-5678」. */
function numberIn(line: string): string | null {
  const m = line.match(/(\+?\d[\d\s().-]{7,})/)
  if (!m) return null
  const raw = m[1].trim().replace(/[\s().]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return raw.replace(/\D/g, '').length >= 8 ? raw : null
}

const hasAny = (line: string, marks: readonly string[]) => marks.some(m => line.includes(m))

/**
 * 읽은 글자 → 칸.
 * 집어 간 줄은 다시 쓰지 않는다(used). 못 집은 칸은 넣지 않는다(빈 칸으로 남는다).
 */
export function fieldsFromText(text: string): OcrFields {
  const lines = toLines(text)
  const used = new Set<number>()
  const out: OcrFields = {}
  const take = (i: number, field: CardField, value: string) => {
    if (out[field] != null) return
    const v = clean(value)
    if (!v) return
    out[field] = v
    used.add(i)
  }
  const free = () => lines.map((l, i) => [l, i] as const).filter(([, i]) => !used.has(i))

  // ① 이메일 · 홈페이지
  lines.forEach((l, i) => {
    const m = l.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)
    if (m) take(i, 'email', m[0])
  })
  lines.forEach((l, i) => {
    if (used.has(i)) return
    const m = l.match(/(https?:\/\/[^\s]+|www\.[^\s]+)/i)
    if (m) take(i, 'website', m[1])
  })

  // ② 팩스 → 휴대폰 → 전화. 팩스를 먼저 집어야 전화로 새지 않는다.
  lines.forEach((l, i) => {
    if (used.has(i)) return
    if (!/\b(fax|f)\s*[.:]/i.test(l) && !l.includes('팩스')) return
    const n = numberIn(l)
    if (n) take(i, 'fax', n)
  })
  lines.forEach((l, i) => {
    if (used.has(i)) return
    // 010-…(국내) · +82-10-…(영문 뒷면) · 「Mobile」·「M.」·「휴대폰」이 적힌 줄
    const kr = l.match(/01[016789][\s.-]?\d{3,4}[\s.-]?\d{4}/)
    if (kr) { take(i, 'mobile', kr[0].replace(/[\s.]/g, '-').replace(/-+/g, '-')); return }
    const intl = l.match(/\+82[\s.-]?10[\s.-]?\d{3,4}[\s.-]?\d{4}/)
    if (intl) { take(i, 'mobile', intl[0].replace(/[\s.]/g, '-').replace(/-+/g, '-')); return }
    if (/\b(mobile|cell|m)\s*[.:]/i.test(l) || l.includes('휴대폰') || l.includes('핸드폰')) {
      const n = numberIn(l)
      if (n) take(i, 'mobile', n)
    }
  })
  lines.forEach((l, i) => {
    if (used.has(i)) return
    if (out.phone != null) return
    const n = numberIn(l)
    if (n && /^(\+?82|0\d)/.test(n.replace(/\s/g, ''))) take(i, 'phone', n)
  })

  // ③ 주소
  for (const [l, i] of free()) {
    if (l.length >= 8 && hasAny(l, ADDRESS_MARKS)) { take(i, 'address', l); break }
  }

  // ④ 직급 — 사전에 있는 낱말. 그 줄에 이름이 함께 있으면 이름도 집는다.
  for (const [l, i] of free()) {
    const hit = POSITIONS.find(p => l.includes(p))
    if (!hit) continue
    take(i, 'position', hit)
    const rest = clean(l.replace(hit, ''))
    if (/^[가-힣]{2,4}$/.test(rest)) out.name ??= rest
    break
  }

  // ⑤ 부서
  for (const [l, i] of free()) {
    if (l.length <= 12 && DEPT_TAILS.some(t => l.endsWith(t))) { take(i, 'department', l); break }
  }

  // ⑥ 회사 — 표시가 있는 줄, 없으면 남은 줄 중 가장 긴 것
  let company: number | null = null
  for (const [l, i] of free()) {
    if (hasAny(l, COMPANY_MARKS)) { company = i; break }
  }
  if (company == null) {
    const rest = free().filter(([l]) => !/^[가-힣]{2,4}$/.test(l))
    if (rest.length > 0) company = rest.reduce((a, b) => (b[0].length > a[0].length ? b : a))[1]
  }
  if (company != null) take(company, 'company', lines[company])

  // ⑦ 이름 — 한글 2~4자만 있는 줄
  if (out.name == null) {
    for (const [l, i] of free()) {
      if (/^[가-힣]{2,4}$/.test(l)) { take(i, 'name', l); break }
    }
  }
  return out
}

/**
 * 뒷면을 한 번 더 읽어 **빈 칸만** 채운다. 앞면 값은 덮지 않는다 —
 * 뒷면은 보통 영문이라 덮으면 한글 이름이 사라진다.
 */
export function mergeBack(front: OcrFields, back: OcrFields): OcrFields {
  const out: OcrFields = { ...front }
  for (const [k, v] of Object.entries(back) as [CardField, string][]) {
    if (!v) continue
    if (out[k] == null || String(out[k]).trim() === '') out[k] = v
  }
  return out
}

/** 자동으로 채운 칸 이름들 — 화면이 그 칸만 파랗게 칠한다. */
export function filledFields(f: OcrFields): CardField[] {
  return (Object.keys(f) as CardField[]).filter(k => String(f[k] ?? '').trim() !== '')
}

// ── 사진은 서버로 가지 않는다 ─────────────────────────────────────────────
/**
 * 명함 사진은 **브라우저 메모리에서만** 쓴다. 올리는 길도 저장하는 곳도 만들지 않았다.
 * 개인정보를 모아 두지 않기 위해서다 — 남는 것은 사람이 확인한 **글자뿐**이다.
 * (scripts/business-card-check.js 가 「업로드 라우트 없음 · Storage 쓰기 없음」을 지킨다)
 */
export const PHOTO_IS_NEVER_STORED = true
