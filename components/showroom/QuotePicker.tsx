'use client'

// 견적 연결 — 고른 대상 고객사의 견적을 최근순 20건 보여주고 하나를 고른다.
// 고객사를 고르지 않으면 아무것도 하지 않는다(어느 업체의 견적인지 정해지지 않기 때문).
//
// 조회 컬럼 이름은 app/api/requests/quote-delete/route.ts 의 GET 과 같게 맞췄다
// (quote_id / quote_number / quote_date / total_supply). 상태는 표시용으로 하나 더 읽는다.

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { numKR } from '@/components/customer/constants'
import { BLUE, BORDER, CARD_BG, TEXT, MUTED, SUB, FAINT, NEUTRAL_BG } from '@/components/common/ui'

const LIMIT = 20

export type QuoteHit = {
  quote_id: number
  quote_number: string | null
  quote_date: string | null
  total_supply: number | null
  status: string | null
}

type Props = {
  /** 대상 고객사. null 이면 비활성 상태로 그린다. */
  customerId: number | null
  value: QuoteHit | null
  onChange: (q: QuoteHit | null) => void
}

export default function QuotePicker({ customerId, value, onChange }: Props) {
  const supabase = createClient()
  const [rows, setRows] = useState<QuoteHit[]>([])
  // 어느 고객사의 목록을 들고 있는지. '불러오는 중'은 이 값과 customerId 를 비교해 파생시킨다 —
  // 따로 loading 플래그를 두면 effect 안에서 곧바로 setState 하게 되고, 그 한 번이 렌더를 더 돈다.
  const [loadedFor, setLoadedFor] = useState<number | null>(null)
  const [filter, setFilter] = useState('')

  // 고객사가 비어 있으면 아무것도 읽지 않는다(아래에서 다른 화면을 그린다).
  // 조회는 외부(Supabase)에서 값이 돌아온 뒤 콜백에서 반영한다 — effect 안에서 곧바로
  // setState 하지 않는다(그러면 렌더를 한 번 더 돌게 된다).
  useEffect(() => {
    if (customerId == null || loadedFor === customerId) return
    let cancelled = false
    supabase
      .from('quotes')
      .select('quote_id, quote_number, quote_date, total_supply, status')
      .eq('customer_id', customerId)
      .order('quote_date', { ascending: false })
      .limit(LIMIT)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) console.error('[showroom] quote load failed', error)
        setRows(error ? [] : (data ?? []) as QuoteHit[])
        setLoadedFor(customerId)
      })
    return () => { cancelled = true }
  }, [supabase, customerId, loadedFor])

  const loading = customerId != null && loadedFor !== customerId

  if (customerId == null) {
    return (
      <div style={{ padding: '14px 0', fontSize: 12, color: MUTED }}>
        대상 고객사를 먼저 고르면 그 업체의 견적을 연결할 수 있습니다.
      </div>
    )
  }

  // 고른 견적은 칩 하나로 보여주고 × 로 해제한다.
  if (value) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        border: `1px solid ${BORDER}`, borderRadius: 6, padding: '10px 12px', background: CARD_BG,
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: BLUE, flexShrink: 0 }}>{value.quote_number ?? '-'}</span>
        <span style={{ fontSize: 12, color: MUTED, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {value.quote_date ?? '-'}
          <span style={{ color: FAINT }}> · </span>₩{numKR(value.total_supply ?? 0)}
          {value.status && <><span style={{ color: FAINT }}> · </span>{value.status}</>}
        </span>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={() => onChange(null)} title="연결 해제"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED, padding: 0, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    )
  }

  const q = filter.trim().toLowerCase()
  const shown = q ? rows.filter(r => (r.quote_number ?? '').toLowerCase().includes(q)) : rows

  return (
    <div>
      <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="견적번호로 좁히기"
        style={{
          width: '100%', height: 40, padding: '0 12px', border: `1px solid ${BORDER}`, borderRadius: 6,
          boxSizing: 'border-box', color: TEXT, background: CARD_BG, outline: 'none', fontSize: 14,
          fontFamily: 'inherit', marginBottom: 8,
        }} />
      {loading ? (
        <div style={{ padding: '14px 0', textAlign: 'center', fontSize: 12, color: MUTED }}>불러오는 중...</div>
      ) : shown.length === 0 ? (
        <div style={{ padding: '14px 0', textAlign: 'center', fontSize: 12, color: MUTED }}>
          {rows.length === 0 ? '이 업체의 견적이 없습니다' : '조건에 맞는 견적이 없습니다'}
        </div>
      ) : (
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, maxHeight: 200, overflowY: 'auto' }}>
          {shown.map((r, i) => (
            <div key={r.quote_id} onClick={() => onChange(r)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', cursor: 'pointer',
                borderTop: i === 0 ? 'none' : `1px solid ${BORDER}`, background: CARD_BG,
              }}
              onMouseEnter={e => ((e.currentTarget as HTMLDivElement).style.background = NEUTRAL_BG)}
              onMouseLeave={e => ((e.currentTarget as HTMLDivElement).style.background = CARD_BG)}>
              <span style={{ fontSize: 12, fontWeight: 700, color: BLUE, flexShrink: 0 }}>{r.quote_number ?? '-'}</span>
              <span style={{ fontSize: 11, color: MUTED, flexShrink: 0 }}>{r.quote_date ?? '-'}</span>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 11, color: SUB, flexShrink: 0 }}>₩{numKR(r.total_supply ?? 0)}</span>
              {r.status && <span style={{ fontSize: 11, color: MUTED, flexShrink: 0 }}>{r.status}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
