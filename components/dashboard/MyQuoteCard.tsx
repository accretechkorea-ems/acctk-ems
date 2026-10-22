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

import { useEffect, useRef, useState } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import MyQuotesPanel from '@/components/dashboard/MyQuotesPanel'
import DashCard from './DashCard'
import { CountList, CountTotal, type CountRow } from '@/components/common/CountList'
import { quoteStatusCounts, type CardQuote } from '@/lib/homeCards'
import { SALES_STATUS_COLORS, getCategoryColor } from '@/lib/categoryColors'
import type { Slot } from '@/hooks/dashboard/useDashboardCards'

const TEXT = '#111827'
const GRAY = '#6b7280'

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
  const rows: CountRow[] = counts.map(({ status, count }) => {
    const sc = getCategoryColor(SALES_STATUS_COLORS, status)
    return { key: status, label: status, count, color: sc.dot ?? sc.text, onClick: () => setOpenTab(status) }
  })

  const close = () => { setOpenTab(null); onReload() }

  // 닫는 일을 ref 로 들고 있는다 — 아래 effect 가 렌더마다 다시 걸리지 않게 한다
  // (onReload 는 부모가 렌더마다 새로 만들어 넘기는 함수다).
  const closeRef = useRef(close)
  useEffect(() => { closeRef.current = close })

  // 모달이 열려 있는 동안 **뒤 화면을 잠그고** ESC 로 닫는다.
  // ModalOverlay 는 바깥 클릭만 맡는다 — 잠금·ESC 를 거기 넣으면 저장 중인 입력이 있는
  // 다른 모달까지 ESC 로 닫히므로, 이 모달에서만 건다.
  useEffect(() => {
    if (openTab === null) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [openTab])

  return (
    <>
      <DashCard
        title="내 견적"
        // 줄 밖을 누르면 전체 탭. 줄을 누르면 그 상태 탭이다(줄이 전파를 막는다).
        onClick={() => setOpenTab('전체')}
        loading={slot.loading}
        error={slot.error}
        errorMessage={slot.message}
      >
        {/* 활동 기록 카드와 같은 틀 — 점 · 이름 · 건수 뱃지 · 바닥 합계.
            매출완료는 세지 않는다(끝난 건이라 쌓이기만 한다. lib/homeCards.ts 참조).
            0 건인 상태도 **보여 준다** — 네 상태가 늘 같은 자리에 있어야 읽기 쉽다. */}
        <CountList rows={rows} emptyText="진행 중인 견적이 없습니다" fitHeight />
        <CountTotal total={counts.reduce((s, c) => s + c.count, 0)} />
      </DashCard>

      {/* 큰 모달 — **머리(고정) + 본문(스크롤)** 두 단이다. 표가 본래 쓰던 폭이 필요하다
          (필터 줄·10열 표·페이지). 본문만 내려가고 뒤 화면은 잠긴다. */}
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
            {/* 본문 — 여기서만 스크롤한다.
                ⚠ fitToHeight 를 주지 않는다. 그 모드는 **표 상자를 모달 높이에 맞춰 잘라 내고**
                  (overflowY: hidden) 줄 수를 그 높이에 맞추는 방식이라, 필터 줄이 접히거나 줄이
                  높아지면 남은 줄이 잘린 채 스크롤도 되지 않았다. 모달에서는 패널을 제 높이대로
                  두고 넘치는 만큼 이 상자가 내려간다.
                바깥 상자에 display:flex 를 쓰지 않는 것도 같은 이유다 — flex 자식은 늘어나는
                  대신 눌려서, 넘칠 일이 생기지 않는다(= 스크롤이 생기지 않는다). */}
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: 12 }}>
              <MyQuotesPanel engineerId={engineerId} initialStatus={openTab} />
            </div>
          </div>
        </ModalOverlay>
      )}
    </>
  )
}
