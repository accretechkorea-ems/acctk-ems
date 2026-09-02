'use client'

import { useRef, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { SALES_STATUS_COLORS, DELIVERY_METHOD_COLORS, getCategoryColor } from '@/lib/categoryColors'
import { canViewSalesMgmt, type TeamPerm } from '@/lib/permissions'
import { withTeamPerm } from '@/lib/teamPerms'
import QuoteExcelButton from '@/components/quote/QuoteExcelButton'
import { useQuoteSelection } from '@/hooks/useQuoteSelection'
import AccessGate from '@/components/common/AccessGate'
import { Z } from '@/lib/zIndex'
import Popover from '@/components/common/Popover'

const BLUE = '#234ea2'
const PAGE_BG = '#f4f5f7'
const CARD_BG = '#ffffff'
const BORDER = '#e2e4e9'
const TEXT = '#111113'
const GRAY = '#6b7280'
const MUTED = '#9ca3af'
const GREEN = '#15803d'
const ORANGE = '#d97706'

type PurchaseQuote = {
  quote_id: number
  quote_number: string
  quote_date: string
  total_supply: number
  status: string
  pdf_url: string | null
  purchase_order_url: string | null
  purchase_order_at: string | null
  shipping_date: string | null
  order_memo: string | null
  order_completed_at: string | null
  order_completed_by: string | null
  tax_invoice_date: string | null
  tax_invoice_requested_at: string | null
  tax_invoice_completed_at: string | null
  tax_completed_by: string | null
  delivery_info: string | null
  delivery_method: string | null
  engineer_id: number
  customer_id: number | null
  engineers?: { name: string; position: string | null } | null
}

type Engineer = {
  engineer_id: number
  name: string
  email: string
  teams: string | null
  permission_level: string
  perm?: TeamPerm | null
}

const numKR = (n: number) => Math.round(n).toLocaleString('ko-KR')
const fmtDate = (s: string | null) => {
  if (!s) return '-'
  return new Date(s).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(/\. /g, '.').slice(0, -1)
}
const fmtShort = (s: string | null) => {
  if (!s) return '-'
  return s.slice(0, 10)
}

export default function PurchasePage() {
  const supabase = createClient()
  const [quotes, setQuotes] = useState<PurchaseQuote[]>([])
  const [custMap, setCustMap] = useState<Record<number, string>>({})
  const [engMap, setEngMap] = useState<Record<string, string>>({})
  const [me, setMe] = useState<Engineer | null>(null)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('전체')
  const [search, setSearch] = useState('')

  // 주문완료 처리 모달
  const [orderModal, setOrderModal] = useState<PurchaseQuote | null>(null)
  const [shippingDate, setShippingDate] = useState('')
  const [orderMemo, setOrderMemo] = useState('')
  const [processing, setProcessing] = useState(false)

  // 세금계산서 발행완료 모달
  const [taxModal, setTaxModal] = useState<PurchaseQuote | null>(null)
  const [taxProcessing, setTaxProcessing] = useState(false)
  // 메모 툴팁
  const [hoveredMemoId, setHoveredMemoId] = useState<number | null>(null)
  // 표 컨테이너가 잘라서 툴팁을 포털로 띄운다. 앵커는 지금 가리키고 있는 줄.
  const memoAnchorRef = useRef<HTMLDivElement>(null)
  // 배송 주소 팝업
  const [addressPopupId, setAddressPopupId] = useState<number | null>(null)
  // 열린 행의 배송 배지. 포털 팝오버가 이 좌표를 기준으로 뜬다.
  const addressAnchorRef = useRef<HTMLDivElement>(null)
  const [copiedId, setCopiedId] = useState<number | null>(null)
  // 출하일정/메모 편집 모달
  const [editScheduleModal, setEditScheduleModal] = useState<PurchaseQuote | null>(null)
  const [editShippingDate, setEditShippingDate] = useState('')
  const [editOrderMemo, setEditOrderMemo] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  const fetchAll = async () => {
    setLoading(true)
    const { data: userData } = await supabase.auth.getUser()
    const [{ data: meData }, { data: qData }, { data: custData }, { data: engData }] = await Promise.all([
      supabase.from('engineers').select('*').eq('email', userData.user?.email || '').single(),
      supabase.from('quotes')
        .select('quote_id, quote_number, quote_date, total_supply, status, pdf_url, purchase_order_url, purchase_order_at, shipping_date, order_memo, order_completed_at, order_completed_by, tax_invoice_date, tax_invoice_requested_at, tax_invoice_completed_at, tax_completed_by, delivery_info, delivery_method, engineer_id, customer_id, engineers(name, position)')
        .in('status', ['발주(주문 대기)', '주문완료', '세금계산서 요청', '매출완료'])
        .order('purchase_order_at', { ascending: false }),
      supabase.from('customers').select('customer_id, company_name'),
      supabase.from('engineers').select('name, position'),
    ])
    // 진입 판정(canViewSalesMgmt)에 팀 플래그가 필요하다.
    setMe(await withTeamPerm(meData as Engineer | null))
    const em: Record<string, string> = {}
    for (const e of engData || []) if (e.name && e.position) em[e.name] = e.position
    setEngMap(em)
    const cm: Record<number, string> = {}
    for (const c of custData || []) cm[c.customer_id] = c.company_name
    setCustMap(cm)
    setQuotes((qData || []) as unknown as PurchaseQuote[])
    setLoading(false)
  }

  useEffect(() => { fetchAll() }, [])

  const isAllowed = canViewSalesMgmt(me)

  // 목록(검색·상태 필터)이 바뀌면 화면에서 사라진 견적의 선택은 자동으로 걷힌다.
  const filtered = quotes.filter(q => {
    const matchStatus = statusFilter === '전체' || q.status === statusFilter
    const company = custMap[q.customer_id ?? 0] ?? ''
    const matchSearch = !search.trim() ||
      q.quote_number.includes(search) ||
      company.toLowerCase().includes(search.toLowerCase())
    return matchStatus && matchSearch
  })

  // 이 화면은 페이징이 없어 filtered 가 곧 화면에 보이는 목록이다.
  const visibleIds = filtered.map(q => q.quote_id)
  const sel = useQuoteSelection(visibleIds)
  const allSelected = visibleIds.length > 0 && visibleIds.every(id => sel.isSelected(id))

  const counts = {
    '발주(주문 대기)': quotes.filter(q => q.status === '발주(주문 대기)').length,
    '주문완료': quotes.filter(q => q.status === '주문완료').length,
    '세금계산서 요청': quotes.filter(q => q.status === '세금계산서 요청').length,
    '매출완료': quotes.filter(q => q.status === '매출완료').length,
  }

  const fmtTaxDate = (s: string | null) => {
    if (!s) return ''
    const d = new Date(s)
    const yy = String(d.getFullYear()).slice(2)
    return `희망 발행일 : ${yy}년 ${d.getMonth() + 1}월 ${d.getDate()}일`
  }

  const handleViewQuotePDF = async (q: PurchaseQuote) => {
    if (!q.pdf_url) return
    if (q.pdf_url.includes('synology')) { window.open(q.pdf_url, '_blank'); return }
    const path = q.pdf_url.startsWith('quote-pdfs/') ? q.pdf_url.replace('quote-pdfs/', '') : q.pdf_url.split('/quote-pdfs/')[1]
    if (!path) return
    const res = await fetch(`/api/quote-pdf?path=${encodeURIComponent(path)}`)
    const json = await res.json()
    if (json.signedUrl) window.open(json.signedUrl, '_blank')
  }

  const handleViewPO = async (q: PurchaseQuote) => {
    if (!q.purchase_order_url) return
    const res = await fetch(`/api/purchase-order?path=${encodeURIComponent(q.purchase_order_url)}`)
    const json = await res.json()
    if (json.signedUrl) window.open(json.signedUrl, '_blank')
  }

  const handleCompleteOrder = async () => {
    if (!orderModal) return
    setProcessing(true)
    const fd = new FormData()
    fd.append('quoteId', String(orderModal.quote_id))
    fd.append('action', 'complete_order')
    if (shippingDate) fd.append('shippingDate', shippingDate)
    if (orderMemo) fd.append('orderMemo', orderMemo)
    await fetch('/api/purchase-order', { method: 'POST', body: fd })
    setProcessing(false)
    setOrderModal(null)
    setShippingDate('')
    setOrderMemo('')
    await fetchAll()
  }

  const handleCompleteTax = async () => {
    if (!taxModal) return
    setTaxProcessing(true)
    const fd = new FormData()
    fd.append('quoteId', String(taxModal.quote_id))
    fd.append('action', 'complete_tax')
    await fetch('/api/purchase-order', { method: 'POST', body: fd })
    setTaxProcessing(false)
    setTaxModal(null)
    await fetchAll()
  }

  const handleEditSchedule = async () => {
    if (!editScheduleModal) return
    setEditSaving(true)
    const fd = new FormData()
    fd.append('quoteId', String(editScheduleModal.quote_id))
    fd.append('action', 'update_schedule')
    fd.append('shippingDate', editShippingDate)
    fd.append('orderMemo', editOrderMemo)
    await fetch('/api/purchase-order', { method: 'POST', body: fd })
    setEditSaving(false)
    setEditScheduleModal(null)
    await fetchAll()
  }

  const inp: React.CSSProperties = { padding: '7px 10px', border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 13, outline: 'none', background: '#fff', boxSizing: 'border-box', width: '100%' }

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh', fontSize: 16, color: GRAY }}>불러오는 중...</div>
  )

  if (!isAllowed) return <AccessGate loading={false} />

  return (
    <div style={{ background: PAGE_BG, minHeight: '100vh', padding: '24px 28px' }}>
      <div style={{ maxWidth: 1600, margin: '0 auto' }}>

        {/* 현황 카드 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
          {([
            { label: '주문 대기', key: '발주(주문 대기)' },
            { label: '주문 완료', key: '주문완료' },
            { label: '세금계산서 요청', key: '세금계산서 요청' },
            { label: '매출 완료', key: '매출완료' },
          ] as const).map(({ label, key }) => {
            const cc = getCategoryColor(SALES_STATUS_COLORS, key)
            return (
            <div key={key}
              onClick={() => setStatusFilter(statusFilter === key ? '전체' : key)}
              style={{ background: CARD_BG, borderRadius: 12, padding: '14px 16px', border: `1.5px solid ${statusFilter === key ? cc.text : BORDER}`, cursor: 'pointer', transition: 'all 0.15s' }}>
              <div style={{ fontSize: 11, color: GRAY, marginBottom: 6, fontWeight: 600 }}>{label}</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: cc.text }}>{counts[key]}</div>
              <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>건</div>
            </div>
            )
          })}
        </div>

        {/* 검색 + 필터 */}
        <div style={{ background: CARD_BG, borderRadius: 12, padding: '12px 16px', marginBottom: 16, border: `1px solid ${BORDER}`, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="견적번호 / 고객사 검색"
            style={{ ...inp, width: 240 }} />
          <div style={{ display: 'flex', background: '#f3f4f6', borderRadius: 10, padding: 3, gap: 1 }}>
            {['전체', '발주(주문 대기)', '주문완료', '세금계산서 요청', '매출완료'].map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                style={{ padding: '5px 10px', borderRadius: 7, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 11, whiteSpace: 'nowrap', background: statusFilter === s ? (s === '전체' ? BLUE : getCategoryColor(SALES_STATUS_COLORS, s).text) : 'transparent', color: statusFilter === s ? '#fff' : GRAY, transition: 'all 0.12s' }}>
                {s}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 12, color: MUTED, marginLeft: 'auto' }}>{filtered.length}건</span>
          {/* 선택한 견적을 이익률 분석표 엑셀로 내보낸다(보이는 행만 선택 가능). */}
          <QuoteExcelButton
            quoteIds={sel.selected}
            engineerId={me?.engineer_id ?? null}
            onDone={sel.clear}
            style={{ padding: '6px 12px', borderRadius: 8, border: 'none', fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap', background: BLUE, color: '#fff' }}
          />
        </div>

        {/* 테이블 */}
        <div style={{ background: CARD_BG, borderRadius: 14, border: `1px solid ${BORDER}`, overflow: 'hidden' }}>
          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: MUTED, fontSize: 14 }}>해당 조건의 발주가 없습니다</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: `1px solid ${BORDER}` }}>
                  <th style={{ width: 36, padding: '9px 6px', textAlign: 'center' }}>
                    <input type="checkbox" checked={allSelected} onChange={() => sel.toggleAll(visibleIds)}
                      title="전체 선택/해제" style={{ cursor: 'pointer' }} />
                  </th>
                  {['견적서(견적번호)', '고객사', '담당자', '배송', '공급가액', '발주일', '출하예정', '메모', '상태', '발주서'].map(h => (
                    <th key={h} style={{ padding: '9px 10px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: MUTED, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                  <th style={{ padding: '9px 10px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: MUTED, whiteSpace: 'nowrap' }}>처리</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(q => {
                  const company = custMap[q.customer_id ?? 0] ?? '-'
                  const eng = q.engineers as any
                  const engName = eng ? [eng.name, eng.position].filter(Boolean).join(' ') : '-'
                  const sc = getCategoryColor(SALES_STATUS_COLORS, q.status)
                  const dc = getCategoryColor(DELIVERY_METHOD_COLORS, q.delivery_method)
                  const isParcel = q.delivery_method === '택배발송'
                  return (
                    <tr key={q.quote_id}
                      style={{ borderBottom: `1px solid ${BORDER}`, transition: 'background 0.1s' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                      onMouseLeave={e => (e.currentTarget.style.background = '')}>
                      <td style={{ padding: '9px 6px', textAlign: 'center' }}>
                        <input type="checkbox" checked={sel.isSelected(q.quote_id)} onChange={() => sel.toggle(q.quote_id)} style={{ cursor: 'pointer' }} />
                      </td>
                      <td style={{ padding: '9px 10px', fontWeight: 700, color: BLUE, whiteSpace: 'nowrap', textAlign: 'center' }}>
                        <span
                          onClick={() => handleViewQuotePDF(q)}
                          style={{ cursor: q.pdf_url ? 'pointer' : 'default', textDecoration: q.pdf_url ? 'underline' : 'none', textUnderlineOffset: 2 }}>
                          {q.quote_number}
                          {q.pdf_url && <span style={{ marginLeft: 4, fontSize: 9, color: MUTED }}>PDF</span>}
                        </span>
                      </td>
                      <td style={{ padding: '9px 10px', fontWeight: 600, whiteSpace: 'nowrap', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'center' }}>{company}</td>
                      <td style={{ padding: '9px 10px', color: GRAY, whiteSpace: 'nowrap', textAlign: 'center' }}>{engName}</td>
                      <td style={{ padding: '9px 10px', whiteSpace: 'nowrap', textAlign: 'center' }}>
                        {/* 표 컨테이너(overflow: hidden)가 팝오버를 자르므로, 열린 행에만 앵커를 걸어 포털로 띄운다 */}
                        {q.delivery_method ? (
                          <div ref={addressPopupId === q.quote_id ? addressAnchorRef : null} style={{ display: 'inline-block' }}>
                            <span
                              onClick={() => isParcel && q.delivery_info ? setAddressPopupId(addressPopupId === q.quote_id ? null : q.quote_id) : undefined}
                              style={{ fontSize: 10, padding: '3px 8px', borderRadius: 5, fontWeight: 700, background: dc.bg, color: dc.text, cursor: isParcel && q.delivery_info ? 'pointer' : 'default', userSelect: 'none' }}>
                              {q.delivery_method}
                            </span>
                            {q.delivery_info && (
                              <Popover
                                anchorRef={addressAnchorRef}
                                open={addressPopupId === q.quote_id}
                                onClose={() => setAddressPopupId(null)}
                                gap={6}
                                width={280}
                                style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 10, padding: '12px 14px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}
                              >
                                <div>
                                  <div style={{ fontSize: 10, color: MUTED, fontWeight: 700, marginBottom: 8 }}>배송 정보</div>
                                  <div style={{ marginBottom: 10 }}>
                                    {q.delivery_info!.split('\n').map((line, i) => {
                                      const [key, ...rest] = line.split(': ')
                                      const val = rest.join(': ')
                                      return (
                                        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 4, fontSize: 12, lineHeight: 1.5 }}>
                                          <span style={{ color: MUTED, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0 }}>{key}</span>
                                          <span style={{ color: TEXT, wordBreak: 'break-all' }}>{val}</span>
                                        </div>
                                      )
                                    })}
                                  </div>
                                  <button
                                    onClick={() => {
                                      const addressLine = q.delivery_info!.split('\n').find(l => l.startsWith('주소: '))
                                      const addressOnly = addressLine ? addressLine.replace('주소: ', '') : q.delivery_info!
                                      navigator.clipboard.writeText(addressOnly)
                                      setCopiedId(q.quote_id)
                                      setTimeout(() => setCopiedId(null), 1500)
                                    }}
                                    style={{ width: '100%', padding: '5px 0', background: copiedId === q.quote_id ? '#f0fdf4' : '#f3f4f6', border: `1px solid ${copiedId === q.quote_id ? '#bbf7d0' : BORDER}`, borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 700, color: copiedId === q.quote_id ? GREEN : GRAY, transition: 'all 0.2s' }}>
                                    {copiedId === q.quote_id ? '✓ 복사됨' : '주소 복사'}
                                  </button>
                                </div>
                              </Popover>
                            )}
                          </div>
                        ) : <span style={{ color: MUTED, fontSize: 11 }}>-</span>}
                      </td>
                      <td style={{ padding: '9px 10px', fontWeight: 700, whiteSpace: 'nowrap', textAlign: 'center' }}>₩{numKR(q.total_supply)}</td>
                      <td style={{ padding: '9px 10px', color: TEXT, fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap', textAlign: 'center' }}>{fmtShort(q.purchase_order_at?.slice(0, 10) ?? null)}</td>
                      <td style={{ padding: '9px 10px', whiteSpace: 'nowrap', textAlign: 'center' }}>
                        {q.shipping_date
                          ? <span style={{ color: '#1d4ed8', fontWeight: 700, fontSize: 12 }}>{fmtShort(q.shipping_date)}</span>
                          : <span style={{ color: MUTED, fontSize: 12 }}>-</span>}
                      </td>
                      <td style={{ padding: '9px 10px', whiteSpace: 'nowrap', textAlign: 'center' }}>
                        {q.order_memo ? (
                          <div ref={hoveredMemoId === q.quote_id ? memoAnchorRef : null} style={{ display: 'inline-block' }}
                            onMouseEnter={() => setHoveredMemoId(q.quote_id)}
                            onMouseLeave={() => setHoveredMemoId(null)}>
                            <span style={{ fontSize: 11, cursor: 'help', color: GRAY }}>📋 메모</span>
                            {/* 표 컨테이너가 자르지 못하도록 포털로 띄운다. 원래대로 위쪽을 먼저 시도한다. */}
                            <Popover
                              anchorRef={memoAnchorRef}
                              open={hoveredMemoId === q.quote_id}
                              onClose={() => setHoveredMemoId(null)}
                              prefer="top"
                              gap={6}
                              style={{ background: '#1e293b', color: '#e2e8f0', borderRadius: 9, padding: '8px 12px', fontSize: 11, minWidth: 160, maxWidth: 260, lineHeight: 1.6, boxShadow: '0 4px 20px rgba(0,0,0,0.3)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', pointerEvents: 'none' }}
                            >
                              <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 3, fontWeight: 700 }}>담당자 메모</div>
                              {q.order_memo}
                            </Popover>
                          </div>
                        ) : <span style={{ color: MUTED, fontSize: 11 }}>-</span>}
                      </td>
                      <td style={{ padding: '9px 10px', whiteSpace: 'nowrap', textAlign: 'center' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center' }}>
                          <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: sc.bg, color: sc.text, whiteSpace: 'nowrap' }}>
                            {q.status === '세금계산서 요청' ? '세금계산서 발행 요청' : q.status}
                          </span>
                          {q.status === '세금계산서 요청' && q.tax_invoice_date && (
                            <span style={{ fontSize: 10, color: '#b45309', fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtTaxDate(q.tax_invoice_date)}</span>
                          )}
                          {q.status === '주문완료' && q.order_completed_by && (
                            <span style={{ fontSize: 10, color: MUTED, whiteSpace: 'nowrap' }}>
                              처리 <span style={{ color: '#0369a1', fontWeight: 700 }}>
                                {q.order_completed_by.includes(' ') ? q.order_completed_by : [q.order_completed_by, engMap[q.order_completed_by]].filter(Boolean).join(' ')}
                              </span>
                            </span>
                          )}
                          {q.status === '매출완료' && q.tax_completed_by && (
                            <span style={{ fontSize: 10, color: MUTED, whiteSpace: 'nowrap' }}>
                              처리 <span style={{ color: GREEN, fontWeight: 700 }}>
                                {q.tax_completed_by.includes(' ') ? q.tax_completed_by : [q.tax_completed_by, engMap[q.tax_completed_by]].filter(Boolean).join(' ')}
                              </span>
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '9px 10px', whiteSpace: 'nowrap', textAlign: 'center' }}>
                        {q.purchase_order_url ? (
                          <button onClick={() => handleViewPO(q)}
                            style={{ padding: '4px 9px', background: '#f3f4f6', border: `1px solid ${BORDER}`, borderRadius: 7, cursor: 'pointer', fontSize: 11, fontWeight: 700, color: TEXT }}>
                            PDF
                          </button>
                        ) : <span style={{ color: MUTED, fontSize: 11 }}>-</span>}
                      </td>
                      <td style={{ padding: '9px 10px', whiteSpace: 'nowrap', position: 'relative' }}>
                        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', paddingRight: 28 }}>
                          {q.status === '발주(주문 대기)' && (
                            <button
                              onClick={() => { setOrderModal(q); setShippingDate(q.shipping_date || ''); setOrderMemo(q.order_memo || '') }}
                              style={{ padding: '4px 10px', background: '#7c3aed', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 11, fontWeight: 700, color: '#fff' }}>
                              주문완료 처리
                            </button>
                          )}
                          {q.status === '세금계산서 요청' && (
                            <button
                              onClick={() => setTaxModal(q)}
                              style={{ padding: '4px 10px', background: '#b45309', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 11, fontWeight: 700, color: '#fff' }}>
                              발행완료 처리
                            </button>
                          )}
                          {(q.status === '주문완료' || q.status === '매출완료') && (
                            <span style={{ fontSize: 10, color: MUTED, padding: '3px 8px', borderRadius: 6, border: `1px solid ${BORDER}`, fontWeight: 600 }}>처리완료</span>
                          )}
                        </div>
                        <button
                          onClick={() => { setEditScheduleModal(q); setEditShippingDate(q.shipping_date || ''); setEditOrderMemo(q.order_memo || '') }}
                          style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: `1px solid ${BORDER}`, borderRadius: 6, cursor: 'pointer', fontSize: 13, color: MUTED }}
                          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#f3f4f6'; (e.currentTarget as HTMLButtonElement).style.color = GRAY }}
                          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; (e.currentTarget as HTMLButtonElement).style.color = MUTED }}>
                          ⋮
                        </button>
                      </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
          )}
        </div>
      </div>

      {/* 주문완료 처리 모달 */}
      {orderModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: Z.modal, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 400, padding: 28, boxShadow: '0 12px 48px rgba(0,0,0,0.25)' }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: TEXT, marginBottom: 4 }}>주문완료 처리</div>
            <div style={{ fontSize: 12, color: GRAY, marginBottom: 20 }}>{orderModal.quote_number} · {custMap[orderModal.customer_id ?? 0] ?? '-'}</div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: GRAY, marginBottom: 5, fontWeight: 600 }}>출하 예정일</div>
              <input type="date" value={shippingDate} onChange={e => setShippingDate(e.target.value)}
                style={{ ...inp, colorScheme: 'light' }} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: GRAY, marginBottom: 5, fontWeight: 600 }}>기타사항</div>
              <textarea value={orderMemo} onChange={e => setOrderMemo(e.target.value)} rows={3}
                placeholder="납품 조건, 특이사항 등 메모"
                style={{ ...inp, resize: 'vertical', lineHeight: 1.5 }} />
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setOrderModal(null)} disabled={processing}
                style={{ flex: 1, padding: 10, background: '#f3f4f6', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
                취소
              </button>
              <button onClick={handleCompleteOrder} disabled={processing}
                style={{ flex: 1, padding: 10, background: BLUE, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13, opacity: processing ? 0.7 : 1 }}>
                {processing ? '처리 중...' : '주문완료 확정'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 세금계산서 발행완료 모달 */}
      {taxModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: Z.modal, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 380, padding: 28, boxShadow: '0 12px 48px rgba(0,0,0,0.25)' }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: TEXT, marginBottom: 4 }}>세금계산서 발행 완료</div>
            <div style={{ fontSize: 12, color: GRAY, marginBottom: 16 }}>{taxModal.quote_number} · {custMap[taxModal.customer_id ?? 0] ?? '-'}</div>

            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '12px 14px', marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: '#92400e', fontWeight: 700, marginBottom: 4 }}>요청 내용</div>
              <div style={{ fontSize: 12, color: '#78350f' }}>
                {taxModal.tax_invoice_date ? `요청일: ${fmtShort(taxModal.tax_invoice_date)}` : '요청일 미지정'}
              </div>
            </div>

            <p style={{ fontSize: 13, color: TEXT, marginBottom: 20, lineHeight: 1.6 }}>
              세금계산서 발행 완료 처리 시 상태가 <strong style={{ color: GREEN }}>매출완료</strong>로 변경되고 견적 발행자에게 알림이 전송됩니다.
            </p>

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setTaxModal(null)} disabled={taxProcessing}
                style={{ flex: 1, padding: 10, background: '#f3f4f6', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
                취소
              </button>
              <button onClick={handleCompleteTax} disabled={taxProcessing}
                style={{ flex: 1, padding: 10, background: GREEN, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13, opacity: taxProcessing ? 0.7 : 1 }}>
                {taxProcessing ? '처리 중...' : '발행완료 확정'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 출하일정/메모 편집 모달 */}
      {editScheduleModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: Z.modal, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 400, padding: 28, boxShadow: '0 12px 48px rgba(0,0,0,0.25)' }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: TEXT, marginBottom: 4 }}>일정/메모 수정</div>
            <div style={{ fontSize: 12, color: GRAY, marginBottom: 20 }}>{editScheduleModal.quote_number} · {custMap[editScheduleModal.customer_id ?? 0] ?? '-'}</div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: GRAY, marginBottom: 5, fontWeight: 600 }}>출하 예정일</div>
              <input type="date" value={editShippingDate} onChange={e => setEditShippingDate(e.target.value)}
                style={{ ...inp, colorScheme: 'light' }} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: GRAY, marginBottom: 5, fontWeight: 600 }}>메모</div>
              <textarea value={editOrderMemo} onChange={e => setEditOrderMemo(e.target.value)} rows={3}
                placeholder="납품 조건, 특이사항 등 메모"
                style={{ ...inp, resize: 'vertical', lineHeight: 1.5 }} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setEditScheduleModal(null)} disabled={editSaving}
                style={{ flex: 1, padding: 10, background: '#f3f4f6', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
                취소
              </button>
              <button onClick={handleEditSchedule} disabled={editSaving}
                style={{ flex: 1, padding: 10, background: BLUE, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13, opacity: editSaving ? 0.7 : 1 }}>
                {editSaving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
