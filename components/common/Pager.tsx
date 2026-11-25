'use client'

/**
 * 목록 아래의 **쪽 나누기 줄** — 「전체 1,234건 · 51–100」 + 「‹ 1 … 4 5 6 … 20 ›」.
 *
 * 규칙은 lib/pager.ts(순수)에 있고 여기는 **그리는 법**만 둔다. 다른 목록에도 그대로
 * 붙일 수 있게 화면 이름을 담지 않는다 — 받는 것은 지금 쪽·한 쪽 줄 수·전체 건수뿐이다.
 *
 * 한 쪽뿐이면 **아무것도 그리지 않는다**. 쪽이 하나인데 「‹ 1 ›」이 서 있으면 누를 것이
 * 있는 줄 알고 누르게 된다.
 */

import { PAGE_SIZE, pageCount, pageItems, pageLabel } from '@/lib/pager'
import { R } from '@/lib/radius'
import { BORDER, CARD_BG, MUTED, SUB } from '@/components/common/ui'
import { BLUE } from '@/components/common/ui'

export type PagerProps = {
  /** 1부터 센다. */
  page: number
  total: number
  size?: number
  onChange: (page: number) => void
  /** 건수 줄만 보고 싶을 때(쪽이 하나여도 「전체 N건」은 남긴다). */
  alwaysShowCount?: boolean
}

const btn = (on: boolean, disabled = false): React.CSSProperties => ({
  minWidth: 30, height: 30, padding: '0 8px', borderRadius: R.control,
  border: `1px solid ${on ? BLUE : BORDER}`,
  background: on ? BLUE : CARD_BG,
  color: on ? CARD_BG : (disabled ? MUTED : SUB),
  fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.5 : 1,
})

export default function Pager({ page, total, size = PAGE_SIZE, onChange, alwaysShowCount = true }: PagerProps) {
  const pages = pageCount(total, size)
  if (pages <= 1 && !alwaysShowCount) return null

  return (
    <div className="ems-pager"
      style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        padding: '10px 14px', borderTop: `1px solid ${BORDER}`,
      }}>
      <span className="num" style={{ fontSize: 12, color: MUTED }}>{pageLabel(page, size, total)}</span>
      <span style={{ flex: 1 }} />
      {pages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button type="button" aria-label="이전 쪽" disabled={page <= 1}
            onClick={() => page > 1 && onChange(page - 1)} style={btn(false, page <= 1)}>‹</button>
          {pageItems(page, pages).map((it, i) => (
            it === '…'
              ? <span key={`gap-${i}`} style={{ padding: '0 2px', fontSize: 12, color: MUTED }}>…</span>
              : (
                <button key={it} type="button" aria-current={it === page ? 'page' : undefined}
                  onClick={() => it !== page && onChange(it)} style={btn(it === page)} className="num">
                  {it}
                </button>
              )
          ))}
          <button type="button" aria-label="다음 쪽" disabled={page >= pages}
            onClick={() => page < pages && onChange(page + 1)} style={btn(false, page >= pages)}>›</button>
        </div>
      )}
    </div>
  )
}
