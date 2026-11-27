'use client'

// 검색해서 하나 고르는 **공용 콤보박스** (2026-11-23).
//
// 전에는 자리마다 손으로 만들었다 — 대리점·상위 회사·영업기회 회사·쇼룸 업체·견적 사명·
// 견적 품목. 생김새는 비슷한데 조작이 제각각이었다. 공통으로 빠져 있던 것:
//   · ↑↓ 로 고를 수 없다(마우스 전용). Enter 도 없다.
//   · Esc 로 닫히지 않는다. Tab 으로 빠져나가도 목록이 떠 있다.
//   · hover 가 배경색을 **직접 칠한다**. 그래서 키보드 선택과 마우스가 동시에 두 줄을
//     강조하거나, 마우스를 뗀 자리가 지워져 이어서 ↑↓ 를 누르면 처음으로 돌아갔다.
//
// 이 컴포넌트가 지키는 것
//   · ↑↓ 이동(끝에서 돌아온다) · Enter 선택 · Esc 닫기 · Tab 닫고 다음 칸으로.
//   · 고른 자리가 목록 밖이면 그만큼만 굴린다(useListKeyboard 의 scrollIntoView).
//   · 마우스와 키보드가 **같은 표시 하나**를 쓴다 — hover 는 색을 칠하지 않고 active 를 옮긴다.
//   · IME 조합 중에는 키를 가로채지 않는다(한글 입력 중 Enter 는 조합 확정이다).
//   · 목록은 Popover 로 body 에 띄운다 — 모달·스크롤 상자 안에서도 잘리지 않는다.
//
// 거르기는 **부르는 쪽**이 한다(로컬 filter 든 서버 조회든). 이 컴포넌트는 받은 후보를
// 그대로 그린다 — 자리마다 조건이 다르고, 서버에서 찾는 자리도 있기 때문이다.
// 회사를 찾는 자리는 lib/companySearch.ts 의 한 함수를 쓴다.

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useListKeyboard } from '@/hooks/useListKeyboard'
import Popover from '@/components/common/Popover'
import { useOverlayEsc } from '@/components/common/overlayStack'
import { BORDER, CARD_BG, MUTED, NEUTRAL_BG, TEXT } from '@/components/common/ui'
import { R } from '@/lib/radius'
import { Z } from '@/lib/zIndex'
import { PICK_CLASS } from '@/lib/focusRing'

/**
 * 폰에서는 **아래에서 올라오는 시트**다 (2026-11-27).
 *
 * 칸에 붙는 목록은 칸만큼만 넓다(matchAnchorWidth). 390 짜리 화면에서 세 칸이 나란히
 * 선 자리라면 한 칸이 109px 이라, 목록도 109px 이 되어 「CONTOURECORD」 가
 * 「CONTOURECO…」 로 잘린다 — **무엇을 고르는지 모르는 채** 고르게 된다.
 * 그래서 좁은 화면에서는 목록을 화면 아래 시트로 띄운다: 좌우 꽉 차고, 높이는 최대
 * 70dvh 이며 그 안에서 구르고, 맨 위에 검색칸이 그대로 선다.
 *
 * **고르는 값과 동작은 그대로다** — 같은 rows 를 그리고 같은 run() 을 부른다.
 * 모양만 다르다. 그래서 다른 SearchSelect(견적 사명·수신인·품목, 문구함…)도 함께 나아진다.
 */
const SHEET_MAX_W = 768

/** 지금 폰 폭인가. 창 크기가 바뀌면 따라 바뀐다(개발자 도구로 줄여도 동작한다). */
function useNarrow(enabled: boolean): boolean {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(`(max-width: ${SHEET_MAX_W}px)`)
    const sync = () => setNarrow(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [enabled])
  return narrow
}

/**
 * 후보 말고 더 두는 줄 — 「직판」(위)·「새 회사로 등록」(아래)처럼.
 * 키보드로도 닿는다(후보와 한 줄 목록으로 묶인다).
 */
export type SearchSelectExtra = {
  key: string
  /** 'top' 이면 후보 위, 'bottom' 이면 아래. 적지 않으면 아래. */
  where?: 'top' | 'bottom'
  node: ReactNode
  onSelect: () => void
}

