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
//   **슈퍼관리자만.** 바꾸는 일은 전원에게 열었지만(/api/customer-change) 지우는 일은 아니다.
//   복구(deleted_at 비우기)도 같은 문턱이다.
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

export async function POST(req: Request) {
  const { error: authError, caller, sb } = await loadCaller({ kind: 'superadmin' }, { tag: TAG, req, method: 'POST' })
  if (authError) return authError

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return bad('요청을 읽지 못했습니다')
  const action = String(body.action ?? '')
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
