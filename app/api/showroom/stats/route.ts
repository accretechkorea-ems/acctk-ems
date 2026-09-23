// 쇼룸 가동률 통계. 계산은 전부 여기(서버)서 한다 — 화면은 받은 숫자를 그리기만 한다.
//
// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD&site=<customer_id>|all   (로그인 + canViewCustomers)
//   기간은 양 끝을 포함하고 최대 MAX_PERIOD_DAYS(366)일이다. site 를 빼면 all(모든 사무실 합산).
//   &customers=all 이면 고객사별 활동을 건수 내림차순 전체로 준다(엑셀 내보내기용). 없으면 상위 TOP_N(10).
//   월·분기·반기·지정 기간은 모두 같은 계산(기간 지표 + 장비별 가동률)이다.
//   기간이 한 해 전체(1/1~12/31)면 연간 보기용 히트맵·월별 추이(yearly)를 더 만든다.
//   증감 비교의 기준(previous)은 직전 기간이다 — lib/showroom.ts previousRange.
//
// 사무실 필터는 서버에서 한다. 가동률·사용목적 구성·고객사·히트맵·추이가 모두 그 사무실 장비의
// 기록만으로 다시 계산돼야 해서, 화면에서 나누려면 원자료를 통째로 내려보내야 하기 때문이다.
//
// 조회 — 한 번 요청에 4번(①~③ 병렬, ④는 ①의 사무실 id 가 필요해 뒤에)
//   ① showroom_sites + customers(company_name)   — created_at 순(화면의 사무실 선택지 순서)
//   ② showroom_usage — 직전 기간 첫날부터 기간 끝날까지. 비교·연간 히트맵까지 이 한 번으로 계산한다.
//      PostgREST 는 한 번에 최대 1,000행만 주므로 그보다 많으면 이어서 읽는다(잘린 채 끝나지 않게).
//   ③ company_holidays — 직전 기간이 시작하는 해 1/1 ~ 기간이 끝나는 해 12/31(자동분 유무를 알려고 해 단위로)
//   ④ devices + showroom_devices 설정 — 삭제·미사용 장비까지 읽어 '기록 → 사무실' 대응에 쓴다
//   + 기간에 걸친 해 중 자동 공휴일이 아직 없는 해만 upsert
// 장비별로 쿼리를 돌지 않는다.
//
// 읽기는 service role 로 한다 — 연결 견적(quotes)의 상태·금액이 RLS 에 가려지면 전환율이 틀린다.
// 로그인·권한 확인은 세션 클라이언트로 먼저 한다.
//
// 집계 규칙
//   · 오늘(KST) 이후 날짜로 적힌 기록은 어떤 숫자에도 넣지 않는다 — 진행 중인 기간의 평일을
//     오늘까지만 세므로, 분자도 같은 날까지로 맞춘다.
//   · 쇼룸 전체(선택한 사무실)에 기록이 하나도 없는 기간은 가동률을 null(데이터 없음)로 둔다.
//     기록이 있는 기간의 미사용 장비는 0% 다.
//   · 평균 가동률은 장비 평균이 아니라 가중 평균(Σ실사용 ÷ Σ분모)이다.
//   · 사용여부가 꺼진 장비(is_active=false)는 장비 목록·히트맵·평균에서 뺀다.
//     그 장비의 기록은 건수·시간 같은 기간 지표에는 그대로 들어간다.
//   · 견적·수주 전환율의 분모는 고객 데모 건수 하나다(측정대행은 견적으로 이어지는 일이 아니다).
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { canViewMenu } from '@/lib/permissions'
import { withTeamPerm } from '@/lib/teamPermsServer'
import { todayKST, daysBetween } from '@/lib/date'
import { computeKoreanHolidays } from '@/lib/holidays'
import {
  USAGE_PURPOSES, DEMO_PURPOSE, isOrderStatus, deviceTitle, siteShortName,
  DEFAULT_DAILY_HOURS, DEFAULT_DEVICE_STATUS, MAX_PERIOD_DAYS,
  periodWindow, monthWindow, previousRange, wholeYearOf, isValidYmd,
  computeUtilization, isOffDay, utilBand, round1,
  type PeriodWindow, type MonthMetrics, type DeviceUtilStat, type HeatmapRow,
  type MonthTrend, type CustomerStat, type ShowroomSite, type SiteUtil, type ShowroomStats, type YearlyStats,
} from '@/lib/showroom'

