'use client'

// 「지금 등록된 파일」 두 줄 — 80 과 20 각각 **가장 최근에 올린 파일명과 날짜**.
//
// 값은 등록 이력(price_list_imports)에서 온다. 그 표에 file_name 이 이미 있다(단계 2).
// 다만 **line 칸은 없어서** sheet_name 으로 가른다(isTwentySheet) — 그래서 처음 보는
// 시트 이름은 80 으로 셈한다. 등록된 적이 없으면 「등록 없음」이다.

import { BORDER, FAINT, MUTED, SUB, TEXT } from '@/components/common/ui'
import type { LatestFile } from './priceListImport'

export type PriceListLatestProps = {
  latest: Record<'80' | '20', LatestFile | null>
  loading: boolean
}

const LINES: readonly { line: '80' | '20'; label: string }[] = [
  { line: '80', label: '80 Price List' },
  { line: '20', label: '20 Price List' },
]

export default function PriceListLatest({ latest, loading }: PriceListLatestProps) {
  return (
    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: '8px 12px' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 4 }}>지금 등록된 파일</div>
      {LINES.map(({ line, label }) => {
        const l = latest[line]
        return (
          <div
            key={line}
            style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '3px 0', minWidth: 0 }}
          >
            <span style={{ width: 92, flexShrink: 0, fontSize: 12, fontWeight: 700, color: TEXT }}>{label}</span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 500, color: l ? SUB : FAINT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {loading ? '불러오는 중…' : (l ? l.fileName : '등록 없음')}
            </span>
            <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 500, color: MUTED }}>
              {l ? l.appliedDate : ''}
            </span>
          </div>
        )
      })}
    </div>
  )
}
