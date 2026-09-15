'use client'

// 대상 고객사 검색 — 등록된 업체를 골라 customer_id 를 돌려준다.
//
// 기존 고객사 검색은 독립 컴포넌트가 아니라 app/quote/page.tsx 안에 인라인으로 박혀 있다
// (:1112-1174 마크업, :368-375 조회). 그래서 같은 방식으로 새로 만들되,
// 조회 조건·키보드 조작·목록 모양은 그쪽과 똑같이 맞춘다.
//   · 조회: customers 에서 deleted_at is null, is_parent=false, company_name ilike, 최대 10건
//   · ↑↓ 이동 / Enter 선택 / Esc 닫기 — useListKeyboard 공용 훅
//   · 바깥 클릭 시 닫힘 — useOutsideClick 공용 훅
// AutocompleteInput 은 문자열만 돌려주므로 여기서는 쓸 수 없다(customer_id 가 필요하다).

import { useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useListKeyboard } from '@/hooks/useListKeyboard'
import { useOutsideClick } from '@/hooks/useOutsideClick'
import { Z } from '@/lib/zIndex'
import { BLUE, BORDER, CARD_BG, TEXT, MUTED } from '@/components/common/ui'

export type CustomerHit = {
  customer_id: number
  company_name: string
  address: string | null
  status: string | null
}

type Props = {
  value: CustomerHit | null
  onChange: (c: CustomerHit | null) => void
  placeholder?: string
  invalid?: boolean
  /** 입력칸 높이. 모달 안에서는 다른 입력과 맞춰 44 를 쓴다. */
  height?: number
}

export default function CustomerSearch({ value, onChange, placeholder = '업체명 검색', invalid, height = 44 }: Props) {
  const supabase = createClient()
  const wrapRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CustomerHit[]>([])
  const [open, setOpen] = useState(false)

  useOutsideClick(wrapRef, () => setOpen(false), open)

  const select = (c: CustomerHit) => {
    onChange(c)
    setQuery('')
    setResults([])
    setOpen(false)
  }

  const keys = useListKeyboard(results, open && results.length > 0, listRef, select)

  const search = async (q: string) => {
    setQuery(q)
    if (!q.trim()) { setResults([]); setOpen(false); return }
    // 부모 행(회사 묶음)은 사용 대상이 아니다 — 견적 화면과 같은 조건.
    const { data, error } = await supabase
      .from('customers')
      .select('customer_id, company_name, address, status')
      .is('deleted_at', null)
      .eq('is_parent', false)
      .ilike('company_name', `%${q}%`)
      .limit(10)
    if (error) { console.error('[showroom] customer search failed', error); return }
    setResults((data ?? []) as CustomerHit[])
    setOpen(true)
  }

  const fieldStyle = {
    width: '100%', height, padding: '0 12px',
    border: invalid ? '1px solid #dc2626' : `1px solid ${BORDER}`,
    borderRadius: 6, boxSizing: 'border-box' as const,
    color: TEXT, background: CARD_BG, outline: 'none', fontSize: 16, fontFamily: 'inherit',
  }

  // 고르고 나면 이름을 글자로 보여주고, 다시 찾을 때는 × 로 비운다(견적 화면과 같은 방식).
  if (value) {
    return (
      <div style={{ ...fieldStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14 }}>
          {value.company_name}
        </span>
        <button type="button" onClick={() => onChange(null)} title="지우기"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED, padding: 0, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    )
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        value={query}
        onChange={e => search(e.target.value)}
        onFocus={() => { if (results.length > 0) setOpen(true) }}
        onKeyDown={keys.onKeyDown}
        placeholder={placeholder}
        style={fieldStyle}
      />
      {open && results.length > 0 && (
        <div ref={listRef} style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: Z.inPage,
          background: CARD_BG, border: `1px solid ${BLUE}`, borderRadius: 8,
          maxHeight: 220, overflowY: 'auto', boxShadow: '0 8px 24px rgba(35,78,162,0.12)',
        }}>
          {results.map((c, i) => (
            <div key={c.customer_id} onClick={() => select(c)}
              onMouseEnter={() => keys.setActive(i)}
              style={{
                padding: '9px 12px', cursor: 'pointer', borderBottom: `1px solid ${BORDER}`, fontSize: 12,
                background: keys.active === i ? '#f0f4ff' : CARD_BG, transition: 'background 0.15s ease',
              }}>
              <div style={{ fontWeight: 700, color: BLUE }}>{c.company_name}</div>
              <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>
                {c.address ?? ''}{c.status ? ` · ${c.status}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
