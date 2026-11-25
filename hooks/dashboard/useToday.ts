'use client'

// 홈 「내 오늘」의 조회 — 타일 여섯 · 할 일 목록 · 작은 카드 셋 (2026-11-26).
//
// useDashboardCards 와 **같은 방식**이다: 조회를 조각마다 나누되 동시에 시작하고, 상태도
// 조각마다 따로 둔다. 하나가 실패해도 그 줄만 빠지고 나머지는 뜬다 — 홈이 통째로 비는 것이
// 가장 나쁘다.
//
// 규칙(무엇을 목록에 세우고 무슨 글자로 세우나)은 전부 lib/tasks.ts 에 있다. 여기서는
// **읽어서 넘겨 주기만** 한다.
//
// ── 아직 없는 칸·표 ─────────────────────────────────────────────────────────
//   tasks 표(db/tasks_20261126.sql)와 devices 의 납품·교정 칸(devices_delivery)이 아직
//   없을 수 있다. 그때는 그 조각만 **빈 값**이 되고(42703·42P01·PGRST205) 화면은 그대로
//   돈다. 할 일 카드만 「표를 먼저 적용해주세요」 한 줄을 띄운다.

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { addDays, todayKST } from '@/lib/date'
import { isClosedStage } from '@/components/customer/opportunity'
import { CALIBRATION_SOON_DAYS, EXPIRY_TASK_STATUSES, type CalibrationDevice, type StaleDeal, type SynthDevice, type SynthLead, type SynthLost, type SynthQuote, type SynthReasonPending, type TaskRow } from '@/lib/tasks'
import { DEVICE_PENDING } from '@/lib/deviceStatus'
import { isReasonPending } from '@/lib/lostReason'

/** 한 조각의 자료 — 못 읽었으면 error 가 참이고 그 조각만 그 사실을 말한다. */
export type Piece<T> = { data: T; loading: boolean; error: boolean; message?: string }

const idle = <T, >(empty: T): Piece<T> => ({ data: empty, loading: true, error: false })
const done = <T, >(data: T): Piece<T> => ({ data, loading: false, error: false })

/** 그 오류가 「표·칸이 아직 없다」인가 — 그때는 조용히 빈 값으로 둔다. */
const schemaMissing = (err: unknown): boolean => {
  const code = (err as { code?: string } | null)?.code
  return code === '42P01' || code === '42703' || code === 'PGRST204' || code === 'PGRST205'
}

const messageOf = (err: unknown): string => {
  if (typeof err === 'string') return err
  const o = err as { message?: unknown; code?: unknown } | null
  if (o && typeof o.message === 'string' && o.message) return o.message
  if (o && typeof o.code === 'string') return o.code
  return '알 수 없는 오류'
}

export type TodayData = {
  /** tasks 표의 줄(아직 안 끝낸 것). 표가 없으면 schema 가 그 문구를 든다. */
  tasks: Piece<TaskRow[]>
  /** 표가 아직 없다는 안내(라우트가 준 문구). 있으면 할 일 카드가 한 줄로 띄운다. */
  schemaNote: string | null
  quotes: Piece<SynthQuote[]>
  leads: Piece<SynthLead[]>
  pendingDevices: Piece<SynthDevice[]>
  lost: Piece<SynthLost[]>
  /** 실패인데 사유가 빈 내 견적(지시 L3) — 안내만 한다. */
  reasonPending: Piece<SynthReasonPending[]>
  stale: Piece<StaleDeal[]>
  calibration: Piece<CalibrationDevice[]>
  today: string
  /** 할 일을 담거나 완료한 뒤 — 표의 줄만 다시 읽는다. */
  reloadTasks: () => Promise<void>
}

/** 사업장 이름 한 벌 — 조회마다 따로 읽지 않고 필요한 id 만 모아 한 번에 읽는다. */
async function siteNames(ids: readonly number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  const want = [...new Set(ids.filter(n => Number.isInteger(n) && n > 0))]
  if (want.length === 0) return out
  const supabase = createClient()
  const { data } = await supabase.from('customers').select('customer_id, company_name').in('customer_id', want)
  for (const r of data ?? []) out.set(Number(r.customer_id), String(r.company_name ?? ''))
  return out
}

