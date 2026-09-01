'use client'

// 대리점용 리드 등록 공개 페이지.
// 로그인 없이 열린다(미들웨어의 공개 경로 목록 참고). 헤더·네비게이션·세션 감시는 붙지 않는다.
// 화면 검증은 편의일 뿐이고 실제 방어는 /api/lead 가 한다.

import { useState, type CSSProperties } from 'react'
import {
  INDUSTRY_GROUPS, INTEREST_PRODUCTS, COMPETITORS, COMPETITOR_OTHER,
  BUDGET_STATUSES, PURCHASE_PERIODS, MAX_LEN, MEETING_NOTE_MIN,
  HONEYPOT_FIELD, EMAIL_RE, DEFAULT_COUNTRY, RESUBMIT_BLOCK_MS,
} from '@/lib/leadOptions'
import { errText, errBorder, FieldError } from '@/components/common/fieldErrors'

const ACCENT = '#234ea2'
// 필수 표시(*)에 쓰는 색. 에러 문구·테두리는 공용 errText / errBorder 를 그대로 쓴다.
const DANGER = errText.color as string
const BORDER = '#ebebeb'
const MUTED = '#6b7280'
const FAINT = '#9ca3af'
const INK = '#111827'
const PAGE_BG = '#fafafa'

type Form = {
  partner_company: string; partner_name: string; partner_contact: string
  customer_company: string; industry: string; products: string
  address: string; city: string; country: string
  interest_product: string; request_note: string
  competitor: string[]; competitor_other: string
  budget_status: string; purchase_period: string; expected_purchase: string
  contact_first_name: string; contact_last_name: string
  contact_dept: string; contact_title: string
  contact_email: string; contact_office_tel: string; contact_mobile: string
  meeting_note: string
}

const emptyForm = (): Form => ({
  partner_company: '', partner_name: '', partner_contact: '',
  customer_company: '', industry: '', products: '',
  address: '', city: '', country: DEFAULT_COUNTRY,
  interest_product: '', request_note: '',
  competitor: [], competitor_other: '',
  budget_status: '', purchase_period: '', expected_purchase: '',
  contact_first_name: '', contact_last_name: '',
  contact_dept: '', contact_title: '',
  contact_email: '', contact_office_tel: '', contact_mobile: '',
  meeting_note: '',
})

type FieldKey = keyof Form

const fieldStyle: CSSProperties = {
  width: '100%', padding: '8px 10px', border: `1px solid ${BORDER}`, borderRadius: 6,
  fontSize: 13, color: INK, background: '#fff', outline: 'none', fontFamily: 'inherit',
}
const errorFieldStyle: CSSProperties = { ...fieldStyle, border: errBorder }
const labelStyle: CSSProperties = { fontSize: 11, fontWeight: 700, color: MUTED, marginBottom: 4, display: 'block' }
const sectionStyle: CSSProperties = {
  background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 8, padding: 16, marginBottom: 12,
}
const sectionTitleStyle: CSSProperties = {
  fontSize: 13, fontWeight: 700, color: INK, marginBottom: 12,
  paddingBottom: 8, borderBottom: `1px solid ${BORDER}`,
}
// 로고 — pdflogo.png 의 가로세로비가 6.383:1 이라 높이에 맞춰 폭을 잡는다. 어긋나면 눌리거나 늘어난다.
const logoStyle = (height: number): CSSProperties => ({
  width: Math.round(height * 6.383), height,
  backgroundImage: 'url(/pdflogo.png)', backgroundSize: 'contain',
  backgroundRepeat: 'no-repeat', backgroundPosition: 'left center', flexShrink: 0,
})

const gridStyle: CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12,
}

