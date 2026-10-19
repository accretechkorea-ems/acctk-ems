'use client'

// 최근 등록 이력 — price_list_imports 최근 20건.
// 읽기 권한은 DB(RLS)가 본다(superadmin 만 select). 되돌리기 기능은 없다 — 기록만 남긴다.

import { kstYmd } from '@/lib/date'
import { BORDER, FAINT, MUTED, SUB, TEXT } from '@/components/common/ui'
import type { ImportHistoryRow } from './priceListImport'

export type PriceListHistoryProps = {
  rows: ImportHistoryRow[]
  loading: boolean
}

const num = (n: number) => n.toLocaleString('ko-KR')

/** 'YYYY-MM-DD HH:MM' — 한국 시간. 이력은 날짜만으로는 하루 두 번 올린 것을 구별할 수 없다. */
function stamp(at: string): string {
  const d = new Date(at)
  if (isNaN(d.getTime())) return at
  const hm = d.toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false, hour: '2-digit', minute: '2-digit' })
  return `${kstYmd(d)} ${hm}`
}

export default function PriceListHistory({ rows, loading }: PriceListHistoryProps) {
  if (loading) return <div style={{ fontSize: 12, color: MUTED }}>이력을 불러오는 중…</div>
  if (rows.length === 0) return <div style={{ fontSize: 12, color: FAINT }}>등록 이력이 없습니다.</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {rows.map((r, i) => (
        <div
          key={r.import_id}
          style={{
            display: 'flex', gap: 12, alignItems: 'flex-start', padding: '9px 2px',
            borderTop: i === 0 ? 'none' : `1px solid ${BORDER}`,
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>
              {r.sheet_name}
              <span style={{ color: FAINT, fontWeight: 500 }}>{' · '}</span>
              <span style={{ fontSize: 12, fontWeight: 500, color: SUB, wordBreak: 'break-all' }}>{r.file_name}</span>
            </div>
            <div style={{ fontSize: 11, fontWeight: 500, color: MUTED, marginTop: 3 }}>
              신규 {num(r.inserted_count)} · 변경 {num(r.updated_count)} · 동일 {num(r.unchanged_count)} · 제외 {num(r.skipped_count)}
            </div>
            {r.valid_text && (
              <div style={{ fontSize: 11, fontWeight: 500, color: FAINT, marginTop: 2, lineHeight: 1.5 }}>
                {r.valid_text}
              </div>
            )}
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: SUB }}>{r.applied_name}</div>
            <div style={{ fontSize: 11, fontWeight: 500, color: MUTED, marginTop: 3 }}>{stamp(r.applied_at)}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
