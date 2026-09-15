// 쇼룸 데모 사용 신청 — 서버 라우트 공용 코드. 라우트 파일은 GET/POST 같은 핸들러 말고는 내보낼 수 없어 여기 둔다.
//   쓰는 곳: app/api/showroom/requests/route.ts(신청·재작성), app/api/showroom/requests/pdf/route.ts(승인서 열기),
//            app/api/requests/showroom-demo/route.ts(요청함 목록·승인·반려·확인)
//
// 흐름
//   신청    → approval_requests '대기중' + 승인서 PDF → superadmin 전원(본인 제외)에게 알림
//             사전·사후는 사용일자로 정한다(KST 오늘 뒤 = 사전, 오늘까지 = 사후 — 화면의 플래그는 보지 않는다).
//             사후 신청(이미 끝난 사용)은 사용 기록도 바로 만든다. 상태는 사전 신청과 같이 '대기중'으로 두고, superadmin 이
//             요청함에서 [확인]하면 그 사람을 승인자로 '승인'이 된다(표기는 「확인」). '승인'은 승인자·결정시각이
//             있어야 하고(ar_decided_fields) 승인자가 신청자일 수 없어서(ar_no_self_approve) 신청하는 순간 넣을 수 없다.
//   승인    → '승인' + 사용 기록(계획 시간을 실제 시간으로, 작성자는 신청자) + 도장 찍은 PDF 로 교체 → 신청자 알림
//   반려    → '반려' + 사유 → 신청자 알림. PDF 는 그대로 둔다(재작성 때 바뀐다)
//   확인    → (사후 신청) '승인' + 도장 찍은 PDF 로 교체. 요청 알림만 읽음으로 바꾼다
//   재작성  → 반려 건만·신청자 본인만 → '대기중' 으로 되돌리고 PDF 교체 → superadmin 알림
//
// 쓰기는 전부 service role 로 한다(approval_requests·showroom_usage 에는 읽기 정책만 있다).
// 승인서 PDF 는 비공개 버킷 showroom-approvals 에 올린다. 파일 이름 규칙은 견적서와 같다 —
// 덮어쓰지 않고(upsert: false), 이름이 이미 있으면 _2, _3 … 을 붙인다.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { withTeamPerm } from '@/lib/teamPermsServer'
import { addDays, kstYmd } from '@/lib/date'
import { toMin, computeWorkHours, normTime, TIME_MIN, TIME_MAX } from '@/lib/workHours'
import {
  DEMO_REQUEST_TYPE, DEMO_PURPOSE, REQUEST_APPROVED, APPROVAL_BUCKET, NDA_STATUSES,
  optionalOneOf, deviceTitle, isValidYmd, isRetroactiveDate, assertShowroomDevice, ensureDeviceConfig, demoStatusLabel,
  type DemoRequestPayload,
} from '@/lib/showroom'
import { approvalPdfDocument, type ApprovalPdfData } from '@/components/showroom/ApprovalPdfDoc'

export const admin = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

// ── 알림 유형 ─────────────────────────────────────────────────────
export const NOTICE_REQUEST = 'showroom_demo_request'
export const NOTICE_APPROVED = 'showroom_demo_approved'
export const NOTICE_REJECTED = 'showroom_demo_rejected'
/** 신청자가 결과를 보러 가는 곳 — 전체기록 탭(「내 신청」 카드가 있다). */
export const REQUESTER_LINK = '/showroom?tab=usage'

// ── 로그인한 사람 ─────────────────────────────────────────────────
export type Caller = { engineer_id: number; name: string | null; permission_level: string | null; teams: string | null }

/** 로그인 + 엔지니어 행 + 팀 권한. 상태를 바꾸는 라우트는 fresh 로 팀 권한 캐시를 건너뛴다. */
export async function loadCaller(tag: string, opts?: { fresh?: boolean }): Promise<
  { error: NextResponse; caller: null; email: null } | { error: null; caller: Caller; email: string }
> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return { error: bad('Unauthorized', 401), caller: null, email: null }

  const { data: row, error } = await supabase
    .from('engineers')
    .select('engineer_id, name, permission_level, teams')
    .eq('email', user.email)
    .single()
  if (error) console.error(`[${tag}] caller lookup failed`, { email: user.email, error })
  const caller = await withTeamPerm((row ?? null) as Caller | null, opts)
  if (!caller) return { error: bad('Forbidden', 403), caller: null, email: null }
  return { error: null, caller, email: user.email }
}

// ── 신청 행 ───────────────────────────────────────────────────────
export type RequestRecord = {
  request_id: number
  request_type: string
  status: string
  requester_id: number
  approver_id: number | null
  payload: DemoRequestPayload
  reason: string | null
  comment: string | null
  decided_at: string | null
  created_at: string
  pdf_url: string | null
}
export const REQUEST_COLUMNS =
  'request_id, request_type, status, requester_id, approver_id, payload, reason, comment, decided_at, created_at, pdf_url'

// ── 본문 검증 ─────────────────────────────────────────────────────
const HHMM = /^\d{2}:\d{2}$/
const text = (v: unknown): string | null => (typeof v === 'string' ? v.trim() || null : null)

export type DemoInput = {
  is_retroactive: boolean
  device_id: number
  usage_date: string
  start_time: string
  end_time: string
  work_hours: number
  engineer_ids: number[]
  project_name: string | null
  content: string | null
  customer_id: number
  customer_dept: string | null
  nda_status: string | null
  expected_result: string | null
  sample_material: string | null
  carried_out: boolean
  expected_cost: number | null
  reason: string | null
}

/**
 * 본문 모양 검증(DB 는 보지 않는다). 화면이 보낸 값은 믿지 않는다.
 * 사전·사후는 사용일자로 정한다 — today 는 부르는 쪽이 넘기는 KST 오늘(lib/date todayKST).
 * 오늘 뒤면 사전 신청, 오늘까지면 사후 신청(lib/showroom isRetroactiveDate). 화면이 보낸 플래그는 보지 않는다.
 */
export function parseDemoBody(body: Record<string, unknown>, today: string): { error: string } | { value: DemoInput } {
  const deviceId = Number(body.device_id)
  if (!Number.isInteger(deviceId) || deviceId <= 0) return { error: '장비를 선택해주세요.' }

  const usageDate = typeof body.usage_date === 'string' ? body.usage_date.trim() : ''
  if (!isValidYmd(usageDate)) return { error: '사용일자를 입력해주세요.' }
  const retro = isRetroactiveDate(usageDate, today)

  const start = normTime(typeof body.start_time === 'string' ? body.start_time : '')
  const end = normTime(typeof body.end_time === 'string' ? body.end_time : '')
  if (!HHMM.test(start) || !HHMM.test(end)) return { error: '시간을 입력해주세요.' }
  const s = toMin(start)
  const e = toMin(end)
  if (s < TIME_MIN || s > TIME_MAX || e < TIME_MIN || e > TIME_MAX) return { error: '시간이 올바르지 않습니다.' }
  if (e <= s) return { error: '종료시간을 시작시간 이후로 설정해주세요.' }
  const workHours = computeWorkHours(start, end)
  if (workHours <= 0) return { error: '점심시간을 제외하면 작업시간이 0입니다.' }

  const customerId = Number(body.customer_id)
  if (!Number.isInteger(customerId) || customerId <= 0) return { error: '대상 고객사를 선택해주세요.' }

  const nda = optionalOneOf(body.nda_status, NDA_STATUSES)
  if (!nda.ok) return { error: 'NDA 상태가 올바르지 않습니다.' }

  const costRaw = body.expected_cost
  const expectedCost = costRaw === undefined || costRaw === null || costRaw === '' ? null : Number(costRaw)
  if (expectedCost !== null && (!Number.isInteger(expectedCost) || expectedCost < 0)) {
    return { error: '예상비용은 0 이상 정수로 입력해주세요.' }
  }

  const rawIds = Array.isArray(body.engineer_ids) ? body.engineer_ids : []
  const engineerIds = [...new Set(rawIds.map(Number).filter(n => Number.isInteger(n) && n > 0))]
  if (engineerIds.length === 0) return { error: '참여 엔지니어를 선택해주세요.' }

  return {
    value: {
      is_retroactive: retro,
      device_id: deviceId,
      usage_date: usageDate,
      start_time: start,
      end_time: end,
      work_hours: workHours,
      engineer_ids: engineerIds,
      project_name: text(body.project_name),
      content: text(body.content),
      customer_id: customerId,
      customer_dept: text(body.customer_dept),
      nda_status: nda.value,
      expected_result: text(body.expected_result),
      sample_material: text(body.sample_material),
      carried_out: body.carried_out === true,
      expected_cost: expectedCost,
      // 신청 사유 칸은 없다 — 상세 내용이 곧 사유라 payload.content 와 같은 값을 approval_requests.reason 에 넣는다
      // (요청함 3줄째·승인서의 「신청 사유」가 reason 을 읽는다). 신청(POST)·재작성(PATCH) 모두 이 값을 쓴다.
      reason: text(body.content),
    },
  }
}

