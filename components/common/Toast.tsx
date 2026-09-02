'use client'

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { Z } from '@/lib/zIndex'

/**
 * 토스트 알림 시스템 (Context 기반).
 *
 * 사용법:
 *   const toast = useToast()
 *   toast.success('저장되었습니다')
 *   toast.error('저장에 실패했습니다')
 *
 * - 우측 하단 고정, 세로로 쌓임(최대 3개, 초과 시 오래된 것부터 제거)
 * - 성공 3초 / 에러 5초 후 자동 사라짐, 우측 x 버튼으로 즉시 닫기
 * - 등장: 아래→위 슬라이드 + 페이드인 / 퇴장: 페이드아웃
 * - z-index 는 Z.toast — 사다리의 맨 위
 */

type ToastType = 'success' | 'error'
type ToastItem = { id: number; type: ToastType; message: string; leaving?: boolean }
type ToastApi = { success: (message: string) => void; error: (message: string) => void }

const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast 는 <ToastProvider> 안에서만 사용할 수 있습니다.')
  return ctx
}

const MAX = 3
const DURATION: Record<ToastType, number> = { success: 3000, error: 5000 }
const EXIT_MS = 200

// 색: 성공 초록 / 에러 빨강 (기존 팔레트), 배경 흰색 + #234ea2 톤에 맞춘 중립 텍스트
const ACCENT: Record<ToastType, string> = { success: '#22c55e', error: '#ef4444' }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const idRef = useRef(0)

  // 퇴장 애니메이션 후 실제 제거
  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.map(t => (t.id === id ? { ...t, leaving: true } : t)))
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), EXIT_MS)
  }, [])

  const push = useCallback((type: ToastType, message: string) => {
    const id = ++idRef.current
    setToasts(prev => {
      const next = [...prev, { id, type, message }]
      // 최대 3개: 초과 시 오래된 것부터 제거
      return next.length > MAX ? next.slice(next.length - MAX) : next
    })
    setTimeout(() => dismiss(id), DURATION[type])
  }, [dismiss])

  const api = useMemo<ToastApi>(() => ({
    success: (m: string) => push('success', m),
    error: (m: string) => push('error', m),
  }), [push])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div style={{
        position: 'fixed', right: 20, bottom: 20, zIndex: Z.toast,
        display: 'flex', flexDirection: 'column', gap: 10,
        pointerEvents: 'none', // 컨테이너는 클릭 통과, 카드만 클릭 가능
      }}>
        <style>{`
          @keyframes toast-in {
            from { opacity: 0; transform: translateY(12px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          @keyframes toast-out {
            from { opacity: 1; transform: translateY(0); }
            to   { opacity: 0; transform: translateY(4px); }
          }
        `}</style>
        {toasts.map(t => (
          <ToastCard key={t.id} toast={t} onClose={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastCard({ toast, onClose }: { toast: ToastItem; onClose: () => void }) {
  const color = ACCENT[toast.type]
  return (
    <div style={{
      pointerEvents: 'auto',
      display: 'flex', alignItems: 'stretch',
      minWidth: 260, maxWidth: 360,
      background: '#ffffff', border: '1px solid #ebebeb', borderRadius: 8,
      boxShadow: '0 8px 24px rgba(0,0,0,0.12)', overflow: 'hidden',
      animation: toast.leaving ? `toast-out ${EXIT_MS}ms ease forwards` : 'toast-in 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
    }}>
      {/* 좌측 상태 색 바 */}
      <div style={{ width: 4, background: color, flexShrink: 0 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 12px', flex: 1 }}>
        {/* 상태 아이콘 */}
        <span style={{ color, display: 'inline-flex', flexShrink: 0 }}>
          {toast.type === 'success' ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          )}
        </span>
        <div style={{ fontSize: 13, color: '#111827', lineHeight: 1.4, flex: 1, wordBreak: 'break-word' }}>{toast.message}</div>
        {/* 닫기 */}
        <button onClick={onClose} title="닫기"
          onMouseEnter={(e) => (e.currentTarget.style.color = '#111827')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#9ca3af')}
          style={{ flexShrink: 0, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#9ca3af', display: 'inline-flex', alignItems: 'center', transition: 'color 0.15s ease' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  )
}
