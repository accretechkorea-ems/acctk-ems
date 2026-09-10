'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useListKeyboard } from '@/hooks/useListKeyboard'
import { Z } from '@/lib/zIndex'

/**
 * 자동완성 입력창.
 * - 타이핑 시 suggestions 중 대소문자 무시 부분 일치 항목을 최대 8개 추천
 * - 입력이 비었거나, 정확히 일치하는 값 하나만 남으면 목록을 닫는다
 * - ↑↓ 이동 / Enter 선택(열려 있을 때만) / Esc 닫기 / Tab 닫고 이동 — useListKeyboard 공용
 * - IME 조합 중에는 키를 가로채지 않는다(한글 입력 중 Enter 는 조합 확정)
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
  const listRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)

  const q = value.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!q) return []
    const m = suggestions.filter(s => s.toLowerCase().includes(q)).slice(0, 8)
    // 정확히 일치하는 값 하나만 남으면 목록을 닫는다
    if (m.length === 1 && m[0].toLowerCase() === q) return []
    return m
  }, [suggestions, q])

  const isOpen = open && filtered.length > 0

  // 외부 클릭(mousedown) → 닫기
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const select = (s: string) => { onChange(s); setOpen(false) }

  // ↑↓ 이동·Enter 선택·IME 처리는 견적 화면의 검색과 같은 훅을 쓴다.
  const keys = useListKeyboard(filtered, isOpen, listRef, select)

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // IME 조합 중에는 아무것도 가로채지 않는다 — 한글 입력 중 Enter 는 조합 확정이고,
    // Esc 는 조합 취소다(훅과 같은 기준으로 여기서도 먼저 걸러낸다).
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'Escape') {
      if (isOpen) { e.preventDefault(); setOpen(false) }
      return
    }
    if (e.key === 'Tab') {
      setOpen(false) // 다음 필드로 이동은 기본 동작 유지
      return
    }
    // 닫혀 있으면 훅이 Enter 를 잡지 않아 기본 동작(폼 제출)이 그대로 유지된다.
    keys.onKeyDown(e)
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
        <div ref={listRef} style={{
          position: 'absolute', top: '100%', left: 0, width: '100%', marginTop: 4,
          background: '#fff', border: '1px solid #ebebeb', borderRadius: 6,
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)', maxHeight: 240, overflowY: 'auto', zIndex: Z.inPage,
        }}>
          {/* 마우스 hover 와 키보드 선택이 같은 표시를 쓴다 — hover 는 색을 직접 칠하지 않고
              선택 위치만 옮기고, 그리는 쪽은 active 하나만 본다(두 곳이 동시에 강조되지 않는다). */}
          {filtered.map((s, i) => (
            <div key={s}
              onMouseDown={e => { e.preventDefault(); select(s) }}
              onMouseEnter={() => keys.setActive(i)}
              style={{
                padding: '8px 11px', fontSize: 13, color: '#111827', cursor: 'pointer',
                background: i === keys.active ? '#f1f1f1' : 'transparent',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
              {highlightMatch(s, q)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