type Snapshot = { device_name: string; site_name: string; customer_name: string; engineer_names: string[] }

/** DB 를 보고 확인하고 표시용 이름을 모은다(승인서·요청함에 신청 시점 이름으로 남긴다). 막히면 { error, status }. */
export async function resolveDemo(sb: SupabaseClient, input: DemoInput): Promise<{ error: string; status: number } | { snap: Snapshot }> {
  const notDevice = await assertShowroomDevice(sb, input.device_id)
  if (notDevice) return { error: notDevice, status: 404 }

  const [devRes, cfgRes, custRes, engRes] = await Promise.all([
    sb.from('devices').select('device_name, device_name2, option, customer_id').eq('device_id', input.device_id).maybeSingle(),
    sb.from('showroom_devices').select('is_active').eq('device_id', input.device_id).maybeSingle(),
    sb.from('customers').select('company_name').eq('customer_id', input.customer_id).maybeSingle(),
    sb.from('engineers').select('engineer_id, name').in('engineer_id', input.engineer_ids),
  ])
  if (devRes.error || cfgRes.error || custRes.error || engRes.error) {
    console.error('[showroom/requests] resolve failed', { device: devRes.error, cfg: cfgRes.error, customer: custRes.error, engineers: engRes.error })
    return { error: '신청 내용을 확인하지 못했습니다.', status: 500 }
  }
  if (!devRes.data) return { error: '장비를 찾을 수 없습니다.', status: 404 }
  if (cfgRes.data?.is_active === false) return { error: '사용하지 않는 장비는 신청할 수 없습니다.', status: 400 }
  if (!custRes.data) return { error: '대상 고객사를 찾을 수 없습니다.', status: 404 }
  const engs = (engRes.data ?? []) as { engineer_id: number; name: string | null }[]
  if (engs.length !== input.engineer_ids.length) return { error: '참여 엔지니어를 다시 선택해주세요.', status: 400 }

  const dev = devRes.data as { device_name: string | null; device_name2: string | null; option: string | null; customer_id: number }
  const { data: site, error: siteErr } = await sb.from('customers').select('company_name').eq('customer_id', dev.customer_id).maybeSingle()
  if (siteErr) console.error('[showroom/requests] site lookup failed', siteErr)

  const nameById = new Map(engs.map(e => [e.engineer_id, e.name ?? '']))
  return {
    snap: {
      device_name: deviceTitle(dev),
      site_name: site?.company_name ?? '-',
      customer_name: custRes.data.company_name ?? '-',
      engineer_names: input.engineer_ids.map(id => nameById.get(id) ?? ''),
    },
  }
}

