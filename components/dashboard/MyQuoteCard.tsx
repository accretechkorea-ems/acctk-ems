'use client'

// 「내 견적」 카드와 그 **큰 모달**.
//
// 카드는 이번 달 숫자만 본다(lib/homeCards.ts 의 monthKpi). 표 전체는 모달이 열릴 때 비로소
// 읽는다 — 홈에 들어올 때마다 견적 목록·결재 문서·승인 게이트까지 읽으면 첫 화면이 느려진다.
//
// 모달 안은 **지금 쓰던 MyQuotesPanel 그대로**다. 필터·탭·검색·발주서 등록·계산서 요청·결재
// 올리기·삭제 요청·엑셀 내보내기가 전부 그 부품 안에 있어, 옮기지 않고 통째로 띄운다.
// 닫을 때 카드 숫자를 다시 맞춘다(모달 안에서 상태를 바꿨을 수 있다).

import { useState } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import MyQuotesPanel from '@/components/dashboard/MyQuotesPanel'
import DashCard from './DashCard'
import { monthKpi, type CardQuote } from '@/lib/homeCards'
import type { Slot } from '@/hooks/dashboard/useDashboardCards'

const TEXT = '#111827'
const GRAY = '#6b7280'
const MUTED = '#9ca3af'
const FADE = '#d1d5db'
const BLUE = '#234ea2'
const GREEN = '#16a34a'

const numKR = (n: number) => Math.round(n).toLocaleString('ko-KR')
/** 카드 한 줄에 들어가게 줄여 쓴다. 0 은 「-」로 — 없는 것과 0원은 같은 뜻이다. */
const compact = (n: number): string => {
  if (!n) return '-'
  if (n >= 1e8) return `₩${Math.round((n / 1e8) * 10) / 10}억`
  if (n >= 1e7) return `₩${Math.round(n / 1e7)}천만`
  if (n >= 1e4) return `₩${numKR(Math.round(n / 1e4))}만`
  return `₩${numKR(n)}`
}

/** 숫자 한 칸. **컴포넌트 밖에** 둔다 — 렌더마다 새로 만들면 React 가 상태를 버린다. */
function Num({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11, color: GRAY }}>{label}</div>
      <div className="num" style={{ fontSize: 15, fontWeight: 800, color: value ? (color ?? TEXT) : FADE, whiteSpace: 'nowrap' }}>
        {compact(value)}
      </div>
    </div>
  )
}

/** 달성률 한 줄 — 막대 없이 숫자와 목표만. 목표가 없으면 그 사실을 적는다. */
function Rate({ label, rate, target }: { label: string; rate: number | null; target: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
      <span style={{ fontSize: 11, color: GRAY, width: 52, flexShrink: 0 }}>{label}</span>
      <span className="num" style={{ fontSize: 13, fontWeight: 800, color: rate === null ? FADE : (rate >= 100 ? GREEN : TEXT) }}>
        {rate === null ? '목표 없음' : `${rate.toFixed(1)}%`}
      </span>
      {target > 0 && (
        <span className="num" style={{ fontSize: 11, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          목표 {compact(target)}
        </span>
      )}
    </div>
  )
}

export type MyQuoteCardProps = {
  engineerId: number
  slot: Slot<CardQuote[]>
  targets: Slot<{ sales: number; order: number }>
  /** 'YYYY-MM' — 이번 달. */
  month: string
  /** 모달을 닫은 뒤 카드 숫자를 다시 읽는다. */
  onReload: () => void
}

export default function MyQuoteCard({ engineerId, slot, targets, month, onReload }: MyQuoteCardProps) {
  const [open, setOpen] = useState(false)
  const k = monthKpi(slot.data, { month, engineerId, yearTarget: targets.data })

  const close = () => { setOpen(false); onReload() }

  return (
    <>
      <DashCard
        title="내 견적"
        onMore={() => setOpen(true)}
        loading={slot.loading || targets.loading}
        error={slot.error}
      >
        <div style={{ fontSize: 11, color: MUTED, marginBottom: 6 }}>{month.replace('-', '년 ')}월</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px 12px', marginBottom: 10 }}>
          <Num label="견적 제출" value={k.quoted} />
          <Num label="수주" value={k.ordered} />
          <Num label="매출" value={k.revenue} color={BLUE} />
          <Num label="순이익" value={k.profit} color={GREEN} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, borderTop: '1px solid #ebebeb', paddingTop: 8 }}>
          <Rate label="수주 달성" rate={k.orderAchieve} target={k.orderTarget} />
          <Rate label="매출 달성" rate={k.salesAchieve} target={k.salesTarget} />
        </div>
      </DashCard>

      {/* 큰 모달 — 표가 본래 쓰던 폭이 필요하다(필터 줄·10열 표·페이지). */}
      {open && (
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
              <MyQuotesPanel engineerId={engineerId} fitToHeight />
            </div>
          </div>
        </ModalOverlay>
      )}
    </>
  )
}
