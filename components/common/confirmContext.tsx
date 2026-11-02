'use client'

// 확인 다이얼로그의 **문맥만** 따로 둔 파일.
//
// 왜 나눴나 — ModalOverlay 가 「저장하지 않고 닫을까요?」를 물으려면 useConfirm 이 필요하고,
// ConfirmDialog 는 그 창을 그리려고 ModalOverlay 를 쓴다. 한 파일에 두면 둘이 서로를
// 불러(순환 import) 모듈 초기화 순서에 따라 한쪽이 undefined 로 들어오는 때가 생긴다.
// 문맥을 이 파일에 두면 ModalOverlay → confirmContext, ConfirmDialog → confirmContext +
// ModalOverlay 로 한 방향이 된다.
//
// 부르는 곳은 종전처럼 '@/components/common/ConfirmDialog' 에서 useConfirm 을 가져오면 된다
// (그 파일이 다시 내보낸다). 새 코드는 어느 쪽에서 가져와도 같다.

import { createContext, useContext } from 'react'

export type ConfirmOptions = {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  variant?: 'danger' | 'default'
}
export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

export const ConfirmContext = createContext<ConfirmFn | null>(null)

/** 확인 창을 띄운다. Provider 밖에서 부르면 바로 알려 준다(조용히 지나가지 않는다). */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm 은 <ConfirmProvider> 안에서만 사용할 수 있습니다.')
  return ctx
}

/**
 * Provider 가 없어도 터지지 않는 쪽 — 없으면 null 이다.
 *
 * ModalOverlay 가 쓴다. 그 컴포넌트는 앱 어디에나 놓일 수 있고(테스트·스토리·공개 페이지),
 * 확인 창을 못 띄우는 자리라고 해서 모달 자체가 열리지 않으면 더 나쁘다 —
 * 그때는 묻지 않고 그냥 닫는다(종전 동작).
 */
export function useConfirmOptional(): ConfirmFn | null {
  return useContext(ConfirmContext)
}
