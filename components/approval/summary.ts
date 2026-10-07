// 문서 요약(summary jsonb) 을 화면 글자로 바꾼다.
//
// 설계 원칙상 갈리는 곳은 화면뿐이다 — 엔진·라우트에는 유형 분기가 없고, 유형별 표시는 여기 모은다.
// 등록되지 않은 열쇠가 들어와도 깨지지 않게, 모르는 유형·모르는 칸은 그대로 「이름: 값」으로 보여준다.

type Summary = Record<string, unknown>

export type SummaryRow = { label: string; value: string }

type Field = { key: string; label: string; money?: boolean }

/**
 * 유형별 등록. 두 가지 방식을 쓴다.
 *   fields — 「열쇠 → 라벨」이 1:1 인 유형. 등록되지 않은 열쇠는 아래 규칙대로 날것으로 붙는다.
 *   rows   — 요약을 통째로 읽어 줄을 직접 만드는 유형. 요약이 **중첩되어 있어**(쇼룸의 payload)
 *            열쇠 하나에 라벨 하나를 붙이는 방식으로는 읽을 수 있는 표가 되지 않는 경우다.
 *            rows 가 있으면 그 유형은 **적어 둔 줄만** 보여 준다(모르는 열쇠를 날것으로 붙이지 않는다).
 */
type Entry = { fields?: Field[]; rows?: (summary: Summary) => SummaryRow[] }

const FIELDS: Record<string, Entry> = {
  quote: {
    fields: [
      { key: 'customer', label: '고객사' },
      { key: 'amount', label: '금액', money: true },
      { key: 'engineer', label: '작성자' },
    ],
  },
  // 쇼룸 사용 신청 — 요약 안에 신청 내용 전부가 payload 로 한 번 더 들어 있다
  // (lib/approval/showroomUsage.ts 의 buildSummary). 그래서 줄을 직접 만든다.
  showroom_usage: { rows: s => showroomRows(s) },
  // 삭제는 되돌릴 수 없다 — 결재자가 무엇을 지우는지(번호·고객사·금액·실적 담당자),
  // 왜 지우는지, 반려하면 어디로 돌아가는지를 한 화면에서 볼 수 있어야 한다.
  quote_delete: {
    fields: [
      { key: 'quoteNumber', label: '견적번호' },
      { key: 'customer', label: '고객사' },
      { key: 'amount', label: '공급가', money: true },
      { key: 'engineer', label: '실적 담당자' },
      { key: 'reason', label: '삭제 사유' },
      { key: 'restoreStatus', label: '반려 시 복원될 상태' },
    ],
  },
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

// ── 쇼룸 사용 신청 ──────────────────────────────────────────────────
//
// 요약의 모양(lib/approval/showroomUsage.ts 의 buildSummary):
//   { device, usage, purpose, customer, kind, is_retroactive, usage_id, pdf_url, payload: {…신청 내용 전부} }
// payload 는 「엔진이 원 테이블을 읽지 않으므로 담아 둔 것」이라 사람이 읽을 요약이 아니다.
// 그대로 두면 결재자 화면에 payload 가 JSON 통째로, usage_id·pdf_url·is_retroactive 가 열쇠
// 이름 그대로 나온다. 그래서 **보여 줄 줄을 적어 둔다.**
//
// 적어 둔 줄만 보여 준다 — 새 열쇠가 payload 에 생겨도 결재자 화면에 날것으로 새지 않는다.
// 옛 문서는 열쇠가 일부 없다(purpose·note 는 2026-09-21 이전 신청에 없다). 없으면 그 줄을 건너뛴다.
//
// 숨기는 것: payload 통째 · pdf_url · usage_id · is_retroactive · request_no(문서번호와 같은 값이다 —
// 상신 라우트가 request_no 를 docNo 로 쓴다, app/api/showroom/requests/route.ts:121) ·
// device_id·customer_id·engineer_ids 같은 id 류 · 빈 값.

/** payload 를 안전하게 읽는다. 객체면 그대로, JSON 문자열이면 파싱, 아니면 null(그 줄들만 생략). */
function readPayload(v: unknown): Summary | null {
  if (v == null) return null
  if (typeof v === 'object') return Array.isArray(v) ? null : (v as Summary)
  if (typeof v !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(v)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Summary) : null
  } catch {
    // 깨진 JSON — payload 에서 오는 줄만 빠지고 위쪽 요약(장비·일시·목적)은 그대로 나온다.
    return null
  }
}

/** 비어 있지 않은 문자열로 다듬는다. 없으면 null. */
const str = (v: unknown): string | null => {
  if (v == null) return null
  const s = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : ''
  return s === '' ? null : s
}

