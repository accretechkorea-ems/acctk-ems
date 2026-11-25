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
import { forecastPatch, type ForecastNow, type LinkedQuote } from '@/lib/forecastSync'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  fieldChanges, writeCustomerEvents,
  type CustomerEventRow, type CustomerEventType, type FieldChange,
} from '@/lib/customerEvents'

const TAG = 'customer-change'

/**
 * 수리 완료가 만드는 **영업활동의 종류**. 목록(activity_types)에도 같은 글자가 있어야
 * 활동 현황의 거르기·색이 맞는다(db/activity_type_as_20261126.sql).
 */
const REPAIR_ACTIVITY_TYPE = 'A/S'

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
  // 2026-11-26 — 마스터 밖 값으로 적었는가(db/equipment_master_20261126.sql 이 더한다).
  master_pending: '마스터 밖',
  // 납품 예정 장비(E) — 설치 예정월. 칸이 없으면 아래 dropMissingDeviceColumns 가 뺀다.
  install_due_month: '설치 예정월',
}
/** 장비 표에 **아직 없을 수 있는** 칸 — SQL 적용 전에는 빼고 담는다. */
const DEVICE_NEW: readonly string[] = ['master_pending', 'install_due_month']
let deviceNewKnown: boolean | null = null

/**
 * 장비의 새 칸이 아직 없으면 빼고 담는다(2026-11-26) — 담당자 쪽과 같은 길이다.
 * 한 칸 때문에 **장비 등록 전체가 거절되는** 일은 없어야 한다.
 */
