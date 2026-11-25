// 고객사 **바꾸기 한 길** — 상태·대리점·분류·사업장·담당자·장비 (2026-11-23).
//
// ── 왜 라우트인가 ─────────────────────────────────────────────────────────
//   지금까지 이 저장들은 **브라우저에서 바로** customers·contacts·devices 를 고쳤다.
//   두 가지가 걸린다.
//     (가) 사건을 적을 수 없다. customer_events 는 RLS 로 service role 만 쓴다
//          (db/customer_events_20261120.sql) — 누가 무엇을 바꿨는지 남지 않았다.
//     (나) 레포 규칙이 「쓰기는 service role 라우트에서만」이다.
//   그래서 저장과 **사건 기록을 한 자리에서** 한다. 사건의 before 는 라우트가 DB 에서
//   직접 읽은 값이다 — 화면이 보내 준 값을 믿지 않는다.
//
// ── 누가 쓸 수 있나 ───────────────────────────────────────────────────────
//   **로그인한 직원 전원**(2026-11-23 지시). 종전에 슈퍼관리자만 할 수 있던 이동·병합도
//   열렸다. 그대로 잠겨 있는 것은 **지우는 쪽**이다 — 회사→대리점 전환·삭제·복구.
//   퇴사자는 들어오지 못한다(lib/apiCaller.ts 가 401).
//
// ── 바꿀 수 있는 칸은 못 박는다 ───────────────────────────────────────────
//   화면이 보낸 patch 를 그대로 쓰지 않는다. 칸 이름을 흰 목록으로 거른다 —
//   그러지 않으면 is_parent·deleted_at 같은 칸까지 아무나 바꿀 수 있다.

import { NextResponse } from 'next/server'
import { loadCaller } from '@/lib/apiCaller'
import { disposePatch, restorePatch } from '@/lib/deviceStatus'
import { todayKST } from '@/lib/date'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  fieldChanges, writeCustomerEvents,
  type CustomerEventRow, type CustomerEventType, type FieldChange,
} from '@/lib/customerEvents'

const TAG = 'customer-change'

/** 사업장 줄에서 고칠 수 있는 칸. 그 밖의 칸은 버린다. */
const SITE_COLUMNS: Record<string, string> = {
  company_name: '회사·사업장 이름',
  site_name: '사업장명',
  address: '주소',
  region1: '지역1',
  region2: '지역2',
  agency_customer_id: '대리점',
  status: '상태',
  note: '메모',
  parent_customer_id: '소속 회사',
  latitude: '위도',
  longitude: '경도',
}
/** 담당자 칸. */
const CONTACT_COLUMNS: Record<string, string> = {
  name: '이름', department: '부서', position: '직급', phone: '전화', email: '이메일',
  // 2026-11-25 — 명함과 같은 칸. db/contacts_fields_20261125.sql 이 더한다.
  name_en: '영문 이름', mobile: '휴대폰', fax: '팩스', memo: '메모',
}

/** 아직 없을 수 있는 담당자 칸 — SQL 적용 전에는 빼고 담는다. */
const CONTACT_NEW = ['name_en', 'mobile', 'fax', 'memo'] as const
/** 장비 칸 — 사진·패킹리스트는 저장소를 거치므로 여기서 다루지 않는다. */
const DEVICE_COLUMNS: Record<string, string> = {
  device_name: '라인업', device_name2: '모델', option: '옵션', serial_number: 'S/N',
  program: '소프트웨어', install_date: '납입일', category: '계열',
}

/**
 * 담당자 표에 **아직 없는 칸은 빼고** 담는다 (2026-11-25).
 * db/contacts_fields_20261125.sql 을 돌리기 전에 그 칸을 같이 보내면 PGRST204 로
 * **담기 전체가 거절된다** — 영문 이름 때문에 담당자를 못 담는 일은 없어야 한다.
 * 한 번만 물어보고 과정이 사는 동안 기억한다(명함 영문 칸과 같은 길).
 */
