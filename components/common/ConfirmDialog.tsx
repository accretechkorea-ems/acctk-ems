'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import ModalOverlay from './ModalOverlay'

/**
 * 확인 다이얼로그 시스템 (Context 기반, Toast.tsx 와 동일 패턴).
 *
 * 사용법:
 *   const confirm = useConfirm()
 *   const ok = await confirm({
 *     title: '서비스 기록 삭제',
 *     message: '이 서비스 기록을 삭제하시겠습니까?',
 *     confirmText: '삭제',
 *     variant: 'danger',
 *   })
 *   if (!ok) return
 *
 * - title·message 필수. confirmText 기본 '확인' / cancelText 기본 '취소'
 * - variant 'danger' → 확인 버튼 빨강, 'default'(기본) → #234ea2
 * - message 의 줄바꿈(\n) 반영 (whiteSpace: pre-line)
 * - 열리면 확인 버튼 포커스 / ESC·오버레이 바깥 클릭 → false 반환
 * - z-index 10050 (기존 모달 10001 위, Toast 10100 아래)
 */

type ConfirmOptions = {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  variant?: 'danger' | 'default'
}
type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm 은 <ConfirmProvider> 안에서만 사용할 수 있습니다.')
  return ctx
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const resolveRef = useRef<((v: boolean) => void) | null>(null)

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve
      setOptions(opts)
    })
  }, [])

  const close = useCallback((result: boolean) => {
    resolveRef.current?.(result)
    resolveRef.current = null
    setOptions(null)
  }, [])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options && <ConfirmDialog options={options} onClose={close} />}
    </ConfirmContext.Provider>
  )
}

function ConfirmDialog({ options, onClose }: { options: ConfirmOptions; onClose: (result: boolean) => void }) {
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null)
  const isDanger = options.variant === 'danger'
  const confirmBg = isDanger ? '#ef4444' : '#234ea2'
  const confirmHover = isDanger ? '#dc2626' : '#1c3e87'

  // 열리면 확인 버튼 포커스
  useEffect(() => { confirmBtnRef.current?.focus() }, [])
  // ESC → false
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <ModalOverlay onClose={() => onClose(false)} style={{ zIndex: 10050 }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 400, background: '#ffffff', borderRadius: 8, padding: 24,
          boxShadow: '0 20px 60px rgba(0,0,0,0.22)', border: '1px solid #ebebeb', animation: 'modal-in 0.18s ease',
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, color: '#111827', letterSpacing: '-0.2px', marginBottom: 10 }}>{options.title}</div>
        <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.6, whiteSpace: 'pre-line', marginBottom: 22 }}>{options.message}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={() => onClose(false)}
            style={{ padding: '9px 16px', background: '#fff', color: '#6b7280', borderRadius: 6, border: '1px solid #ebebeb', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
            {options.cancelText ?? '취소'}
          </button>
          <button ref={confirmBtnRef} onClick={() => onClose(true)}
            onMouseEnter={(e) => (e.currentTarget.style.background = confirmHover)}
            onMouseLeave={(e) => (e.currentTarget.style.background = confirmBg)}
            style={{ padding: '9px 18px', background: confirmBg, color: '#fff', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, transition: 'background 0.15s ease' }}>
            {options.confirmText ?? '확인'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}
