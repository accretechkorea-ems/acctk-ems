'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import type { Repair, RepairStatus } from '@/hooks/useRepairs'
import ModalOverlay from '@/components/common/ModalOverlay'

/**
 * 수리품 수정 모달.
 *
 * ── 상태 되돌리기 규칙 (buildPatch 에서 저장 시 한 번에 처리) ──
 * "되돌아간 상태 이후 단계의 타임스탬프는 전부 null" 로 정리한다.
 *   최종 '입고'     → repair_started_at, repair_done_at, shipped_at, shipped_date 전부 null
 *   최종 '수리중'   → repair_done_at, shipped_at, shipped_date = null,
 *                     repair_started_at 이 null 이면 now()
 *   최종 '출고대기' → shipped_at, shipped_date = null,
 *                     repair_started_at, repair_done_at 이 null 이면 now()
 *   최종 '출고완료' → 앞 단계 타임스탬프가 null 이면 now(),
 *                     shipped_at = now(), shipped_date = 폼 입력값
 * 현재보다 앞 단계로 되돌릴 때는 저장 전에 확인을 받는다.
 */

type Category = '게이지' | '앰프'
const CATEGORIES: Category[] = ['게이지', '앰프']
const STATUSES: RepairStatus[] = ['입고', '수리중', '출고대기', '출고완료']

type Props = {
  repair: Repair | null
  isSaving: boolean
  onClose: () => void
  onSave: (repairId: number, patch: Record<string, unknown>) => void
  onDelete: (r: Repair) => void
}

const labelStyle: CSSProperties = { fontSize: 13, fontWeight: 600, color: '#6b7280', marginBottom: 6, display: 'block' }
const fieldStyle: CSSProperties = {
  width: '100%', padding: '11px 12px', border: '1px solid #ebebeb', borderRadius: 6,
  boxSizing: 'border-box', color: '#111827', background: '#fff', outline: 'none', fontSize: 14,
}

// 최종 status 기준 타임스탬프 정리 (되돌아간 상태 이후 단계는 전부 null)
function buildPatch(
  repair: Repair,
  form: { itemType: Category; receivedDate: string; customerName: string; productType: string; serialNumber: string; status: RepairStatus; shippedDate: string },
): Record<string, unknown> {
  const now = new Date().toISOString()
  const patch: Record<string, unknown> = {
    item_type: form.itemType,
    received_date: form.receivedDate,
    customer_name: form.customerName.trim(),
    product_type: form.productType.trim() || null,
    serial_number: form.serialNumber.trim() || null,
    status: form.status,
    repair_started_at: repair.repair_started_at,
    repair_done_at: repair.repair_done_at,
    shipped_at: repair.shipped_at,
    shipped_date: repair.shipped_date,
  }
  if (form.status === '입고') {
    patch.repair_started_at = null; patch.repair_done_at = null; patch.shipped_at = null; patch.shipped_date = null
  } else if (form.status === '수리중') {
    patch.repair_done_at = null; patch.shipped_at = null; patch.shipped_date = null
    patch.repair_started_at = repair.repair_started_at ?? now
  } else if (form.status === '출고대기') {
    patch.shipped_at = null; patch.shipped_date = null
    patch.repair_started_at = repair.repair_started_at ?? now
    patch.repair_done_at = repair.repair_done_at ?? now
  } else if (form.status === '출고완료') {
    patch.repair_started_at = repair.repair_started_at ?? now
    patch.repair_done_at = repair.repair_done_at ?? now
    patch.shipped_at = now
    patch.shipped_date = form.shippedDate || null
  }
  return patch
}

