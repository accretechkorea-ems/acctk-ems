// 문서 요약(summary jsonb) 을 화면 글자로 바꾼다.
//
// 설계 원칙상 갈리는 곳은 화면뿐이다 — 엔진·라우트에는 유형 분기가 없고, 유형별 표시는 여기 모은다.
// 등록되지 않은 열쇠가 들어와도 깨지지 않게, 모르는 유형·모르는 칸은 그대로 「이름: 값」으로 보여준다.

type Summary = Record<string, unknown>

/** 유형별로 목록 한 줄에 요약으로 뽑을 칸과 그 이름. 위에서부터 있는 것만 쓴다. */
const FIELDS: Record<string, { key: string; label: string; money?: boolean }[]> = {
  quote: [
    { key: 'customer', label: '고객사' },
    { key: 'amount', label: '금액', money: true },
    { key: 'engineer', label: '작성자' },
  ],
  showroom_usage: [
    { key: 'device', label: '장비' },
    { key: 'period', label: '기간' },
    { key: 'purpose', label: '목적' },
  ],
  quote_delete: [
    { key: 'quoteNumber', label: '견적번호' },
    { key: 'customer', label: '고객사' },
    { key: 'reason', label: '사유' },
  ],
}

const won = (v: unknown): string => {
  const n = Number(v)
  return Number.isFinite(n) ? `${n.toLocaleString('ko-KR')}원` : String(v)
}

const text = (v: unknown, money?: boolean): string => {
  if (v == null || v === '') return ''
  if (money) return won(v)
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** 목록 한 줄에 붙일 짧은 요약. 없으면 빈 문자열. */
export function summaryLine(docType: string, summary: Summary | null | undefined): string {
  if (!summary) return ''
  const fields = FIELDS[docType]
  if (fields) {
    return fields
      .map(f => text(summary[f.key], f.money))
      .filter(Boolean)
      .join(' · ')
  }
  // 등록되지 않은 유형 — 값이 있는 칸을 앞에서 셋까지.
  return Object.entries(summary)
    .filter(([, v]) => v != null && v !== '')
    .slice(0, 3)
    .map(([, v]) => text(v))
    .join(' · ')
}

/** 상세에서 보여줄 「이름 : 값」 목록. 등록된 칸을 먼저, 나머지는 뒤에 붙인다. */
export function summaryRows(docType: string, summary: Summary | null | undefined): { label: string; value: string }[] {
  if (!summary) return []
  const fields = FIELDS[docType] ?? []
  const used = new Set(fields.map(f => f.key))
  const known = fields
    .map(f => ({ label: f.label, value: text(summary[f.key], f.money) }))
    .filter(r => r.value !== '')
  const rest = Object.entries(summary)
    .filter(([k, v]) => !used.has(k) && v != null && v !== '')
    .map(([k, v]) => ({ label: k, value: text(v) }))
  return [...known, ...rest]
}