export function buildPayload(input: DemoInput, snap: Snapshot, requestNo: string, caller: Caller): DemoRequestPayload {
  return {
    request_no: requestNo,
    is_retroactive: input.is_retroactive,
    device_id: input.device_id,
    device_name: snap.device_name,
    site_name: snap.site_name,
    usage_date: input.usage_date,
    start_time: input.start_time,
    end_time: input.end_time,
    work_hours: input.work_hours,
    engineer_ids: input.engineer_ids,
    engineer_names: snap.engineer_names,
    project_name: input.project_name,
    content: input.content,
    customer_id: input.customer_id,
    customer_name: snap.customer_name,
    customer_dept: input.customer_dept,
    nda_status: input.nda_status,
    expected_result: input.expected_result,
    sample_material: input.sample_material,
    carried_out: input.carried_out,
    expected_cost: input.expected_cost,
    requester_name: caller.name ?? '-',
    requester_team: caller.teams,
  }
}

// ── 사용 기록 ─────────────────────────────────────────────────────
/**
 * 같은 장비·같은 날 시간이 겹치는 사용 기록 — 사용 기록 라우트와 같은 규칙
 * (기존.시작 < 신규.종료 and 기존.종료 > 신규.시작). 겹치면 그 시간대 문구.
 */
export async function findOverlap(sb: SupabaseClient, deviceId: number, date: string, start: string, end: string): Promise<{ error: boolean; clash: string | null }> {
  const { data, error } = await sb
    .from('showroom_usage')
    .select('usage_id, start_time, end_time')
    .eq('device_id', deviceId)
    .eq('usage_date', date)
    .is('deleted_at', null)
    .lt('start_time', end)
    .gt('end_time', start)
    .limit(1)
  if (error) {
    console.error('[showroom/requests] overlap check failed', { deviceId, date, error })
    return { error: true, clash: null }
  }
  const hit = (data ?? [])[0] as { start_time: string; end_time: string } | undefined
  return { error: false, clash: hit ? `${normTime(hit.start_time)}~${normTime(hit.end_time)}` : null }
}

/**
 * 신청으로 사용 기록(고객 데모)을 만든다. 결과 항목(결과분류·사용결과·문제·후속조치·견적)은 비워 둔다.
 * 작성자는 신청자 — 나중에 신청자가 실제 시간·결과를 고친다. 신청 1건당 사용 기록 1건(su_request_unique).
 */
export async function createUsageFromRequest(sb: SupabaseClient, requestId: number, p: DemoRequestPayload, createdBy: number): Promise<{ error: string; status: number } | { usageId: number }> {
  const cfgErr = await ensureDeviceConfig(sb, p.device_id)
  if (cfgErr) return { error: cfgErr, status: 400 }

  const { data, error } = await sb
    .from('showroom_usage')
    .insert({
      device_id: p.device_id,
      usage_date: p.usage_date,
      start_time: p.start_time,
      end_time: p.end_time,
      work_hours: p.work_hours,
      purpose: DEMO_PURPOSE,
      customer_id: p.customer_id,
      project_name: p.project_name,
      customer_dept: p.customer_dept,
      content: p.content,
      sample_material: p.sample_material,
      carried_out: p.carried_out,
      expected_cost: p.expected_cost,
      nda_status: p.nda_status,
      expected_result: p.expected_result,
      request_id: requestId,
      created_by: createdBy,
    })
    .select('usage_id')
    .single()
  if (error || !data) {
    if (error?.code === '23505') return { error: '이 신청으로 만든 사용 기록이 이미 있습니다.', status: 409 }
    console.error('[showroom/requests] usage insert failed', { requestId, error })
    return { error: '사용 기록을 만들지 못했습니다.', status: 500 }
  }

  // 참여 엔지니어까지 들어가야 한 건이 완성된다. 실패하면 방금 만든 기록을 지운다.
  const { error: engErr } = await sb
    .from('showroom_usage_engineers')
    .insert(p.engineer_ids.map(engineer_id => ({ usage_id: data.usage_id, engineer_id })))
  if (engErr) {
    console.error('[showroom/requests] usage engineer insert failed, rolling back', { requestId, usageId: data.usage_id, error: engErr })
    const { error: rbErr } = await sb.from('showroom_usage').delete().eq('usage_id', data.usage_id)
    if (rbErr) console.error('[showroom/requests] usage rollback failed', { usageId: data.usage_id, error: rbErr })
    return { error: '참여 엔지니어 저장에 실패했습니다.', status: 500 }
  }
  return { usageId: data.usage_id }
}

