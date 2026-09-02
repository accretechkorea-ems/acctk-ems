'use client'

// 리드 관리 — /lead 공개 폼으로 들어온 리드를 확인하고 처리한다.
// 영업관리 메뉴 안에 있지만 영업 업무라 접근 권한은 영업 현황과 같은 canViewPipeline 을 쓴다.

import { useEffect, useMemo, useState, Suspense, Fragment, type CSSProperties } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { usePageGuard } from '@/hooks/usePageGuard'
import { canViewPipeline, isSuperAdmin } from '@/lib/permissions'
import { withTeamPerm } from '@/lib/teamPerms'
import AccessGate from '@/components/common/AccessGate'
import { useToast } from '@/components/common/Toast'
import { useConfirm } from '@/components/common/ConfirmDialog'
import { getCategoryColor, SALES_STATUS_COLORS, type CategoryColor } from '@/lib/categoryColors'

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
const DANGER = '#dc2626'
// 경고 상자 배경 — 관리자 화면의 삭제 사유 상자와 같은 값.
const DANGER_BG = '#fef2f2'

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
  // 리드 관리자 = superadmin. 그 밖에는 자기에게 배정된 건만 다루는 담당자다.
  const isAdmin = isSuperAdmin(me)
  const myEngineerId = me?.engineer_id ?? null

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
  // 전환된 리드는 고객사명을 그대로 입력해야 지워진다. 어느 리드에서 확인 중인지와 입력값을 함께 들고 있는다.
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; text: string } | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)

  useEffect(() => {
    if (!authorized) return
    let cancelled = false
    const run = async () => {
      // 담당자에게는 자기 배정 건만 내려준다. 조회 자체를 막는 것은 RLS 의 몫이고
      // 여기서 거르는 것은 화면이 남의 리드를 그리지 않게 하기 위해서다.
      let leadQuery = supabase.from('leads').select('*').order('created_at', { ascending: false })
      if (!isAdmin && myEngineerId != null) leadQuery = leadQuery.eq('assigned_to', myEngineerId)
      const [{ data: ld }, { data: eng }, { data: cus }] = await Promise.all([
        leadQuery,
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
  }, [authorized, supabase, isAdmin, myEngineerId])

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

  /**
   * 리드 처리 요청. 배정·상태·메모·전환 모두 /api/lead-manage 를 거친다 —
   * 클라이언트에서 직접 쓰면 역할 판정을 서버가 할 수 없다.
   * patch 는 성공했을 때 화면의 목록을 갱신할 값이다(서버가 실제로 쓴 것과 같아야 한다).
   */
  const callManage = async (
    leadId: number,
    payload: Record<string, unknown>,
    patch: Record<string, unknown>,
    okMsg: string,
  ) => {
    setSaving(leadId)
    try {
      const res = await fetch('/api/lead-manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, ...payload }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json?.error || '저장하지 못했습니다.')
        return null
      }
      setLeads(prev => prev.map(l => (l.lead_id === leadId ? { ...l, ...patch } as Lead : l)))
      toast.success(okMsg)
      return json as Record<string, unknown>
    } finally {
      setSaving(null)
    }
  }

  /**
   * 리드 삭제(하드 삭제). 권한과 확인 문구는 라우트에서 다시 본다 —
   * 여기서 막는 것은 편의일 뿐이고 화면을 거치지 않는 호출은 서버만 막을 수 있다.
   */
  const removeLead = async (lead: Lead, confirmText?: string) => {
    setDeleting(lead.lead_id)
    try {
      const res = await fetch('/api/lead-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: lead.lead_id, confirmText }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json?.error || '삭제하지 못했습니다.')
        return
      }
      // 목록에서 빼면 상단 미처리 배지 건수도 함께 줄어든다(같은 배열에서 세므로).
      setLeads(prev => prev.filter(l => l.lead_id !== lead.lead_id))
      setDeleteConfirm(null)
      if (clickedId === lead.lead_id) setClickedId(null)
      toast.success('리드를 삭제했습니다.')
    } finally {
      setDeleting(null)
    }
  }

  /** 삭제 버튼 — 전환된 리드는 문구 확인 칸을 열고, 아니면 확인 창 한 번으로 끝낸다. */
  const askDelete = async (lead: Lead) => {
    if (lead.converted_opportunity_id) {
      setDeleteConfirm({ id: lead.lead_id, text: '' })
      return
    }
    const ok = await confirm({
      title: '리드 삭제',
      message: `${lead.partner_company} 이(가) 등록한 ${lead.customer_company} 리드를 삭제합니다. 되돌릴 수 없습니다.`,
      confirmText: '삭제',
      variant: 'danger',
    })
    if (ok) await removeLead(lead)
  }

  /** 영업기회 전환 — 기회 행을 만들고 리드를 전환완료로 닫는다. */
  const convert = async (lead: Lead) => {
    if (!pickedCustomer) { toast.error('고객사를 선택해주세요.'); return }
    if (lead.assigned_to !== myEngineerId) { toast.error('배정받은 담당자만 전환할 수 있습니다.'); return }
    const ok = await confirm({
      title: '영업기회로 전환',
      message: `${pickedCustomer.company_name} 로 영업기회를 만듭니다. 전환한 뒤에는 되돌릴 수 없습니다.`,
      confirmText: '전환',
    })
    if (!ok) return

    // 영업기회 생성·활동 기록·리드 마감은 전부 라우트가 한다(담당자 여부를 서버가 판정해야 하므로).
    const res = await callManage(
      lead.lead_id,
      { action: 'convert', customerId: pickedCustomer.customer_id },
      { status: LEAD_STATUS_CONVERTED },
      '영업기회로 전환했습니다.',
    )
    if (!res) return
    // 서버가 만든 기회 번호로 화면을 맞춘다.
    const oppId = Number(res.opportunityId)
    setLeads(prev => prev.map(l => (l.lead_id === lead.lead_id ? { ...l, converted_opportunity_id: oppId } : l)))
    if (res.activityLogged === false) toast.error('활동 기록은 남기지 못했습니다.')
    setPickedCustomer(null); setCustQuery('')
  }

  // 메뉴는 영업 현황 권한자에게 열려 있지만, 실제 접근은 관리자이거나
  // 배정받은 리드가 하나라도 있는 사람으로 좁힌다.
  const noLeadAccess = !loading && !isAdmin && leads.length === 0
  if (!authorized || noLeadAccess) return <AccessGate loading={guardLoading || loading} />

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
                                    onChange={e => callManage(lead.lead_id, { action: 'status', status: e.target.value }, { status: e.target.value }, '상태를 저장했습니다.')}
                                    style={fieldStyle}
                                  >
                                    {/* 전환완료는 손으로 고를 수 없다. 이미 전환된 건에서만 현재 값으로 보인다. */}
                                    {converted
                                      ? <option value={LEAD_STATUS_CONVERTED}>{LEAD_STATUS_CONVERTED}</option>
                                      : LEAD_MANUAL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                                  </select>
                                </div>
                                {/* 배정은 관리자만 한다. 담당자에게는 배정된 사람 이름만 보인다. */}
                                <div>
                                  <label style={labelStyle}>담당자</label>
                                  {!isAdmin ? (
                                    <div style={{ ...fieldStyle, background: HEAD_BG, color: MUTED }}>{engName(lead.assigned_to)}</div>
                                  ) : (
                                  <select
                                    value={lead.assigned_to ?? ''}
                                    disabled={busy}
                                    onChange={e => callManage(lead.lead_id, { action: 'assign', assignedTo: e.target.value ? Number(e.target.value) : null }, { assigned_to: e.target.value ? Number(e.target.value) : null }, '담당자를 저장했습니다.')}
                                    style={fieldStyle}
                                  >
                                    <option value="">배정 안 함</option>
                                    {assignable.map(e => (
                                      <option key={e.engineer_id} value={e.engineer_id}>{[e.name, e.position].filter(Boolean).join(' ')}</option>
                                    ))}
                                  </select>
                                  )}
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
                                      onClick={() => callManage(lead.lead_id, { action: 'memo', memo: memoValue(lead) }, { admin_memo: memoValue(lead).trim() || null }, '메모를 저장했습니다.')}
                                      style={btnStyle(busy || memoValue(lead) === (lead.admin_memo ?? ''))}
                                    >저장</button>
                                  </div>
                                </div>
                              </div>

                              {/* ── 영업기회 전환 — 배정받은 담당자만. 관리자 화면에는 나오지 않는다. ── */}
                              {lead.assigned_to === myEngineerId && (
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
                                        disabled={busy || !pickedCustomer}
                                        onClick={() => convert(lead)}
                                        style={btnStyle(busy || !pickedCustomer)}
                                      >
                                        {busy ? '전환 중...' : '영업기회로 전환'}
                                      </button>
                                    </div>
                                    <div style={{ fontSize: 11, color: FAINT, marginTop: 6, lineHeight: 1.7 }}>
                                      {custQuery.trim() && custMatches.length === 0 && !pickedCustomer && (
                                        <div>검색 결과가 없습니다. 고객사가 등록되어 있지 않다면 고객사를 먼저 등록해주세요.</div>
                                      )}
                                    </div>
                                  </>
                                )}
                              </div>
                              )}

                              {lead.admin_memo && (
                                <div style={{ marginTop: 10, fontSize: 11, color: FAINT }}>
                                  저장된 메모 · {lead.admin_memo}
                                </div>
                              )}

                              {/* 삭제 — superadmin 에게만 보인다. 서버도 같은 권한을 다시 확인한다. */}
                              {isSuperAdmin(me) && (
                                <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${BORDER}` }}>
                                  {deleteConfirm?.id === lead.lead_id ? (
                                    <div style={{ background: DANGER_BG, border: `1px solid ${BORDER}`, borderRadius: 6, padding: 12 }}>
                                      <div style={{ fontSize: 12, color: TEXT, lineHeight: 1.8, marginBottom: 10 }}>
                                        이 리드는 영업기회 #{lead.converted_opportunity_id} 으로 전환되었습니다.<br />
                                        삭제하면 해당 영업기회의 출처 기록이 사라집니다.<br />
                                        영업기회 자체는 삭제되지 않습니다.
                                      </div>
                                      <div style={{ fontSize: 11, color: MUTED, marginBottom: 6 }}>
                                        삭제하려면 고객사명 「{lead.customer_company}」 을 입력하세요
                                      </div>
                                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                        <input
                                          value={deleteConfirm.text}
                                          onChange={e => setDeleteConfirm({ id: lead.lead_id, text: e.target.value })}
                                          placeholder={lead.customer_company}
                                          style={{ ...fieldStyle, flex: '1 1 200px', minWidth: 0 }}
                                        />
                                        <button
                                          disabled={deleting === lead.lead_id || deleteConfirm.text.trim() !== lead.customer_company.trim()}
                                          onClick={() => removeLead(lead, deleteConfirm.text)}
                                          style={{
                                            ...btnStyle(deleting === lead.lead_id || deleteConfirm.text.trim() !== lead.customer_company.trim()),
                                            background: deleting === lead.lead_id || deleteConfirm.text.trim() !== lead.customer_company.trim() ? FAINT : DANGER,
                                          }}
                                        >{deleting === lead.lead_id ? '삭제 중...' : '삭제'}</button>
                                        <button
                                          onClick={() => setDeleteConfirm(null)}
                                          disabled={deleting === lead.lead_id}
                                          style={{ padding: '7px 14px', background: '#fff', color: MUTED, border: `1px solid ${BORDER}`, borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit' }}
                                        >취소</button>
                                      </div>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => askDelete(lead)}
                                      disabled={deleting === lead.lead_id}
                                      style={{ ...btnStyle(deleting === lead.lead_id), background: deleting === lead.lead_id ? FAINT : DANGER }}
                                    >{deleting === lead.lead_id ? '삭제 중...' : '리드 삭제'}</button>
                                  )}
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
