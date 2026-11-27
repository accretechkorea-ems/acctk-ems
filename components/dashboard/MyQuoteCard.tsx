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

import { useEffect, useRef, useState, type ReactNode } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import ModalCard from '@/components/common/ModalCard'
import MyQuotesPanel from '@/components/dashboard/MyQuotesPanel'
import DashCard from './DashCard'
import { CountList, CountTotal, type CountRow } from '@/components/common/CountList'
import { quoteStatusCounts, type CardQuote } from '@/lib/homeCards'
import { SALES_STATUS_COLORS, getCategoryColor } from '@/lib/categoryColors'
import type { Slot } from '@/hooks/dashboard/useDashboardCards'
import { R } from '@/lib/radius'

const TEXT = '#111827'
const BORDER = '#ebebeb'

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
  /**
   * 제목 줄 오른쪽에 붙는 것 — 2026-11-26 부터 「＋ 사후 실적」이 여기 선다(F6).
   * 카드 전체가 눌리는 자리라 넣는 쪽이 전파를 막는다(components/dashboard/BackfillButton.tsx).
   */
  headerRight?: ReactNode
}

export default function MyQuoteCard({ engineerId, slot, initialTab, onReload, headerRight }: MyQuoteCardProps) {
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

  /**
   * **머리줄에 패널의 조종 칸을 심는다** (2026-11-28, 야간4 2-3).
   *
   * 제목 줄은 「내 견적 ··· [기간 ▾] [상태 ▾] [검색] ⬇ ✕」 한 줄이다. 기간·상태·검색은
   * 패널이 들고 있는 상태라 **그 자리를 패널에 내려 준다** — 상태를 끌어올려 양쪽에
   * 흘리는 대신, 빈 칸 하나를 ref 로 잡아 넘기고 패널이 포털로 심는다. 그래야 필터가
   * 바뀔 때 다시 그려지는 것이 패널 안쪽뿐이다.
   */
  // 모달이 닫히면 React 가 그 ref 를 **null 로 한 번 더** 불러 준다 — 따로 비우지 않는다.
  // (상태 설정 함수는 이름이 바뀌지 않으므로 ref 가 렌더마다 다시 붙지도 않는다.)
  const [controlsBox, setControlsBox] = useState<HTMLElement | null>(null)

  // 모달이 열려 있는 동안 **뒤 화면을 잠근다.** Esc 는 ModalOverlay 가 받는다
  // (2026-11-02 부터 공용 한곳이고, 입력 폼 모달은 그쪽에서 확인을 받는다).
  useEffect(() => {
    if (openTab === null) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
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
        headerRight={headerRight}
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
          {/* 공용 카드로 옮겼다(2026-11-26, 지시 P) — 열림 모션 150ms · Esc·바깥 클릭·✕ 가
              한 함수를 지난다. 겉모양은 그대로다: 90vw × 85vh · radius control · 머리줄
              아래 선 · 제목 17/800 · 본문 여백 12. */}
          <ModalCard
            style={{
              borderRadius: R.control, width: '90vw', maxWidth: '90vw', height: '85vh',
            }}
            // 폰(≤768)에서는 조종 칸이 **제목 아래 줄**로 접힌다(app/globals.css 의
            // .myq-controls-slot). 접히지 않으면 제목과 겹친다 — 390 에서 재어 보고 고쳤다.
            headStyle={{ padding: '12px 16px', borderBottom: `1px solid ${BORDER}`, alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
            bodyStyle={{ padding: 12, overflowX: 'hidden' }}
            title={<span style={{ fontSize: 17, fontWeight: 800, color: TEXT, letterSpacing: '-0.3px', whiteSpace: 'nowrap' }}>내 견적</span>}
            // 제목과 ✕ 사이가 조종 칸의 자리다. 패널이 여기에 포털로 심는다.
            titleExtra={<span className="myq-controls-slot" ref={setControlsBox} />}
          >
            {/* 본문 — 여기서만 스크롤한다.
                ⚠ fitToHeight 를 주지 않는다. 그 모드는 **표 상자를 모달 높이에 맞춰 잘라 내고**
                  (overflowY: hidden) 줄 수를 그 높이에 맞추는 방식이라, 필터 줄이 접히거나 줄이
                  높아지면 남은 줄이 잘린 채 스크롤도 되지 않았다. 모달에서는 패널을 제 높이대로
                  두고 넘치는 만큼 이 상자가 내려간다.
                바깥 상자에 display:flex 를 쓰지 않는 것도 같은 이유다 — flex 자식은 늘어나는
                  대신 눌려서, 넘칠 일이 생기지 않는다(= 스크롤이 생기지 않는다). */}
            <MyQuotesPanel engineerId={engineerId} initialStatus={openTab} controlsTarget={controlsBox} />
          </ModalCard>
        </ModalOverlay>
      )}
    </>
  )
}
