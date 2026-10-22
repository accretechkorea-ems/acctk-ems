'use client'

// 「내 견적」 카드와 그 **큰 모달**.
//
// 카드는 **아직 손이 가야 하는 건수**만 본다(상태별 — lib/homeCards.ts 의 quoteStatusCounts).
// 금액과 달성률은 모달 안 표의 머리에 그대로 있다. 카드에서 뺀 이유는, 홈에서 먼저 읽혀야 하는
// 것이 「얼마를 했는가」가 아니라 「무엇이 내 차례인가」이기 때문이다.
//
// 표 전체는 모달이 열릴 때 비로소 읽는다 — 홈에 들어올 때마다 견적 목록·결재 문서·승인
// 게이트까지 읽으면 첫 화면이 느려진다.
//
// 모달 안은 **지금 쓰던 MyQuotesPanel 그대로**다. 필터·탭·검색·발주서 등록·계산서 요청·결재
// 올리기·삭제 요청·엑셀 내보내기가 전부 그 부품 안에 있어, 옮기지 않고 통째로 띄운다.
// 닫을 때 카드 숫자를 다시 맞춘다(모달 안에서 상태를 바꿨을 수 있다).

import { useState } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import MyQuotesPanel from '@/components/dashboard/MyQuotesPanel'
import DashCard from './DashCard'
import { quoteStatusCounts, type CardQuote } from '@/lib/homeCards'
import { SALES_STATUS_COLORS, getCategoryColor } from '@/lib/categoryColors'
import type { Slot } from '@/hooks/dashboard/useDashboardCards'

const TEXT = '#111827'
const GRAY = '#6b7280'
const MUTED = '#9ca3af'

export type MyQuoteCardProps = {
  engineerId: number
  slot: Slot<CardQuote[]>
  /**
   * 주소(?quoteTab=)로 들어온 상태 탭. 있으면 **처음부터 모달이 그 탭으로 열린다.**
   * 할 일 카드의 「유효기간이 끝나는 견적」과 이 카드의 상태 줄이 같은 길을 쓴다.
   */
  initialTab?: string | null
  /** 모달을 닫은 뒤 카드 건수를 다시 읽는다. */
  onReload: () => void
}

export default function MyQuoteCard({ engineerId, slot, initialTab, onReload }: MyQuoteCardProps) {
  // 열린 모달이 보고 있는 상태 탭. null 이면 닫혀 있다.
  // 주소로 들어온 값은 **처음 상태**로 넣는다(effect 로 열면 화면이 한 번 깜빡인다).
  const [openTab, setOpenTab] = useState<string | null>(initialTab ?? null)
  const counts = quoteStatusCounts(slot.data, engineerId)

  const close = () => { setOpenTab(null); onReload() }

  return (
    <>
      <DashCard
        title="내 견적"
        onMore={() => setOpenTab('전체')}
        loading={slot.loading}
        error={slot.error}
      >
        {/* 활동 기록 카드와 같은 모양 — 점 · 이름 · 오른쪽 건수 뱃지.
            매출완료는 세지 않는다(끝난 건이라 쌓이기만 한다. lib/homeCards.ts 참조). */}
        <div style={{ display: 'grid', gap: 7 }}>
          {counts.map(({ status, count }) => {
            const sc = getCategoryColor(SALES_STATUS_COLORS, status)
            return (
              <button key={status} type="button" onClick={() => setOpenTab(status)}
                title={`${status} 견적을 모달에서 봅니다`}
                style={{ height: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, padding: 0, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: sc.dot ?? sc.text, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: TEXT, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{status}</span>
                </span>
                <span className="num" style={{
                  fontSize: 12, fontWeight: 600, flexShrink: 0,
                  color: count ? (sc.dot ?? sc.text) : MUTED,
                  background: '#f3f4f6', borderRadius: 6, padding: '2px 8px',
                }}>
                  {count}<span style={{ color: MUTED }}>건</span>
                </span>
              </button>
            )
          })}
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: MUTED }}>
          기간과 무관하게 지금 진행 중인 건입니다
        </div>
      </DashCard>

      {/* 큰 모달 — 표가 본래 쓰던 폭이 필요하다(필터 줄·10열 표·페이지). */}
      {openTab !== null && (
        <ModalOverlay onClose={close}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 8, width: '90vw', height: '85vh',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
              boxShadow: '0 20px 60px rgba(0,0,0,0.22)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid #ebebeb', flexShrink: 0 }}>
              <span style={{ fontSize: 17, fontWeight: 800, color: TEXT, letterSpacing: '-0.3px' }}>내 견적</span>
              <span style={{ flex: 1 }} />
              <button type="button" onClick={close} aria-label="닫기"
                style={{ width: 28, height: 28, borderRadius: '50%', border: 'none', background: '#f3f4f6', color: GRAY, fontSize: 16, cursor: 'pointer', lineHeight: 1 }}>
                ×
              </button>
            </div>
            {/* 패널이 남는 높이를 다 쓰게 한다(fitToHeight) — 목록 줄 수가 모달 높이에 맞춰 늘어난다. */}
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 12, overflow: 'auto' }}>
              <MyQuotesPanel engineerId={engineerId} fitToHeight initialStatus={openTab} />
            </div>
          </div>
        </ModalOverlay>
      )}
    </>
  )
}