type Props<T> = {
  /** 이미 걸러진 후보. 거르기는 부르는 쪽이 한다. */
  items: T[]
  /** 줄마다 다른 열쇠(React key). */
  itemKey: (item: T) => string | number
  /** 한 줄의 생김새. */
  renderItem: (item: T) => ReactNode
  onSelect: (item: T) => void

  query: string
  onQueryChange: (q: string) => void

  placeholder?: string
  disabled?: boolean
  autoFocus?: boolean
  inputId?: string
  tabIndex?: number
  className?: string
  /** 입력칸 스타일. 적지 않으면 공용 입력 모양. */
  inputStyle?: CSSProperties
  /** 칸에 붙는 title — 말줄임으로 잘린 값을 호버로 끝까지 읽는 자리. */
  title?: string
  /** 입력칸을 감싸는 상자의 스타일(폭 맞추기 등). */
  wrapStyle?: CSSProperties
  /** 목록 최대 높이. 기본 240. */
  maxHeight?: number
  extras?: SearchSelectExtra[]
  /** 후보도 extras 도 없을 때 띄우는 한 마디. 적지 않으면 목록을 열지 않는다. */
  emptyText?: string
  /** 비어 있어도 열려면 참(검색 전에도 목록을 보여 주는 자리). */
  openWhenEmpty?: boolean
  /** 포커스가 들어오면 연다. 기본 참. */
  openOnFocus?: boolean
  /** 목록 아래에 붙는 고정 안내(고를 수 없는 줄 — 키보드가 닿지 않는다). */
  note?: ReactNode
  /**
   * 좁은 화면(≤768)에서 목록을 **화면 아래 시트**로 띄운다. 기본은 켜짐 —
   * 칸 폭에 갇힌 목록은 폰에서 늘 읽기 어렵다. 끄면 전처럼 칸에 붙는다.
   */
  mobileSheet?: boolean
}

const DEFAULT_INPUT: CSSProperties = {
  width: '100%', padding: '9px 10px', border: `1px solid ${BORDER}`, borderRadius: R.control,
  fontSize: 13, color: TEXT, background: CARD_BG, outline: 'none',
  boxSizing: 'border-box', fontFamily: 'inherit',
}

/** 한 줄 — 후보든 extras 든 키보드에는 똑같이 보인다. */
type Row = { key: string; node: ReactNode; run: () => void }