// ── 신청번호 ──────────────────────────────────────────────────────
const MAX_NO_TRIES = 5
const noOf = (ymd: string, seq: number) => `SR-${ymd.replace(/-/g, '')}-${String(seq).padStart(3, '0')}`
const seqOf = (no: string) => Number(no.split('-')[2]) || 0

async function numberTaken(sb: SupabaseClient, no: string, exceptId?: number): Promise<boolean> {
  let q = sb.from('approval_requests').select('request_id')
    .eq('request_type', DEMO_REQUEST_TYPE)
    .eq('payload->>request_no', no)
    .limit(1)
  if (exceptId != null) q = q.neq('request_id', exceptId)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []).length > 0
}

/** fromSeq 부터 비어 있는 번호를 찾는다(최대 MAX_NO_TRIES 번). 다 차 있으면 던진다. */
async function nextFreeNo(sb: SupabaseClient, ymd: string, fromSeq: number, exceptId?: number): Promise<string> {
  for (let i = 0; i < MAX_NO_TRIES; i++) {
    const no = noOf(ymd, fromSeq + i)
    if (!(await numberTaken(sb, no, exceptId))) return no
  }
  throw new Error(`request number exhausted from ${noOf(ymd, fromSeq)}`)
}

/**
 * 신청번호 SR-YYYYMMDD-001 — 그날(KST) 만든 데모 신청 수 + 1 에서 시작하고, 이미 쓰인 번호면 다음 번호로(최대 5회).
 * 번호에 유일 제약이 없어(payload 안의 값이다) 동시에 둘이 같은 번호를 받을 수 있다 — 저장한 뒤 settleRequestNo 로 한 번 더 맞춘다.
 */
export async function allocateRequestNo(sb: SupabaseClient, ymd: string): Promise<string> {
  const { count, error } = await sb
    .from('approval_requests')
    .select('request_id', { count: 'exact', head: true })
    .eq('request_type', DEMO_REQUEST_TYPE)
    .gte('created_at', `${ymd}T00:00:00+09:00`)
    .lt('created_at', `${addDays(ymd, 1)}T00:00:00+09:00`)
  if (error) throw error
  return nextFreeNo(sb, ymd, (count ?? 0) + 1)
}

/**
 * 저장한 뒤 같은 번호가 둘 이상이면(동시 신청), 먼저 저장된 쪽(request_id 가 작은 쪽)이 번호를 갖고
 * 나중 쪽이 다음 빈 번호로 옮긴다(최대 5회). 옮겼으면 payload 를 고쳐 쓰고 새 payload 를 돌려준다. 끝내 못 맞추면 던진다.
 */
export async function settleRequestNo(sb: SupabaseClient, requestId: number, payload: DemoRequestPayload, ymd: string): Promise<DemoRequestPayload> {
  let current = payload
  for (let i = 0; i < MAX_NO_TRIES; i++) {
    const { data, error } = await sb.from('approval_requests').select('request_id')
      .eq('request_type', DEMO_REQUEST_TYPE)
      .eq('payload->>request_no', current.request_no)
      .order('request_id', { ascending: true })
      .limit(2)
    if (error) throw error
    const ids = ((data ?? []) as { request_id: number }[]).map(r => r.request_id)
    if (ids.length <= 1 || ids[0] === requestId) return current
    const next = await nextFreeNo(sb, ymd, seqOf(current.request_no) + 1, requestId)
    current = { ...current, request_no: next }
    const { error: updErr } = await sb.from('approval_requests').update({ payload: current }).eq('request_id', requestId)
    if (updErr) throw updErr
  }
  throw new Error(`request number not settled: ${current.request_no}`)
}

