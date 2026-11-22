// 고객사 **전부 내보내기** — 네 시트에 들어갈 자료를 모으는 일 (2026-11-22).
//
// 라우트(/api/customer-export)와 실측 도구(scripts/customer-export-live.js)가 **같은 함수**를
// 쓴다. 조회를 두 군데에 적으면 한쪽만 고쳐지고, 실측에서 통과한 것이 사람이 받는 파일과
// 달라진다 — 엑셀에서 가장 나쁜 사고다.
//
// ── 범위 ───────────────────────────────────────────────────────────────────
//   화면이 거르고 난 **사업장 id 목록**을 받는다(순서까지 그대로 쓴다). 서버에서 필터를
//   다시 구현하지 않는다.
//     사업장 = 받은 id 그대로. **한 줄 = 사업장 × 장비** 라 장비를 그 줄에 붙여 넘긴다
//              (폐기도 넣고 「폐기」 열에 폐기일을 적는다. 장비가 없으면 빈 칸 한 줄).
//     회사   = 그 사업장들이 속한 회사(먼저 나온 순서). 합계(사업장 수·장비 수·견적)는
//              사업장에서 더해 만든다 — 그 수는 화면과 같게 **폐기를 뺀** 장비 수다.
//     대리점 = 대리점 줄 전부. 숫자는 **내보낸 사업장 안에서** 센다 — 대리점은 사업장
//              필터의 대상이 아니라 거래 상대라, 필터로 지우지 않는다.
//
// 읽기만 한다. service role 로 읽는 이유는 RLS 때문에 줄이 비는 일을 막기 위해서다.

import type { SupabaseClient } from '@supabase/supabase-js'
import { isInUse } from './deviceStatus'
import { PENDING_STATUS } from './quoteStatus'
import { shortSiteName } from './customerList'
import { regionCells, type ExportAgency, type ExportCompany, type ExportContact, type ExportInput, type ExportSite, type ExportSiteDevice } from './customerExportSheets'

/**
 * 직판 표시 글자. lib/customerAgency.ts 의 DIRECT_SALE_LABEL 과 **같은 값**이다 —
 * 그 파일은 'use client' 라 서버에서 부르지 않는다(하네스가 두 글자가 같은지 지킨다).
 */
export const DIRECT_SALE_LABEL = 'ACCT-K'

/** 한 번에 읽는 최대 줄. 지금 가장 큰 표가 1,451줄이라 넉넉하다. */
const PAGE = 10000

export type CustomerRow = {
  customer_id: number
  parent_customer_id: number | null
  agency_customer_id: number | null
  is_parent: boolean | null
  is_agency: boolean | null
  company_name: string | null
  site_name: string | null
  name_en: string | null
  industry: string | null
  status: string | null
  region1: string | null
  region2: string | null
  address: string | null
  note: string | null
}
export type DeviceRow = {
  device_id: number
  customer_id: number
  device_name: string | null
  device_name2: string | null
  option: string | null
  serial_number: string | null
  program: string | null
  install_year: string | number | null
  install_date: string | null
  status: string | null
  disposed_at: string | null
}
export type ContactRow = {
  customer_id: number
  name: string | null
  position: string | null
  department: string | null
  phone: string | null
  email: string | null
}

/** 조회 줄 → 「사업장」 시트의 장비 칸. 저장 칸 그대로 옮긴다(합치지 않는다). */
function toSiteDevice(d: DeviceRow): ExportSiteDevice {
  return {
    lineup: d.device_name ?? '',
    model: d.device_name2 ?? '',
    option: d.option ?? '',
    serial: d.serial_number ?? '',
    program: d.program ?? '',
    installYear: d.install_year ?? null,
    installDate: d.install_date ?? null,
    disposedAt: d.disposed_at ?? null,
  }
}

/**
 * 한 사업장 안의 장비 순서 — 납입이 이른 것부터, 값이 없는 것은 뒤로.
 * 조회가 준 순서는 보장되지 않는다. 옛 엑셀(lib/customerExcel.ts)과 같은 규칙이다.
 */
