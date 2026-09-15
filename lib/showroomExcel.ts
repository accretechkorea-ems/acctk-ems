// 쇼룸 엑셀 내보내기 — 조회 + 시트 생성. 화면과 무관한 순수 로직만 둔다(버튼은 components/showroom/ShowroomExcelButton.tsx).
// 구조는 lib/quoteExcel.ts · lib/leadExcel.ts 와 같은 방식이다 — 그 파일들은 건드리지 않고 따로 둔다.
//
//   시트 1 「월간현황」 — 가동률 탭 기간 보기(UtilMonthView)의 내용. /api/showroom/stats 를 같은 기간, 사무실 「전체」로
//                        불러 쓴다(엑셀은 사무실을 가르지 않고 전체를 담는다). 숫자는 서버가 계산한 값 그대로다.
//   시트 2 「사용기록」 — 전체기록 탭의 필터(기간·장비·목적·검색)에 걸린 사용 기록 전체(쪽 나눔 무시).
//                        화면이 이미 읽은 행을 받는다 — 승인자·승인일시도 그 행에 붙은 approval_requests 값이다.
//
// 고객사별 활동은 전체를 담는다 — stats 를 customers=all 로 불러 건수 내림차순 전체를 받는다(화면은 상위 10 을 받아 5 만 쓴다).

// 타입만 가져온다(컴파일 시 사라짐). 런타임 exceljs 는 호출부에서 동적 import 한다.
import type { Workbook, Worksheet, Cell, CellValue, PaperSize } from 'exceljs'
import { addDays } from '@/lib/date'
import { normTime } from '@/lib/workHours'
import {
  USAGE_PURPOSES, UTIL_BAND_LABEL, purposeHasField, utilBand, round1, weekdayOfDate,
  type DeviceUtilStat, type ShowroomStats, type ShowroomUsageRow, type UtilBand,
} from '@/lib/showroom'

// ── 조회 ─────────────────────────────────────────────────────────────────────

/** stats 라우트가 거절했을 때 — 라우트가 준 문구(「기간은 366일 이내로…」 등)를 그대로 들고 있다. */
export class ShowroomStatsError extends Error {}

/**
 * 시트 1 의 원자료. 가동률 탭과 같은 라우트를 사무실 「전체」, 고객사 전체(customers=all)로 부른다.
 * 실패 시 throw — 호출부에서 toast 로 처리한다.
 */
export async function fetchStatsForExcel(from: string, to: string): Promise<ShowroomStats> {
  const res = await fetch(`/api/showroom/stats?from=${from}&to=${to}&site=all&customers=all`)
  const body = await res.json().catch(() => null)
  if (!res.ok || !body) throw new ShowroomStatsError(body?.error || '가동률을 불러오지 못했습니다.')
  return body as ShowroomStats
}

// ── 서식 ─────────────────────────────────────────────────────────────────────
// exceljs 인스턴스는 호출부가 동적 import 해서 넘긴다(번들 증가 방지).

const NAVY = 'FF1F3864'
const WHITE = 'FFFFFFFF'
/** 라벨 행 — 견적 엑셀 제목 줄과 같은 값. */
const LABEL_BG = 'FFD9E1F2'
/** 조회 조건 줄·목록 헤더·소계 행 — 견적·리드 엑셀의 회색과 같은 값. */
const GRAY_BG = 'FFF3F4F6'
/** 안내 줄 글자 — 견적 엑셀 「대외비」 줄과 같은 값. */
const NOTE_FG = 'FF6B7280'
const BAND_BG: Record<UtilBand, string> = { low: 'FFFFF7ED', normal: 'FFF0FDF4', high: 'FFFEF2F2' }

const FMT_INT = '#,##0'
const FMT_HOURS = '0.0'
const FMT_RATE = '0.0"%"'
const FMT_KRW = '#,##0'

const A4 = 9 as PaperSize

const fillBg = (cell: Cell, argb: string) => {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }
}
const borderThin = (cell: Cell) => {
  cell.border = {
    top: { style: 'thin' }, left: { style: 'thin' },
    bottom: { style: 'thin' }, right: { style: 'thin' },
  }
}

type Style = {
  fill?: string
  bold?: boolean
  size?: number
  color?: string
  align?: 'left' | 'center' | 'right'
  numFmt?: string
  /** 기본 true — 안내 줄만 끈다 */
  border?: boolean
}

