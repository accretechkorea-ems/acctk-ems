'use client'

// 장비 다중 선택 — 전체기록 탭 필터 줄. 열면 「전체」와 사무실별로 묶은 장비 체크박스가 나온다.
//   · 「전체」를 고르면 나머지 선택이 풀린다(= 빈 목록). 장비를 하나도 고르지 않은 것도 전체다.
//   · 닫힌 표시 — 전체: 「전체 장비」 / 1대: 장비명 / 2대 이상: 「장비 N대」
//   · 주소에는 있는데 목록에 없는 장비(쇼룸 밖으로 옮겨진 장비 등)는 「목록에 없는 장비」로 따로 보여 풀 수 있게 한다.
// 바깥 클릭·ESC 는 공용 useOutsideClick 이 닫는다.

import { useMemo, useRef, useState, type CSSProperties } from 'react'
import { useOutsideClick } from '@/hooks/useOutsideClick'
import { Z } from '@/lib/zIndex'
import { compareDevices, deviceTitle, type ShowroomDevice, type ShowroomSite } from '@/lib/showroom'
import { BLUE, BORDER, CARD_BG, TEXT, MUTED, ROW_HOVER_BG, inputStyle } from '@/components/common/ui'

const CSS = `
  .sr-dms-row { transition: background 0.15s ease; }
  .sr-dms-row:hover { background: ${ROW_HOVER_BG}; }
`

const rowStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px',
  fontSize: 13, color: TEXT, cursor: 'pointer', minWidth: 0,
}
const groupTitle: CSSProperties = { padding: '8px 12px 4px', fontSize: 11, fontWeight: 700, color: MUTED }
const checkStyle: CSSProperties = { accentColor: BLUE, margin: 0, flexShrink: 0, cursor: 'pointer' }
const nameStyle: CSSProperties = { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

type Props = {
  devices: ShowroomDevice[]
  /** showroom_sites 순서 — 묶음 순서로 쓴다 */
  sites: ShowroomSite[]
  selected: number[]
  onChange: (ids: number[]) => void
}

export default function DeviceMultiSelect({ devices, sites, selected, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  useOutsideClick(ref, () => setOpen(false), open)

  const byId = useMemo(() => new Map(devices.map(d => [d.device_id, d])), [devices])
  const groups = useMemo(() => sites
    .map(s => ({ site: s, list: devices.filter(d => d.customer_id === s.customer_id).sort(compareDevices) }))
    .filter(g => g.list.length > 0), [devices, sites])
  const chosen = new Set(selected)
  const unknown = selected.filter(id => !byId.has(id))

  const nameOf = (id: number) => {
    const d = byId.get(id)
    return d ? deviceTitle(d) : `장비 #${id}`
  }
  const label = selected.length === 0 ? '전체 장비' : selected.length === 1 ? nameOf(selected[0]) : `장비 ${selected.length}대`
  const toggle = (id: number) => onChange(chosen.has(id) ? selected.filter(x => x !== id) : [...selected, id])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <style>{CSS}</style>
      <button type="button" onClick={() => setOpen(o => !o)} aria-haspopup="true" aria-expanded={open} title={label}
        style={{
          ...inputStyle, cursor: 'pointer', minWidth: 150, maxWidth: 240,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        }}>
        <span style={nameStyle}>{label}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div role="group" aria-label="장비 선택" style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: Z.popover,
          width: 300, maxHeight: 360, overflowY: 'auto', padding: '6px 0',
          background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 8,
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
        }}>
          <label className="sr-dms-row" style={{ ...rowStyle, fontWeight: 700 }}>
            <input type="checkbox" checked={selected.length === 0} onChange={() => onChange([])} style={checkStyle} />
            전체
          </label>
          {groups.map(g => (
            <div key={g.site.customer_id}>
              <div style={groupTitle}>{g.site.name}</div>
              {g.list.map(d => (
                <label key={d.device_id} className="sr-dms-row" style={rowStyle}>
                  <input type="checkbox" checked={chosen.has(d.device_id)} onChange={() => toggle(d.device_id)} style={checkStyle} />
                  <span style={nameStyle}>{deviceTitle(d)}</span>
                  {!d.is_active && <span style={{ fontSize: 11, color: MUTED, flexShrink: 0 }}>미사용</span>}
                </label>
              ))}
            </div>
          ))}
          {unknown.length > 0 && (
            <div>
              <div style={groupTitle}>목록에 없는 장비</div>
              {unknown.map(id => (
                <label key={id} className="sr-dms-row" style={rowStyle}>
                  <input type="checkbox" checked onChange={() => toggle(id)} style={checkStyle} />
                  <span style={nameStyle}>{nameOf(id)}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
