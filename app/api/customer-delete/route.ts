// 고객사 **지우기 한 길** — 사업장·회사·대리점·담당자·장비 (2026-11-23).
//
// ── 전부 소프트 삭제다 ────────────────────────────────────────────────────
//   지우는 것은 **deleted_at 을 채우는 것**이고, 그것뿐이다. 줄은 그대로 남는다.
//
//   왜 바꿨나 — 사업장 삭제가 견적이 없으면 **진짜 DELETE** 였다.
//     · service_engineers → service_history → contacts → devices → customers 를 차례로
//       지우다가 중간에 실패하면 「일부만 지워졌을 수 있습니다」로 끝났다. 되돌릴 수 없다.
//     · 그 사슬에 sales_activities 가 없어서, 영업활동이 한 건이라도 있으면 **마지막
//       customers DELETE 가 FK 에 막혔다**. 그래서 「지워지지 않는 사업장」이 생겼다.
//   소프트 삭제는 **한 문장**이라 중간이 없다 — 전부 되거나 전부 안 된다. 트랜잭션이
//   필요 없는 모양으로 만든 것이다(DB 함수를 더하지 않았다).
//
// ── 누가 ─────────────────────────────────────────────────────────────────
//   지우기·복구는 **슈퍼관리자만**이다. 바꾸는 일은 전원에게 열었지만(/api/customer-change)
//   지우는 일은 아니다.
//
//   **삭제 요청(request·list-requests)은 고객사를 보는 사람이면 된다**(2026-11-23).
//   사업장 0곳 회사를 찾아내는 사람은 자기 회사를 정리하는 담당자인데, 전에는 그 사람에게
//   「삭제」 버튼이 보이고 누르면 403 이었다. 이제 까닭을 적어 **요청**하면 슈퍼관리자에게
//   알림이 가고, 정리 필요 탭의 그 줄에 「삭제 요청됨」이 붙는다.
//
// ── 사유는 받는다 ────────────────────────────────────────────────────────
//   지운 까닭을 적지 않으면 나중에 남는 것은 「누군가 지웠다」뿐이다. 사유는 **필수**이고
//   사건(customer_events)의 payload 에 들어간다.

import { NextResponse } from 'next/server'
import { loadCaller } from '@/lib/apiCaller'
import { writeCustomerEvents } from '@/lib/customerEvents'
import { DELETE_REASON_MAX, DELETE_TARGETS, type DeleteTarget } from '@/lib/customerDelete'

const TAG = 'customer-delete'
const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

/** 그 대상이 사는 표와 열쇠 칸. */
const TABLE: Record<DeleteTarget, { table: string; key: string }> = {
  site: { table: 'customers', key: 'customer_id' },
  company: { table: 'customers', key: 'customer_id' },
  agency: { table: 'customers', key: 'customer_id' },
  contact: { table: 'contacts', key: 'contact_id' },
  device: { table: 'devices', key: 'device_id' },
}