/**
 * (r, c1) ~ (r2, c2) 를 합쳐(한 칸이면 합치지 않는다) 값을 넣는다.
 * 배경·테두리는 합친 칸 전부에 칠해야 선이 끊기지 않는다.
 */
function put(ws: Worksheet, r: number, c1: number, c2: number, value: CellValue, st: Style = {}, r2 = r): Cell {
  if (c2 > c1 || r2 > r) ws.mergeCells(r, c1, r2, c2)
  for (let rr = r; rr <= r2; rr++) {
    for (let c = c1; c <= c2; c++) {
      const cell = ws.getCell(rr, c)
      if (st.fill) fillBg(cell, st.fill)
      if (st.border !== false) borderThin(cell)
    }
  }
  const cell = ws.getCell(r, c1)
  cell.value = value
  cell.font = { size: st.size ?? 10, bold: st.bold ?? false, ...(st.color ? { color: { argb: st.color } } : {}) }
  cell.alignment = { vertical: 'middle', horizontal: st.align ?? (typeof value === 'number' ? 'right' : 'left') }
  if (st.numFmt) cell.numFmt = st.numFmt
  return cell
}

/** 열 너비 계산용 글자 폭 — 한글·한자는 2칸, 나머지는 1칸으로 센다. */
const textWidth = (s: string): number => {
  let w = 0
  for (const ch of s) w += /[ᄀ-ᇿ⺀-鿿가-힯豈-﫿＀-￯]/.test(ch) ? 2 : 1
  return w
}
const fitWidth = (texts: string[], min: number, max: number): number =>
  Math.min(max, Math.max(min, ...texts.map(t => textWidth(t) + 2)))

/** 가동률(0~1) → 0.0"%" 서식에 넣을 값(34.5). 계산할 수 없으면 빈 칸. */
const pct = (rate: number | null): number | null => (rate == null ? null : rate * 100)

// ── 시트 1 「월간현황」 ──────────────────────────────────────────────────────

/** from~to(양 끝 포함)의 월~금 날짜 수 — 공휴일 여부와 무관하게 센다(UtilMonthView 의 집계 기준 팝오버와 같은 식). */
function monToFriCount(from: string, to: string): number {
  let n = 0
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const w = weekdayOfDate(d)
    if (w !== 0 && w !== 6) n++
  }
  return n
}

/** 장비별 가동률 표의 열. 사무실이 A, 장비명이 B — 핵심 지표·고객사 표도 이 열 위에 칸을 합쳐 앉힌다. */
const DEVICE_HEADERS = ['사무실', '장비명', '장비상태', '일 가용시간', '평일 수', '기준시간', '휴일사용', '실사용시간', '건수', '가동률', '구간']
const LAST_COL = DEVICE_HEADERS.length   // K

/**
 * 가동률 탭 기간 보기와 같은 내용을 시트 한 장으로 그린다.
 *   제목 → 조회 조건 → ① 핵심 지표 → ② 장비별 가동률(사무실별 소계) → ③ 고객사별 활동
 * 섹션 사이에는 빈 행 1개. A4 가로 · 1페이지 너비에 맞춰 인쇄한다.
 */
