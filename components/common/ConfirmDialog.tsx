'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import ModalOverlay from './ModalOverlay'
import ModalCard, { keepPads } from './ModalCard'
import { ConfirmContext, useConfirm, type ConfirmFn, type ConfirmOptions } from './confirmContext'
import { Z } from '@/lib/zIndex'
import { R } from '@/lib/radius'

// 문맥·훅은 components/common/confirmContext.tsx 에 있다(순환 import 를 피한다 — 그 파일
// 머리말 참고). 부르는 곳이 바뀌지 않게 여기서 그대로 다시 내보낸다.
export { useConfirm }
export type { ConfirmFn, ConfirmOptions }

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
 * - 열리면 확인 버튼 포커스 / Esc·오버레이 바깥 클릭 → false 반환(ModalOverlay 가 둘 다 받는다)
 * - z-index 는 Z.confirm — 모달·전체화면 지도 위, Toast 아래
 */

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
  // Esc 는 ModalOverlay 가 받는다 — 바깥 클릭과 같이 onClose(false) = **취소**다.

  return (
    <ModalOverlay onClose={() => onClose(false)} style={{ zIndex: Z.confirm }}>
      {/* 구조는 공용 카드가 든다 — 머리줄 고정 / 본문 스크롤 / 바닥줄 고정.
          ✕ 는 두지 않는다(길이 버튼 둘이다 — 「취소」가 그 자리를 한다).
          여백·글자 크기는 **옛 값 그대로**다(keepPads — padding 24, 머리 10, 바닥 0). */}
      <ModalCard
        width={400}
        closeX={false}
        {...keepPads({ x: 24, top: 24, bottom: 24 }, 10, 0)}
        title={<>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#111827', letterSpacing: '-0.2px' }}>{options.title}</div>
        </>}
        footer={<>
          <button onClick={() => onClose(false)}
            style={{ padding: '9px 16px', background: '#fff', color: '#4b5563', borderRadius: R.icon, border: '1px solid #ebebeb', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
            {options.cancelText ?? '취소'}
          </button>
          <button ref={confirmBtnRef} onClick={() => onClose(true)}
            onMouseEnter={(e) => (e.currentTarget.style.background = confirmHover)}
            onMouseLeave={(e) => (e.currentTarget.style.background = confirmBg)}
            style={{ padding: '9px 18px', background: confirmBg, color: '#fff', borderRadius: R.icon, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, transition: 'background 0.15s ease' }}>
            {options.confirmText ?? '확인'}
          </button>
        </>}
      >
        <div style={{ fontSize: 13, color: '#4b5563', lineHeight: 1.6, whiteSpace: 'pre-line', marginBottom: 22 }}>{options.message}</div>
      </ModalCard>
    </ModalOverlay>
  )
}
