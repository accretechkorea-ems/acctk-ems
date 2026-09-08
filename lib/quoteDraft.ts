// 견적 작성 중 내용의 임시저장(자동 복원). localStorage 에 계정당 한 벌만 둔다.
//
// 왜 localStorage 인가 —
//   브라우저를 닫았다 켜도 남아야 해서(sessionStorage 는 탭을 닫으면 사라진다).
//   작성 중인 초안은 남에게 보일 이유가 없고 서버에 남길 필요도 없어 DB 를 쓰지 않는다.
//
// 왜 계정별 키인가 —
//   한 PC 를 여러 사람이 쓰는 자리가 있다. 키에 engineer_id 를 넣어 남의 작성분이 보이지 않게 한다.
//
// ※ 대필(onBehalf)은 **id 만** 담는다. 저장된 객체를 그대로 믿으면 localStorage 를 고쳐
//    남의 실적으로 견적을 만들 수 있다. 복원할 때 서버(resolveOnBehalf)에 다시 물어본다.

import type { CustomerResult, QuoteRow } from '@/app/quote/types'

/** 저장 형식 버전. QuoteRow 필드가 바뀌면 올린다 — 옛 저장분은 조용히 버려진다. */
export const DRAFT_VERSION = 1

const KEY = (engineerId: number) => `quote:draft:${engineerId}`

export type QuoteDraft = {
  v: number
  savedAt: string            // ISO. 안내 문구에 "언제 쓰던 것인지" 를 보여주는 데 쓴다.
  onBehalfId: number | null  // 객체가 아니라 id. 복원 시 서버 재검증 대상.
  company: string
  customerId: number | null
  selectedCustomer: CustomerResult | null
  customerQuery: string
  isDealer: boolean
  euCustomerId: number | null
  selectedEU: CustomerResult | null
  euQuery: string
  opportunityId: number | null
  receiver: string
  delivery: string
  remarks: string
  showSignature: boolean
  rows: QuoteRow[]
}

/**
 * 저장할 내용이 있는지. 아무것도 안 건드린 빈 화면은 저장하지 않는다
 * (그러지 않으면 견적 화면을 열기만 해도 "작성 중이던 내용이 있습니다" 가 뜬다).
 */
export function isDraftMeaningful(d: Omit<QuoteDraft, 'v' | 'savedAt'>): boolean {
  if (d.company.trim() || d.customerQuery.trim() || d.receiver.trim() || d.delivery.trim()) return true
  if (d.customerId != null || d.euCustomerId != null || d.opportunityId != null) return true
  if (d.showSignature || d.isDealer) return true
  return d.rows.some(r =>
    r.itemText.trim() || r.partCode.trim() || r.selectedItem
    || r.manual_cost_jpy > 0 || r.manual_unit_price > 0
    || r.subLines.some(l => l.trim())
    || r.expenses.length > 0)
}

export function saveDraft(engineerId: number, draft: Omit<QuoteDraft, 'v' | 'savedAt'>): void {
  try {
    const payload: QuoteDraft = { ...draft, v: DRAFT_VERSION, savedAt: new Date().toISOString() }
    localStorage.setItem(KEY(engineerId), JSON.stringify(payload))
  } catch { /* 용량 초과·비공개 모드 등. 저장 못 해도 작성은 계속돼야 한다 */ }
}

/** 저장분 읽기. 없거나 형식이 다르면(버전 불일치·깨짐) null 을 주고 조용히 버린다. */
export function loadDraft(engineerId: number): QuoteDraft | null {
  try {
    const raw = localStorage.getItem(KEY(engineerId))
    if (!raw) return null
    const d = JSON.parse(raw) as QuoteDraft
    if (!d || d.v !== DRAFT_VERSION || !Array.isArray(d.rows)) { clearDraft(engineerId); return null }
    return d
  } catch { clearDraft(engineerId); return null }
}

export function clearDraft(engineerId: number): void {
  try { localStorage.removeItem(KEY(engineerId)) } catch { /* 무시 */ }
}

/** '9월 8일 14:30' — 안내 문구용. 형식이 이상하면 빈 문자열. */
export function draftSavedLabel(savedAt: string): string {
  const d = new Date(savedAt)
  if (isNaN(d.getTime())) return ''
  const s = d.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  })
  return s
}
