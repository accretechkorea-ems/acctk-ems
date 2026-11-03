'use client'

// 금액 입력 칸 — **보이는 글자에는 쉼표, 넘기는 값은 순수 숫자.**
//
// 규칙은 전부 lib/moneyInput.ts 에 있다(순수 함수 — 하네스가 그대로 돌린다).
// 이 파일이 하는 일은 셋뿐이다.
//   ① 바깥에서 받은 숫자를 글자로 그린다(치는 중에는 사람이 친 글자를 그대로 둔다 —
//      「1,200.」 처럼 아직 수가 아닌 중간 상태를 지우지 않기 위해서다).
//   ② 칠 때마다 쉼표를 다시 깔고 **커서를 제자리로** 돌린다.
//   ③ 숫자만 바깥으로 넘긴다(onChange(number | null)).
//
// type 은 number 가 아니라 **text** 다 — number 칸에는 쉼표를 넣을 수 없고(값이 비어
// 버린다), 위아래 화살표와 휠 스크롤로 금액이 조용히 바뀌는 문제도 함께 없앤다.

import { useLayoutEffect, useRef, useState, type CSSProperties, type FocusEventHandler } from 'react'
import { formatMoney, moneyEdit, parseMoney, type MoneyFormat } from '@/lib/moneyInput'

export type MoneyInputProps = {
  value: number | null | undefined
  onChange: (v: number | null) => void
  /** 소수 자리 — 달러만 2 를 준다(엔·원은 정수다). */
  decimals?: number
  placeholder?: string
  title?: string
  className?: string
  style?: CSSProperties
  onFocus?: FocusEventHandler<HTMLInputElement>
  onBlur?: FocusEventHandler<HTMLInputElement>
}

export default function MoneyInput({
  value, onChange, decimals = 0, placeholder, title, className, style, onFocus, onBlur,
}: MoneyInputProps) {
  const fmt: MoneyFormat = { decimals }
  const ref = useRef<HTMLInputElement>(null)
  const [text, setText] = useState(() => formatMoney(value, fmt))
  // 다음 그리기 뒤에 놓을 커서 자리. null 이면 건드리지 않는다(바깥에서 값이 바뀐 때).
  const caretRef = useRef<number | null>(null)

  // 바깥 값이 **바뀌었을 때만** 다시 그린다 — 그것도 그 변화가 **내가 올린 것이 아닐 때만**.
  // 치는 중에 글자를 빼앗으면 「1,200.」 처럼 아직 수가 아닌 중간 상태가 지워져 소수를
  // 칠 수가 없다. effect 가 아니라 **렌더 중에 맞춘다**(React 가 권하는 꼴이다 —
  // effect 로 하면 한 번 그린 뒤 다시 그리게 되고, 그 사이 한 프레임이 옛 글자로 보인다).
  const [prev, setPrev] = useState<{ value: number | null | undefined; mine: boolean }>(
    () => ({ value, mine: false }),
  )
  if (prev.value !== value) {
    if (!prev.mine) setText(formatMoney(value, { decimals }))
    setPrev({ value, mine: false })
  }

  // 커서는 **그려진 뒤에** 놓는다(그 전에 놓으면 브라우저가 글자를 다시 그리며 끝으로 민다).
  useLayoutEffect(() => {
    const el = ref.current
    const at = caretRef.current
    caretRef.current = null
    if (el && at !== null && document.activeElement === el) el.setSelectionRange(at, at)
  })

  return (
    <input
      ref={ref}
      type="text"
      inputMode={decimals > 0 ? 'decimal' : 'numeric'}
      className={className}
      style={style}
      placeholder={placeholder}
      title={title}
      value={text}
      onFocus={onFocus}
      onBlur={e => {
        // 떠날 때는 바깥 값으로 다시 그린다(「1,200.」 같은 중간 상태를 정리한다).
        setText(formatMoney(parseMoney(text, fmt), fmt))
        onBlur?.(e)
      }}
      onChange={e => {
        const edit = moneyEdit(e.target.value, e.target.selectionStart ?? e.target.value.length, fmt)
        caretRef.current = edit.caret
        setText(edit.text)
        // 이 값이 돌아오는 것은 **내가 올린 것**이다 — 그때는 글자를 다시 그리지 않는다(위 참고).
        setPrev({ value: edit.value, mine: true })
        onChange(edit.value)
      }}
    />
  )
}