type Caller = { engineer_id: number; name: string | null; permission_level: string | null; teams: string | null }

/** PostgREST 한 번에 받을 행 수. 서버 max_rows(기본 1,000)보다 크게 잡지 않는다. */
const PAGE = 1000
const TOP_N = 10
/** 공휴일 자동 계산을 믿을 수 있는 해의 범위(lib/holidays 의 음력 표가 넉넉히 덮는 구간). */
const MIN_YEAR = 2000
const MAX_YEAR = 2100

const admin = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

/** 로그인 + 고객사 권한. 읽기 전용이라 팀 권한 캐시(30초)를 그대로 쓴다. */
async function authorize() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: bad('Unauthorized', 401) }

  const { data: callerRow, error: callerErr } = await supabase
    .from('engineers')
    .select('engineer_id, name, permission_level, teams')
    .eq('email', user.email!)
    .single()
  if (callerErr) console.error('[showroom/stats] caller lookup failed', { email: user.email, error: callerErr })
  if (!callerRow) return { error: bad('Forbidden', 403) }

  const caller = await withTeamPerm(callerRow as Caller)
  if (!caller || !canViewMenu(caller, 'showroom')) return { error: bad('Forbidden', 403) }
  return { error: null }
}

type UsageRow = {
  usage_id: number
  device_id: number
  usage_date: string
  work_hours: number | string
  purpose: string
  customer_id: number | null
  quote_id: number | null
  customers: { company_name: string | null } | null
  quotes: { status: string | null; total_supply: number | string | null } | null
}

const USAGE_COLUMNS =
  'usage_id, device_id, usage_date, work_hours, purpose, customer_id, quote_id,' +
  ' customers(company_name), quotes(status, total_supply)'

type DeviceInfo = {
  device_id: number
  site_id: number
  name: string
  site_name: string
  device_status: string
  daily_hours: number
  sort_order: number
}

/**
 * 기간 안의 사용 기록을 전부 읽는다. 첫 요청에서 전체 건수(count)를 받아 두고 그만큼 채울 때까지
 * 이어 읽는다 — 서버 max_rows 가 PAGE 보다 작게 잡혀 있어도 건너뛰는 구간이 생기지 않는다.
 */
async function fetchUsage(sb: SupabaseClient, from: string, to: string): Promise<{ rows: UsageRow[]; error: unknown }> {
  const rows: UsageRow[] = []
  let total: number | null = null
  while (total === null || rows.length < total) {
    const { data, error, count } = await sb
      .from('showroom_usage')
      .select(USAGE_COLUMNS, total === null ? { count: 'exact' } : undefined)
      .is('deleted_at', null)
      .gte('usage_date', from)
      .lte('usage_date', to)
      .order('usage_id', { ascending: true })
      .range(rows.length, rows.length + PAGE - 1)
    if (error) return { rows, error }
    if (total === null) total = count ?? 0
    const batch = (data ?? []) as unknown as UsageRow[]
    if (batch.length === 0) break   // 그사이 행이 줄었을 때 끝없이 돌지 않게
    rows.push(...batch)
  }
  return { rows, error: null }
}

const hoursOf = (r: UsageRow) => Number(r.work_hours) || 0
const sumHours = (rs: UsageRow[]) => rs.reduce((s, r) => s + hoursOf(r), 0)

/** 집계 창 안의 기록. 미래 기간이면 없음. */
function rowsIn(rows: UsageRow[], win: PeriodWindow): UsageRow[] {
  const to = win.to
  if (win.future || !to) return []
  return rows.filter(r => r.usage_date >= win.from && r.usage_date <= to)
}

