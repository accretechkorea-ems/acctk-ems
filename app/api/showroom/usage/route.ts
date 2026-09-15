// 쇼룸 사용 기록 작성·수정·삭제. 엑셀 「장비 사용승인서」 항목을 담는다.
//
// 새 테이블에는 읽기 정책만 있으므로 쓰기는 전부 service role 로 한다.
// 검증은 전부 여기서 다시 한다 — 화면이 보낸 값은 믿지 않는다.
//   · 장비가 showroom_sites 사무실 소속이고, 설정 is_active 가 false 가 아닌지
//   · 종료 > 시작, 점심(12:00~13:00)을 빼고도 작업시간이 남는지
//     (work_hours = computeWorkHours(시작, 종료) 를 서버에서 계산해 저장한다)
//   · 목적이 5종 중 하나인지, 측정대행·고객 데모면 대상 고객사가 있는지
//   · 고객 데모는 사용 신청(/api/showroom/requests)으로만 들어온다 — 새 기록(POST)의 목적이 고객 데모면 400.
//     승인·사후 신청 때 서버가 만든 기록은 예외라 수정(PATCH)은 된다. 다만 신청으로 만든 기록은 목적을 바꿀 수 없고,
//     다른 목적의 기록을 고객 데모로 바꿀 수도 없다.
//   · 목적에 없는 항목(lib/showroom.ts PURPOSE_FIELDS)은 보낸 값을 버리고 null 로 저장한다
//     (예: 유지보수에 customer_id 가 와도 null). 외부반출은 NOT NULL 이라 false.
//   · nda_status·result_category 가 정해진 값이거나 비어 있는지
//   · 연결한 견적이 실제로 있는지
//   · 같은 장비·같은 날짜에 시간이 겹치는 기록이 없는지
//   · 참여 엔지니어 최소 1명
//
// 신청서(데모 승인)는 이번 범위가 아니다 — request_id 는 null 로 둔다.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { canViewCustomers, isSuperAdmin } from '@/lib/permissions'
import { withTeamPerm } from '@/lib/teamPermsServer'
import { toMin, computeWorkHours, normTime, TIME_MIN, TIME_MAX } from '@/lib/workHours'
import {
  isUsagePurpose, purposeNeedsCustomer, optionalOneOf, DEMO_PURPOSE,
  NDA_STATUSES, RESULT_CATEGORIES, PURPOSE_FIELDS, type UsageField,
  ensureDeviceConfig, assertShowroomDevice,
} from '@/lib/showroom'

type Caller = { engineer_id: number; name: string | null; permission_level: string | null; teams: string | null }

const admin = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

const DEMO_VIA_REQUEST = '고객 데모는 사용 신청으로 등록해주세요(관리자 승인을 거칩니다).'

/** 로그인 + 고객사 권한 확인. app/api/requests/quote-delete/route.ts 의 authorize() 와 같은 모양이다. */
async function authorize() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: bad('Unauthorized', 401), caller: null }

  const { data: callerRow, error: callerErr } = await supabase
    .from('engineers')
    .select('engineer_id, name, permission_level, teams')
    .eq('email', user.email!)
    .single()
  if (callerErr) console.error('[showroom/usage] caller lookup failed', { email: user.email, error: callerErr })
  if (!callerRow) return { error: bad('Forbidden', 403), caller: null }

  const caller = await withTeamPerm(callerRow as Caller, { fresh: true })
  if (!caller || !canViewCustomers(caller)) return { error: bad('Forbidden', 403), caller: null }

  return { error: null, caller }
}

const YMD = /^\d{4}-\d{2}-\d{2}$/
const HHMM = /^\d{2}:\d{2}$/

