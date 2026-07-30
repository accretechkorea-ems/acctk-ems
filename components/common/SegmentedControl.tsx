'use client'

import { useLayoutEffect, useRef, useState } from 'react'

/**
 * 슬라이딩 인디케이터 세그먼트 컨트롤 (단일 선택).
 * 활성 버튼의 offsetLeft / offsetWidth 를 측정해 흰 인디케이터를
 * transform: translateX() + width 로 이동시킨다.
 * - 활성 값이 바뀔 때 / 컨테이너 크기가 바뀔 때(ResizeObserver) 재측정
 * - 첫 마운트에서는 애니메이션 없이 즉시 위치를 잡고, 이후부터 transition 적용
 * - 매칭되는 옵션이 없으면 인디케이터를 숨긴다
 *
 * options 는 문자열 배열 또는 { label, value, suffix? } 객체 배열 둘 다 허용.
 * suffix 는 라벨 오른쪽에 11px #9ca3af 로 표시.
 */
type Option = { label: string; value: string; suffix?: string }
type Props = {
  options: Array<string | Option>
  value: string
  onChange: (v: string) => void
  /** true 면 모든 항목이 같은 폭(grid minmax(0,1fr)). 기본 false = 내용 폭(inline-flex). */
  equal?: boolean
  /** 컨트롤 총 높이(px). 지정 시 버튼이 트랙 높이를 채운다. 미지정 시 버튼 30 + 패딩 6 = 36. */
  height?: number
  /** equal 일 때 각 항목의 최소 폭(px). 지정 시 minmax(minItemWidth, 1fr). 미지정 시 minmax(0, 1fr). */
  minItemWidth?: number
  /** 각 버튼의 tabIndex. 미지정 시 기본(0). -1 이면 키보드 탭 순회에서 제외(클릭은 유지). */
  itemTabIndex?: number
}

const norm = (o: string | Option): Option => (typeof o === 'string' ? { label: o, value: o } : o)

export default function SegmentedControl({ options, value, onChange, equal = false, height, minItemWidth, itemTabIndex }: Props) {
  const opts = options.map(norm)
  const containerRef = useRef<HTMLDivElement>(null)
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [ind, setInd] = useState<{ left: number; width: number } | null>(null)
  const [animate, setAnimate] = useState(false)

  // 활성 인덱스 / 크기 변경 시 위치 측정 (매칭 없으면 숨김)
  useLayoutEffect(() => {
    const measure = () => {
      const idx = options.findIndex(o => norm(o).value === value)
      const btn = idx >= 0 ? btnRefs.current[idx] : null
      setInd(prev => {
        const next = btn ? { left: btn.offsetLeft, width: btn.offsetWidth } : null
        if (!prev && !next) return prev
        if (prev && next && prev.left === next.left && prev.width === next.width) return prev
        return next
      })
    }
    measure()

    const ro = new ResizeObserver(measure)
    if (containerRef.current) ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [value, options])

  // 첫 위치를 잡은 뒤부터 애니메이션 켜기 (초기 렌더는 즉시 배치)
  useLayoutEffect(() => {
    if (ind && !animate) {
      const id = requestAnimationFrame(() => setAnimate(true))
      return () => cancelAnimationFrame(id)
    }
  }, [ind, animate])

  const containerStyle: React.CSSProperties = {
    position: 'relative', background: '#f5f5f5', borderRadius: 8, padding: 3, gap: 0,
    ...(equal
      ? { display: 'grid', gridTemplateColumns: `repeat(${opts.length}, minmax(${minItemWidth != null ? `${minItemWidth}px` : 0}, 1fr))` }
      : { display: 'inline-flex' }),
    ...(height != null ? { height } : {}),
  }

  return (
    <div ref={containerRef} style={containerStyle}>
      {ind && (
        <div style={{
          position: 'absolute', top: 3, bottom: 3, left: 0, width: ind.width,
          transform: `translateX(${ind.left}px)`,
          background: '#ffffff', borderRadius: 6, boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
          pointerEvents: 'none',
          transition: animate
            ? 'transform 200ms cubic-bezier(0.4, 0, 0.2, 1), width 200ms cubic-bezier(0.4, 0, 0.2, 1)'
            : 'none',
        }} />
      )}
      {opts.map((o, i) => {
        const active = o.value === value
        return (
          <button key={o.value} ref={el => { btnRefs.current[i] = el }} onClick={() => onChange(o.value)} tabIndex={itemTabIndex}
            style={{
              position: 'relative', zIndex: 1, height: height != null ? '100%' : 30,
              padding: equal ? 0 : '0 12px', textAlign: 'center', borderRadius: 6,
              fontSize: 13, background: 'transparent', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
              color: active ? '#111827' : '#6b7280', fontWeight: active ? 600 : 400,
              transition: 'color 200ms',
            }}>
            {o.label}
            {o.suffix != null && <span style={{ marginLeft: 4, fontSize: 11, color: '#9ca3af' }}>{o.suffix}</span>}
          </button>
        )
      })}
    </div>
  )
}