export function buildStatusSheet(workbook: Workbook, stats: ShowroomStats): Worksheet {
  const ws = workbook.addWorksheet('월간현황', {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: A4, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
    },
  })
  const win = stats.window
  const cur = stats.current

  // 사무실별로 묶는다 — 사무실 순서는 showroom_sites 순(siteUtil), 사무실 안은 서버가 준 가동률 순서 그대로.
  const siteOrder = stats.siteUtil.map(s => s.customer_id)
  const groups = stats.siteUtil
    .map(s => ({ site: s, devices: stats.devices.filter(d => d.site_id === s.customer_id) }))
    .filter(g => g.devices.length > 0)
  const orphans = stats.devices.filter(d => !siteOrder.includes(d.site_id))   // 사무실 목록에 없는 장비(방어)
  const siteShort = new Map(stats.sites.map(s => [s.customer_id, s.short]))
  const shortOf = (d: DeviceUtilStat) => siteShort.get(d.site_id) ?? d.site_name

  // ── 열 너비 — 장비명(B)·사무실(A)은 내용 길이로, 나머지는 머리글 길이로 ──
  const colA = fitWidth(['사무실', '사용목적', '영업 연결', '견적 연결', ...stats.devices.map(shortOf)], 11, 20)
  const colB = fitWidth(['장비명', ...stats.devices.map(d => d.name)], 16, 44)
  ws.getColumn(1).width = colA
  ws.getColumn(2).width = colB
  // 최소 10 — exceljs 는 너비 9 를 기본값으로 보고 파일에 적지 않는다(엑셀 기본 8.43 으로 열린다).
  for (let c = 3; c <= LAST_COL; c++) ws.getColumn(c).width = fitWidth([DEVICE_HEADERS[c - 1]], 10, 14)

  let r = 1

  // ── 제목 ──
  put(ws, r, 1, LAST_COL, '장비 운영 현황', { fill: NAVY, color: WHITE, bold: true, size: 18, align: 'center', border: false })
  ws.getRow(r).height = 34
  r++

  // ── 조회 조건 — 기간 · 집계 범위 · 평일 수 · 공휴일 수 ──
  // 공휴일 수 = 집계 범위의 월~금 − 서버가 센 평일(공휴일 제외). 주말 공휴일은 원래 평일이 아니라 세지 않는다.
  const holidaysOff = win.to ? Math.max(0, monToFriCount(win.from, win.to) - win.weekdays) : 0
  const range = win.future || !win.to
    ? '아직 오지 않은 기간(집계하지 않음)'
    : `${win.from} ~ ${win.to}${win.ongoing ? ' (오늘까지)' : ''}`
  const condition = [
    `기간 ${stats.from} ~ ${stats.to}`,
    `집계 범위 ${range}`,
    `평일 ${win.weekdays}일`,
    `공휴일 ${holidaysOff}일`,
    '사무실 전체',
  ].join('   ·   ')
  put(ws, r, 1, LAST_COL, condition, { fill: GRAY_BG, size: 11, border: false })
  ws.getRow(r).height = 22
  r += 2

  const sectionTitle = (label: string) => {
    put(ws, r, 1, LAST_COL, label, { fill: NAVY, color: WHITE, bold: true, size: 12 })
    ws.getRow(r).height = 22
    r++
  }
  const label = (c1: number, c2: number, text: string, r2 = r) =>
    put(ws, r, c1, c2, text, { fill: LABEL_BG, bold: true, align: 'center' }, r2)
  const value = (c1: number, c2: number, v: number | null, numFmt: string, r2 = r) =>
    put(ws, r, c1, c2, v, { numFmt, size: 11, align: 'center' }, r2)
  const note = (text: string) => {
    put(ws, r, 1, LAST_COL, text, { size: 9, color: NOTE_FG, border: false })
    r++
  }

  // ── ① 핵심 지표 — 라벨 행(#D9E1F2) / 값 행(흰 배경) ──
  sectionTitle('① 핵심 지표')
  // 총량
  label(1, 2, '총 사용건수'); label(3, 6, '총 실사용시간'); label(7, LAST_COL, '평균 가동률')
  r++
  value(1, 2, cur.count, FMT_INT); value(3, 6, cur.hours, FMT_HOURS); value(7, LAST_COL, pct(cur.avgUtilization), FMT_RATE)
  r++
  // 사용목적 5종 — 목적마다 건수·시간
  const purposeSpans: [number, number][] = [[2, 2], [3, 4], [5, 6], [7, 8], [9, LAST_COL]]
  label(1, 1, '사용목적')
  USAGE_PURPOSES.forEach((p, i) => label(purposeSpans[i][0], purposeSpans[i][1], p))
  r++
  for (const [rowLabel, pick, fmt] of [
    ['건수', (p: string) => cur.byPurpose.find(x => x.purpose === p)?.count ?? 0, FMT_INT],
    ['시간', (p: string) => cur.byPurpose.find(x => x.purpose === p)?.hours ?? 0, FMT_HOURS],
  ] as const) {
    label(1, 1, rowLabel)
    USAGE_PURPOSES.forEach((p, i) => value(purposeSpans[i][0], purposeSpans[i][1], pick(p), fmt))
    r++
  }
  // 영업 연결 — 전환율의 분모는 고객 데모 건수 하나다
  label(1, 1, '영업 연결'); label(2, 2, '건수'); label(3, 4, '금액'); label(5, 6, '전환율'); label(7, LAST_COL, '전환율 기준(고객 데모 건수)')
  r++
  const salesTop = r
  for (const [rowLabel, count, amount, rate] of [
    ['견적 연결', cur.quoteLinked, cur.quoteAmount, cur.quoteRate],
    ['수주 연결', cur.orderLinked, cur.orderAmount, cur.orderRate],
  ] as const) {
    label(1, 1, rowLabel)
    value(2, 2, count, FMT_INT)
    value(3, 4, amount, FMT_KRW)
    value(5, 6, pct(rate), FMT_RATE)
    r++
  }
  put(ws, salesTop, 7, LAST_COL, cur.demoCount, { numFmt: FMT_INT, size: 11, align: 'center' }, r - 1)
  note('수주 전환율은 연결된 견적의 현재 상태 기준입니다. 금액은 연결 견적의 공급가 합(같은 견적은 한 번만)입니다.')
  r++

  // ── ② 장비별 가동률 — 사무실별로 묶고, 사무실이 바뀌면 소계(평균 가동률) ──
  sectionTitle(`② 장비별 가동률 (${stats.devices.length}대)`)
  DEVICE_HEADERS.forEach((h, i) => label(i + 1, i + 1, h))
  r++
  const bandCells = (band: UtilBand | null) => {
    if (!band) return
    fillBg(ws.getCell(r, 10), BAND_BG[band])
    fillBg(ws.getCell(r, 11), BAND_BG[band])
  }
  const deviceRow = (d: DeviceUtilStat) => {
    put(ws, r, 1, 1, shortOf(d))
    put(ws, r, 2, 2, d.name)
    put(ws, r, 3, 3, d.device_status, { align: 'center' })
    put(ws, r, 4, 4, d.daily_hours, { numFmt: FMT_HOURS })
    put(ws, r, 5, 5, d.weekdays, { numFmt: FMT_INT })
    put(ws, r, 6, 6, d.base_hours, { numFmt: FMT_HOURS })
    put(ws, r, 7, 7, d.holiday_hours, { numFmt: FMT_HOURS })
    put(ws, r, 8, 8, d.used_hours, { numFmt: FMT_HOURS })
    put(ws, r, 9, 9, d.count, { numFmt: FMT_INT })
    put(ws, r, 10, 10, pct(d.utilization), { numFmt: FMT_RATE })
    put(ws, r, 11, 11, d.band ? UTIL_BAND_LABEL[d.band] : null, { align: 'center' })
    bandCells(d.band)
    r++
  }
  const subtotalRow = (name: string, devices: DeviceUtilStat[], avg: number | null) => {
    const sum = (f: (d: DeviceUtilStat) => number) => round1(devices.reduce((s, d) => s + f(d), 0))
    const band = utilBand(avg)
    const st: Style = { fill: GRAY_BG, bold: true }
    put(ws, r, 1, 5, `${name} 소계 (${devices.length}대)`, st)
    put(ws, r, 6, 6, sum(d => d.base_hours), { ...st, numFmt: FMT_HOURS })
    put(ws, r, 7, 7, sum(d => d.holiday_hours), { ...st, numFmt: FMT_HOURS })
    put(ws, r, 8, 8, sum(d => d.used_hours), { ...st, numFmt: FMT_HOURS })
    put(ws, r, 9, 9, sum(d => d.count), { ...st, numFmt: FMT_INT })
    put(ws, r, 10, 10, pct(avg), { ...st, numFmt: FMT_RATE })
    put(ws, r, 11, 11, band ? UTIL_BAND_LABEL[band] : null, { ...st, align: 'center' })
    bandCells(band)
    r++
  }
  if (stats.devices.length === 0) {
    put(ws, r, 1, LAST_COL, '가동률을 계산할 장비가 없습니다', { align: 'center' })
    r++
  } else {
    for (const g of groups) {
      g.devices.forEach(deviceRow)
      subtotalRow(g.site.short, g.devices, g.site.avgUtilization)
    }
    orphans.forEach(deviceRow)
  }
  note('가동률 = 실사용시간 ÷ (일 가용시간 × 평일 수 + 휴일사용). 저가동 30% 미만 · 과부하 80% 초과. 소계의 가동률은 그 사무실 장비의 가중 평균입니다.')
  r++

  // ── ③ 고객사별 활동 — 전체(건수 내림차순) ──
  sectionTitle('③ 고객사별 활동')
  label(1, 2, '고객사'); label(3, 3, '건수'); label(4, 4, '시간'); label(5, 5, '견적 연결'); label(6, 6, '수주 연결')
  r++
  if (stats.customers.length === 0) {
    put(ws, r, 1, 6, '이 기간에 고객사가 적힌 기록이 없습니다', { align: 'center' })
    r++
  }
  for (const c of stats.customers) {
    put(ws, r, 1, 2, c.name)
    put(ws, r, 3, 3, c.count, { numFmt: FMT_INT })
    put(ws, r, 4, 4, c.hours, { numFmt: FMT_HOURS })
    put(ws, r, 5, 5, c.quoteLinked, { numFmt: FMT_INT })
    put(ws, r, 6, 6, c.orderLinked, { numFmt: FMT_INT })
    r++
  }
  note(`전체 ${stats.customerTotal}곳. 견적·수주 연결은 그 고객사 기록 중 견적이 연결된 건수입니다.`)

  return ws
}