type ValidInput = {
  device_id: number
  usage_date: string
  start_time: string
  end_time: string
  work_hours: number
  purpose: string
  customer_id: number | null
  project_name: string | null
  customer_dept: string | null
  content: string | null
  sample_material: string | null
  carried_out: boolean
  expected_cost: number | null
  nda_status: string | null
  expected_result: string | null
  result: string | null
  result_category: string | null
  issue: string | null
  follow_up: string | null
  quote_id: number | null
  note: string | null
  engineerIds: number[]
}

const text = (v: unknown): string | null => (typeof v === 'string' ? v.trim() || null : null)

/**
 * 본문 검증 + work_hours 재계산 + 겹침 확인.
 * excludeUsageId 를 주면 겹침 검사에서 그 기록(자기 자신)을 뺀다.
 */
async function validateBody(
  sb: SupabaseClient,
  body: Record<string, unknown>,
  excludeUsageId: number | null,
): Promise<{ error: NextResponse; value: null } | { error: null; value: ValidInput }> {
  const fail = (m: string, s = 400) => ({ error: bad(m, s), value: null as null })

  const deviceId = Number(body.device_id)
  if (!Number.isInteger(deviceId) || deviceId <= 0) return fail('장비를 선택해주세요.')

  const usageDate = typeof body.usage_date === 'string' ? body.usage_date.trim() : ''
  if (!YMD.test(usageDate)) return fail('사용일자를 입력해주세요.')

  const startTime = normTime(typeof body.start_time === 'string' ? body.start_time : '')
  const endTime = normTime(typeof body.end_time === 'string' ? body.end_time : '')
  if (!HHMM.test(startTime) || !HHMM.test(endTime)) return fail('사용 시간을 입력해주세요.')

  const s = toMin(startTime)
  const e = toMin(endTime)
  if (s < TIME_MIN || s > TIME_MAX || e < TIME_MIN || e > TIME_MAX) return fail('사용 시간이 올바르지 않습니다.')
  if (e <= s) return fail('종료시간을 시작시간 이후로 설정해주세요.')

  // 실사용시간 = 점심(12:00~13:00)을 뺀 작업시간. 화면이 보낸 값이 아니라 여기서 계산한 값을 저장한다.
  const workHours = computeWorkHours(startTime, endTime)
  if (workHours <= 0) return fail('점심시간을 제외하면 작업시간이 0입니다.')

  const purpose = typeof body.purpose === 'string' ? body.purpose : ''
  if (!isUsagePurpose(purpose)) return fail('사용목적을 선택해주세요.')
  // 이 목적에 있는 항목인지. 없는 항목은 화면이 무엇을 보냈든 버린다(null 로 저장).
  const has = (f: UsageField) => PURPOSE_FIELDS[purpose].includes(f)
  const field = (f: UsageField, v: unknown) => (has(f) ? text(v) : null)

  let customerId: number | null = null
  if (has('customer')) {
    const customerRaw = body.customer_id
    customerId = customerRaw === undefined || customerRaw === null || customerRaw === '' ? null : Number(customerRaw)
    if (customerId !== null && (!Number.isInteger(customerId) || customerId <= 0)) return fail('대상 고객사가 올바르지 않습니다.')
  }
  if (purposeNeedsCustomer(purpose) && customerId === null) return fail(`${purpose}는 대상 고객사가 필요합니다.`)

  const nda = has('nda_status') ? optionalOneOf(body.nda_status, NDA_STATUSES) : { ok: true, value: null }
  if (!nda.ok) return fail('NDA 상태가 올바르지 않습니다.')
  const resultCat = has('result_category') ? optionalOneOf(body.result_category, RESULT_CATEGORIES) : { ok: true, value: null }
  if (!resultCat.ok) return fail('결과분류가 올바르지 않습니다.')

  const costRaw = has('expected_cost') ? body.expected_cost : null
  const expectedCost = costRaw === undefined || costRaw === null || costRaw === '' ? null : Number(costRaw)
  if (expectedCost !== null && (!Number.isInteger(expectedCost) || expectedCost < 0)) {
    return fail('예상비용은 0 이상 정수로 입력해주세요.')
  }

  const rawIds = Array.isArray(body.engineer_ids) ? body.engineer_ids : []
  const engineerIds = [...new Set(rawIds.map(Number).filter(n => Number.isInteger(n) && n > 0))]
  if (engineerIds.length === 0) return fail('참여 엔지니어를 선택해주세요.')

  // 쇼룸 장비인지 — showroom_sites 사무실 소속 + 삭제되지 않은 devices 행.
  const notDevice = await assertShowroomDevice(sb, deviceId)
  if (notDevice) return fail(notDevice, 404)

  // 설정 행이 없으면 기본값으로 만든다(사용 기록이 FK 로 참조한다). 사용여부 N 이면 막는다.
  const cfgErr = await ensureDeviceConfig(sb, deviceId)
  if (cfgErr) return fail(cfgErr, 400)

  // 연결한 견적이 실제로 있는지.
  const quoteRaw = has('quote') ? body.quote_id : null
  const quoteId = quoteRaw === undefined || quoteRaw === null || quoteRaw === '' ? null : Number(quoteRaw)
  if (quoteId !== null) {
    if (!Number.isInteger(quoteId) || quoteId <= 0) return fail('연결한 견적이 올바르지 않습니다.')
    const { data: quote, error: qErr } = await sb
      .from('quotes').select('quote_id').eq('quote_id', quoteId).maybeSingle()
    if (qErr) {
      console.error('[showroom/usage] quote lookup failed', { quoteId, error: qErr })
      return fail('견적을 확인하지 못했습니다.', 500)
    }
    if (!quote) return fail('연결한 견적을 찾을 수 없습니다.', 404)
  }

  // 겹침: 기존.start_time < 신규.end_time and 기존.end_time > 신규.start_time
  const { data: clash, error: clashErr } = await sb
    .from('showroom_usage')
    .select('usage_id, start_time, end_time')
    .eq('device_id', deviceId)
    .eq('usage_date', usageDate)
    .is('deleted_at', null)
    .lt('start_time', endTime)
    .gt('end_time', startTime)
  if (clashErr) {
    console.error('[showroom/usage] overlap check failed', { deviceId, usageDate, error: clashErr })
    return fail('사용 기록을 확인하지 못했습니다.', 500)
  }
  const hit = (clash ?? []).find(r => r.usage_id !== excludeUsageId)
  if (hit) {
    return fail(`같은 장비에 겹치는 사용 기록이 있습니다 (${normTime(hit.start_time)}~${normTime(hit.end_time)})`, 409)
  }

  return {
    error: null,
    value: {
      device_id: deviceId,
      usage_date: usageDate,
      start_time: startTime,
      end_time: endTime,
      work_hours: workHours,
      purpose,
      customer_id: customerId,
      project_name: field('project_name', body.project_name),
      customer_dept: field('customer_dept', body.customer_dept),
      content: field('content', body.content),
      sample_material: field('sample_material', body.sample_material),
      carried_out: has('carried_out') && body.carried_out === true,
      expected_cost: expectedCost,
      nda_status: nda.value,
      expected_result: field('expected_result', body.expected_result),
      result: field('result', body.result),
      result_category: resultCat.value,
      issue: field('issue', body.issue),
      follow_up: field('follow_up', body.follow_up),
      quote_id: quoteId,
      note: field('note', body.note),
      engineerIds,
    },
  }
}

