'use client'

// 「엑셀 머리글 규칙」 안내 — 기본은 접혀 있고 한 줄 요약만 보인다.
// 규칙이 종류와 무관해져서(파서에 시트별 분기가 없다) 안내도 한 벌이다.
//
// 글자는 **전부 lib/priceListParse.ts 의 headerGuide() 가 만든다.** 여기서 문구를 적지 않는다 —
// 머리글 후보(lib/priceListKinds.ts)를 고치면 이 안내도 같이 바뀌어야 한다. 따로 적어 두면
// 안내가 옛 이름을 가리키고, 그 안내를 보고 엑셀을 고친 사람이 등록에 실패한다.

import { useState } from 'react'
import { BORDER, FAINT, MUTED, NEUTRAL_BG, SUB, TEXT } from '@/components/common/ui'
import { headerGuide } from '@/lib/priceListParse'
import type { HeaderGuideItem } from '@/lib/priceListParse'

export type PriceListHeaderGuideProps = {
  /** 열을 못 찾았을 때는 펼친 채로 보여 준다(그때 가장 필요한 안내다). */
  defaultOpen?: boolean
}

const row = (it: HeaderGuideItem) => (
  <div key={it.label} style={{ display: 'flex', gap: 8, padding: '3px 0', fontSize: 11, lineHeight: 1.7 }}>
    <span style={{ width: 92, flexShrink: 0, fontWeight: it.required ? 700 : 500, color: it.required ? TEXT : SUB }}>
      {it.label}{it.required ? ' (필수)' : ''}
    </span>
    <span style={{ color: MUTED, wordBreak: 'break-word' }}>{it.column}</span>
  </div>
)

export default function PriceListHeaderGuide({ defaultOpen = false }: PriceListHeaderGuideProps) {
  const [open, setOpen] = useState(defaultOpen)
  const g = headerGuide()

  return (
    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, background: NEUTRAL_BG, padding: '8px 12px' }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, color: TEXT }}>엑셀 머리글 규칙</span>
        <span style={{ fontSize: 11, fontWeight: 500, color: SUB, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {g.summary}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: MUTED, flexShrink: 0 }}>{open ? '접기 ▾' : '펼치기 ▸'}</span>
      </button>

      {open && (
        <div style={{ marginTop: 10, borderTop: `1px solid ${BORDER}`, paddingTop: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: TEXT, marginBottom: 2 }}>
            머리글 일곱 개 · 들어가는 칸
          </div>
          {g.items.map(it => row(it))}

          <div style={{ fontSize: 11, fontWeight: 700, color: TEXT, margin: '10px 0 2px' }}>규칙</div>
          {g.notes.map((n, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, fontSize: 11, lineHeight: 1.8, color: SUB }}>
              <span style={{ color: FAINT }}>·</span>
              <span>{n}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
