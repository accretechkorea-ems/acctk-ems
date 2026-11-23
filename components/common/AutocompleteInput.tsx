'use client'

import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import SearchSelect from '@/components/common/SearchSelect'

/**
 * 자동완성 입력창 — **글자만** 고르는 자리(분류·품목명처럼 id 가 없는 값).
 *
 * 목록·키보드·닫기는 공용 콤보박스가 맡는다(components/common/SearchSelect.tsx, 2026-11-23).
 * 전에는 이 파일이 같은 것을 한 벌 더 들고 있었다 — ↑↓·Enter·Esc·Tab·바깥 클릭·hover.
 * 옮기면서 목록이 **포털로** 뜬다: 모달이나 스크롤 상자 안에서도 잘리지 않는다.
 *
 * 이 자리만의 규칙 둘은 그대로다.
 *   · 입력이 비면 아무것도 추천하지 않는다(후보 전체를 쏟지 않는다).
 *   · 적은 글자와 **똑같은** 후보 하나만 남으면 목록을 닫는다(더 고를 것이 없다).
 */
type Props = {
  value: string
  onChange: (v: string) => void
  suggestions: string[]
  placeholder?: string
  style?: CSSProperties
  tabIndex?: number
}

/** 일치하는 부분을 굵게 강조. */
function highlightMatch(text: string, q: string): ReactNode {
  if (!q) return text
  const idx = text.toLowerCase().indexOf(q)
  if (idx < 0) return text
  return (
    <>
      {text.slice(0, idx)}
      <span style={{ fontWeight: 600 }}>{text.slice(idx, idx + q.length)}</span>
      {text.slice(idx + q.length)}
    </>
  )
}

export default function AutocompleteInput({ value, onChange, suggestions, placeholder, style, tabIndex }: Props) {
  // 고른 값이 곧 입력값이다(별도의 검색어가 없다). 고른 뒤에는 목록을 닫아 둔다.
  const [picked, setPicked] = useState<string | null>(null)

  const q = value.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!q || picked === value) return []
    const m = suggestions.filter(s => s.toLowerCase().includes(q)).slice(0, 8)
    // 정확히 일치하는 값 하나만 남으면 목록을 닫는다
    if (m.length === 1 && m[0].toLowerCase() === q) return []
    return m
  }, [suggestions, q, picked, value])

  return (
    <SearchSelect<string>
      items={filtered}
      itemKey={s => s}
      renderItem={s => (
        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {highlightMatch(s, q)}
        </span>
      )}
      onSelect={s => { onChange(s); setPicked(s) }}
      query={value}
      onQueryChange={v => { onChange(v); setPicked(null) }}
      placeholder={placeholder}
      inputStyle={style}
      tabIndex={tabIndex}
      // 포커스만으로는 열지 않는다 — 글을 적기 시작해야 후보를 낸다(종전과 같다).
      openOnFocus={false}
    />
  )
}
