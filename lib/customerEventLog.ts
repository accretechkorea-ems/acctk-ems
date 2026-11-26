'use client'

/**
 * **밖에서 벌어진 일 한 줄**을 고객 이력에 적는다 (2026-11-27 야간3 2-2).
 *
 *   await logCustomerEvent({ customerId, type: 'holding_started', payload: { device, reason } })
 *
 * ── 왜 라우트를 거치나 ────────────────────────────────────────────────────
 *   customer_events 는 RLS 로 **service role 만** 쓴다(db/customer_events_20261120.sql).
 *   홀딩·포캐스트·수리·의뢰서는 화면이 제 표에 직접 쓰므로, 이력 한 줄만 라우트에
 *   맡긴다(`/api/customer-change` 의 log-event — 받는 종류는 허용 목록뿐이다).
 *
 * ── 실패해도 본 일을 막지 않는다 ─────────────────────────────────────────
 *   홀딩을 걸었는데 이력 한 줄을 못 적었다고 홀딩을 되돌리면, 사람은 「저장이 안 됐다」로
 *   읽고 다시 건다. 이 함수는 **던지지 않는다** — 못 적으면 콘솔에만 남기고 참을 돌려주지
 *   않는다. 부르는 쪽은 기다리기만 하면 된다(`void logCustomerEvent(...)` 도 좋다).
 */

import type { CustomerEventType } from '@/lib/customerEvents'

export type CustomerEventLog = {
  customerId: number | null | undefined
  type: CustomerEventType
  payload?: Record<string, unknown>
  /** 일이 벌어진 날('YYYY-MM-DD' 또는 ISO). 주지 않으면 지금이다. */
  occurredAt?: string | null
}

/** 적었으면 true. 고객사가 안 붙은 건(customerId 없음)은 **조용히 건너뛴다**. */
export async function logCustomerEvent(input: CustomerEventLog): Promise<boolean> {
  const customerId = Number(input.customerId)
  // 사건은 사업장 줄에 달린다 — 고객사가 없는 건(미배정 리드·업체 없는 수리)은 적을 곳이 없다.
  if (!Number.isInteger(customerId) || customerId <= 0) return false
  try {
    const res = await fetch('/api/customer-change', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'log-event',
        customerId,
        type: input.type,
        payload: input.payload ?? {},
        ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
      }),
    })
    if (!res.ok) {
      console.warn('[eventLog] 이력 한 줄을 적지 못했다 — 본 일은 그대로다', input.type, res.status)
      return false
    }
    return true
  } catch (e) {
    console.warn('[eventLog] 이력 한 줄을 적지 못했다 — 본 일은 그대로다', input.type, e)
    return false
  }
}
