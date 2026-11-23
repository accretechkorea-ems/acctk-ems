'use client'

// 목록 보기의 **오른쪽 — 회사를 골랐을 때**. 회사 카드 + 사업장 표 + 일괄 작업 바.
//
// ── 고치는 방식은 하나다 ──────────────────────────────────────────────────
//   전에는 회사 제목 옆 연필(이름)·드롭다운(분류)·표의 칸 클릭(사업장명·대리점·상태)으로
//   **한 화면에서 세 가지 방식**으로 고쳤다. 어디를 눌러야 고쳐지는지 알 수 없고, 잘못
//   눌러 고쳐지는 일도 생겼다. 이제 둘 뿐이다.
//     · 회사 → 카드의 「수정」 → 회사 수정 모달(회사명·영문명·분류·메모)
//     · 사업장 → 줄 끝의 연필 → 사업장 수정 모달(상세 화면과 **같은 모달·같은 저장 규칙**)
//   여러 줄을 한 번에 바꾸는 일(대리점·상태·회사 이동)만 아래 일괄 바가 맡는다.

import { Fragment, useMemo, useState, type CSSProperties } from 'react'
import { createClient } from '@/lib/supabase/client'
import CompanySearchModal from '@/components/home/list/CompanySearchModal'
import CompanyEditModal, { type CompanyEditForm } from '@/components/home/list/CompanyEditModal'
import CustomerEditModal from '@/components/customer/modals/CustomerEditModal'
import { AddIconButton, EditIconButton } from '@/components/common/IconButton'
import SalesActivityModal from '@/components/customer/modals/SalesActivityModal'
import RecordAddModal, { type HoldingDraft } from '@/components/customer/modals/RecordAddModal'
import QuoteHistoryModal from '@/components/customer/modals/QuoteHistoryModal'
import SiteMergeModal, { type MergeReport } from '@/components/home/list/SiteMergeModal'
import BulkBar from '@/components/home/list/BulkBar'
import { customerChange } from '@/lib/customerChange'
import BulkApplyModal from '@/components/home/list/BulkApplyModal'
import {
  DIRECT_SALE_OPTION_LABEL, DIRECT_SALE_VALUE, bulkDoneText, currentValueCounts,
} from '@/lib/bulkActions'
import ActivityTimeline from '@/components/customer/ActivityTimeline'
import { useCompanyTimeline } from '@/hooks/useCompanyTimeline'
import { useQuotePdf } from '@/hooks/customer/useQuotePdf'
import { useOpportunityCrud } from '@/hooks/customer/useOpportunityCrud'
import { createHolding } from '@/lib/holdingCreate'
import { isSuperAdmin } from '@/lib/permissions'
import type { Holding, Quote, SalesActivity, SalesActivityForm } from '@/components/customer/types'
import { saveCustomerEdit } from '@/lib/saveCustomerEdit'
import { invalidateParents } from '@/components/customer/ParentPicker'
import { DIRECT_SALE_LABEL, invalidateAgencies, useAgencies } from '@/lib/customerAgency'
import { daysLabel, isStale, regionTextOf, type CompanyGroup, type SiteRow } from '@/lib/customerList'
import type { Customer } from '@/components/customer/types'
import { companyForecast } from '@/lib/companyForecast'
import { numKR } from '@/components/customer/constants'
import { R } from '@/lib/radius'
import { TITLE } from '@/lib/textTokens'
import { TOP_CARD_FIXED_MIN_WIDTH, TOP_CARD_HEIGHT } from '@/components/home/SidePanel'
import BackIconButton from '@/components/common/BackIconButton'
import ConvertAgencyModal, { type ConvertReport } from '@/components/home/list/ConvertAgencyModal'

/** /api/parent-company 한 번. 결과를 한글 메시지로 바꿔 돌려준다. */
async function callRoute(body: Record<string, unknown>): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  const res = await fetch('/api/parent-company', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json?.error) return { ok: false, error: json?.error ?? `서버 오류 (${res.status})` }
  return { ok: true, data: json }
}

const BORDER = '#ebebeb'
const TEXT = '#111827'
const SUB = '#6b7280'
const MUTED = '#9ca3af'
const FAINT = '#d1d5db'
const BLUE = '#234ea2'
const NEUTRAL = '#f3f4f6'
const DANGER = '#ef4444'

const STATUS_DOT: Record<string, string> = { '활성': '#16a34a', '잠재': '#f59e0b', '이탈': '#ef4444' }
const STATUSES = ['활성', '잠재', '이탈']

// 카드·패널은 역할대로 R.card 다(이 화면은 역할까지 맞췄다 — 전체 치환은 값만 옮겼다).
const card: CSSProperties = { background: '#ffffff', border: `1px solid ${BORDER}`, borderRadius: R.card }
const th: CSSProperties = {
  fontSize: 11, fontWeight: 700, color: SUB, textAlign: 'left', height: 36, padding: '0 10px',
  borderBottom: `1px solid ${BORDER}`, background: '#fafafa', whiteSpace: 'nowrap',
}
const td: CSSProperties = { height: 44, padding: '0 10px', borderBottom: `1px solid ${BORDER}`, whiteSpace: 'nowrap', fontSize: 13, color: TEXT }

/** 수치 타일·포캐스트 블록의 바탕. 카드 안의 한 단 들어간 면이다. */
const TILE_BG = '#fafafa'

/**
 * 수치 타일 하나 — 라벨은 위 가운데 작게, 값은 정중앙 크게. 네 칸의 높이가 같다.
 * 「최근 활동」만 값이 날짜(열 자리)라 글자를 줄이고 아래에 유형·작성자를 붙인다.
 */