// ── 승인서 PDF ────────────────────────────────────────────────────
const PDF_NAME_TRIES = 5

/** 스토리지가 '이미 있는 이름'이라고 거절한 것인지 — 그때만 다른 이름으로 다시 올린다. */
const isNameTaken = (e: unknown): boolean => {
  const err = e as { message?: string; statusCode?: string | number } | null
  return !!err && (String(err.statusCode) === '409' || /exist|duplicate/i.test(err.message ?? ''))
}

/** pdf_url('<버킷>/<파일명>') → 버킷 안 파일명. 다른 버킷·폴더·'..' 가 섞였으면 null(경로 순회 방지). */
export function approvalPdfName(pdfUrl: string | null): string | null {
  if (!pdfUrl?.startsWith(`${APPROVAL_BUCKET}/`)) return null
  const name = pdfUrl.slice(APPROVAL_BUCKET.length + 1).trim()
  if (!name || name.includes('/') || name.includes('..')) return null
  return name
}

async function uploadPdf(sb: SupabaseClient, base: string, bytes: Buffer): Promise<string | null> {
  for (let attempt = 1; attempt <= PDF_NAME_TRIES; attempt++) {
    const name = attempt === 1 ? `${base}.pdf` : `${base}_${attempt}.pdf`
    const { error } = await sb.storage.from(APPROVAL_BUCKET).upload(name, bytes, { contentType: 'application/pdf', upsert: false })
    if (!error) return `${APPROVAL_BUCKET}/${name}`
    if (!isNameTaken(error)) {
      console.error('[showroom/requests] pdf upload failed', { name, error })
      return null
    }
  }
  console.error('[showroom/requests] pdf name exhausted', { base })
  return null
}

async function removePdf(sb: SupabaseClient, pdfUrl: string | null) {
  const name = approvalPdfName(pdfUrl)
  if (!name) return
  const { error } = await sb.storage.from(APPROVAL_BUCKET).remove([name])
  if (error) console.error('[showroom/requests] pdf remove failed', { name, error })
}

const won = (n: number | null) => (n == null ? '-' : `₩${n.toLocaleString('ko-KR')}`)

async function pdfDataOf(sb: SupabaseClient, r: RequestRecord): Promise<ApprovalPdfData> {
  const p = r.payload
  let approverName = ''
  if (r.approver_id != null) {
    const { data, error } = await sb.from('engineers').select('name').eq('engineer_id', r.approver_id).maybeSingle()
    if (error) console.error('[showroom/requests] approver lookup failed', { approverId: r.approver_id, error })
    approverName = (data as { name: string | null } | null)?.name ?? ''
  }
  // 도장은 승인(확인)된 뒤에만. 대기중·반려는 도장 자리를 비운다.
  const stamped = r.status === REQUEST_APPROVED && r.approver_id != null && !!r.decided_at
  return {
    requestNo: p.request_no,
    requestDate: kstYmd(r.created_at),
    requesterTeam: p.requester_team ?? '-',
    requesterName: p.requester_name,
    statusLabel: demoStatusLabel(r.status, p.is_retroactive),
    isRetroactive: p.is_retroactive,
    reason: r.reason ?? '',
    deviceName: p.device_name,
    siteName: p.site_name,
    projectName: p.project_name ?? '',
    start: `${p.usage_date} ${normTime(p.start_time)}`,
    end: `${p.usage_date} ${normTime(p.end_time)}`,
    hours: `${p.work_hours}h`,
    content: p.content ?? '',
    sampleMaterial: p.sample_material ?? '',
    carriedOut: p.carried_out ? '있음' : '없음',
    expectedCost: won(p.expected_cost),
    customerName: p.customer_name,
    customerDept: p.customer_dept ?? '',
    nda: p.nda_status ?? '',
    expectedResult: p.expected_result ?? '',
    stamp: stamped ? { name: approverName || '-', date: kstYmd(r.decided_at as string) } : null,
    opinion: r.comment ?? '',
  }
}

