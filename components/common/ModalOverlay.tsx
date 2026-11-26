'use client'

// 모달의 **바탕(오버레이)** — 닫는 길을 한곳에서 정한다.
//
// ── 닫는 길 두 개 ───────────────────────────────────────────────────────────
//   바깥 클릭 — 바탕에서 **누르고 뗀 것**이 모두 바탕일 때만 닫는다. 모달 안의 글자를
//               긁다가 손이 바탕에서 떨어졌다고 닫히면 쓰던 글이 날아간다.
//   Esc      — 2026-11-02 에 여기로 들였다. 전에는 ModalOverlay 에 Esc 가 없어서
//               네 모달만 각자 keydown 을 달아 두고 나머지 29개는 Esc 로 닫히지 않았다
//               (docs 조사 2026-11-02). 공용 한 곳에 두면 전부 같은 규칙이 된다.
//
// ── 여러 겹일 때는 맨 위만 닫힌다 ──────────────────────────────────────────
//   모달 위에 모달이 열리는 자리가 있다(업체 등록 → 주소 검색, 결재 → 결재선 고르기,
//   그리고 아래의 「저장하지 않고 닫을까요?」 확인창 자체). Esc 를 각자 받으면 한 번에
//   두 겹이 닫힌다. 그래서 떠 있는 오버레이를 **쌓아 두고 맨 위인 것만** 반응한다 —
//   그 쌓임은 components/common/overlayStack.ts 가 들고, 모달이 아닌 드로어·전체화면
//   지도도 같은 줄에 선다. 닫는 길이 막힌 모달(closeOn='none')도 쌓기에는 들어간다.
//
// ── 입력 중인 폼은 묻고 닫는다 ─────────────────────────────────────────────
//   confirmClose 를 켜면 Esc·바깥 클릭이 바로 닫지 않고 「저장하지 않고 닫을까요?」를
//   먼저 묻는다(닫기 / 계속 작성). 저장 버튼으로 닫는 길은 묻지 않는다 — 그쪽은 onClose 를
//   직접 부르고 이 오버레이를 지나지 않는다.
//
//   dirty 를 함께 주면 **바뀐 것이 없을 때는 묻지 않는다**(열어 보고 그냥 닫는 흐름이
//   대부분이라, 그때까지 확인을 받으면 성가신 쪽이 이긴다). 못 주는 모달은 confirmClose
//   만 켜 둔다 — 그런 모달은 늘 묻는다.