async function dropMissingDeviceColumns(
  patch: Record<string, unknown>,
  sb: SupabaseClient,
): Promise<Record<string, unknown>> {
  if (deviceNewKnown == null) {
    const { error } = await sb.from('devices').select('master_pending').limit(1)
    deviceNewKnown = !(error != null && (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205'))
    if (!deviceNewKnown) {
      console.warn('[customer-change] 장비 새 칸이 아직 없다 — db/equipment_master_20261126.sql·devices_delivery_20261126.sql 전까지 빼고 담는다')
    }
  }
  if (deviceNewKnown) return patch
  const out = { ...patch }
  for (const f of DEVICE_NEW) delete out[f]
  return out
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
    const patch = await dropMissingDeviceColumns(pick(body.patch as Record<string, unknown>, DEVICE_COLUMNS), sb)

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
    // 납입의사록·패킹리스트는 **PDF 만**이다(2026-11-26 지시). 화면도 그렇게 받지만
    // 서버가 한 번 더 본다 — 라우트를 직접 부르면 화면의 accept 는 지나가지 않는다.
    if (!photo && path && !/\.pdf$/i.test(path)) return bad('납입의사록·패킹리스트는 PDF 만 올릴 수 있습니다')

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

  // ── 수리 완료 ↔ 영업활동 한 줄(A/S) ──────────────────────────────────
  //
  // 20 수리의 **수리 완료**(repair_done_at)는 현장에 다녀온 일이다 — 활동 현황에서
  // 그 일이 보이지 않아 「아무 접점이 없는 업체」로 읽히던 자리다(2026-11-26 지시).
  // 완료할 때 영업활동 한 줄을 자동으로 만들고, 완료를 취소하면 그 줄을 지운다.
  //
  //   · 종류는 'A/S' 하나다(db/activity_type_as_20261126.sql 이 목록에 더한다).
  //   · 내용 첫 줄의 **[수리 #N]** 이 자국이다 — 지울 때 그 줄만 집는다.
  //     사람이 쓴 줄은 종류가 다르고(방문미팅 등) 이 자국도 없다.
  //   · 고객사가 붙지 않은 수리 건은 만들지 않는다(활동은 고객사 줄에 달린다).
  if (action === 'repair-done' || action === 'repair-undone') {
    const repairId = Number(body.repairId)
    if (!Number.isInteger(repairId) || repairId <= 0) return bad('수리 건을 찾지 못했습니다')
    const { data: rep, error: readErr } = await sb
      .from('repairs')
      .select('repair_id, customer_id, customer_name, product_type, item_type, serial_number, repair_done_at, shipped_date, created_by')
      .eq('repair_id', repairId).maybeSingle()
    if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
    if (!rep) return bad('수리 건을 찾지 못했습니다')

    const mark = `[수리 #${repairId}]`
    // 자국이 붙은 **자동 줄만** 지운다 — 먼저 지우고 다시 넣는다(두 번 눌러도 하나다).
    const { error: delErr } = await sb.from('sales_activities')
      .delete().eq('activity_type', REPAIR_ACTIVITY_TYPE).like('content', `${mark}%`)
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

    if (action === 'repair-undone') {
      console.log(`[${TAG}] repair-undone`, { repairId, by: caller.email })
      return NextResponse.json({ ok: true, removed: true })
    }

    const customerId = Number(rep.customer_id)
    if (!Number.isInteger(customerId) || customerId <= 0) {
      // 고객사가 안 붙은 건이다 — 만들지 않는다(막지도 않는다. 수리 자체는 끝났다).
      return NextResponse.json({ ok: true, skipped: '고객사 없음' })
    }
    const model = [rep.product_type, rep.item_type].map(v => String(v ?? '').trim()).filter(Boolean)[0] ?? null
    const line = [String(rep.customer_name ?? '').trim() || null, model, rep.serial_number ? `S/N ${rep.serial_number}` : null]
      .filter(Boolean).join(' · ')
    const when = String(rep.repair_done_at ?? rep.shipped_date ?? '').slice(0, 10) || todayKST()
    const { error: insErr } = await sb.from('sales_activities').insert({
      customer_id: customerId,
      engineer_id: rep.created_by ?? caller.engineer_id,
      activity_date: when,
      activity_type: REPAIR_ACTIVITY_TYPE,
      content: `${mark} ${line}`,
    })
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
    console.log(`[${TAG}] repair-done`, { repairId, customerId, by: caller.email })
    return NextResponse.json({ ok: true, made: true })
  }

  // ── 포캐스트 ↔ 연결 견적 맞추기 ──────────────────────────────────────
  //
  // 견적의 상태가 바뀔 때마다 부른다(lib/quoteMutations.ts · 발주 라우트).
  // 규칙은 lib/forecastSync.ts 한 곳에 있다 — **올리는 쪽으로만** 간다.
  // 포캐스트를 못 찾거나 바꿀 것이 없으면 조용히 끝난다(견적 쪽 일을 막지 않는다).
  if (action === 'forecast-sync') {
    const quoteId = Number(body.quoteId)
    const oppFromBody = Number(body.opportunityId)
    let oppId = Number.isInteger(oppFromBody) && oppFromBody > 0 ? oppFromBody : 0
    if (!oppId) {
      if (!Number.isInteger(quoteId) || quoteId <= 0) return bad('견적을 찾지 못했습니다')
      const { data: q } = await sb.from('quotes').select('opportunity_id').eq('quote_id', quoteId).maybeSingle()
      oppId = Number(q?.opportunity_id ?? 0)
    }
    if (!oppId) return NextResponse.json({ ok: true, skipped: '연결된 포캐스트 없음' })

    const [{ data: opp }, { data: linked }] = await Promise.all([
      sb.from('sales_opportunities').select('opportunity_id, stage, expected_amount, closed_at').eq('opportunity_id', oppId).maybeSingle(),
      sb.from('quotes').select('quote_id, status, total_supply, purchase_order_at').eq('opportunity_id', oppId),
    ])
    if (!opp) return NextResponse.json({ ok: true, skipped: '포캐스트를 찾지 못함' })

    const patch = forecastPatch(opp as ForecastNow, (linked ?? []) as LinkedQuote[])
    if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true, changed: false })
    const { error } = await sb.from('sales_opportunities').update(patch).eq('opportunity_id', oppId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    console.log(`[${TAG}] forecast-sync`, { oppId, patch, by: caller.email })
    return NextResponse.json({ ok: true, changed: true, patch })
  }

  // ── 견적 ↔ 포캐스트 **걸고 풀기** (2026-11-26) ────────────────────────
  //
  // 견적을 쓴 뒤에 생각나는 일이 더 많다 — 목록에서도 걸고 푼다.
  // 바꾼 뒤에는 **옛 포캐스트와 새 포캐스트 둘 다** 다시 셈한다(금액이 옮겨 간다).
  if (action === 'quote-forecast-link') {
    const quoteId = Number(body.quoteId)
    if (!Number.isInteger(quoteId) || quoteId <= 0) return bad('견적을 찾지 못했습니다')
    const raw = body.opportunityId
    const next = raw == null ? null : Number(raw)
    if (next !== null && (!Number.isInteger(next) || next <= 0)) return bad('포캐스트를 찾지 못했습니다')

    const { data: q, error: readErr } = await sb
      .from('quotes').select('quote_id, quote_number, customer_id, opportunity_id').eq('quote_id', quoteId).maybeSingle()
    if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
    if (!q) return bad('견적을 찾지 못했습니다')
    const before = q.opportunity_id == null ? null : Number(q.opportunity_id)
    if (before === next) return NextResponse.json({ ok: true, changed: false })

    // 거는 포캐스트는 **그 견적의 업체 것**이어야 한다(남의 회사 딜에 걸리지 않게).
    let nextTitle: string | null = null
    if (next !== null) {
      const { data: opp } = await sb.from('sales_opportunities')
        .select('opportunity_id, customer_id, title').eq('opportunity_id', next).maybeSingle()
      if (!opp) return bad('포캐스트를 찾지 못했습니다')
      if (Number(opp.customer_id) !== Number(q.customer_id)) return bad('다른 업체의 포캐스트입니다')
      nextTitle = (opp.title as string) ?? null
    }

    const { error } = await sb.from('quotes').update({ opportunity_id: next }).eq('quote_id', quoteId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // 옛 쪽·새 쪽 모두 다시 셈한다. 하나는 금액이 빠지고 하나는 더해진다.
    for (const id of [before, next]) {
      if (id == null) continue
      const [{ data: opp }, { data: linked }] = await Promise.all([
        sb.from('sales_opportunities').select('opportunity_id, stage, expected_amount, closed_at').eq('opportunity_id', id).maybeSingle(),
        sb.from('quotes').select('quote_id, status, total_supply, purchase_order_at').eq('opportunity_id', id),
      ])
      if (!opp) continue
      const patch = forecastPatch(opp as ForecastNow, (linked ?? []) as LinkedQuote[])
      if (Object.keys(patch).length > 0) await sb.from('sales_opportunities').update(patch).eq('opportunity_id', id)
    }

    const customerId = Number(q.customer_id)
    const { written } = Number.isInteger(customerId) && customerId > 0
      ? await writeCustomerEvents(sb, [event(customerId, 'quote_forecast_linked', {
        quote_id: quoteId, quote_no: q.quote_number ?? null,
        before, after: next, forecast: nextTitle,
      })])
      : { written: 0 }
    console.log(`[${TAG}] quote-forecast-link`, { quoteId, before, next, by: caller.email })
    return NextResponse.json({ ok: true, changed: true, events: written })
  }

  return bad('모르는 작업입니다')
}

/** 사건 한 줄이 너무 커지지 않게 — 긴 값은 줄이고 칸 수도 끊는다. */
function trimChanges(changes: FieldChange[]): FieldChange[] {
  const cut = (v: string | null) => (v == null ? null : v.length > 80 ? `${v.slice(0, 80)}…` : v)
  return changes.slice(0, 12).map(c => ({ ...c, before: cut(c.before), after: cut(c.after) }))
}