/**
 * 수치 타일 — 높이는 **카드가 정한다**(그 안에서 남는 높이를 나눠 쓴다).
 * 라벨을 절대 위치로 띄워 두므로 위 여백(22)이 그 자리다. 전에는 minHeight 92 였는데,
 * 카드 높이를 좌 패널과 맞추면서(137) 그만큼이 남지 않는다 — 2026-11-21 실측으로
 * 타일 75px 에서 라벨·숫자·아래줄이 다 들어간다.
 */
function StatTile({ label, value, unit, note, color = TEXT, valueSize = 24, onClick, title }: {
  label: string
  value: string
  unit?: string
  /** 누를 수 있는 타일이면 준다 — 누르면 그 수치의 속을 연다(진행 견적 → 견적 이력). */
  onClick?: () => void
  title?: string
  note?: string
  color?: string
  valueSize?: number
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      title={title}
      onMouseEnter={onClick ? (e => { e.currentTarget.style.borderColor = BLUE }) : undefined}
      onMouseLeave={onClick ? (e => { e.currentTarget.style.borderColor = BORDER }) : undefined}
      style={{
        position: 'relative', minHeight: 70, height: '100%', width: '100%', padding: '22px 8px 8px', boxSizing: 'border-box',
        background: TILE_BG, border: `1px solid ${BORDER}`, borderRadius: R.tile,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
        cursor: onClick ? 'pointer' : 'default', fontFamily: 'inherit',
        transition: 'border-color 0.15s ease',
      }}>
      <span style={{ position: 'absolute', top: 8, left: 0, right: 0, textAlign: 'center', fontSize: 11, color: MUTED }}>{label}</span>
      <span className="num" style={{ display: 'flex', alignItems: 'baseline', fontSize: valueSize, fontWeight: 700, lineHeight: 1, color }}>
        {value}
        {unit && <span style={{ fontSize: 12, fontWeight: 500, color: MUTED, marginLeft: 3 }}>{unit}</span>}
      </span>
      {note && <span style={{ fontSize: 11, color: MUTED, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{note}</span>}
    </Tag>
  )
}

export type CompanyPaneProps = {
  group: CompanyGroup
  /** 작성자 id → 이름. 「최근 활동 · 작성자」 칸이 쓴다. */
  engineerName: (id: number | null | undefined) => string
  /** 저장이 끝나면 부른다 — 화면이 목록을 다시 읽는다. */
  onSaved: () => void
  onError: (message: string) => void
  onToast: (message: string) => void
  /** 사업장 줄을 눌렀을 때(상세로). */
  onOpenSite: (siteId: number) => void
  /** 「+ 사업장 추가」 — 이 회사로 고정된 등록 폼을 연다. */
  onAddSite: () => void
  /**
   * 슈퍼관리자인가 — **회사명·영문명·병합**은 그 사람만 한다(그 아래 사업장 이름까지
   * 전부 다시 만들기 때문이다). 분류·메모와 사업장 수준의 일은 고객사 메뉴면 된다.
   */
  canEditCompany: boolean
  /**
   * 저장이 끝나기 전에 화면의 줄을 먼저 고친다(낙관적). 다시 읽기가 곧 덮는다.
   * 일괄 작업처럼 **무엇이 어떻게 바뀌는지 확실한** 자리에서만 쓴다.
   */
  onPatchLocal?: (ids: number[], patch: Record<string, unknown>) => void
  /** 사업장 화면에서 ← 로 돌아왔을 때 타임라인에 켜 둘 사업장. */
  focusSiteId?: number | null
  /** 활동 현황에서 넘어온 줄 — 그 줄로 내려가 잠깐 밝힌다(lib/activity.ts). */
  focusKey?: string | null
  onFocused?: () => void
  /** 지금 사람 — 영업 기록의 작성자이고, 자기 글만 고칠 수 있다. */
  me: { engineer_id: number | null; permission_level: string | null }
  /** 견적 PDF 를 열 때. 회사 전체 타임라인의 견적 줄이 쓴다. */
  onOpenQuote?: (quote: Quote) => void
  /**
   * 대리점으로 전환이 끝났을 때 — 그 대리점 화면으로 옮겨 간다(2026-11-21).
   * 주지 않으면 전환 버튼을 두지 않는다(갈 곳이 없는 전환은 하지 않는다).
   */
  onConverted?: (agencyId: number) => void
  /**
   * 목록으로 — **폰에서만** 쓰는 길이다(app/page.tsx 의 .pane-back).
   * 폰에서는 pane 이 폭을 다 쓰고 좌 패널이 숨으므로 돌아갈 문이 하나 있어야 한다.
   */
  onBackToList?: () => void
}

export default function CompanyPane({
  group, engineerName, onSaved, onError, onToast, onOpenSite, onAddSite, canEditCompany, me, onOpenQuote, focusSiteId, focusKey, onFocused, onBackToList, onConverted, onPatchLocal,
}: CompanyPaneProps) {
  const supabase = createClient()
  const agencies = useAgencies()
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  /** 회사 수정 모달. */
  const [editCompanyOpen, setEditCompanyOpen] = useState(false)
  /** 대리점 전환 확인 창. */
  const [convertOpen, setConvertOpen] = useState(false)
  /** 사업장 수정 모달 — 고친 줄. */
  const [editSite, setEditSite] = useState<Customer | null>(null)
  /** 「다른 회사로 이동」의 고르는 창. */
  const [moveOpen, setMoveOpen] = useState(false)
  /** 열려 있는 적용 모달 — 대리점·상태만 이 창을 쓴다(이동·병합은 자기 창이 있다). */
  const [bulkOpen, setBulkOpen] = useState<'agency' | 'status' | null>(null)
  /** 「+ 기록」 창 — 영업 활동·포캐스트·홀딩을 한 창에서 고른다. */
  const [recordOpen, setRecordOpen] = useState(false)
  /** 견적 이력 창 — 「진행 견적」 타일을 누르면 열린다(끝난 건까지 전부). */
  const [quoteHistoryOpen, setQuoteHistoryOpen] = useState(false)
  /** 「전체 보기」를 누른 횟수 — 활동 이력을 포캐스트만으로 걸러 달라는 신호다. */
  const [forecastOnly, setForecastOnly] = useState(0)
  /** 사업장 병합 창. */
  const [siteMergeOpen, setSiteMergeOpen] = useState(false)
  /** 영업 기록 창 — 회사 화면에서는 어느 사업장인지 함께 고른다. */
  const [activityOpen, setActivityOpen] = useState(false)
  const [editingActivity, setEditingActivity] = useState<SalesActivity | null>(null)
  const [activitySiteId, setActivitySiteId] = useState<number | null>(null)
  const [savingActivity, setSavingActivity] = useState(false)

  /** 회사 전체 활동 — 사업장 전부를 한 번에 읽는다(hooks/useCompanyTimeline.ts). */
  const siteIds = useMemo(() => group.sites.map(s => s.customer.customer_id), [group.sites])
  const timeline = useCompanyTimeline(siteIds)
  // 견적 PDF — 상세 화면과 같은 훅(서명 URL + 조회 기록).
  const { openQuotePdf } = useQuotePdf({ customer: null, engineerId: me.engineer_id })
  /** 타임라인의 사업장 칩·열이 쓰는 이름표. */
  const siteOptions = useMemo(
    // 이름이 비어 있는 사업장도 칩·사업장 열에 **이름이 있어야** 고를 수 있다.
    // 표·트리는 빨간 「입력 필요」로 알리고, 여기서는 고르는 이름이 필요해 괄호로 적는다.
    () => group.sites.map(s => ({ id: s.customer.customer_id, name: s.siteName || '(이름 없음)' })),
    [group.sites],
  )
  /** 회사 카드의 포캐스트 블록 — 진행 중인 건만(lib/companyForecast.ts). */
  const forecast = useMemo(() => {
    const nameOf = new Map(siteOptions.map(s => [s.id, s.name]))
    return companyForecast({
      opportunities: timeline.opportunities,
      siteName: id => (id == null ? '' : nameOf.get(id) ?? ''),
      // 카드 안에는 **두 줄까지**. 카드 높이를 좌 패널과 맞추면서(137px) 세 줄이
      // 들어가지 않는다 — 나머지는 「전체 보기 ›」가 활동 이력에서 펼친다.
      limit: 2,
    })
  }, [timeline.opportunities, siteOptions])

  /** 가장 최근에 움직인 사업장 — 영업 기록의 기본값이다. */
  const recentSiteId = useMemo(() => {
    const best = [...group.sites].sort((a, b) => (b.touch?.date ?? '').localeCompare(a.touch?.date ?? ''))[0]
    return best?.customer.customer_id ?? null
  }, [group.sites])

  // 회사를 바꿔 고르면 이 조각은 **통째로 다시 그려진다** — 부르는 쪽이 key 에 회사 id 를
  // 준다(app/page.tsx). 그래서 앞 회사의 선택·편집 상태를 effect 로 털 필요가 없다.

  const toggle = (id: number) => {
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

/**
   * 고른 여러 줄을 한 번에 바꾼다(일괄 바 전용).
   *
   * **라우트가 한다**(2026-11-23) — 브라우저가 표를 직접 고치면 사건(customer_events)을
   * 적을 수 없다. 그 표는 service role 만 쓸 수 있기 때문이다.
   */
  const saveBulk = async (body: Record<string, unknown>, done: string, optimistic?: Record<string, unknown>) => {
    if (busy || selected.length === 0) return
    setBusy(true)
    const r = await customerChange({ ...body, ids: selected })
    setBusy(false)
    if (!r.ok) { onError(r.error); return }
    // 바꾼 값을 **먼저** 화면에 넣는다 — 다시 읽기(300ms 안팎)를 기다리지 않게.
    if (optimistic) onPatchLocal?.(selected, optimistic)
    onToast(done)
    onSaved()
  }

  /**
   * 회사 수정 저장 — **두 길로 나뉜다.**
   *   · 회사명·영문명 … 라우트(superadmin). 사업장 이름을 전부 다시 만들기 때문이다.
   *   · 분류·메모 … 회사 줄 한 칸이라 바로 쓴다(좌 패널의 분류 일괄 지정과 같은 문턱).
   * 그래서 슈퍼관리자가 아니어도 분류·메모는 고칠 수 있고, 이름 칸만 잠겨 보인다.
   */
  const saveCompany = async (form: CompanyEditForm) => {
    if (busy) return
    const name = form.name.trim()
    if (!name) { onError('회사명을 입력해주세요'); return }
    const nameChanged = name !== group.companyName.trim()
    const enChanged = form.nameEn.trim() !== (group.nameEn ?? '').trim()
    const industryChanged = form.industry !== (group.industry ?? '')
    const noteChanged = form.note.trim() !== (group.note ?? '').trim()
    if (!nameChanged && !enChanged && !industryChanged && !noteChanged) { setEditCompanyOpen(false); return }

    setBusy(true)
    let renamed = 0
    if (nameChanged || enChanged) {
      const r = await callRoute({
        action: 'rename', parentId: group.companyId, name,
        industry: form.industry, nameEn: form.nameEn.trim(),
      })
      if (!r.ok) { setBusy(false); onError(r.error); return }
      renamed = (r.data.renamedSites as number) ?? 0
    }
    if (industryChanged || noteChanged) {
      const patch: Record<string, unknown> = {}
      if (industryChanged) patch.industry = form.industry || null
      if (noteChanged) patch.note = form.note.trim() || null
      // 라우트가 저장하고 분류가 바뀐 때 사건도 적는다(2026-11-23).
      const r = await customerChange({ action: 'company-edit', id: group.companyId, patch })
      if (!r.ok) { setBusy(false); onError(r.error); return }
    }
    setBusy(false)
    invalidateParents()   // 회사 목록 캐시가 옛 이름·분류를 들고 있다
    setEditCompanyOpen(false)
    onToast(nameChanged && renamed > 0
      ? `회사 정보를 수정했습니다 (사업장 ${renamed}곳 이름도 함께)`
      : '회사 정보를 수정했습니다')
    onSaved()
  }

  /**
   * 대리점으로 전환할 수 없는 이유 — 없으면 null(버튼이 켜진다).
   *
   * 살아있는 사업장이 **정확히 1곳**일 때만 한다. 2곳 이상이면 어느 줄이 대리점인지
   * 사람이 정해야 하고, 0곳이면 전환할 줄이 없다. 서버(DB 함수)도 같은 것을 다시 보므로
   * 여기서는 **버튼을 잠그고 이유를 말하는** 일만 한다.
   */
  const convertReason = !canEditCompany
    // 라우트가 superadmin 을 요구한다(회사 수준 작업이다 — 이름·병합·삭제와 같은 문턱).
    // 화면에서도 같은 말을 해 둔다: 그냥 누르면 「Forbidden」만 돌아온다(2026-11-21 실측).
    ? '슈퍼관리자만 전환할 수 있습니다'
    : (group.sites.length === 1
      ? null
      : (group.sites.length === 0
        ? '사업장이 없는 회사는 전환할 수 없습니다'
        : `사업장이 ${group.sites.length}곳입니다 — 1곳일 때만 전환할 수 있습니다`))

  /**
   * 전환을 실행한다. 끝나면 **대리점 화면으로** 옮겨 간다 — 방금 만든 줄이 어디에
   * 있는지 바로 보여야 한다(회사 줄은 닫혀 목록에서 사라진다).
   */
  const runConvert = async () => {
    if (busy) return
    setBusy(true)
    const r = await callRoute({ action: 'convert-agency', parentId: group.companyId, dryRun: false })
    setBusy(false)
    if (!r.ok) { onError(r.error); return }
    const report = r.data.report as ConvertReport
    if (!report?.ok) { onError('전환하지 못했습니다 — 막는 기록이 있습니다'); return }
    setConvertOpen(false)
    invalidateParents()    // 회사 목록 캐시가 닫힌 회사를 들고 있다
    invalidateAgencies()   // 대리점 목록 캐시에 새 줄이 없다
    onToast(`${group.companyName} 를 대리점으로 바꿨습니다`)
    onSaved()
    onConverted?.(report.site_id)
  }

  /** 사업장 수정 — 상세 화면과 **같은 모달·같은 저장 규칙**(lib/saveCustomerEdit.ts). */
  const saveSite = async (form: Parameters<typeof saveCustomerEdit>[1]) => {
    if (!editSite || busy) return
    setBusy(true)
    const r = await saveCustomerEdit(editSite, form)
    setBusy(false)
    if (!r.ok) { onError(r.message); return }
    setEditSite(null)
    onToast('사업장 정보를 수정했습니다')
    onSaved()
  }

  /** 사업장 병합 — ① 먼저 세어 보고(dry run) ② 확인을 받은 뒤 실행한다. */
  const siteMergeDryRun = async (keepId: number, fromIds: number[]): Promise<MergeReport | null> => {
    const r = await callRoute({ action: 'merge-sites', keepId, fromIds, dryRun: true })
    if (!r.ok) { onError(r.error); return null }
    return r.data.report as MergeReport
  }

  const runSiteMerge = async (keepId: number, fromIds: number[], siteName: string) => {
    if (busy) return
    setBusy(true)
    const r = await callRoute({ action: 'merge-sites', keepId, fromIds, siteName: siteName || undefined })
    setBusy(false)
    if (!r.ok) { onError(r.error); return }
    const report = r.data.report as MergeReport
    setSiteMergeOpen(false)
    setChecked(new Set())
    onToast(`사업장 ${fromIds.length}곳을 합쳤습니다 (기록 ${report?.total ?? 0}건 이동)`)
    onSaved()
    timeline.reload()
  }

  /** 영업 기록 — 회사 화면에서는 사업장을 골라 그 줄에 붙인다. */
  const saveActivity = async (form: SalesActivityForm, siteIdArg?: number) => {
    const siteId = siteIdArg ?? activitySiteId ?? recentSiteId
    if (!siteId) { onError('사업장을 고르세요'); return }
    if (!me.engineer_id) { onError('사용자 정보를 불러오는 중입니다'); return }
    setSavingActivity(true)
    const nowIso = new Date().toISOString()
    const { error } = editingActivity
      ? await supabase.from('sales_activities').update({
          opportunity_id: form.opportunity_id,
          activity_date: form.activity_date,
          activity_type: form.activity_type,
          contact_id: form.contact_id,
          content: form.content.trim(),
          updated_at: nowIso,
        }).eq('activity_id', editingActivity.activity_id)
      : await supabase.from('sales_activities').insert({
          customer_id: siteId,
          engineer_id: me.engineer_id,
          opportunity_id: form.opportunity_id,
          activity_date: form.activity_date,
          activity_type: form.activity_type,
          contact_id: form.contact_id,
          content: form.content.trim(),
        })
    setSavingActivity(false)
    if (error) { onError(error.message || '영업 기록을 저장하지 못했습니다'); return }
    setActivityOpen(false)
    setRecordOpen(false)
    setEditingActivity(null)
    onToast(editingActivity ? '영업 기록을 수정했습니다' : '영업 기록을 추가했습니다')
    timeline.reload()
    onSaved()
  }

  /**
   * 포캐스트 — 저장은 상세·파이프라인과 **같은 훅**이 한다
   * (hooks/customer/useOpportunityCrud.ts). 업체를 폼에서 고르는 길을 쓰므로
   * customerId 는 null 로 두고 고른 사업장을 form.customer_id 에 넣는다.
   */
  const oppCrud = useOpportunityCrud({
    customerId: null,
    engineerId: me.engineer_id,
    role: me.permission_level,
    fetchDetail: async () => { timeline.reload(); onSaved(); setRecordOpen(false); return true },
  })

  /** 홀딩 — insert 는 장비 카드와 같은 함수다(lib/holdingCreate.ts). */
  const saveHolding = async (draft: HoldingDraft) => {
    if (!me.engineer_id) { onError('사용자 정보를 불러오는 중입니다'); return }
    setSavingActivity(true)
    const r = await createHolding(supabase, {
      customerId: draft.customerId,
      deviceId: draft.deviceId,
      title: draft.title,
      startedAt: draft.startedAt,
      firstNote: draft.firstNote,
      engineerId: me.engineer_id,
    })
    setSavingActivity(false)
    if (!r.ok) { onError(r.message); return }
    if (r.noteFailed) onError('홀딩은 등록됐지만 메모 저장에 실패했습니다')
    setRecordOpen(false)
    onToast('홀딩을 등록했습니다')
    timeline.reload()
    onSaved()
  }

  /** 자기가 쓴 기록이거나 슈퍼관리자면 고칠 수 있다(상세 화면과 같은 규칙). */
  const canEditActivity = (a: SalesActivity) =>
    isSuperAdmin({ permission_level: me.permission_level }) || (me.engineer_id != null && a.engineer_id === me.engineer_id)

  /** 고른 사업장을 다른 회사로 옮긴다. 참조는 사업장에 붙어 있어 그대로 따라간다. */
  const moveSites = async (toId: number, toName: string) => {
    if (busy) return
    setMoveOpen(false)
    setBusy(true)
    const r = await callRoute({ action: 'move', toParentId: toId, siteIds: [...checked] })
    setBusy(false)
    if (!r.ok) { onError(r.error); return }
    setChecked(new Set())
    onToast(`사업장 ${(r.data.moved as number) ?? 0}곳을 「${toName}」 로 옮겼습니다`)
    onSaved()
  }

  const selected = [...checked]
  /** 고른 **줄**(지금 값을 보여 주려면 id 만으로는 모자란다). */
  const pickedRows = group.sites.filter(s => checked.has(s.customer.customer_id))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>

      {/* 줄 호버에서만 보이는 연필 — 평소에는 표가 글자만으로 조용하다.
          키보드로 올 때도 보여야 하므로 :focus-within 을 함께 둔다. */}
      <style>{`
        .site-row .site-edit { opacity: 0; transition: opacity 0.12s ease }
        .site-row:hover .site-edit, .site-row:focus-within .site-edit { opacity: 1 }
        /* 좁은 화면에서 표가 옆으로 밀려도 연필은 오른쪽 끝에 붙어 있다 —
           스크롤해야 나타나면 「고치기」를 못 찾는다. */
        .site-edit-cell { position: sticky; right: 0; background: #ffffff }
        .site-row:hover .site-edit-cell { background: #fafafa }
        .site-row.on .site-edit-cell { background: #fafafa }
        /* 회사 카드의 ✎·＋ — 사업장 카드와 같은 규칙이다. 호버·포커스에서만 보이고
           자리는 늘 차지한다(나타날 때 제목이 밀리지 않게). 폰에는 호버가 없어 늘 보인다. */
        .company-card .card-act { opacity: 0; transition: opacity 0.15s ease }
        .company-card:hover .card-act, .company-card:focus-within .card-act { opacity: 1 }
        @media (max-width: 640px) { .company-card .card-act { opacity: 1 } }
        /* 수치 네 칸 + 포캐스트 — 좁으면 **아래로 쌓인다.**
           좌 칸을 440px 로 못 박아 두었더니 폰(390)에서는 그 한 칸만으로 화면을 넘어
           카드 안쪽이 오른쪽으로 잘렸다(2026-11-20 실측: 넘치는 요소 29개).
           두 칸을 한 칸으로 돌리고 타일은 2×2 로 접는다. */
        @media (max-width: 760px) {
          .company-card .stat-row { grid-template-columns: minmax(0, 1fr) !important }
          .company-card .stat-tiles { grid-template-columns: repeat(2, 1fr) !important }
        }
        /* 좌 패널의 상단 카드와 같은 높이 — 두 카드의 윗선·아랫선이 맞는다. */
        @media (min-width: ${TOP_CARD_FIXED_MIN_WIDTH}px) {
          .company-card { height: ${TOP_CARD_HEIGHT}px; overflow: hidden }
        }
      `}</style>

      {/* ── 회사 카드 ── 1줄: 이름·분류·버튼 / 2줄: 수치 타일 + 포캐스트 ── */}
      {/* 카드 높이는 좌 패널의 상단 카드와 **같은 값**이다(TOP_CARD_HEIGHT) —
          사업장·대리점 화면도 같은 높이라 보기를 바꿀 때 카드 아랫선이 움직이지 않는다.
          그 높이에 맞춰 안쪽 여백 16→12, 줄 사이 12→8 로 줄였다. 폰에서는 고정을 푼다. */}
      <section className="company-card" style={{ ...card, padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
          {onBackToList && (
            <span className="pane-back">
              <BackIconButton onClick={onBackToList} label="목록으로" />
            </span>
          )}
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: TEXT, letterSpacing: '-0.5px' }}>{group.companyName}</h1>
          {group.nameEn && <span style={{ fontSize: 13, color: MUTED }}>{group.nameEn}</span>}
          {group.industry && (
            <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: R.tag, background: NEUTRAL, color: SUB }}>{group.industry}</span>
          )}
          <span style={{ flex: 1 }} />
          <span className="card-act" style={{ display: 'inline-flex', gap: 8 }}>
            <EditIconButton label="회사 정보 수정" onClick={() => setEditCompanyOpen(true)} />
            <AddIconButton label="사업장 추가" onClick={onAddSite} />
          </span>
        </div>

        {/* 좌 440px 에 수치 네 칸, 남는 자리에 포캐스트. 좁으면 아래로 쌓인다. */}
        <div className="stat-row" style={{ display: 'grid', gridTemplateColumns: '440px minmax(0, 1fr)', gap: 12, alignItems: 'stretch', flex: 1, minHeight: 0 }}>
          <div className="stat-tiles" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, minHeight: 0 }}>
            <StatTile label="사업장" value={String(group.sites.length)} unit="곳" />
            <StatTile label="장비" value={String(group.deviceCount)} unit="대" />
            {/* 진행 견적 — 큰 숫자는 **진행 중(견적중)**이고, 그 아래 회색 줄이 **회사 전체**
                (사업장 전부 · 끝난 건 포함) 건수다. 숫자만 있을 때는 0 이 「거래가 없다」로
                읽혔다 — 지난 거래가 있는 회사와 아예 없는 회사를 그 줄이 가른다.
                진행이 0 이면 큰 숫자를 회색으로 죽인다(눈이 먼저 가는 자리가 아니다). */}
            <StatTile label="진행 견적" value={String(group.openQuotes)} unit="건"
              color={group.openQuotes > 0 ? BLUE : MUTED}
              note={`전체 ${timeline.quotes.length}건`}
              onClick={() => setQuoteHistoryOpen(true)}
              title={`견적 이력 — 이 회사 전체 ${timeline.quotes.length}건(끝난 건 포함)`} />
            <StatTile
              label="최근 활동"
              value={group.touch ? group.touch.date : '-'}
              /* 날짜는 열 자리라 24px 로 두면 타일을 넘는다 — 이 칸만 15px 다. */
              valueSize={15}
              note={group.touch
                ? `${group.touch.source}${engineerName(group.touch.actorId) ? ` · ${engineerName(group.touch.actorId)}` : ''}`
                : ''}
            />
          </div>

          {/* 포캐스트 — 진행 중인 영업 기회 요약(lib/companyForecast.ts). 별색은 쓰지 않는다. */}
          <div style={{ background: TILE_BG, border: `1px solid ${BORDER}`, borderRadius: R.tile, padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span style={{ fontSize: 11, color: MUTED }}>포캐스트</span>
              <b style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>{forecast.count}</b>
              {forecast.count > 0 && (
                <span style={{ fontSize: 12, color: SUB }}>합계 <b style={{ fontWeight: 700, color: TEXT }}>₩{numKR(forecast.total)}</b></span>
              )}
              <span style={{ flex: 1 }} />
              {forecast.count > 0 && (
                <button type="button" onClick={() => setForecastOnly(c => c + 1)}
                  style={{ border: 'none', background: 'none', padding: 0, color: BLUE, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  전체 보기 ›
                </button>
              )}
            </div>
            {forecast.count === 0 ? (
              <div style={{ fontSize: 12, color: MUTED }}>진행 중인 포캐스트가 없습니다</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto minmax(0, auto) auto', columnGap: 12, rowGap: 6, fontSize: 12, alignItems: 'center' }}>
                {forecast.lines.map(l => (
                  <Fragment key={l.id}>
                    <span style={{ color: TEXT, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {l.title || '(제목 없음)'}
                      {l.siteName && <span style={{ fontWeight: 400, color: SUB }}>{` · ${l.siteName}`}</span>}
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: R.tag, background: NEUTRAL, color: SUB, justifySelf: 'center' }}>{l.stage}</span>
                    <span style={{ color: SUB, whiteSpace: 'nowrap' }}>{l.when || '-'}</span>
                    <span className="num" style={{ textAlign: 'right', fontWeight: 700, color: TEXT, whiteSpace: 'nowrap' }}>{l.amount ? `₩${numKR(l.amount)}` : '-'}</span>
                    <span style={{ color: SUB, textAlign: 'right', whiteSpace: 'nowrap' }}>{l.owner || '-'}</span>
                  </Fragment>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── 사업장 표 ── */}
      <section style={{ ...card, overflow: 'hidden', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderBottom: `1px solid ${BORDER}` }}>
          {/* 머리줄은 제목만 둔다 — 사업장을 더하는 일은 회사 카드의 + 아이콘 하나로 모았다.
              **건수는 적지 않는다**(2026-11-21) — 바로 위 타일에 「사업장 N곳」이 있어
              같은 수를 두 번 말하고 있었다. 「활동 이력 N」은 필터가 걸린 뒤의 건수라
              타일과 다른 수치이므로 그대로 둔다. */}
          <b style={{ ...TITLE }}>사업장</b>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 700 }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 34 }}>
                  <input type="checkbox" aria-label="전체 선택"
                    checked={checked.size > 0 && checked.size === group.sites.length}
                    onChange={e => setChecked(e.target.checked ? new Set(group.sites.map(s => s.customer.customer_id)) : new Set())} />
                </th>
                {/* 열 순서는 **회사 카드의 수치 순서**와 같다 — 사업장·장비·진행 견적·최근 활동.
                    숫자 열은 폭을 못 박고 오른쪽으로 민다(자릿수가 달라도 끝선이 맞는다). */}
                <th style={th}>사업장명</th>
                <th style={th}>지역</th>
                <th style={th}>대리점</th>
                <th style={th}>상태</th>
                <th style={{ ...th, textAlign: 'right', width: 64 }}>장비</th>
                <th style={{ ...th, textAlign: 'right', width: 86 }}>진행 견적</th>
                <th style={th}>최근 활동</th>
                <th className="site-edit-cell" style={{ ...th, width: 52, background: "#fafafa" }} />
              </tr>
            </thead>
            <tbody>
              {group.sites.map((s: SiteRow) => {
                const id = s.customer.customer_id
                const late = isStale(s.days)
                const on = checked.has(id)
                return (
                  /* 줄 아무 곳이나 누르면 그 사업장이 열린다 — 「상세」 버튼을 따로 두지 않는다.
                     체크박스·연필은 그 자리에서 멈춘다(아래 stopPropagation). */
                  <tr key={id} className={on ? "site-row on" : "site-row"}
                    onClick={() => onOpenSite(id)}
                    style={{ background: on ? '#fafafa' : undefined, cursor: 'pointer' }}
                    onMouseEnter={e => { if (!on) e.currentTarget.style.background = '#fafafa' }}
                    onMouseLeave={e => { if (!on) e.currentTarget.style.background = '' }}>
                    <td style={td} onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={on} onChange={() => toggle(id)} aria-label={`${s.siteName || '이름 없는 사업장'} 선택`} />
                    </td>
                    <td style={{ ...td, fontWeight: 600 }}>
                      {s.needsName
                        ? <span style={{ fontSize: 11, fontWeight: 700, color: DANGER, background: '#fef2f2', borderRadius: R.tag, padding: '2px 7px' }}>입력 필요</span>
                        : <div style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.siteName}</div>}
                    </td>
                    <td style={{ ...td, color: SUB }}>{regionTextOf(s.customer) || '-'}</td>
                    <td style={{ ...td, color: s.customer.agency_name ? TEXT : MUTED }}>{s.customer.agency_name ?? DIRECT_SALE_LABEL}</td>
                    <td style={td}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_DOT[s.customer.status ?? ''] ?? MUTED }} />
                        {s.customer.status ?? '-'}
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: 'right', width: 64 }}>{s.deviceCount}</td>
                    <td style={{ ...td, textAlign: 'right', width: 86, color: s.openQuotes > 0 ? BLUE : TEXT, fontWeight: s.openQuotes > 0 ? 700 : 400 }}>{s.openQuotes}</td>
                    {/* 날짜가 먼저 읽히게 **날짜만 굵게** 두고, 경과·유형·작성자는 회색으로 뒤에 붙인다.
                        이 칸만 길어서 좁은 화면에서 줄 끝(연필)을 밀어냈다 — 여기서 말줄임한다. */}
                    <td style={td}>
                      {s.touch ? (
                        <div style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <b style={{ fontWeight: 600, color: late ? DANGER : TEXT }}>{s.touch.date}</b>
                          <span style={{ color: late ? DANGER : SUB }}>
                            {` ${daysLabel(s.days)} · ${s.touch.source}${engineerName(s.touch.actorId) ? ` · ${engineerName(s.touch.actorId)}` : ''}`}
                          </span>
                        </div>
                      ) : <span style={{ color: FAINT }}>-</span>}
                    </td>
                    <td className="site-edit-cell" style={{ ...td, textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                      <span className="site-edit">
                        <EditIconButton size={24} label={`${s.siteName || '이름 없는 사업장'} 수정`} onClick={() => setEditSite(s.customer)} />
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* ── 일괄 작업 바 — 고른 줄이 있을 때만. 버튼만 둔다(드롭다운은 2026-11-23 에 걷었다) ── */}
        <BulkBar
          scope="site"
          count={selected.length}
          /* 이 화면의 사업장은 모두 한 회사 것이다 — 병합 조건을 늘 만족한다. */
          sameCompany
          /* 2026-11-23 — 병합은 **로그인 전원**이 한다. 라우트도 같은 문턱으로 내렸고(SITE_LEVEL),
             누가 합쳤는지는 사건(sites_merged)으로 남는다. 지우는 쪽만 슈퍼관리자다. */
          canMergeSites
          busy={busy}
          onClear={() => setChecked(new Set())}
          onAction={key => {
            if (key === 'move') { setMoveOpen(true); return }
            if (key === 'merge') { setSiteMergeOpen(true); return }
            if (key === 'agency' || key === 'status') setBulkOpen(key)
          }}
        />
      </section>

      {/* ── 회사 전체 활동 ── */}
      <section style={{ ...card, padding: '14px 16px', minWidth: 0 }}>
        <ActivityTimeline
          title="활동 이력"
          history={timeline.history}
          devices={timeline.devices}
          quotes={timeline.quotes}
          activities={timeline.activities}
          holdings={timeline.holdings}
          customerId={group.companyId}
          sites={siteOptions}
          events={timeline.events}
          opportunities={timeline.opportunities}
          inquiries={timeline.inquiries}
          forecastOnlyAt={forecastOnly}
          initialSiteIds={focusSiteId != null ? [focusSiteId] : undefined}
          focusKey={focusKey}
          onFocused={onFocused}
          onOpenQuotePdf={q => { if (onOpenQuote) onOpenQuote(q); else void openQuotePdf(q) }}
          onOpenHolding={(h: Holding) => { const id = h.customer_id; if (id) onOpenSite(id) }}
          onAddRecord={() => { setEditingActivity(null); setActivitySiteId(recentSiteId); setRecordOpen(true) }}
          onEditActivity={a => { setEditingActivity(a); setActivitySiteId(a.customer_id ?? recentSiteId); setActivityOpen(true) }}
          canEditActivity={canEditActivity}
        />
      </section>

      {/* 회사 수정 */}
      {/* 대리점으로 전환 — dry run 으로 막는 것·따라가는 것을 보여 준 뒤에만 실행한다.
          판정은 전부 DB 함수가 한다(db/convert_company_to_agency_20261121.sql). */}
      {convertOpen && (
        <ConvertAgencyModal
          companyName={group.companyName}
          siteCount={group.sites.length}
          busy={busy}
          onDryRun={async () => {
            const r = await callRoute({ action: 'convert-agency', parentId: group.companyId, dryRun: true })
            if (!r.ok) return { ok: false as const, error: r.error }
            return { ok: true as const, report: r.data.report as ConvertReport }
          }}
          onRun={() => void runConvert()}
          onClose={() => setConvertOpen(false)}
        />
      )}

      {editCompanyOpen && (
        <CompanyEditModal
          initial={{
            name: group.companyName,
            nameEn: group.nameEn ?? '',
            industry: group.industry ?? '',
            note: group.note ?? '',
          }}
          siteCount={group.sites.length}
          canRename={canEditCompany}
          isSaving={busy}
          onClose={() => setEditCompanyOpen(false)}
          onSave={form => void saveCompany(form)}
          onConvertAgency={onConverted ? () => { setEditCompanyOpen(false); setConvertOpen(true) } : undefined}
          convertBlockedReason={convertReason}
        />
      )}

      {/* 사업장 수정 — 상세 화면이 쓰는 그 모달 그대로 */}
      {editSite && (
        <CustomerEditModal
          customer={editSite}
          isSaving={busy}
          onClose={() => setEditSite(null)}
          onSave={form => void saveSite(form)}
        />
      )}

      {/* 사업장 병합 — ① 남길 줄 고르기 → ② 건수 확인 → 실행 */}
      {siteMergeOpen && (
        <SiteMergeModal
          rows={group.sites.filter(s => checked.has(s.customer.customer_id))}
          busy={busy}
          onDryRun={siteMergeDryRun}
          onRun={(keepId, fromIds, siteName) => void runSiteMerge(keepId, fromIds, siteName)}
          onClose={() => setSiteMergeOpen(false)}
        />
      )}

      {/* 견적 이력 — 회사 전체(사업장 전부)의 견적을 최신순으로. 진행 중만이 아니라 끝난 건도 넣는다:
          「이 회사와 얼마나 거래했나」를 보는 창이라 끝난 건을 빼면 뜻이 없다. */}
      {quoteHistoryOpen && (
        <QuoteHistoryModal
          isOpen
          customer={null}
          quotes={timeline.quotes}
          family={{ name: group.companyName, siteCount: group.sites.length }}
          onOpenPdf={q => { if (onOpenQuote) onOpenQuote(q); else void openQuotePdf(q) }}
          onClose={() => setQuoteHistoryOpen(false)}
        />
      )}

      {/* 기록 추가 — 영업 활동·포캐스트·홀딩 한 창 */}
      {recordOpen && (
        <RecordAddModal
          companyName={group.companyName}
          sites={siteOptions}
          defaultSiteId={recentSiteId}
          contacts={timeline.contacts}
          devices={timeline.devices}
          opportunities={timeline.opportunities}
          myEngineerId={me.engineer_id}
          isSaving={savingActivity || oppCrud.isSavingOpp}
          onClose={() => setRecordOpen(false)}
          onSaveActivity={(siteId, form) => void saveActivity(form, siteId)}
          onSaveOpportunity={(siteId, form) => void oppCrud.handleSaveOpp({ ...form, customer_id: siteId })}
          onSaveHolding={draft => void saveHolding(draft)}
        />
      )}

      {/* 영업 기록 **수정** — 줄 끝 연필. 추가는 위 「기록 추가」가 맡는다. */}
      {activityOpen && (
        <SalesActivityModal
          isOpen
          activity={editingActivity}
          contacts={timeline.contacts.filter(c => c.customer_id === (activitySiteId ?? recentSiteId))}
          opportunities={timeline.opportunities.filter(o => o.customer_id === (activitySiteId ?? recentSiteId))}
          isSaving={savingActivity}
          canDelete={false}
          sites={siteOptions}
          siteId={activitySiteId ?? recentSiteId}
          onSiteChange={id => setActivitySiteId(id)}
          onClose={() => { setActivityOpen(false); setEditingActivity(null) }}
          onSave={form => void saveActivity(form)}
          onDelete={() => {}}
        />
      )}

      {/* ── 일괄 적용(대리점·상태) — 지금 값을 보여 주고 바꾼다 ── */}
      {bulkOpen === 'status' && (
        <BulkApplyModal
          actionKey="status"
          title="상태 변경"
          count={selected.length}
          current={currentValueCounts(pickedRows.map(s => s.customer.status))}
          options={STATUSES.map(v => ({ value: v, label: v }))}
          mode="chips"
          busy={busy}
          onClose={() => setBulkOpen(null)}
          onApply={value => {
            setBulkOpen(null)
            void saveBulk({ action: 'site-status', status: value }, bulkDoneText(selected.length), { status: value })
          }}
        />
      )}
      {bulkOpen === 'agency' && (
        <BulkApplyModal
          actionKey="agency"
          title="대리점 변경"
          count={selected.length}
          current={currentValueCounts(pickedRows.map(s => s.customer.agency_name ?? DIRECT_SALE_LABEL))}
          options={[
            { value: DIRECT_SALE_VALUE, label: DIRECT_SALE_OPTION_LABEL },
            ...agencies.map(a => ({ value: String(a.customer_id), label: a.company_name })),
          ]}
          mode="search"
          busy={busy}
          onClose={() => setBulkOpen(null)}
          onApply={value => {
            setBulkOpen(null)
            const v = value === DIRECT_SALE_VALUE ? null : Number(value)
            void saveBulk({ action: 'site-agency', agencyId: v }, bulkDoneText(selected.length), {
              agency_customer_id: v,
              // 화면이 읽는 이름 칸도 같이 고친다 — id 만 바꾸면 표에 옛 이름이 남는다.
              agency_name: v == null ? null : (agencies.find(a => a.customer_id === v)?.company_name ?? null),
            })
          }}
        />
      )}

      {/* 다른 회사로 이동 — 고르면 바로 옮긴다(참조는 사업장에 붙어 있어 그대로 따라간다). */}
      {moveOpen && (
        <CompanySearchModal
          title="다른 회사로 이동"
          hint={`고른 사업장 ${selected.length}곳을 어느 회사로 옮길지 고릅니다. 장비·담당자·견적은 사업장에 붙어 있어 그대로 따라갑니다.`}
          excludeId={group.companyId}
          confirmText="옮기기"
          onPick={(id, name) => void moveSites(id, name)}
          onClose={() => setMoveOpen(false)}
        />
      )}

    </div>
  )
}
