'use client'

// 시트 표 — 미리보기와 등록 결과를 **한 표**로 보여 준다.
//
// 왜 한 표인가 — 올리기 전에 본 줄과 올린 뒤의 결과가 같은 자리에 있어야, 어느 시트가
// 어떻게 됐는지 눈으로 잇는다. 표를 두 개 두면 시트 이름을 사람이 맞춰 봐야 한다.
//
// 경고(구입가 없는 줄·품명 없음·구분 붙임)는 시트 줄 아래에 **접어서** 둔다 —
// 아홉 시트의 경고를 한꺼번에 펼쳐 두면 정작 숫자가 안 보인다.

import { useState } from 'react'
import { BORDER, DANGER, FAINT, MUTED, NEUTRAL_BG, SUB, TEXT } from '@/components/common/ui'
import type { SheetPlan } from './priceListImport'
import type { SheetOutcome } from './usePriceListImport'

export type PriceListSheetTableProps = {
  sheets: SheetPlan[]
  outcomes: SheetOutcome[]
}

const num = (n: number) => n.toLocaleString('ko-KR')
const GRID = 'minmax(120px, 1.6fr) 56px 64px 52px 52px minmax(140px, 1.4fr)'
const cell: React.CSSProperties = { fontSize: 12, color: TEXT, textAlign: 'right' }
const head: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: MUTED, textAlign: 'right' }

export default function PriceListSheetTable({ sheets, outcomes }: PriceListSheetTableProps) {
  const [openWarn, setOpenWarn] = useState<string | null>(null)
  const byName = new Map(outcomes.map(o => [o.sheetName, o]))

  return (
    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 8, padding: '7px 12px', background: NEUTRAL_BG }}>
        <div style={{ ...head, textAlign: 'left' }}>시트</div>
        <div style={head}>품목</div>
        <div style={head}>등록 대상</div>
        <div style={head}>제외</div>
        <div style={head}>묶음</div>
        <div style={{ ...head, textAlign: 'left' }}>상태</div>
      </div>

      {sheets.map((s, i) => {
        const p = s.parse
        const c = p.counts
        const out = byName.get(p.sheetName)
        const warn = p.warnings.length > 0
        const dim = !s.willImport

        // 상태 — 등록 전에는 예정/건너뜀, 등록 뒤에는 그 시트의 결과.
        let status: React.ReactNode = s.willImport
          ? <span style={{ color: '#234ea2', fontWeight: 600 }}>등록 예정</span>
          : <span style={{ color: MUTED }}>{`건너뜀: ${s.skipReason}`}</span>
        if (out?.ok && out.result) {
          status = (
            <span style={{ color: TEXT }}>
              신규 <b>{num(out.result.inserted)}</b> · 변경 <b>{num(out.result.updated)}</b> · 동일 {num(out.result.unchanged)}
            </span>
          )
        } else if (out && !out.ok) {
          status = <span style={{ color: DANGER, fontWeight: 600 }}>{`실패: ${out.error}`}</span>
        }

        return (
          <div key={p.sheetName + i} style={{ borderTop: i === 0 ? 'none' : `1px solid ${BORDER}` }}>
            <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 8, padding: '8px 12px', alignItems: 'center' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: dim ? MUTED : TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.sheetName}
                </div>
                <div style={{ fontSize: 11, fontWeight: 500, color: FAINT, marginTop: 2 }}>
                  {p.headerRow > 0 ? `머리글 ${p.headerRow}행` : '머리글 없음'}
                  {s.bytes > 0 ? ` · ${num(Math.round(s.bytes / 1024))}KB` : ''}
                </div>
              </div>
              <div style={{ ...cell, color: dim ? MUTED : TEXT }}>{num(c.itemRows)}</div>
              <div style={{ ...cell, color: dim ? MUTED : '#234ea2', fontWeight: 600 }}>{num(c.registered)}</div>
              <div style={{ ...cell, color: c.noCost > 0 ? SUB : FAINT }}>{num(c.noCost)}</div>
              <div style={{ ...cell, color: c.sections > 0 ? SUB : FAINT }}>{num(c.sections)}</div>
              <div style={{ fontSize: 12, minWidth: 0 }}>
                {status}
                {warn && (
                  <button
                    type="button"
                    onClick={() => setOpenWarn(v => (v === p.sheetName ? null : p.sheetName))}
                    style={{ marginLeft: 6, border: 'none', background: 'none', padding: 0, cursor: 'pointer', fontSize: 11, fontWeight: 700, color: MUTED }}
                  >
                    {openWarn === p.sheetName ? '참고 접기 ▾' : `참고 ${p.warnings.length} ▸`}
                  </button>
                )}
              </div>
            </div>

            {warn && openWarn === p.sheetName && (
              <div style={{ padding: '0 12px 10px 12px' }}>
                {p.warnings.map((w, wi) => (
                  <div key={wi} style={{ display: 'flex', gap: 6, fontSize: 11, lineHeight: 1.7, color: SUB }}>
                    <span style={{ color: FAINT }}>·</span>
                    <span>{w}</span>
                  </div>
                ))}
                {p.skippedNoCost.length > 0 && (
                  <div style={{ fontSize: 11, lineHeight: 1.7, color: FAINT, marginTop: 4 }}>
                    구입가 없는 품번: {p.skippedNoCost.slice(0, 20).map(x => x.item_code).join(', ')}
                    {p.skippedNoCost.length > 20 ? ' …' : ''}
                  </div>
                )}
                {p.validText && (
                  <div style={{ fontSize: 11, lineHeight: 1.7, color: FAINT, marginTop: 4 }}>{p.validText}</div>
                )}
                {!p.validText && p.topDate && (
                  <div style={{ fontSize: 11, lineHeight: 1.7, color: FAINT, marginTop: 4 }}>
                    {`파일 맨 위 날짜 ${p.topDate} (등록 이력에는 남지 않습니다)`}
                  </div>
                )}
              </div>
            )}

            {/* 머리글을 못 찾은 시트는 그 이유를 한 줄 보여 준다 — 등록 대상이 아닌 시트일 수도, 머리글을 안 고친 시트일 수도 있다. */}
            {p.headerRow === 0 && p.errors.length > 0 && (
              <div style={{ padding: '0 12px 10px 12px', fontSize: 11, lineHeight: 1.7, color: MUTED }}>
                {p.errors[0]}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
