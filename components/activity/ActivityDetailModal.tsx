'use client'

import ModalOverlay from '@/components/common/ModalOverlay'
import ActivityDetail, { type DetailEngineer } from '@/components/activity/ActivityDetail'

// 활동 서비스 기록 상세 모달. 본문은 ActivityDetail(variant="modal")에 위임하고,
// 여기서는 오버레이 + 카드 래퍼 + 애니메이션만 담당한다. (개인 대시보드는 같은 본문을 인라인으로 씀)

const CARD_BG = '#ffffff'
const BORDER = '#ebebeb'

export type { DetailEngineer }

type Props = {
  engineer: DetailEngineer
  startDate: string
  endDate: string
  onClose: () => void
}

export default function ActivityDetailModal({ engineer, startDate, endDate, onClose }: Props) {
  return (
    <>
      <style>{`@keyframes modal-in { from { opacity: 0; transform: scale(0.97) translateY(8px); } to { opacity: 1; transform: scale(1) translateY(0); } }`}</style>
      <ModalOverlay onClose={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div onClick={e => e.stopPropagation()}
          style={{
            background: CARD_BG, borderRadius: 8, width: '100%', maxWidth: 700,
            // 오버레이 위아래 여백(24+24)을 뺀 만큼까지 늘어난다. 내용이 짧으면 그만큼만.
            // overflow: hidden 이 있어야 목록이 둥근 모서리 밖으로 새지 않는다.
            maxHeight: 'calc(100vh - 48px)', overflow: 'hidden',
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 20px 60px rgba(0,0,0,0.22)', border: `1px solid ${BORDER}`,
            animation: 'modal-in 0.18s ease',
          }}>
          <ActivityDetail engineer={engineer} startDate={startDate} endDate={endDate} variant="modal" onClose={onClose} />
        </div>
      </ModalOverlay>
    </>
  )
}
