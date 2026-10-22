'use client'

// 개인 대시보드의 카드별 조회 — **카드 하나가 실패해도 나머지는 뜬다.**
//
// 조회를 카드마다 나누되 **동시에** 시작한다(직렬로 엮으면 가장 느린 조회가 화면 전체를 잡는다).
// 그래서 상태도 카드마다 따로 둔다 — 한 칸에 모아 두면 하나가 null 인 동안 다른 카드도 못 그린다.
//
// 공통 참조(나 자신)는 화면이 한 번 읽어 넘겨준다. 여기서 다시 읽지 않는다.

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { todayKST } from '@/lib/date'
import type { CardOpportunity, CardQuote } from '@/lib/homeCards'
import type { StatTarget } from '@/lib/salesStats'

/**
 * 한 카드의 자료 — 못 읽었으면 error 가 참이고, 그 카드만 그 사실을 말한다.
 * message 는 **실패한 이유 한 마디**다. 콘솔에만 남기면 사용자는 빈 카드를 보고
 * 「0 건이구나」로 읽는다 — 못 읽은 것과 0 건은 전혀 다른 일이다.
 */
export type Slot<T> = { data: T; loading: boolean; error: boolean; message?: string }

const idle = <T, >(empty: T): Slot<T> => ({ data: empty, loading: true, error: false })

/** 조회가 던진 것에서 사람이 읽을 한 줄을 뽑는다(문자열·Error·PostgrestError 전부 온다). */
const messageOf = (error: unknown): string => {
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const o = error as { message?: unknown; code?: unknown }
    if (typeof o.message === 'string' && o.message) return typeof o.code === 'string' ? `${o.message} (${o.code})` : o.message
    if (typeof o.code === 'string') return o.code
  }
  return '알 수 없는 오류'
}

export type DashboardCards = {
  quotes: Slot<CardQuote[]>
  /** 연간 목표 — 「내 실적」 카드의 달성률이 쓴다(실적 현황과 같은 행을 본다). */
  targets: Slot<StatTarget[]>
  opportunities: Slot<CardOpportunity[]>
  today: string
  /** 「내 견적」 모달을 닫았을 때처럼 숫자만 다시 맞추고 싶을 때. */
  reloadQuotes: () => Promise<void>
}

export function useDashboardCards(engineerId: number | null, fiscalYear: number): DashboardCards {
  const [supabase] = useState(() => createClient())
  const today = todayKST()

  const [quotes, setQuotes] = useState<Slot<CardQuote[]>>(() => idle<CardQuote[]>([]))
  const [targets, setTargets] = useState<Slot<StatTarget[]>>(() => idle<StatTarget[]>([]))
  const [opportunities, setOpportunities] = useState<Slot<CardOpportunity[]>>(() => idle<CardOpportunity[]>([]))

  /**
   * 견적 — 카드의 상태별 건수가 쓴다.
   *
   * **기간으로 거르지 않는다.** 진행 중인 건(견적중·발주·주문완료·계산서 요청)은 회계연도를
   * 넘겨서까지 남아 있고, 그것이 곧 아직 손이 가야 하는 일이다. 본인 건만 읽으므로
   * 한 사람치는 많아야 수백 줄이다.
   */
  const reloadQuotes = useCallback(async () => {
    if (engineerId == null) return
    setQuotes(s => ({ ...s, loading: true }))
    const { data, error } = await supabase.from('quotes')
      .select('status, quote_date, purchase_order_at, tax_invoice_completed_at, total_supply, total_profit, engineer_id')
      .eq('engineer_id', engineerId)
    if (error) console.error('[dashboard] quotes load failed', error)
    setQuotes({ data: (data ?? []) as CardQuote[], loading: false, error: !!error, message: error ? messageOf(error) : undefined })
  }, [supabase, engineerId])

  useEffect(() => {
    if (engineerId == null) return
    let cancelled = false
    /** 한 카드의 조회 — 실패해도 그 카드만 표시가 달라진다. */
    const run = async <T, >(
      what: string,
      set: (s: Slot<T>) => void,
      empty: T,
      fn: () => Promise<{ data: T; error: unknown }>,
    ) => {
      try {
        const { data, error } = await fn()
        if (cancelled) return
        if (error) console.error(`[dashboard] ${what} load failed`, error)
        set({ data: error ? empty : data, loading: false, error: !!error, message: error ? messageOf(error) : undefined })
      } catch (e) {
        if (cancelled) return
        console.error(`[dashboard] ${what} load threw`, e)
        set({ data: empty, loading: false, error: true, message: messageOf(e) })
      }
    }

    // **동시에** 시작한다. await 로 줄줄이 엮지 않는다.
    void reloadQuotes()

    void run<StatTarget[]>('targets', setTargets, [], async () => {
      const { data, error } = await supabase.from('sales_targets')
        .select('engineer_id, year, quarter, target_amount, order_target_amount')
        .eq('engineer_id', engineerId)
      return { data: (data ?? []) as StatTarget[], error }
    })

    void run<CardOpportunity[]>('opportunities', setOpportunities, [], async () => {
      const { data, error } = await supabase.from('sales_opportunities')
        .select('opportunity_id, stage, expected_amount, closed_at, created_at, engineer_id')
        .eq('engineer_id', engineerId)
      return { data: (data ?? []) as CardOpportunity[], error }
    })

    // 알림·결재 미결함은 여기서 읽지 않는다 — 사이드바 배지와 같은 자료라 **앱 당 한 벌인
    // 스토어**로 옮겼다(lib/appData/notifications.ts·approvalInbox.ts). 카드가 직접 본다.

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineerId, fiscalYear])

  return { quotes, targets, opportunities, today, reloadQuotes }
}
