'use client'

import ModalOverlay from '@/components/common/ModalOverlay'
import ModalCard from '@/components/common/ModalCard'
import ActivityDetail, { type DetailEngineer } from '@/components/activity/ActivityDetail'
import { Z } from '@/lib/zIndex'

// 활동 서비스 기록 상세 모달. 본문은 ActivityDetail(variant="modal")에 위임하고,
// 여기서는 오버레이 + 공용 카드만 담당한다. (개인 대시보드는 같은 본문을 인라인으로 씀)
//
// ── 여기만 머리줄·바닥줄을 카드에 주지 않는 이유 (2026-11-21) ─────────────────
//   머리줄(이름·기간·동선 보기·✕)과 구르는 목록이 **ActivityDetail 안에** 있다. 그 부품은
//   같은 본문을 대시보드에서 **인라인으로도** 쓰기 때문에, 머리·본문을 떼어내 이 모달의
//   title/footer 로 옮기면 모달이 아닌 쪽까지 뜯어야 한다(이번 범위는 모달 13 뿐이다).
//   그래서 카드에는 **구조만** 맡기고(스스로 구르지 않기·모션·닫는 길) 속은 그대로 두었다.
//   보이는 결과는 종전과 같다 — 머리줄은 flexShrink 0 으로 고정이고 목록만 구른다.

export type { DetailEngineer }

type Props = {
  engineer: DetailEngineer
  startDate: string
  endDate: string
  onClose: () => void
}

export default function ActivityDetailModal({ engineer, startDate, endDate, onClose }: Props) {
  return (
    <ModalOverlay onClose={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: Z.modal, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      {/* 머리줄·바닥줄은 주지 않는다(위 머리말) — 본문 한 칸에 ActivityDetail 을 그대로 둔다.
          여백 0 · 세로 flex · overflow hidden 이라 속의 머리줄은 고정이고 목록만 구른다.
          높이는 옛 값 그대로: 오버레이 위아래 여백(24+24)을 뺀 만큼까지. */}
      <ModalCard
        width={700}
        closeX={false}
        style={{ maxHeight: 'calc(100vh - 48px)' }}
        bodyStyle={{ padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        <ActivityDetail engineer={engineer} startDate={startDate} endDate={endDate} variant="modal" onClose={onClose} />
      </ModalCard>
    </ModalOverlay>
  )
}