type PeriodResult = {
  win: PeriodWindow
  rows: UsageRow[]
  hasData: boolean
  metrics: MonthMetrics
  devices: DeviceUtilStat[]
  /** 연간·사무실 평균을 반올림 없이 모으기 위한 원값. 가동률이 null 인 장비는 넣지 않는다. */
  raw: Map<number, { used: number; den: number }>
}

function aggregate(all: UsageRow[], win: PeriodWindow, devices: DeviceInfo[], holidays: ReadonlySet<string>): PeriodResult {
  const rows = rowsIn(all, win)
  const hasData = rows.length > 0

  // ── 장비별 가동률 ──
  const byDevice = new Map<number, UsageRow[]>()
  for (const r of rows) {
    const list = byDevice.get(r.device_id)
    if (list) list.push(r)
    else byDevice.set(r.device_id, [r])
  }
  const raw = new Map<number, { used: number; den: number }>()
  const deviceStats: DeviceUtilStat[] = devices.map(d => {
    const rs = byDevice.get(d.device_id) ?? []
    const used = sumHours(rs)
    const holidayHours = sumHours(rs.filter(r => isOffDay(r.usage_date, holidays)))
    const u = computeUtilization(d.daily_hours, win.weekdays, used, holidayHours)
    const rate = win.future || !hasData ? null : u.rate
    if (rate != null) raw.set(d.device_id, { used, den: u.denominator })
    return {
      device_id: d.device_id,
      site_id: d.site_id,
      name: d.name,
      site_name: d.site_name,
      device_status: d.device_status,
      daily_hours: d.daily_hours,
      weekdays: win.weekdays,
      base_hours: round1(u.base),
      holiday_hours: round1(holidayHours),
      used_hours: round1(used),
      count: rs.length,
      utilization: rate,
      band: utilBand(rate),
    }
  })
  let usedSum = 0
  let denSum = 0
  for (const v of raw.values()) { usedSum += v.used; denSum += v.den }

  // ── 기간 지표 — 전환율은 고객 데모만 분모로 ──
  const demos = rows.filter(r => r.purpose === DEMO_PURPOSE)
  const linked = demos.filter(r => r.quote_id != null)
  const ordered = linked.filter(r => isOrderStatus(r.quotes?.status))
  // 금액은 견적 단위로 한 번만 — 한 견적에 기록이 여러 건 걸려도 두 번 더하지 않는다.
  const quotes = new Map<number, { amount: number; ordered: boolean }>()
  for (const r of linked) {
    if (r.quote_id == null || quotes.has(r.quote_id)) continue
    quotes.set(r.quote_id, { amount: Number(r.quotes?.total_supply) || 0, ordered: isOrderStatus(r.quotes?.status) })
  }
  let quoteAmount = 0
  let orderAmount = 0
  for (const q of quotes.values()) {
    quoteAmount += q.amount
    if (q.ordered) orderAmount += q.amount
  }

  const metrics: MonthMetrics = {
    count: rows.length,
    hours: round1(sumHours(rows)),
    demoCount: demos.length,
    quoteLinked: linked.length,
    orderLinked: ordered.length,
    quoteRate: demos.length > 0 ? linked.length / demos.length : null,
    orderRate: demos.length > 0 ? ordered.length / demos.length : null,
    quoteAmount,
    orderAmount,
    avgUtilization: denSum > 0 ? usedSum / denSum : null,
    byPurpose: USAGE_PURPOSES.map(p => {
      const rs = rows.filter(r => r.purpose === p)
      return { purpose: p, count: rs.length, hours: round1(sumHours(rs)) }
    }),
  }

  return { win, rows, hasData, metrics, devices: deviceStats, raw }
}

/**
 * 연간 보기 — 1~12월을 한 달씩 aggregate 해서 히트맵(장비 × 월)과 월별 추이를 만든다.
 * 기간 보기와 같은 식이고, 연간 평균도 월별 원값을 모은 가중 평균이다.
 */
