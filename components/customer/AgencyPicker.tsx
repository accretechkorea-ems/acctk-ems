'use client'

/**
 * 대리점 선택 칸 — 등록·수정 두 폼이 함께 쓴다.
 *
 * 전에는 자유 입력 글상자였다. 같은 대리점이 「ACCT-K」/「ACCTK」로 갈리고 「직판」·
 * 사람 이름까지 들어와, 대리점별로 세는 일이 아예 되지 않았다. 이제 고르는 칸이다
 * (목록은 `customers.is_agency` 줄 — lib/customerAgency.ts).
 *
 * **「없음(직판)」이 첫 줄이다.** 대리점을 거치지 않는 건이 절반이 넘으므로(직판 9줄에
 * 「직판」이라고 적어 둔 사람이 있었다) 그 뜻을 고를 수 있어야 한다 — 비우는 것과 같은
 * 값(null)이지만, 「고르지 않았다」와 「직판이다」를 사람이 구별하지 못하면 또 글자가 들어온다.
 *
 * 모양은 ParentPicker 와 같다(글상자 + 포털 팝오버). 새로 만드는 길은 두지 않는다 —
 * 대리점을 늘리는 일은 관리자 화면의 일이고, 폼에서 만들면 또 표기가 갈린다.
 */

import { useMemo, useRef, useState, type CSSProperties } from 'react'
import Popover from '@/components/common/Popover'
import { DIRECT_SALE_LABEL, useAgencies, type AgencyOption } from '@/lib/customerAgency'

const fieldStyle: CSSProperties = {
  width: '100%', padding: '11px 12px', border: '1px solid #ebebeb', borderRadius: 6,
  boxSizing: 'border-box', color: '#111827', background: '#fff', outline: 'none', fontSize: 14,
}
const ghostBtn: CSSProperties = {
  padding: '9px 12px', background: '#f3f4f6', border: 'none', borderRadius: 6,
  cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#6b7280', flexShrink: 0, whiteSpace: 'nowrap',
}
/** 후보로 한 번에 보여 주는 수. 45곳뿐이라 검색 없이도 훑을 수 있게 넉넉히 둔다. */
const SHOWN = 12

type Props = {
  /** 고른 대리점(customers.agency_customer_id). 직판이면 null. */
  value: number | null
  onChange: (agencyCustomerId: number | null) => void
  disabled?: boolean
  /** 입력칸 치수를 폼에 맞출 때(등록 폼은 11px 글자를 쓴다). */
  inputStyle?: CSSProperties
}

export default function AgencyPicker({ value, onChange, disabled, inputStyle }: Props) {
  const agencies = useAgencies()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)
  const style = { ...fieldStyle, ...inputStyle }

  const picked: AgencyOption | null = useMemo(
    () => agencies.find(a => a.customer_id === value) ?? null,
    [agencies, value],
  )

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return agencies.slice(0, SHOWN)
    return agencies.filter(a => a.company_name.toLowerCase().includes(q)).slice(0, SHOWN)
  }, [agencies, query])

  // 이미 고른 상태 — 이름과 해제 버튼만.
  if (value != null) {
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ ...style, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: '#f9fafb' }}>
          {picked ? picked.company_name : `대리점 #${value}`}
        </div>
        <button type="button" disabled={disabled} onClick={() => { onChange(null); setQuery('') }} style={ghostBtn}>해제</button>
      </div>
    )
  }

  return (
    <div ref={anchorRef}>
      <input
        value={query}
        disabled={disabled}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder={`대리점 검색 — 없으면 ${DIRECT_SALE_LABEL}`}
        style={style}
      />
      {/* 모달 안에서 열려도 잘리지 않도록 포털로 띄운다 */}
      <Popover
        anchorRef={anchorRef}
        open={open}
        onClose={() => setOpen(false)}
        matchAnchorWidth
        maxHeight={260}
        style={{ background: '#fff', border: '1px solid #ebebeb', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
      >
        {/* 직판 — 비우는 것과 같은 값이지만, 고를 수 있어야 뜻이 분명해진다 */}
        <div
          onMouseDown={e => { e.preventDefault(); onChange(null); setQuery(''); setOpen(false) }}
          style={{ padding: '8px 11px', cursor: 'pointer', fontSize: 13, color: '#6b7280', fontWeight: 700, borderBottom: matches.length ? '1px solid #ebebeb' : undefined }}
          onMouseEnter={e => { e.currentTarget.style.background = '#f5f5f5' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
        >
          {`없음(${DIRECT_SALE_LABEL})`}
        </div>
        {matches.map(a => (
          <div key={a.customer_id}
            onMouseDown={e => { e.preventDefault(); onChange(a.customer_id); setQuery(''); setOpen(false) }}
            style={{ padding: '8px 11px', cursor: 'pointer', fontSize: 13, color: '#111827' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#f5f5f5' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            {a.company_name}
          </div>
        ))}
        {matches.length === 0 && query.trim() && (
          <div style={{ padding: '8px 11px', fontSize: 12, color: '#9ca3af' }}>
            찾는 대리점이 없습니다 — 관리 화면에서 먼저 등록합니다
          </div>
        )}
      </Popover>
    </div>
  )
}