// ── 시트 2 「사용기록」 ──────────────────────────────────────────────────────

/** 사용기록 시트가 기록 id 를 이름으로 바꿀 때 쓰는 함수들 — 전체기록 탭이 이미 가진 목록으로 만든다. */
export type UsageSheetContext = {
  deviceName: (deviceId: number) => string
  /** 장비의 사무실 짧은 이름. 모르는 장비(삭제 등)는 '' */
  siteName: (deviceId: number) => string
  engineerName: (id: number | null) => string
  /** usage_id → 참여 엔지니어 id */
  usageEngineers: Record<number, number[]>
}

/**
 * 긴 글 칸의 상한 — 리드 엑셀과 같은 값. 한 칸에 수천 자가 들어가면 행 높이가 터져 시트를 읽을 수 없다.
 * 원문이 더 길면 잘라내고 잘렸음을 남긴다.
 */
const LONG_TEXT_MAX = 2000
/** 빈 값은 빈 칸(null)으로 둔다 — 「-」를 넣지 않는다. */
const text = (v: string | null | undefined): string | null => {
  const s = (v ?? '').trim()
  if (!s) return null
  return s.length <= LONG_TEXT_MAX ? s : s.slice(0, LONG_TEXT_MAX) + ' …(이하 생략)'
}

