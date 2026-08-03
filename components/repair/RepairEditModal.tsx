'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import type { Repair, RepairStatus } from '@/hooks/useRepairs'
import ModalOverlay from '@/components/common/ModalOverlay'
import { useConfirm } from '@/components/common/ConfirmDialog'
import { useFieldErrors, FieldError, errBorder } from '@/components/common/fieldErrors'

/**
 * 수리품 수정 모달.
 *
 * ── buildPatch 분기 순서 (위에서부터 우선) ──
 * 1) 특이사항 우선 분기 (repair_content 가 비어있지 않을 때) — 상태별 규칙보다 먼저 처리:
 *    본사수리·수리불가 등 사내 수리 공정을 거치지 않은 건으로 보고
 *      status = '출고완료'
 *      repair_started_at = null, repair_done_at = null
 *      shipped_date = received_date (입고 당일 출고완료)
 *    → 이 분기에 걸리면 아래 상태별 규칙은 적용하지 않고 즉시 반환한다.
 *
 * 2) 상태 되돌리기 규칙 (특이사항이 없을 때만 적용):
 * "되돌아간 상태 이후 단계의 타임스탬프는 전부 null" 로 정리한다.
 * 전진 단계 시각(repair_started_at·repair_done_at)은 "이번 편집에서 실제로 그 단계를 넘어섰을 때만"
 * 오늘 날짜(YYYY-MM-DD)를 기록하고, 아니면 기존 값을 그대로 둔다(기존 null이면 null 유지).
 *   최종 '입고'     → repair_started_at, repair_done_at, shipped_date 전부 null
 *   최종 '수리중'   → repair_done_at, shipped_date = null,
 *                     repair_started_at: 이번에 입고→수리중을 넘었을 때만 오늘, 아니면 기존값
 *   최종 '출고대기' → shipped_date = null,
 *                     repair_started_at·repair_done_at: 이번에 각 단계를 넘었을 때만 오늘, 아니면 기존값
 *   최종 '출고완료' → repair_started_at·repair_done_at: 이번에 각 단계를 넘었을 때만 오늘, 아니면 기존값,
 *                     shipped_date = 폼 입력값
 * 현재보다 앞 단계로 되돌릴 때는 저장 전에 확인을 받는다.
 */

type Category = '게이지' | '앰프'
const CATEGORIES: Category[] = ['게이지', '앰프']
const STATUSES: RepairStatus[] = ['입고', '수리중', '출고대기', '출고완료']
// 특이사항 옵션 ((없음) = 빈 문자열)
const SPECIAL_OPTIONS = ['본사수리', '수리불가', '수리진행안함'] as const

// 로컬 오늘 날짜 'YYYY-MM-DD' (app/repair/page.tsx 의 todayStr 와 동일 로직 — export 안 돼 있어 중복 정의, 추후 공용화 예정)
const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

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

// 최종 status 기준 타임스탬프 정리. 특이사항(repair_content) 분기가 상태별 규칙보다 우선.
function buildPatch(
  repair: Repair,
  form: { itemType: Category; receivedDate: string; customerName: string; productType: string; serialNumber: string; status: RepairStatus; shippedDate: string; repairContent: string },
): Record<string, unknown> {
  const today = todayStr()
  const patch: Record<string, unknown> = {
    item_type: form.itemType,
    received_date: form.receivedDate,
    customer_name: form.customerName.trim(),
    product_type: form.productType.trim() || null,
    serial_number: form.serialNumber.trim() || null,
    repair_content: form.repairContent.trim() || null,
    status: form.status,
    repair_started_at: repair.repair_started_at,
    repair_done_at: repair.repair_done_at,
    shipped_date: repair.shipped_date,
  }
  // ── 1) 특이사항 우선 분기: 사내 공정 미경유. 아래 상태별 규칙보다 먼저 처리하고 즉시 반환 ──
  if (form.repairContent.trim() !== '') {
    patch.status = '출고완료'
    patch.repair_started_at = null
    patch.repair_done_at = null
    patch.shipped_date = form.receivedDate
    return patch
  }
  // ── 2) 상태별 되돌리기 규칙 ──
  // 상태 index (입고0 / 수리중1 / 출고대기2 / 출고완료3). handleSave 와 동일한 STATUSES 맵 재사용.
  const origIdx = STATUSES.indexOf(repair.status)
  const newIdx = STATUSES.indexOf(form.status)
  // 이번 편집에서 실제로 그 단계를 넘어섰을 때만 오늘 날짜 기록. 아니면 기존 값 유지(null이면 null).
  const startedAt = (origIdx < 1 && newIdx >= 1) ? today : repair.repair_started_at
  const doneAt = (origIdx < 2 && newIdx >= 2) ? today : repair.repair_done_at
  if (form.status === '입고') {
    patch.repair_started_at = null; patch.repair_done_at = null; patch.shipped_date = null
  } else if (form.status === '수리중') {
    patch.repair_done_at = null; patch.shipped_date = null
    patch.repair_started_at = startedAt
  } else if (form.status === '출고대기') {
    patch.shipped_date = null
    patch.repair_started_at = startedAt
    patch.repair_done_at = doneAt
  } else if (form.status === '출고완료') {
    patch.repair_started_at = startedAt
    patch.repair_done_at = doneAt
    patch.shipped_date = form.shippedDate || null
  }
  return patch
}