export default function SearchSelect<T>({
  items, itemKey, renderItem, onSelect,
  query, onQueryChange,
  placeholder, disabled, autoFocus, inputId, tabIndex, className, inputStyle, wrapStyle, title,
  maxHeight = 240, extras, emptyText, openWhenEmpty, openOnFocus = true, note,
  mobileSheet = true,
}: Props<T>) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const autoId = useId()
  const listId = `${inputId ?? autoId}-list`

  const top = (extras ?? []).filter(e => e.where === 'top')
  const bottom = (extras ?? []).filter(e => e.where !== 'top')
  const toRow = (e: SearchSelectExtra): Row => ({ key: `x:${e.key}`, node: e.node, run: () => { e.onSelect(); setOpen(false) } })
  const rows: Row[] = [
    ...top.map(toRow),
    ...items.map((it, i) => ({
      key: `i:${itemKey(it)}:${i}`,
      node: renderItem(it),
      run: () => { onSelect(it); setOpen(false) },
    })),
    ...bottom.map(toRow),
  ]

  const hasQuery = query.trim() !== ''
  // 고를 것이 하나도 없으면 「없습니다」 한 줄만 띄운다(검색어가 있을 때). 그마저 없으면 열지 않는다.
  const showEmpty = rows.length === 0 && !!emptyText && (hasQuery || !!openWhenEmpty)
  const isOpen = open && !disabled && (rows.length > 0 || showEmpty)
  const narrow = useNarrow(mobileSheet)
  const asSheet = mobileSheet && narrow && isOpen

  /**
   * 키보드 훅에 넘기는 목록은 **그대로인 동안 같은 배열**이어야 한다.
   * 훅은 「목록이 바뀌었는가」를 배열의 **같음(identity)** 으로 보고 고른 자리를 되돌리는데,
   * 렌더마다 새 배열을 만들어 넘기면 그 되돌림이 또 렌더를 부른다 — 무한 되돌이다.
   * 그래서 줄의 **열쇠만** 이어 붙인 글자를 기준으로 삼고, 글자가 같으면 같은 배열을 쓴다.
   * 고르는 동작은 이번 렌더의 rows 에서 열쇠로 찾는다(배열은 묵혀도 동작은 최신이다).
   */
  const SEP = '\u0001'
  const sig = rows.map(r => r.key).join(SEP)
  const navKeys = useMemo(() => (sig === '' ? [] : sig.split(SEP)), [sig])

  const keys = useListKeyboard<string>(
    navKeys,
    isOpen && navKeys.length > 0,
    listRef,
    k => rows.find(r => r.key === k)?.run(),
  )

  /**
   * Esc — **열린 후보 목록만** 닫는다. 모달 위에서 눌러도 모달은 그대로다.
   *
   * 입력칸의 onKeyDown 에서 stopPropagation 으로는 막히지 않는다. 이 앱의 React 뿌리는
   * document 이고 모달의 Esc 듣는 귀도 document 에 있다 — **같은 마디**에 걸린 두 귀는
   * stopPropagation 으로 서로를 막지 못한다. 그래서 이 저장소가 이미 쓰는 **쌓임**을 쓴다
   * (components/common/overlayStack.ts) — 열려 있는 동안 맨 위에 올라가 Esc 를 받는다.
   */
  useOverlayEsc(true, () => setOpen(false), isOpen)

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // IME 조합 중에는 아무것도 가로채지 않는다 — Enter 는 조합 확정, Esc 는 조합 취소다.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'Escape') return                    // 위의 쌓임이 받는다
    if (e.key === 'Tab') { setOpen(false); return }   // 다음 칸으로 가는 기본 동작은 그대로 둔다
    keys.onKeyDown(e)
  }

  /**
   * 목록의 **속**. 칸에 붙든 시트로 뜨든 **같은 조각**을 쓴다 — 두 벌을 두면
   * 한쪽만 고치는 날이 온다. 고르는 동작(run)도 같은 것이다.
   */
  const listBody = showEmpty ? (
    <div style={{ padding: '8px 11px', fontSize: 12, color: MUTED }}>{emptyText}</div>
  ) : (
    <div ref={listRef} id={listId} role="listbox">
      {rows.map((r, i) => (
        <div key={r.key}
          role="option"
          // 호버·키보드·고른 자리가 **같은 링**이다(2026-11-26 묶음2 D).
          // 여기는 전부터 마우스와 키보드가 같은 표시(active)를 썼다 — 그 표시의
          // 생김새만 공용 링으로 바뀐 것이다(중립 바탕은 그대로 둔다).
          className={PICK_CLASS}
          aria-selected={i === keys.active}
          // mousedown 으로 고른다 — click 까지 기다리면 입력칸이 먼저 포커스를 잃어 목록이 닫힌다.
          onMouseDown={e => { e.preventDefault(); r.run() }}
          // hover 는 색을 칠하지 않고 **고른 자리만 옮긴다** — 키보드와 같은 표시를 쓴다.
          onMouseEnter={() => keys.setActive(i)}
          style={{
            padding: asSheet ? '13px 16px' : '8px 11px',
            cursor: 'pointer', fontSize: 13, color: TEXT,
            background: i === keys.active ? NEUTRAL_BG : 'transparent',
            ...(asSheet ? { borderBottom: `1px solid ${BORDER}` } : null),
          }}>
          {r.node}
        </div>
      ))}
    </div>
  )
  const noteBody = note == null ? null : (
    <div style={{ padding: '7px 11px', fontSize: 11, color: MUTED, borderTop: `1px solid ${BORDER}` }}>
      {note}
    </div>
  )

  return (
    <div ref={anchorRef} style={wrapStyle}>
      <input
        id={inputId}
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
        aria-autocomplete="list"
        value={query}
        disabled={disabled}
        autoFocus={autoFocus}
        tabIndex={tabIndex}
        className={className}
        onChange={e => { onQueryChange(e.target.value); setOpen(true) }}
        onFocus={() => { if (openOnFocus) setOpen(true) }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        title={title}
        style={{ ...DEFAULT_INPUT, ...inputStyle }}
      />
      {asSheet ? (
        <Sheet
          onClose={() => setOpen(false)}
          sheetRef={sheetRef}
          query={query}
          onQueryChange={onQueryChange}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          note={noteBody}
        >
          {listBody}
        </Sheet>
      ) : (
        <Popover
          anchorRef={anchorRef}
          open={isOpen}
          onClose={() => setOpen(false)}
          matchAnchorWidth
          maxHeight={maxHeight}
          style={{
            background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: R.icon,
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
          }}
        >
          {listBody}
          {noteBody}
        </Popover>
      )}
    </div>
  )
}

