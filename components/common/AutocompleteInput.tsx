'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Z } from '@/lib/zIndex'

/**
 * 자동완성 입력창.
 * - 타이핑 시 suggestions 중 대소문자 무시 부분 일치 항목을 최대 8개 추천
 * - 입력이 비었거나, 정확히 일치하는 값 하나만 남으면 목록을 닫는다
 * - ↑↓ 이동 / Enter 선택(열려 있을 때만) / Esc 닫기 / Tab 닫고 이동
 * - 입력창·목록 밖 mousedown 시 닫힘
 */
type Props = {
  value: string
  onChange: (v: string) => void
  suggestions: string[]
  placeholder?: string
  style?: CSSProperties
  tabIndex?: number
}

// 일치하는 부분을 굵게 강조
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
  const wrapRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const [hovered, setHovered] = useState(-1)

  const q = value.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!q) return []
    const m = suggestions.filter(s => s.toLowerCase().includes(q)).slice(0, 8)
    // 정확히 일치하는 값 하나만 남으면 목록을 닫는다
    if (m.length === 1 && m[0].toLowerCase() === q) return []
    return m
  }, [suggestions, q])

  const isOpen = open && filtered.length > 0

  // 입력이 바뀌면 첫 항목으로 하이라이트 초기화
  useEffect(() => { setHighlighted(0) }, [q])

  // 외부 클릭(mousedown) → 닫기
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const select = (s: string) => { onChange(s); setOpen(false) }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      if (!isOpen) return
      e.preventDefault(); setHighlighted(h => Math.min(h + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      if (!isOpen) return
      e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      // 열려 있을 때만 선택. 닫혀 있으면 기본 동작(폼 제출)을 막지 않는다.
      if (isOpen && filtered[highlighted]) { e.preventDefault(); select(filtered[highlighted]) }
    } else if (e.key === 'Escape') {
      if (isOpen) { e.preventDefault(); setOpen(false) }
    } else if (e.key === 'Tab') {
      setOpen(false) // 다음 필드로 이동은 기본 동작 유지
    }
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        style={style}
        tabIndex={tabIndex}
      />
      {isOpen && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, width: '100%', marginTop: 4,
          background: '#fff', border: '1px solid #ebebeb', borderRadius: 6,
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)', maxHeight: 240, overflowY: 'auto', zIndex: Z.inPage,
        }}>
          {filtered.map((s, i) => {
            const bg = i === highlighted ? '#f1f1f1' : i === hovered ? '#f5f5f5' : 'transparent'
            return (
              <div key={s}
                onMouseDown={e => { e.preventDefault(); select(s) }}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(h => (h === i ? -1 : h))}
                style={{
                  padding: '8px 11px', fontSize: 13, color: '#111827', cursor: 'pointer', background: bg,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                {highlightMatch(s, q)}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