export function useToday(engineerId: number | null, opts: { seeUnassignedLeads: boolean }): TodayData {
  const [supabase] = useState(() => createClient())
  const today = todayKST()
  const seeLeads = opts.seeUnassignedLeads

  const [tasks, setTasks] = useState<Piece<TaskRow[]>>(() => idle<TaskRow[]>([]))
  const [schemaNote, setSchemaNote] = useState<string | null>(null)
  const [quotes, setQuotes] = useState<Piece<SynthQuote[]>>(() => idle<SynthQuote[]>([]))
  const [leads, setLeads] = useState<Piece<SynthLead[]>>(() => idle<SynthLead[]>([]))
  const [pendingDevices, setPendingDevices] = useState<Piece<SynthDevice[]>>(() => idle<SynthDevice[]>([]))
  const [lost, setLost] = useState<Piece<SynthLost[]>>(() => idle<SynthLost[]>([]))
  const [reasonPending, setReasonPending] = useState<Piece<SynthReasonPending[]>>(() => idle<SynthReasonPending[]>([]))
  const [stale, setStale] = useState<Piece<StaleDeal[]>>(() => idle<StaleDeal[]>([]))
  const [calibration, setCalibration] = useState<Piece<CalibrationDevice[]>>(() => idle<CalibrationDevice[]>([]))

  // ── 할 일(표) — 라우트가 읽는다(RLS 밖에서도 같은 판정을 쓰려고) ────────────
  const reloadTasks = useCallback(async () => {
    if (engineerId == null) return
    setTasks(s => ({ ...s, loading: true }))
    try {
      const res = await fetch('/api/task', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list' }),
      })
      const json = await res.json().catch(() => null) as { ok?: boolean; rows?: TaskRow[]; error?: string; schema?: boolean } | null
      if (res.status === 503 && json?.schema) { setSchemaNote(json.error ?? null); setTasks(done<TaskRow[]>([])); return }
      if (!res.ok || !json?.ok) { setTasks({ data: [], loading: false, error: true, message: json?.error ?? `HTTP ${res.status}` }); return }
      setSchemaNote(null)
      setTasks(done(json.rows ?? []))
    } catch (e) {
      console.error('[today] tasks load threw', e)
      setTasks({ data: [], loading: false, error: true, message: messageOf(e) })
    }
  }, [engineerId])

  useEffect(() => {
    if (engineerId == null) return
    let cancelled = false

    /** 한 조각 — 표·칸이 아직 없으면 조용히 빈 값으로 둔다. */
    const run = async <T, >(what: string, set: (p: Piece<T>) => void, empty: T, fn: () => Promise<T>) => {
      try {
        const data = await fn()
        if (!cancelled) set(done(data))
      } catch (e) {
        if (cancelled) return
        if (schemaMissing(e)) { set(done(empty)); return }
        console.error(`[today] ${what} load failed`, e)
        set({ data: empty, loading: false, error: true, message: messageOf(e) })
      }
    }

    /** supabase 결과를 throw 로 바꿔 위 run 이 한 곳에서 받게 한다. */
    const unwrap = <T, >(res: { data: T | null; error: unknown }): T => {
      if (res.error) throw res.error
      return (res.data ?? []) as T
    }

    void reloadTasks()

    // 만료가 다가온 내 견적 — 7일 안에 끝나거나 이미 지난 건(규칙은 lib/tasks.ts).
    void run<SynthQuote[]>('quotes', setQuotes, [], async () => {
      const rows = unwrap<Array<{ quote_id: number; quote_number: string | null; status: string | null; quote_date: string | null; revived_at: string | null; customer_id: number | null }>>(
        await supabase.from('quotes')
          .select('quote_id, quote_number, status, quote_date, revived_at, customer_id')
          .eq('engineer_id', engineerId)
          .in('status', EXPIRY_TASK_STATUSES as unknown as string[]))
      const names = await siteNames(rows.map(r => Number(r.customer_id)))
      return rows.map(r => ({ ...r, company: r.customer_id ? names.get(Number(r.customer_id)) ?? null : null }))
    })

    // 미배정 신규 리드 — **볼 수 있는 사람에게만** 읽는다(지시: superadmin).
    if (seeLeads) {
      void run<SynthLead[]>('leads', setLeads, [], async () =>
        unwrap<SynthLead[]>(await supabase.from('leads')
          .select('lead_id, lead_no, company, created_at')
          .eq('status', '신규').is('assigned_to', null)
          .order('created_at', { ascending: true }).limit(50)))
    } else {
      setLeads(done<SynthLead[]>([]))
    }

    // 내가 수주해 만든 **납품 예정 장비**. source_quote_id 칸이 없으면 빈 값이다.
    void run<SynthDevice[]>('pendingDevices', setPendingDevices, [], async () => {
      const mine = unwrap<Array<{ quote_id: number }>>(
        await supabase.from('quotes').select('quote_id').eq('engineer_id', engineerId))
      const ids = mine.map(q => Number(q.quote_id))
      if (ids.length === 0) return []
      const rows = unwrap<Array<{ device_id: number; device_name: string | null; device_name2: string | null; customer_id: number | null; install_due_month: string | null }>>(
        await supabase.from('devices')
          .select('device_id, device_name, device_name2, customer_id, install_due_month')
          .eq('status', DEVICE_PENDING).is('deleted_at', null)
          .in('source_quote_id', ids))
      const names = await siteNames(rows.map(r => Number(r.customer_id)))
      return rows.map(r => ({ ...r, site: r.customer_id ? names.get(Number(r.customer_id)) ?? null : null }))
    })

    // 실패인데 사유가 빈 내 견적 — 「실주 사유 입력 필요」 한 줄로 안내만 한다(L3).
    // 판정은 lib/lostReason.ts 가 한다(자동 실주가 넣은 「유효기간 만료」는 사유로 세지 않는다).
    void run<SynthReasonPending[]>('reasonPending', setReasonPending, [], async () => {
      const rows = unwrap<Array<{ quote_id: number; quote_number: string | null; fail_reason: string | null; lost_reason_id: number | null; customer_id: number | null }>>(
        await supabase.from('quotes')
          .select('quote_id, quote_number, fail_reason, lost_reason_id, customer_id')
          .eq('engineer_id', engineerId).eq('status', '실패'))
      const want = rows.filter(r => isReasonPending(r))
      const names = await siteNames(want.map(r => Number(r.customer_id)))
      return want.map(r => ({
        quote_id: r.quote_id,
        quote_number: r.quote_number,
        company: r.customer_id ? names.get(Number(r.customer_id)) ?? null : null,
      }))
    })

    // 멈춘 딜 + 실주 사유 미입력 — 내 포캐스트를 한 번 읽어 둘을 함께 만든다.
    void run<StaleDeal[]>('stale', setStale, [], async () => {
      const opps = unwrap<Array<{ opportunity_id: number; title: string | null; stage: string; expected_amount: number | null; closed_at: string | null; created_at: string | null; lost_reason: string | null; customer_id: number | null }>>(
        await supabase.from('sales_opportunities')
          .select('opportunity_id, title, stage, expected_amount, closed_at, created_at, lost_reason, customer_id')
          .eq('engineer_id', engineerId))
      const names = await siteNames(opps.map(o => Number(o.customer_id)))

      // 사유가 비어 있는 종료 건 — 목록에 한 줄로 안내만 한다(막지 않는다).
      if (!cancelled) {
        setLost(done(opps
          .filter(o => (isClosedStage(o.stage) || !!o.closed_at) && !(o.lost_reason ?? '').trim())
          .map(o => ({ opportunity_id: o.opportunity_id, title: o.title, company: o.customer_id ? names.get(Number(o.customer_id)) ?? null : null }))))
      }

      const open = opps.filter(o => !o.closed_at && !isClosedStage(o.stage))
      if (open.length === 0) return []
      // 마지막 활동일 — 활동이 없으면 만든 날을 쓴다(그만큼 오래 멈춰 있는 것이다).
      const acts = unwrap<Array<{ opportunity_id: number | null; activity_date: string | null }>>(
        await supabase.from('sales_activities')
          .select('opportunity_id, activity_date')
          .in('opportunity_id', open.map(o => o.opportunity_id)))
      const last = new Map<number, string>()
      for (const a of acts) {
        const id = Number(a.opportunity_id)
        if (!a.activity_date || !Number.isInteger(id)) continue
        const was = last.get(id)
        if (!was || was < a.activity_date) last.set(id, a.activity_date)
      }
      return open.map(o => ({
        opportunity_id: o.opportunity_id,
        title: o.title,
        company: o.customer_id ? names.get(Number(o.customer_id)) ?? null : null,
        expected_amount: o.expected_amount,
        last_at: last.get(o.opportunity_id) ?? (o.created_at ? o.created_at.slice(0, 10) : null),
      }))
    })

    // 교정 예정 — next_calibration_date 칸이 아직 없으면 빈 값이다(타일은 0 으로 남는다).
    void run<CalibrationDevice[]>('calibration', setCalibration, [], async () => {
      const rows = unwrap<Array<{ device_id: number; device_name: string | null; device_name2: string | null; customer_id: number | null; next_calibration_date: string | null }>>(
        await supabase.from('devices')
          .select('device_id, device_name, device_name2, customer_id, next_calibration_date')
          .is('deleted_at', null)
          .not('next_calibration_date', 'is', null)
          .lte('next_calibration_date', addDays(today, CALIBRATION_SOON_DAYS))
          .order('next_calibration_date', { ascending: true }).limit(50))
      const names = await siteNames(rows.map(r => Number(r.customer_id)))
      return rows.map(r => ({ ...r, site: r.customer_id ? names.get(Number(r.customer_id)) ?? null : null }))
    })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineerId, seeLeads])

  return {
    tasks, schemaNote, quotes, leads, pendingDevices, lost, reasonPending, stale, calibration,
    today, reloadTasks,
  }
}