/** insert/update 에 넣을 컬럼 묶음(engineerIds 만 뺀 것). */
const usageColumns = (v: ValidInput) => ({
  device_id: v.device_id,
  usage_date: v.usage_date,
  start_time: v.start_time,
  end_time: v.end_time,
  work_hours: v.work_hours,
  purpose: v.purpose,
  customer_id: v.customer_id,
  project_name: v.project_name,
  customer_dept: v.customer_dept,
  content: v.content,
  sample_material: v.sample_material,
  carried_out: v.carried_out,
  expected_cost: v.expected_cost,
  nda_status: v.nda_status,
  expected_result: v.expected_result,
  result: v.result,
  result_category: v.result_category,
  issue: v.issue,
  follow_up: v.follow_up,
  quote_id: v.quote_id,
  note: v.note,
})

const engineerRows = (usageId: number, ids: number[]) =>
  ids.map(engineer_id => ({ usage_id: usageId, engineer_id }))

// ── POST: 작성 ──────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await authorize()
  if (auth.error) return auth.error
  const caller = auth.caller

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  // 고객 데모는 사용 신청으로만 들어온다(승인·확인을 거친다).
  if (body.purpose === DEMO_PURPOSE) return bad(DEMO_VIA_REQUEST)
  const supabaseAdmin = admin()

  const v = await validateBody(supabaseAdmin, body, null)
  if (v.error) return v.error
  const input = v.value

  const { data: created, error: insErr } = await supabaseAdmin
    .from('showroom_usage')
    .insert({
      ...usageColumns(input),
      request_id: null,           // 신청서 연동은 다음 단계
      created_by: caller.engineer_id,
    })
    .select('usage_id')
    .single()
  if (insErr || !created) {
    console.error('[showroom/usage] insert failed', { error: insErr })
    return bad('사용 기록 저장에 실패했습니다.', 500)
  }

  // 참여 엔지니어까지 들어가야 한 건이 완성된다. 실패하면 방금 만든 행을 지워
  // 엔지니어가 없는 반쪽 기록이 남지 않게 한다.
  const { error: engErr } = await supabaseAdmin
    .from('showroom_usage_engineers')
    .insert(engineerRows(created.usage_id, input.engineerIds))
  if (engErr) {
    console.error('[showroom/usage] engineer insert failed, rolling back', { usageId: created.usage_id, error: engErr })
    const { error: rbErr } = await supabaseAdmin.from('showroom_usage').delete().eq('usage_id', created.usage_id)
    if (rbErr) console.error('[showroom/usage] rollback failed', { usageId: created.usage_id, error: rbErr })
    return bad('참여 엔지니어 저장에 실패했습니다.', 500)
  }

  return NextResponse.json({ success: true, usage_id: created.usage_id })
}

