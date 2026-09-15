'use client'

// 참여 엔지니어 선택 — 고른 사람은 칩으로 두고, [+ 추가] 를 누르면 나머지 목록이 펼쳐진다.
// 동작·모양은 ServiceAddModal.tsx:247-281 의 「방문 엔지니어」와 같다.
//
// 엔지니어 목록은 이 컴포넌트가 조회하지 않는다 — 기존 모달과 같이 화면이 읽어 prop 으로 준다
// (useCustomerDetail.ts:94 의 `from('engineers').select('*, email').order('engineer_id')`).
// 재직자 판정도 기존 모달과 같은 isCurrentlyEmployed 를 쓴다.

import { isCurrentlyEmployed } from '@/lib/engineers'
import { todayKST } from '@/lib/date'
import { BLUE, BORDER, CARD_BG, TEXT, SUB } from '@/components/common/ui'

export type PickerEngineer = {
  engineer_id: number
  name: string | null
  position: string | null
  resigned_date: string | null
}

type Props = {
  engineers: PickerEngineer[]
  selectedIds: number[]
  onChange: (ids: number[]) => void
  expanded: boolean
  onToggleExpand: (next: boolean) => void
  invalid?: boolean
}

export default function EngineerPicker({ engineers, selectedIds, onChange, expanded, onToggleExpand, invalid }: Props) {
  // 신규 배정 대상은 재직자만. 이미 고른 사람은 퇴사했더라도 칩으로 남는다(과거 기록 보존).
  const today = todayKST()
  const selectable = engineers.filter(e => isCurrentlyEmployed(e.resigned_date, today))

  return (
    <div style={{
      border: invalid ? '1px solid #dc2626' : `1px solid ${BORDER}`,
      borderRadius: 8, padding: 14, background: '#f8f9fb',
    }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 7 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: SUB, marginRight: 4 }}>참여 엔지니어</span>
        {selectedIds.map(id => {
          const eng = engineers.find(e => e.engineer_id === id)
          if (!eng) return null
          return (
            <button key={id} type="button" onClick={() => onChange(selectedIds.filter(i => i !== id))}
              style={{
                padding: '7px 12px', borderRadius: 20, border: `1px solid ${BLUE}`, background: BLUE,
                color: '#ffffff', fontWeight: 700, fontSize: 12, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, minWidth: 96,
              }}>
              {eng.name} {eng.position || ''}
              <span style={{ fontSize: 12, opacity: 0.8 }}>✕</span>
            </button>
          )
        })}
        <button type="button" onClick={() => onToggleExpand(!expanded)}
          style={{
            padding: '7px 12px', borderRadius: 20, border: `1px solid ${BORDER}`,
            background: expanded ? '#eff4ff' : CARD_BG, color: BLUE,
            fontWeight: 700, fontSize: 12, cursor: 'pointer',
          }}>
          + 추가
        </button>
      </div>

      {expanded && (
        <div style={{
          marginTop: 10, paddingTop: 10, borderTop: `1px solid ${BORDER}`,
          display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 7,
        }}>
          {selectable.filter(e => !selectedIds.includes(e.engineer_id)).map(eng => (
            <button key={eng.engineer_id} type="button"
              onClick={() => { onChange([...selectedIds, eng.engineer_id]); onToggleExpand(false) }}
              style={{
                padding: '6px 12px', borderRadius: 20, border: `1px solid ${BORDER}`, background: CARD_BG,
                color: TEXT, fontWeight: 600, fontSize: 12, cursor: 'pointer', minWidth: 96, textAlign: 'center',
              }}>
              {eng.name} {eng.position || ''}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
