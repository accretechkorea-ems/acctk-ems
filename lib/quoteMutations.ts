// 견적 관련 mutation(DB write / API 호출) 공용 모듈.
// 실적 현황(EngineerQuoteModal)과 개인 대시보드가 동일 로직을 공유하기 위한 것.
// 규칙: 순수하게 DB/API 호출만 한다. toast/refetch/UI state 는 호출부가 처리한다.
//   - 실패는 throw(상태 변경) 또는 반환값 { ok, error }(발주/세금)로 알린다.

import { createClient } from '@/lib/supabase/client'
import type { LineInput } from '@/lib/approval/types'

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

/** 발주 요청 메모 길이 상한. app/api/purchase-order 의 REQUEST_MEMO_MAX 와 같아야 한다. */
export const PO_MEMO_MAX = 500

export type UploadPurchaseOrderParams = {
  quoteId: number
  quoteNumber: string
  file: File
  deliveryMethod: string
  deliveryAddress?: string // 이미 구성된 배송정보 문자열(UI 파생). 있으면만 전송.
  /** 견적 작성자가 남기는 요청 메모(선택). 영업관리가 쓰는 order_memo 와 다른 칸이다. */
  requestMemo?: string
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
  // 빈 값도 보낸다 — 재등록에서 메모를 지운 경우를 서버가 알아야 null 로 되돌린다.
  fd.append('requestMemo', p.requestMemo ?? '')
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

/**
 * 본인 삭제(/api/quote-delete, action=self) — 결재를 거치지 않고 바로 지운다.
 *
 * 아직 실적에 잡히지 않은 견적('견적중'·'실패')만 이 길로 간다. 그 판정은 서버가 다시 하므로
 * 화면이 틀려도 수주 이후 견적이 지워지지는 않는다.
 * 되돌릴 수 없는 일이라 실패를 삼키지 않는다 — 부르는 쪽이 결과를 보여 줘야 한다.
 */
export async function deleteQuoteSelf(quoteId: number, reason: string): Promise<MutationResult> {
  try {
    const res = await fetch('/api/quote-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quoteId, action: 'self', reason }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: json.error || String(res.status) }
    return { ok: true }
  } catch (e) {
    console.error('[quote] self delete failed', { quoteId, error: e })
    return { ok: false, error: '삭제에 실패했습니다.' }
  }
}

/**
 * 삭제 요청을 결재로 올린다(/api/quote-delete, action=request).
 *
 * 알림과 달리 실패를 삼키지 않는다 — 상신이 안 되면 그 견적은 결재도 삭제도 되지 않은 채
 * '취소요청' 에 남는다. 부르는 쪽이 결과를 보고 상태를 되돌릴 수 있어야 한다.
 * 결재선은 결재선 지정 모달(LinePickerModal)이 만든 값을 그대로 넘긴다.
 */
export async function submitQuoteDelete(quoteId: number, lines: LineInput[]): Promise<MutationResult> {
  try {
    const res = await fetch('/api/quote-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quoteId, action: 'request', lines }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: json.error || String(res.status) }
    return { ok: true }
  } catch (e) {
    console.error('[quote] delete submit failed', { quoteId, error: e })
    return { ok: false, error: '상신에 실패했습니다.' }
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