/** timestamptz → 'YYYY-MM-DD HH:mm'(KST). 전체기록 표의 승인일시와 같은 표기. */
const kstDateTime = (iso: string | null): string | null =>
  iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul', hour12: false }).slice(0, 16) : null

/** 날짜 내림차순, 같은 날은 시작시간 내림차순(같으면 나중에 쓴 기록이 위) — 전체기록 표와 같은 순서. */
const byNewest = (a: ShowroomUsageRow, b: ShowroomUsageRow): number =>
  b.usage_date.localeCompare(a.usage_date) || b.start_time.localeCompare(a.start_time) || b.usage_id - a.usage_id

type UsageCol = {
  label: string
  /** long = 긴 글(줄바꿈) · center = 짧은 코드값(가운데) */
  kind?: 'long' | 'center'
  numFmt?: string
  get: (r: ShowroomUsageRow) => string | number | null
}

/** 열 정의 — 라벨·서식·값 추출을 한곳에 둬서 헤더와 본문이 어긋나지 않게 한다. */
const usageColumns = (ctx: UsageSheetContext): UsageCol[] => [
  { label: '날짜', kind: 'center', get: r => r.usage_date },
  { label: '사무실', get: r => text(ctx.siteName(r.device_id)) },
  { label: '장비명', get: r => text(ctx.deviceName(r.device_id)) },
  { label: '사용목적', get: r => r.purpose },
  { label: '신청여부', kind: 'center', get: r => (r.request_id != null ? '신청' : null) },
  { label: '대상 고객사', get: r => text(r.customers?.company_name) },
  { label: '고객부서', get: r => text(r.customer_dept) },
  { label: '시작', kind: 'center', get: r => text(normTime(r.start_time)) },
  { label: '종료', kind: 'center', get: r => text(normTime(r.end_time)) },
  { label: '실사용시간', numFmt: FMT_HOURS, get: r => Number(r.work_hours) || 0 },
  { label: '프로젝트명', get: r => text(r.project_name) },
  { label: '상세내용', kind: 'long', get: r => text(r.content) },
  { label: '샘플/자재', kind: 'long', get: r => text(r.sample_material) },
  // 외부반출 칸이 있는 목적만 있음·없음을 적는다(없는 목적은 늘 false 로 저장된다 — 빈 칸).
  { label: '외부반출', kind: 'center', get: r => (r.carried_out ? '있음' : purposeHasField(r.purpose, 'carried_out') ? '없음' : null) },
  { label: '예상비용', numFmt: FMT_KRW, get: r => (r.expected_cost == null ? null : Number(r.expected_cost)) },
  { label: 'NDA', kind: 'center', get: r => text(r.nda_status) },
  { label: '기대결과', kind: 'long', get: r => text(r.expected_result) },
  { label: '결과분류', get: r => text(r.result_category) },
  { label: '사용결과', kind: 'long', get: r => text(r.result) },
  { label: '문제/이상발생', kind: 'long', get: r => text(r.issue) },
  { label: '후속조치', kind: 'long', get: r => text(r.follow_up) },
  { label: '견적번호', get: r => text(r.quotes?.quote_number) },
  {
    label: '참여 엔지니어',
    get: r => text((ctx.usageEngineers[r.usage_id] ?? []).map(id => ctx.engineerName(id)).filter(Boolean).join(', ')),
  },
  { label: '작성자', get: r => text(ctx.engineerName(r.created_by)) },
  // 사후 신청은 「확인」으로 처리된다 — 이름 뒤에 (확인)을 붙여 승인과 구분한다. 확인 전(대기중)은 빈 칸.
  {
    label: '승인자',
    get: r => {
      const ar = r.approval_requests
      if (ar?.approver_id == null) return null
      const name = ctx.engineerName(ar.approver_id)
      return name ? `${name}${ar.retro === true ? '(확인)' : ''}` : null
    },
  },
  { label: '승인일시', kind: 'center', get: r => (r.approval_requests?.approver_id != null ? kstDateTime(r.approval_requests.decided_at) : null) },
  { label: '비고', kind: 'long', get: r => text(r.note) },
]

