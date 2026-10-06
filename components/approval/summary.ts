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
  // 삭제는 되돌릴 수 없다 — 결재자가 무엇을 지우는지(번호·고객사·금액·실적 담당자),
  // 왜 지우는지, 반려하면 어디로 돌아가는지를 한 화면에서 볼 수 있어야 한다.
  quote_delete: [
    { key: 'quoteNumber', label: '견적번호' },
    { key: 'customer', label: '고객사' },
    { key: 'amount', label: '공급가', money: true },
    { key: 'engineer', label: '실적 담당자' },
    { key: 'reason', label: '삭제 사유' },
    { key: 'restoreStatus', label: '반려 시 복원될 상태' },
  ],
}

/**
 * 사람에게 보여 주지 않는 칸. 요약에는 화면용 값만 있는 게 아니라 되돌리기에 쓰는 값도 섞여 있다
 * (견적 삭제의 restoreFailReason — '실패' 로 돌아갈 때만 살릴 미수주 사유).
 * 이런 칸은 「모르는 칸은 그대로 보여 준다」 규칙에서 빼지 않으면 열쇠 이름이 날것으로 노출된다.
 */
const HIDDEN = new Set([
  // 견적 삭제 — '실패' 로 돌아갈 때만 살릴 미수주 사유.
  'restoreFailReason',
  // 견적서 — 후처리가 읽는 값이다(lib/approval/quoteApproval.ts).
  //   restore_status 는 결재가 끝난 뒤 돌아갈 상태이고, 결재자가 판단할 재료가 아니다
  //   (견적 삭제의 「반려 시 복원될 상태」와 달리 상신 전 상태로 되돌아가는 것이 전부다).
  //   quote_type·quote_number 는 각각 국내수리 판정과 알림 문구용이고, 번호는 문서번호로 이미 보인다.
  'restore_status', 'quote_type', 'quote_number',
])

/** 목록 한 줄에 넣을 칸 수 상한. 상세(summaryRows)는 등록된 칸을 모두 보여 준다. */
const LINE_MAX = 3

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
    // 등록된 칸이 많아도 한 줄에는 앞에서 셋까지만 — 목록이 한 건으로 길어지지 않게 한다.
    return fields
      .map(f => text(summary[f.key], f.money))
      .filter(Boolean)
      .slice(0, LINE_MAX)
      .join(' · ')
  }
  // 등록되지 않은 유형 — 값이 있는 칸을 앞에서 셋까지.
  return Object.entries(summary)
    .filter(([k, v]) => !HIDDEN.has(k) && v != null && v !== '')
    .slice(0, LINE_MAX)
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
    .filter(([k, v]) => !used.has(k) && !HIDDEN.has(k) && v != null && v !== '')
    .map(([k, v]) => ({ label: k, value: text(v) }))
  return [...known, ...rest]
}
