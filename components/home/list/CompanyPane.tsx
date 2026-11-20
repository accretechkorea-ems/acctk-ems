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

import { useMemo, useState, type CSSProperties } from 'react'
import { createClient } from '@/lib/supabase/client'
import ModalOverlay from '@/components/common/ModalOverlay'
import CompanySearchModal from '@/components/home/list/CompanySearchModal'
import CompanyEditModal, { type CompanyEditForm } from '@/components/home/list/CompanyEditModal'
import CustomerEditModal from '@/components/customer/modals/CustomerEditModal'
import SalesActivityModal from '@/components/customer/modals/SalesActivityModal'
import SiteMergeModal, { type MergeReport } from '@/components/home/list/SiteMergeModal'
import ActivityTimeline from '@/components/customer/ActivityTimeline'
import { useCompanyTimeline } from '@/hooks/useCompanyTimeline'
import { useQuotePdf } from '@/hooks/customer/useQuotePdf'
import { isSuperAdmin } from '@/lib/permissions'
import type { Holding, Quote, SalesActivity, SalesActivityForm } from '@/components/customer/types'
import { saveCustomerEdit } from '@/lib/saveCustomerEdit'
import { invalidateParents } from '@/components/customer/ParentPicker'
import { DIRECT_SALE_LABEL, useAgencies } from '@/lib/customerAgency'
import { daysLabel, isStale, regionOf, type CompanyGroup, type SiteRow } from '@/lib/customerList'
import type { Customer } from '@/components/customer/types'

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

const card: CSSProperties = { background: '#ffffff', border: `1px solid ${BORDER}`, borderRadius: 8 }
const btn: CSSProperties = {
  height: 30, padding: '0 11px', borderRadius: 6, border: `1px solid ${BORDER}`,
  background: '#ffffff', color: TEXT, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
}
const th: CSSProperties = {
  fontSize: 11, fontWeight: 700, color: SUB, textAlign: 'left', height: 36, padding: '0 10px',
  borderBottom: `1px solid ${BORDER}`, background: '#fafafa', whiteSpace: 'nowrap',
}
const td: CSSProperties = { height: 42, padding: '0 10px', borderBottom: `1px solid ${BORDER}`, whiteSpace: 'nowrap', fontSize: 12, color: TEXT }

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
  /** 회사를 병합·삭제해 사라졌을 때 — 화면이 선택을 푼다. */
  onCompanyGone: () => void
  /**
   * 슈퍼관리자인가 — **회사명·영문명·병합**은 그 사람만 한다(그 아래 사업장 이름까지
   * 전부 다시 만들기 때문이다). 분류·메모와 사업장 수준의 일은 고객사 메뉴면 된다.
   */
  canEditCompany: boolean
  /** 사업장 화면에서 ← 로 돌아왔을 때 타임라인에 켜 둘 사업장. */
  focusSiteId?: number | null
  /** 활동 현황에서 넘어온 줄 — 그 줄로 내려가 잠깐 밝힌다(lib/activity.ts). */
  focusKey?: string | null
  onFocused?: () => void
  /** 지금 사람 — 영업 기록의 작성자이고, 자기 글만 고칠 수 있다. */
  me: { engineer_id: number | null; permission_level: string | null }
  /** 견적 PDF 를 열 때. 회사 전체 타임라인의 견적 줄이 쓴다. */
  onOpenQuote?: (quote: Quote) => void
}

