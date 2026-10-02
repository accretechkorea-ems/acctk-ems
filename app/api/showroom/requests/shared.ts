// 쇼룸 데모 사용 신청 — 서버 라우트 공용 코드. 라우트 파일은 GET/POST 같은 핸들러 말고는 내보낼 수 없어 여기 둔다.
//   쓰는 곳: app/api/showroom/requests/route.ts(신청·재작성), app/api/showroom/requests/pdf/route.ts(승인서 열기),
//            app/api/showroom/requests/approvals/route.ts(사용 기록에 붙일 승인 정보),
//            lib/approval/showroomUsage.ts(결재 완료·회수 때의 후처리)
//
// 흐름 — 4단계(2026-09-28)부터 **전자결재**다. 「관리자 중 아무나 승인」은 없어졌다.
//   신청    → 신청자가 결재선을 직접 짜서 상신한다(approval_documents, doc_type 'showroom_usage').
//             사전·사후는 사용일자로 서버가 정한다(KST 오늘 뒤 = 사전, 오늘까지 = 사후 — 화면의 플래그는 보지 않는다).
//             사후 신청(이미 끝난 사용)은 사용 기록을 상신 전에 만들고, 그 기록의 document_id 로 문서와 잇는다.
//             사전 신청은 기록을 만들지 않는다 — 결재가 끝난 뒤 onCompleteShowroom 이 만든다.
//             상신 때 도장 없는 승인서 PDF 를 만들어 approval_documents.summary.pdf_url 에 적는다.
//             알림은 첫 차례 결재자(와 그 대리인)에게 간다 — lib/approval/submit.ts 의 notifyFirst.
//   승인    → 결재선을 따라 돈다. 마지막 승인에서 lib/approval/showroomUsage.ts 가
//             (사전이면) 사용 기록을 만들고, 두 경우 모두 승인서에 도장을 찍는다 → 상신자·참조자 알림
//   반려    → 상신자 알림. 사후 신청은 반려가 없다(이미 끝난 사용이라 「확인」뿐 — docTypes.ts 의 canRejectDoc)
//   회수·폐기 → onRevertShowroom 이 사후 신청의 사용 기록과 승인서 PDF 를 치운다
//   재작성  → 반려·회수 건만·신청자 본인만. PATCH 로 내용을 다시 쓰고 결재선을 처음 상태로 돌린다
//
// 옛 통합 요청함 화면·라우트(app/requests, app/api/requests)는 8단계에서 지웠다. 이 파일에서 옛 표
// (approval_requests)를 읽는 코드도 함께 걷어냈다 — 남은 것은 **옛 승인서를 여는 길 하나뿐**이고,
// 그것은 여기가 아니라 pdf/route.ts 의 ?id= 가 직접 읽는다(옛 사용 기록의 [승인서 보기]).
// 옛 표에 쓰는 경로는 없다. 표 자체는 남긴다 — showroom_usage.request_id 가 FK 로 가리킨다.
//
// 쓰기는 전부 service role 로 한다(approval_requests·showroom_usage 에는 읽기 정책만 있다).
// 승인서 PDF 는 비공개 버킷 showroom-approvals 에 올린다. 파일 이름 규칙은 견적서와 같다 —
// 덮어쓰지 않고(upsert: false), 이름이 이미 있으면 _2, _3 … 을 붙인다.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { withTeamPerm } from '@/lib/teamPermsServer'
import { addDays } from '@/lib/date'
import { toMin, computeWorkHours, normTime, TIME_MIN, TIME_MAX } from '@/lib/workHours'
import {
  APPROVAL_BUCKET, NDA_STATUSES,
  optionalOneOf, deviceTitle, isValidYmd, isRetroactiveDate, assertShowroomDevice, ensureDeviceConfig,
  isUsagePurpose, purposeNeedsCustomer, requestPurpose,
  type DemoRequestPayload,
} from '@/lib/showroom'
import { approvalPdfDocument, type ApprovalPdfData, type ApprovalStamp } from '@/components/showroom/ApprovalPdfDoc'

// 승인서 결재란 한 칸 — 쇼룸 결재 유형(lib/approval/showroomUsage.ts)도 같은 타입을 쓴다.
export type { ApprovalStamp }

export const admin = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