function yearlyStats(year: number, usage: UsageRow[], devices: DeviceInfo[], holidays: ReadonlySet<string>, today: string): YearlyStats {
  const months = Array.from({ length: 12 }, (_, i) =>
    aggregate(usage, monthWindow(year, i + 1, holidays, today), devices, holidays))

  const annualAcc = new Map<number, { used: number; den: number }>()
  let yearUsed = 0
  let yearDen = 0
  for (const mo of months) {
    for (const [id, v] of mo.raw) {
      const acc = annualAcc.get(id) ?? { used: 0, den: 0 }
      acc.used += v.used
      acc.den += v.den
      annualAcc.set(id, acc)
      yearUsed += v.used
      yearDen += v.den
    }
  }
  const rows: HeatmapRow[] = devices.map(d => {
    const acc = annualAcc.get(d.device_id)
    return {
      device_id: d.device_id,
      site_id: d.site_id,
      name: d.name,
      site_name: d.site_name,
      months: months.map(mo => mo.devices.find(s => s.device_id === d.device_id)?.utilization ?? null),
      annual: acc && acc.den > 0 ? acc.used / acc.den : null,
    }
  })
  const trend: MonthTrend[] = months.map((mo, i) => ({
    month: i + 1,
    future: mo.win.future,
    hasData: mo.hasData,
    hours: mo.metrics.hours,
    demoCount: mo.metrics.demoCount,
  }))
  return {
    year,
    heatmap: {
      rows,
      monthlyAvg: months.map(mo => mo.metrics.avgUtilization),
      annualAvg: yearDen > 0 ? yearUsed / yearDen : null,
    },
    trend,
  }
}

/**
 * 고객사별 활동 — 대상 고객사가 적힌 기록을 목적과 상관없이 고객사로 묶는다.
 * 견적·수주 칸은 그 고객사 기록 중 견적이 연결된 건이다. 상위 limit 곳(null 이면 전체)과 전체 곳 수를 함께 돌려준다.
 */
function customerBreakdown(rows: UsageRow[], limit: number | null): { top: CustomerStat[]; total: number } {
  const map = new Map<number, CustomerStat>()
  for (const r of rows) {
    if (r.customer_id == null) continue
    const c = map.get(r.customer_id)
      ?? { customer_id: r.customer_id, name: r.customers?.company_name ?? '-', count: 0, hours: 0, quoteLinked: 0, orderLinked: 0 }
    c.count += 1
    c.hours += hoursOf(r)
    if (r.quote_id != null) {
      c.quoteLinked += 1
      if (isOrderStatus(r.quotes?.status)) c.orderLinked += 1
    }
    map.set(r.customer_id, c)
  }
  const sorted = [...map.values()]
    .map(c => ({ ...c, hours: round1(c.hours) }))
    .sort((a, b) => b.count - a.count || b.hours - a.hours || a.name.localeCompare(b.name))
  return { top: limit == null ? sorted : sorted.slice(0, limit), total: map.size }
}