export default function LeadPage() {
  const [form, setForm] = useState<Form>(emptyForm)
  const [honeypot, setHoneypot] = useState('')
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [done, setDone] = useState(false)

  const set = (key: FieldKey, v: string | string[]) => {
    setForm(p => ({ ...p, [key]: v }))
    setErrors(p => (p[key] ? { ...p, [key]: undefined } : p))
    setSubmitError('')
  }

  const toggleCompetitor = (c: string) => {
    const next = form.competitor.includes(c)
      ? form.competitor.filter(x => x !== c)
      : [...form.competitor, c]
    set('competitor', next)
    // '기타' 를 껐으면 직접 입력값도 함께 비운다 — 화면에 안 보이는 값이 남아 저장되지 않게.
    if (c === COMPETITOR_OTHER && !next.includes(COMPETITOR_OTHER)) set('competitor_other', '')
  }

  const validate = (): boolean => {
    const e: Partial<Record<FieldKey, string>> = {}
    const need: [FieldKey, string][] = [
      ['partner_company', '회사명을 입력해주세요.'],
      ['partner_name', '등록자 성함을 입력해주세요.'],
      ['customer_company', '회사명을 입력해주세요.'],
      ['industry', '산업군을 선택해주세요.'],
      ['products', '생산품을 입력해주세요.'],
      ['city', '시를 입력해주세요.'],
      ['country', '국가를 입력해주세요.'],
      ['interest_product', '관심 제품을 선택해주세요.'],
      ['budget_status', '예산을 선택해주세요.'],
      ['contact_first_name', '이름을 입력해주세요.'],
      ['contact_last_name', '성을 입력해주세요.'],
      ['contact_email', '이메일을 입력해주세요.'],
      ['contact_mobile', '휴대폰 번호를 입력해주세요.'],
    ]
    for (const [key, msg] of need) if (!String(form[key]).trim()) e[key] = msg

    if (!e.contact_email && !EMAIL_RE.test(form.contact_email.trim())) {
      e.contact_email = '이메일 형식이 올바르지 않습니다.'
    }
    const note = form.meeting_note.trim()
    if (!note) e.meeting_note = '회의록을 입력해주세요.'
    else if (note.length < MEETING_NOTE_MIN) {
      e.meeting_note = `회의록은 ${MEETING_NOTE_MIN}자 이상 입력해주세요. (현재 ${note.length}자)`
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSubmit = async () => {
    setSubmitError('')
    if (!validate()) {
      setSubmitError('입력하지 않은 필수 항목이 있습니다. 표시된 칸을 확인해주세요.')
      return
    }
    // 같은 브라우저에서 짧은 시간 안에 반복 제출하는 것을 막는다.
    try {
      const last = Number(localStorage.getItem('leadSubmittedAt') || 0)
      if (last && Date.now() - last < RESUBMIT_BLOCK_MS) {
        const wait = Math.ceil((RESUBMIT_BLOCK_MS - (Date.now() - last)) / 1000)
        setSubmitError(`방금 등록하셨습니다. ${wait}초 후에 다시 시도해주세요.`)
        return
      }
    } catch { /* localStorage 를 못 쓰는 브라우저면 이 제한만 건너뛴다 */ }

    setSubmitting(true)
    try {
      const res = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, [HONEYPOT_FIELD]: honeypot }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSubmitError(json?.error || '등록에 실패했습니다. 잠시 후 다시 시도해주세요.')
        return
      }
      try { localStorage.setItem('leadSubmittedAt', String(Date.now())) } catch {}
      setDone(true)
    } catch {
      setSubmitError('네트워크 오류로 등록하지 못했습니다. 잠시 후 다시 시도해주세요.')
    } finally {
      setSubmitting(false)
    }
  }

  const Field = ({ label, name, required, type = 'text', placeholder }: {
    label: string; name: FieldKey; required?: boolean; type?: string; placeholder?: string
  }) => (
    <div>
      <label style={labelStyle}>{label}{required && <span style={{ color: DANGER }}> *</span>}</label>
      <input
        type={type}
        value={String(form[name])}
        maxLength={MAX_LEN[name as keyof typeof MAX_LEN]}
        placeholder={placeholder}
        onChange={e => set(name, e.target.value)}
        style={errors[name] ? errorFieldStyle : fieldStyle}
      />
      <FieldError message={errors[name]} style={{ marginTop: 3, fontSize: 11 }} />
    </div>
  )

  if (done) {
    return (
      <div style={{ minHeight: '100vh', background: PAGE_BG, padding: '48px 16px' }}>
        <div style={{ maxWidth: 520, margin: '0 auto', ...sectionStyle, textAlign: 'center', padding: 32 }}>
          <div role="img" aria-label="ACCRETECH KOREA" style={{ ...logoStyle(28), margin: '0 auto 24px' }} />
          <div style={{ fontSize: 13, fontWeight: 700, color: INK, marginBottom: 8 }}>리드가 등록되었습니다.</div>
          <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.7 }}>
            등록해주셔서 감사합니다.<br />
            담당 영업팀이 확인 후 연락드리겠습니다.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: PAGE_BG, padding: '32px 16px 48px' }}>
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        <div style={{ ...sectionStyle, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div role="img" aria-label="ACCRETECH KOREA" style={logoStyle(26)} />
          <div style={{ borderLeft: `1px solid ${BORDER}`, paddingLeft: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: INK }}>파트너 리드 등록</div>
            <div style={{ fontSize: 11, color: FAINT, marginTop: 2 }}>
              <span style={{ color: DANGER }}>*</span> 표시는 필수 입력 항목입니다.
            </div>
          </div>
        </div>

        {/* 허니팟 — 사람에게는 보이지 않는다. 값이 차 있으면 서버가 조용히 버린다. */}
        <div style={{ position: 'absolute', left: -9999, top: -9999, width: 1, height: 1, overflow: 'hidden' }} aria-hidden="true">
          <label htmlFor={HONEYPOT_FIELD}>Website</label>
          <input
            id={HONEYPOT_FIELD} name={HONEYPOT_FIELD} type="text" tabIndex={-1} autoComplete="off"
            value={honeypot} onChange={e => setHoneypot(e.target.value)}
          />
        </div>

        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>파트너사</div>
          <div style={gridStyle}>
            <Field label="회사명" name="partner_company" required />
            <Field label="등록자 성함" name="partner_name" required />
            <Field label="연락처" name="partner_contact" />
          </div>
        </div>

        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>고객사</div>
          <div style={gridStyle}>
            <Field label="회사명" name="customer_company" required />
            <div>
              <label style={labelStyle}>산업군<span style={{ color: DANGER }}> *</span></label>
              <select value={form.industry} onChange={e => set('industry', e.target.value)}
                style={errors.industry ? errorFieldStyle : fieldStyle}>
                <option value="">선택해주세요</option>
                {INDUSTRY_GROUPS.map(g => (
                  g.items.length
                    ? <optgroup key={g.group} label={g.group}>
                        {g.items.map(i => <option key={i} value={`${g.group} - ${i}`}>{`${g.group} - ${i}`}</option>)}
                      </optgroup>
                    : <option key={g.group} value={g.group}>{g.group}</option>
                ))}
              </select>
              <FieldError message={errors.industry} style={{ marginTop: 3, fontSize: 11 }} />
            </div>
            <Field label="생산품" name="products" required />
            <Field label="주소" name="address" />
            <Field label="시" name="city" required />
            <Field label="국가" name="country" required />
          </div>
        </div>

        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>관심 제품</div>
          <div style={gridStyle}>
            <div>
              <label style={labelStyle}>관심 제품<span style={{ color: DANGER }}> *</span></label>
              <select value={form.interest_product} onChange={e => set('interest_product', e.target.value)}
                style={errors.interest_product ? errorFieldStyle : fieldStyle}>
                <option value="">선택해주세요</option>
                {INTEREST_PRODUCTS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <FieldError message={errors.interest_product} style={{ marginTop: 3, fontSize: 11 }} />
            </div>
            <div>
              <label style={labelStyle}>예산<span style={{ color: DANGER }}> *</span></label>
              <select value={form.budget_status} onChange={e => set('budget_status', e.target.value)}
                style={errors.budget_status ? errorFieldStyle : fieldStyle}>
                <option value="">선택해주세요</option>
                {BUDGET_STATUSES.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
              <FieldError message={errors.budget_status} style={{ marginTop: 3, fontSize: 11 }} />
            </div>
            <div>
              <label style={labelStyle}>예상 구매 기간</label>
              <select value={form.purchase_period} onChange={e => set('purchase_period', e.target.value)} style={fieldStyle}>
                <option value="">선택해주세요</option>
                {PURCHASE_PERIODS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>예상 구매 시기</label>
              <input type="date" value={form.expected_purchase}
                onChange={e => set('expected_purchase', e.target.value)}
                style={{ ...fieldStyle, colorScheme: 'light' }} />
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <label style={labelStyle}>경쟁사</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {COMPETITORS.map(c => (
                <label key={c} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.competitor.includes(c)} onChange={() => toggleCompetitor(c)}
                    style={{ width: 14, height: 14, cursor: 'pointer', accentColor: ACCENT }} />
                  <span style={{ fontSize: 12, color: form.competitor.includes(c) ? ACCENT : MUTED, fontWeight: 700 }}>{c}</span>
                </label>
              ))}
            </div>
            {form.competitor.includes(COMPETITOR_OTHER) && (
              <input type="text" value={form.competitor_other} maxLength={MAX_LEN.competitor_other}
                placeholder="경쟁사를 입력해주세요"
                onChange={e => set('competitor_other', e.target.value)}
                style={{ ...fieldStyle, marginTop: 8 }} />
            )}
          </div>

          <div style={{ marginTop: 12 }}>
            <label style={labelStyle}>요청사항</label>
            <textarea value={form.request_note} maxLength={MAX_LEN.request_note} rows={3}
              onChange={e => set('request_note', e.target.value)}
              style={{ ...fieldStyle, resize: 'vertical', lineHeight: 1.7 }} />
          </div>
        </div>

        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>고객 정보</div>
          <div style={gridStyle}>
            <Field label="이름" name="contact_first_name" required />
            <Field label="성" name="contact_last_name" required />
            <Field label="부서" name="contact_dept" />
            <Field label="직위" name="contact_title" />
            <Field label="이메일" name="contact_email" required type="email" />
            <Field label="회사번호" name="contact_office_tel" />
            <Field label="휴대폰 번호" name="contact_mobile" required />
          </div>
        </div>

        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>미팅 노트</div>
          <label style={labelStyle}>회의록<span style={{ color: DANGER }}> *</span></label>
          <textarea value={form.meeting_note} maxLength={MAX_LEN.meeting_note} rows={6}
            placeholder={`고객과 나눈 내용을 ${MEETING_NOTE_MIN}자 이상 적어주세요.`}
            onChange={e => set('meeting_note', e.target.value)}
            style={{ ...(errors.meeting_note ? errorFieldStyle : fieldStyle), resize: 'vertical', lineHeight: 1.7 }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
            <span style={{ fontSize: 11, color: DANGER }}>{errors.meeting_note ?? ''}</span>
            <span style={{ fontSize: 11, color: FAINT }}>{form.meeting_note.trim().length} / {MEETING_NOTE_MIN}자 이상</span>
          </div>
        </div>

        {submitError && (
          <div style={{ ...sectionStyle, border: errBorder, color: DANGER, fontSize: 12, fontWeight: 700 }}>
            {submitError}
          </div>
        )}

        <button onClick={handleSubmit} disabled={submitting}
          style={{
            width: '100%', padding: '12px 0', border: 'none', borderRadius: 8,
            background: submitting ? FAINT : ACCENT, color: '#fff',
            fontSize: 13, fontWeight: 700, cursor: submitting ? 'default' : 'pointer', fontFamily: 'inherit',
          }}>
          {submitting ? '등록 중...' : '리드 등록'}
        </button>
      </div>
    </div>
  )
}