export default function RepairEditModal({ repair, isSaving, onClose, onSave, onDelete }: Props) {
  const [itemType, setItemType] = useState<Category>('게이지')
  const [receivedDate, setReceivedDate] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [productType, setProductType] = useState('')
  const [serialNumber, setSerialNumber] = useState('')
  const [status, setStatus] = useState<RepairStatus>('입고')
  const [shippedDate, setShippedDate] = useState('')

  useEffect(() => {
    if (repair) {
      setItemType((repair.item_type === '앰프' ? '앰프' : '게이지'))
      setReceivedDate(repair.received_date ?? '')
      setCustomerName(repair.customer_name ?? '')
      setProductType(repair.product_type ?? '')
      setSerialNumber(repair.serial_number ?? '')
      setStatus(repair.status)
      setShippedDate(repair.shipped_date ?? '')
    }
  }, [repair])

  if (!repair) return null

  const isShipped = status === '출고완료'

  const handleSave = () => {
    if (!customerName.trim()) { alert('회사명을 입력해주세요.'); return }
    if (!receivedDate) { alert('입고일을 입력해주세요.'); return }
    const origIdx = STATUSES.indexOf(repair.status)
    const newIdx = STATUSES.indexOf(status)
    if (newIdx < origIdx) {
      if (!confirm('상태를 되돌리면 이후 단계의 기록(수리 완료일, 출고일)이 삭제됩니다. 계속할까요?')) return
    }
    onSave(repair.repair_id, buildPatch(repair, { itemType, receivedDate, customerName, productType, serialNumber, status, shippedDate }))
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 520, background: '#ffffff', borderRadius: 8, padding: 24,
          boxShadow: '0 20px 60px rgba(0,0,0,0.22)', border: '1px solid #ebebeb', animation: 'modal-in 0.18s ease',
        }}
      >
        {/* 헤더 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#111827', letterSpacing: '-0.3px' }}>수리품 수정</div>
          <button
            onClick={onClose}
            title="닫기"
            onMouseEnter={(e) => (e.currentTarget.style.color = '#111827')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#6b7280')}
            style={{ width: 28, height: 28, borderRadius: '50%', background: '#f3f4f6', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', transition: 'color 0.15s ease' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12 }}>
            <div>
              <label style={labelStyle}>구분</label>
              <div style={{ display: 'flex', border: '1px solid #ebebeb', borderRadius: 6, overflow: 'hidden' }}>
                {CATEGORIES.map(c => (
                  <button key={c} type="button" onClick={() => setItemType(c)}
                    style={{ flex: 1, padding: '10px 0', border: 'none', background: itemType === c ? '#234ea2' : '#fff', color: itemType === c ? '#fff' : '#6b7280', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label style={labelStyle}>입고일</label>
              <input type="date" value={receivedDate} onChange={e => setReceivedDate(e.target.value)} style={{ ...fieldStyle, colorScheme: 'light' }} />
            </div>
          </div>

          <div>
            <label style={labelStyle}>회사명</label>
            <input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="회사명" style={fieldStyle} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12 }}>
            <div>
              <label style={labelStyle}>제품 구분</label>
              <input value={productType} onChange={e => setProductType(e.target.value)} placeholder="예: E-TS-4182-P6" style={fieldStyle} />
            </div>
            <div>
              <label style={labelStyle}>시리얼번호</label>
              <input value={serialNumber} onChange={e => setSerialNumber(e.target.value)} placeholder="시리얼번호" style={fieldStyle} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12 }}>
            <div>
              <label style={labelStyle}>상태</label>
              <select value={status} onChange={e => setStatus(e.target.value as RepairStatus)} style={fieldStyle}>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>출고일</label>
              <input type="date" disabled={!isShipped}
                value={isShipped ? shippedDate : ''}
                onChange={e => setShippedDate(e.target.value)}
                style={{ ...fieldStyle, colorScheme: 'light', background: isShipped ? '#fff' : '#f3f4f6', color: isShipped ? '#111827' : '#9ca3af', cursor: isShipped ? 'auto' : 'not-allowed' }} />
            </div>
          </div>
        </div>

        {/* 푸터 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 24 }}>
          <button
            onClick={() => onDelete(repair)}
            disabled={isSaving}
            style={{ padding: '9px 16px', background: '#ef4444', color: '#fff', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, opacity: isSaving ? 0.6 : 1 }}
          >삭제</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onClose}
              style={{ padding: '9px 16px', background: '#fff', color: '#6b7280', borderRadius: 6, border: '1px solid #ebebeb', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
            >취소</button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              onMouseEnter={(e) => { if (!isSaving) e.currentTarget.style.background = '#1c3e87' }}
              onMouseLeave={(e) => { if (!isSaving) e.currentTarget.style.background = '#234ea2' }}
              style={{ padding: '9px 18px', background: '#234ea2', color: '#fff', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, opacity: isSaving ? 0.6 : 1, transition: 'background 0.15s ease' }}
            >
              {isSaving ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
      </div>
    </ModalOverlay>
  )
}