function sortDevices(list: DeviceRow[]): DeviceRow[] {
  const key = (d: DeviceRow) => {
    const y = String(d.install_year ?? '').trim()
    const date = String(d.install_date ?? '').trim()
    const full = /^(\d{4})-(\d{1,2})/.exec(date)
    const year = /^\d{4}$/.test(y) ? Number(y) : full ? Number(full[1]) : null
    if (year == null) return Number.MAX_SAFE_INTEGER
    const monthOnly = /^(\d{1,2})$/.exec(date)
    const month = full ? Number(full[2]) : monthOnly ? Number(monthOnly[1]) : 0
    return year * 100 + (month >= 1 && month <= 12 ? month : 0)
  }
  return [...list].sort((a, b) =>
    key(a) - key(b)
    || (a.device_name ?? '').localeCompare(b.device_name ?? '', 'ko')
    || (a.serial_number ?? '').localeCompare(b.serial_number ?? '', 'ko'))
}

export type GatherResult = { data: ExportInput } | { error: string }

/** 네 시트의 자료를 한 번에 모은다. 쓰기는 하지 않는다. */
export async function gatherCustomerExport(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: SupabaseClient<any, any, any>,
  siteIds: number[],
): Promise<GatherResult> {
  // 최근 활동(lib/customerLastTouch.ts)은 **읽지 않는다** — 2026-11-22 에 네 시트에서
  // 그 열을 걷으면서 쓰는 자리가 없어졌다. 다섯 표를 더 읽던 조회가 통째로 빠진다.
  // 작성자(engineers)도 「최근 활동 작성자」 칸 하나 때문에 읽던 것이라 같이 걷었다.
  const [cus, dev, con, quo] = await Promise.all([
    sb.from('customers')
      .select('customer_id, parent_customer_id, agency_customer_id, is_parent, is_agency, company_name, site_name, name_en, industry, status, region1, region2, address, note')
      .is('deleted_at', null).range(0, PAGE),
    sb.from('devices')
      .select('device_id, customer_id, device_name, device_name2, option, serial_number, program, install_year, install_date, status, disposed_at')
      .is('deleted_at', null).range(0, PAGE),
    sb.from('contacts')
      .select('customer_id, name, position, department, phone, email')
      .is('deleted_at', null).order('contact_id', { ascending: true }).range(0, PAGE),
    sb.from('quotes').select('customer_id, status').range(0, PAGE),
  ])
  const firstErr = cus.error ?? dev.error ?? con.error ?? quo.error
  if (firstErr) return { error: firstErr.message }

  const customers = (cus.data ?? []) as unknown as CustomerRow[]
  const devices = (dev.data ?? []) as unknown as DeviceRow[]
  const contacts = (con.data ?? []) as unknown as ContactRow[]
  const byId = new Map<number, CustomerRow>(customers.map(c => [Number(c.customer_id), c]))

  // ── 담당자 — 업체별로 묶는다(읽은 순서 = contact_id 오름차순 그대로) ──
  const contactsOf = new Map<number, ExportContact[]>()
  for (const c of contacts) {
    const id = Number(c.customer_id)
    const one: ExportContact = { name: c.name, position: c.position, department: c.department, phone: c.phone, email: c.email }
    const list = contactsOf.get(id)
    if (list) list.push(one); else contactsOf.set(id, [one])
  }

  // ── 견적 — 진행(견적중)과 전체를 업체별로 센다 ──
  const openQ = new Map<number, number>()
  const allQ = new Map<number, number>()
  for (const q of (quo.data ?? []) as { customer_id: number | null; status: string | null }[]) {
    const id = Number(q.customer_id)
    if (!Number.isFinite(id)) continue
    allQ.set(id, (allQ.get(id) ?? 0) + 1)
    if (q.status === PENDING_STATUS) openQ.set(id, (openQ.get(id) ?? 0) + 1)
  }

  // ── 장비 — 업체별로 묶고, 화면과 같은 「장비 수」(폐기 뺀 수)도 센다 ──
  const devicesOf = new Map<number, DeviceRow[]>()
  const liveCount = new Map<number, number>()
  for (const d of devices) {
    const id = Number(d.customer_id)
    const list = devicesOf.get(id)
    if (list) list.push(d); else devicesOf.set(id, [d])
    if (isInUse(d)) liveCount.set(id, (liveCount.get(id) ?? 0) + 1)
  }

  /** 그 사업장을 묶는 회사 줄(없으면 null — 미연결 사업장이다). */
  const companyOf = (row: CustomerRow): CustomerRow | null => {
    const pid = row.parent_customer_id == null ? null : Number(row.parent_customer_id)
    if (pid == null) return null
    return byId.get(pid) ?? null
  }

  // ── 시트 ① 사업장 — 받은 id 순서 그대로 ──
  const siteRows: CustomerRow[] = []
  for (const id of siteIds) {
    const row = byId.get(id)
    // 내보내는 사이에 지워진 줄은 조회에서 빠진다 — 건너뛴다(옛 엑셀과 같은 처리).
    if (row) siteRows.push(row)
  }
  const sites: ExportSite[] = siteRows.map(row => {
    const id = Number(row.customer_id)
    const company = companyOf(row)
    const companyName = (company?.company_name ?? row.company_name ?? '').trim()
    const [region1, region2] = regionCells(row)
    const agencyRow = row.agency_customer_id == null ? null : byId.get(Number(row.agency_customer_id))
    return {
      customerId: id,
      companyId: company ? Number(company.customer_id) : null,
      companyName,
      nameEn: (company?.name_en ?? row.name_en ?? '').trim(),
      industry: (company?.industry ?? row.industry ?? '').trim(),
      // shortSiteName 은 화면이 쓰는 함수다 — 회사명을 뗀 나머지를 돌려준다.
      siteName: shortSiteName({ company_name: row.company_name ?? '', site_name: row.site_name }, companyName),
      status: row.status ?? '',
      region1, region2,
      address: row.address ?? '',
      agency: (agencyRow?.company_name ?? '').trim() || DIRECT_SALE_LABEL,
      deviceCount: liveCount.get(id) ?? 0,
      openQuotes: openQ.get(id) ?? 0,
      totalQuotes: allQ.get(id) ?? 0,
      note: row.note ?? '',
      contacts: contactsOf.get(id) ?? [],
      // 장비 — 저장 칸 그대로 넘긴다(합치지 않는다). 폐기도 넣는다.
      // 줄 순서는 납입이 이른 것부터, 값이 없는 것은 뒤로(사람이 읽는 순서다).
      devices: sortDevices(devicesOf.get(id) ?? []).map(toSiteDevice),
    }
  })

  // ── 시트 ② 회사 — 내보낸 사업장이 속한 회사만, 먼저 나온 순서 ──
  const companyOrder: number[] = []
  const sitesByCompany = new Map<number, ExportSite[]>()
  for (const s of sites) {
    if (s.companyId == null) continue
    const list = sitesByCompany.get(s.companyId)
    if (list) list.push(s)
    else { sitesByCompany.set(s.companyId, [s]); companyOrder.push(s.companyId) }
  }
  const companies: ExportCompany[] = companyOrder.map(cid => {
    const row = byId.get(cid)
    const list = sitesByCompany.get(cid) ?? []
    // 회사 줄 자신에 붙은 견적도 센다 — 옛 자료에 회사 줄로 들어간 건이 있다.
    return {
      companyId: cid,
      companyName: (row?.company_name ?? '').trim(),
      nameEn: (row?.name_en ?? '').trim(),
      industry: (row?.industry ?? '').trim(),
      siteCount: list.length,
      deviceCount: list.reduce((n, s) => n + s.deviceCount, 0),
      openQuotes: (openQ.get(cid) ?? 0) + list.reduce((n, s) => n + s.openQuotes, 0),
      totalQuotes: (allQ.get(cid) ?? 0) + list.reduce((n, s) => n + s.totalQuotes, 0),
      note: row?.note ?? '',
    }
  })

  // ── 시트 ③ 대리점 — 대리점 줄 전부. 숫자는 내보낸 사업장 안에서 센다 ──
  const exported = new Map<number, ExportSite>(sites.map(s => [s.customerId, s]))
  const agencies: ExportAgency[] = customers
    .filter(c => c.is_agency)
    .sort((a, b) => (a.company_name ?? '').localeCompare(b.company_name ?? '', 'ko'))
    .map(a => {
      const aid = Number(a.customer_id)
      const mine = siteRows
        .filter(s => Number(s.agency_customer_id) === aid)
        .map(s => exported.get(Number(s.customer_id)))
        .filter((s): s is ExportSite => !!s)
      return {
        agencyId: aid,
        name: (a.company_name ?? '').trim(),
        nameEn: (a.name_en ?? '').trim(),
        address: a.address ?? '',
        siteCount: mine.length,
        openQuotes: mine.reduce((n, s) => n + s.openQuotes, 0),
        totalQuotes: mine.reduce((n, s) => n + s.totalQuotes, 0),
        note: a.note ?? '',
        contacts: contactsOf.get(aid) ?? [],
      }
    })

  return { data: { sites, companies, agencies } }
}
