'use client'

// 끝난 포캐스트 **표** (2026-11-28, 야간4 4-3).
//
// 판 아래에 접혀 있던 「끝난 건」 카드 격자를 대신한다. 카드는 **옮기려고** 만든 모양이라
// 끝난 건에는 쓸 데가 없었고(끌 수도 없고 단계 select 도 안 열린다), 「실주 사유가
// 무엇이었나」·「어디까지 갔다가 깨졌나」를 적을 자리가 없었다. 표는 그 둘을 한 줄에 쓴다.
//
// 담당자·검색 필터는 **표에도 그대로** 걸린다 — 부르는 쪽이 이미 걸러 넘긴다.

import { customerCompanyName, type CustomerNameRowWithParent } from '@/lib/customerLabel'
import { shortSiteName } from '@/lib/customerList'
import { krwFull, krwShort } from '@/lib/forecastBoard'
import { summarizeStageHistory, type StageHistoryRow } from '@/lib/opportunityStageHistory'
import { PICK_CLASS } from '@/lib/focusRing'
import { R } from '@/lib/radius'
import type { SalesOpportunity } from '@/components/customer/types'

const TEXT = '#111827'
const SUB = '#4b5563'
const MUTED = '#6b7280'
const DIM = '#9ca3af'
const BORDER = '#ebebeb'
const BLUE = '#234ea2'
const LOST = '#ef4444'

/** 표 머리 한 칸. */
const th = (align: 'left' | 'right' | 'center' = 'left') => ({
  padding: '8px 10px', textAlign: align, fontSize: 11, fontWeight: 700,
  color: DIM, whiteSpace: 'nowrap' as const, background: '#f8fafc',
})
/** 표 한 칸 — 줄 높이는 42px 로 고정한다(내 견적 표와 같은 값이다). */
const td = (align: 'left' | 'right' | 'center' = 'left') => ({
  padding: '3px 10px', textAlign: align, verticalAlign: 'middle' as const,
  fontSize: 13, color: TEXT,
})

export type ClosedTableProps = {
  rows: readonly SalesOpportunity[]
  /** 건 id → 단계 이력(시간 순). 표가 아직 없으면 빈 Map 이라 그 칸만 비어 보인다. */
  stageHistories: Map<number, StageHistoryRow[]>
  /** 줄의 「열기」 — 수정 모달을 연다. */
  onOpen: (o: SalesOpportunity) => void
  /** 비었을 때 적는 글자. */
  emptyText: string
}

export default function ClosedTable({ rows, stageHistories, onOpen, emptyText }: ClosedTableProps) {
  if (rows.length === 0) {
    return (
      <div style={{
        background: '#fff', border: `1px solid ${BORDER}`, borderRadius: R.control,
        padding: 40, textAlign: 'center', color: MUTED, fontSize: 13,
      }}>
        {emptyText}
      </div>
    )
  }

  return (
    <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: R.control, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 940 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
              <th style={th()}>회사 » 사업장</th>
              <th style={th()}>제목</th>
              <th style={th('right')}>금액</th>
              <th style={th()}>단계 이력</th>
              <th style={th()}>종료 · 사유</th>
              <th style={th()}>담당</th>
              <th style={th('right')} />
            </tr>
          </thead>
          <tbody>
            {rows.map(o => {
              const company = customerCompanyName(o.customers as CustomerNameRowWithParent | null | undefined)
              const site = shortSiteName(
                { company_name: o.customers?.company_name ?? '', site_name: o.customers?.site_name ?? null },
                company,
              )
              const lost = o.stage === '실주'
              const summary = summarizeStageHistory(stageHistories.get(o.opportunity_id) ?? [])
              const owner = [o.engineers?.name ?? '', (o.engineers?.position ?? '').trim()].filter(Boolean).join(' ')
              // 「실주 · 가격 · ZEISS」 — 결과 · 사유 · 경쟁사. 빈 칸은 빼고 가운뎃점으로 잇는다.
              const closedLine = [
                lost ? '실주' : (o.stage === '수주' ? '수주' : '종료'),
                (o.lost_reason ?? '').trim(),
                (o.competitor ?? '').trim(),
              ].filter(Boolean).join(' · ')
              const closedOn = String(o.closed_at ?? '').slice(0, 10)
              return (
                <tr key={o.opportunity_id} className="ems-pick" style={{ height: 42, borderBottom: `1px solid ${BORDER}` }}>
                  <td style={{ ...td(), maxWidth: 220 }}>
                    <div title={`${company}${site ? ` » ${site}` : ''}`}
                      style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {company || '-'}
                      {site && <span style={{ color: MUTED, fontWeight: 500 }}>{' » '}{site}</span>}
                    </div>
                  </td>
                  <td style={{ ...td(), maxWidth: 200 }}>
                    <div title={o.title ?? ''} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {(o.title ?? '').trim() || '(제목 없음)'}
                    </div>
                  </td>
                  <td className="num" title={o.expected_amount ? krwFull(o.expected_amount) : undefined}
                    style={{ ...td('right'), fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {o.expected_amount ? krwShort(o.expected_amount) : '—'}
                  </td>
                  {/* 단계 이력 요약 — 「상담 9/4 → 견적제출 9/20 → 협상 10/15 → 실주 11/24」.
                      표(opportunity_stage_history)가 아직 없으면 비어 있다. */}
                  <td style={{ ...td(), maxWidth: 300, fontSize: 12, color: SUB }}>
                    <div title={summary || '단계 이력이 아직 없습니다'}
                      style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {summary || <span style={{ color: DIM }}>—</span>}
                    </div>
                  </td>
                  <td style={{ ...td(), maxWidth: 220, fontSize: 12 }}>
                    <div title={[closedLine, (o.lost_note ?? '').trim()].filter(Boolean).join(' — ')}
                      style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      <span style={{ fontWeight: 700, color: lost ? LOST : SUB }}>{closedLine}</span>
                      {closedOn && <span className="num" style={{ color: DIM, marginLeft: 6 }}>{closedOn}</span>}
                    </div>
                  </td>
                  <td style={{ ...td(), fontSize: 12, color: SUB, whiteSpace: 'nowrap' }}>{owner || '담당 없음'}</td>
                  <td style={td('right')}>
                    <button type="button" className={PICK_CLASS} onClick={() => onOpen(o)}
                      title="포캐스트를 엽니다"
                      style={{
                        padding: '3px 9px', border: `1px solid ${BORDER}`, borderRadius: R.icon,
                        background: '#fff', color: BLUE, fontSize: 11, fontWeight: 700,
                        cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                      }}>
                      열기
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
