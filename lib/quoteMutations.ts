// 견적 관련 mutation(DB write / API 호출) 공용 모듈.
// 실적 현황(EngineerQuoteModal)과 개인 대시보드가 동일 로직을 공유하기 위한 것.
// 규칙: 순수하게 DB/API 호출만 한다. toast/refetch/UI state 는 호출부가 처리한다.
//   - 실패는 throw(상태 변경) 또는 반환값 { ok, error }(발주/세금)로 알린다.

import { createClient } from '@/lib/supabase/client'

export type MutationResult = { ok: boolean; error?: string }

export type UpdateQuoteStatusParams = {
  quoteId: number
  status: string
  orderDate?: string
  revenueDate?: string
  failReason?: string
}

// 견적 상태 변경(취소요청/실패 등). RLS 적용된 사용자 클라이언트로 직접 update.
// 실패 시 throw. (빈 문자열은 null 로 저장 — 실적 현황 기존 동작과 동일.)
export async function updateQuoteStatus(params: UpdateQuoteStatusParams): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from('quotes')
    .update({
      status: params.status,
      order_date: params.orderDate || null,
      revenue_date: params.revenueDate || null,
      fail_reason: params.failReason || null,
    })
    .eq('quote_id', params.quoteId)
  if (error) throw new Error(error.message)
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
