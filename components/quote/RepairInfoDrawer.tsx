'use client'

// 견적 목록에서 여는 **수리 정보 드로어** — 내 견적·실적 현황 두 목록이 함께 쓴다.
//
// 목록 행의 「수리 정보」 단추가 이것을 연다. 안은 작성 화면과 **같은 패널**이고
// (components/quote/RepairInfoPanel.tsx), 여기서는 저장된 견적이라 「저장」이 바로 쓴다.
//
// 모달이 아니라 오른쪽에 붙는 드로어인 까닭 — 목록에서 한 건씩 훑으며 적는 일이라,
// 가운데 모달이 뜨면 뒤의 목록이 가려 어느 줄을 보던 중인지 놓친다.

import { useEffect, useState } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import RepairInfoPanel from '@/components/quote/RepairInfoPanel'
import {
  fetchRepairInfo, saveRepairInfo, repairInfoState,
  type RepairBrief, type RepairInfoFields, type RepairInfoState,
} from '@/lib/quoteRepairInfo'

const BORDER = '#ebebeb'

export type RepairInfoDrawerProps = {
  quoteId: number
  quoteNumber: string
  onClose: () => void
  /** 저장이 끝나면 목록 뱃지를 그 자리에서 고친다(다시 불러오지 않는다). */
  onSaved?: (quoteId: number, state: RepairInfoState) => void
  toast: { success: (m: string) => void; error: (m: string) => void }
}

const EMPTY: RepairInfoFields = { symptom: null, cause: null, result: null }

export default function RepairInfoDrawer({ quoteId, quoteNumber, onClose, onSaved, toast }: RepairInfoDrawerProps) {
  const [loading, setLoading] = useState(true)
  const [repair, setRepair] = useState<RepairBrief | null>(null)
  const [value, setValue] = useState<RepairInfoFields>(EMPTY)
  const [canEdit, setCanEdit] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const d = await fetchRepairInfo(quoteId)
      if (!alive) return
      setRepair(d?.repair ?? null)
      setValue(d?.info ?? EMPTY)
      setCanEdit(!!d?.canEdit)
      setLoading(false)
    })()
    return () => { alive = false }
  }, [quoteId])

  const save = async (): Promise<boolean> => {
    const r = await saveRepairInfo(quoteId, value)
    if (!r.ok) { toast.error(r.error ?? '저장하지 못했습니다'); return false }
    toast.success('수리 정보를 저장했습니다')
    onSaved?.(quoteId, repairInfoState(value))
    return true
  }

  return (
    <ModalOverlay onClose={onClose} style={{ justifyContent: 'flex-end', alignItems: 'stretch', padding: 0 }}>
      <div style={{
        width: 'min(460px, 100vw)', height: '100%', background: '#fff',
        borderLeft: `1px solid ${BORDER}`, display: 'flex', flexDirection: 'column',
        animation: 'modal-in 0.15s ease',
      }}>
        <div style={{ padding: '14px 16px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 3, height: 14, background: '#234ea2', borderRadius: 6, flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 800, color: '#111827' }}>수리 정보</span>
          <span style={{ fontSize: 12, color: '#9ca3af' }}>{quoteNumber}</span>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} title="닫기"
            style={{ width: 24, height: 24, padding: 0, background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
          {loading
            ? <div style={{ fontSize: 12, color: '#9ca3af' }}>불러오는 중…</div>
            : <RepairInfoPanel repair={repair} value={value} onChange={setValue} mode="saved" onSave={save} canEdit={canEdit} />}
        </div>
      </div>
    </ModalOverlay>
  )
}
