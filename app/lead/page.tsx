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
  contact_name: string
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
  contact_name: '',
  contact_dept: '', contact_title: '',
  contact_email: '', contact_office_tel: '', contact_mobile: '',
  meeting_note: '',
})

type FieldKey = keyof Form

const fieldStyle: CSSProperties = {
  width: '100%', padding: '8px 10px', border: `1px solid ${BORDER}`, borderRadius: 6,
  fontSize: 13, color: INK, background: '#fff', outline: 'none', fontFamily: 'inherit',
  // 포커스 표시는 아래 <style> 의 .lead-page 규칙이 담당한다(견적·재고·고객사 상세와 같은 값).
  transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
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

// 안내 문구 문단. 문단 사이를 띄워 읽기 쉽게 한다.
// wordBreak keep-all — 한글은 기본값이면 글자 단위로 접혀 '준비하 / 겠습니다' 처럼 낱말이 쪼개진다.
// 어절(띄어쓰기) 단위로 접히게 해 좁은 화면에서도 읽기 흐름이 끊기지 않게 한다.
const introParaStyle: CSSProperties = { fontSize: 12, color: MUTED, lineHeight: 1.8, marginBottom: 12, wordBreak: 'keep-all' }
// 본문 최대 폭 — 한 줄이 너무 길면 눈이 다음 줄을 찾기 어렵다.
// 12px 한글 기준 한 줄 약 50자 남짓이 되도록 잡았다.
const INTRO_TEXT_MAX = 640

// 주버튼 hover 색 — 프로젝트 전역에서 쓰는 액센트의 진한 값.
const ACCENT_HOVER = '#1c3e87'
// 보조버튼 hover 배경 — 기존 중립 배경 토큰.
const NEUTRAL_BG = '#f3f4f6'

// 포커스 표시. 견적 화면(.q-input) · 재고 화면(.inv-input) · 고객사 상세가 모두 같은 값을 쓰고 있어
// 그대로 가져왔다. .lead-page 하위로 한정해 다른 화면에는 영향이 없다.
// 폭에 따라 열 수가 바뀌는 곳은 인라인 스타일로 못 쓰므로 여기 모아 둔다.
//   .lead-grid  — 폼 입력칸. 좁은 화면 1열 → 640px 2열 → 1024px 3열.
//   .lead-intro — 안내 카드. 1024px 이상에서 좌(로고·타이틀) / 우(문구) 2단.
const INTERACTION_CSS = `
  .lead-page input:focus, .lead-page textarea:focus, .lead-page select:focus {
    border-color: #234ea2 !important;
    box-shadow: 0 0 0 3px rgba(35,78,162,0.10) !important;
    outline: none;
  }
  .lead-grid { display: grid; grid-template-columns: 1fr; gap: 12px; }
  /* 위 맞춤 — 로고 윗선과 오른쪽 첫 문단 윗선이 맞아야 정돈돼 보인다(가운데 맞춤은 로고가 처진다). */
  .lead-intro { display: grid; grid-template-columns: 1fr; gap: 16px; align-items: start; }
  @media (min-width: 640px) {
    .lead-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @media (min-width: 1024px) {
    .lead-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    /* 배너를 반으로 나누되 왼쪽 타이틀이 한 줄에 들어가는 것을 우선한다.
       nowrap 으로 못 접게 하고, 열 폭은 그 한 줄이 들어갈 만큼만 왼쪽에 더 준다. */
    .lead-intro { grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); gap: 20px; }
    .lead-intro-title { white-space: nowrap; }
  }
`

// 입력 한 칸. 반드시 LeadPage 바깥에 둔다 —
// 컴포넌트 함수 안에서 정의하면 렌더마다 새 타입이 되어 React 가 기존 DOM 을 버리고 새로 만든다.
// 그러면 한 글자 입력할 때마다 포커스가 사라지고 한글은 자모 하나만 남는다.
function Field({ label, name, value, error, onChange, required, type = 'text', placeholder }: {
  label: string; name: FieldKey; value: string; error?: string
  onChange: (key: FieldKey, v: string) => void
  required?: boolean; type?: string; placeholder?: string
}) {
  return (
    <div>
      <label style={labelStyle}>{label}{required && <span style={{ color: DANGER }}> *</span>}</label>
      <input
        type={type}
        value={value}
        maxLength={MAX_LEN[name as keyof typeof MAX_LEN]}
        placeholder={placeholder}
        onChange={e => onChange(name, e.target.value)}
        style={error ? errorFieldStyle : fieldStyle}
      />
      <FieldError message={error} style={{ marginTop: 3, fontSize: 11 }} />
    </div>
  )
}

export default function LeadPage() {
  const [form, setForm] = useState<Form>(emptyForm)
  const [honeypot, setHoneypot] = useState('')
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [done, setDone] = useState(false)

  /** 완료 화면에서 이어서 등록할 때 — 새로고침 없이 상태만 처음으로 되돌린다. */
  const resetForm = () => {
    setForm(emptyForm())   // 국가는 emptyForm 이 기본값(South Korea)으로 채운다
    setHoneypot('')
    setErrors({})
    setSubmitError('')
    setDone(false)
    window.scrollTo({ top: 0 })
  }

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
      ['contact_name', '이름을 입력해주세요.'],
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


  if (done) {
    return (
      <div className="lead-page" style={{ minHeight: '100vh', background: PAGE_BG, padding: '48px 16px' }}>
        <style>{INTERACTION_CSS}</style>
        <div style={{ maxWidth: 520, margin: '0 auto', ...sectionStyle, textAlign: 'center', padding: 32 }}>
          <div role="img" aria-label="ACCRETECH KOREA" style={{ ...logoStyle(28), margin: '0 auto 24px' }} />
          <div style={{ fontSize: 13, fontWeight: 700, color: INK, marginBottom: 8 }}>리드가 등록되었습니다.</div>
          <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.7 }}>
            등록해주셔서 감사합니다.<br />
            담당 영업팀이 확인 후 연락드리겠습니다.
          </div>
          <button
            onClick={resetForm}
            onMouseEnter={e => (e.currentTarget.style.background = NEUTRAL_BG)}
            onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
            style={{
              marginTop: 20, padding: '9px 16px', background: '#fff', color: MUTED,
              border: `1px solid ${BORDER}`, borderRadius: 6, cursor: 'pointer',
              fontSize: 13, fontWeight: 600, fontFamily: 'inherit', transition: 'background 0.15s ease',
            }}
          >추가 등록하기</button>
        </div>
      </div>
    )
  }

  return (
    <div className="lead-page" style={{ minHeight: '100vh', background: PAGE_BG, padding: '32px 16px 48px' }}>
      <style>{INTERACTION_CSS}</style>
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        {/* 안내 — 좌(로고·타이틀) / 우(문구) 2단. 좁아지면 .lead-intro 가 1열로 접혀 위아래로 쌓인다. */}
        <div style={sectionStyle}>
          <div className="lead-intro">
            <div>
              <div role="img" aria-label="ACCRETECH KOREA" style={logoStyle(30)} />
              <div className="lead-intro-title" style={{ fontSize: 16, fontWeight: 800, color: INK, marginTop: 12, lineHeight: 1.45, letterSpacing: '-0.3px', wordBreak: 'keep-all' }}>
                ACCRETECH KOREA <span style={{ color: FAINT, fontWeight: 400 }}>|</span> 계측사업부 영업 지원 시스템
              </div>
            </div>
            <div style={{ maxWidth: INTRO_TEXT_MAX }}>
              <div style={{ ...introParaStyle, color: INK, fontWeight: 700, marginBottom: 10 }}>
                아크레텍코리아 계측사업부<br />파트너사 여러분께
              </div>
              <div style={introParaStyle}>
                현장에서 만나신 고객 정보를 등록해 주십시오.<br />
                담당 영업팀이 바로 확인하고 필요한 지원을 준비하겠습니다.
              </div>
              <div style={{ ...introParaStyle, marginBottom: 0 }}>늘 함께해 주셔서 감사합니다.</div>
            </div>
          </div>
        </div>

        <div>
          {/* 허니팟 — 사람에게는 보이지 않는다. 값이 차 있으면 서버가 조용히 버린다. */}
          <div style={{ position: 'absolute', left: -9999, top: -9999, width: 1, height: 1, overflow: 'hidden' }} aria-hidden="true">
            <label htmlFor={HONEYPOT_FIELD}>Website</label>
            <input
              id={HONEYPOT_FIELD} name={HONEYPOT_FIELD} type="text" tabIndex={-1} autoComplete="off"
              value={honeypot} onChange={e => setHoneypot(e.target.value)}
            />
        </div>

        <div style={{ fontSize: 11, color: FAINT, margin: '0 2px 8px' }}>
          <span style={{ color: DANGER }}>*</span> 표시는 필수 입력 항목입니다.
        </div>

        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>파트너사</div>
          <div className="lead-grid">
            <Field label="회사명" name="partner_company" value={form.partner_company} error={errors.partner_company} onChange={set} required />
            <Field label="등록자 성함" name="partner_name" value={form.partner_name} error={errors.partner_name} onChange={set} required />
            <Field label="연락처" name="partner_contact" value={form.partner_contact} error={errors.partner_contact} onChange={set} />
          </div>
        </div>

        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>고객사</div>
          <div className="lead-grid">
            <Field label="회사명" name="customer_company" value={form.customer_company} error={errors.customer_company} onChange={set} required />
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
            <Field label="생산품" name="products" value={form.products} error={errors.products} onChange={set} required />
            <Field label="주소" name="address" value={form.address} error={errors.address} onChange={set} />
            <Field label="시" name="city" value={form.city} error={errors.city} onChange={set} required />
            <Field label="국가" name="country" value={form.country} error={errors.country} onChange={set} required />
          </div>
        </div>

        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>관심 제품</div>
          <div className="lead-grid">
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

          <div>
            <label style={labelStyle}>경쟁사</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {COMPETITORS.map(c => (
                <label key={c} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', transition: 'color 0.15s ease' }}>
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
          <div className="lead-grid">
            <Field label="이름" name="contact_name" value={form.contact_name} error={errors.contact_name} onChange={set} required />
            <Field label="부서" name="contact_dept" value={form.contact_dept} error={errors.contact_dept} onChange={set} />
            <Field label="직위" name="contact_title" value={form.contact_title} error={errors.contact_title} onChange={set} />
            <Field label="이메일" name="contact_email" value={form.contact_email} error={errors.contact_email} onChange={set} required type="email" />
            <Field label="회사번호" name="contact_office_tel" value={form.contact_office_tel} error={errors.contact_office_tel} onChange={set} />
            <Field label="휴대폰 번호" name="contact_mobile" value={form.contact_mobile} error={errors.contact_mobile} onChange={set} required />
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
          onMouseEnter={e => { if (!submitting) e.currentTarget.style.background = ACCENT_HOVER }}
          onMouseLeave={e => { if (!submitting) e.currentTarget.style.background = ACCENT }}
          style={{
            width: '100%', padding: '12px 0', border: 'none', borderRadius: 8,
            background: submitting ? FAINT : ACCENT, color: '#fff',
            fontSize: 13, fontWeight: 700, cursor: submitting ? 'default' : 'pointer', fontFamily: 'inherit',
            transition: 'background 0.15s ease',
          }}>
          {submitting ? '등록 중...' : '리드 등록'}
        </button>
        </div>
      </div>
    </div>
  )
}