// 알림은 이 파일에서 보내지 않는다. 결재 엔진이 보낸다 —
// 첫 차례 결재자에게 lib/approval/submit.ts(notifyFirst), 완료·반려는 app/api/approval/route.ts.
// 옛 요청함이 쓰던 알림 유형(showroom_demo_*)은 만드는 코드가 없어졌고, 쌓인 옛 알림은 그대로 남는다
// (알림 화면의 「요청/결재」 묶음이 showroom_ 접두어로 계속 잡아 준다 — 그 분류는 건드리지 않았다).

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
  purpose: string
  project_name: string | null
  content: string | null
  customer_id: number | null
  customer_dept: string | null
  nda_status: string | null
  expected_result: string | null
  sample_material: string | null
  carried_out: boolean
  expected_cost: number | null
  note: string | null
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

  // 사용목적 — 2026-09-21 부터 5종 전부 신청·승인을 거친다. 목적에 따라 필요한 칸이 다르다.
  const purpose = typeof body.purpose === 'string' ? body.purpose.trim() : ''
  if (!isUsagePurpose(purpose)) return { error: '사용목적을 선택해주세요.' }

  // 대상 고객사는 측정대행·고객 데모만 필수다(DB 제약 su_customer_required 와 같은 규칙).
  const rawCustomer = body.customer_id
  const customerId = rawCustomer === undefined || rawCustomer === null || rawCustomer === '' ? null : Number(rawCustomer)
  if (customerId !== null && (!Number.isInteger(customerId) || customerId <= 0)) return { error: '대상 고객사가 올바르지 않습니다.' }
  if (purposeNeedsCustomer(purpose) && customerId === null) return { error: '대상 고객사를 선택해주세요.' }

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
      purpose,
      project_name: text(body.project_name),
      content: text(body.content),
      customer_id: customerId,
      customer_dept: text(body.customer_dept),
      nda_status: nda.value,
      expected_result: text(body.expected_result),
      sample_material: text(body.sample_material),
      carried_out: body.carried_out === true,
      expected_cost: expectedCost,
      note: text(body.note),
      // 신청 사유 칸은 없다 — 상세 내용이 곧 사유라 payload.content 와 같은 값을 approval_requests.reason 에 넣는다
      // (승인서의 「신청 사유」가 reason 을 읽는다). 신청(POST)·재작성(PATCH) 모두 이 값을 쓴다.
      reason: text(body.content),
    },
  }
}

type Snapshot = { device_name: string; site_name: string; customer_name: string | null; engineer_names: string[] }