/** 셀 값의 화면 폭 — 열 너비 계산용. 숫자는 서식을 입힌 모양(1,234 · 8.0)으로 센다. */
const shownText = (v: string | number | null, numFmt?: string): string => {
  if (v == null) return ''
  if (typeof v === 'string') return v
  return numFmt === FMT_HOURS ? v.toFixed(1) : v.toLocaleString('en-US')
}

/**
 * 사용 기록 여러 건을 「사용기록」 시트 한 장으로 그린다(리드 엑셀과 같은 목록형).
 * 헤더 고정 · 자동 필터. 긴 글 칸만 줄바꿈을 켜고, 열 너비는 내용 길이에 맞춘다(상한 있음).
 */
export function buildUsageSheet(workbook: Workbook, rows: ShowroomUsageRow[], ctx: UsageSheetContext): Worksheet {
  const ws = workbook.addWorksheet('사용기록', {
    views: [{ state: 'frozen', ySplit: 1 }],
    pageSetup: { paperSize: A4, orientation: 'landscape' },
  })
  const cols = usageColumns(ctx)
  const sorted = [...rows].sort(byNewest)
  const values = sorted.map(r => cols.map(c => c.get(r)))

  // 열 너비 — 머리글과 값 중 가장 긴 것. 긴 글은 줄바꿈하므로 40 에서 멈춘다.
  cols.forEach((c, i) => {
    const texts = [c.label, ...values.map(v => shownText(v[i], c.numFmt))]
    ws.getColumn(i + 1).width = c.kind === 'long' ? fitWidth(texts, 12, 40) : fitWidth(texts, 8, 36)
  })

  // 헤더 — 굵게 · 가운데 · 회색 배경 · 얇은 테두리(견적·리드 엑셀과 같은 규칙).
  const header = ws.getRow(1)
  cols.forEach((c, i) => {
    const cell = header.getCell(i + 1)
    cell.value = c.label
    cell.font = { bold: true, size: 10 }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    fillBg(cell, GRAY_BG)
    borderThin(cell)
  })
  header.height = 20

  values.forEach((vals, rowIdx) => {
    const row = ws.getRow(rowIdx + 2)
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1)
      cell.value = vals[i]
      cell.font = { size: 10 }
      if (c.numFmt) cell.numFmt = c.numFmt
      // 한 행 안에서 칸마다 위아래 정렬이 달라 보이지 않게 전부 위로 붙인다. 긴 글만 줄바꿈.
      cell.alignment = c.kind === 'long'
        ? { vertical: 'top', wrapText: true }
        : { vertical: 'top', horizontal: c.kind === 'center' ? 'center' : undefined }
      borderThin(cell)
    })
  })

  // 자동 필터 — 받은 사람이 엑셀에서 바로 걸러 볼 수 있게 한다.
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } }

  return ws
}