// ── GET ─────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await authorize()
  if (auth.error) return auth.error

  const sp = req.nextUrl.searchParams
  const from = sp.get('from') ?? ''
  const to = sp.get('to') ?? ''
  if (!isValidYmd(from) || !isValidYmd(to)) return bad('기간이 올바르지 않습니다.')
  const fromYear = Number(from.slice(0, 4))
  const toYear = Number(to.slice(0, 4))
  if (fromYear < MIN_YEAR || toYear > MAX_YEAR) return bad('기간이 올바르지 않습니다.')
  if (from > to) return bad('시작일이 종료일보다 늦습니다.')
  if (daysBetween(from, to) + 1 > MAX_PERIOD_DAYS) return bad(`기간은 ${MAX_PERIOD_DAYS}일 이내로 골라주세요.`)
  const siteParam = sp.get('site') ?? 'all'
  let site: number | 'all' = 'all'
  if (siteParam !== 'all') {
    const n = Number(siteParam)
    if (!Number.isInteger(n) || n <= 0) return bad('사무실이 올바르지 않습니다.')
    site = n
  }
  const allCustomers = sp.get('customers') === 'all'

  const today = todayKST()
  const prev = previousRange(from, to)
  const prevYear = Number(prev.from.slice(0, 4))

  const sb = admin()
  const [sitesRes, usageRes, holRes] = await Promise.all([
    sb.from('showroom_sites').select('customer_id, created_at, customers(company_name)')
      .order('created_at', { ascending: true }).order('customer_id', { ascending: true }),
    fetchUsage(sb, prev.from, to),
    sb.from('company_holidays').select('holiday_date, is_manual')
      .gte('holiday_date', `${prevYear}-01-01`).lte('holiday_date', `${toYear}-12-31`),
  ])
  if (sitesRes.error || usageRes.error || holRes.error) {
    console.error('[showroom/stats] load failed', { sites: sitesRes.error, usage: usageRes.error, holidays: holRes.error })
    return bad('통계를 불러오지 못했습니다.', 500)
  }

  // ── 사무실 ──
  type SiteRow = { customer_id: number; customers: { company_name: string | null } | null }
  const sites: ShowroomSite[] = ((sitesRes.data ?? []) as unknown as SiteRow[]).map(s => {
    const name = s.customers?.company_name ?? '-'
    return { customer_id: s.customer_id, name, short: siteShortName(name) }
  })
  if (site !== 'all' && !sites.some(s => s.customer_id === site)) return bad('쇼룸 사무실이 아닙니다.', 404)
  const siteName = new Map(sites.map(s => [s.customer_id, s.name]))

  // ── 공휴일 ──
  // 기간에 걸친 해마다, 그해 자동 계산분이 하나도 없을 때만 채운다. '하나도 없으면'을 수동분까지 세면,
  // 임시공휴일을 먼저 한 건 넣어 둔 해는 법정공휴일이 영영 채워지지 않는다. 채울 때도 이미 있는 날짜는
  // 건드리지 않는다(ignoreDuplicates — 수동 등록분을 덮어쓰지 않는다).
  const holRows = (holRes.data ?? []) as { holiday_date: string; is_manual: boolean }[]
  const holidays = new Set(holRows.map(h => h.holiday_date))
  const hasAuto = (y: number) => holRows.some(h => !h.is_manual && h.holiday_date.startsWith(`${y}-`))
  let seeded = false
  for (let y = fromYear; y <= toYear; y++) {
    if (hasAuto(y)) continue
    const computed = computeKoreanHolidays(y)
    const { error: seedErr } = await sb
      .from('company_holidays')
      .upsert(computed.map(h => ({ holiday_date: h.date, name: h.name, is_manual: false })),
        { onConflict: 'holiday_date', ignoreDuplicates: true })
    if (seedErr) console.error('[showroom/stats] holiday seed failed', { year: y, error: seedErr })
    else seeded = true
    // 저장에 실패해도 이번 응답은 계산값으로 맞춘다.
    for (const h of computed) holidays.add(h.date)
  }
  // 직전 기간에만 걸리는 해(1월의 전월인 작년 12월 등) — 저장하지 않고 계산값만 쓴다.
  for (let y = prevYear; y < fromYear; y++) {
    if (!hasAuto(y)) for (const h of computeKoreanHolidays(y)) holidays.add(h.date)
  }

  // ── 장비 ──
  // 삭제·미사용 장비까지 읽는다. 가동률 대상은 살아 있고 사용여부가 켜진 장비뿐이지만,
  // 사무실별로 기록을 나눌 때는 그 장비들의 지난 기록도 어느 사무실 것인지 알아야 한다.
  const siteOfDevice = new Map<number, number>()
  let allActive: DeviceInfo[] = []
  if (sites.length > 0) {
    const { data: devRows, error: devErr } = await sb
      .from('devices')
      .select('device_id, customer_id, device_name, device_name2, option, deleted_at, showroom_devices(daily_hours, device_status, is_active, sort_order)')
      .in('customer_id', sites.map(s => s.customer_id))
    if (devErr) {
      console.error('[showroom/stats] device load failed', devErr)
      return bad('장비 목록을 불러오지 못했습니다.', 500)
    }
    type Cfg = { daily_hours: number | string; device_status: string; is_active: boolean; sort_order: number }
    type DevRow = {
      device_id: number; customer_id: number
      device_name: string | null; device_name2: string | null; option: string | null
      deleted_at: string | null
      showroom_devices: Cfg | Cfg[] | null
    }
    for (const d of (devRows ?? []) as unknown as DevRow[]) {
      siteOfDevice.set(d.device_id, d.customer_id)
      if (d.deleted_at) continue
      // device_id 가 showroom_devices 의 PK 라 1:1 이다. PostgREST 판에 따라 객체나 배열로 온다.
      const cfg = Array.isArray(d.showroom_devices) ? d.showroom_devices[0] ?? null : d.showroom_devices
      if (cfg?.is_active === false) continue   // 사용여부 N — 가동률에서 뺀다
      allActive.push({
        device_id: d.device_id,
        site_id: d.customer_id,
        name: deviceTitle(d),
        site_name: siteName.get(d.customer_id) ?? '-',
        device_status: cfg?.device_status ?? DEFAULT_DEVICE_STATUS,
        daily_hours: Number(cfg?.daily_hours ?? DEFAULT_DAILY_HOURS),
        sort_order: cfg?.sort_order ?? 0,
      })
    }
    allActive = allActive.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
  }

  // ── 사무실 필터 ── 'all' 은 모든 기록(사무실 밖으로 옮겨진 장비의 옛 기록 포함)을 합산한다.
  const devices = site === 'all' ? allActive : allActive.filter(d => d.site_id === site)
  const usage = site === 'all' ? usageRes.rows : usageRes.rows.filter(r => siteOfDevice.get(r.device_id) === site)

  // ── 기간 · 직전 기간 ──
  const current = aggregate(usage, periodWindow(from, to, holidays, today), devices, holidays)
  const previous = aggregate(usage, periodWindow(prev.from, prev.to, holidays, today), devices, holidays)

  // ── 사무실별 평균 가동률(선택한 기간) ──
  const siteUtil: SiteUtil[] = sites
    .filter(s => site === 'all' || s.customer_id === site)
    .map(s => {
      let used = 0
      let den = 0
      for (const d of devices) {
        if (d.site_id !== s.customer_id) continue
        const v = current.raw.get(d.device_id)
        if (v) { used += v.used; den += v.den }
      }
      return { customer_id: s.customer_id, short: s.short, avgUtilization: den > 0 ? used / den : null }
    })

  // ── 연간 보기(기간이 한 해 전체일 때만) ──
  const wholeYear = wholeYearOf(from, to)
  const yearly = wholeYear == null ? null : yearlyStats(wholeYear, usage, devices, holidays, today)

  // 가동률 내림차순, 계산할 수 없는 장비(null)는 뒤로.
  const deviceList = [...current.devices].sort((a, b) => {
    if (a.utilization == null && b.utilization == null) return a.name.localeCompare(b.name)
    if (a.utilization == null) return 1
    if (b.utilization == null) return -1
    return b.utilization - a.utilization || a.name.localeCompare(b.name)
  })

  const cust = customerBreakdown(current.rows, allCustomers ? null : TOP_N)

  const body: ShowroomStats = {
    from,
    to,
    today,
    sites,
    site,
    window: current.win,
    hasData: current.hasData,
    current: current.metrics,
    previous: previous.metrics,
    devices: deviceList,
    siteUtil,
    yearly,
    customers: cust.top,
    customerTotal: cust.total,
    holidays: { seeded },
  }
  return NextResponse.json(body)
}