/**
 * 아래에서 올라오는 **시트** — 좌우 꽉 차고, 높이 최대 70dvh, 속에서 구른다.
 * 바깥(어둑한 바탕)을 누르면 닫히고, Esc 는 부르는 쪽의 쌓임이 이미 받는다.
 * 바닥에는 safe-area 만큼 여백을 둔다 — 홈 인디케이터에 마지막 줄이 가리지 않게.
 */
function Sheet({
  onClose, sheetRef, query, onQueryChange, onKeyDown, placeholder, label, note, children,
}: {
  onClose: () => void
  sheetRef: { current: HTMLDivElement | null }
  query: string
  onQueryChange: (q: string) => void
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void
  placeholder?: string
  label?: string
  note: ReactNode
  children: ReactNode
}) {
  if (typeof document === 'undefined') return null
  return createPortal(
    <>
      <div
        aria-hidden
        onMouseDown={onClose}
        onTouchStart={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: Z.popover, background: 'rgba(17, 24, 39, 0.35)' }}
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-label={label ?? placeholder ?? '고르기'}
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: Z.popover + 1,
          display: 'flex', flexDirection: 'column',
          maxHeight: '70dvh',
          background: CARD_BG,
          borderTopLeftRadius: R.modal, borderTopRightRadius: R.modal,
          borderTop: `1px solid ${BORDER}`,
          boxShadow: '0 -8px 30px rgba(0,0,0,0.18)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        <div style={{ padding: '10px 14px 8px', borderBottom: `1px solid ${BORDER}`, flex: '0 0 auto' }}>
          {/* 손잡이 — 아래에서 올라온 판이라는 것을 알린다. */}
          <div aria-hidden style={{ width: 36, height: 4, borderRadius: R.pill, background: BORDER, margin: '0 auto 10px' }} />
          <input
            autoFocus
            value={query}
            onChange={e => onQueryChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            // 16px 아래로 내리지 않는다 — iOS 가 칸을 확대하며 화면을 밀어 버린다.
            style={{
              width: '100%', padding: '10px 12px', border: `1px solid ${BORDER}`, borderRadius: R.control,
              fontSize: 16, color: TEXT, background: CARD_BG, outline: 'none',
              boxSizing: 'border-box', fontFamily: 'inherit',
            }}
          />
        </div>
        <div style={{ overflowY: 'auto', flex: '1 1 auto', WebkitOverflowScrolling: 'touch' }}>
          {children}
        </div>
        {note}
      </div>
    </>,
    document.body,
  )
}

/**
 * 회사 한 줄의 생김새 — **영문명을 회색으로 나란히** 둔다(2026-11-23).
 * 영문명으로 찾아 놓고 결과에 한글 이름만 뜨면 맞게 찾았는지 알 수 없다.
 */
export function CompanyOption({ name, nameEn, sub }: { name: string; nameEn?: string | null; sub?: ReactNode }) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
        <span style={{ color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
        {nameEn ? (
          <span style={{ fontSize: 11, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {nameEn}
          </span>
        ) : null}
      </div>
      {sub != null && (
        <div style={{ fontSize: 11, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {sub}
        </div>
      )}
    </>
  )
}
