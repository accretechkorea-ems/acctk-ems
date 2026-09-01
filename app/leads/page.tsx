'use client'

// 리드 관리 — /lead 공개 폼으로 들어온 리드를 확인하고 처리한다.
// 영업관리 메뉴 안에 있지만 영업 업무라 접근 권한은 영업 현황과 같은 canViewPipeline 을 쓴다.

import { useEffect, useMemo, useState, Suspense, Fragment, type CSSProperties } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { usePageGuard } from '@/hooks/usePageGuard'
import { canViewPipeline } from '@/lib/permissions'
import { withTeamPerm } from '@/lib/teamPerms'
import AccessGate from '@/components/common/AccessGate'
import { useToast } from '@/components/common/Toast'
import { useConfirm } from '@/components/common/ConfirmDialog'
import { getCategoryColor, SALES_STATUS_COLORS, type CategoryColor } from '@/lib/categoryColors'
import { monthToDate } from '@/components/customer/opportunity'
import { ACTIVITY_TYPES as SALES_ACTIVITY_TYPES } from '@/components/customer/modals/SalesActivityModal'
import {
  LEAD_MANUAL_STATUSES, LEAD_STATUS_NEW, LEAD_STATUS_CONVERTED,
  COMPETITOR_OTHER, MAX_LEN,
} from '@/lib/leadOptions'

const BLUE = '#234ea2'
const TEXT = '#111827'
const MUTED = '#6b7280'
const FAINT = '#9ca3af'
const BORDER = '#ebebeb'
const CARD_BG = '#ffffff'
const PAGE_BG = '#fafafa'
const ROW_HOVER = '#f8fafc'
const HEAD_BG = '#f8fafc'

// 리드 상태 배지 색. 새 색은 만들지 않는다 —
// '보류' 는 SALES_STATUS_COLORS 에 이미 있고, '신규' 만 눈에 띄어야 해서
// 같은 맵의 '견적중'(아직 손대지 않은 건을 뜻하는 amber)을 빌려 쓴다.
// '확인중' · '전환완료' 는 맵에 없으므로 회색 폴백 그대로다.
const leadStatusColor = (status: string): CategoryColor => {
  if (status === LEAD_STATUS_NEW) return SALES_STATUS_COLORS['견적중']
  return getCategoryColor(SALES_STATUS_COLORS, status)
}

type Lead = {
  lead_id: number
  partner_company: string; partner_name: string; partner_contact: string | null
  customer_company: string; industry: string; products: string
  address: string | null; city: string; country: string
  interest_product: string; request_note: string | null
  competitor: string[] | null; competitor_other: string | null
  budget_status: string; purchase_period: string | null; expected_purchase: string | null
  contact_name: string | null; contact_dept: string | null; contact_title: string | null
  contact_email: string; contact_office_tel: string | null; contact_mobile: string
  meeting_note: string
  status: string; assigned_to: number | null; admin_memo: string | null
  converted_opportunity_id: number | null
  created_at: string
}

type Engineer = { engineer_id: number; name: string | null; position: string | null; teams: string | null; permission_level: string | null; resigned_date: string | null }
type Customer = { customer_id: number; company_name: string | null; address: string | null }

