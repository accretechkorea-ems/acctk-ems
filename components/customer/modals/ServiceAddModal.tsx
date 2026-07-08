'use client'

import { useEffect, useState } from 'react'
import type { Contact, Engineer, ServiceForm } from '../types'
import { isCurrentlyEmployed } from '@/lib/engineers'
import {
  INPUT_BG, INPUT_BORDER, TEXT_MUTED, TEXT_PRIMARY, TEXT_SECONDARY,
  WHITE_BUTTON_BG, WHITE_BUTTON_TEXT, inputStyle, dateInputStyle, textareaStyle, modalOverlayStyle,
} from '../constants'

type Props = {
  deviceId: number | null
  contacts: Contact[]
  engineers: Engineer[]
  currentUserEngineerId: number | null
  isSaving: boolean
  onClose: () => void
  onSave: (form: ServiceForm, engineerIds: number[]) => void
}

const labelStyle = { fontSize: 12, fontWeight: 600, color: TEXT_MUTED, marginBottom: 5, display: 'block' } as const

export default function ServiceAddModal({ deviceId, contacts, engineers, currentUserEngineerId, isSaving, onClose, onSave }: Props) {
  const [form, setForm] = useState<ServiceForm>({ visit_date: '', service_notes: '', etc_notes: '', visitor: '', service_type: '신규설치', contact_id: null, is_paid: true, work_hours: '2' })
  const [selectedEngineerIds, setSelectedEngineerIds] = useState<number[]>([])
  const [showExtraEngineers, setShowExtraEngineers] = useState(false)

  useEffect(() => {
    if (deviceId !== null) {
      const today = new Date()
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
      setForm({ visit_date: todayStr, service_notes: '', etc_notes: '', visitor: '', service_type: '신규설치', contact_id: null, is_paid: true, work_hours: '2' })
      setSelectedEngineerIds(currentUserEngineerId ? [currentUserEngineerId] : [])
      setShowExtraEngineers(false)
    }
  }, [deviceId, currentUserEngineerId])

  if (deviceId === null) return null

  // 현재 재직 중인 엔지니어만 신규 배정 대상으로 노출 (퇴사자 제외)
  const todayStr = new Date().toISOString().slice(0, 10)
  const selectableEngineers = engineers.filter(e => isCurrentlyEmployed(e.resigned_date, todayStr))

  const handleSave = () => {
    if (!form.visit_date.trim()) { alert('방문일자를 입력해주세요.'); return }
    if (!form.service_notes.trim()) { alert('서비스 내용을 입력해주세요.'); return }
    if (!form.contact_id) { alert('고객 담당자를 선택해주세요.'); return }
    if (selectedEngineerIds.length === 0) { alert('방문 엔지니어를 선택해주세요.'); return }
    onSave(form, selectedEngineerIds)
  }

  return (
    <div onClick={onClose} style={{ ...modalOverlayStyle, alignItems: 'flex-start', overflowY: 'auto' }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 620, background: '#ffffff', borderRadius: 20,
          boxShadow: '0 16px 48px rgba(0,0,0,0.22)', border: `1px solid ${INPUT_BORDER}`,
          animation: 'modal-in 0.18s ease',
          display: 'flex', flexDirection: 'column',
          maxHeight: 'calc(100dvh - 40px)',
          margin: 'auto',
        }}
      >
        {/* 헤더 — 고정 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px 16px', flexShrink: 0, borderBottom: `1px solid ${INPUT_BORDER}` }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: TEXT_PRIMARY }}>서비스 레포트 추가</div>
          <button
            onClick={onClose}
            style={{ width: 30, height: 30, borderRadius: '50%', background: '#f4f5f7', border: 'none', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', color: TEXT_SECONDARY }}
          >✕</button>
        </div>

        {/* 본문 — 스크롤 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 24px', display: 'grid', gap: 14 }}>
          <div>
            <label style={labelStyle}>서비스 내용</label>
            <textarea value={form.service_notes} onChange={(e) => setForm(p => ({ ...p, service_notes: e.target.value }))} placeholder="서비스 내용을 입력하세요" rows={5} style={textareaStyle} />
          </div>

          <div>
            <label style={labelStyle}>기타사항</label>
            <textarea value={form.etc_notes} onChange={(e) => setForm(p => ({ ...p, etc_notes: e.target.value }))} placeholder="기타사항 (레포트 하단 '기타사항' 칸에 표시)" rows={2} style={textareaStyle} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1.2fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>서비스 유형</label>
              <select value={form.service_type} onChange={(e) => setForm(p => ({ ...p, service_type: e.target.value }))} style={inputStyle}>
                <option value="신규설치">신규 설치</option>
                <option value="이전설치">이전 설치</option>
                <option value="A/S">A/S</option>
                <option value="B/S">B/S</option>
                <option value="교육">교육</option>
                <option value="유선기술지원">유선 기술지원</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>유무상</label>
              <select value={form.is_paid ? 'true' : 'false'} onChange={(e) => setForm(p => ({ ...p, is_paid: e.target.value === 'true' }))} style={inputStyle}>
                <option value="true">유상</option>
                <option value="false">무상</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>방문일자</label>
              <input type="date" value={form.visit_date} onChange={(e) => setForm(p => ({ ...p, visit_date: e.target.value }))} style={dateInputStyle} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 12, alignItems: 'flex-end' }}>
            <div>
              <label style={labelStyle}>고객 담당자</label>
              <select value={form.contact_id ?? ''} onChange={(e) => setForm(p => ({ ...p, contact_id: e.target.value ? Number(e.target.value) : null }))} style={inputStyle}>
                <option value="">담당자 선택</option>
                {contacts.map(c => <option key={c.contact_id} value={c.contact_id}>{c.name} {c.position ?? ''}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>작업시간 (h)</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: INPUT_BG, border: `1px solid ${INPUT_BORDER}`, borderRadius: 10, padding: '9px 12px' }}>
                <button onClick={() => setForm(p => ({ ...p, work_hours: String(Math.max(0, parseFloat(p.work_hours || '2') - 0.5)) }))} style={{ width: 28, height: 28, border: `1px solid ${INPUT_BORDER}`, borderRadius: 6, background: '#f3f4f6', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>▼</button>
                <span style={{ flex: 1, textAlign: 'center', fontWeight: 700, fontSize: 15 }}>{form.work_hours || '2'}</span>
                <button onClick={() => setForm(p => ({ ...p, work_hours: String(parseFloat(p.work_hours || '2') + 0.5) }))} style={{ width: 28, height: 28, border: `1px solid ${INPUT_BORDER}`, borderRadius: 6, background: '#f3f4f6', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>▲</button>
              </div>
            </div>
          </div>

          <div style={{ border: `1px solid ${INPUT_BORDER}`, borderRadius: 12, padding: 14, background: '#f8f9fb' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: TEXT_MUTED, marginBottom: 10 }}>방문 엔지니어</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
              {selectedEngineerIds.map(id => {
                const eng = engineers.find(e => e.engineer_id === id)
                if (!eng) return null
                return (
                  <button key={id} onClick={() => setSelectedEngineerIds(p => p.filter(i => i !== id))}
                    style={{ padding: '7px 12px', borderRadius: 20, border: '1px solid #234ea2', background: '#234ea2', color: '#ffffff', fontWeight: 700, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                    {eng.name} {eng.position || ''}
                    <span style={{ fontSize: 12, opacity: 0.8 }}>✕</span>
                  </button>
                )
              })}
              <button onClick={() => setShowExtraEngineers(p => !p)}
                style={{ padding: '7px 12px', borderRadius: 20, border: `1px solid ${INPUT_BORDER}`, background: showExtraEngineers ? '#eff4ff' : INPUT_BG, color: '#234ea2', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                + 추가
              </button>
            </div>
            {showExtraEngineers && (
              <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 7, paddingTop: 10, borderTop: `1px solid ${INPUT_BORDER}`, maxHeight: 160, overflowY: 'auto' }}>
                {selectableEngineers.filter(e => !selectedEngineerIds.includes(e.engineer_id)).map(eng => (
                  <button key={eng.engineer_id} onClick={() => { setSelectedEngineerIds(p => [...p, eng.engineer_id]); setShowExtraEngineers(false) }}
                    style={{ padding: '6px 12px', borderRadius: 20, border: `1px solid ${INPUT_BORDER}`, background: INPUT_BG, color: TEXT_PRIMARY, fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                    {eng.name} {eng.position || ''}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 푸터 — 고정 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 24px 20px', flexShrink: 0, borderTop: `1px solid ${INPUT_BORDER}` }}>
          <button onClick={onClose} style={{ padding: '10px 16px', background: '#f4f5f7', color: TEXT_PRIMARY, borderRadius: 10, border: `1px solid ${INPUT_BORDER}`, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>취소</button>
          <button onClick={handleSave} disabled={isSaving} style={{ padding: '10px 20px', background: WHITE_BUTTON_BG, color: WHITE_BUTTON_TEXT, borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, opacity: isSaving ? 0.7 : 1 }}>
            {isSaving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}
