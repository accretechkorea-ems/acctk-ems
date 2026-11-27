'use client'

/**
 * 모달의 **속 카드** — 머리줄 고정 / 본문 스크롤 / 바닥줄 고정 (2026-11-21).
 *
 * ── 왜 ───────────────────────────────────────────────────────────────────
 *   바탕(ModalOverlay)은 2026-11-02에 한 곳으로 모았는데, **카드 속**은 모달마다
 *   달랐다. 2차 조사에서 「머리·바닥이 고정되지 않은 모달 26개」가 나왔다 — 그 모달은
 *   내용이 길어지면 카드 전체가 구르면서 제목과 저장 버튼이 화면 밖으로 사라진다
 *   (공용 CSS 가 `.ems-modal-overlay > *` 에 overflow-y: auto 를 걸어 두기 때문이다).
 *   이 카드는 스스로 `overflow: hidden` 을 들고(인라인이라 그 규칙을 이긴다) 본문만
 *   구른다. 머리줄과 바닥줄은 늘 같은 자리다.
 *
 * ── 닫는 길 셋이 한 함수다 ─────────────────────────────────────────────────
 *   Esc · 바깥 클릭 · 우상단 ✕. 앞의 둘은 ModalOverlay 가 받고, ✕ 는 그 오버레이가
 *   내려 준 **같은 함수**(useRequestClose)를 쓴다. 그래서 confirmClose 를 켠 모달은
 *   세 길 모두 「저장하지 않고 닫을까요?」를 지난다. 전에는 ✕ 만 그냥 닫혔다.
 *
 * ── 모션 ────────────────────────────────────────────────────────────────
 *   `.ems-modal-card` 한 줄(app/globals.css) — 150ms fade + 살짝 커짐. 화면마다
 *   적혀 있던 @keyframes modal-in 아홉 벌을 대신한다.
 *
 * ── 쓰는 법 ─────────────────────────────────────────────────────────────
 *     <ModalOverlay onClose={close} confirmClose dirty={dirty}>
 *       <ModalCard title="사업장 수정" width={1100} footer={<>…버튼…</>}>
 *         …본문…
 *       </ModalCard>
 *     </ModalOverlay>
 *
 *   겉모양은 그대로 둔다 — 폭·여백·버튼은 부르는 쪽이 정한다. 이 부품이 정하는 것은
 *   **구조 셋**(머리·본문·바닥)과 닫는 길, 그리고 모션뿐이다.
 *
 *   한 가지는 모인다: **제목 글자 18/700**(지금 가장 많은 값 — 13자리). 17/800 이던
 *   10자리와 20/800 이던 3자리가 이 값으로 바뀐다. 제목을 다르게 두어야 하는 자리는
 *   title 에 글자 대신 조각을 넘긴다(그 자리는 이 부품이 손대지 않는다).
 */

import type { CSSProperties, ReactNode, RefObject } from 'react'
import { useRequestClose } from '@/components/common/ModalOverlay'
import { R } from '@/lib/radius'

const BORDER = '#ebebeb'
const TEXT = '#111827'
const SUB = '#4b5563'
const MUTED = '#6b7280'

/** 머리줄·바닥줄의 좌우 여백. 본문 기본 여백과 같은 값이라 글자가 한 줄로 선다. */
const PAD_X = 22

/** 바닥줄의 두 자리. 비는 쪽은 주지 않아도 된다. */
export type ModalFooterSlots = {
  /** 되돌릴 수 없는 일 — 삭제·폐기·종료. 왼쪽 끝에 선다. */
  left?: ReactNode
  /** 취소 → 주 버튼. 오른쪽 끝에 선다. */
  right?: ReactNode
}

/**
 * 슬롯 둘로 준 것인가, 조각 하나로 준 것인가.
 *
 * ⚠ React 조각의 표시는 **$$typeof**(달러 둘)다. 2026-11-27(묶음5 1-3)에 이 줄을
 *   달러 **하나**로 적어 두어, 조각으로 준 바닥줄이 전부 슬롯으로 잘못 읽혔다 —
 *   footer.left·footer.right 가 undefined 라 **버튼이 하나도 그려지지 않았다**.
 *   조각 바닥줄을 쓰는 모달이 77곳이라(확인 창까지) 그 사이 저장·취소가 전부 사라져
 *   있었다. 2026-11-28(야간4)에 포캐스트 등록 창을 캡처하다 보고 고쳤다.
 */
const isSlots = (f: ReactNode | ModalFooterSlots): f is ModalFooterSlots =>
  f != null && typeof f === 'object' && !Array.isArray(f) && !('$$typeof' in (f as object))

/** 바닥줄 버튼의 **한 벌 높이**. 왼쪽이든 오른쪽이든 같다. */
export const MODAL_BTN_H = 34
/** 버튼 사이 간격. */
export const MODAL_BTN_GAP = 8

