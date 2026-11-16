'use client'

// 견적 목록 행의 **「수리정보」 단추 겸 뱃지** — 내 견적·실적 현황 두 목록이 함께 쓴다.
//
// 뱃지와 단추를 따로 두지 않는다. 표의 한 행에 들어갈 폭이 넉넉하지 않고, 상태를 본 사람이
// 바로 누르는 흐름이라 같은 자리에 두는 편이 짧다. 색은 **점**이 맡는다 — 배경에 상태색
// 틴트를 깔지 않는 것이 이 저장소의 배지 규칙이다(.claude/rules/design-system.md).
//
// 수리 건이 아닌 견적에는 아무것도 그리지 않는다(부르는 쪽이 null 을 넘긴다).

import { REPAIR_INFO_DOT, REPAIR_INFO_LABEL, type RepairInfoState } from '@/lib/quoteRepairInfo'

export type RepairInfoButtonProps = {
  state: RepairInfoState
  onClick: () => void
}

export default function RepairInfoButton({ state, onClick }: RepairInfoButtonProps) {
  return (
    <button
      onClick={onClick}
      title="수리 건 정보(고장 증상·원인·처리 결과)를 보고 적습니다"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '3px 7px', background: '#f3f4f6', border: '1px solid #ebebeb', borderRadius: 6,
        cursor: 'pointer', fontSize: 10, fontWeight: 700, color: '#6b7280', whiteSpace: 'nowrap',
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: REPAIR_INFO_DOT[state], flexShrink: 0 }} />
      수리정보 {REPAIR_INFO_LABEL[state]}
    </button>
  )
}
