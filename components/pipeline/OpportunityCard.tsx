'use client'

// 파이프라인 칸반 카드 — **세 줄**이다.
//
//   1행  업체명 ───────────── 금액      파이프라인에서 먼저 읽혀야 하는 둘을 한 줄에 둔다
//   2행  제목                            (한 줄 말줄임, 회색)
//   3행  담당자 직급 · YYYY-MM 마감 예정 · 견적 N건      [단계 ▾] [견적 쓰기] [종료]
//
// 2026-10-28 에 높이를 줄였다(145 → 90px). 한 열에 열 장이 넘게 쌓이는 화면이라, 카드가
// 낮을수록 한눈에 들어오는 건수가 늘어난다. **지운 정보는 「N일째 활동 없음」 한 줄뿐이고**
// 나머지는 자리만 바꿨다. 글자 크기는 그대로다.
//
// 단계 select·견적 쓰기·종료는 평소 감춰두고 호버 때만 띄운다(.pl-card-action, 페이지 전역
// 스타일). **display 로 감춘다** — visibility 로 자리를 남기면 3행의 글자가 늘 그만큼 좁아져
// 담당자·마감이 잘렸다. 대신 그 줄에 minHeight 를 줘, 호버로 단추가 나타나도 카드가 들썩이지
// 않는다. hover 를 지원하지 않는 기기에서는 그 미디어 쿼리가 걸리지 않아 늘 보인다.

import { STAGES, compactKRW, dateToMonth } from '@/components/customer/opportunity'
import type { SalesOpportunity } from '@/components/customer/types'

type Props = {
  opp: SalesOpportunity
  canEdit: boolean
  onOpen: () => void
  onChangeStage: (next: string) => void
  onPickLost: () => void
  onClose?: () => void      // 수주 단계에서만 — 매출 없이 끝난 건을 직접 종료
  /** 이 기회로 견적서를 쓰러 간다(/quote?opportunity=). 주지 않으면 링크를 내지 않는다. */
  onWriteQuote?: () => void
}

const MUTED = '#9ca3af'
const FADE = '#d1d5db'

export default function OpportunityCard({ opp, canEdit, onOpen, onChangeStage, onPickLost, onClose, onWriteQuote }: Props) {
  const closeMonth = dateToMonth(opp.expected_close)
  const quoteCount = opp.quotes?.length ?? 0
  const owner = `${opp.engineers?.name ?? '-'} ${opp.engineers?.position ?? ''}`.trim()
  const company = opp.customers?.company_name ?? '-'
  // 3행 왼쪽 — 한 덩어리로 줄이고(말줄임) 「견적 N건」만 따로 둔다(끝까지 보여야 하는 값).
  const ownerLine = closeMonth ? `${owner} · ${closeMonth} 마감 예정` : owner

  return (
    <div
      className="pl-card"
      style={{
        background: '#ffffff', border: '1px solid #ebebeb', borderRadius: 8,
        padding: 12, transition: 'border-color 0.15s ease',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = '#c7d7f8' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = '#ebebeb' }}
    >
      {/* 1·2행 — 누르면 상세가 열린다(카드에서 가장 넓은 과녁). */}
      <button
        onClick={onOpen}
        style={{
          display: 'block', width: '100%', minWidth: 0, textAlign: 'left',
          padding: 0, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        {/* 업체명 + 금액 — 한 줄. 업체명만 줄어들고(말줄임) 금액은 끝까지 보인다.
            잘린 뒷부분(측정실·공장 등 구분 표기)은 title 로 확인한다. */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
          <span
            title={company}
            style={{
              flex: 1, minWidth: 0, fontSize: 15, fontWeight: 700, color: '#111827', lineHeight: '20px',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}
          >
            {company}
          </span>
          <span style={{ flexShrink: 0, fontSize: 16, fontWeight: 700, color: '#234ea2', lineHeight: '20px' }}>
            {compactKRW(opp.expected_amount)}
          </span>
        </div>

        <div
          title={opp.title}
          style={{
            fontSize: 12, color: '#6b7280', lineHeight: '16px', marginTop: 2,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}
        >
          {opp.title}
        </div>
      </button>

      {/* 3행 — 담당자·마감·견적 건수, 그리고 오른쪽에 호버 단추들.
          minHeight 22 는 단추(단계 select)의 높이다 — 호버 때 줄이 커지지 않게 미리 잡아 둔다. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3, minHeight: 22, minWidth: 0 }}>
        <span
          title={ownerLine}
          style={{
            flex: 1, minWidth: 0, fontSize: 11, color: MUTED,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}
        >
          {ownerLine}
        </span>
        {quoteCount > 0 && (
          <>
            <span style={{ color: FADE, flexShrink: 0 }}>·</span>
            <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, flexShrink: 0 }}>견적 {quoteCount}건</span>
          </>
        )}

        <div className="pl-card-action" style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, marginLeft: 'auto' }}>
          {onWriteQuote && (
            <button
              onPointerDown={e => e.stopPropagation()}
              onClick={onWriteQuote}
              title="이 포캐스트로 견적서를 작성합니다"
              style={{ padding: '1px 6px', background: 'none', color: '#234ea2', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 700, fontFamily: 'inherit', whiteSpace: 'nowrap' }}
            >
              견적 쓰기
            </button>
          )}

          {/* 단계 변경 — 실주를 고르면 사유를 받아야 하므로 모달을 연다 */}
          <select
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
              maxWidth: 76, padding: '2px 4px', borderRadius: 6,
              border: '1px solid #ebebeb', background: canEdit ? '#fff' : '#f9fafb',
              color: canEdit ? '#6b7280' : MUTED,
              fontSize: 11, fontWeight: 700, outline: 'none',
              cursor: canEdit ? 'pointer' : 'not-allowed',
            }}
          >
            {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          {/* 수주까지 갔지만 매출로 이어지지 않은(또는 견적을 안 붙인) 건을 직접 끝낼 수 있게. */}
          {onClose && canEdit && (
            <button
              onPointerDown={e => e.stopPropagation()}
              onClick={onClose}
              title="이 포캐스트를 종료합니다"
              style={{ padding: '1px 6px', background: '#f3f4f6', color: '#6b7280', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 700, fontFamily: 'inherit' }}
            >
              종료
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