export type ModalCardProps = {
  /** 머리줄의 제목. 글자 대신 조각을 넣어도 된다(두 줄 제목·뱃지…). */
  title?: ReactNode
  /** 제목 아래 작은 줄. */
  subtitle?: ReactNode
  /** 제목 오른쪽(✕ 왼쪽)에 붙는 것 — 건수 뱃지·세그먼트 같은 것. */
  titleExtra?: ReactNode
  /** 카드 최대 폭(px). 좁은 화면에서는 92vw 로 줄어든다. */
  width?: number
  /** 바닥줄 — 버튼 묶음. 주지 않으면 바닥줄을 그리지 않는다. */
  /**
   * 바닥줄. **슬롯 둘**로 주는 것이 바른 길이다(2026-11-27, 묶음5 1-3):
   *
   *     footer={{ left: [<삭제/>], right: [<취소/>, <저장/>] }}
   *
   *   왼쪽  — **되돌릴 수 없는 일**(삭제·폐기·종료). 빨간 글자 · 흰 바탕.
   *   오른쪽 — 취소(흰) → 주 버튼(파랑). **주 버튼이 늘 맨 오른쪽**이다.
   *
   * 왜 자리를 못 박나: 모달마다 순서가 달라 「삭제」가 저장 자리에 있던 창이 있었다.
   * 자리가 뜻을 말해야 손이 먼저 간다. 조각 하나를 그대로 넘기는 옛 길도 받지만
   * (scripts/modal-footer-check.js 가 남은 자리를 센다), 새로 쓰는 곳은 슬롯을 쓴다.
   */
  footer?: ReactNode | ModalFooterSlots
  children: ReactNode
  /** ✕ 를 둘까. 기본은 둔다. 확인 창처럼 길이 버튼뿐인 자리는 false. */
  closeX?: boolean
  /**
   * ✕ 를 눌렀을 때. 보통은 주지 않는다 — 오버레이의 닫기 요청(Esc·바깥 클릭과 같은
   * 함수)을 쓴다. 오버레이 밖에서 쓰거나 다른 일을 해야 할 때만 준다.
   */
  onClose?: () => void
  /** 카드 전체 스타일(배경·그림자는 기본값이 있다). */
  style?: CSSProperties
  /** 본문 스타일 — 여백을 0 으로 두고 표를 꽉 채우는 모달이 있다. */
  bodyStyle?: CSSProperties
  /** 머리줄 스타일. */
  headStyle?: CSSProperties
  /** 바닥줄 스타일. */
  footStyle?: CSSProperties
  /** 본문 칸의 ref — 스크롤 힌트·자동 스크롤이 쓴다. */
  bodyRef?: RefObject<HTMLDivElement | null>
  className?: string
  /**
   * 보조 기술에 「이것은 대화창이다」를 알리는 세 칸. 옮기기 전에 이 표시를 달고 있던
   * 모달이 있어 그대로 넘길 길을 둔다 — 달려 있던 것을 떨어뜨리지 않는다.
   * (기본은 주지 않는다. 지금 이 표시가 없는 모달 쪽 동작까지 바꾸지 않으려는 것이다.)
   */
  role?: string
  ariaModal?: boolean
  ariaLabel?: string
}

export default function ModalCard({
  title, subtitle, titleExtra, width = 480, footer, children,
  closeX = true, onClose, style, bodyStyle, headStyle, footStyle, bodyRef, className,
  role, ariaModal, ariaLabel,
}: ModalCardProps) {
  const requestClose = useRequestClose()
  const close = onClose ?? requestClose ?? undefined

  return (
    <div
      className={className ? `ems-modal-card ${className}` : 'ems-modal-card'}
      role={role}
      aria-modal={ariaModal}
      aria-label={ariaLabel}
      /* 바탕까지 눌림이 올라가면 바깥 클릭으로 닫힌다 — 카드 안의 클릭은 여기서 멈춘다. */
      onClick={e => e.stopPropagation()}
      style={{
        width: `min(92vw, ${width}px)`, maxWidth: `min(92vw, ${width}px)`,
        display: 'flex', flexDirection: 'column',
        // minHeight 는 **인라인으로 두지 않는다** — 폰에서 공용 CSS 가 카드를
        // 전체 화면 시트로 늘리는데(min-height: 100dvh), 인라인 0 이 그것을 이겨
        // 반쪽 카드가 떴다(2026-11-21 실측: 390 에서 높이 458). 본문 쪽 minHeight 0
        // 하나로 스크롤은 그대로 된다.
        // 인라인이라 `.ems-modal-overlay > * { overflow-y: auto }` 를 이긴다 —
        // 카드가 구르지 않아야 머리·바닥이 고정된다.
        overflow: 'hidden',
        background: '#ffffff', borderRadius: R.modal, border: `1px solid ${BORDER}`,
        boxShadow: '0 20px 60px rgba(0,0,0,0.22)',
        ...style,
      }}>

      {/* ── 머리줄 — 늘 같은 자리 ── */}
      {(title || titleExtra || closeX) && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 10, flexShrink: 0,
          padding: `18px ${PAD_X}px 12px`, ...headStyle,
        }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            {typeof title === 'string'
              ? <div style={{ fontSize: 18, fontWeight: 700, color: TEXT, letterSpacing: '-0.3px' }}>{title}</div>
              : title}
            {subtitle && <div style={{ fontSize: 12, color: SUB, lineHeight: 1.7, marginTop: 3 }}>{subtitle}</div>}
          </div>
          {titleExtra}
          {closeX && close && (
            <button type="button" onClick={close} title="닫기" aria-label="닫기"
              style={{
                width: 28, height: 28, borderRadius: '50%', background: '#f3f4f6', border: 'none',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: SUB, flexShrink: 0,
              }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* ── 본문 — 여기만 구른다 ── */}
      <div ref={bodyRef} className="stable-scroll ems-modal-body"
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: `0 ${PAD_X}px`, ...bodyStyle }}>
        {children}
      </div>

      {/* ── 바닥줄 — 늘 같은 자리 ── */}
      {footer != null && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: MODAL_BTN_GAP, flexShrink: 0,
          justifyContent: isSlots(footer) ? 'space-between' : 'flex-end',
          padding: `14px ${PAD_X}px 18px`, ...footStyle,
        }}>
          {isSlots(footer) ? (
            <>
              {/* 왼쪽 — 되돌릴 수 없는 일. 비어도 자리를 둔다(오른쪽이 늘 오른쪽 끝이게). */}
              <div style={{ display: 'flex', alignItems: 'center', gap: MODAL_BTN_GAP }}>{footer.left}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: MODAL_BTN_GAP }}>{footer.right}</div>
            </>
          ) : footer}
        </div>
      )}
    </div>
  )
}

