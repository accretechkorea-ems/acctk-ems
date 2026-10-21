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
import type { Terms } from '@/lib/quoteTerms'

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
  /**
   * 옛 초안의 **납기** — 더 이상 저장하지 않는다(화면에 칸이 없다). 읽을 때만 쓴다:
   * 값이 있고 납품일정이 기본값이면 납품일정으로 올린다(promoteLegacyDelivery).
   */
  delivery?: string
  remarks: string
  showSignature: boolean
  /**
   * 조건 네 줄 — **선택 필드**다. 옛 초안에는 없으므로 복원하는 쪽이 없으면 기본으로 둔다
   * (버전을 올리지 않는 이유 — 올리면 작성 중이던 옛 초안이 통째로 버려진다).
   *   termsOpen  — 「조건 변경」 체크 상태
   *   terms      — 그때 적어 둔 네 값(접힌 상태로 저장돼도 값은 남는다)
   */
  termsOpen?: boolean
  terms?: Terms
  /**
   * 견적 분류(quotes.category) — **선택 필드**다. 옛 초안에는 없으므로 복원하는 쪽이 없으면
   * 빈 글자(미선택)로 둔다(버전을 올리지 않는 이유는 위 terms 와 같다).
   * 줄별 분류는 rows 안에 들어 있어 따로 담지 않는다.
   *
   * isDraftMeaningful 에는 **넣지 않는다** — 분류는 화면을 열고 가장 먼저 고르는 값이라,
   * 이것만으로 「작성 중이던 내용」을 만들면 들어왔다 나가기만 해도 다음 방문에 안내가 뜬다.
   */
  category?: string
  /** 견적서 양식 — 분류와 같은 **선택 필드**다. 줄 묶음은 rows 안에 들어 있다. */
  formKind?: string
  rows: QuoteRow[]
}

/**
 * 저장할 내용이 있는지. 아무것도 안 건드린 빈 화면은 저장하지 않는다
 * (그러지 않으면 견적 화면을 열기만 해도 "작성 중이던 내용이 있습니다" 가 뜬다).
 */
export function isDraftMeaningful(d: Omit<QuoteDraft, 'v' | 'savedAt'>): boolean {
  if (d.company.trim() || d.customerQuery.trim() || d.receiver.trim()) return true
  if (d.customerId != null || d.euCustomerId != null || d.opportunityId != null) return true
  if (d.showSignature || d.isDealer) return true
  // 조건을 손댔으면 「작성 중이던 내용」이다.
  if (d.termsOpen) return true
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
    // 뒤에 더한 줄 칸은 **없으면 기본값으로 채운다.** 버전을 올리면 작성 중이던 옛 초안이
    // 통째로 버려지고, 그대로 두면 undefined 가 입력칸에 들어가 React 가 제어를 놓친다.
    //   manual_model — 수동입력 줄의 모델(2026-10-21 추가).
    return { ...d, rows: d.rows.map(r => ({ ...r, manual_model: typeof r.manual_model === 'string' ? r.manual_model : '' })) }
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
