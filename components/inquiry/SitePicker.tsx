'use client'

/**
 * 의뢰서의 **회사 → 사업장 → 장비** 고르기 — 발급 모달과 상세 화면이 같은 것을 쓴다.
 *
 * 규칙은 lib/inquirySite.ts 에 있다. 여기서는 그 규칙대로 그리고 읽는다.
 *   · 회사   — 검색해서 고른다(회사명·영문명, lib/companySearch.ts ⓑ).
 *   · 사업장 — 칸을 누르면 **그 회사의 사업장이 바로 펼쳐진다**. 적으면 좁혀진다. 1곳이면 저절로 골라진다.
 *   · 장비   — 사업장을 고르면 같은 방식. 고르지 않아도 된다.
 *
 * 조작(↑↓·Enter·Esc·Tab·마우스 혼용)은 공용 콤보박스가 맡는다(components/common/SearchSelect.tsx).
 * 2026-11-23 전에는 **자유 입력 업체명 칸**이 따로 있었고 사업장은 선택이었다. 글자와 연결이
 * 어긋나 「이 사업장으로 나간 의뢰서」를 찾지 못했다 — 그 칸을 걷고 사업장을 필수로 바꿨다.
 */

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { createClient } from '@/lib/supabase/client'
import { NOT_AGENCY_ONLY } from '@/lib/customerAgency'
import { colsWithNameEn, withNameEnFallback } from '@/lib/nameEn'
import { COMPANY_PICK_PLACEHOLDER, matchesCompanyPick } from '@/lib/companySearch'
import SearchSelect, { CompanyOption } from '@/components/common/SearchSelect'
import { BORDER, BLUE, NEUTRAL_BG, TEXT } from '@/components/common/ui'
import { TEXT_LABEL, TEXT_NOTE, LABEL_WEIGHT } from '@/lib/textTokens'
import { R } from '@/lib/radius'
import {
  companyLabel, deviceLabel, onlyOne, siteLabel, sitesOfCompany,
  type CompanyRow, type DeviceRow, type SiteRow,
} from '@/lib/inquirySite'

export type { CompanyRow, DeviceRow, SiteRow } from '@/lib/inquirySite'
export { siteLabel, deviceLabel } from '@/lib/inquirySite'

export type PickedSite = { id: number; name: string } | null
export type PickedDevice = { id: number; name: string } | null

// ── 회사 목록 — 앱 당 한 번만 읽는다(회사 목록·사무실과 같은 방식) ─────────────
const COMPANY_COLS = 'customer_id, company_name, site_name, address, is_parent'
let companyCache: Promise<CompanyRow[]> | null = null

function loadCompanies(): Promise<CompanyRow[]> {
  if (companyCache) return companyCache
  companyCache = (async () => {
    const supabase = createClient()
    // 회사 줄 + **회사에 묶이지 않은 사업장**. 둘 다 윗줄로 고를 수 있어야 한다(lib/inquirySite.ts).
    const { data, error } = await withNameEnFallback(useEn => supabase
      .from('customers')
      .select(colsWithNameEn(COMPANY_COLS, useEn))
      .is('deleted_at', null)
      .or(NOT_AGENCY_ONLY)
      .or('is_parent.eq.true,parent_customer_id.is.null')
      .order('company_name'))
    if (error) {
      console.error('[inquiry] 회사 목록을 읽지 못했다', error)
      companyCache = null
      return []
    }
    return (data ?? []) as unknown as CompanyRow[]
  })()
  return companyCache
}

const field: CSSProperties = {
  width: '100%', padding: '9px 10px', border: `1px solid ${BORDER}`, borderRadius: R.control,
  fontSize: 13, color: TEXT, background: '#fff', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
}
const labelStyle: CSSProperties = {
  fontSize: 11, fontWeight: LABEL_WEIGHT, color: TEXT_LABEL, marginBottom: 5, display: 'block',
}
const linkBtn: CSSProperties = {
  border: 'none', background: 'none', color: BLUE, fontSize: 12, fontWeight: 700,
  cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
}

/** 이미 고른 칸 — 이름과 「바꾸기」만. */
function Picked({ name, onChange, id }: { name: string; onChange: () => void; id?: string }) {
  return (
    <div id={id} style={{ ...field, display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: NEUTRAL_BG }}>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>
        {name}
      </span>
      <button type="button" onClick={onChange} style={linkBtn}>바꾸기</button>
    </div>
  )
}

