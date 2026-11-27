'use client'

// 홈 「내 오늘」의 조회 — **할 일 목록 한 벌** (2026-11-26, 묶음2 A1 에서 줄였다).
//
// useDashboardCards 와 **같은 방식**이다: 조회를 조각마다 나누되 동시에 시작하고, 상태도
// 조각마다 따로 둔다. 하나가 실패해도 그 줄만 빠지고 나머지는 뜬다 — 홈이 통째로 비는 것이
// 가장 나쁘다.
//
// 규칙(무엇을 목록에 세우고 무슨 글자로 세우나)은 전부 lib/tasks.ts 에 있다. 여기서는
// **읽어서 넘겨 주기만** 한다.
//
// ── 아직 없는 칸·표 ─────────────────────────────────────────────────────────
//   tasks 표(db/tasks_20261126.sql)와 devices 의 납품 칸(devices_delivery)이 아직
//   없을 수 있다. 그때는 그 조각만 **빈 값**이 되고(42703·42P01·PGRST205) 화면은 그대로
//   돈다. 할 일 카드만 「표를 먼저 적용해주세요」 한 줄을 띄운다.

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { todayKST } from '@/lib/date'
import { isClosedStage } from '@/components/customer/opportunity'
import { EXPIRY_TASK_STATUSES, type SynthDevice, type SynthLead, type SynthLost, type SynthQuote, type SynthReasonPending, type TaskRow } from '@/lib/tasks'
import { DEVICE_PENDING } from '@/lib/deviceStatus'

/** 납품 예정 줄에서 읽는 것. 두 갈래가 같은 모양이라 한 번만 적는다. */
type PendingRow = {
  device_id: number
  device_name: string | null
  device_name2: string | null
  customer_id: number | null
  install_due_month: string | null
}
/** 칸이 아직 없을 때 돌아오는 코드 — 그 갈래만 건너뛴다(db/devices_created_by_20261127.sql). */
const MISSING_COLUMN = new Set(['42703', 'PGRST204', 'PGRST205'])
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

    /**
     * **납품 예정 장비** — 주인 규칙은 lib/deviceOwner.ts 에 있다(2026-11-27, 묶음4 G1):
     *   ① 그 줄을 만든 견적의 작성자 → ② 없으면 그 줄을 만든 사람(created_by)
     *   → ③ 둘 다 없으면 **홈에 띄우지 않는다**(사업장 화면에만 선다).
     *
     * 그래서 두 갈래를 읽어 합친다. ②는 `devices.created_by` 가 있어야 하는데
     * (db/devices_created_by_20261127.sql) **없어도 돈다** — 42703 을 만나면 그 갈래만
     * 건너뛰고 ①만으로 답한다. ③은 조회하지 않는 것으로 지켜진다.
     */
    void run<SynthDevice[]>('pendingDevices', setPendingDevices, [], async () => {
      const SELECT = 'device_id, device_name, device_name2, customer_id, install_due_month'
      const base = () => supabase.from('devices').select(SELECT)
        .eq('status', DEVICE_PENDING).is('deleted_at', null)

      // ① 내가 쓴 견적에서 생긴 줄.
      const mine = unwrap<Array<{ quote_id: number }>>(
        await supabase.from('quotes').select('quote_id').eq('engineer_id', engineerId))
      const ids = mine.map(q => Number(q.quote_id))
      const fromQuote = ids.length === 0 ? [] : unwrap<PendingRow[]>(await base().in('source_quote_id', ids))

      // ② 견적 없이 **내가 손으로 넣은** 줄. 칸이 없으면 조용히 건너뛴다.
      let fromMe: PendingRow[] = []
      const made = await base().is('source_quote_id', null).eq('created_by', engineerId)
      if (made.error) {
        if (!MISSING_COLUMN.has(made.error.code ?? '')) throw made.error
      } else {
        fromMe = (made.data ?? []) as PendingRow[]
      }

      // 같은 줄이 두 번 들어오지 않게 id 로 합친다.
      const byId = new Map<number, PendingRow>()
      for (const r of [...fromQuote, ...fromMe]) byId.set(Number(r.device_id), r)
      const rows = [...byId.values()]
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

    // 실주 사유 미입력 — 내 포캐스트를 읽어 **사유가 빈 종료 건**만 만든다.
    //
    // ⚠ 전에는 이 조회가 「멈춘 딜」도 함께 만들었다(14일 무활동). 그 카드를 2026-11-26
    //   (묶음2 A1)에 걷으면서 **sales_activities 조회 한 벌이 사라졌다** — 종료되지 않은
    //   건의 마지막 활동일을 알아야 했던 유일한 자리였다. 지금은 포캐스트 한 번만 읽는다.
    void run<SynthLost[]>('lost', setLost, [], async () => {
      const opps = unwrap<Array<{ opportunity_id: number; title: string | null; stage: string; closed_at: string | null; lost_reason: string | null; customer_id: number | null }>>(
        await supabase.from('sales_opportunities')
          .select('opportunity_id, title, stage, closed_at, lost_reason, customer_id')
          .eq('engineer_id', engineerId))
      const closed = opps.filter(o => (isClosedStage(o.stage) || !!o.closed_at) && !(o.lost_reason ?? '').trim())
      const names = await siteNames(closed.map(o => Number(o.customer_id)))
      return closed.map(o => ({
        opportunity_id: o.opportunity_id,
        title: o.title,
        company: o.customer_id ? names.get(Number(o.customer_id)) ?? null : null,
      }))
    })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineerId, seeLeads])

  return {
    tasks, schemaNote, quotes, leads, pendingDevices, lost, reasonPending,
    today, reloadTasks,
  }
}
