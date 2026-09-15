// 쇼룸 화면(/showroom 의 장비 · 가동률 · 전체기록 탭)이 쓰는 조회·변환. JSX 없음.
//
// 읽기는 화면에서 직접 한다(새 테이블에 읽기 정책이 있다). 쓰기는 전부 /api/showroom/* 라우트가
// service role 로 한다(쓰기 정책이 없다) — 여기 callShowroomApi 가 그 창구다.
// 조회 함수는 실패하면 Error 를 던진다. 화면이 받아 사용자에게 보일 문구로 바꾼다.

import type { createClient } from '@/lib/supabase/client'
import { normTime, toMin, toHHMM } from '@/lib/workHours'
import {
  siteShortName, DEFAULT_DAILY_HOURS, DEFAULT_DEVICE_STATUS,
  type ShowroomDevice, type ShowroomDeviceBase, type ShowroomSite, type ShowroomUsageRow,
} from '@/lib/showroom'
import type { UsageInitial, UsageSubmission } from './UsageModal'
import type { PickerEngineer } from './EngineerPicker'
import type { DeviceMonthSummary } from './DeviceGrid'
import type { CustomerHit } from './CustomerSearch'

type Browser = ReturnType<typeof createClient>

const DEVICE_COLUMNS =
  'device_id, customer_id, device_name, device_name2, option, serial_number, packing_list_url, install_date, install_year, program, image_url, category'
// 데모 신청으로 만든 기록은 그 신청의 처리 정보(승인자 id·승인일시·상태·사후 여부)를 함께 붙여 읽는다.
// showroom_usage → approval_requests 는 FK 가 request_id 하나라 이름 없이 임베딩한다.
// approval_requests → engineers 는 FK 가 두 개(requester_id·approver_id)라 붙여 읽지 않고, 승인자 이름은
// 화면이 이미 가진 엔지니어 목록으로 바꾼다. 읽기 정책 ar_select_showroom 이 쇼룸 권한자에게 데모 신청을 연다.
const USAGE_SELECT =
  'usage_id, device_id, usage_date, start_time, end_time, work_hours, purpose, customer_id,' +
  ' project_name, customer_dept, content, sample_material, carried_out, expected_cost, nda_status,' +
  ' expected_result, result, result_category, issue, follow_up, quote_id, note, request_id, created_by,' +
  ' customers(company_name), quotes(quote_number),' +
  ' approval_requests(approver_id, decided_at, status, retro:payload->is_retroactive)'

const pad = (n: number) => String(n).padStart(2, '0')

