'use client'

/**
 * 의뢰서에 걸 **사업장·장비 고르기** — 작성 폼 안의 두 칸.
 *
 * 왜 필요한가: 지금까지 의뢰서에는 업체를 **글자로만**(title) 적었다. 그래서
 * 「이 사업장으로 나간 의뢰서」를 찾을 길이 없었고, 고객사 화면에도 뜨지 않았다.
 * 칸을 더했으니(db/inquiry_customer_device_20261120.sql) 작성할 때 골라 둔다.
 *
 * ── 고르는 규칙 ───────────────────────────────────────────────────────────
 *   · 사업장은 **검색해서** 고른다(1,300곳이 넘어 목록으로는 못 고른다).
 *   · 장비는 **고른 사업장의 장비만** 낸다 — 다른 사업장 장비를 걸 수 없게.
 *   · 둘 다 **선택**이다. 업체가 정해지지 않은 채 번호부터 받는 일이 있다.
 */

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { NOT_AGENCY_ONLY } from '@/lib/customerAgency'
import { R } from '@/lib/radius'

const BORDER = '#ebebeb'
const TEXT = '#111827'
const MUTED = '#9ca3af'
const BLUE = '#234ea2'

export type PickedSite = { id: number; name: string } | null
export type PickedDevice = { id: number; name: string } | null

type SiteRow = { customer_id: number; company_name: string | null; site_name: string | null; address: string | null }
type DeviceRow = { device_id: number; device_name: string | null; device_name2: string | null; serial_number: string | null }

// customers.company_name 은 이미 「회사명 사업장명」을 합친 값이다(crm_cleanup 이후).
// 그래서 site_name 을 또 붙이면 「일진글로벌 경주공장 경주공장」이 된다 — 끝이 같으면 붙이지 않는다.
const siteLabel = (r: SiteRow) => {
  const full = (r.company_name ?? '').trim()
  const site = (r.site_name ?? '').trim()
  if (!full) return site || `사업장 ${r.customer_id}`
  if (!site || full.endsWith(site)) return full
  return `${full} ${site}`
}

const deviceLabel = (d: DeviceRow) =>
  [[d.device_name, d.device_name2].map(v => (v ?? '').trim()).filter(Boolean).join(' '), d.serial_number]
    .filter(Boolean).join(' · ') || `장비 ${d.device_id}`

export default function SitePicker({ site, setSite, device, setDevice }: {
  site: PickedSite
  setSite: (v: PickedSite) => void
  device: PickedDevice
  setDevice: (v: PickedDevice) => void
}) {
  const supabase = createClient()
  const [q, setQ] = useState('')
  /** 검색 결과 — **어느 검색어의 결과인지**를 함께 들고 있어, 입력이 바뀌면 그 자리에서 버린다
      (효과 안에서 setState 로 비우지 않는다 — 한 렌더에 두 번 그리는 꼴이 된다). */
  const [found, setFound] = useState<{ term: string; rows: SiteRow[] }>({ term: '', rows: [] })
  const [loaded, setLoaded] = useState<{ siteId: number; rows: DeviceRow[] }>({ siteId: 0, rows: [] })
  const [busy, setBusy] = useState(false)
  /** 마지막으로 띄운 검색만 반영한다 — 느린 응답이 뒤늦게 덮어쓰지 않게. */
  const seq = useRef(0)

  useEffect(() => {
    const term = q.trim()
    if (site || term.length < 2) return
    const mine = ++seq.current
    const t = setTimeout(() => {
      setBusy(true)
      void supabase
        .from('customers')
        .select('customer_id, company_name, site_name, address')
        .is('deleted_at', null).eq('is_parent', false).or(NOT_AGENCY_ONLY)
        .or(`company_name.ilike.%${term}%,site_name.ilike.%${term}%,address.ilike.%${term}%`)
        .order('company_name').limit(12)
        .then(({ data }) => {
          if (seq.current !== mine) return
          setFound({ term, rows: (data ?? []) as SiteRow[] })
          setBusy(false)
        })
    }, 250)
    return () => clearTimeout(t)
  }, [q, site, supabase])

  useEffect(() => {
    if (!site) return
    const id = site.id
    void supabase
      .from('devices').select('device_id, device_name, device_name2, serial_number')
      .is('deleted_at', null).eq('customer_id', id).order('device_id')
      .then(({ data }) => setLoaded({ siteId: id, rows: (data ?? []) as DeviceRow[] }))
  }, [site, supabase])

  // 그리는 값은 **지금 상태에서 뽑는다** — 검색어가 바뀌었거나 사업장이 바뀌었으면 빈 목록이다.
  const rows = found.term === q.trim() ? found.rows : []
  const devices = site && loaded.siteId === site.id ? loaded.rows : []

  const field: React.CSSProperties = {
    width: '100%', padding: '9px 10px', border: `1px solid ${BORDER}`, borderRadius: R.control,
    fontSize: 13, color: TEXT, background: '#fff', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
  }
  const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: MUTED, marginBottom: 5, display: 'block' }

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <label style={label} htmlFor="iq-site">사업장 (선택)</label>
        {site ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, ...field, padding: '7px 10px' }}>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{site.name}</span>
            <button type="button" onClick={() => { setSite(null); setDevice(null); setQ('') }}
              style={{ border: 'none', background: 'none', color: BLUE, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              바꾸기
            </button>
          </div>
        ) : (
          <>
            <input id="iq-site" value={q} onChange={e => setQ(e.target.value)} style={field}
              placeholder="회사명·사업장명·주소로 찾기 (두 글자 이상)" />
            {q.trim().length >= 2 && (
              <div style={{ border: `1px solid ${BORDER}`, borderTop: 'none', borderRadius: `0 0 ${R.control}px ${R.control}px`, maxHeight: 180, overflowY: 'auto' }}>
                {busy && rows.length === 0 && <div style={{ padding: '8px 10px', fontSize: 12, color: MUTED }}>찾는 중…</div>}
                {!busy && rows.length === 0 && <div style={{ padding: '8px 10px', fontSize: 12, color: MUTED }}>맞는 사업장이 없습니다</div>}
                {rows.map(r => (
                  <button key={r.customer_id} type="button"
                    onClick={() => { setSite({ id: r.customer_id, name: siteLabel(r) }); setDevice(null) }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px',
                      border: 'none', borderBottom: `1px solid ${BORDER}`, background: '#fff', cursor: 'pointer', fontFamily: 'inherit',
                    }}>
                    <span style={{ fontSize: 13, color: TEXT, fontWeight: 600 }}>{siteLabel(r)}</span>
                    {r.address && <span style={{ fontSize: 11, color: MUTED, display: 'block', marginTop: 2 }}>{r.address}</span>}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={label} htmlFor="iq-device">장비 (선택)</label>
        <select id="iq-device" disabled={!site} value={device?.id ?? ''}
          onChange={e => {
            const id = Number(e.target.value)
            const d = devices.find(x => x.device_id === id)
            setDevice(d ? { id: d.device_id, name: deviceLabel(d) } : null)
          }}
          style={{ ...field, color: device ? TEXT : MUTED, cursor: site ? 'pointer' : 'not-allowed' }}>
          <option value="">
            {!site ? '사업장을 먼저 고르세요' : devices.length === 0 ? '등록된 장비가 없습니다' : '장비 선택'}
          </option>
          {devices.map(d => <option key={d.device_id} value={d.device_id}>{deviceLabel(d)}</option>)}
        </select>
      </div>
    </>
  )
}
