'use client'

// 파이프라인 칸반 카드.
// 파이프라인에서 가장 먼저 읽혀야 하는 것은 "어느 회사" 라서 업체명을 제목 자리에 둔다.
// 단계 select 와 종료 버튼은 평소 감춰두고 호버 때만 띄운다(자리는 유지 → 카드 높이 고정).
// hover 를 지원하지 않는 기기에서는 CSS 로 항상 보이게 한다(.pl-card-action, 페이지 전역 스타일).

import { STAGES, compactKRW, dateToMonth } from '@/components/customer/opportunity'
import type { SalesOpportunity } from '@/components/customer/types'

const STALE_DAYS = 30

type Props = {
  opp: SalesOpportunity
  lastActivity: string | null   // 'YYYY-MM-DD' — 활동이 없으면 null
  canEdit: boolean
  onOpen: () => void
  onChangeStage: (next: string) => void
  onPickLost: () => void
  onClose?: () => void      // 수주 단계에서만 — 매출 없이 끝난 건을 직접 종료
}

// 마지막 활동(없으면 등록일)로부터 며칠 지났는지
function staleDays(lastActivity: string | null, createdAt: string): number {
  const base = lastActivity ?? createdAt.slice(0, 10)
  const diff = Date.parse(`${base}T00:00:00`)
  if (Number.isNaN(diff)) return 0
  return Math.floor((Date.now() - diff) / 86400000)
}

export default function OpportunityCard({ opp, lastActivity, canEdit, onOpen, onChangeStage, onPickLost, onClose }: Props) {
  const days = staleDays(lastActivity, opp.created_at)
  const stale = days >= STALE_DAYS
  const closeMonth = dateToMonth(opp.expected_close)
  const quoteCount = opp.quotes?.length ?? 0
  const owner = `${opp.engineers?.name ?? '-'} ${opp.engineers?.position ?? ''}`.trim()

  return (
    <div
      className="pl-card"
      style={{
        background: '#ffffff', border: '1px solid #ebebeb', borderRadius: 8,
        padding: '10px 12px', transition: 'border-color 0.15s ease',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = '#c7d7f8' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = '#ebebeb' }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        <button
          onClick={onOpen}
          style={{ flex: 1, minWidth: 0, textAlign: 'left', padding: 0, background: 'none', border: 'none', cursor: 'pointer' }}
        >
          {/* 업체명 — 사업장 구분이 잘리지 않도록 2줄까지 허용 */}
          <div
            title={opp.customers?.company_name ?? '-'}
            style={{
              fontSize: 15, fontWeight: 700, color: '#111827', lineHeight: '20px',
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
              overflow: 'hidden', wordBreak: 'break-all',
            }}
          >
            {opp.customers?.company_name ?? '-'}
          </div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {opp.title}
          </div>
        </button>

        {/* 단계 변경 — 실주를 고르면 사유를 받아야 하므로 모달을 연다 */}
        <select
          className="pl-card-action"
          value={opp.stage}
          disabled={!canEdit}
          // 드래그 센서가 select 조작을 끌기로 오인하지 않도록 여기서 이벤트를 끊는다
          onPointerDown={e => e.stopPropagation()}
          onChange={e => {
            const next = e.target.value
            if (next === opp.stage) return
            if (next === '실주') onPickLost()
            else onChangeStage(next)
          }}
          title={canEdit ? '단계 변경' : '담당자만 바꿀 수 있습니다'}
          style={{
            flexShrink: 0, maxWidth: 84, padding: '3px 6px', borderRadius: 6,
            border: '1px solid #ebebeb', background: canEdit ? '#fff' : '#f9fafb',
            color: canEdit ? '#6b7280' : '#9ca3af',
            fontSize: 11, fontWeight: 700, outline: 'none',
            cursor: canEdit ? 'pointer' : 'not-allowed',
          }}
        >
          {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div style={{ fontSize: 16, fontWeight: 700, color: '#234ea2', marginTop: 8 }}>
        {compactKRW(opp.expected_amount)}
      </div>

      {/* 담당자 · 마감 예정 — 한 줄 유지 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4, minWidth: 0 }}>
        <span style={{ fontSize: 11, color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {owner}
        </span>
        {closeMonth && (
          <>
            <span style={{ color: '#d1d5db' }}>·</span>
            <span style={{ fontSize: 11, color: '#9ca3af', flexShrink: 0 }}>{closeMonth} 마감 예정</span>
          </>
        )}
        {quoteCount > 0 && (
          <>
            <span style={{ color: '#d1d5db' }}>·</span>
            <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, flexShrink: 0 }}>견적 {quoteCount}건</span>
          </>
        )}
      </div>

      {/* 방치 표시 — 색이 아니라 시계 아이콘 + 흐린 글자로 */}
      {stale && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6 }} title={`마지막 활동 ${lastActivity ?? '없음'}`}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
          </svg>
          <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600 }}>{days}일째 활동 없음</span>
        </div>
      )}

      {/* 수주까지 갔지만 매출로 이어지지 않은(또는 견적을 안 붙인) 건을 직접 끝낼 수 있게 */}
      {onClose && canEdit && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
          <button
            className="pl-card-action"
            onPointerDown={e => e.stopPropagation()}
            onClick={onClose}
            title="이 기회를 종료합니다"
            style={{ padding: '3px 10px', background: '#f3f4f6', color: '#6b7280', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 700 }}
          >
            종료
          </button>
        </div>
      )}
    </div>
  )
}