/** DB 를 보고 확인하고 표시용 이름을 모은다(승인서·결재함에 신청 시점 이름으로 남긴다). 막히면 { error, status }. */
export async function resolveDemo(sb: SupabaseClient, input: DemoInput): Promise<{ error: string; status: number } | { snap: Snapshot }> {
  const notDevice = await assertShowroomDevice(sb, input.device_id)
  if (notDevice) return { error: notDevice, status: 404 }

  const [devRes, cfgRes, custRes, engRes] = await Promise.all([
    sb.from('devices').select('device_name, device_name2, option, customer_id').eq('device_id', input.device_id).maybeSingle(),
    sb.from('showroom_devices').select('is_active').eq('device_id', input.device_id).maybeSingle(),
    // 대상 고객사가 없는 목적(유지보수·교육·기타)은 조회할 것이 없다.
    input.customer_id === null
      ? Promise.resolve({ data: null, error: null })
      : sb.from('customers').select('company_name').eq('customer_id', input.customer_id).maybeSingle(),
    sb.from('engineers').select('engineer_id, name').in('engineer_id', input.engineer_ids),
  ])
  if (devRes.error || cfgRes.error || custRes.error || engRes.error) {
    console.error('[showroom/requests] resolve failed', { device: devRes.error, cfg: cfgRes.error, customer: custRes.error, engineers: engRes.error })
    return { error: '신청 내용을 확인하지 못했습니다.', status: 500 }
  }
  if (!devRes.data) return { error: '장비를 찾을 수 없습니다.', status: 404 }
  if (cfgRes.data?.is_active === false) return { error: '사용하지 않는 장비는 신청할 수 없습니다.', status: 400 }
  if (input.customer_id !== null && !custRes.data) return { error: '대상 고객사를 찾을 수 없습니다.', status: 404 }
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
      customer_name: input.customer_id === null ? null : custRes.data?.company_name ?? '-',
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
    purpose: input.purpose,
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
    note: input.note,
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
 * 신청으로 사용 기록을 만든다. 목적은 신청에 적힌 것이다(2026-09-21 부터 5종 전부 신청을 거친다).
 * 결과 항목(결과분류·사용결과·문제·후속조치·견적)은 비워 둔다.
 * 작성자는 신청자 — 나중에 신청자가 실제 시간·결과를 고친다. 신청 1건당 사용 기록 1건(su_request_unique).
 */
/**
 * 신청 내용으로 사용 기록을 만든다.
 *
 * requestId  — 옛 요청함(approval_requests)의 신청 번호. 전자결재로 올린 건은 늘 null 이다
 *              (showroom_usage.request_id 는 옛 표를 가리키는 FK 다).
 * documentId — 전자결재 문서(approval_documents.document_id). 문서가 이미 있을 때 넘긴다
 *              — 사전 신청의 결재 완료, 사후 재작성(PATCH)이 그렇다. 사후 **첫 상신**은 기록이 문서보다
 *              먼저 만들어지므로 여기서 넣을 수 없고, 부르는 쪽이 문서를 만든 뒤 UPDATE 로 채운다.
 *              두 칸이 함께 채워지는 일은 없다 — 옛 건은 requestId 만, 새 건은 documentId 만 갖는다.
 */
export async function createUsageFromRequest(sb: SupabaseClient, requestId: number | null, p: DemoRequestPayload, createdBy: number, documentId?: number | null): Promise<{ error: string; status: number } | { usageId: number }> {
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
      purpose: requestPurpose(p),
      customer_id: p.customer_id,
      project_name: p.project_name,
      customer_dept: p.customer_dept,
      content: p.content,
      sample_material: p.sample_material,
      carried_out: p.carried_out,
      expected_cost: p.expected_cost,
      nda_status: p.nda_status,
      expected_result: p.expected_result,
      note: p.note ?? null,
      request_id: requestId,            // 옛 요청함 건만. 전자결재 건은 null
      document_id: documentId ?? null,  // 전자결재 건. 사후 첫 상신은 문서를 만든 뒤 채운다
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
// 번호 규칙은 SR-YYYYMMDD-001 이다. 승인서 파일 이름과 사용 기록이 이 번호로 이어진다.
// 번호가 사는 자리는 approval_documents.doc_no 컬럼이다(옛 신청은 payload 안에 있었다).
//
// **옛 요청함 표(approval_requests)는 더 보지 않는다.** 전자결재로 옮기던 무렵에는 두 표를 함께 보고
// 빈 번호를 골랐는데(이관 당일에 옛 번호와 겹치지 않게), 그 뒤 옛 표에 행을 넣는 경로가 하나도 남지
// 않았다 — 옛 POST(app/api/requests/showroom-demo)는 2026-09-28 부터 410 이고 INSERT 코드가 없다.
// 옛 번호는 그 날짜까지로 굳었고 아래 채번은 늘 **오늘** 날짜로만 번호를 만들므로(allocateDocNo 를
// 부르는 곳이 todayKST() 만 넘긴다) 날짜 부분이 달라 겹칠 수 없다. 그래서 옛 표를 읽던 부분을 끊었다 —
// 옛 번호를 읽는 다른 코드(옛 승인서 열기 — pdf/route.ts 의 ?id=)는 그대로 둔다.
const MAX_NO_TRIES = 5
const noOf = (ymd: string, seq: number) => `SR-${ymd.replace(/-/g, '')}-${String(seq).padStart(3, '0')}`
const seqOf = (no: string) => Number(no.split('-')[2]) || 0

const SHOWROOM_DOC_TYPE = 'showroom_usage'

async function docNoTaken(sb: SupabaseClient, no: string, exceptId?: number): Promise<boolean> {
  let q = sb.from('approval_documents').select('document_id')
    .eq('doc_type', SHOWROOM_DOC_TYPE)
    .eq('doc_no', no)
    .limit(1)
  if (exceptId != null) q = q.neq('document_id', exceptId)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []).length > 0
}

async function nextFreeDocNo(sb: SupabaseClient, ymd: string, fromSeq: number, exceptId?: number): Promise<string> {
  for (let i = 0; i < MAX_NO_TRIES; i++) {
    const no = noOf(ymd, fromSeq + i)
    if (!(await docNoTaken(sb, no, exceptId))) return no
  }
  throw new Error(`doc number exhausted from ${noOf(ymd, fromSeq)}`)
}

/** 그날 만든 쇼룸 결재 문서 수 + 1 에서 시작해 비어 있는 번호를 고른다. */
export async function allocateDocNo(sb: SupabaseClient, ymd: string): Promise<string> {
  const { count, error } = await sb
    .from('approval_documents')
    .select('document_id', { count: 'exact', head: true })
    .eq('doc_type', SHOWROOM_DOC_TYPE)
    .gte('created_at', `${ymd}T00:00:00+09:00`)
    .lt('created_at', `${addDays(ymd, 1)}T00:00:00+09:00`)
  if (error) throw error
  return nextFreeDocNo(sb, ymd, (count ?? 0) + 1)
}

/**
 * 저장한 뒤 같은 번호가 둘이면(동시 상신) 먼저 저장된 쪽이 번호를 갖고 나중 쪽이 다음 번호로 옮긴다.
 * 옮겼으면 doc_no 와 summary 안의 번호를 함께 고친다. 끝내 못 맞추면 던진다.
 */
export async function settleDocNo(sb: SupabaseClient, documentId: number, no: string, ymd: string): Promise<string> {
  let current = no
  for (let i = 0; i < MAX_NO_TRIES; i++) {
    const { data, error } = await sb.from('approval_documents').select('document_id')
      .eq('doc_type', SHOWROOM_DOC_TYPE)
      .eq('doc_no', current)
      .order('document_id', { ascending: true })
      .limit(2)
    if (error) throw error
    const ids = ((data ?? []) as { document_id: number }[]).map(r => r.document_id)
    if (ids.length <= 1 || ids[0] === documentId) return current
    current = await nextFreeDocNo(sb, ymd, seqOf(current) + 1, documentId)
    const { error: updErr } = await sb.from('approval_documents').update({ doc_no: current }).eq('document_id', documentId)
    if (updErr) throw updErr
  }
  throw new Error(`doc number settle failed for ${documentId}`)
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

// 값이 없으면 빈 문자열 — 승인서의 Row 가 빈 값을 「해당없음」으로 채운다.
const won = (n: number | null) => (n == null ? '' : `₩${n.toLocaleString('ko-KR')}`)


/**
 * 승인서 PDF 의 본문 — 신청 내용(payload)에서만 만든다. 결재란(stamps)과 상태말은 부르는 쪽이 정한다.
 * 옛 요청함(approval_requests)과 전자결재(approval_documents)가 같은 양식을 쓰도록 여기로 모았다.
 */
export function pdfDataFromPayload(
  p: DemoRequestPayload,
  o: { requestDate: string; statusLabel: string; stamps: ApprovalStamp[]; opinion: string; reason?: string },
): ApprovalPdfData {
  return {
    requestNo: p.request_no,
    requestDate: o.requestDate,
    requesterTeam: p.requester_team ?? '',
    requesterName: p.requester_name,
    statusLabel: o.statusLabel,
    isRetroactive: p.is_retroactive,
    purpose: requestPurpose(p),
    reason: o.reason ?? '',
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
    customerName: p.customer_name ?? '',
    customerDept: p.customer_dept ?? '',
    nda: p.nda_status ?? '',
    expectedResult: p.expected_result ?? '',
    stamps: o.stamps,
    opinion: o.opinion,
  }
}

/**
 * 승인서 PDF 를 만들어 버킷에 올린다. 성공하면 저장 경로, 실패하면 null.
 * pdf_url 을 어디에 적을지는 부르는 쪽이 정한다(옛 신청 행 / 결재 문서의 summary).
 */
export async function renderApprovalPdf(sb: SupabaseClient, baseName: string, data: ApprovalPdfData): Promise<string | null> {
  try {
    const bytes = await renderToBuffer(approvalPdfDocument(data))
    return await uploadPdf(sb, baseName, bytes)
  } catch (e) {
    console.error('[showroom/requests] pdf build failed', { baseName, error: e })
    return null
  }
}

/** 옛 파일 치우기 — 새 PDF 로 갈아탄 뒤 부른다. */
export const dropApprovalPdf = removePdf
