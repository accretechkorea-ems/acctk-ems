// 견적 관련 mutation(DB write / API 호출) 공용 모듈.
// 실적 현황(EngineerQuoteModal)과 개인 대시보드가 동일 로직을 공유하기 위한 것.
// 규칙: 순수하게 DB/API 호출만 한다. toast/refetch/UI state 는 호출부가 처리한다.
//   - 실패는 throw(상태 변경) 또는 반환값 { ok, error }(발주/세금)로 알린다.

import { createClient } from '@/lib/supabase/client'

export type MutationResult = { ok: boolean; error?: string }

export type UpdateQuoteStatusParams = {
  quoteId: number
  status: string
  /** 사유. 삭제 요청이면 delete_reason 에, 그 밖의 상태면 fail_reason 에 저장된다. */
  reason?: string
}

// 삭제 요청('취소요청')과 실패는 성격이 달라 사유를 다른 칸에 남긴다.
//   · '취소요청' → delete_reason 에 저장하고 fail_reason 은 건드리지 않는다.
//   · 그 밖의 상태 → 기존대로 fail_reason 에 저장하고, 남아 있던 삭제 사유는 지운다
//     (반려 후 되돌린 건에 옛 요청 사유가 남지 않게).
const reasonPatch = (status: string, reason?: string) =>
  status === '취소요청'
    ? { delete_reason: reason || null }
    : { fail_reason: reason || null, delete_reason: null }

// 견적 상태 변경(취소요청/실패 등). RLS 적용된 사용자 클라이언트로 직접 update.
// 실패 시 throw. (빈 문자열은 null 로 저장 — 실적 현황 기존 동작과 동일.)
export async function updateQuoteStatus(params: UpdateQuoteStatusParams): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from('quotes')
    // order_date · revenue_date 는 더 이상 쓰지 않는다. 수주·매출 시점은
    // 발주 라우트가 남기는 purchase_order_at · tax_invoice_completed_at 이 정본이다.
    .update({
      status: params.status,
      ...reasonPatch(params.status, params.reason),
    })
    .eq('quote_id', params.quoteId)
  if (error) {
    // RLS 로 막히면 화면에는 메시지만 남아 원인을 알기 어렵다. 원본 객체(code·details·hint)를 콘솔에 남긴다.
    console.error('[quote] status update failed', { quoteId: params.quoteId, status: params.status, error })
    throw new Error(error.message)
  }
}

export type UploadPurchaseOrderParams = {
  quoteId: number
  quoteNumber: string
  file: File
  deliveryMethod: string
  deliveryAddress?: string // 이미 구성된 배송정보 문자열(UI 파생). 있으면만 전송.
}

// 발주서 업로드(/api/purchase-order, action=upload). deliveryAddress 구성은 호출부 책임.
export async function uploadPurchaseOrder(p: UploadPurchaseOrderParams): Promise<MutationResult> {
  const fd = new FormData()
  fd.append('quoteId', String(p.quoteId))
  fd.append('quoteNumber', p.quoteNumber)
  fd.append('action', 'upload')
  fd.append('file', p.file)
  fd.append('deliveryMethod', p.deliveryMethod)
  if (p.deliveryAddress) fd.append('deliveryAddress', p.deliveryAddress)
  const res = await fetch('/api/purchase-order', { method: 'POST', body: fd })
  const json = await res.json().catch(() => ({}))
  return res.ok ? { ok: true } : { ok: false, error: json.error || String(res.status) }
}

export type RequestTaxInvoiceParams = {
  quoteId: number
  taxDate?: string
}

// 세금계산서 발행 요청(/api/purchase-order, action=request_tax).
export async function requestTaxInvoice(p: RequestTaxInvoiceParams): Promise<MutationResult> {
  const fd = new FormData()
  fd.append('quoteId', String(p.quoteId))
  fd.append('action', 'request_tax')
  if (p.taxDate) fd.append('taxDate', p.taxDate)
  const res = await fetch('/api/purchase-order', { method: 'POST', body: fd })
  const json = await res.json().catch(() => ({}))
  return res.ok ? { ok: true } : { ok: false, error: json.error || String(res.status) }
}

// 견적 삭제 흐름의 알림(/api/quote-delete). 동작은 action 으로 나뉜다.
// 알림은 부가 처리라 실패해도 화면 흐름을 막지 않고 콘솔에만 남긴다 —
// 요청(quotes.status)이나 삭제 자체는 이미 끝나 있기 때문이다.
async function notifyQuoteDelete(quoteId: number, action: 'request' | 'completed'): Promise<void> {
  try {
    const res = await fetch('/api/quote-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quoteId, action }),
    })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      console.error('[quote] delete notify failed', { quoteId, action, status: res.status, json })
    }
  } catch (e) {
    console.error('[quote] delete notify failed', { quoteId, action, error: e })
  }
}

export type OnBehalfAssignee = { engineer_id: number; name: string; position: string | null; tel: string | null }

/**
 * 대필 대상이 유효한지 서버에 묻는다(/api/quote-on-behalf, action=resolve).
 * ?on_behalf= 는 주소창으로 아무나 만들 수 있어, 화면은 이 응답이 성공했을 때만 대필 모드로 들어간다.
 */
export async function resolveOnBehalf(engineerId: number): Promise<{ ok: true; assignee: OnBehalfAssignee } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/quote-on-behalf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resolve', engineerId }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: json.error || String(res.status) }
    return { ok: true, assignee: json.assignee as OnBehalfAssignee }
  } catch (e) {
    console.error('[quote] on-behalf resolve failed', { engineerId, error: e })
    return { ok: false, error: '담당자 확인에 실패했습니다.' }
  }
}

/**
 * 대필 견적이 확정됐음을 실적 담당자에게 알린다(/api/quote-on-behalf, action=notify).
 * 알림은 부가 처리라 실패해도 화면 흐름을 막지 않고 콘솔에만 남긴다 — 견적은 이미 저장돼 있다.
 * 대필이 아닌 견적이면 서버가 스스로 걸러 알림을 만들지 않는다.
 */
export async function notifyOnBehalf(quoteId: number): Promise<void> {
  try {
    const res = await fetch('/api/quote-on-behalf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'notify', quoteId }),
    })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      console.error('[quote] on-behalf notify failed', { quoteId, status: res.status, json })
    }
  } catch (e) {
    console.error('[quote] on-behalf notify failed', { quoteId, error: e })
  }
}

/** 삭제 요청을 관리자에게 알린다. 상태 변경이 끝난 뒤에 부른다. */
export const notifyDeleteRequest = (quoteId: number) => notifyQuoteDelete(quoteId, 'request')

/** 삭제가 끝났음을 요청자(견적 작성자)에게 알린다. 견적 행이 지워진 뒤에 부른다. */
export const notifyDeleteCompleted = (quoteId: number) => notifyQuoteDelete(quoteId, 'completed')