/** 고객사를 보는 사람이면 되는 작업 — 지우지 않는 것들. */
const MEMBER_ACTIONS = new Set(['request', 'list-requests'])

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return bad('요청을 읽지 못했습니다')
  const action = String(body.action ?? '')

  // 문턱은 **작업마다** 다르다(위 「누가」).
  const { error: authError, caller, sb } = MEMBER_ACTIONS.has(action)
    ? await loadCaller({ kind: 'menu', keys: ['customers'] }, { tag: TAG, req, method: 'POST' })
    : await loadCaller({ kind: 'superadmin' }, { tag: TAG, req, method: 'POST' })
  if (authError) return authError
  const target = String(body.target ?? '') as DeleteTarget
  // ── 숨겨진 줄 목록 — 「삭제됨」 소탭이 읽는다 ─────────────────────────
  //   화면 조회는 지워진 줄을 보지 않으므로(.is('deleted_at', null)) 여기서 읽어 준다.
  if (action === 'list-deleted') {
    const { data, error } = await sb
      .from('customers')
      .select('customer_id, company_name, site_name, is_parent, deleted_at')
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false })
      .limit(200)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({
      ok: true,
      rows: (data ?? []).map(r => ({
        customer_id: Number(r.customer_id),
        company_name: (r.company_name ?? '').trim() || `#${r.customer_id}`,
        hint: `${r.is_parent ? '회사' : '사업장'} · ${String(r.deleted_at ?? '').slice(0, 10)} 숨김`,
      })),
    })
  }

  // ── 요청된 회사 목록 — 정리 필요 탭이 「삭제 요청됨」을 붙이는 데 쓴다 ──
  if (action === 'list-requests') {
    const { data, error } = await sb
      .from('customer_events')
      .select('customer_id, occurred_at, payload')
      .eq('event_type', 'company_delete_requested')
      .order('occurred_at', { ascending: false })
      .limit(500)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    // 같은 회사가 두 번 요청됐으면 **가장 최근 것**만 돌려준다.
    const seen = new Map<number, { customer_id: number; occurred_at: string; reason: string | null }>()
    for (const r of data ?? []) {
      const cid = Number(r.customer_id)
      if (seen.has(cid)) continue
      const payload = (r.payload ?? {}) as { reason?: unknown }
      seen.set(cid, {
        customer_id: cid,
        occurred_at: String(r.occurred_at ?? ''),
        reason: typeof payload.reason === 'string' ? payload.reason : null,
      })
    }
    return NextResponse.json({ ok: true, rows: [...seen.values()] })
  }

  const id = Number(body.id)
  if (!Number.isInteger(id) || id <= 0) return bad('지울 줄을 찾지 못했습니다')

  // ── 연결 기록 세기 — 모달이 「무엇이 함께 숨겨지는가」를 보여 준다 ──────
  if (action === 'counts') {
    // 담당자·장비는 **그 줄을 가리키는 기록**만 센다(서비스·의뢰). 업체 단위 수를 보여 주면
    // 「장비 한 대를 지우는데 영업활동 30건이 숨는다」로 읽힌다 — 사실이 아니다.
    if (target === 'contact' || target === 'device') {
      const col = target === 'contact' ? 'contact_id' : 'device_id'
      const [svc, inq] = await Promise.all([
        sb.from('service_history').select('service_id', { count: 'exact', head: true }).eq(col, id),
        target === 'device'
          ? sb.from('inquiries').select('id', { count: 'exact', head: true }).eq('device_id', id)
          : Promise.resolve({ count: 0, error: null }),
      ])
      return NextResponse.json({
        ok: true,
        counts: {
          activity: 0, service: svc.error ? 0 : (svc.count ?? 0), quote: 0,
          inquiry: inq.error ? 0 : (inq.count ?? 0), device: 0, contact: 0,
        },
      })
    }
    if (target !== 'site' && target !== 'company' && target !== 'agency') return bad('셀 수 없는 대상입니다')
    const [act, svc, quo, inq, dev, con] = await Promise.all([
      sb.from('sales_activities').select('activity_id', { count: 'exact', head: true }).eq('customer_id', id),
      sb.from('service_history').select('service_id', { count: 'exact', head: true }).eq('customer_id', id),
      sb.from('quotes').select('quote_id', { count: 'exact', head: true }).eq('customer_id', id),
      sb.from('inquiries').select('id', { count: 'exact', head: true }).eq('customer_id', id),
      sb.from('devices').select('device_id', { count: 'exact', head: true }).eq('customer_id', id).is('deleted_at', null),
      sb.from('contacts').select('contact_id', { count: 'exact', head: true }).eq('customer_id', id).is('deleted_at', null),
    ])
    // 의뢰서는 customer_id 칸이 없을 수 있다(db/inquiry_customer_device_20261120.sql) — 그때는 0 으로 둔다.
    return NextResponse.json({
      ok: true,
      counts: {
        activity: act.count ?? 0,
        service: svc.count ?? 0,
        quote: quo.count ?? 0,
        inquiry: inq.error ? 0 : (inq.count ?? 0),
        device: dev.count ?? 0,
        contact: con.count ?? 0,
      },
    })
  }

  if (!DELETE_TARGETS.includes(target)) return bad('모르는 대상입니다')
  const { table, key } = TABLE[target]

  // ── 복구 — deleted_at 을 비운다 ───────────────────────────────────────
  if (action === 'restore') {
    const { data: before, error: readErr } = await sb
      .from(table).select('*').eq(key, id).maybeSingle()
    if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
    if (!before) return bad('줄을 찾지 못했습니다')

    const { error } = await sb.from(table).update({ deleted_at: null }).eq(key, id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const row = before as Record<string, unknown>
    const customerId = target === 'contact' || target === 'device' ? Number(row.customer_id) : id
    const { written } = await writeCustomerEvents(sb, [{
      customer_id: customerId,
      event_type: 'customer_restored',
      occurred_at: new Date().toISOString(),
      actor_engineer_id: caller.engineer_id,
      payload: { kind: target, name: nameOf(target, row) },
    }])
    console.log(`[${TAG}] restore`, { target, id, by: caller.email })
    return NextResponse.json({ ok: true, events: written })
  }

  // ── 지우기 — 한 문장이다(중간이 없다) ─────────────────────────────────
  if (action === 'delete') {
    const reason = String(body.reason ?? '').trim()
    if (!reason) return bad('지우는 까닭을 적어주세요')
    if (reason.length > DELETE_REASON_MAX) return bad(`까닭은 ${DELETE_REASON_MAX}자까지 적을 수 있습니다`)

    const { data: before, error: readErr } = await sb
      .from(table).select('*').eq(key, id).maybeSingle()
    if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
    if (!before) return bad('줄을 찾지 못했습니다')
    const row = before as Record<string, unknown>
    if (row.deleted_at) return bad('이미 지워진 줄입니다')

    // 회사 줄은 **묶인 사업장이 없을 때만** 지운다. 숨기는 것이라도 회사가 사라지면
    // 그 아래 사업장이 트리에서 길을 잃는다(미연결로 떨어진다).
    if (target === 'company') {
      const { count } = await sb.from('customers')
        .select('customer_id', { count: 'exact', head: true })
        .eq('parent_customer_id', id).is('deleted_at', null)
      if ((count ?? 0) > 0) return bad(`사업장 ${count}곳이 묶여 있습니다 — 먼저 옮기거나 지우세요`, 409)
    }

    const { error } = await sb.from(table)
      .update({ deleted_at: new Date().toISOString() }).eq(key, id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const customerId = target === 'contact' || target === 'device' ? Number(row.customer_id) : id
    const { written } = await writeCustomerEvents(sb, [{
      customer_id: customerId,
      event_type: 'customer_deleted',
      occurred_at: new Date().toISOString(),
      actor_engineer_id: caller.engineer_id,
      payload: {
        kind: target,
        name: nameOf(target, row),
        reason,
        counts: (body.counts && typeof body.counts === 'object') ? body.counts : null,
      },
    }])
    console.log(`[${TAG}] delete`, { target, id, by: caller.email })
    return NextResponse.json({ ok: true, events: written })
  }

  // ── 삭제 요청 — 지우지 않는다. 자국과 알림만 남긴다 ────────────────────
  if (action === 'request') {
    const reason = String(body.reason ?? '').trim()
    if (!reason) return bad('지워야 하는 까닭을 적어주세요')
    if (reason.length > DELETE_REASON_MAX) return bad(`까닭은 ${DELETE_REASON_MAX}자까지 적을 수 있습니다`)
    if (target !== 'company') return bad('회사만 삭제 요청할 수 있습니다')

    const { data: row, error: readErr } = await sb
      .from('customers').select('customer_id, company_name, is_parent, deleted_at').eq('customer_id', id).maybeSingle()
    if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
    if (!row || row.deleted_at) return bad('회사를 찾지 못했습니다')
    if (!row.is_parent) return bad('회사가 아닙니다')

    // 지우는 쪽과 **같은 기준**으로 다시 센다 — 사업장이 생겼으면 요청할 일이 아니다.
    const { count } = await sb.from('customers')
      .select('customer_id', { count: 'exact', head: true })
      .eq('parent_customer_id', id).is('deleted_at', null)
    if ((count ?? 0) > 0) return bad(`사업장 ${count}곳이 묶여 있습니다 — 먼저 옮기거나 지우세요`, 409)

    const { written } = await writeCustomerEvents(sb, [{
      customer_id: id,
      event_type: 'company_delete_requested',
      occurred_at: new Date().toISOString(),
      actor_engineer_id: caller.engineer_id,
      payload: { kind: 'company', name: (row.company_name ?? '').trim() || null, reason },
    }])

    // 슈퍼관리자 전원에게 알림. 알림이 실패해도 요청(사건)은 남는다 —
    // 「요청했는데 아무 자국이 없다」가 가장 나쁘다.
    const { data: admins } = await sb
      .from('engineers').select('engineer_id')
      .eq('permission_level', 'superadmin').is('resigned_date', null)
    const targets = (admins ?? []).map(a => Number(a.engineer_id)).filter(n => Number.isInteger(n))
    if (targets.length > 0) {
      const { error: notiErr } = await sb.from('notifications').insert(targets.map(engineer_id => ({
        engineer_id,
        title: '회사 삭제 요청',
        message: `${(row.company_name ?? '').trim() || '회사'} — ${reason}`,
        type: 'company_delete_request',
        link: '/',
        is_read: false,
        created_at: new Date().toISOString(),
      })))
      if (notiErr) console.error(`[${TAG}] 알림을 넣지 못했다`, notiErr)
    }
    console.log(`[${TAG}] request`, { id, by: caller.email, admins: targets.length })
    return NextResponse.json({ ok: true, events: written, notified: targets.length })
  }

  return bad('모르는 작업입니다')
}

/** 사건에 남길 이름 — 대상마다 이름 칸이 다르다. */
function nameOf(target: DeleteTarget, row: Record<string, unknown>): string | null {
  if (target === 'contact') return (row.name as string) ?? null
  if (target === 'device') {
    return [row.device_name, row.device_name2].filter(Boolean).join(' ') || null
  }
  return (row.company_name as string) ?? null
}