/** 바닥줄의 회색 버튼 — 모달마다 다시 적지 않게 한 벌 둔다. */
/**
 * **옛 여백을 그대로** 지키며 옮길 때 쓰는 세 묶음 (2026-11-21).
 *
 * 공용 카드의 기본 여백(머리 18/22/12 · 본문 0/22 · 바닥 14/22/18)으로 모으면 모달마다
 * 겉모양이 조금씩 바뀐다. 구조만 옮기고 **보이는 것은 그대로** 두어야 하는 자리에서는
 * 옛 카드의 padding 과 머리·바닥 간격(marginBottom·marginTop)을 그대로 넘긴다.
 *
 *     <ModalCard {...keepPads({ x: 24, top: 24, bottom: 24 }, 20, 24)} … >
 *
 *   x      좌우 여백(옛 카드 padding 의 좌우)
 *   top    위 여백 · bottom 아래 여백
 *   headGap  머리줄과 본문 사이(옛 머리줄의 marginBottom)
 *   footGap  본문과 바닥줄 사이(옛 바닥줄의 marginTop)
 */
export function keepPads(
  pad: { x: number; top: number; bottom: number },
  headGap: number,
  footGap: number,
): Pick<ModalCardProps, 'headStyle' | 'bodyStyle' | 'footStyle'> {
  return {
    headStyle: { padding: `${pad.top}px ${pad.x}px ${headGap}px` },
    bodyStyle: { padding: `0 ${pad.x}px` },
    footStyle: { padding: `${footGap}px ${pad.x}px ${pad.bottom}px` },
  }
}

/**
 * 바닥줄의 세 모양 — **높이가 같다**(MODAL_BTN_H). 전에는 자리마다 padding 이 달라
 * 취소와 저장의 키가 1~2px 씩 어긋났다.
 */
export const modalGhostButton = (busy = false): CSSProperties => ({
  height: MODAL_BTN_H, padding: '0 15px', background: '#fff', color: SUB, borderRadius: R.icon,
  border: `1px solid ${BORDER}`, cursor: busy ? 'not-allowed' : 'pointer',
  fontWeight: 600, fontSize: 13, fontFamily: 'inherit',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
})

/** 바닥줄의 파란 버튼. */
export const modalPrimaryButton = (busy = false): CSSProperties => ({
  height: MODAL_BTN_H, padding: '0 17px', background: '#234ea2', color: '#fff', borderRadius: R.icon,
  border: 'none', cursor: busy ? 'not-allowed' : 'pointer',
  fontWeight: 700, fontSize: 13, opacity: busy ? 0.6 : 1, fontFamily: 'inherit',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
})

/**
 * 되돌릴 수 없는 일 — **왼쪽 자리**의 버튼이다(2026-11-27, 묶음5 1-3).
 * 빨간 **글자**에 흰 바탕이다. 전에는 빨간 바탕이었는데, 바닥줄에서 가장 눈에 띄는 것이
 * 삭제가 되어 버렸다 — 가장 눈에 띄어야 하는 것은 **저장**이다.
 */
export const modalDangerButton = (busy = false): CSSProperties => ({
  ...modalGhostButton(busy),
  color: '#ef4444', borderColor: '#fecaca', fontWeight: 700,
})

/** 옛 빨간 **바탕** 버튼 — 지우기 확인창처럼 그것이 주 버튼인 자리에만 쓴다. */
export const modalDangerPrimaryButton = (busy = false): CSSProperties => ({
  ...modalPrimaryButton(busy), background: '#ef4444',
})

export { MUTED as MODAL_MUTED }
