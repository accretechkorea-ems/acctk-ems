'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import type { Repair, RepairStatus, RepairQuote } from '@/hooks/useRepairs'
import ModalOverlay from '@/components/common/ModalOverlay'
import { useConfirm } from '@/components/common/ConfirmDialog'
import { useToast } from '@/components/common/Toast'
import { useFieldErrors, FieldError, errBorder } from '@/components/common/fieldErrors'

/**
 * 수리품 수정 모달.
 *
 * ── 특이사항(special_type)과 상태의 관계 (신 사양) ──
 * 특이사항은 이제 별도 컬럼 special_type 에 저장하고, 자유 메모는 repair_content 로 분리한다.
 * 특이사항 선택 시 상태는 아래처럼 정해지며(onSelectSpecial), 메모만 입력하면 상태를 바꾸지 않는다.
 *   본사수리     → status '수리중' + hq_requested_at(발송일), shipped_date = null   (본사에 나가 있음)
 *     └ 본사 복귀 → hq_returned_at(복귀일) + status '출고대기' → 이후 기존 흐름대로 출고완료
 *   수리불가     → status '출고완료' (종료)
 *   수리진행안함 → status '출고완료' (종료)
 *   (없음/메모)  → 상태 변경 없음
 *
 * ── buildPatch: 상태 기준 타임스탬프 정리 (특이사항 강제분기 제거) ──
 * "되돌아간 상태 이후 단계의 타임스탬프는 전부 null" 로 정리한다. 전진 단계 시각
 * (repair_started_at·repair_done_at)은 이번 편집에서 실제로 그 단계를 넘었을 때만 오늘 날짜를 기록한다.
 *   최종 '입고'     → started/done/shipped 전부 null · hq_requested_at/hq_returned_at 전부 null(발송 전)
 *   최종 '수리중'   → done/shipped = null, started: 이번에 넘었으면 오늘, 아니면 기존값 · hq_returned_at = null(본사 미복귀)
 *   최종 '출고대기' → shipped = null, started·done: 이번에 넘은 단계만 오늘, 아니면 기존값 · hq_requested_at/hq_returned_at 유지
 *   최종 '출고완료' → started·done: 이번에 넘은 단계만 오늘, shipped = 폼 입력값 · hq 날짜 유지
 * special_type='본사수리' 일 때만 hq_requested_at/hq_returned_at 를 유지·기록하고, 그 외엔 null 로 비운다.
 * hq 날짜도 shipped_date 와 같은 규칙으로 status 에 맞춰 정리한다(되돌린 단계 이후 날짜는 삭제).
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
const numKR = (n: number) => Math.round(n).toLocaleString('ko-KR')

type Props = {
  repair: Repair | null
  isSaving: boolean
  onClose: () => void
  onSave: (repairId: number, patch: Record<string, unknown>) => Promise<boolean> // 저장 성공 여부 반환
  onDelete: (r: Repair) => void
}

const labelStyle: CSSProperties = { fontSize: 13, fontWeight: 600, color: '#6b7280', marginBottom: 6, display: 'block' }
const fieldStyle: CSSProperties = {
  width: '100%', padding: '11px 12px', border: '1px solid #ebebeb', borderRadius: 6,
  boxSizing: 'border-box', color: '#111827', background: '#fff', outline: 'none', fontSize: 14,
}
// 레이아웃 헬퍼: 2열 그리드 / 섹션 제목(작은 회색) / 섹션 구분선(얇은 상단선).
const twoCol: CSSProperties = { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12 }
const threeCol: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }
const sectionDivider: CSSProperties = { borderTop: '1px solid #ebebeb', paddingTop: 16 }

type PatchForm = {
  itemType: Category; receivedDate: string; customerName: string; productType: string; serialNumber: string
  status: RepairStatus; shippedDate: string; specialType: string; repairContent: string
  hqRequestedAt: string; hqReturnedAt: string; quoteId: number | null
}

// 최종 status 기준 타임스탬프 정리 + 특이사항/본사수리 메타 기록.
function buildPatch(repair: Repair, form: PatchForm): Record<string, unknown> {
  const today = todayStr()
  const isHq = form.specialType === '본사수리'
  const patch: Record<string, unknown> = {
    item_type: form.itemType,
    received_date: form.receivedDate,
    customer_name: form.customerName.trim(),
    product_type: form.productType.trim() || null,
    serial_number: form.serialNumber.trim() || null,
    repair_content: form.repairContent.trim() || null,   // 자유 메모
    special_type: form.specialType || null,              // 특이사항 유형
    // hq 발송/복귀일은 본사수리일 때만 유지. 다른 유형/없음으로 바꾸면 비운다.
    hq_requested_at: isHq ? (form.hqRequestedAt || null) : null,
    hq_returned_at: isHq ? (form.hqReturnedAt || null) : null,
    quote_id: form.quoteId,                              // 연결된 견적서(없으면 null)
    status: form.status,
    repair_started_at: repair.repair_started_at,
    repair_done_at: repair.repair_done_at,
    shipped_date: repair.shipped_date,
  }
  // 상태 index (입고0 / 수리중1 / 출고대기2 / 출고완료3). handleSave 와 동일한 STATUSES 맵 재사용.
  const origIdx = STATUSES.indexOf(repair.status)
  const newIdx = STATUSES.indexOf(form.status)
  // 이번 편집에서 실제로 그 단계를 넘어섰을 때만 오늘 날짜 기록. 아니면 기존 값 유지(null이면 null).
  const startedAt = (origIdx < 1 && newIdx >= 1) ? today : repair.repair_started_at
  const doneAt = (origIdx < 2 && newIdx >= 2) ? today : repair.repair_done_at
  // 본사수리 발송/복귀일도 status 로 정리한다(shipped_date 와 같은 규칙 — 되돌린 단계 이후 날짜는 삭제).
  //   입고: 아직 발송 전 → 둘 다 null / 수리중: 본사에 나가 있음 → 복귀일 삭제 / 출고대기·출고완료: 둘 다 유지.
  //   (비 본사수리는 위 base 에서 이미 둘 다 null 이므로 아래 null 대입은 무해.)
  if (form.status === '입고') {
    patch.repair_started_at = null; patch.repair_done_at = null; patch.shipped_date = null
    patch.hq_requested_at = null; patch.hq_returned_at = null
  } else if (form.status === '수리중') {
    patch.repair_done_at = null; patch.shipped_date = null
    patch.repair_started_at = startedAt
    patch.hq_returned_at = null
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
  const toast = useToast()
  const router = useRouter()
  const { errors, setErrors, clearError, validate } = useFieldErrors<'customerName' | 'receivedDate'>()
  const [itemType, setItemType] = useState<Category>('게이지')
  const [receivedDate, setReceivedDate] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [productType, setProductType] = useState('')
  const [serialNumber, setSerialNumber] = useState('')
  const [status, setStatus] = useState<RepairStatus>('입고')
  const [shippedDate, setShippedDate] = useState('')
  const [specialType, setSpecialType] = useState('')     // 특이사항(special_type): '' | 본사수리 | 수리불가 | 수리진행안함
  const [repairContent, setRepairContent] = useState('') // 자유 메모(repair_content)
  const [hqRequestedAt, setHqRequestedAt] = useState('') // 본사 발송일
  const [hqReturnedAt, setHqReturnedAt] = useState('')   // 본사 복귀일
  const [quoteId, setQuoteId] = useState<number | null>(null)         // 연결된 견적서
  const [linkedSummary, setLinkedSummary] = useState<RepairQuote | null>(null) // 연결된 견적 요약

  useEffect(() => {
    if (!repair) return
    setItemType((repair.item_type === '앰프' ? '앰프' : '게이지'))
    setReceivedDate(repair.received_date ?? '')
    setCustomerName(repair.customer_name ?? '')
    setProductType(repair.product_type ?? '')
    setSerialNumber(repair.serial_number ?? '')
    setStatus(repair.status)
    setShippedDate(repair.shipped_date ?? '')
    setSpecialType(repair.special_type ?? '')
    setRepairContent(repair.repair_content ?? '')
    setHqRequestedAt(repair.hq_requested_at ?? '')
    setHqReturnedAt(repair.hq_returned_at ?? '')
    setQuoteId(repair.quote_id ?? null)
    setLinkedSummary(null)
    setErrors({})
    // 연결된 견적 요약은 quotes RLS 우회를 위해 API 로 조회(20팀 견적만).
    if (repair.quote_id != null) {
      let cancelled = false
      fetch(`/api/repair-quotes?quote_id=${repair.quote_id}`)
        .then(r => r.json()).then(j => { if (!cancelled) setLinkedSummary(j.quote ?? null) })
        .catch(() => { /* 요약 없으면 아래 폴백 UI */ })
      return () => { cancelled = true }
    }
  }, [repair])

  if (!repair) return null

  const isShipped = status === '출고완료'
  const isHq = specialType === '본사수리'

  const unlinkQuote = () => { setQuoteId(null); setLinkedSummary(null) }

  // 폼이 원본 repair 와 달라졌는지(미저장 변경). 견적서로 넘어가는 필드 + 나머지 편집 필드 전부 비교.
  const hasUnsavedChanges = (): boolean => {
    const initItemType = repair.item_type === '앰프' ? '앰프' : '게이지'
    return (
      itemType !== initItemType ||
      receivedDate !== (repair.received_date ?? '') ||
      customerName !== (repair.customer_name ?? '') ||
      productType !== (repair.product_type ?? '') ||
      serialNumber !== (repair.serial_number ?? '') ||
      status !== repair.status ||
      shippedDate !== (repair.shipped_date ?? '') ||
      specialType !== (repair.special_type ?? '') ||
      repairContent !== (repair.repair_content ?? '') ||
      hqRequestedAt !== (repair.hq_requested_at ?? '') ||
      hqReturnedAt !== (repair.hq_returned_at ?? '') ||
      quoteId !== (repair.quote_id ?? null)
    )
  }

  // 이 수리 건으로 견적서 작성 → /quote 로 이동(현재 폼 값 prefill). 저장 시 repairs.quote_id 자동 연결.
  // 이미 연결돼 있으면 대체 확인. 미저장 변경이 있으면 저장 후 이동(저장 실패 시 이동 안 함).
  const onCreateQuote = async () => {
    if (quoteId != null) {
      const ok = await confirmDialog({ title: '견적서 새로 작성', message: '이미 견적서가 연결되어 있습니다. 새로 작성하면 기존 연결이 대체됩니다.', confirmText: '계속', variant: 'default' })
      if (!ok) return
    }
    // 미저장 변경 가드: 확인 → 저장 → 성공 시에만 이동.
    if (hasUnsavedChanges()) {
      const ok = await confirmDialog({ title: '저장되지 않은 변경', message: '저장하지 않은 변경사항이 있습니다.\n저장 후 견적서 작성으로 이동합니다.', confirmText: '저장 후 이동', variant: 'default' })
      if (!ok) return
      const ok0 = validate({
        customerName: customerName.trim() ? null : '회사명을 입력해주세요',
        receivedDate: receivedDate ? null : '입고일을 입력해주세요',
      })
      if (!ok0) return
      const saved = await onSave(repair.repair_id, buildPatch(repair, { itemType, receivedDate, customerName, productType, serialNumber, status, shippedDate, specialType, repairContent, hqRequestedAt, hqReturnedAt, quoteId }))
      if (!saved) return // 저장 실패 → 이동하지 않음(에러 토스트는 onSave 에서 표시)
    }
    // prefill 은 현재 폼 값(= 방금 저장된 값) 기준.
    const params = new URLSearchParams({ repair_id: String(repair.repair_id) })
    if (customerName.trim()) params.set('customer', customerName.trim())
    if (productType.trim()) params.set('product', productType.trim())
    if (serialNumber.trim()) params.set('serial', serialNumber.trim())
    router.push(`/quote?${params.toString()}`)
  }

  // 연결된 견적서 PDF 열기 — /api/repair-quotes?pdf=. 서버가 20팀·연결 여부를 검사(임의 견적 차단).
  const openQuotePdf = async () => {
    if (quoteId == null) return
    const res = await fetch(`/api/repair-quotes?pdf=${quoteId}`)
    const json = await res.json().catch(() => ({}))
    if (res.ok && json.url) window.open(json.url, '_blank')
    else toast.error(json.error === 'No PDF' ? '견적서 PDF가 없습니다' : json.error === 'Forbidden' ? '견적서 열람 권한이 없습니다' : '견적서를 열 수 없습니다')
  }
  // 특이사항 select 는 special_type 컬럼 기준. 목록에 없는 값은 (없음)으로 표시.
  const selectValue = (SPECIAL_OPTIONS as readonly string[]).includes(specialType) ? specialType : ''

  // 특이사항 선택 → 신 사양대로 상태 결정. 자유 메모(repair_content)는 상태를 바꾸지 않는다.
  const onSelectSpecial = (v: string) => {
    setSpecialType(v)
    if (v === '본사수리') {
      // 본사 발송: 수리중 + 발송일(기본 오늘), 출고일 없음
      setStatus('수리중'); setShippedDate('')
      setHqRequestedAt(prev => prev || todayStr())
    } else if (v === '수리불가' || v === '수리진행안함') {
      // 종료: 출고완료
      setStatus('출고완료'); setShippedDate(prev => prev || todayStr())
    }
    // v === '' : 상태 그대로 (메모/일반 건과 동일)
  }

  // 본사 복귀 처리(모달): 복귀일=오늘 + 출고대기. 이후 기존 흐름대로 출고완료 진행 가능.
  const onHqReturnFill = () => {
    setHqReturnedAt(todayStr()); setStatus('출고대기'); setShippedDate('')
  }

  const handleSave = async () => {
    const ok0 = validate({
      customerName: customerName.trim() ? null : '회사명을 입력해주세요',
      receivedDate: receivedDate ? null : '입고일을 입력해주세요',
    })
    if (!ok0) return
    const origIdx = STATUSES.indexOf(repair.status)
    const newIdx = STATUSES.indexOf(status)
    if (newIdx < origIdx) {
      const ok = await confirmDialog({ title: '상태 되돌리기', message: '상태를 되돌리면 이후 단계의 기록(수리 완료일, 출고일, 본사 복귀일 등)이 삭제됩니다. 계속할까요?', confirmText: '계속', variant: 'default' })
      if (!ok) return
    }
    onSave(repair.repair_id, buildPatch(repair, { itemType, receivedDate, customerName, productType, serialNumber, status, shippedDate, specialType, repairContent, hqRequestedAt, hqReturnedAt, quoteId }))
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 640, background: '#ffffff', borderRadius: 8, padding: 24,
          boxShadow: '0 20px 60px rgba(0,0,0,0.22)', border: '1px solid #ebebeb', animation: 'modal-in 0.18s ease',
          display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 40px)',
        }}
      >
        {/* 헤더 — 제목 + 닫기(X). 삭제는 푸터 좌측 하단으로 이동. */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, flexShrink: 0 }}>
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

        {/* 본문 — 구분선으로 세 묶음(기본/진행/견적서) 구분 + 접이식 메모. 넘치면 이 영역만 스크롤. */}
        <div style={{ display: 'grid', gap: 18, overflowY: 'auto', flex: '1 1 auto', minHeight: 0 }}>
          {/* 기본 묶음 */}
          <div>
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={twoCol}>
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
              <div style={threeCol}>
                <div>
                  <label style={labelStyle}>회사명</label>
                  <input value={customerName} onChange={e => { setCustomerName(e.target.value); clearError('customerName') }} placeholder="회사명" style={errors.customerName ? { ...fieldStyle, border: errBorder } : fieldStyle} />
                  <FieldError message={errors.customerName} />
                </div>
                <div>
                  <label style={labelStyle}>제품 구분</label>
                  <input value={productType} onChange={e => setProductType(e.target.value)} placeholder="예: E-TS-4182-P6" style={fieldStyle} />
                </div>
                <div>
                  <label style={labelStyle}>시리얼번호</label>
                  <input value={serialNumber} onChange={e => setSerialNumber(e.target.value)} placeholder="시리얼번호" style={fieldStyle} />
                </div>
              </div>
            </div>
          </div>

          {/* 진행 묶음 */}
          <div style={sectionDivider}>
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={threeCol}>
                <div>
                  <label style={labelStyle}>상태</label>
                  <select value={status} onChange={e => setStatus(e.target.value as RepairStatus)} style={{ ...fieldStyle }}>
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>특이사항</label>
                  <select value={selectValue} onChange={e => onSelectSpecial(e.target.value)} style={fieldStyle}>
                    <option value="">(없음)</option>
                    {SPECIAL_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>출고일</label>
                  <input type="date" disabled={!isShipped}
                    value={isShipped ? shippedDate : ''}
                    onChange={e => setShippedDate(e.target.value)}
                    style={{ ...fieldStyle, colorScheme: 'light', background: !isShipped ? '#f3f4f6' : '#fff', color: !isShipped ? '#9ca3af' : '#111827', cursor: !isShipped ? 'not-allowed' : 'auto' }} />
                </div>
              </div>
            </div>
            {/* 본사 발송/복귀 (본사수리일 때만) — max-height+opacity 로 부드럽게 펼침/접힘.
                그리드 밖에 두고 marginTop 까지 함께 트랜지션해, 접히면 여백까지 사라져 출렁임이 없다. */}
            <div style={{ overflow: 'hidden', maxHeight: isHq ? 120 : 0, opacity: isHq ? 1 : 0, marginTop: isHq ? 12 : 0, transition: 'max-height 0.22s ease-out, opacity 0.22s ease-out, margin-top 0.22s ease-out' }}>
              <div style={{ ...twoCol, gap: 10, padding: 10, background: '#f5f3ff', border: '1px solid #ebebeb', borderRadius: 6 }}>
                <div>
                  <label style={labelStyle}>본사 발송일</label>
                  <input type="date" value={hqRequestedAt} onChange={e => setHqRequestedAt(e.target.value)}
                    style={{ ...fieldStyle, colorScheme: 'light' }} />
                </div>
                <div>
                  <label style={labelStyle}>본사 복귀일</label>
                  {hqReturnedAt ? (
                    <input type="date" value={hqReturnedAt} onChange={e => setHqReturnedAt(e.target.value)}
                      style={{ ...fieldStyle, colorScheme: 'light' }} />
                  ) : (
                    <button type="button" onClick={onHqReturnFill}
                      style={{ ...fieldStyle, cursor: 'pointer', textAlign: 'center', color: '#7c3aed', fontWeight: 700, background: '#fff' }}>
                      본사 복귀 (출고대기)
                    </button>
                  )}
                </div>
              </div>
            </div>
            {/* 메모(repair_content) — 항상 표시, 본사 블록 아래 */}
            <div style={{ marginTop: 12 }}>
              <label style={labelStyle}>메모</label>
              <textarea value={repairContent} onChange={e => setRepairContent(e.target.value)} placeholder="자유 메모 (선택)" rows={3}
                style={{ ...fieldStyle, resize: 'vertical', lineHeight: 1.5, fontFamily: 'inherit' }} />
            </div>
          </div>

          {/* ── 견적서 ── 한 줄: 왼쪽 = 작성 버튼(또는 연결된 견적 정보), 오른쪽 = 견적서 보기 / 연결 해제 */}
          <div style={sectionDivider}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {linkedSummary ? (
                <>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#234ea2', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {linkedSummary.quote_number}
                      {linkedSummary.company_name && <span style={{ fontSize: 12, fontWeight: 500, color: '#6b7280', marginLeft: 6 }}>{linkedSummary.company_name}</span>}
                    </div>
                    <div style={{ fontSize: 13, color: '#111827', marginTop: 2 }}>청구 금액 <b>₩{numKR(linkedSummary.total_supply ?? 0)}</b></div>
                  </div>
                  <button type="button" onClick={openQuotePdf}
                    style={{ padding: '7px 12px', border: '1px solid #ebebeb', borderRadius: 6, background: '#fff', color: '#6b7280', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>견적서 보기</button>
                  <button type="button" onClick={unlinkQuote}
                    style={{ padding: '7px 12px', border: '1px solid #fecdd3', borderRadius: 6, background: '#fff', color: '#be123c', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>연결 해제</button>
                </>
              ) : quoteId != null ? (
                // 연결은 돼 있으나 요약을 못 읽음(권한/네트워크). PDF·해제는 가능.
                <>
                  <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: '#9ca3af' }}>견적 #{quoteId} · 요약을 불러올 수 없습니다</div>
                  <button type="button" onClick={openQuotePdf}
                    style={{ padding: '7px 12px', border: '1px solid #ebebeb', borderRadius: 6, background: '#fff', color: '#6b7280', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>견적서 보기</button>
                  <button type="button" onClick={unlinkQuote}
                    style={{ padding: '7px 12px', border: '1px solid #fecdd3', borderRadius: 6, background: '#fff', color: '#be123c', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>연결 해제</button>
                </>
              ) : specialType !== '수리불가' && specialType !== '수리진행안함' ? (
                // 미연결 + 견적 가능(본사수리/국내수리): 작은 작성 버튼만 왼쪽에.
                <button type="button" onClick={onCreateQuote}
                  style={{ padding: '7px 12px', border: 'none', borderRadius: 6, background: '#234ea2', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  + 견적서 작성
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {/* 푸터 — 삭제(좌측 하단) · 취소/저장(우측). 삭제는 저장과 떨어뜨려 오조작 방지. */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 18, flexShrink: 0 }}>
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