/** 그 달의 첫날·마지막날 'YYYY-MM-DD'. Date.UTC(y, m, 0) 이 그 달의 마지막 날이다. */
export function monthRange(y: number, m: number) {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` }
}

/**
 * 쇼룸 사무실(showroom_sites, created_at 순) → 그 사무실의 devices → showroom_devices 설정을 합친다.
 * 설정 행이 없는 장비도 그대로 쇼룸 장비다 — 기본값을 얹어 같은 모양으로 만든다.
 */
export async function loadShowroomDevices(sb: Browser): Promise<{ sites: ShowroomSite[]; devices: ShowroomDevice[] }> {
  const { data: siteData, error: siteErr } = await sb
    .from('showroom_sites').select('customer_id, created_at, customers(company_name)')
    .order('created_at', { ascending: true }).order('customer_id', { ascending: true })
  if (siteErr) throw new Error(`sites: ${siteErr.message}`)
  type SiteRow = { customer_id: number; customers: { company_name: string | null } | null }
  const sites: ShowroomSite[] = ((siteData ?? []) as unknown as SiteRow[]).map(s => {
    const name = s.customers?.company_name ?? '-'
    return { customer_id: s.customer_id, name, short: siteShortName(name) }
  })
  if (sites.length === 0) return { sites, devices: [] }

  const siteName = new Map(sites.map(s => [s.customer_id, s.name]))
  const [{ data: devRows, error: devErr }, { data: cfgRows, error: cfgErr }] = await Promise.all([
    sb.from('devices').select(DEVICE_COLUMNS).in('customer_id', sites.map(s => s.customer_id)).is('deleted_at', null),
    sb.from('showroom_devices').select('device_id, daily_hours, device_status, is_active, sort_order, note'),
  ])
  if (devErr || cfgErr) throw new Error(`devices: ${(devErr ?? cfgErr)?.message}`)

  type CfgRow = { device_id: number; daily_hours: number; device_status: string; is_active: boolean; sort_order: number; note: string | null }
  const cfgById = new Map((cfgRows ?? []).map((c: CfgRow) => [c.device_id, c]))
  const devices: ShowroomDevice[] = ((devRows ?? []) as unknown as ShowroomDeviceBase[]).map(d => {
    const cfg = cfgById.get(d.device_id)
    return {
      ...d,
      site_name: siteName.get(d.customer_id) ?? '-',
      daily_hours: cfg?.daily_hours ?? DEFAULT_DAILY_HOURS,
      device_status: cfg?.device_status ?? DEFAULT_DEVICE_STATUS,
      is_active: cfg?.is_active ?? true,
      sort_order: cfg?.sort_order ?? 0,
      note: cfg?.note ?? null,
      configured: !!cfg,
    }
  })
  return { sites, devices }
}

/** 참여 엔지니어 칩·작성자 이름에 쓴다. 퇴사자도 이름은 필요하므로 전부 읽는다(신규 선택만 재직자로 거른다). */
export async function loadEngineers(sb: Browser): Promise<PickerEngineer[]> {
  const { data, error } = await sb
    .from('engineers').select('engineer_id, name, position, resigned_date').order('engineer_id', { ascending: true })
  if (error) throw new Error(`engineers: ${error.message}`)
  return (data ?? []) as PickerEngineer[]
}

/** PostgREST 가 한 번에 주는 최대 행 수(서버 max_rows 기본값). 그보다 많으면 이어 읽는다. */
const PAGE_ROWS = 1000
/** 참여 엔지니어를 usage_id 로 묶어 읽을 때 한 번에 넣는 id 수 — 주소 길이와 응답 행 수(1,000)를 넘지 않게. */
const ID_CHUNK = 100

/**
 * 기간(from~to, 양 끝 포함)의 사용 기록과 기록별 참여 엔지니어. 날짜·시작시각 내림차순.
 * 기간이 최대 1년이라 1,000행을 넘을 수 있어 끝까지 이어 읽는다(잘린 채 끝나지 않게).
 */
export async function loadPeriodUsages(sb: Browser, from: string, to: string): Promise<{
  rows: ShowroomUsageRow[]
  usageEngineers: Record<number, number[]>
}> {
  const rows: ShowroomUsageRow[] = []
  for (let offset = 0; ; offset += PAGE_ROWS) {
    const { data, error } = await sb
      .from('showroom_usage').select(USAGE_SELECT)
      .is('deleted_at', null)
      .gte('usage_date', from).lte('usage_date', to)
      .order('usage_date', { ascending: false })
      .order('start_time', { ascending: false })
      .order('usage_id', { ascending: false })   // 페이지를 넘겨 읽을 때 순서가 흔들리지 않게
      .range(offset, offset + PAGE_ROWS - 1)
    if (error) throw new Error(`usage: ${error.message}`)
    const batch = (data ?? []) as unknown as ShowroomUsageRow[]
    rows.push(...batch)
    if (batch.length < PAGE_ROWS) break
  }

  // 참여 엔지니어는 별도 표라 따로 읽어 usage_id 로 묶는다.
  const usageEngineers: Record<number, number[]> = {}
  const ids = rows.map(r => r.usage_id)
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data: links, error: linkErr } = await sb
      .from('showroom_usage_engineers').select('usage_id, engineer_id').in('usage_id', ids.slice(i, i + ID_CHUNK))
    if (linkErr) { console.error('[showroom] usage engineer load failed', linkErr); continue }
    for (const l of (links ?? []) as { usage_id: number; engineer_id: number }[]) {
      (usageEngineers[l.usage_id] ??= []).push(l.engineer_id)
    }
  }
  return { rows, usageEngineers }
}

/**
 * 장비 카드의 이번 달 요약(KST) — 합계·건수만 필요해 두 컬럼만 읽는다.
 * 가동률 목록은 사용여부 N 장비를 빼므로, superadmin 에게 보이는 그 장비의 건수는 여기서 가져온다.
 */
export async function loadMonthSummary(sb: Browser, y: number, m: number): Promise<Record<number, DeviceMonthSummary>> {
  const { from, to } = monthRange(y, m)
  const { data, error } = await sb
    .from('showroom_usage').select('device_id, work_hours')
    .is('deleted_at', null)
    .gte('usage_date', from).lte('usage_date', to)
  if (error) throw new Error(`summary: ${error.message}`)
  const map: Record<number, DeviceMonthSummary> = {}
  for (const r of (data ?? []) as { device_id: number; work_hours: number }[]) {
    const s = (map[r.device_id] ??= { hours: 0, count: 0 })
    s.hours += Number(r.work_hours) || 0
    s.count += 1
  }
  // 소수 합계라 부동소수 오차가 보일 수 있어 소수 첫째 자리에서 끊는다.
  for (const s of Object.values(map)) s.hours = Math.round(s.hours * 10) / 10
  return map
}

/** 쓰기 라우트 호출. 성공이면 null, 실패면 화면에 띄울 메시지. */
export async function callShowroomApi(url: string, method: string, body: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return data?.error || '처리에 실패했습니다.'
    return null
  } catch (e) {
    console.error('[showroom] request failed', { url, method, error: e })
    return '처리 중 오류가 발생했습니다.'
  }
}

/** 사용 기록 모달 저장 결과. 신청이었으면 신청번호·승인서 PDF 성공 여부·사후 여부를 함께 준다. */
export type SubmissionResult =
  | { ok: false; error: string }
  | { ok: true; request: { requestNo: string; pdfOk: boolean; retroactive: boolean } | null }

/**
 * 사용 기록 모달의 저장 — 고객 데모 신청은 /api/showroom/requests(새 신청 POST · 반려 건 재작성 PATCH),
 * 나머지(사용 기록 추가·수정)는 /api/showroom/usage. 장비 탭(page)과 전체기록 탭이 같이 쓴다.
 */
export async function saveSubmission(sub: UsageSubmission): Promise<SubmissionResult> {
  if (sub.kind === 'usage') {
    const message = sub.usageId
      ? await callShowroomApi('/api/showroom/usage', 'PATCH', { ...sub.payload, usage_id: sub.usageId })
      : await callShowroomApi('/api/showroom/usage', 'POST', sub.payload)
    return message ? { ok: false, error: message } : { ok: true, request: null }
  }
  try {
    const res = await fetch('/api/showroom/requests', {
      method: sub.requestId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub.requestId ? { ...sub.body, request_id: sub.requestId } : sub.body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: data?.error || '신청에 실패했습니다.' }
    return {
      ok: true,
      request: { requestNo: String(data?.request_no ?? ''), pdfOk: data?.pdfOk !== false, retroactive: data?.retroactive === true },
    }
  } catch (e) {
    console.error('[showroom] demo request failed', e)
    return { ok: false, error: '신청 중 오류가 발생했습니다.' }
  }
}

/** 신청을 보낸 뒤 화면에 띄울 문구(장비·가동률 탭). PDF 를 못 만들었으면 그 사실을 덧붙인다. */
export function requestNotice(r: { requestNo: string; pdfOk: boolean; retroactive: boolean }): string {
  const head = r.retroactive
    ? `사후 신청을 보냈습니다 (${r.requestNo}). 사용 기록이 만들어졌고 관리자 확인을 기다립니다.`
    : `데모 신청을 보냈습니다 (${r.requestNo}). 관리자가 승인하면 사용 기록이 만들어집니다.`
  return r.pdfOk ? head : `${head} 다만 승인서 PDF 를 만들지 못했습니다 — 관리자에게 알려주세요.`
}

// ── 사용 기록 → 모달 초기값 ──────────────────────────────────────
const customerOf = (row: ShowroomUsageRow): CustomerHit | null =>
  row.customer_id
    ? { customer_id: row.customer_id, company_name: row.customers?.company_name ?? '', address: null, status: null }
    : null

/** 수정 — 기록 값을 그대로 채운다. */
export function editInitial(row: ShowroomUsageRow, engineerIds: number[]): UsageInitial {
  return {
    usage_id: row.usage_id,
    request_id: row.request_id ?? null,
    device_id: row.device_id,
    usage_date: row.usage_date,
    start_time: normTime(row.start_time),
    end_time: normTime(row.end_time),
    purpose: row.purpose,
    project_name: row.project_name ?? '',
    customer: customerOf(row),
    customer_dept: row.customer_dept ?? '',
    content: row.content ?? '',
    sample_material: row.sample_material ?? '',
    carried_out: row.carried_out === true,
    expected_cost: row.expected_cost == null ? null : Number(row.expected_cost),
    nda_status: row.nda_status,
    expected_result: row.expected_result ?? '',
    result: row.result ?? '',
    result_category: row.result_category,
    issue: row.issue ?? '',
    follow_up: row.follow_up ?? '',
    // 견적번호만 들고 있다 — 나머지 값은 칩에 비어 보이므로 목록에서 다시 고르면 채워진다.
    quote: row.quote_id
      ? { quote_id: row.quote_id, quote_number: row.quotes?.quote_number ?? null, quote_date: null, total_supply: null, status: null }
      : null,
    note: row.note ?? '',
    engineer_ids: engineerIds,
  }
}

// 복사 시간 규칙 — 원본이 끝난 시각부터 2시간. 끝이 22:00 을 넘으면 오후 기본 칸으로 둔다.
const COPY_SPAN_MIN = 120
const COPY_LATEST_END = 22 * 60
const COPY_FALLBACK = { start: '13:00', end: '15:00' }

function copyTimes(prevEnd: string): { start: string; end: string } {
  const start = toMin(normTime(prevEnd))
  const end = start + COPY_SPAN_MIN
  if (end > COPY_LATEST_END) return COPY_FALLBACK
  return { start: toHHMM(start), end: toHHMM(end) }
}

/**
 * 복사 — 이 기록을 바탕으로 새 기록을 연다(원본은 건드리지 않는다).
 * 같은 작업을 이어서 한 경우를 빠르게 적으려는 것이라, 누가·어디서·무엇을 은 그대로 두고
 * 시간은 원본이 끝난 뒤로 옮긴다. 이번 작업의 내용·결과·견적은 새로 적어야 하므로 비운다.
 */
export function copyInitial(row: ShowroomUsageRow, engineerIds: number[]): UsageInitial {
  const { start, end } = copyTimes(row.end_time)
  return {
    usage_id: null,
    request_id: null,   // 복사본은 새 기록(고객 데모면 새 신청)이다
    // 그대로 복사
    device_id: row.device_id,
    usage_date: row.usage_date,
    purpose: row.purpose,
    customer: customerOf(row),
    customer_dept: row.customer_dept ?? '',
    engineer_ids: engineerIds,
    project_name: row.project_name ?? '',
    nda_status: row.nda_status,
    // 시간은 원본 종료 뒤로
    start_time: start,
    end_time: end,
    // 비움 — 이번 작업 내용·기대결과·결과 전부·견적·비고
    content: '',
    sample_material: '',
    carried_out: false,
    expected_cost: null,
    expected_result: '',
    result: '',
    result_category: null,
    issue: '',
    follow_up: '',
    quote: null,
    note: '',
  }
}
