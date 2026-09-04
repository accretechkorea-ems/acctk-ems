'use client'

// 리드 관리 — /lead 공개 폼으로 들어온 리드를 확인하고 처리한다.
// 영업관리 메뉴 안에 있지만 영업 업무라 접근 권한은 영업 현황과 같은 canViewPipeline 을 쓴다.

import { useEffect, useMemo, useRef, useState, Suspense, Fragment, type CSSProperties } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { usePageGuard } from '@/hooks/usePageGuard'
import { canViewLeads, isSuperAdmin } from '@/lib/permissions'
import { withTeamPerm } from '@/lib/teamPerms'
import AccessGate from '@/components/common/AccessGate'
import { useToast } from '@/components/common/Toast'
import { useConfirm } from '@/components/common/ConfirmDialog'
import { getCategoryColor, SALES_STATUS_COLORS, type CategoryColor } from '@/lib/categoryColors'
import SegmentedControl from '@/components/common/SegmentedControl'
import Popover from '@/components/common/Popover'
import { Z } from '@/lib/zIndex'
import { josa } from '@/lib/josa'

import {
  LEAD_STATUS_NEW, LEAD_STATUS_ACTIVE, LEAD_STATUS_CONVERTED, LEAD_STATUS_SKIPPED,
  COMPETITOR_OTHER, MAX_LEN, SKIP_REASON_MIN, isLeadClosed,
} from '@/lib/leadOptions'

const BLUE = '#234ea2'
const TEXT = '#111827'
const MUTED = '#6b7280'
const FAINT = '#9ca3af'
const BORDER = '#ebebeb'
const CARD_BG = '#ffffff'
const PAGE_BG = '#fafafa'
// 표의 세 단계를 서로 다른 기존 값으로 갈라 놓는다 — 같은 값을 쓰면 헤더·hover·펼친 행이 구분되지 않는다.
const ROW_HOVER = '#f8fafc'   // 마우스만 올린 행
const HEAD_BG = '#f3f4f6'     // 헤더 · 열린 행 — 활동 현황의 중립 배경(뱃지·칩과 같은 값)
const ACCENT_BAR = BLUE       // 열린 행 왼쪽 액센트 바
const DANGER = '#dc2626'
// 경고 상자 배경 — 관리자 화면의 삭제 사유 상자와 같은 값.
const DANGER_BG = '#fef2f2'

// 리드 상태 배지 색. 새 색은 만들지 않고 SALES_STATUS_COLORS 안에서만 골라 쓴다.
//   신규     ← '견적중'   아직 손대지 않은 건(amber)
//   진행중   ← '수주'     담당자가 붙어 굴러가는 건(blue)
//   전환완료 ← '매출완료' 성공적으로 끝난 건(green)
//   미진행   ← '보류'     더 가지 않기로 끝낸 건(gray). '실패'(red)는 과한 표현이라 쓰지 않는다.
const LEAD_STATUS_COLOR_KEY: Record<string, string> = {
  [LEAD_STATUS_NEW]: '견적중',
  [LEAD_STATUS_ACTIVE]: '수주',
  [LEAD_STATUS_CONVERTED]: '매출완료',
  [LEAD_STATUS_SKIPPED]: '보류',
}
const leadStatusColor = (status: string): CategoryColor =>
  getCategoryColor(SALES_STATUS_COLORS, LEAD_STATUS_COLOR_KEY[status])

type Lead = {
  lead_id: number
  lead_no: string | null
  partner_company: string; partner_name: string; partner_contact: string | null
  customer_company: string; industry: string; products: string
  address: string | null; city: string; country: string
  interest_product: string; request_note: string | null
  competitor: string[] | null; competitor_other: string | null
  budget_status: string; purchase_period: string | null; expected_purchase: string | null
  contact_name: string | null; contact_dept: string | null; contact_title: string | null
  contact_email: string; contact_office_tel: string | null; contact_mobile: string
  meeting_note: string
  /** 명함 이미지의 스토리지 파일명(비공개 버킷). 없으면 null. */
  business_card_url: string | null
  status: string; assigned_to: number | null; admin_memo: string | null; skip_reason: string | null
  converted_opportunity_id: number | null
  created_at: string
}

type Engineer = { engineer_id: number; name: string | null; position: string | null; teams: string | null; permission_level: string | null; resigned_date: string | null }
type Customer = { customer_id: number; company_name: string | null; address: string | null }