export default function SitePicker({ site, setSite, device, setDevice }: {
  site: PickedSite
  setSite: (v: PickedSite) => void
  device: PickedDevice
  setDevice: (v: PickedDevice) => void
}) {
  const supabase = createClient()

  const [companies, setCompanies] = useState<CompanyRow[]>([])
  const [company, setCompany] = useState<CompanyRow | null>(null)
  const [companyQuery, setCompanyQuery] = useState('')

  const [children, setChildren] = useState<{ companyId: number; rows: SiteRow[] } | null>(null)
  const [siteQuery, setSiteQuery] = useState('')

  const [devices, setDevices] = useState<{ siteId: number; rows: DeviceRow[] } | null>(null)
  const [deviceQuery, setDeviceQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    loadCompanies().then(rows => { if (!cancelled) setCompanies(rows) })
    return () => { cancelled = true }
  }, [])

  // 고른 회사의 사업장 — 그 회사의 자식만 읽는다.
  useEffect(() => {
    if (!company) return
    const id = company.customer_id
    let cancelled = false
    void supabase
      .from('customers')
      .select('customer_id, company_name, site_name, address, parent_customer_id')
      .is('deleted_at', null).eq('is_parent', false).eq('parent_customer_id', id)
      .order('company_name')
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) console.error('[inquiry] 사업장 목록을 읽지 못했다', error)
        setChildren({ companyId: id, rows: (data ?? []) as SiteRow[] })
      })
    return () => { cancelled = true }
  }, [company, supabase])

  // 고른 사업장의 장비.
  useEffect(() => {
    if (!site) return
    const id = site.id
    let cancelled = false
    void supabase
      .from('devices').select('device_id, device_name, device_name2, serial_number')
      .is('deleted_at', null).eq('customer_id', id).order('device_id')
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) console.error('[inquiry] 장비 목록을 읽지 못했다', error)
        setDevices({ siteId: id, rows: (data ?? []) as DeviceRow[] })
      })
    return () => { cancelled = true }
  }, [site, supabase])

  const companyMatches = useMemo(
    () => companies.filter(c => matchesCompanyPick(c, companyQuery)).slice(0, 20),
    [companies, companyQuery],
  )

  /** 지금 고를 수 있는 사업장. 자식이 없으면 회사 줄 자체 한 곳이다(lib/inquirySite.ts). */
  const siteRows: SiteRow[] = useMemo(() => {
    if (!company || children?.companyId !== company.customer_id) return []
    return sitesOfCompany(company, children.rows)
  }, [company, children])

  const siteMatches = useMemo(() => {
    const q = siteQuery.trim().toLowerCase()
    if (!q) return siteRows
    return siteRows.filter(r => siteLabel(r).toLowerCase().includes(q) || (r.address ?? '').toLowerCase().includes(q))
  }, [siteRows, siteQuery])

  const deviceRows: DeviceRow[] = useMemo(
    () => (site && devices?.siteId === site.id ? devices.rows : []),
    [site, devices],
  )
  const deviceMatches = useMemo(() => {
    const q = deviceQuery.trim().toLowerCase()
    if (!q) return deviceRows
    return deviceRows.filter(d => deviceLabel(d).toLowerCase().includes(q))
  }, [deviceRows, deviceQuery])

  // 고를 것이 하나뿐이면 저절로 골라진다 — 사람이 누를 일이 아니다.
  const lonelySite = !site && siteRows.length > 0 ? onlyOne(siteRows) : null
  useEffect(() => {
    if (lonelySite) setSite({ id: lonelySite.customer_id, name: siteLabel(lonelySite) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lonelySite])

  const lonelyDevice = site && !device && deviceRows.length > 0 ? onlyOne(deviceRows) : null
  useEffect(() => {
    if (lonelyDevice) setDevice({ id: lonelyDevice.device_id, name: deviceLabel(lonelyDevice) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lonelyDevice])

  const resetCompany = () => {
    setCompany(null); setCompanyQuery('')
    setSite(null); setSiteQuery(''); setChildren(null)
    setDevice(null); setDeviceQuery(''); setDevices(null)
  }

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle} htmlFor="iq-company">회사</label>
        {company || site ? (
          <Picked id="iq-company" name={company ? companyLabel(company) : (site?.name ?? '')} onChange={resetCompany} />
        ) : (
          <SearchSelect<CompanyRow>
            items={companyMatches}
            itemKey={c => c.customer_id}
            renderItem={c => <CompanyOption name={companyLabel(c)} nameEn={c.name_en} />}
            onSelect={c => { setCompany(c); setCompanyQuery('') }}
            query={companyQuery}
            onQueryChange={setCompanyQuery}
            inputId="iq-company"
            placeholder={COMPANY_PICK_PLACEHOLDER}
            inputStyle={field}
            openWhenEmpty
            emptyText="찾는 회사가 없습니다"
          />
        )}
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle} htmlFor="iq-site">사업장</label>
        {site ? (
          <Picked id="iq-site" name={site.name}
            onChange={() => { setSite(null); setSiteQuery(''); setDevice(null); setDeviceQuery('') }} />
        ) : (
          <SearchSelect<SiteRow>
            items={siteMatches}
            itemKey={r => r.customer_id}
            renderItem={r => <CompanyOption name={siteLabel(r)} sub={r.address ?? undefined} />}
            onSelect={r => { setSite({ id: r.customer_id, name: siteLabel(r) }); setSiteQuery(''); setDevice(null) }}
            query={siteQuery}
            onQueryChange={setSiteQuery}
            inputId="iq-site"
            disabled={!company}
            placeholder={company ? '누르면 이 회사의 사업장이 보입니다' : '회사를 먼저 고르세요'}
            inputStyle={{ ...field, cursor: company ? 'pointer' : 'not-allowed' }}
            openWhenEmpty
            emptyText="이 회사에 사업장이 없습니다"
          />
        )}
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle} htmlFor="iq-device">장비</label>
        {device ? (
          <Picked id="iq-device" name={device.name} onChange={() => { setDevice(null); setDeviceQuery('') }} />
        ) : (
          <SearchSelect<DeviceRow>
            items={deviceMatches}
            itemKey={d => d.device_id}
            renderItem={d => <span>{deviceLabel(d)}</span>}
            onSelect={d => { setDevice({ id: d.device_id, name: deviceLabel(d) }); setDeviceQuery('') }}
            query={deviceQuery}
            onQueryChange={setDeviceQuery}
            inputId="iq-device"
            disabled={!site}
            placeholder={!site ? '사업장을 먼저 고르세요' : '누르면 이 사업장의 장비가 보입니다'}
            inputStyle={{ ...field, cursor: site ? 'pointer' : 'not-allowed' }}
            openWhenEmpty
            emptyText="이 사업장에 등록된 장비가 없습니다"
            note={<span style={{ color: TEXT_NOTE }}>장비는 고르지 않아도 됩니다.</span>}
          />
        )}
      </div>
    </>
  )
}