export default function CompanyPane({
  group, engineerName, onSaved, onError, onToast, onOpenSite, onAddSite, onCompanyGone, canEditCompany, me, onOpenQuote, focusSiteId, focusKey, onFocused,
}: CompanyPaneProps) {
  const supabase = createClient()
  const agencies = useAgencies()
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  /** 회사 수정 모달. */
  const [editCompanyOpen, setEditCompanyOpen] = useState(false)
  /** 사업장 수정 모달 — 고친 줄. */
  const [editSite, setEditSite] = useState<Customer | null>(null)
  /** 「다른 회사로 이동」·「회사 병합」의 고르는 창. */
  const [moveOpen, setMoveOpen] = useState(false)
  const [mergeTarget, setMergeTarget] = useState<{ id: number; name: string } | null>(null)
  const [mergeOpen, setMergeOpen] = useState(false)
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
    () => group.sites.map(s => ({ id: s.customer.customer_id, name: s.siteName })),
    [group.sites],
  )
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

  /** 고른 여러 줄의 칸 하나를 한 번에 바꾼다(일괄 바 전용). */
  const saveCell = async (ids: number[], patch: Record<string, unknown>, done: string) => {
    if (busy || ids.length === 0) return
    setBusy(true)
    const { error } = await supabase.from('customers').update(patch).in('customer_id', ids)
    setBusy(false)
    if (error) { onError(error.message || '저장하지 못했습니다'); return }
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
      const { error } = await supabase.from('customers').update(patch).eq('customer_id', group.companyId)
      if (error) { setBusy(false); onError(error.message || '회사 정보를 저장하지 못했습니다'); return }
    }
    setBusy(false)
    invalidateParents()   // 회사 목록 캐시가 옛 이름·분류를 들고 있다
    setEditCompanyOpen(false)
    onToast(nameChanged && renamed > 0
      ? `회사 정보를 수정했습니다 (사업장 ${renamed}곳 이름도 함께)`
      : '회사 정보를 수정했습니다')
    onSaved()
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
  const saveActivity = async (form: SalesActivityForm) => {
    const siteId = activitySiteId ?? recentSiteId
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
    setEditingActivity(null)
    onToast(editingActivity ? '영업 기록을 수정했습니다' : '영업 기록을 추가했습니다')
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

  /** 이 회사를 다른 회사로 합친다. **되돌릴 수 없다.** */
  const doMerge = async () => {
    if (!mergeTarget || busy) return
    setBusy(true)
    const r = await callRoute({ action: 'merge', parentId: group.companyId, intoParentId: mergeTarget.id })
    setBusy(false)
    if (!r.ok) { onError(r.error); return }
    setMergeTarget(null)
    onToast(`「${group.companyName}」 를 「${mergeTarget.name}」 로 합쳤습니다`)
    onCompanyGone()
    onSaved()
  }

  const selected = [...checked]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>

      {/* ── 회사 카드 ── */}
      <section style={{ ...card, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 200 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: TEXT, letterSpacing: '-0.5px' }}>{group.companyName}</h1>
          {group.nameEn && <span style={{ fontSize: 12, color: MUTED }}>{group.nameEn}</span>}
          {group.industry && (
            <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: NEUTRAL, color: SUB }}>{group.industry}</span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 22 }}>
          {([
            ['사업장', String(group.sites.length), TEXT],
            ['장비', String(group.deviceCount), TEXT],
            ['진행 견적', String(group.openQuotes), group.openQuotes > 0 ? BLUE : TEXT],
            ['최근 활동', group.touch ? group.touch.date : '-', TEXT],
          ] as const).map(([label, value, color]) => (
            <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <b style={{ fontSize: 17, fontWeight: 700, color, letterSpacing: '-0.3px' }}>{value}</b>
              <span style={{ fontSize: 11, color: MUTED }}>
                {label}
                {label === '최근 활동' && group.touch
                  ? ` (${group.touch.source}${engineerName(group.touch.actorId) ? ` · ${engineerName(group.touch.actorId)}` : ''})`
                  : ''}
              </span>
            </div>
          ))}
        </div>

        <span style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => setEditCompanyOpen(true)} style={btn}>수정</button>
          {/* 병합 — **되돌릴 수 없다.** 슈퍼관리자만 누를 수 있다(라우트도 같은 문턱이다). */}
          <button type="button" disabled={!canEditCompany} title={canEditCompany ? '다른 회사로 합칩니다' : '회사 병합은 슈퍼관리자만 할 수 있습니다'}
            onClick={() => setMergeOpen(true)}
            style={{ ...btn, color: canEditCompany ? TEXT : MUTED, cursor: canEditCompany ? 'pointer' : 'not-allowed' }}>회사 병합</button>
        </div>
      </section>

      {/* ── 사업장 표 ── */}
      <section style={{ ...card, overflow: 'hidden', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderBottom: `1px solid ${BORDER}` }}>
          <b style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>사업장 {group.sites.length}곳</b>
          <span style={{ fontSize: 11, color: MUTED }}>줄 끝의 연필로 고칩니다</span>
          <span style={{ flex: 1 }} />
          {/* 사업장을 더하는 자리는 **표 머리줄**이다 — 더할 대상(이 표)의 바로 위다. */}
          <button type="button" onClick={onAddSite} style={btn}>+ 사업장 추가</button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 760 }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 34 }}>
                  <input type="checkbox" aria-label="전체 선택"
                    checked={checked.size > 0 && checked.size === group.sites.length}
                    onChange={e => setChecked(e.target.checked ? new Set(group.sites.map(s => s.customer.customer_id)) : new Set())} />
                </th>
                <th style={th}>사업장명</th>
                <th style={th}>지역</th>
                <th style={th}>대리점</th>
                <th style={th}>상태</th>
                <th style={{ ...th, textAlign: 'right' }}>장비</th>
                <th style={th}>최근 활동 · 작성자</th>
                <th style={{ ...th, textAlign: 'right' }}>진행 견적</th>
                <th style={{ ...th, width: 86 }} />
              </tr>
            </thead>
            <tbody>
              {group.sites.map((s: SiteRow) => {
                const id = s.customer.customer_id
                const late = isStale(s.days)
                const on = checked.has(id)
                return (
                  <tr key={id} style={{ background: on ? '#f8fafc' : undefined }}>
                    <td style={td}>
                      <input type="checkbox" checked={on} onChange={() => toggle(id)} aria-label={`${s.siteName} 선택`} />
                    </td>
                    <td style={{ ...td, fontWeight: 600 }}>{s.siteName}</td>
                    <td style={{ ...td, color: SUB }}>{regionOf(s.customer) || '-'}</td>
                    <td style={{ ...td, color: s.customer.agency_name ? TEXT : MUTED }}>{s.customer.agency_name ?? DIRECT_SALE_LABEL}</td>
                    <td style={td}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_DOT[s.customer.status ?? ''] ?? MUTED }} />
                        {s.customer.status ?? '-'}
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>{s.deviceCount}</td>
                    <td style={{ ...td, color: late ? DANGER : SUB }}>
                      {s.touch ? (
                        <>
                          {s.touch.date}
                          <span style={{ color: late ? DANGER : MUTED }}>
                            {` (${daysLabel(s.days)} · ${s.touch.source}${engineerName(s.touch.actorId) ? ` · ${engineerName(s.touch.actorId)}` : ''})`}
                          </span>
                        </>
                      ) : <span style={{ color: FAINT }}>-</span>}
                    </td>
                    <td style={{ ...td, textAlign: 'right', color: s.openQuotes > 0 ? BLUE : TEXT, fontWeight: s.openQuotes > 0 ? 700 : 400 }}>{s.openQuotes}</td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        {/* 연필 — 이 줄을 수정 모달로 연다(상세 화면의 그 모달이다). */}
                        <button type="button" aria-label={`${s.siteName} 수정`} title="사업장 정보 수정"
                          onClick={() => setEditSite(s.customer)}
                          style={{ width: 26, height: 26, padding: 0, borderRadius: 6, border: 'none', background: 'transparent', color: MUTED, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                          onMouseEnter={e => { e.currentTarget.style.background = NEUTRAL; e.currentTarget.style.color = TEXT }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = MUTED }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /></svg>
                        </button>
                        <button type="button" onClick={() => onOpenSite(id)}
                          style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: BLUE, fontFamily: 'inherit', padding: 0 }}>
                          상세
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* ── 일괄 작업 바 — 고른 줄이 있을 때만 ── */}
        {selected.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', background: '#111827', color: '#fff', fontSize: 12, flexWrap: 'wrap' }}>
            <b style={{ fontWeight: 700 }}>{selected.length}곳 선택</b>
            <span style={{ width: 1, height: 16, background: '#374151', margin: '0 4px' }} />

            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: '#d1d5db' }}>대리점 변경</span>
              <select defaultValue="" disabled={busy}
                onChange={e => {
                  if (e.target.value === '') return
                  const v = e.target.value === 'none' ? null : Number(e.target.value)
                  void saveCell(selected, { agency_customer_id: v }, `${selected.length}곳의 대리점을 바꿨습니다`)
                  e.target.value = ''
                }}
                style={{ height: 26, borderRadius: 6, border: 'none', fontSize: 12, padding: '0 6px' }}>
                <option value="">고르기</option>
                <option value="none">{DIRECT_SALE_LABEL}</option>
                {agencies.map(a => <option key={a.customer_id} value={a.customer_id}>{a.company_name}</option>)}
              </select>
            </label>

            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: '#d1d5db' }}>상태 변경</span>
              <select defaultValue="" disabled={busy}
                onChange={e => {
                  if (e.target.value === '') return
                  void saveCell(selected, { status: e.target.value }, `${selected.length}곳의 상태를 바꿨습니다`)
                  e.target.value = ''
                }}
                style={{ height: 26, borderRadius: 6, border: 'none', fontSize: 12, padding: '0 6px' }}>
                <option value="">고르기</option>
                {STATUSES.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>

            <button type="button" disabled={busy} onClick={() => setMoveOpen(true)}
              style={{ height: 26, padding: '0 10px', borderRadius: 6, border: '1px solid #374151', background: 'transparent', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              다른 회사로 이동
            </button>

            {/* 사업장 병합 — 두 곳 이상 골랐을 때만. 되돌릴 수 없어 슈퍼관리자만 누른다. */}
            {selected.length > 1 && (
              <button type="button" disabled={busy || !canEditCompany}
                title={canEditCompany ? '고른 사업장을 한 줄로 합칩니다' : '사업장 병합은 슈퍼관리자만 할 수 있습니다'}
                onClick={() => setSiteMergeOpen(true)}
                style={{ height: 26, padding: '0 10px', borderRadius: 6, border: '1px solid #374151', background: 'transparent', color: canEditCompany ? '#fff' : MUTED, fontSize: 12, fontWeight: 700, cursor: canEditCompany ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
                사업장 병합
              </button>
            )}
            <span style={{ flex: 1 }} />
            <button type="button" onClick={() => setChecked(new Set())}
              style={{ border: 'none', background: 'none', color: MUTED, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              선택 해제
            </button>
          </div>
        )}
      </section>

      {/* ── 회사 전체 활동 ── */}
      <section style={{ ...card, padding: '14px 16px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <b style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>회사 전체 활동</b>
          <span style={{ fontSize: 11, color: MUTED }}>
            {timeline.loading ? '읽는 중…' : `사업장 ${group.sites.length}곳 · 조회 ${timeline.ms}ms`}
          </span>
        </div>
        <ActivityTimeline
          history={timeline.history}
          devices={timeline.devices}
          quotes={timeline.quotes}
          activities={timeline.activities}
          holdings={timeline.holdings}
          customerId={group.companyId}
          sites={siteOptions}
          events={timeline.events}
          initialSiteIds={focusSiteId != null ? [focusSiteId] : undefined}
          focusKey={focusKey}
          onFocused={onFocused}
          onOpenQuotePdf={q => { if (onOpenQuote) onOpenQuote(q); else void openQuotePdf(q) }}
          onOpenHolding={(h: Holding) => { const id = h.customer_id; if (id) onOpenSite(id) }}
          onAddActivity={() => { setEditingActivity(null); setActivitySiteId(recentSiteId); setActivityOpen(true) }}
          onEditActivity={a => { setEditingActivity(a); setActivitySiteId(a.customer_id ?? recentSiteId); setActivityOpen(true) }}
          canEditActivity={canEditActivity}
        />
      </section>

      {/* 회사 수정 */}
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

      {/* 영업 기록 — 회사 화면에서는 사업장을 함께 고른다 */}
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

      {/* 회사 병합 — ① 대상 고르기 → ② 확인 */}
      {mergeOpen && (
        <CompanySearchModal
          title="회사 병합"
          hint={`「${group.companyName}」 의 사업장 ${group.sites.length}곳을 어느 회사로 합칠지 고릅니다.`}
          excludeId={group.companyId}
          confirmText="다음"
          onPick={(id, name) => { setMergeOpen(false); setMergeTarget({ id, name }) }}
          onClose={() => setMergeOpen(false)}
        />
      )}
      {mergeTarget && (
        <ModalOverlay onClose={() => setMergeTarget(null)}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 440, background: '#fff', borderRadius: 8, padding: 22, border: `1px solid ${BORDER}`, boxShadow: '0 20px 60px rgba(0,0,0,0.22)' }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: TEXT, marginBottom: 12 }}>회사 병합 — 한 번 더 확인</div>
            <div style={{ fontSize: 13, color: TEXT, lineHeight: 1.9 }}>
              <b>{group.companyName}</b>
              <span style={{ color: SUB }}>{` (사업장 ${group.sites.length}곳 · 장비 ${group.deviceCount} · 진행 견적 ${group.openQuotes})`}</span>
              <br />↓
              <br /><b>{mergeTarget.name}</b> 로 합칩니다.
            </div>
            <ul style={{ fontSize: 12, color: SUB, lineHeight: 1.9, marginTop: 12, paddingLeft: 18 }}>
              <li>사업장이 전부 옮겨 가고 이름이 「{mergeTarget.name} 사업장명」 으로 다시 만들어집니다.</li>
              <li>분류·영문명·메모는 <b>받는 회사가 비어 있을 때만</b> 가져옵니다.</li>
              <li><b style={{ color: DANGER }}>되돌리기는 없습니다.</b> 합친 회사 줄은 닫히고(삭제 표시) 목록에서 사라집니다.</li>
            </ul>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              <button onClick={() => setMergeTarget(null)} disabled={busy}
                style={{ padding: '9px 15px', background: '#fff', color: SUB, borderRadius: 6, border: `1px solid ${BORDER}`, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>취소</button>
              <button onClick={() => void doMerge()} disabled={busy}
                style={{ padding: '9px 17px', background: DANGER, color: '#fff', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, opacity: busy ? 0.6 : 1 }}>
                {busy ? '합치는 중…' : '합치기'}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  )
}
