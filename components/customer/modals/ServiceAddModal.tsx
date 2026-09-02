'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Contact, Engineer, ServiceForm } from '../types'
import { isCurrentlyEmployed } from '@/lib/engineers'
import { SERVICE_TYPE_COLORS, getCategoryColor } from '@/lib/categoryColors'
import ModalOverlay from '@/components/common/ModalOverlay'
import { toMin, stepTime, computeWorkHours, lunchOverlapHours } from '@/lib/workHours'
import { useFieldErrors, FieldError, errBorder } from '@/components/common/fieldErrors'
import Popover from '@/components/common/Popover'

type Props = {
  deviceId: number | null
  contacts: Contact[]
  engineers: Engineer[]
  currentUserEngineerId: number | null
  isSaving: boolean
  onClose: () => void
  onSave: (form: ServiceForm, engineerIds: number[]) => void
}

const labelStyle = { fontSize: 13, fontWeight: 600, color: '#6b7280', marginBottom: 6, display: 'block' } as const
// 모바일: iOS 자동 확대 방지를 위해 입력 요소 fontSize 16, 터치 타깃 44px
const fieldStyle: CSSProperties = {
  width: '100%', height: 44, padding: '0 12px', border: '1px solid #ebebeb', borderRadius: 6,
  boxSizing: 'border-box', color: '#111827', background: '#fff', outline: 'none', fontSize: 16,
}
const dateFieldStyle: CSSProperties = { ...fieldStyle, colorScheme: 'light' }
const areaStyle: CSSProperties = {
  width: '100%', padding: '10px 12px', border: '1px solid #ebebeb', borderRadius: 6,
  boxSizing: 'border-box', color: '#111827', background: '#fff', outline: 'none', fontSize: 16,
  resize: 'vertical', lineHeight: 1.5,
}
// 작업시간 스테퍼 UI 스타일 (계산 로직은 @/lib/workHours 공용)
const stepBtnStyle: CSSProperties = { width: 30, height: 30, border: '1px solid #ebebeb', borderRadius: 6, background: '#f3f4f6', cursor: 'pointer', fontSize: 13, fontWeight: 700, flexShrink: 0 }
const timeBoxStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 4, background: '#fff', border: '1px solid #ebebeb', borderRadius: 6, padding: '0 6px', height: 44, boxSizing: 'border-box' }