/**
 * 승인서 PDF 를 지금 상태로 새로 만들어 올리고 pdf_url 을 바꾼 뒤 옛 파일을 지운다.
 * tag 는 파일 이름 꼬리(approved·confirmed·rev) — 같은 번호의 이전 파일과 이름을 가른다.
 * 실패하면 false. 신청·승인 자체는 이미 끝났으므로 되돌리지 않고, 부른 쪽이 응답에 알린다.
 */
export async function refreshApprovalPdf(sb: SupabaseClient, r: RequestRecord, tag: string): Promise<boolean> {
  try {
    const bytes = await renderToBuffer(approvalPdfDocument(await pdfDataOf(sb, r)))
    const path = await uploadPdf(sb, tag ? `${r.payload.request_no}-${tag}` : r.payload.request_no, bytes)
    if (!path) return false
    const { error } = await sb.from('approval_requests').update({ pdf_url: path }).eq('request_id', r.request_id)
    if (error) {
      console.error('[showroom/requests] pdf_url update failed', { requestId: r.request_id, path, error })
      await removePdf(sb, path)   // 가리키는 행이 없는 파일을 남기지 않는다
      return false
    }
    if (r.pdf_url && r.pdf_url !== path) await removePdf(sb, r.pdf_url)
    return true
  } catch (e) {
    console.error('[showroom/requests] pdf build failed', { requestId: r.request_id, error: e })
    return false
  }
}

// ── 알림 ──────────────────────────────────────────────────────────
type Notice = { title: string; message: string; type: string; link: string | null }

/** 알림 문구 — [신청번호] 신청자 · 장비 · 고객사 · 날짜 시간. 번호는 읽음 처리 때 대조한다. */
export const requestSummary = (p: DemoRequestPayload): string =>
  `[${p.request_no}] ${p.requester_name} · ${p.device_name} · ${p.customer_name} · ${p.usage_date} ${normTime(p.start_time)}~${normTime(p.end_time)}`

export async function notifyEngineer(sb: SupabaseClient, engineerId: number, n: Notice) {
  const { error } = await sb.from('notifications').insert({ engineer_id: engineerId, ...n, is_read: false })
  if (error) console.error('[showroom/requests] notification insert failed', { engineerId, type: n.type, error })
}

/** 재직 중인 superadmin 전원(본인 제외)에게 알린다. 실패해도 신청은 이미 끝났으므로 되돌리지 않는다. */
export async function notifySuperadmins(sb: SupabaseClient, exceptId: number, n: Notice) {
  const { data, error } = await sb.from('engineers').select('engineer_id')
    .eq('permission_level', 'superadmin')
    .is('resigned_date', null)
  if (error) {
    console.error('[showroom/requests] superadmin lookup failed', error)
    return
  }
  const rows = ((data ?? []) as { engineer_id: number }[])
    .filter(e => e.engineer_id !== exceptId)
    .map(e => ({ engineer_id: e.engineer_id, ...n, is_read: false }))
  if (rows.length === 0) return
  const { error: insErr } = await sb.from('notifications').insert(rows)
  if (insErr) console.error('[showroom/requests] superadmin notification insert failed', { type: n.type, error: insErr })
}

/**
 * 처리가 끝난 신청의 '신청' 알림 중 읽지 않은 것을 읽음으로 바꾼다. notifications 에 신청 id 칸이 없어
 * 문구에 박힌 [신청번호]로 대조한다(견적 삭제 요청과 같은 방식).
 */
export async function markRequestNoticesRead(sb: SupabaseClient, requestNo: string) {
  const { error } = await sb.from('notifications').update({ is_read: true })
    .eq('type', NOTICE_REQUEST)
    .eq('is_read', false)
    .ilike('message', `%[${requestNo}]%`)
  if (error) console.error('[showroom/requests] mark notices read failed', { requestNo, error })
}