import { createContext, useContext, useRef, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { modalOverlayStyle } from '../customer/constants'
import { useConfirmOptional } from './confirmContext'
import { useOverlayEsc } from './overlayStack'

/**
 * 브라우저에 올라왔는가. 서버에서 그릴 때는 거짓이라 **아무것도 내지 않는다**.
 *
 * 포털은 document.body 가 있어야 하므로 첫(수화) 렌더에서는 쓸 수 없다. effect 안에서
 * setState 로 켜면 lint 가 막는 모양(set-state-in-effect)이 되므로, 서버 값과 클라이언트
 * 값이 다른 외부 저장소처럼 읽는다 — 수화는 서버 값으로 맞춰지고 그 뒤 한 번 다시 그린다.
 */
const noSubscribe = () => () => {}
const onClient = () => true
const onServer = () => false
const useMounted = (): boolean => useSyncExternalStore(noSubscribe, onClient, onServer)

/**
 * **닫기 요청** — Esc·바깥 클릭이 지나는 그 함수를 자식에게 그대로 내려 준다.
 *
 * 우상단 ✕ 가 onClose 를 직접 부르면 confirmClose 를 지나치게 된다(Esc 로는 묻고 ✕
 * 로는 안 묻는 모달이 생긴다). 공용 카드(ModalCard)의 ✕ 는 이것을 쓴다 — 세 길이
 * 한 함수다. 바깥에서 ModalOverlay 없이 쓰이면 null 이다(그때는 제 onClose 를 쓴다).
 */
const RequestCloseContext = createContext<(() => void) | null>(null)

/** 떠 있는 모달의 닫기 요청. ModalOverlay 안이 아니면 null. */
export const useRequestClose = (): (() => void) | null => useContext(RequestCloseContext)

/** 닫는 길. 'both' = Esc + 바깥 클릭(기본) · 'backdrop' = 바깥 클릭만 · 'none' = 둘 다 막는다. */
export type CloseOn = 'both' | 'backdrop' | 'none'

type Props = {
  onClose: () => void
  children: ReactNode
  style?: CSSProperties
  /** 기본 'both'. 저장 중처럼 닫히면 안 되는 동안은 'none' 으로 둘 수 있다. */
  closeOn?: CloseOn
  /** 켜면 Esc·바깥 클릭 때 「저장하지 않고 닫을까요?」를 먼저 묻는다. */
  confirmClose?: boolean
  /**
   * 열었을 때와 달라진 것이 있는가. **false 면 confirmClose 를 켜도 묻지 않는다.**
   * 주지 않으면(undefined) 늘 묻는다 — 모르면 안전한 쪽을 고른다.
   */
  dirty?: boolean
}

export default function ModalOverlay({
  onClose, children, style, closeOn = 'both', confirmClose = false, dirty,
}: Props) {
  const downOnOverlay = useRef(false)
  const confirm = useConfirmOptional()

  /**
   * 닫기를 **요청**한다 — 물어야 하면 묻고, 아니면 바로 닫는다.
   * 「계속 작성」을 고르면 아무 일도 하지 않는다.
   */
  const requestClose = async () => {
    if (confirmClose && dirty !== false && confirm) {
      const ok = await confirm({
        title: '저장하지 않고 닫을까요?',
        message: '작성 중인 내용은 저장되지 않습니다.',
        confirmText: '닫기',
        cancelText: '계속 작성',
        variant: 'danger',
      })
      if (!ok) return
    }
    onClose()
  }

  // 쌓임·Esc 는 공용 훅이 본다(components/common/overlayStack.ts) — 모달이 아닌
  // 드로어·전체화면 지도도 같은 줄에 서서 두 겹이 함께 닫히지 않는다.
  useOverlayEsc(closeOn === 'both', () => { void requestClose() })

  const backdropOk = closeOn === 'both' || closeOn === 'backdrop'
  const mounted = useMounted()

  const overlay = (
    <div
      /* 공용 규칙은 app/globals.css 의 .ems-modal-overlay 가 들고 있다 —
         윗변 6vh 고정 · 최대 높이 88vh · 폰에서는 전체 화면 시트. */
      className="ems-modal-overlay"
      style={{ ...modalOverlayStyle, ...style }}
      onMouseDown={(e) => { downOnOverlay.current = e.target === e.currentTarget }}
      onMouseUp={(e) => {
        const onBg = downOnOverlay.current && e.target === e.currentTarget
        downOnOverlay.current = false
        if (onBg && backdropOk) void requestClose()
      }}
    >
      <RequestCloseContext.Provider value={() => { void requestClose() }}>
        {children}
      </RequestCloseContext.Provider>
    </div>
  )

  // ── 왜 포털인가 (2026-11-26 묶음2 B1) ─────────────────────────────────────
  //
  // 이 바탕은 position: fixed 다 — 「화면 전체」를 덮으려면 기준이 뷰포트여야 한다.
  // 그런데 **조상 중 하나에 transform 이 걸리면 그 조상이 기준이 된다**(CSS 의
  // containing block 규칙). 홈의 카드 껍데기(DashCard)는 호버에 translateY(-2px) 을
  // 걸고 overflow: hidden 이라, 그 안에서 모달을 열면 바탕이 **카드 크기로 줄고
  // 잘렸다.** 게다가 호버가 들고 나면서 transform 이 붙었다 떨어져, 모달이 카드
  // 크기 ↔ 전체 화면을 왕복하며 깜빡였다(「＋ 사후 실적」 창. 2026-11-26 실측:
  // 리렌더는 늘지 않았다 — 렌더 루프가 아니라 **CSS 기준점**이 범인이다).
  //
  // 그래서 어디서 열든 **document.body 밑으로 옮겨 그린다**. 이벤트는 React 나무를
  // 따라 그대로 올라가므로(포털도 부모에게 버블한다) 넣는 쪽의 stopPropagation 은
  // 그대로 듣고, context·`.acc-form` 같은 조상 클래스도 children 과 함께 옮겨 간다.
  if (!mounted) return null
  return createPortal(overlay, document.body)
}