export default function ServiceAddModal({ deviceId, contacts, engineers, currentUserEngineerId, isSaving, onClose, onSave }: Props) {
  const [form, setForm] = useState<ServiceForm>({ visit_date: '', service_notes: '', etc_notes: '', visitor: '', service_type: '신규설치', contact_id: null, is_paid: true, work_hours: '', start_time: '08:30', end_time: '17:30' })
  const [selectedEngineerIds, setSelectedEngineerIds] = useState<number[]>([])
  const [showExtraEngineers, setShowExtraEngineers] = useState(false)
  const [showHint, setShowHint] = useState(false)
  const { errors, setErrors, clearError, validate } = useFieldErrors<'visit_date' | 'service_notes' | 'contact_id' | 'engineers'>()
  const scrollBodyRef = useRef<HTMLDivElement | null>(null)
  const hintRef = useRef<HTMLDivElement | null>(null)

  // 작업시간 자동 계산 (점심 12:00~13:00 공제). 종료<=시작 또는 작업시간<=0 이면 무효.
  const orderValid = toMin(form.end_time) > toMin(form.start_time)
  const lunchHours = lunchOverlapHours(form.start_time, form.end_time)
  const workHours = computeWorkHours(form.start_time, form.end_time)
  const timeValid = orderValid && workHours > 0

  // 안내 팝오버의 바깥 클릭·ESC 닫기는 Popover 가 맡는다.


  useEffect(() => {
    if (deviceId !== null) {
      const today = new Date()
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
      setForm({ visit_date: todayStr, service_notes: '', etc_notes: '', visitor: '', service_type: '신규설치', contact_id: null, is_paid: true, work_hours: '', start_time: '08:30', end_time: '17:30' })
      setSelectedEngineerIds(currentUserEngineerId ? [currentUserEngineerId] : [])
      setShowExtraEngineers(false)
      setErrors({})
    }
  }, [deviceId, currentUserEngineerId])

  if (deviceId === null) return null

  // 현재 재직 중인 엔지니어만 신규 배정 대상으로 노출 (퇴사자 제외)
  const todayStr = new Date().toISOString().slice(0, 10)
  const selectableEngineers = engineers.filter(e => isCurrentlyEmployed(e.resigned_date, todayStr))

  const handleSave = () => {
    // 검증 규칙은 동일. alert 대신 필드별 인라인 에러로 한꺼번에 표시.
    const ok = validate({
      visit_date: form.visit_date.trim() ? null : '방문일자를 입력해주세요',
      service_notes: form.service_notes.trim() ? null : '서비스 내용을 입력해주세요',
      contact_id: form.contact_id ? null : '고객 담당자를 선택해주세요',
      engineers: selectedEngineerIds.length > 0 ? null : '방문 엔지니어를 선택해주세요',
    })
    if (!ok) return
    if (!timeValid) return
    onSave({ ...form, work_hours: String(workHours) }, selectedEngineerIds)
  }

  return (
    <ModalOverlay onClose={onClose} style={{ padding: 12 }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'calc(100vw - 24px)', maxWidth: 560, maxHeight: 'calc(100dvh - 32px)',
          background: '#ffffff', borderRadius: 8, boxSizing: 'border-box',
          boxShadow: '0 20px 60px rgba(0,0,0,0.22)', border: '1px solid #ebebeb',
          animation: 'modal-in 0.18s ease',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* 헤더 — 고정 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', flexShrink: 0, borderBottom: '1px solid #ebebeb' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#111827', letterSpacing: '-0.3px' }}>서비스 레포트 추가</div>
          <button
            onClick={onClose}
            title="닫기"
            onMouseEnter={(e) => (e.currentTarget.style.color = '#111827')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#6b7280')}
            style={{ width: 30, height: 30, borderRadius: '50%', background: '#f3f4f6', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', transition: 'color 0.15s ease' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* 본문 — 스크롤 */}
        <div ref={scrollBodyRef} style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '16px 20px', display: 'grid', gap: 14 }}>
          <div>
            <label style={labelStyle}>서비스 내용</label>
            <textarea value={form.service_notes} onChange={(e) => { setForm(p => ({ ...p, service_notes: e.target.value })); clearError('service_notes') }} placeholder="서비스 내용을 입력하세요" rows={5} style={errors.service_notes ? { ...areaStyle, border: errBorder } : areaStyle} />
            <FieldError message={errors.service_notes} />
          </div>

          <div>
            <label style={labelStyle}>기타사항</label>
            <textarea value={form.etc_notes} onChange={(e) => setForm(p => ({ ...p, etc_notes: e.target.value }))} placeholder="기타사항 (레포트 하단 '기타사항' 칸에 표시)" rows={2} style={areaStyle} />
          </div>

          <div>
            <label style={labelStyle}>서비스 유형</label>
            <div style={{ position: 'relative' }}>
              {form.service_type && (
                <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', width: 9, height: 9, borderRadius: '50%', pointerEvents: 'none', background: getCategoryColor(SERVICE_TYPE_COLORS, form.service_type).dot }} />
              )}
              <select value={form.service_type} onChange={(e) => setForm(p => ({ ...p, service_type: e.target.value }))} style={{ ...fieldStyle, paddingLeft: 32 }}>
                <option value="신규설치">신규 설치</option>
                <option value="이전설치">이전 설치</option>
                <option value="A/S">A/S</option>
                <option value="B/S">B/S</option>
                <option value="교육">교육</option>
                <option value="유선기술지원">유선 기술지원</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12 }}>
            <div>
              <label style={labelStyle}>고객 담당자</label>
              <select value={form.contact_id ?? ''} onChange={(e) => { setForm(p => ({ ...p, contact_id: e.target.value ? Number(e.target.value) : null })); clearError('contact_id') }} style={errors.contact_id ? { ...fieldStyle, border: errBorder } : fieldStyle}>
                <option value="">담당자 선택</option>
                {contacts.map(c => <option key={c.contact_id} value={c.contact_id}>{c.name} {c.position ?? ''}</option>)}
              </select>
              <FieldError message={errors.contact_id} />
            </div>
            <div>
              <label style={labelStyle}>방문일자</label>
              <input type="date" value={form.visit_date} onChange={(e) => { setForm(p => ({ ...p, visit_date: e.target.value })); clearError('visit_date') }} style={errors.visit_date ? { ...dateFieldStyle, border: errBorder } : dateFieldStyle} />
              <FieldError message={errors.visit_date} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
            {/* 유무상 */}
            <div>
              <label style={labelStyle}>유무상</label>
              <div style={{ display: 'flex', background: '#f3f4f6', borderRadius: 6, padding: 3, height: 44, boxSizing: 'border-box' }}>
                <button type="button" onClick={() => setForm(p => ({ ...p, is_paid: true }))}
                  style={{ flex: 1, border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14, fontWeight: 700, background: form.is_paid ? '#ffffff' : 'transparent', color: form.is_paid ? '#111827' : '#9ca3af', transition: 'color 0.15s ease' }}>유상</button>
                <button type="button" onClick={() => setForm(p => ({ ...p, is_paid: false }))}
                  style={{ flex: 1, border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14, fontWeight: 700, background: !form.is_paid ? '#ffffff' : 'transparent', color: !form.is_paid ? '#111827' : '#9ca3af', transition: 'color 0.15s ease' }}>무상</button>
              </div>
            </div>
            {/* 시작시간 */}
            <div>
              <label style={labelStyle}>시작시간</label>
              <div style={timeBoxStyle}>
                <button type="button" onClick={() => setForm(p => ({ ...p, start_time: stepTime(p.start_time, -30) }))} style={stepBtnStyle}>▼</button>
                <span style={{ flex: 1, textAlign: 'center', fontWeight: 700, fontSize: 16 }}>{form.start_time}</span>
                <button type="button" onClick={() => setForm(p => ({ ...p, start_time: stepTime(p.start_time, 30) }))} style={stepBtnStyle}>▲</button>
              </div>
            </div>
            {/* 종료시간 (+ 안내 팝오버) */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#6b7280' }}>종료시간</span>
                <div ref={hintRef} style={{ display: 'flex' }}>
                  <button type="button" onClick={() => setShowHint(s => !s)}
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: showHint ? '#234ea2' : '#9ca3af', display: 'inline-flex', alignItems: 'center' }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                  </button>
                  {/* 모달 본문이 overflowY: auto 라 안에 두면 잘린다 — 포털로 띄운다 */}
                  <Popover
                    anchorRef={hintRef}
                    open={showHint}
                    onClose={() => setShowHint(false)}
                    align="end"
                    gap={6}
                    width={200}
                    style={{ background: '#fff', border: '1px solid #ebebeb', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', padding: '8px 10px', fontSize: 12, fontWeight: 500, color: '#111827', lineHeight: 1.5 }}
                  >
                    이동시간 + 작업 시간으로 기재 부탁드립니다
                  </Popover>
                </div>
              </div>
              <div style={timeBoxStyle}>
                <button type="button" onClick={() => setForm(p => ({ ...p, end_time: stepTime(p.end_time, -30) }))} style={stepBtnStyle}>▼</button>
                <span style={{ flex: 1, textAlign: 'center', fontWeight: 700, fontSize: 16 }}>{form.end_time}</span>
                <button type="button" onClick={() => setForm(p => ({ ...p, end_time: stepTime(p.end_time, 30) }))} style={stepBtnStyle}>▲</button>
              </div>
              {!orderValid ? (
                <div style={{ marginTop: 6, fontSize: 12, color: '#dc2626' }}>종료시간을 시작시간 이후로 설정해주세요</div>
              ) : workHours <= 0 ? (
                <div style={{ marginTop: 6, fontSize: 12, color: '#dc2626' }}>점심시간을 제외하면 작업시간이 0입니다</div>
              ) : (
                <div style={{ marginTop: 6, fontSize: 12, color: '#9ca3af' }}>작업시간 {workHours}h{lunchHours > 0 ? ` (점심 ${lunchHours}h 제외)` : ''}</div>
              )}
            </div>
          </div>

          <div style={{ border: errors.engineers ? errBorder : '1px solid #ebebeb', borderRadius: 8, padding: 14, background: '#f8f9fb' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 7 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', marginRight: 4 }}>방문 엔지니어</span>
              {selectedEngineerIds.map(id => {
                const eng = engineers.find(e => e.engineer_id === id)
                if (!eng) return null
                return (
                  <button key={id} onClick={() => setSelectedEngineerIds(p => p.filter(i => i !== id))}
                    style={{ padding: '7px 12px', borderRadius: 20, border: '1px solid #234ea2', background: '#234ea2', color: '#ffffff', fontWeight: 700, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, minWidth: 96 }}>
                    {eng.name} {eng.position || ''}
                    <span style={{ fontSize: 12, opacity: 0.8 }}>✕</span>
                  </button>
                )
              })}
              <button onClick={() => {
                const willExpand = !showExtraEngineers
                setShowExtraEngineers(willExpand)
                if (willExpand) requestAnimationFrame(() => { const el = scrollBodyRef.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }) })
              }}
                style={{ padding: '7px 12px', borderRadius: 20, border: '1px solid #ebebeb', background: showExtraEngineers ? '#eff4ff' : '#fff', color: '#234ea2', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                + 추가
              </button>
            </div>
            {showExtraEngineers && (
              <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 7, paddingTop: 10, borderTop: '1px solid #ebebeb' }}>
                {selectableEngineers.filter(e => !selectedEngineerIds.includes(e.engineer_id)).map(eng => (
                  <button key={eng.engineer_id} onClick={() => { setSelectedEngineerIds(p => [...p, eng.engineer_id]); setShowExtraEngineers(false); clearError('engineers') }}
                    style={{ padding: '6px 12px', borderRadius: 20, border: '1px solid #ebebeb', background: '#fff', color: '#111827', fontWeight: 600, fontSize: 12, cursor: 'pointer', minWidth: 96, textAlign: 'center' }}>
                    {eng.name} {eng.position || ''}
                  </button>
                ))}
              </div>
            )}
            <FieldError message={errors.engineers} style={{ marginTop: 10 }} />
          </div>
        </div>

        {/* 푸터 — 고정 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 20px', paddingBottom: 'calc(14px + env(safe-area-inset-bottom))', flexShrink: 0, borderTop: '1px solid #ebebeb' }}>
          <button onClick={onClose} style={{ padding: '9px 16px', background: '#fff', color: '#6b7280', borderRadius: 6, border: '1px solid #ebebeb', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>취소</button>
          <button onClick={handleSave} disabled={isSaving || !timeValid}
            onMouseEnter={(e) => { if (!isSaving && timeValid) e.currentTarget.style.background = '#1c3e87' }}
            onMouseLeave={(e) => { if (!isSaving && timeValid) e.currentTarget.style.background = '#234ea2' }}
            style={{ padding: '9px 18px', background: '#234ea2', color: '#fff', borderRadius: 6, border: 'none', cursor: (isSaving || !timeValid) ? 'default' : 'pointer', fontWeight: 700, fontSize: 13, opacity: (isSaving || !timeValid) ? 0.6 : 1, transition: 'background 0.15s ease' }}>
            {isSaving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}