export default function RepairEditModal({ repair, isSaving, onClose, onSave, onDelete }: Props) {
  const confirmDialog = useConfirm()
  const { errors, setErrors, clearError, validate } = useFieldErrors<'customerName' | 'receivedDate'>()
  const [itemType, setItemType] = useState<Category>('게이지')
  const [receivedDate, setReceivedDate] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [productType, setProductType] = useState('')
  const [serialNumber, setSerialNumber] = useState('')
  const [status, setStatus] = useState<RepairStatus>('입고')
  const [shippedDate, setShippedDate] = useState('')
  const [repairContent, setRepairContent] = useState('')

  useEffect(() => {
    if (repair) {
      setItemType((repair.item_type === '앰프' ? '앰프' : '게이지'))
      setReceivedDate(repair.received_date ?? '')
      setCustomerName(repair.customer_name ?? '')
      setProductType(repair.product_type ?? '')
      setSerialNumber(repair.serial_number ?? '')
      setStatus(repair.status)
      setShippedDate(repair.shipped_date ?? '')
      setRepairContent(repair.repair_content ?? '')
      setErrors({})
    }
  }, [repair])

  if (!repair) return null

  // 특이사항이 지정된 건(값이 비어있지 않음) → 상태·출고일 잠금 + 저장 시 입고 당일 출고완료 처리
  const isSpecial = repairContent.trim() !== ''
  const isShipped = status === '출고완료'
  // 목록에 없는 기존 값(예: "본사수리 3965")은 select 로 표시할 수 없어 아래에 별도 안내
  const selectValue = (SPECIAL_OPTIONS as readonly string[]).includes(repairContent) ? repairContent : ''
  const isLegacyContent = isSpecial && selectValue === ''

  // 특이사항 선택 시: 출고완료 + 출고일=입고일 자동 처리. (없음)으로 되돌리면 값은 유지한 채 잠금만 해제.
  const onSelectContent = (v: string) => {
    setRepairContent(v)
    if (v) { setStatus('출고완료'); setShippedDate(receivedDate) }
  }

  const handleSave = async () => {
    const ok0 = validate({
      customerName: customerName.trim() ? null : '회사명을 입력해주세요',
      receivedDate: receivedDate ? null : '입고일을 입력해주세요',
    })
    if (!ok0) return
    // 특이사항 건은 항상 출고완료로 처리되므로 되돌리기 확인 대상이 아니다.
    if (!isSpecial) {
      const origIdx = STATUSES.indexOf(repair.status)
      const newIdx = STATUSES.indexOf(status)
      if (newIdx < origIdx) {
        const ok = await confirmDialog({ title: '상태 되돌리기', message: '상태를 되돌리면 이후 단계의 기록(수리 완료일, 출고일)이 삭제됩니다. 계속할까요?', confirmText: '계속', variant: 'default' })
        if (!ok) return
      }
    }
    onSave(repair.repair_id, buildPatch(repair, { itemType, receivedDate, customerName, productType, serialNumber, status, shippedDate, repairContent }))
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
              <input type="date" value={receivedDate} onChange={e => { setReceivedDate(e.target.value); clearError('receivedDate') }} style={errors.receivedDate ? { ...fieldStyle, colorScheme: 'light', border: errBorder } : { ...fieldStyle, colorScheme: 'light' }} />
              <FieldError message={errors.receivedDate} />
            </div>
          </div>

          <div>
            <label style={labelStyle}>회사명</label>
            <input value={customerName} onChange={e => { setCustomerName(e.target.value); clearError('customerName') }} placeholder="회사명" style={errors.customerName ? { ...fieldStyle, border: errBorder } : fieldStyle} />
            <FieldError message={errors.customerName} />
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
              <select value={status} disabled={isSpecial} onChange={e => setStatus(e.target.value as RepairStatus)}
                style={{ ...fieldStyle, background: isSpecial ? '#f3f4f6' : '#fff', color: isSpecial ? '#9ca3af' : '#111827', cursor: isSpecial ? 'not-allowed' : 'auto' }}>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>출고일</label>
              <input type="date" disabled={isSpecial || !isShipped}
                value={isSpecial ? receivedDate : (isShipped ? shippedDate : '')}
                onChange={e => setShippedDate(e.target.value)}
                style={{ ...fieldStyle, colorScheme: 'light', background: (isSpecial || !isShipped) ? '#f3f4f6' : '#fff', color: (isSpecial || !isShipped) ? '#9ca3af' : '#111827', cursor: (isSpecial || !isShipped) ? 'not-allowed' : 'auto' }} />
            </div>
          </div>

          <div>
            <label style={labelStyle}>특이사항</label>
            <select value={selectValue} onChange={e => onSelectContent(e.target.value)} style={fieldStyle}>
              <option value="">(없음)</option>
              {SPECIAL_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            {isLegacyContent && (
              <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 6 }}>현재 기록: {repairContent}</div>
            )}
            {isSpecial && (
              <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 6 }}>특이사항 선택 시 입고 당일 출고완료로 처리됩니다</div>
            )}
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