/** 첫 번째로 값이 있는 것. 옛 문서에서 윗 칸이 비면 payload 에서 줍는다. */
const firstOf = (...vs: unknown[]): string | null => {
  for (const v of vs) {
    const s = str(v)
    if (s !== null) return s
  }
  return null
}

/** 「2026-10-07 09:00~12:00」 — 저장된 문자열을 그대로 쓴다(날짜를 다시 계산하지 않는다). */
function usageText(s: Summary, p: Summary | null): string | null {
  const shown = str(s.usage)
  if (shown) return shown
  // 옛 문서나 usage 가 빠진 문서 — buildSummary 와 같은 방식으로 payload 에서 짠다.
  const date = str(p?.usage_date)
  if (!date) return null
  const from = str(p?.start_time)?.slice(0, 5)
  const to = str(p?.end_time)?.slice(0, 5)
  return from && to ? `${date} ${from}~${to}` : date
}

/** 「사전 신청」/「사후 신청」. kind 가 없는 옛 문서는 is_retroactive 로 고른다. */
function kindText(s: Summary, p: Summary | null): string | null {
  const shown = str(s.kind)
  if (shown) return shown
  const flag = s.is_retroactive ?? p?.is_retroactive
  if (typeof flag !== 'boolean') return null
  return flag ? '사후 신청' : '사전 신청'
}

/** 참여자 — payload.engineer_names 를 쉼표로. 배열이 아니면 문자열로 본다. */
function engineersText(p: Summary | null): string | null {
  const v = p?.engineer_names
  if (Array.isArray(v)) {
    const names = v.map(str).filter((n): n is string => n !== null)
    return names.length > 0 ? names.join(', ') : null
  }
  return str(v)
}

/**
 * 쇼룸 사용 신청의 요약 줄. **값이 있는 줄만** 이 순서로.
 * 순수 함수다 — 네트워크·DOM 을 쓰지 않아 스크립트로 그대로 돌려 볼 수 있다.
 */
export function showroomRows(summary: Summary | null | undefined): SummaryRow[] {
  if (!summary) return []
  const p = readPayload(summary.payload)
  const rows: SummaryRow[] = []
  const put = (label: string, value: string | null) => { if (value !== null) rows.push({ label, value }) }

  put('신청 구분', kindText(summary, p))
  put('장비', firstOf(summary.device, p?.device_name))
  const customer = firstOf(summary.customer, p?.customer_name)
  put('고객사', customer)
  put('사용 일시', usageText(summary, p))
  put('목적', firstOf(summary.purpose, p?.purpose))
  put('참여자', engineersText(p))
  // 현장(설치위치)은 고객사와 같은 글자일 때가 많다 — 다를 때만 알린다.
  const site = str(p?.site_name)
  if (site !== null && site !== customer) put('현장', site)
  put('프로젝트', str(p?.project_name))
  put('내용', str(p?.content))
  put('비고', str(p?.note))
  put('샘플 자재', str(p?.sample_material))
  // 외부 반출은 **그렇다고 할 때만** 알린다 — 「아니오」는 평소 상태라 줄만 늘린다.
  // 반출이 걸린 건은 결재자가 따로 볼 것이 있어 한 줄을 쓸 값이 있다.
  if (p?.carried_out === true) put('외부 반출', '예')
  put('NDA', str(p?.nda_status))
  put('예상 결과', str(p?.expected_result))
  // 금액만 천 단위 쉼표와 「원」을 붙인다.
  if (p?.expected_cost != null && p.expected_cost !== '') put('예상 비용', won(p.expected_cost))

  return rows
}

/** 목록 한 줄에 붙일 짧은 요약. 없으면 빈 문자열. */
export function summaryLine(docType: string, summary: Summary | null | undefined): string {
  if (!summary) return ''
  const entry = FIELDS[docType]
  // 줄을 직접 만드는 유형 — 그 줄의 앞에서 셋까지 값만 이어 붙인다.
  if (entry?.rows) return entry.rows(summary).slice(0, LINE_MAX).map(r => r.value).join(' · ')
  if (entry?.fields) {
    // 등록된 칸이 많아도 한 줄에는 앞에서 셋까지만 — 목록이 한 건으로 길어지지 않게 한다.
    return entry.fields
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
export function summaryRows(docType: string, summary: Summary | null | undefined): SummaryRow[] {
  if (!summary) return []
  const entry = FIELDS[docType]
  if (entry?.rows) return entry.rows(summary)
  const fields = entry?.fields ?? []
  const used = new Set(fields.map(f => f.key))
  const known = fields
    .map(f => ({ label: f.label, value: text(summary[f.key], f.money) }))
    .filter(r => r.value !== '')
  const rest = Object.entries(summary)
    .filter(([k, v]) => !used.has(k) && !HIDDEN.has(k) && v != null && v !== '')
    .map(([k, v]) => ({ label: k, value: text(v) }))
  return [...known, ...rest]
}
