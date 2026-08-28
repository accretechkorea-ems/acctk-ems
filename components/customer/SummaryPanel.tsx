'use client'

// 업체 상세 우측 요약. 이번 단계에서는 표시 전용이며 클릭 동작이 없다.
// (영업기회 카드는 다음 단계에서 이 아래에 붙는다)

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { countQuoteChannels } from './utils'
import { STAGES, compactKRW, isClosed, stageRank } from './opportunity'
import { deviceLabel, elapsedLabel } from './holding'
import type { Holding, Quote, SalesOpportunity, ServiceHistory } from './types'

type Props = {
  quotes: Quote[]
  deviceCount: number
  history: ServiceHistory[]
  customerId: number
  opportunities: SalesOpportunity[]
  onAddOpportunity: () => void
  onOpenOpportunity: (o: SalesOpportunity) => void
  onChangeStage: (o: SalesOpportunity, next: string) => void
  canEditOpportunity: (o: SalesOpportunity) => boolean
  holdings: Holding[]
  onOpenHolding: (h: Holding) => void
  onQuoteHistoryOpen: () => void
}

// onClick 이 있으면 눌러지는 줄이 된다 — 호버 배경과 오른쪽 셰브론으로 그 사실을 알린다.
// (없으면 예전과 똑같은 표시 전용 줄)
function Row({ label, value, muted, onClick }: { label: string; value: string; muted?: boolean; onClick?: () => void }) {
  const inner = (
    <>
      <span style={{ fontSize: 12, color: '#6b7280', flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: muted ? '#9ca3af' : '#111827', textAlign: 'right', wordBreak: 'break-all' }}>
        {value}
      </span>
      {onClick && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginRight: -2 }}>
          <polyline points="9 18 15 12 9 6" />
        </svg>
      )}
    </>
  )
  const base: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 8 }
  if (!onClick) return <div style={{ ...base, alignItems: 'baseline' }}>{inner}</div>
  return (
    <button
      onClick={onClick}
      onMouseEnter={e => { e.currentTarget.style.background = '#fafafa' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
      style={{
        ...base, alignItems: 'center',
        // 줄 간격(gap 9)이 흐트러지지 않도록 안쪽 여백만큼 음수 마진으로 되돌린다
        width: 'calc(100% + 16px)', margin: '-3px -8px', padding: '3px 8px',
        background: 'transparent', border: 'none', borderRadius: 6,
        cursor: 'pointer', font: 'inherit', textAlign: 'left', transition: 'background 0.15s ease',
      }}
    >
      {inner}
    </button>
  )
}

// 좁은 열(280px)이라 한 줄에 단계·제목·금액을 넣고 제목만 줄인다.
// 파이프라인 카드처럼 select 를 두면 폭이 모자라 제목이 거의 안 보이므로,
// 단계 pill 자체를 눌러 작은 메뉴를 띄우는 방식으로 한다(줄 너비를 더 쓰지 않는다).
// 메뉴는 sticky + overflow-y 인 좌우 열에서 잘리지 않도록 fixed 로 띄운다.
function OppRow({ o, canEdit, onOpen, onChangeStage, onPickLost }: {
  o: SalesOpportunity
  canEdit: boolean
  onOpen: () => void
  onChangeStage: (next: string) => void
  onPickLost: () => void
}) {
  const [menu, setMenu] = useState<{ left: number; top: number } | null>(null)
  const pillRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    document.addEventListener('mousedown', close)
    window.addEventListener('scroll', close, true)
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('scroll', close, true) }
  }, [menu])

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 6, width: '100%',
        padding: '6px 8px', borderRadius: 6, transition: 'background 0.15s ease',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = '#f8fafc' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      <button
        ref={pillRef}
        disabled={!canEdit}
        title={canEdit ? '단계 변경' : '담당자만 바꿀 수 있습니다'}
        onMouseDown={e => e.stopPropagation()}
        onClick={() => {
          if (!canEdit) return
          const r = pillRef.current?.getBoundingClientRect()
          setMenu(m => (m ? null : r ? { left: r.left, top: r.bottom + 4 } : null))
        }}
        style={{
          fontSize: 11, fontWeight: 700, color: '#6b7280', background: '#f3f4f6',
          borderRadius: 99, padding: '2px 7px', border: 'none', flexShrink: 0,
          whiteSpace: 'nowrap', cursor: canEdit ? 'pointer' : 'default',
        }}
      >
        {o.stage}
      </button>

      <button
        onClick={onOpen}
        style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, textAlign: 'left', padding: 0, background: 'none', border: 'none', cursor: 'pointer' }}
      >
        <span style={{ fontSize: 12, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }}>
          {o.title}
        </span>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', flexShrink: 0, whiteSpace: 'nowrap' }}>
          {compactKRW(o.expected_amount)}
        </span>
      </button>

      {menu && (
        <div
          onMouseDown={e => e.stopPropagation()}
          style={{
            position: 'fixed', left: menu.left, top: menu.top, zIndex: 9999,
            background: '#fff', border: '1px solid #ebebeb', borderRadius: 6,
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)', padding: 4, minWidth: 104,
          }}
        >
          {STAGES.map(s => (
            <button
              key={s}
              onClick={() => {
                setMenu(null)
                // 실주는 사유가 필요해 바로 바꾸지 않고 모달로 넘긴다
                if (s === '실주') onPickLost()
                else onChangeStage(s)
              }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px',
                border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                fontWeight: s === o.stage ? 700 : 500,
                background: s === o.stage ? '#f3f4f6' : 'transparent',
                color: s === o.stage ? '#111827' : '#6b7280',
              }}
              onMouseEnter={e => { if (s !== o.stage) e.currentTarget.style.background = '#f8fafc' }}
              onMouseLeave={e => { if (s !== o.stage) e.currentTarget.style.background = 'transparent' }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// 홀딩 한 줄 — 장비명 · 제목 · 경과일수. 280px 이라 제목만 줄인다.
function HoldingRow({ h, onClick }: { h: Holding; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left',
        padding: '6px 8px', background: 'none', border: '1px solid transparent', borderRadius: 6,
        cursor: 'pointer', transition: 'background 0.15s ease',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = '#f8fafc' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
    >
      <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', background: '#f3f4f6', borderRadius: 99, padding: '2px 7px', flexShrink: 0, maxWidth: 78, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {deviceLabel(h)}
      </span>
      <span style={{ fontSize: 12, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }}>
        {h.title}
      </span>
      <span style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', flexShrink: 0, whiteSpace: 'nowrap' }}>
        {elapsedLabel(h)}
      </span>
    </button>
  )
}

export default function SummaryPanel({
  quotes, deviceCount, history, customerId, opportunities,
  onAddOpportunity, onOpenOpportunity, onChangeStage, canEditOpportunity,
  holdings, onOpenHolding, onQuoteHistoryOpen,
}: Props) {
  const ch = countQuoteChannels(quotes, customerId)
  const [showClosed, setShowClosed] = useState(false)
  const [showResolved, setShowResolved] = useState(false)

  const { openHoldings, resolvedHoldings } = useMemo(() => ({
    openHoldings: holdings.filter(h => !h.resolved_at),
    resolvedHoldings: holdings.filter(h => h.resolved_at),
  }), [holdings])

  const { open, closed } = useMemo(() => {
    const open = opportunities.filter(o => !isClosed(o))
    const closed = opportunities.filter(o => isClosed(o))
    // 진행 중인 것은 단계가 앞선 것(협상 → 상담)을 위에 둔다
    open.sort((a, b) => stageRank(b.stage) - stageRank(a.stage))
    closed.sort((a, b) => stageRank(a.stage) - stageRank(b.stage))
    return { open, closed }
  }, [opportunities])

  // 날짜가 없는 기록이 많아 max 를 구하기 전에 걸러낸다. 값은 'YYYY-MM-DD' 라 문자열 비교로 충분.
  const lastVisit = useMemo(() => {
    let latest: string | null = null
    for (const h of history) {
      if (!h.visit_date) continue
      if (latest === null || h.visit_date > latest) latest = h.visit_date
    }
    return latest
  }, [history])

  return (
    <div style={{ background: '#ffffff', border: '1px solid #ebebeb', borderRadius: 8, padding: '14px 16px' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 12 }}>요약</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {/* 견적이 있을 때만 눌러진다 — 0건이면 셰브론도 없는 표시 전용 줄 */}
        <Row
          label="견적"
          value={quotes.length > 0 ? `${quotes.length}건` : '없음'}
          muted={quotes.length === 0}
          onClick={quotes.length > 0 ? onQuoteHistoryOpen : undefined}
        />
        {/* 대리점 경유가 섞였을 때만 내역을 덧붙인다 */}
        {ch.dealer > 0 && (
          <div style={{ fontSize: 11, color: '#9ca3af', textAlign: 'right', marginTop: -5 }}>
            직판 {ch.direct} · 대리점 {ch.dealer}
          </div>
        )}
        <Row label="장비" value={`${deviceCount}대`} muted={deviceCount === 0} />
        <Row label="최근 방문" value={lastVisit ?? '-'} muted={!lastVisit} />
      </div>

      {/* ── 영업기회 ── */}
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #ebebeb' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: '#6b7280' }}>영업기회</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: open.length > 0 ? '#111827' : '#9ca3af' }}>
            {open.length > 0 ? `${open.length}건` : '없음'}
          </span>
        </div>

        {open.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, margin: '0 -8px 8px' }}>
            {open.map(o => (
              <OppRow key={o.opportunity_id} o={o} canEdit={canEditOpportunity(o)}
                onOpen={() => onOpenOpportunity(o)}
                onChangeStage={next => onChangeStage(o, next)}
                onPickLost={() => onOpenOpportunity(o)} />
            ))}
          </div>
        )}

        {/* 종료된 기회는 건수만 보여주고 접어둔다 */}
        {closed.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <button
              onClick={() => setShowClosed(v => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: 0, background: 'none', border: 'none', cursor: 'pointer' }}
            >
              <span style={{ fontSize: 11, color: '#9ca3af' }}>종료 {closed.length}건</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#234ea2' }}>{showClosed ? '접기' : '보기'}</span>
            </button>
            {showClosed && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, margin: '6px -8px 0' }}>
                {closed.map(o => (
              <OppRow key={o.opportunity_id} o={o} canEdit={canEditOpportunity(o)}
                onOpen={() => onOpenOpportunity(o)}
                onChangeStage={next => onChangeStage(o, next)}
                onPickLost={() => onOpenOpportunity(o)} />
            ))}
              </div>
            )}
          </div>
        )}

        <button
          onClick={onAddOpportunity}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#234ea2' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#ebebeb' }}
          style={{
            width: '100%', padding: '7px 0', boxSizing: 'border-box',
            background: '#ffffff', border: '1px solid #ebebeb', borderRadius: 6,
            cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#234ea2',
            transition: 'border-color 0.15s ease',
          }}
        >
          + 영업기회
        </button>
      </div>

      {/* ── 홀딩 ── */}
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #ebebeb' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: '#6b7280' }}>홀딩</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: openHoldings.length > 0 ? '#111827' : '#9ca3af' }}>
            {openHoldings.length > 0 ? `${openHoldings.length}건` : '없음'}
          </span>
        </div>

        {openHoldings.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, margin: '0 -8px 8px' }}>
            {openHoldings.map(h => <HoldingRow key={h.holding_id} h={h} onClick={() => onOpenHolding(h)} />)}
          </div>
        )}

        {/* 해제된 것은 건수만 보여주고 접어둔다 */}
        {resolvedHoldings.length > 0 && (
          <div>
            <button
              onClick={() => setShowResolved(v => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: 0, background: 'none', border: 'none', cursor: 'pointer' }}
            >
              <span style={{ fontSize: 11, color: '#9ca3af' }}>해제됨 {resolvedHoldings.length}건</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#234ea2' }}>{showResolved ? '접기' : '보기'}</span>
            </button>
            {showResolved && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, margin: '6px -8px 0' }}>
                {resolvedHoldings.map(h => <HoldingRow key={h.holding_id} h={h} onClick={() => onOpenHolding(h)} />)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