const th: CSSProperties = { padding: '9px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: MUTED, whiteSpace: 'nowrap' }
const td: CSSProperties = { padding: '10px 10px', fontSize: 12, color: TEXT, whiteSpace: 'nowrap' }
const fieldStyle: CSSProperties = {
  width: '100%', padding: '7px 9px', border: `1px solid ${BORDER}`, borderRadius: 6,
  fontSize: 12, color: TEXT, background: '#fff', outline: 'none', fontFamily: 'inherit',
}
const labelStyle: CSSProperties = { fontSize: 11, fontWeight: 700, color: MUTED, marginBottom: 4, display: 'block' }
const btnStyle = (disabled: boolean): CSSProperties => ({
  padding: '7px 14px', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700,
  background: disabled ? FAINT : BLUE, color: '#fff',
  cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
})
const groupTitle: CSSProperties = { fontSize: 11, fontWeight: 700, color: BLUE, marginBottom: 6 }
const dlRow: CSSProperties = { display: 'flex', gap: 8, fontSize: 12, lineHeight: 1.7 }
const dlKey: CSSProperties = { width: 78, flexShrink: 0, color: FAINT }

/** 상세의 한 줄. 값이 비면 '-' 로 자리를 지킨다. */
function Row({ k, v }: { k: string; v: string | null | undefined }) {
  return (
    <div style={dlRow}>
      <span style={dlKey}>{k}</span>
      <span style={{ color: TEXT, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{v?.trim() || '-'}</span>
    </div>
  )
}

function LeadsPageInner() {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useToast()
  const confirm = useConfirm()
  const { engineer: me, loading: guardLoading, authorized } = usePageGuard(canViewPipeline)

  const [leads, setLeads] = useState<Lead[]>([])
  const [engineers, setEngineers] = useState<Engineer[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [clickedId, setClickedId] = useState<number | null>(null)
  const [saving, setSaving] = useState<number | null>(null)

  // 알림(link '/leads?lead=12')으로 들어오면 그 리드를 펼친다.
  // 파라미터를 state 로 옮기지 않고 렌더할 때마다 읽는다 — 이미 이 화면에 있어도 즉시 반영되고,
  // effect 안에서 setState 하는 모양(연쇄 렌더)도 생기지 않는다.
  const paramId = Number(searchParams.get('lead')) || null
  const openId = paramId ?? clickedId

  // 처리 입력값 — 펼친 리드 하나에 대해서만 들고 있는다.
  // 리드 id 를 함께 들고 있어야 알림으로 바로 펼쳐진 리드의 저장된 메모가 그대로 보인다.
  const [memoDraft, setMemoDraft] = useState<{ id: number; text: string } | null>(null)
  const [custQuery, setCustQuery] = useState('')
  const [custOpen, setCustOpen] = useState(false)
  const [pickedCustomer, setPickedCustomer] = useState<Customer | null>(null)

  useEffect(() => {
    if (!authorized) return
    let cancelled = false
    const run = async () => {
      const [{ data: ld }, { data: eng }, { data: cus }] = await Promise.all([
        supabase.from('leads').select('*').order('created_at', { ascending: false }),
        supabase.from('engineers').select('engineer_id, name, position, teams, permission_level, resigned_date'),
        supabase.from('customers').select('customer_id, company_name, address').is('deleted_at', null),
      ])
      if (cancelled) return
      setLeads((ld ?? []) as Lead[])
      setEngineers((eng ?? []) as Engineer[])
      setCustomers((cus ?? []) as Customer[])
      setLoading(false)
    }
    run()
    return () => { cancelled = true }
  }, [authorized, supabase])

  // 담당자 후보 — 영업 현황 권한이 있는 재직자만.
  const [assignable, setAssignable] = useState<Engineer[]>([])
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const rows = await Promise.all(
        engineers.filter(e => !e.resigned_date).map(async e => ({ e, ok: canViewPipeline(await withTeamPerm(e)) }))
      )
      if (!cancelled) setAssignable(rows.filter(r => r.ok).map(r => r.e))
    }
    if (engineers.length) run()
    return () => { cancelled = true }
  }, [engineers])

  const engName = (id: number | null) => {
    if (!id) return '-'
    const e = engineers.find(x => x.engineer_id === id)
    return e ? [e.name, e.position].filter(Boolean).join(' ') : '-'
  }

  // 신규 건을 위로, 각 묶음 안에서는 등록 최신순.
  const sorted = useMemo(() => {
    const isNew = (l: Lead) => l.status === LEAD_STATUS_NEW
    return [...leads].sort((a, b) =>
      (isNew(b) ? 1 : 0) - (isNew(a) ? 1 : 0) || (a.created_at < b.created_at ? 1 : -1)
    )
  }, [leads])

  const newCount = leads.filter(l => l.status === LEAD_STATUS_NEW).length

  const custMatches = custQuery.trim()
    ? customers.filter(c => (c.company_name ?? '').toLowerCase().includes(custQuery.trim().toLowerCase())).slice(0, 8)
    : []

  /** 펼친 리드의 메모 입력값. 아직 손대지 않았으면 저장된 값을 그대로 보여준다. */
  const memoValue = (lead: Lead) => (memoDraft?.id === lead.lead_id ? memoDraft.text : (lead.admin_memo ?? ''))

  const openLead = (lead: Lead) => {
    const next = openId === lead.lead_id ? null : lead.lead_id
    setClickedId(next)
    setMemoDraft(null)
    setCustQuery(''); setCustOpen(false); setPickedCustomer(null)
    // 알림으로 들어와 붙은 파라미터는 사용자가 목록을 건드리는 순간 지운다.
    if (paramId) router.replace('/leads')
  }

  const patchLead = async (leadId: number, patch: Record<string, unknown>, okMsg: string) => {
    setSaving(leadId)
    const { error } = await supabase
      .from('leads')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('lead_id', leadId)
    setSaving(null)
    if (error) { toast.error('저장하지 못했습니다: ' + error.message); return false }
    setLeads(prev => prev.map(l => (l.lead_id === leadId ? { ...l, ...patch } as Lead : l)))
    toast.success(okMsg)
    return true
  }

  /** 영업기회 전환 — 기회 행을 만들고 리드를 전환완료로 닫는다. */
  const convert = async (lead: Lead) => {
    if (!pickedCustomer) { toast.error('고객사를 선택해주세요.'); return }
    if (!lead.assigned_to) { toast.error('담당자를 먼저 배정해주세요.'); return }
    const ok = await confirm({
      title: '영업기회로 전환',
      message: `${pickedCustomer.company_name} 로 영업기회를 만듭니다. 전환한 뒤에는 되돌릴 수 없습니다.`,
      confirmText: '전환',
    })
    if (!ok) return

    setSaving(lead.lead_id)
    // 리드에는 고객사명 문자열만 있어 업체는 화면에서 고른 것을 쓴다.
    // expected_close 는 date 컬럼이라 예상 구매 시기가 있으면 그 달의 말일로 맞춘다(영업기회 규칙과 동일).
    const payload = {
      customer_id: pickedCustomer.customer_id,
      engineer_id: lead.assigned_to,
      title: `${lead.customer_company} ${lead.interest_product}`.trim(),
      expected_close: lead.expected_purchase ? monthToDate(lead.expected_purchase.slice(0, 7)) : null,
    }
    const { data: opp, error: oppErr } = await supabase
      .from('sales_opportunities')
      .insert(payload)
      .select('opportunity_id')
      .single()
    if (oppErr || !opp) {
      setSaving(null)
      toast.error('영업기회를 만들지 못했습니다: ' + (oppErr?.message ?? ''))
      return
    }

    // 회의록·요청사항을 영업활동으로 남긴다. 실패해도 전환 자체는 되돌리지 않는다.
    const content = [lead.meeting_note, lead.request_note].filter(t => t && t.trim()).join('\n\n')
    const { error: actErr } = await supabase.from('sales_activities').insert({
      opportunity_id: opp.opportunity_id,
      customer_id: pickedCustomer.customer_id,
      engineer_id: lead.assigned_to,
      activity_date: lead.created_at.slice(0, 10),
      activity_type: SALES_ACTIVITY_TYPES[1],   // 방문미팅 — 파트너사가 현장에서 만나 적어 온 기록
      content,
    })
    if (actErr) console.error('[leads] 활동 기록 생성 실패', { leadId: lead.lead_id, error: actErr })

    const done = await patchLead(
      lead.lead_id,
      { status: LEAD_STATUS_CONVERTED, converted_opportunity_id: opp.opportunity_id },
      actErr ? '영업기회를 만들었습니다. (활동 기록은 남기지 못했습니다)' : '영업기회로 전환했습니다.'
    )
    if (done) { setPickedCustomer(null); setCustQuery('') }
  }

  if (!authorized) return <AccessGate loading={guardLoading} />

  return (
    <div style={{ background: PAGE_BG, minHeight: '100vh', padding: '20px 24px 48px' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <h1 style={{ fontSize: 17, fontWeight: 800, color: TEXT, letterSpacing: '-0.3px', margin: 0 }}>리드</h1>
          {newCount > 0 && (
            <span style={{
              fontSize: 11, fontWeight: 700, borderRadius: 99, padding: '2px 9px',
              background: leadStatusColor(LEAD_STATUS_NEW).bg, color: leadStatusColor(LEAD_STATUS_NEW).text,
            }}>
              미처리 {newCount}
            </span>
          )}
        </div>

        <div style={{ background: CARD_BG, borderRadius: 8, border: `1px solid ${BORDER}`, overflow: 'hidden' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 60, color: MUTED, fontSize: 13 }}>불러오는 중...</div>
          ) : sorted.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: MUTED, fontSize: 13 }}>등록된 리드가 없습니다</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: HEAD_BG, borderBottom: `1px solid ${BORDER}` }}>
                  {['등록일', '파트너사', '고객사', '관심제품', '담당자', '상태'].map(h => <th key={h} style={th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {sorted.map(lead => {
                  const open = openId === lead.lead_id
                  const sc = leadStatusColor(lead.status)
                  const converted = lead.status === LEAD_STATUS_CONVERTED || !!lead.converted_opportunity_id
                  const busy = saving === lead.lead_id
                  return (
                    <Fragment key={lead.lead_id}>
                      <tr
                        onClick={() => openLead(lead)}
                        style={{ borderBottom: `1px solid ${BORDER}`, cursor: 'pointer', background: open ? ROW_HOVER : undefined }}
                        onMouseEnter={e => { if (!open) e.currentTarget.style.background = ROW_HOVER }}
                        onMouseLeave={e => { if (!open) e.currentTarget.style.background = '' }}
                      >
                        <td style={{ ...td, color: MUTED }}>{lead.created_at.slice(0, 10)}</td>
                        <td style={{ ...td, fontWeight: 700 }}>{lead.partner_company}</td>
                        <td style={td}>{lead.customer_company}</td>
                        <td style={{ ...td, color: MUTED }}>{lead.interest_product}</td>
                        <td style={{ ...td, color: lead.assigned_to ? TEXT : FAINT }}>{engName(lead.assigned_to)}</td>
                        <td style={td}>
                          <span style={{ padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700, background: sc.bg, color: sc.text }}>
                            {lead.status}
                          </span>
                        </td>
                      </tr>

                      {open && (
                        <tr style={{ borderBottom: `1px solid ${BORDER}`, background: ROW_HOVER }}>
                          <td colSpan={6} style={{ padding: '0 12px 14px' }}>
                            {/* ── 상세 ── */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginBottom: 12 }}>
                              <div>
                                <div style={groupTitle}>파트너사</div>
                                <Row k="회사명" v={lead.partner_company} />
                                <Row k="등록자" v={lead.partner_name} />
                                <Row k="연락처" v={lead.partner_contact} />
                              </div>
                              <div>
                                <div style={groupTitle}>고객사</div>
                                <Row k="회사명" v={lead.customer_company} />
                                <Row k="산업군" v={lead.industry} />
                                <Row k="생산품" v={lead.products} />
                                <Row k="주소" v={lead.address} />
                                <Row k="시 / 국가" v={`${lead.city} / ${lead.country}`} />
                              </div>
                              <div>
                                <div style={groupTitle}>관심 제품</div>
                                <Row k="관심 제품" v={lead.interest_product} />
                                <Row k="예산" v={lead.budget_status} />
                                <Row k="구매 기간" v={lead.purchase_period} />
                                <Row k="구매 시기" v={lead.expected_purchase} />
                                {/* 경쟁사는 배열이라 쉼표로 잇고, '기타' 가 있으면 직접 입력값을 덧붙인다 */}
                                <Row k="경쟁사" v={(() => {
                                  const list = lead.competitor ?? []
                                  if (!list.length) return ''
                                  const joined = list.join(', ')
                                  return list.includes(COMPETITOR_OTHER) && lead.competitor_other
                                    ? `${joined} (${lead.competitor_other})`
                                    : joined
                                })()} />
                                <Row k="요청사항" v={lead.request_note} />
                              </div>
                              <div>
                                <div style={groupTitle}>고객 정보</div>
                                <Row k="이름" v={lead.contact_name} />
                                <Row k="부서 / 직위" v={[lead.contact_dept, lead.contact_title].filter(Boolean).join(' / ')} />
                                <Row k="이메일" v={lead.contact_email} />
                                <Row k="회사번호" v={lead.contact_office_tel} />
                                <Row k="휴대폰" v={lead.contact_mobile} />
                              </div>
                            </div>

                            <div style={{ marginBottom: 12 }}>
                              <div style={groupTitle}>미팅 노트</div>
                              <div style={{ fontSize: 12, color: TEXT, lineHeight: 1.8, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 6, padding: '9px 11px' }}>
                                {lead.meeting_note}
                              </div>
                            </div>

                            {/* ── 처리 ── */}
                            <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 8, padding: 12 }}>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                                <div>
                                  <label style={labelStyle}>상태</label>
                                  <select
                                    value={converted ? LEAD_STATUS_CONVERTED : lead.status}
                                    disabled={converted || busy}
                                    onChange={e => patchLead(lead.lead_id, { status: e.target.value }, '상태를 저장했습니다.')}
                                    style={fieldStyle}
                                  >
                                    {/* 전환완료는 손으로 고를 수 없다. 이미 전환된 건에서만 현재 값으로 보인다. */}
                                    {converted
                                      ? <option value={LEAD_STATUS_CONVERTED}>{LEAD_STATUS_CONVERTED}</option>
                                      : LEAD_MANUAL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                                  </select>
                                </div>
                                <div>
                                  <label style={labelStyle}>담당자</label>
                                  <select
                                    value={lead.assigned_to ?? ''}
                                    disabled={busy}
                                    onChange={e => patchLead(lead.lead_id, { assigned_to: e.target.value ? Number(e.target.value) : null }, '담당자를 저장했습니다.')}
                                    style={fieldStyle}
                                  >
                                    <option value="">배정 안 함</option>
                                    {assignable.map(e => (
                                      <option key={e.engineer_id} value={e.engineer_id}>{[e.name, e.position].filter(Boolean).join(' ')}</option>
                                    ))}
                                  </select>
                                </div>
                                <div>
                                  <label style={labelStyle}>메모</label>
                                  <div style={{ display: 'flex', gap: 6 }}>
                                    <input
                                      value={memoValue(lead)}
                                      maxLength={MAX_LEN.request_note}
                                      onChange={e => setMemoDraft({ id: lead.lead_id, text: e.target.value })}
                                      placeholder="처리 메모"
                                      style={fieldStyle}
                                    />
                                    <button
                                      disabled={busy || memoValue(lead) === (lead.admin_memo ?? '')}
                                      onClick={() => patchLead(lead.lead_id, { admin_memo: memoValue(lead).trim() || null }, '메모를 저장했습니다.')}
                                      style={btnStyle(busy || memoValue(lead) === (lead.admin_memo ?? ''))}
                                    >저장</button>
                                  </div>
                                </div>
                              </div>

                              {/* ── 영업기회 전환 ── */}
                              <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${BORDER}` }}>
                                <div style={groupTitle}>영업기회 전환</div>
                                {converted ? (
                                  <div style={{ fontSize: 12, color: MUTED }}>
                                    이미 전환된 리드입니다. (영업기회 #{lead.converted_opportunity_id})
                                  </div>
                                ) : (
                                  <>
                                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                                      <div style={{ position: 'relative', flex: '1 1 260px', minWidth: 0 }}>
                                        {pickedCustomer ? (
                                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                            <div style={{ ...fieldStyle, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                              {pickedCustomer.company_name ?? '-'}
                                              {pickedCustomer.address && <span style={{ marginLeft: 6, fontSize: 11, color: FAINT }}>{pickedCustomer.address}</span>}
                                            </div>
                                            <button
                                              onClick={() => { setPickedCustomer(null); setCustQuery(''); setCustOpen(true) }}
                                              style={{ padding: '7px 12px', background: '#f3f4f6', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700, color: MUTED, flexShrink: 0 }}
                                            >변경</button>
                                          </div>
                                        ) : (
                                          <input
                                            value={custQuery}
                                            onChange={e => { setCustQuery(e.target.value); setCustOpen(true) }}
                                            onFocus={() => setCustOpen(true)}
                                            placeholder="업체명으로 검색"
                                            style={fieldStyle}
                                          />
                                        )}
                                        {custOpen && !pickedCustomer && custMatches.length > 0 && (
                                          <div style={{
                                            position: 'absolute', top: '100%', left: 0, width: '100%', marginTop: 4, zIndex: 20,
                                            background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 6,
                                            boxShadow: '0 4px 12px rgba(0,0,0,0.08)', maxHeight: 240, overflowY: 'auto',
                                          }}>
                                            {custMatches.map(c => (
                                              <div key={c.customer_id}
                                                onMouseDown={ev => { ev.preventDefault(); setPickedCustomer(c); setCustOpen(false) }}
                                                style={{ padding: '8px 11px', cursor: 'pointer' }}
                                                onMouseEnter={ev => { ev.currentTarget.style.background = '#f5f5f5' }}
                                                onMouseLeave={ev => { ev.currentTarget.style.background = 'transparent' }}
                                              >
                                                <div style={{ fontSize: 12, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.company_name ?? '-'}</div>
                                                <div style={{ fontSize: 11, color: FAINT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.address ?? '주소 없음'}</div>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                      <button
                                        disabled={busy || !lead.assigned_to || !pickedCustomer}
                                        onClick={() => convert(lead)}
                                        style={btnStyle(busy || !lead.assigned_to || !pickedCustomer)}
                                      >
                                        {busy ? '전환 중...' : '영업기회로 전환'}
                                      </button>
                                    </div>
                                    <div style={{ fontSize: 11, color: FAINT, marginTop: 6, lineHeight: 1.7 }}>
                                      {!lead.assigned_to && <div>담당자를 먼저 배정해주세요.</div>}
                                      {custQuery.trim() && custMatches.length === 0 && !pickedCustomer && (
                                        <div>검색 결과가 없습니다. 고객사가 등록되어 있지 않다면 고객사를 먼저 등록해주세요.</div>
                                      )}
                                    </div>
                                  </>
                                )}
                              </div>

                              {lead.admin_memo && (
                                <div style={{ marginTop: 10, fontSize: 11, color: FAINT }}>
                                  저장된 메모 · {lead.admin_memo}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
        {/* me 는 권한 판정에만 쓰이고 화면에는 드러내지 않는다 */}
        <div style={{ display: 'none' }}>{me?.engineer_id}</div>
      </div>
    </div>
  )
}

// useSearchParams 는 Suspense 경계 안에서만 쓸 수 있다.
export default function LeadsPage() {
  return (
    <Suspense fallback={<div style={{ background: PAGE_BG, minHeight: '100vh' }} />}>
      <LeadsPageInner />
    </Suspense>
  )
}