let contactNewKnown: boolean | null = null
async function dropMissingContactColumns(
  patch: Record<string, unknown>,
  sb: SupabaseClient,
): Promise<Record<string, unknown>> {
  if (contactNewKnown == null) {
    const { error } = await sb.from('contacts').select('name_en').limit(1)
    contactNewKnown = !(error != null && (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205'))
    if (!contactNewKnown) {
      console.warn('[customer-change] 담당자 새 칸이 아직 없다 — db/contacts_fields_20261125.sql 전까지 빼고 담는다')
    }
  }
  if (contactNewKnown) return patch
  const out = { ...patch }
  for (const f of CONTACT_NEW) delete out[f]
  return out
}

/** 흰 목록에 있는 칸만 남긴다. */
function pick(patch: Record<string, unknown>, allowed: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch ?? {})) if (k in allowed) out[k] = v
  return out
}

const bad = (message: string) => NextResponse.json({ error: message }, { status: 400 })

/** 숫자 id 목록으로 다듬는다(빈 값·문자·중복을 버린다). */
function ids(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  const out = new Set<number>()
  for (const v of raw) {
    const n = Number(v)
    if (Number.isInteger(n) && n > 0) out.add(n)
  }
  return [...out]
}

export async function POST(req: Request) {
  const { error: authError, caller, sb } = await loadCaller({ kind: 'login' }, { tag: TAG, req, method: 'POST' })
  if (authError) return authError

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return bad('요청을 읽지 못했습니다')
  const action = String(body.action ?? '')
  const now = new Date().toISOString()
  const actor = caller.engineer_id

  /** 사건 한 줄 만들기 — actor·시각은 **세션에서** 넣는다. */
  const event = (customerId: number, type: CustomerEventType, payload: Record<string, unknown>): CustomerEventRow =>
    ({ customer_id: customerId, event_type: type, occurred_at: now, actor_engineer_id: actor, payload })

  // ── 고른 사업장들의 칸 하나 ───────────────────────────────────────────
  if (action === 'site-status' || action === 'site-agency') {
    const targets = ids(body.ids)
    if (targets.length === 0) return bad('바꿀 사업장을 고르세요')

    const isStatus = action === 'site-status'
    const column = isStatus ? 'status' : 'agency_customer_id'
    const value = isStatus
      ? String(body.status ?? '').trim()
      : (body.agencyId == null ? null : Number(body.agencyId))
    if (isStatus && !value) return bad('바꿀 상태를 고르세요')

    // 지금 값 — 사건의 before 다. 이름까지 읽어 두면 화면이 id 를 풀지 않아도 된다.
    const { data: beforeRows, error: readErr } = await sb
      .from('customers')
      .select('customer_id, company_name, status, agency_customer_id')
      .in('customer_id', targets)
    if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })

    const { error: upErr } = await sb.from('customers').update({ [column]: value }).in('customer_id', targets)
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

    // 대리점 이름 — 사건에 id 만 남기면 나중에 읽을 수 없다.
    const agencyIds = new Set<number>()
    for (const r of beforeRows ?? []) if (r.agency_customer_id != null) agencyIds.add(Number(r.agency_customer_id))
    if (!isStatus && value != null) agencyIds.add(Number(value))
    const names = new Map<number, string>()
    if (agencyIds.size > 0) {
      const { data: ag } = await sb.from('customers').select('customer_id, company_name').in('customer_id', [...agencyIds])
      for (const a of ag ?? []) names.set(Number(a.customer_id), (a.company_name ?? '').trim())
    }
    const label = (id: number | null) => (id == null ? '직판(ACCT-K)' : names.get(Number(id)) ?? `#${id}`)

    const rows: CustomerEventRow[] = []
    for (const r of beforeRows ?? []) {
      const before = isStatus ? (r.status ?? null) : label(r.agency_customer_id as number | null)
      const after = isStatus ? (value as string) : label(value as number | null)
      if (String(before ?? '') === String(after ?? '')) continue
      rows.push(event(Number(r.customer_id), isStatus ? 'site_status_changed' : 'site_agency_changed', {
        site_name: r.company_name ?? null, before, after,
      }))
    }
    const { written } = await writeCustomerEvents(sb, rows)
    return NextResponse.json({ ok: true, changed: targets.length, events: written })
  }

  // ── 회사 분류 일괄 지정 ───────────────────────────────────────────────
  if (action === 'company-industry') {
    const targets = ids(body.ids)
    const industry = String(body.industry ?? '').trim()
    if (targets.length === 0) return bad('바꿀 회사를 고르세요')
    if (!industry) return bad('분류를 고르세요')

    const { data: beforeRows, error: readErr } = await sb
      .from('customers').select('customer_id, company_name, industry').in('customer_id', targets)
    if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })

    const { error: upErr } = await sb.from('customers').update({ industry }).in('customer_id', targets)
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

    const rows = (beforeRows ?? [])
      .filter(r => (r.industry ?? '') !== industry)
      .map(r => event(Number(r.customer_id), 'company_industry_changed', {
        company_name: r.company_name ?? null, before: r.industry ?? null, after: industry,
      }))
    const { written } = await writeCustomerEvents(sb, rows)
    return NextResponse.json({ ok: true, changed: targets.length, events: written })
  }

  // ── 회사 한 줄 수정(분류·메모) ────────────────────────────────────────
  //   이름 바꾸기는 여기 없다 — 사업장 이름을 전부 다시 만드는 일이라 /api/parent-company
  //   의 rename 이 맡고 그쪽은 슈퍼관리자 문턱이다.
  //   사건은 **분류가 바뀐 때만** 적는다(메모는 적지 않는다 — 고친 자국을 남길 값이 아니다).
  if (action === 'company-edit') {
    const id = Number(body.id)
    if (!Number.isInteger(id) || id <= 0) return bad('회사를 찾지 못했습니다')
    const patch: Record<string, unknown> = {}
    if ('industry' in (body.patch as Record<string, unknown> ?? {})) {
      patch.industry = String((body.patch as Record<string, unknown>).industry ?? '').trim() || null
    }
    if ('note' in (body.patch as Record<string, unknown> ?? {})) {
      patch.note = String((body.patch as Record<string, unknown>).note ?? '').trim() || null
    }
    // 영문명 — **회사 줄 한 칸**이다. 회사명과 달리 사업장 이름을 다시 만들지 않으므로
    // 이름 바꾸기(슈퍼관리자)와 같은 문턱에 둘 까닭이 없다(2026-11-23).
    if ('name_en' in (body.patch as Record<string, unknown> ?? {})) {
      patch.name_en = String((body.patch as Record<string, unknown>).name_en ?? '').trim() || null
    }
    if (Object.keys(patch).length === 0) return bad('바꿀 값이 없습니다')

    const { data: before, error: readErr } = await sb
      .from('customers').select('customer_id, company_name, industry, note, is_parent').eq('customer_id', id).maybeSingle()
    if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
    if (!before) return bad('회사를 찾지 못했습니다')

    const { error: upErr } = await sb.from('customers').update(patch).eq('customer_id', id)
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

    const rows: CustomerEventRow[] = []
    if ('industry' in patch && String(before.industry ?? '') !== String(patch.industry ?? '')) {
      rows.push(event(id, 'company_industry_changed', {
        company_name: before.company_name ?? null,
        before: before.industry ?? null, after: patch.industry ?? null,
      }))
    }
    const { written } = await writeCustomerEvents(sb, rows)
    return NextResponse.json({ ok: true, events: written })
  }

  // ── 사업장 한 줄 수정 ─────────────────────────────────────────────────
  if (action === 'site-edit') {
    const id = Number(body.id)
    if (!Number.isInteger(id) || id <= 0) return bad('사업장을 찾지 못했습니다')
    const patch = pick(body.patch as Record<string, unknown>, SITE_COLUMNS)
    if (Object.keys(patch).length === 0) return bad('바꿀 값이 없습니다')

    const { data: before, error: readErr } = await sb
      .from('customers').select('*').eq('customer_id', id).maybeSingle()
    if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
    if (!before) return bad('사업장을 찾지 못했습니다')

    const { error: upErr } = await sb.from('customers').update(patch).eq('customer_id', id)
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

    const changes = fieldChanges(before as Record<string, unknown>, patch, SITE_COLUMNS)
    const rows = changes.length === 0 ? [] : [event(id, 'site_edited', {
      site_name: (before as { company_name?: string }).company_name ?? null,
      changes: trimChanges(changes),
    })]
    const { written } = await writeCustomerEvents(sb, rows)
    return NextResponse.json({ ok: true, events: written, changed: changes.length })
  }

  // ── 담당자 추가·수정 ──────────────────────────────────────────────────
  if (action === 'contact-add' || action === 'contact-edit') {
    const patch = await dropMissingContactColumns(pick(body.patch as Record<string, unknown>, CONTACT_COLUMNS), sb)
    if (!String(patch.name ?? '').trim()) return bad('이름을 입력해주세요')

    if (action === 'contact-add') {
      const customerId = Number(body.customerId)
      if (!Number.isInteger(customerId) || customerId <= 0) return bad('사업장을 찾지 못했습니다')
      const { data: made, error } = await sb.from('contacts')
        .insert({ customer_id: customerId, ...patch }).select('contact_id').single()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      const { written } = await writeCustomerEvents(sb, [event(customerId, 'contact_edited', {
        mode: 'add', contact_id: made.contact_id, name: patch.name ?? null,
        changes: trimChanges(fieldChanges(null, patch, CONTACT_COLUMNS)),
      })])
      return NextResponse.json({ ok: true, contact_id: made.contact_id, events: written })
    }

    const id = Number(body.id)
    if (!Number.isInteger(id) || id <= 0) return bad('담당자를 찾지 못했습니다')
    const { data: before, error: readErr } = await sb
      .from('contacts').select('*').eq('contact_id', id).maybeSingle()
    if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
    if (!before) return bad('담당자를 찾지 못했습니다')

    const { error } = await sb.from('contacts').update(patch).eq('contact_id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const changes = fieldChanges(before as Record<string, unknown>, patch, CONTACT_COLUMNS)
    const rows = changes.length === 0 ? [] : [event(Number((before as { customer_id: number }).customer_id), 'contact_edited', {
      mode: 'edit', contact_id: id, name: patch.name ?? null, changes: trimChanges(changes),
    })]
    const { written } = await writeCustomerEvents(sb, rows)
    return NextResponse.json({ ok: true, events: written, changed: changes.length })
  }

  // ── 장비 추가·수정 ────────────────────────────────────────────────────
  if (action === 'device-add' || action === 'device-edit') {
    const patch = pick(body.patch as Record<string, unknown>, DEVICE_COLUMNS)

    if (action === 'device-add') {
      const customerId = Number(body.customerId)
      if (!Number.isInteger(customerId) || customerId <= 0) return bad('사업장을 찾지 못했습니다')
      if (!String(patch.device_name ?? '').trim()) return bad('장비 라인업을 입력해주세요')
      const { data: made, error } = await sb.from('devices')
        .insert({ customer_id: customerId, ...patch }).select('device_id').single()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      const { written } = await writeCustomerEvents(sb, [event(customerId, 'device_edited', {
        mode: 'add', device_id: made.device_id,
        device: [patch.device_name, patch.device_name2].filter(Boolean).join(' ') || null,
        changes: trimChanges(fieldChanges(null, patch, DEVICE_COLUMNS)),
      })])
      return NextResponse.json({ ok: true, device_id: made.device_id, events: written })
    }

    const id = Number(body.id)
    if (!Number.isInteger(id) || id <= 0) return bad('장비를 찾지 못했습니다')
    const { data: before, error: readErr } = await sb
      .from('devices').select('*').eq('device_id', id).maybeSingle()
    if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
    if (!before) return bad('장비를 찾지 못했습니다')

    const { error } = await sb.from('devices').update(patch).eq('device_id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const changes = fieldChanges(before as Record<string, unknown>, patch, DEVICE_COLUMNS)
    const rows = changes.length === 0 ? [] : [event(Number((before as { customer_id: number }).customer_id), 'device_edited', {
      mode: 'edit', device_id: id,
      device: [patch.device_name ?? (before as { device_name?: string }).device_name,
        patch.device_name2 ?? (before as { device_name2?: string }).device_name2].filter(Boolean).join(' ') || null,
      changes: trimChanges(changes),
    })]
    const { written } = await writeCustomerEvents(sb, rows)
    return NextResponse.json({ ok: true, events: written, changed: changes.length })
  }

  // ── 장비 폐기·폐기 취소 ───────────────────────────────────────────────
  //
  // 2026-11-25 에 **화면에서 라우트로** 옮겼다. 전에는 브라우저가 devices 를 직접
  // update 했다 — 그 길은 ① 사건이 남지 않고(누가 언제 폐기했는지 알 수 없다)
  // ② 열 단위 GRANT·RLS 에 걸리면 42501 로 조용히 막힌다. 쓰기는 라우트가 한다.
  if (action === 'device-dispose' || action === 'device-restore') {
    const id = Number(body.id)
    if (!Number.isInteger(id) || id <= 0) return bad('장비를 찾지 못했습니다')
    const { data: before, error: readErr } = await sb
      .from('devices').select('device_id, customer_id, device_name, device_name2, status, disposed_at')
      .eq('device_id', id).maybeSingle()
    if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
    if (!before) return bad('장비를 찾지 못했습니다')

    const dispose = action === 'device-dispose'
    const patch = dispose ? disposePatch(todayKST()) : restorePatch()
    const { error } = await sb.from('devices').update(patch).eq('device_id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const name = [before.device_name, before.device_name2].filter(Boolean).join(' ') || null
    const { written } = await writeCustomerEvents(sb, [event(Number(before.customer_id), 'device_edited', {
      mode: dispose ? 'dispose' : 'undispose',
      device_id: id, device: name,
      changes: trimChanges(fieldChanges(before as Record<string, unknown>, patch, DEVICE_COLUMNS)),
    })])
    console.log(`[${TAG}] ${action}`, { id, by: caller.email })
    return NextResponse.json({ ok: true, events: written })
  }

  // ── 장비 **사진·패킹리스트의 경로** ───────────────────────────────────
  //
  // 2026-11-26 에 화면에서 라우트로 옮겼다. 파일 자체는 브라우저가 저장소(Storage)에
  // 올리고, **devices 의 경로 칸**은 여기서 쓴다. 전에는 브라우저가 그 두 칸을 직접
  // update 했다 — 「쓰기는 service role 라우트에서만」에서 마지막까지 남아 있던 자리다.
  //   · 사진을 지울 때는 path 를 null 로 보낸다(그때만 null 을 받는다).
  //   · 사건은 경로가 아니라 **있다/없다**로 적는다 — 긴 파일 이름은 이력에서 읽히지 않는다.
  if (action === 'device-photo' || action === 'device-packing') {
    const id = Number(body.id)
    if (!Number.isInteger(id) || id <= 0) return bad('장비를 찾지 못했습니다')
    const photo = action === 'device-photo'
    const column = photo ? 'image_url' : 'packing_list_url'
    const raw = body.path
    const path = raw == null ? null : String(raw).trim()
    if (path === '') return bad('파일 경로가 없습니다')
    if (path === null && !photo) return bad('파일 경로가 없습니다')   // 패킹리스트는 비우지 않는다
    if (path && path.length > 300) return bad('파일 경로가 너무 깁니다')

    const { data: before, error: readErr } = await sb
      .from('devices').select(`device_id, customer_id, device_name, device_name2, ${column}`)
      .eq('device_id', id).maybeSingle()
    if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
    if (!before) return bad('장비를 찾지 못했습니다')

    const { error } = await sb.from('devices').update({ [column]: path }).eq('device_id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const had = !!(before as Record<string, unknown>)[column]
    const name = [before.device_name, before.device_name2].filter(Boolean).join(' ') || null
    const { written } = await writeCustomerEvents(sb, [event(Number(before.customer_id), 'device_edited', {
      mode: photo ? 'photo' : 'packing',
      device_id: id, device: name,
      changes: [{
        field: column, label: photo ? '장비 사진' : '패킹리스트',
        before: had ? '있음' : null, after: path ? '있음' : null,
      }],
    })])
    console.log(`[${TAG}] ${action}`, { id, by: caller.email, cleared: path === null })
    return NextResponse.json({ ok: true, events: written })
  }

  return bad('모르는 작업입니다')
}

/** 사건 한 줄이 너무 커지지 않게 — 긴 값은 줄이고 칸 수도 끊는다. */
function trimChanges(changes: FieldChange[]): FieldChange[] {
  const cut = (v: string | null) => (v == null ? null : v.length > 80 ? `${v.slice(0, 80)}…` : v)
  return changes.slice(0, 12).map(c => ({ ...c, before: cut(c.before), after: cut(c.after) }))
}