const th: CSSProperties = { padding: '9px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: MUTED, whiteSpace: 'nowrap' }
const td: CSSProperties = { padding: '10px 10px', fontSize: 12, color: TEXT, whiteSpace: 'nowrap' }

// ── 아래 다섯 개는 활동 현황 화면의 규칙을 그대로 옮긴 것이다(새 값 없음) ──
// 카드: 활동 카드와 같은 흰 바탕 · 1px 테두리 · radius 8 · padding 14/16
const cardStyle: CSSProperties = { background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '14px 16px' }
// 카드 제목: 활동 카드의 이름 줄(17/800/-0.3px) + 아래 구분선(paddingBottom 12, marginBottom 14)
const cardTitle: CSSProperties = {
  fontSize: 17, fontWeight: 800, color: TEXT, letterSpacing: '-0.3px', lineHeight: 1.2,
  marginBottom: 14, paddingBottom: 12, borderBottom: `1px solid ${BORDER}`,
}
// 카드 안 줄 간격: 활동 카드의 유형 목록과 같은 7px
const cardRows: CSSProperties = { display: 'grid', gap: 7 }
// 카드 안에서 구역을 나눌 때: 배경이 아니라 선 + 12px 여백(활동 카드의 합계 줄과 같은 방식)
const dividerTop: CSSProperties = { marginTop: 12, paddingTop: 12, borderTop: `1px solid ${BORDER}` }
// 입력칸: 활동 현황 필터 카드의 input 과 같은 값
const inpStyle: CSSProperties = {
  padding: '8px 11px', border: `1px solid ${BORDER}`, borderRadius: 6, background: CARD_BG,
  color: TEXT, fontSize: 13, outline: 'none', fontFamily: 'inherit',
}
// 실행 버튼: 활동 현황의 조회 버튼(파랑) / 비활성은 동선 보기 버튼의 회색 규칙
const primaryBtn = (disabled: boolean): CSSProperties => ({
  padding: '7px 16px', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 700,
  fontFamily: 'inherit', whiteSpace: 'nowrap', transition: 'background 0.15s ease',
  background: disabled ? '#f3f4f6' : BLUE, color: disabled ? FAINT : '#fff',
  cursor: disabled ? 'not-allowed' : 'pointer',
})
// 취소 버튼: 상세 모달 닫기 버튼과 같은 회색 조합
const ghostBtn: CSSProperties = {
  padding: '7px 16px', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 700,
  fontFamily: 'inherit', whiteSpace: 'nowrap', background: '#f3f4f6', color: MUTED, cursor: 'pointer',
}

// 라벨-값 한 줄: 라벨은 상세 목록의 보조 텍스트(12/#9ca3af), 값은 유형 텍스트(13/500/#111827),
// 줄 높이는 활동 카드의 행 높이(20px)를 쓴다.
const dlRow: CSSProperties = { display: 'flex', gap: 8, fontSize: 13, lineHeight: '20px' }
const dlKey: CSSProperties = { width: 78, flexShrink: 0, color: FAINT, fontSize: 12 }

/**
 * 경쟁사 표시 문자열. 배열을 쉼표로 잇고, '기타' 가 있으면 직접 입력값을 덧붙인다.
 * 화면과 PDF 가 같은 규칙을 쓰도록 한곳에 둔다.
 */
function competitorText(lead: Lead) {
  const list = lead.competitor ?? []
  if (!list.length) return ''
  const joined = list.join(', ')
  return list.includes(COMPETITOR_OTHER) && lead.competitor_other
    ? `${joined} (${lead.competitor_other})`
    : joined
}

/**
 * PDF 파일명 한 토막. 파일명에 쓸 수 없는 문자와 제어문자를 지우고 공백을 한 칸으로 줄인다.
 * 전부 지워져 빈 값이 되면 '-' 로 자리를 채운다(빈 토막이 이어져 __ 가 되지 않게).
 */
const safeFilePart = (v: string) =>
  (v || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim() || '-'

/**
 * <리드번호>_<파트너사>_<고객사>_<관심제품>.pdf
 * 번호가 아직 없는 리드는 등록일(YYYYMMDD)을 그 자리에 쓴다 — 메일에 첨부했을 때
 * 무엇의 출력물인지 구분되는 값이어야 하고, 화면에 없는 내부 id 를 드러내지 않는다.
 */
function leadPdfFileName(lead: Lead) {
  const head = lead.lead_no?.trim() || lead.created_at.slice(0, 10).replace(/-/g, '')
  return [head, lead.partner_company, lead.customer_company, lead.interest_product]
    .map(safeFilePart)
    .join('_') + '.pdf'
}

/** 상세의 한 줄. 값이 비면 '-' 로 자리를 지킨다. */
function Row({ k, v }: { k: string; v: string | null | undefined }) {
  return (
    <div style={dlRow}>
      <span style={dlKey}>{k}</span>
      <span style={{ color: TEXT, fontWeight: 500, minWidth: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{v?.trim() || '-'}</span>
    </div>
  )
}

/**
 * 명함 썸네일. 버킷이 비공개라 파일명만으로는 그릴 수 없어 서명 URL 을 받아 온다.
 * 발급이 실패하면(권한·파일 없음) 아무것도 그리지 않는다 — 깨진 이미지 아이콘을 보이는 것보다 낫다.
 */
function LeadCardThumb({ path, onOpen }: { path: string; onOpen: (url: string) => void }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const res = await fetch(`/api/lead-card?path=${encodeURIComponent(path)}`)
        const json = await res.json().catch(() => ({}))
        if (!res.ok) { console.error('[leads] 명함 URL 발급 실패', { path, status: res.status, json }); return }
        if (!cancelled && json.signedUrl) setUrl(json.signedUrl as string)
      } catch (e) {
        console.error('[leads] 명함 URL 발급 실패', { path, error: e })
      }
    }
    run()
    return () => { cancelled = true }
  }, [path])

  if (!url) return null
  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${BORDER}` }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: FAINT, marginBottom: 6 }}>명함</div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt="명함"
        onClick={() => onOpen(url)}
        title="클릭하면 크게 볼 수 있습니다"
        style={{ width: '100%', maxWidth: 220, maxHeight: 140, objectFit: 'contain', border: `1px solid ${BORDER}`, borderRadius: 6, background: '#fff', cursor: 'zoom-in', display: 'block' }}
      />
    </div>
  )
}

function LeadsPageInner() {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useToast()
  const confirm = useConfirm()
  const { engineer: me, loading: guardLoading, authorized } = usePageGuard(canViewLeads)
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
  // 미진행 사유 입력값. 메모와 같은 방식으로 리드 id 를 함께 들고 있는다.
  const [skipDraft, setSkipDraft] = useState<{ id: number; text: string } | null>(null)
  // 처리 줄에서 펼친 입력 영역. 한 번에 하나만 열리므로 리드 id + 종류 한 쌍이면 충분하다.
  const [panel, setPanel] = useState<{ id: number; kind: 'memo' | 'convert' | 'skip' } | null>(null)
  const [custQuery, setCustQuery] = useState('')
  const [custOpen, setCustOpen] = useState(false)
  // 고객사 검색 결과는 표 컨테이너 밖으로 나가야 해서 포털로 띄운다. 그 기준이 되는 입력칸.
  const custAnchorRef = useRef<HTMLDivElement>(null)
  const [pickedCustomer, setPickedCustomer] = useState<Customer | null>(null)
  // 전환된 리드는 고객사명을 그대로 입력해야 지워진다. 어느 리드에서 확인 중인지와 입력값을 함께 들고 있는다.
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; text: string } | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)
  const [pdfBusy, setPdfBusy] = useState<number | null>(null)
  // 명함 크게 보기. 썸네일이 이미 받아온 서명 URL 을 그대로 쓴다(다시 발급하지 않는다).
  const [cardViewer, setCardViewer] = useState<string | null>(null)
  useEffect(() => {
    if (!cardViewer) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCardViewer(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [cardViewer])

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
        supabase.from('customers').select('customer_id, company_name, address').is('deleted_at', null).eq('is_parent', false),
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

  // 담당자 후보 — 리드 권한이 있는 재직자만. 리드를 받을 수 없는 사람은 후보에 넣지 않는다.
  const [assignable, setAssignable] = useState<Engineer[]>([])
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const rows = await Promise.all(
        engineers.filter(e => !e.resigned_date).map(async e => ({ e, ok: canViewLeads(await withTeamPerm(e)) }))
      )
      if (!cancelled) setAssignable(rows.filter(r => r.ok).map(r => r.e))
    }
    if (engineers.length) run()
    return () => { cancelled = true }
  }, [engineers])

  /**
   * 담당자 드롭다운에 넣을 목록. 후보는 리드 권한이 있는 재직자지만, 이미 배정된 사람이
   * 그 조건에서 벗어나면(퇴사·권한 회수) 목록에서 빠져 select 가 저장된 값과 다른 항목을
   * 가리킨다. 그래서 현재 배정된 사람은 이유를 붙여 목록에 남긴다.
   */
  const assigneeOptions = (currentId: number | null) => {
    const list = assignable.map(e => ({ id: e.engineer_id, label: [e.name, e.position].filter(Boolean).join(' ') }))
    if (currentId != null && !list.some(o => o.id === currentId)) {
      const e = engineers.find(x => x.engineer_id === currentId)
      const why = !e ? '없는 계정' : e.resigned_date ? '퇴사' : '리드 권한 없음'
      list.push({ id: currentId, label: `${engName(currentId)} (${why})` })
    }
    return list
  }

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

  /** 처리 줄의 입력 영역을 닫고 그 안의 임시 입력값을 버린다. */
  const closePanel = () => {
    setPanel(null)
    setMemoDraft(null); setSkipDraft(null)
    setPickedCustomer(null); setCustQuery(''); setCustOpen(false)
  }

  /** 같은 것을 다시 누르면 닫히고, 다른 것을 누르면 그쪽으로 바뀐다(한 번에 하나만 열린다). */
  const togglePanel = (leadId: number, kind: string) => {
    const same = panel?.id === leadId && panel.kind === kind
    closePanel()
    if (!same) setPanel({ id: leadId, kind: kind as 'memo' | 'convert' | 'skip' })
  }

  /** 펼친 리드의 메모 입력값. 아직 손대지 않았으면 저장된 값을 그대로 보여준다. */
  const memoValue = (lead: Lead) => (memoDraft?.id === lead.lead_id ? memoDraft.text : (lead.admin_memo ?? ''))

  const openLead = (lead: Lead) => {
    const next = openId === lead.lead_id ? null : lead.lead_id
    setClickedId(next)
    closePanel()
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
   * 담당자 배정. 상태는 손으로 고르지 않고 배정을 따라간다(배정하면 진행중, 풀면 신규).
   * 서버가 같은 규칙으로 쓰므로 화면에 반영할 값도 여기서 같이 계산한다.
   * 이미 종결된 건(전환완료·미진행)의 상태는 배정을 바꿔도 그대로 둔다.
   */
  const assign = (lead: Lead, assignedTo: number | null) =>
    callManage(
      lead.lead_id,
      { action: 'assign', assignedTo },
      isLeadClosed(lead.status)
        ? { assigned_to: assignedTo }
        : { assigned_to: assignedTo, status: assignedTo === null ? LEAD_STATUS_NEW : LEAD_STATUS_ACTIVE },
      '담당자를 저장했습니다.',
    )

  /** 미진행 처리 — 담당자가 사유를 남기고 리드를 닫는다. 전환과 마찬가지로 되돌릴 수 없다. */
  const skipLead = async (lead: Lead) => {
    const reason = (skipDraft?.id === lead.lead_id ? skipDraft.text : '').trim()
    if (reason.length < SKIP_REASON_MIN) { toast.error(`미진행 사유를 ${SKIP_REASON_MIN}자 이상 입력해주세요.`); return }
    const ok = await confirm({
      title: '미진행 처리',
      message: `${lead.customer_company} 리드를 미진행으로 닫습니다. 되돌릴 수 없습니다.`,
      confirmText: '미진행 처리',
      variant: 'danger',
    })
    if (!ok) return
    const res = await callManage(
      lead.lead_id,
      { action: 'skip', reason },
      { status: LEAD_STATUS_SKIPPED, skip_reason: reason },
      '미진행으로 처리했습니다.',
    )
    if (res) closePanel()
  }

  /**
   * 리드 상세를 PDF 로 내려받는다. 배정된 담당자에게 메일로 보내는 용도라
   * 저장(스토리지)도 기록(download_logs)도 남기지 않는다 — 만들어서 바로 내려주기만 한다.
   * 화면 상세와 같은 항목만 담고 담당자·상태·메모 같은 관리 정보는 넣지 않는다.
   */
  /**
   * PDF 에 넣을 명함을 data URL 로 만든다.
   * 서명 URL 을 그대로 넘기면 react-pdf 가 스스로 받아오는데, 만료·CORS 를 우리가 통제할 수 없다.
   * 여기서 한 번 받아 base64 로 바꿔 넘기면 그런 변수가 사라진다.
   * 실패하면 null — 명함만 빠지고 PDF 는 그대로 만든다.
   */
  const loadCardDataUrl = async (path: string | null): Promise<string | null> => {
    if (!path) return null
    try {
      const res = await fetch(`/api/lead-card?path=${encodeURIComponent(path)}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.signedUrl) {
        console.error('[leads] PDF 명함 URL 발급 실패', { path, status: res.status, json })
        return null
      }
      const blob = await (await fetch(json.signedUrl as string)).blob()
      return await new Promise<string | null>(resolve => {
        const reader = new FileReader()
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
        reader.onerror = () => resolve(null)
        reader.readAsDataURL(blob)
      })
    } catch (e) {
      console.error('[leads] PDF 명함 준비 실패', { path, error: e })
      return null
    }
  }

  const downloadPdf = async (lead: Lead) => {
    setPdfBusy(lead.lead_id)
    try {
      // @react-pdf/renderer 는 무거워서 리드 화면 첫 로딩에 얹지 않는다. 누를 때 불러온다.
      const [{ pdf }, { LeadPDFDoc }, businessCard] = await Promise.all([
        import('@react-pdf/renderer'),
        import('./LeadPDFDoc'),
        loadCardDataUrl(lead.business_card_url),
      ])
      const blob = await pdf(
        <LeadPDFDoc
          leadNo={lead.lead_no}
          createdAt={lead.created_at.slice(0, 10)}
          partnerCompany={lead.partner_company}
          partnerName={lead.partner_name}
          partnerContact={lead.partner_contact}
          customerCompany={lead.customer_company}
          industry={lead.industry}
          products={lead.products}
          address={lead.address}
          city={lead.city}
          country={lead.country}
          interestProduct={lead.interest_product}
          budgetStatus={lead.budget_status}
          purchasePeriod={lead.purchase_period}
          expectedPurchase={lead.expected_purchase}
          competitor={competitorText(lead)}
          requestNote={lead.request_note}
          contactName={lead.contact_name}
          contactDeptTitle={[lead.contact_dept, lead.contact_title].filter(Boolean).join(' / ')}
          contactEmail={lead.contact_email}
          contactOfficeTel={lead.contact_office_tel}
          contactMobile={lead.contact_mobile}
          meetingNote={lead.meeting_note}
          businessCard={businessCard}
        />
      ).toBlob()

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = leadPdfFileName(lead)
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('PDF 를 만들지 못했습니다.')
    } finally {
      setPdfBusy(null)
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
      message: `${lead.partner_company}${josa(lead.partner_company, '이')} 등록한 ${lead.customer_company} 리드를 삭제합니다. 되돌릴 수 없습니다.`,
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
    closePanel()
  }

  // 접근은 세 갈래다.
  //   superadmin           → 통과(전체)
  //   리드 권한 + 배정 있음 → 통과(자기 건)
  //   리드 권한 + 배정 0건 → 잘못된 것이 아니라 아직 받은 일이 없는 상태이므로 문구를 달리한다
  //   리드 권한 없음        → 권한 없음
  if (!authorized) return <AccessGate loading={guardLoading} />
  if (!loading && !isAdmin && leads.length === 0) {
    return (
      <AccessGate
        loading={false}
        title="배정된 리드가 없습니다"
        message="담당으로 배정된 리드가 생기면 여기에 표시됩니다."
      />
    )
  }

  return (
    <div style={{ background: PAGE_BG, minHeight: '100vh', padding: '20px 24px 48px' }}>
      {/* 상세 격자와 노트 스크롤바. 활동 현황의 .adm-thin-scroll 과 같은 규칙을 쓴다.
          접히는 기준은 화면 폭이 아니라 상세가 놓인 칸의 폭이다 — 상세는 표 안에 있어
          화면이 좁아도 칸은 표만큼 넓다. */}
      <style>{`
        .ld-scope { container-type: inline-size; }
        .ld-detail { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12; align-items: stretch; }
        .ld-cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12; align-content: start; }
        /* 노트 칸의 높이는 왼쪽 4개 카드가 정한다. 카드를 흐름에서 빼지 않으면 긴 노트가
           행 높이를 밀어 올려 왼쪽 카드 아래에 빈 칸이 생긴다. */
        .ld-note-slot { position: relative; min-height: 180px; }
        .ld-note-card { position: absolute; inset: 0; }
        .ld-note { scrollbar-width: thin; scrollbar-color: #d1d5db transparent; }
        .ld-note::-webkit-scrollbar { width: 6px; }
        .ld-note::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 3px; }
        .ld-note::-webkit-scrollbar-track { background: transparent; }
        @container (max-width: 900px) {
          .ld-detail { grid-template-columns: minmax(0, 1fr); }
          /* 세로로 접히면 맞출 높이가 없다 — 흐름으로 되돌리고 대신 최대 높이를 준다. */
          .ld-note-slot { position: static; }
          .ld-note-card { position: static; max-height: 420px; }
        }
        @container (max-width: 560px) { .ld-cards { grid-template-columns: minmax(0, 1fr); } }
      `}</style>
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

        <div style={{ background: CARD_BG, borderRadius: 8, border: `1px solid ${BORDER}`, overflowX: 'auto' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 60, color: MUTED, fontSize: 13 }}>불러오는 중...</div>
          ) : sorted.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: MUTED, fontSize: 13 }}>등록된 리드가 없습니다</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                {/* 헤더 — 옅은 배경만으로는 흰 행과 잘 안 갈라져, 관리자 견적서 표와 같은 2px 아래선을 함께 준다 */}
                <tr style={{ background: HEAD_BG, borderBottom: `2px solid ${BORDER}` }}>
                  {['번호', '등록일', '파트너사', '고객사', '관심제품', '담당자', '상태'].map(h => <th key={h} style={th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {sorted.map(lead => {
                  const open = openId === lead.lead_id
                  const sc = leadStatusColor(lead.status)
                  const converted = lead.status === LEAD_STATUS_CONVERTED || !!lead.converted_opportunity_id
                  // 종결 = 더 손댈 수 없는 상태. 전환완료·미진행이면 두 버튼을 모두 잠근다.
                  const closed = converted || isLeadClosed(lead.status)
                  // 사유가 최소 길이를 넘어야 미진행 버튼이 열린다(서버도 같은 길이를 다시 본다).
                  const skipReady = (skipDraft?.id === lead.lead_id ? skipDraft.text : '').trim().length >= SKIP_REASON_MIN
                  const busy = saving === lead.lead_id
                  const isAssignee = lead.assigned_to === myEngineerId
                  // 처리 줄의 선택지. 관리자는 담당자 배정과 메모, 담당자는 메모·전환·미진행을 쓴다.
                  // 메모는 접혀 있으면 내용이 있는지 알 수 없으므로 suffix 로 표시한다(활동 현황의 건수 suffix 와 같은 자리).
                  const actions = [
                    ...(isAdmin || isAssignee
                      ? [{ label: '메모', value: 'memo', suffix: (lead.admin_memo ?? '').trim() ? '있음' : undefined }]
                      : []),
                    ...(isAssignee
                      ? [
                          { label: '영업기회 전환', value: 'convert', disabled: closed },
                          { label: '미진행 처리', value: 'skip', disabled: closed },
                        ]
                      : []),
                  ]
                  const openPanel = panel?.id === lead.lead_id ? panel.kind : ''
                  const memoDirty = memoValue(lead) !== (lead.admin_memo ?? '')
                  return (
                    <Fragment key={lead.lead_id}>
                      {/* 열린 행 표시는 목록 쪽에만 둔다 — 중립 배경 + 왼쪽 액센트 바.
                          아래선을 지워 바로 밑 상세와 한 덩어리로 읽히게 한다. */}
                      <tr
                        onClick={() => openLead(lead)}
                        style={{ borderBottom: open ? 'none' : `1px solid ${BORDER}`, cursor: 'pointer', background: open ? HEAD_BG : undefined }}
                        onMouseEnter={e => { if (!open) e.currentTarget.style.background = ROW_HOVER }}
                        onMouseLeave={e => { if (!open) e.currentTarget.style.background = '' }}
                      >
                        {/* 번호가 없는 리드(발급 실패)는 자리를 비우지 않고 - 로 채운다 */}
                        <td style={{ ...td, fontWeight: 700, color: lead.lead_no ? BLUE : FAINT, borderLeft: open ? `3px solid ${ACCENT_BAR}` : `3px solid transparent` }}>
                          {lead.lead_no ?? '-'}
                        </td>
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
                        <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                          {/* 상세는 활동 현황과 같은 구조 — 옅은 바탕 위에 흰 카드가 놓인다. */}
                          <td colSpan={7} style={{ padding: 12, background: PAGE_BG }}>
                            <div className="ld-scope">
                            <div className="ld-detail">
                              {/* 왼쪽 2×2. 같은 행끼리 높이가 맞는다(그리드 기본 stretch). */}
                              <div className="ld-cards">
                                <div style={cardStyle}>
                                  <div style={cardTitle}>파트너사</div>
                                  <div style={cardRows}>
                                    <Row k="회사명" v={lead.partner_company} />
                                    <Row k="등록자" v={lead.partner_name} />
                                    <Row k="연락처" v={lead.partner_contact} />
                                  </div>
                                </div>
                                <div style={cardStyle}>
                                  <div style={cardTitle}>고객사</div>
                                  <div style={cardRows}>
                                    <Row k="회사명" v={lead.customer_company} />
                                    <Row k="산업군" v={lead.industry} />
                                    <Row k="생산품" v={lead.products} />
                                    <Row k="주소" v={lead.address} />
                                    <Row k="시 / 국가" v={`${lead.city} / ${lead.country}`} />
                                  </div>
                                </div>
                                <div style={cardStyle}>
                                  <div style={cardTitle}>관심 제품</div>
                                  <div style={cardRows}>
                                    <Row k="관심 제품" v={lead.interest_product} />
                                    <Row k="예산" v={lead.budget_status} />
                                    <Row k="구매 기간" v={lead.purchase_period} />
                                    <Row k="구매 시기" v={lead.expected_purchase} />
                                    <Row k="경쟁사" v={competitorText(lead)} />
                                    <Row k="요청사항" v={lead.request_note} />
                                  </div>
                                </div>
                                <div style={cardStyle}>
                                  <div style={cardTitle}>고객 정보</div>
                                  <div style={cardRows}>
                                    <Row k="이름" v={lead.contact_name} />
                                    <Row k="부서 / 직위" v={[lead.contact_dept, lead.contact_title].filter(Boolean).join(' / ')} />
                                    <Row k="이메일" v={lead.contact_email} />
                                    <Row k="회사번호" v={lead.contact_office_tel} />
                                    <Row k="휴대폰" v={lead.contact_mobile} />
                                  </div>
                                  {/* 명함 — 첨부된 리드에만 나온다. 비공개 버킷이라 서명 URL 을 받아 그린다. */}
                                  {lead.business_card_url && (
                                    <LeadCardThumb path={lead.business_card_url} onOpen={setCardViewer} />
                                  )}
                                </div>
                              </div>

                              {/* 미팅 노트 — 왼쪽 전체 높이에 맞춰 늘어나고, 길면 이 안에서만 스크롤한다.
                                  짧아도 자리가 유지되도록 최소 높이를 둔다. */}
                              <div className="ld-note-slot">
                                <div className="ld-note-card" style={{ ...cardStyle, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                                  <div style={cardTitle}>미팅 노트</div>
                                  <div
                                    className="ld-note"
                                    style={{
                                      flex: 1, minHeight: 0, overflowY: 'auto',
                                      fontSize: 13, color: TEXT, lineHeight: '22px',
                                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                    }}
                                  >
                                    {lead.meeting_note}
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* ── 처리 ── 활동 현황의 필터 카드처럼 한 줄에 늘어놓고, 누른 것만 아래로 펼친다. */}
                            <div style={{ ...cardStyle, marginTop: 12 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                {/* 배정은 관리자만 한다. 담당자에게는 배정된 사람 이름만 보인다. */}
                                {isAdmin ? (
                                  <select
                                    value={lead.assigned_to ?? ''}
                                    disabled={busy}
                                    onChange={e => assign(lead, e.target.value ? Number(e.target.value) : null)}
                                    style={{ ...inpStyle, width: 'auto' }}
                                  >
                                    <option value="">배정 안 함</option>
                                    {assigneeOptions(lead.assigned_to).map(o => (
                                      <option key={o.id} value={o.id}>{o.label}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <span style={{ fontSize: 13, color: TEXT, whiteSpace: 'nowrap' }}>
                                    <span style={{ color: FAINT, marginRight: 6 }}>담당자</span>
                                    {engName(lead.assigned_to)}
                                  </span>
                                )}
                                {actions.length > 0 && (
                                  <SegmentedControl
                                    value={openPanel}
                                    options={actions}
                                    onChange={v => togglePanel(lead.lead_id, v)}
                                  />
                                )}
                                {/* PDF 출력 — 관리자만. 누르면 펼쳐지는 영역 없이 바로 받아지므로
                                    "하나만 열린다"는 SegmentedControl 에 넣지 않고 따로 둔다. */}
                                {isAdmin && (
                                  <button
                                    onClick={() => downloadPdf(lead)}
                                    disabled={pdfBusy === lead.lead_id}
                                    style={{ ...ghostBtn, cursor: pdfBusy === lead.lead_id ? 'default' : 'pointer', color: pdfBusy === lead.lead_id ? FAINT : MUTED }}
                                  >{pdfBusy === lead.lead_id ? '만드는 중...' : 'PDF 출력'}</button>
                                )}
                              </div>

                              {/* 종결된 리드는 무엇으로 끝났는지와 그 사유를 여기서 밝힌다(버튼은 잠겨 있다). */}
                              {closed && (
                                <div style={{ ...dividerTop, display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                                  <span style={{ padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700, background: sc.bg, color: sc.text, flexShrink: 0 }}>
                                    {lead.status}
                                  </span>
                                  <span style={{ flex: '1 1 240px', minWidth: 0, fontSize: 13, color: MUTED, lineHeight: '20px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                    {converted
                                      ? `영업기회 #${lead.converted_opportunity_id} 로 전환되었습니다.`
                                      : (lead.skip_reason?.trim() || '사유가 남아 있지 않습니다.')}
                                  </span>
                                </div>
                              )}

                              {/* ── 메모 ── */}
                              {openPanel === 'memo' && (
                                <div style={dividerTop}>
                                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                    <input
                                      value={memoValue(lead)}
                                      maxLength={MAX_LEN.request_note}
                                      onChange={e => setMemoDraft({ id: lead.lead_id, text: e.target.value })}
                                      placeholder="처리 메모"
                                      style={{ ...inpStyle, flex: '1 1 260px', minWidth: 0 }}
                                    />
                                    <button
                                      disabled={busy || !memoDirty}
                                      onClick={() => callManage(lead.lead_id, { action: 'memo', memo: memoValue(lead) }, { admin_memo: memoValue(lead).trim() || null }, '메모를 저장했습니다.')}
                                      style={primaryBtn(busy || !memoDirty)}
                                    >저장</button>
                                    <button onClick={closePanel} style={ghostBtn}>취소</button>
                                  </div>
                                </div>
                              )}

                              {/* ── 영업기회 전환 — 배정받은 담당자만 열 수 있다. ── */}
                              {openPanel === 'convert' && (
                                <div style={dividerTop}>
                                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                                    <div ref={custAnchorRef} style={{ flex: '1 1 260px', minWidth: 0 }}>
                                      {pickedCustomer ? (
                                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                          <div style={{ ...inpStyle, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {pickedCustomer.company_name ?? '-'}
                                            {pickedCustomer.address && <span style={{ marginLeft: 6, fontSize: 12, color: FAINT }}>{pickedCustomer.address}</span>}
                                          </div>
                                          <button
                                            onClick={() => { setPickedCustomer(null); setCustQuery(''); setCustOpen(true) }}
                                            style={ghostBtn}
                                          >변경</button>
                                        </div>
                                      ) : (
                                        <input
                                          value={custQuery}
                                          onChange={e => { setCustQuery(e.target.value); setCustOpen(true) }}
                                          onFocus={() => setCustOpen(true)}
                                          placeholder="업체명으로 검색"
                                          style={{ ...inpStyle, width: '100%' }}
                                        />
                                      )}
                                      {/* 표 컨테이너가 자르지 못하도록 포털로 띄운다(위치만 입력칸을 따라간다) */}
                                      <Popover
                                        anchorRef={custAnchorRef}
                                        open={custOpen && !pickedCustomer && custMatches.length > 0}
                                        onClose={() => setCustOpen(false)}
                                        matchAnchorWidth
                                        maxHeight={240}
                                        style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                                      >
                                          {custMatches.map(c => (
                                            <div key={c.customer_id}
                                              onMouseDown={ev => { ev.preventDefault(); setPickedCustomer(c); setCustOpen(false) }}
                                              style={{ padding: '8px 11px', cursor: 'pointer' }}
                                              onMouseEnter={ev => { ev.currentTarget.style.background = '#f5f5f5' }}
                                              onMouseLeave={ev => { ev.currentTarget.style.background = 'transparent' }}
                                            >
                                              <div style={{ fontSize: 13, fontWeight: 500, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.company_name ?? '-'}</div>
                                              <div style={{ fontSize: 12, color: FAINT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.address ?? '주소 없음'}</div>
                                            </div>
                                          ))}
                                      </Popover>
                                    </div>
                                    <button
                                      disabled={busy || !pickedCustomer}
                                      onClick={() => convert(lead)}
                                      style={primaryBtn(busy || !pickedCustomer)}
                                    >
                                      {busy ? '전환 중...' : '영업기회로 전환'}
                                    </button>
                                    <button onClick={closePanel} style={ghostBtn}>취소</button>
                                  </div>
                                  {custQuery.trim() && custMatches.length === 0 && !pickedCustomer && (
                                    <div style={{ fontSize: 12, color: FAINT, marginTop: 6, lineHeight: '20px' }}>
                                      검색 결과가 없습니다. 고객사가 등록되어 있지 않다면 고객사를 먼저 등록해주세요.
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* ── 미진행 처리 — 되돌릴 수 없어 사유를 받는다. ── */}
                              {openPanel === 'skip' && (
                                <div style={dividerTop}>
                                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                    <input
                                      value={skipDraft?.id === lead.lead_id ? skipDraft.text : ''}
                                      onChange={e => setSkipDraft({ id: lead.lead_id, text: e.target.value })}
                                      maxLength={MAX_LEN.skip_reason}
                                      placeholder={`미진행 사유 (${SKIP_REASON_MIN}자 이상)`}
                                      style={{ ...inpStyle, flex: '1 1 260px', minWidth: 0 }}
                                    />
                                    <button
                                      disabled={busy || !skipReady}
                                      onClick={() => skipLead(lead)}
                                      style={primaryBtn(busy || !skipReady)}
                                    >미진행 처리</button>
                                    <button onClick={closePanel} style={ghostBtn}>취소</button>
                                  </div>
                                </div>
                              )}

                              {/* 삭제 — superadmin 에게만 보인다. 서버도 같은 권한을 다시 확인한다. */}
                              {isSuperAdmin(me) && (
                                <div style={dividerTop}>
                                  {deleteConfirm?.id === lead.lead_id ? (
                                    <div style={{ background: DANGER_BG, border: `1px solid ${BORDER}`, borderRadius: 6, padding: 12 }}>
                                      <div style={{ fontSize: 13, color: TEXT, lineHeight: '22px', marginBottom: 10 }}>
                                        이 리드는 영업기회 #{lead.converted_opportunity_id} 으로 전환되었습니다.<br />
                                        삭제하면 해당 영업기회의 출처 기록이 사라집니다.<br />
                                        영업기회 자체는 삭제되지 않습니다.
                                      </div>
                                      <div style={{ fontSize: 12, color: FAINT, marginBottom: 6 }}>
                                        삭제하려면 고객사명 「{lead.customer_company}」 을 입력하세요
                                      </div>
                                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                        <input
                                          value={deleteConfirm.text}
                                          onChange={e => setDeleteConfirm({ id: lead.lead_id, text: e.target.value })}
                                          placeholder={lead.customer_company}
                                          style={{ ...inpStyle, flex: '1 1 200px', minWidth: 0 }}
                                        />
                                        <button
                                          disabled={deleting === lead.lead_id || deleteConfirm.text.trim() !== lead.customer_company.trim()}
                                          onClick={() => removeLead(lead, deleteConfirm.text)}
                                          style={{
                                            ...primaryBtn(deleting === lead.lead_id || deleteConfirm.text.trim() !== lead.customer_company.trim()),
                                            background: deleting === lead.lead_id || deleteConfirm.text.trim() !== lead.customer_company.trim() ? '#f3f4f6' : DANGER,
                                          }}
                                        >{deleting === lead.lead_id ? '삭제 중...' : '삭제'}</button>
                                        <button
                                          onClick={() => setDeleteConfirm(null)}
                                          disabled={deleting === lead.lead_id}
                                          style={ghostBtn}
                                        >취소</button>
                                      </div>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => askDelete(lead)}
                                      disabled={deleting === lead.lead_id}
                                      style={{
                                        ...primaryBtn(deleting === lead.lead_id),
                                        background: deleting === lead.lead_id ? '#f3f4f6' : DANGER,
                                      }}
                                    >{deleting === lead.lead_id ? '삭제 중...' : '리드 삭제'}</button>
                                  )}
                                </div>
                              )}
                            </div>
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

      {/* 명함 크게 보기. 화면에 이 용도의 기존 부품이 없어 새로 둔다 —
          겹칠 것이 없는 전체 화면 오버레이라 바깥 클릭·ESC 로만 닫는다. */}
      {cardViewer && (
        <div
          onClick={() => setCardViewer(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: Z.fullscreen, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32, cursor: 'zoom-out' }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cardViewer} alt="명함" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 8, background: '#fff' }} />
        </div>
      )}
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