// ── PATCH: 수정 ─────────────────────────────────────────────────────
export async function PATCH(req: NextRequest) {
  const auth = await authorize()
  if (auth.error) return auth.error
  const caller = auth.caller

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const usageId = Number(body.usage_id)
  if (!Number.isInteger(usageId) || usageId <= 0) return bad('사용 기록을 지정해주세요.')

  const supabaseAdmin = admin()

  const { data: row, error: rowErr } = await supabaseAdmin
    .from('showroom_usage')
    .select('usage_id, created_by, deleted_at, purpose, request_id')
    .eq('usage_id', usageId)
    .maybeSingle()
  if (rowErr) {
    console.error('[showroom/usage] row lookup failed', { usageId, error: rowErr })
    return bad('사용 기록을 불러오지 못했습니다.', 500)
  }
  if (!row || row.deleted_at) return bad('사용 기록을 찾을 수 없습니다.', 404)
  if (row.created_by !== caller.engineer_id && !isSuperAdmin(caller)) return bad('Forbidden', 403)

  // 목적 바꾸기 규칙 — 신청으로 만든 기록은 목적을 그대로 두고, 다른 목적을 고객 데모로 바꾸지 못한다.
  const nextPurpose = typeof body.purpose === 'string' ? body.purpose : ''
  if (row.request_id != null && nextPurpose !== row.purpose) return bad('신청으로 만든 사용 기록은 사용목적을 바꿀 수 없습니다.')
  if (nextPurpose === DEMO_PURPOSE && row.purpose !== DEMO_PURPOSE) return bad(DEMO_VIA_REQUEST)

  const v = await validateBody(supabaseAdmin, body, usageId)
  if (v.error) return v.error
  const input = v.value

  const { error: updErr } = await supabaseAdmin
    .from('showroom_usage')
    .update({ ...usageColumns(input), updated_at: new Date().toISOString() })
    .eq('usage_id', usageId)
  if (updErr) {
    console.error('[showroom/usage] update failed', { usageId, error: updErr })
    return bad('사용 기록 수정에 실패했습니다.', 500)
  }

  // 참여 엔지니어는 통째로 갈아 끼운다((usage_id, engineer_id)가 PK 라 지우고 다시 넣는다).
  // 다시 넣기가 실패하면 엔지니어가 없는 기록이 되므로 원래 명단을 되돌린다.
  const { data: before } = await supabaseAdmin
    .from('showroom_usage_engineers').select('engineer_id').eq('usage_id', usageId)
  const beforeIds = (before ?? []).map((r: { engineer_id: number }) => r.engineer_id)

  const { error: delErr } = await supabaseAdmin
    .from('showroom_usage_engineers').delete().eq('usage_id', usageId)
  if (delErr) {
    console.error('[showroom/usage] engineer clear failed', { usageId, error: delErr })
    return bad('참여 엔지니어 수정에 실패했습니다.', 500)
  }

  const { error: engErr } = await supabaseAdmin
    .from('showroom_usage_engineers').insert(engineerRows(usageId, input.engineerIds))
  if (engErr) {
    console.error('[showroom/usage] engineer insert failed, restoring', { usageId, error: engErr })
    if (beforeIds.length > 0) {
      const { error: rbErr } = await supabaseAdmin
        .from('showroom_usage_engineers').insert(engineerRows(usageId, beforeIds))
      if (rbErr) console.error('[showroom/usage] engineer restore failed', { usageId, error: rbErr })
    }
    return bad('참여 엔지니어 수정에 실패했습니다.', 500)
  }

  return NextResponse.json({ success: true, usage_id: usageId })
}

// ── DELETE: 삭제(deleted_at 설정) ───────────────────────────────────
export async function DELETE(req: NextRequest) {
  const auth = await authorize()
  if (auth.error) return auth.error
  const caller = auth.caller

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const usageId = Number(body.usage_id)
  if (!Number.isInteger(usageId) || usageId <= 0) return bad('사용 기록을 지정해주세요.')

  const supabaseAdmin = admin()

  const { data: row, error: rowErr } = await supabaseAdmin
    .from('showroom_usage')
    .select('usage_id, created_by, deleted_at, purpose, request_id')
    .eq('usage_id', usageId)
    .maybeSingle()
  if (rowErr) {
    console.error('[showroom/usage] row lookup failed', { usageId, error: rowErr })
    return bad('사용 기록을 불러오지 못했습니다.', 500)
  }
  if (!row) return bad('사용 기록을 찾을 수 없습니다.', 404)
  if (row.deleted_at) return bad('이미 삭제된 기록입니다.', 409)
  if (row.created_by !== caller.engineer_id && !isSuperAdmin(caller)) return bad('Forbidden', 403)

  // 이미 지워진 건을 다시 지우지 않도록 조건을 함께 건다(동시 처리 방지).
  const now = new Date().toISOString()
  const { data: deleted, error: delErr } = await supabaseAdmin
    .from('showroom_usage')
    .update({ deleted_at: now, updated_at: now })
    .eq('usage_id', usageId)
    .is('deleted_at', null)
    .select('usage_id')
  if (delErr) {
    console.error('[showroom/usage] delete failed', { usageId, error: delErr })
    return bad('사용 기록 삭제에 실패했습니다.', 500)
  }
  if (!deleted || deleted.length === 0) return bad('이미 삭제된 기록입니다.', 409)

  return NextResponse.json({ success: true, usage_id: usageId })
}
