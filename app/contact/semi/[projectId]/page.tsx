'use client'

// 반도체 고객 접촉 보고 — Project 상세(/contact/semi/<projectId>[?report=<reportId>]).
//
// 위에서 아래로: 헤더(Project·← 목록·전체 이력 엑셀·보고서 작성·정보 수정·Project 삭제) → 요약 카드 4개
// → 「미완료 Action」(전체 폭, 0건이면 한 줄) → 2단: 좌 「접촉 이력」 타임라인 / 우 선택한 보고서 상세.
// 2단은 요약 카드와 같은 4칸 격자에 맞춘다 — 좌 1칸, 우 3칸. 좌 이력 상자는 우 상세의 아래 끝까지 늘고, 길면 상자 안에서 스크롤.
// 좁은 화면에서는 위아래로 쌓는다(이력 상자는 최대 높이 + 스크롤).
//
// 데이터 — 브라우저 세션으로 세 표를 한 번에 읽는다(RLS 가 contact_semi 권한자에게 읽기를 연다).
//   semi_projects 1건 · semi_contact_reports 그 Project 전체(작성자 이름은 FK 임베드) · semi_actions 그 Project 전체.
// 변경 표시 — 접촉일 오름차순으로 늘어놓고 바로 앞 보고서와 비교한다(fromStorage → changedFields).
// 접촉 차수(#n) — lib/semiContact/sequence.ts 의 contactSequence(엑셀과 같은 계산, DB 에 없는 표시 전용 값).
//
// 쓰기는 모두 서버 라우트가 권한을 다시 본다.
//   · 보고서 수정 → 작성 화면의 수정 모드(write?report_id=), 삭제 → DELETE /api/semi-contact/report (작성자 본인·superadmin)
//   · Project 정보 수정 → PATCH /api/semi-contact/project, 삭제 → DELETE (만든 본인·superadmin)
//   · Action 상태 → PATCH /api/semi-contact/action (접근 권한만 있으면 누구나 — 담당이 팀이다)
// 주소의 ?report= 가 있으면 그 보고서를 고른 채 연다(수정 화면에서 돌아올 때).

import { Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { usePageGuard } from '@/hooks/usePageGuard'
import AccessGate from '@/components/common/AccessGate'
import ModalOverlay from '@/components/common/ModalOverlay'
import { useToast } from '@/components/common/Toast'
import { useConfirm } from '@/components/common/ConfirmDialog'
import { FieldError, errBorder, useFieldErrors } from '@/components/common/fieldErrors'
import { isSuperAdmin } from '@/lib/permissions'
import {
  PAGE_BG, CARD_BG, BORDER, TEXT, MUTED, SUB, FAINT, BLUE, NEUTRAL_BG, ROW_HOVER_BG,
  cardStyle, cardHeader, cardTitle, countBadge, btnPrimary, btnGhost, btnDanger,
} from '@/components/common/ui'
import { daysBetween, todayKST } from '@/lib/date'
import { errorInfo } from '@/lib/errorInfo'
import {
  ACTION_LABELS, ACTION_STATUSES, AUTHOR_FIELD, FIELDS, FIELD_BY_KEY, SECTIONS,
  actionFromStorage, changedFields, emptyInput, fromStorage, validateReport,
  type ActionInput, type FieldDef, type FieldKey, type ReportInput,
} from '@/lib/semiContact'
import {
  PROJECT_KEYS, PROJECT_NO_KEY, PROJECT_NO_LABEL, PROJECT_NO_MAX, PROJECT_TEXT_MAX, validateProjectNo,
} from '@/lib/semiContact/project'
import { contactSequence, seqLabel } from '@/lib/semiContact/sequence'

// ── 배치(작성 화면과 같다) ──────────────────────────────────────────────
const CONTACT_KEYS: FieldKey[] = ['contact_date', 'contact_method', 'customer_contact', 'purpose']
const NOTE_KEYS: FieldKey[] = ['fact', 'meeting_content']
const NEXT_KEYS: FieldKey[] = ['next_contact_date']
const PLACED = new Set<FieldKey>([...PROJECT_KEYS, ...CONTACT_KEYS, ...NOTE_KEYS, ...NEXT_KEYS])
const REST_GROUPS = SECTIONS
  .map(s => ({ section: s, fields: (FIELDS as readonly FieldDef[]).filter(f => f.section === s.no && !PLACED.has(f.key as FieldKey)) }))
  .filter(g => g.fields.length > 0)

/** 완료 상태. 등록표의 Action 상태(Open · In Progress · Done) 중 이것만 완료로 본다 — DB 부분 인덱스와 같은 기준. */
const DONE_STATUS = 'Done'

/** 위험(기한 지남) 글자색 — 디자인 표의 「위험」 값. */
const DANGER_TEXT = '#ef4444'

type Project = { project_id: number; project_no: string; customer_name: string; site_dept: string | null; title: string; created_by: number }
type ReportRow = Record<string, unknown> & {
  report_id: number
  contact_date: string
  author: { name: string | null } | null
}
type ActionRow = Record<string, unknown> & { action_id: number; report_id: number }
/** 화면의 Action 한 줄 — 입력 모양 + id·보고서. */
type ActionView = ActionInput & { id: number; reportId: number }

/** 화면에서 쓰는 보고서 한 장 — 입력 모양 + 직전 보고서 대비 변경 + 차수. */
type ReportView = {
  id: number
  row: ReportRow
  input: ReportInput
  /** 접촉일 오름차순으로 바로 앞 보고서. 가장 오래된 보고서는 null. */
  prevInput: ReportInput | null
  changed: Set<FieldKey>
  noAction: boolean
  authorName: string
  /** 접촉 차수(#n). */
  seq: number
}

const SHELL_CSS = `
  .sp-shell { container-type: inline-size; }
  .sp-cards { display: grid; gap: 12px; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 12px; }
  /* 2단은 요약 카드와 같은 4칸 격자 — 좌 1칸, 우 3칸. 행 높이는 우 상세가 정하고(좌 상자는 absolute 라
     높이에 끼지 않는다) 좌 상자는 그 높이를 꽉 채운 채 안에서 스크롤한다. */
  .sp-cols { display: grid; gap: 12px; grid-template-columns: repeat(4, minmax(0, 1fr)); align-items: stretch; }
  .sp-left { grid-column: 1; position: relative; min-height: 320px; }
  .sp-left-card { position: absolute; inset: 0; display: flex; flex-direction: column; }
  .sp-right { grid-column: 2 / span 3; min-width: 0; }
  .sp-timeline { flex: 1; min-height: 0; overflow-y: auto; }
  @container (max-width: 900px) {
    .sp-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .sp-cols { grid-template-columns: minmax(0, 1fr); }
    .sp-left, .sp-right { grid-column: 1; }
    .sp-left { position: static; min-height: 0; }
    .sp-left-card { position: static; }
    .sp-timeline { max-height: 420px; }
  }
`

const labelStyle: CSSProperties = { fontSize: 11, fontWeight: 700, color: MUTED, marginBottom: 5, display: 'block' }
const gridStyle: CSSProperties = { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }
const boxStyle: CSSProperties = { ...cardStyle, marginBottom: 12 }
const smallBtn: CSSProperties = { padding: '5px 10px', fontSize: 12 }

/** 'YYYY-MM-DD' 를 오늘과 견줘 「오늘」·「N일 전」·「N일 후」. 날짜가 아니면 빈 문자열. */
function relDay(ymd: string, today: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ''
  const d = daysBetween(today, ymd)
  if (d === 0) return '오늘'
  return d < 0 ? `${-d}일 전` : `${d}일 후`
}

function SemiProjectDetailInner() {
  const supabase = useMemo(() => createClient(), [])
  const params = useParams<{ projectId: string }>()
  const projectId = Number(params?.projectId)
  const searchParams = useSearchParams()
  /** 처음 열 때 고를 보고서(?report=). 수정 화면에서 돌아올 때 쓴다. */
  const wantReport = useRef<number | null>(Number(searchParams.get('report')) || null)
  const { engineer, loading: guardLoading, authorized } = usePageGuard()
  const router = useRouter()
  const confirm = useConfirm()
  const toast = useToast()

  const [project, setProject] = useState<Project | null>(null)
  const [reportRows, setReportRows] = useState<ReportRow[] | null>(null)
  const [actionRows, setActionRows] = useState<ActionRow[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const detailRef = useRef<HTMLDivElement | null>(null)
  /** 내려받는 중인 엑셀('history' 또는 보고서 id). 그동안 두 버튼을 모두 막는다(중복 클릭 방지). */
  const [exporting, setExporting] = useState<'history' | number | null>(null)
  /** 지우는 중('project' 또는 보고서 id). 그동안 삭제 버튼을 모두 막는다(중복 방지). */
  const [deleting, setDeleting] = useState<'project' | number | null>(null)
  /** 올리면 세 표를 다시 읽는다(보고서를 지운 뒤 타임라인·요약·미완료 Action 을 새로 그리려고). */
  const [reloadKey, setReloadKey] = useState(0)
  /** 상태를 저장 중인 Action id — 그 셀렉트만 막는다. */
  const [savingStatus, setSavingStatus] = useState<Set<number>>(() => new Set())
  const [editingProject, setEditingProject] = useState(false)

  useEffect(() => {
    if (!authorized) return
    if (!Number.isInteger(projectId) || projectId <= 0) { setLoadError('Project 주소가 올바르지 않습니다.'); return }
    let cancelled = false
    const load = async () => {
      const [p, r, a] = await Promise.all([
        supabase.from('semi_projects')
          .select('project_id, project_no, customer_name, site_dept, title, created_by')
          .eq('project_id', projectId).maybeSingle(),
        // 작성자 이름은 목록과 같이 engineers 를 임베드한다. 이 표는 engineers 를 두 번 가리키므로(작성자·수정자)
        // 어느 FK 인지 이름으로 짚는다.
        supabase.from('semi_contact_reports')
          .select('*, author:engineers!semi_contact_reports_author_fkey(name)')
          .eq('project_id', projectId)
          .order('contact_date', { ascending: false })
          .order('report_id', { ascending: false }),
        supabase.from('semi_actions')
          .select('*')
          .eq('project_id', projectId)
          .order('due_date', { ascending: true })
          .order('action_id', { ascending: true }),
      ])
      if (cancelled) return
      if (p.error || !p.data) {
        if (p.error) console.error('[contact/semi/detail] Project 조회 실패', errorInfo(p.error))
        setLoadError(p.error ? `Project 를 불러오지 못했습니다: ${p.error.message}` : 'Project 를 찾을 수 없습니다.')
        return
      }
      if (r.error || a.error) {
        console.error('[contact/semi/detail] 보고서·Action 조회 실패', errorInfo(r.error ?? a.error))
        setLoadError(`접촉 보고서를 불러오지 못했습니다: ${(r.error ?? a.error)?.message ?? ''}`)
        return
      }
      const reports = (r.data ?? []) as unknown as ReportRow[]
      setProject(p.data as Project)
      setReportRows(reports)
      setActionRows((a.data ?? []) as unknown as ActionRow[])
      // 고른 보고서가 남아 있으면 그대로, 없으면 주소의 ?report=, 그것도 없으면 가장 최근 보고서.
      setSelectedId(cur => {
        const has = (id: number | null) => id !== null && reports.some(x => x.report_id === id)
        if (has(cur)) return cur
        if (has(wantReport.current)) return wantReport.current
        return reports[0]?.report_id ?? null
      })
    }
    load()
    return () => { cancelled = true }
  }, [authorized, projectId, supabase, reloadKey])

  // 보고서마다 입력 모양 + 바로 앞 보고서 대비 변경(접촉일 오름차순 기준) + 차수.
  const views = useMemo<ReportView[]>(() => {
    if (!project || !reportRows) return []
    const projInput = { customer_name: project.customer_name, site_dept: project.site_dept ?? '', title: project.title }
    const seqOf = contactSequence(reportRows)
    const asc = [...reportRows].reverse()   // 질의가 (contact_date desc, report_id desc) 라 뒤집으면 오름차순
    const out: ReportView[] = []
    let before: ReportInput | null = null
    for (const row of asc) {
      const input = fromStorage(row, projInput)
      const detail = row.detail as Record<string, unknown> | null
      out.push({
        id: row.report_id,
        row,
        input,
        prevInput: before,
        changed: new Set(changedFields(before, input)),
        noAction: !!detail && typeof detail === 'object' && detail.no_action === true,
        authorName: row.author?.name ?? '-',
        seq: seqOf.get(row.report_id) ?? 0,
      })
      before = input
    }
    return out.reverse()   // 화면은 최신순
  }, [project, reportRows])

  const today = todayKST()
  const allActions = useMemo<ActionView[]>(
    () => actionRows.map(a => ({ ...actionFromStorage(a), id: a.action_id, reportId: a.report_id })),
    [actionRows],
  )
  const actionsByReport = useMemo(() => {
    const m = new Map<number, ActionView[]>()
    for (const a of allActions) {
      const list = m.get(a.reportId) ?? []
      list.push(a)
      m.set(a.reportId, list)
    }
    return m
  }, [allActions])
  const viewById = useMemo(() => new Map(views.map(v => [v.id, v])), [views])
  const openActions = useMemo(() => allActions.filter(a => a.status !== DONE_STATUS), [allActions])

  // ── 엑셀 ──
  /**
   * 엑셀 내려받기 — 서버(/api/semi-contact/export)가 만든 파일을 blob 으로 받아 저장한다.
   * 파일명은 응답의 filename*(UTF-8)을 그대로 쓴다. 실패하면 서버가 준 사유를 알린다.
   */
  const downloadExcel = async (which: 'history' | number) => {
    if (exporting !== null) return
    setExporting(which)
    try {
      const qs = `project_id=${projectId}${which === 'history' ? '' : `&report_id=${which}`}`
      const res = await fetch(`/api/semi-contact/export?${qs}`)
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        console.error('[contact/semi/detail] 엑셀 실패', { status: res.status, error: json })
        toast.error(json.error || `엑셀을 내려받지 못했습니다 (${res.status})`)
        return
      }
      const blob = await res.blob()
      const cd = res.headers.get('Content-Disposition') ?? ''
      const m = /filename\*=UTF-8''([^;]+)/i.exec(cd)
      const name = m ? decodeURIComponent(m[1]) : 'export.xlsx'
      const href = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = href
      link.download = name
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(href)
    } catch (e) {
      console.error('[contact/semi/detail] 엑셀 실패', errorInfo(e))
      toast.error('엑셀을 내려받지 못했습니다. 잠시 뒤 다시 시도해주세요.')
    } finally {
      setExporting(null)
    }
  }

  // ── 삭제 — 서버(DELETE /api/semi-contact/project·report)가 권한(만든 사람·작성자 본인 또는 superadmin)을 다시 본다 ──

  /** Project 를 통째로 지운다. 지우면 목록으로 간다. */
  const deleteProject = async (counts: { reports: number; actions: number }) => {
    if (deleting !== null) return
    const ok = await confirm({
      title: 'Project 삭제',
      message: `보고서 ${counts.reports}건, Action ${counts.actions}건이 함께 삭제되며 복구할 수 없습니다.`,
      confirmText: '삭제',
      variant: 'danger',
    })
    if (!ok) return
    setDeleting('project')
    try {
      const res = await fetch(`/api/semi-contact/project?project_id=${projectId}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        console.error('[contact/semi/detail] Project 삭제 실패', { status: res.status, error: json })
        toast.error(json.error || `Project 를 삭제하지 못했습니다 (${res.status})`)
        return
      }
      toast.success(`Project 를 삭제했습니다 (보고서 ${json.deleted?.reports ?? 0}건, Action ${json.deleted?.actions ?? 0}건)`)
      router.push('/contact/semi')
    } catch (e) {
      console.error('[contact/semi/detail] Project 삭제 실패', errorInfo(e))
      toast.error('Project 를 삭제하지 못했습니다. 잠시 뒤 다시 시도해주세요.')
    } finally {
      setDeleting(null)
    }
  }

  /** 보고서 한 장을 지운다. 이 화면에 남아 세 표를 다시 읽는다(마지막 보고서였으면 빈 상태가 된다). */
  const deleteReport = async (reportId: number, actionCount: number) => {
    if (deleting !== null) return
    const ok = await confirm({
      title: '보고서 삭제',
      message: `이 보고서와 Action ${actionCount}건이 삭제됩니다. 복구할 수 없습니다.`,
      confirmText: '삭제',
      variant: 'danger',
    })
    if (!ok) return
    setDeleting(reportId)
    try {
      const res = await fetch(`/api/semi-contact/report?report_id=${reportId}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        console.error('[contact/semi/detail] 보고서 삭제 실패', { status: res.status, error: json })
        toast.error(json.error || `보고서를 삭제하지 못했습니다 (${res.status})`)
        return
      }
      toast.success('보고서를 삭제했습니다')
      setReloadKey(k => k + 1)
    } catch (e) {
      console.error('[contact/semi/detail] 보고서 삭제 실패', errorInfo(e))
      toast.error('보고서를 삭제하지 못했습니다. 잠시 뒤 다시 시도해주세요.')
    } finally {
      setDeleting(null)
    }
  }

  // ── Action 상태 — 바로 저장. 화면은 먼저 바꾸고, 실패하면 이전 값으로 되돌린다 ──
  const changeStatus = async (actionId: number, next: string) => {
    if (savingStatus.has(actionId)) return
    const before = actionRows.find(a => a.action_id === actionId)
    if (!before || before.status === next) return
    const prevStatus = before.status
    setActionRows(rows => rows.map(a => (a.action_id === actionId ? { ...a, status: next } : a)))
    setSavingStatus(s => new Set(s).add(actionId))
    try {
      const res = await fetch('/api/semi-contact/action', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action_id: actionId, status: next }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        console.error('[contact/semi/detail] Action 상태 저장 실패', { status: res.status, error: json })
        setActionRows(rows => rows.map(a => (a.action_id === actionId ? { ...a, status: prevStatus } : a)))
        toast.error(json.error || `Action 상태를 바꾸지 못했습니다 (${res.status})`)
      }
    } catch (e) {
      console.error('[contact/semi/detail] Action 상태 저장 실패', errorInfo(e))
      setActionRows(rows => rows.map(a => (a.action_id === actionId ? { ...a, status: prevStatus } : a)))
      toast.error('Action 상태를 바꾸지 못했습니다. 잠시 뒤 다시 시도해주세요.')
    } finally {
      setSavingStatus(s => { const n = new Set(s); n.delete(actionId); return n })
    }
  }
  const statusSelect = (a: ActionView) => (
    <select value={a.status} disabled={savingStatus.has(a.id)} aria-label={ACTION_LABELS.status}
      onChange={e => changeStatus(a.id, e.target.value)}
      style={{
        padding: '4px 8px', border: `1px solid ${BORDER}`, borderRadius: 6, fontSize: 12, color: TEXT,
        background: CARD_BG, fontFamily: 'inherit', colorScheme: 'light', cursor: savingStatus.has(a.id) ? 'wait' : 'pointer',
      }}>
      {ACTION_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
      {/* 등록표에 없는 옛 값이 있으면 그대로 보이게 한 줄 더 둔다 */}
      {!(ACTION_STATUSES as readonly string[]).includes(a.status) && <option value={a.status}>{a.status}</option>}
    </select>
  )

  if (!authorized) return <AccessGate loading={guardLoading} />

  if (loadError) {
    return (
      <main style={{ padding: '24px 28px', background: PAGE_BG, minHeight: '100vh' }}>
        <div style={{ ...cardStyle, textAlign: 'center', padding: 40, color: DANGER_TEXT, fontSize: 13, fontWeight: 700, lineHeight: 1.7 }}>
          {loadError}<br />
          <Link href="/contact/semi" style={{ color: BLUE, fontSize: 12, fontWeight: 700 }}>← 목록</Link>
        </div>
      </main>
    )
  }

  if (!project || !reportRows) {
    return (
      <main style={{ padding: '24px 28px', background: PAGE_BG, minHeight: '100vh' }}>
        <div style={{ ...cardStyle, textAlign: 'center', padding: 40, color: MUTED, fontSize: 13 }}>불러오는 중...</div>
      </main>
    )
  }

  const writeHref = `/contact/semi/${project.project_id}/write`
  const latest = views[0] ?? null
  const selected = views.find(v => v.id === selectedId) ?? latest
  // 수정·삭제 버튼은 권한이 있는 사람에게만 보인다(서버가 같은 규칙으로 다시 막는다).
  const isSuper = isSuperAdmin(engineer)
  const myId = engineer?.engineer_id ?? null
  const canManageProject = isSuper || (myId !== null && project.created_by === myId)
  const canManageReport = (v: ReportView) => isSuper || (myId !== null && v.row.author_id === myId)

  const select = (id: number) => {
    setSelectedId(id)
    // 위아래로 쌓인 좁은 화면에서는 상세가 아래에 있으니 그쪽으로 옮겨 준다.
    if (detailRef.current && window.innerWidth <= 900) detailRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <main style={{ padding: '24px 28px', background: PAGE_BG, minHeight: '100vh', boxSizing: 'border-box' }}>
      <style>{SHELL_CSS}</style>
      <div className="sp-shell" style={{ maxWidth: 1280, margin: '0 auto' }}>

        {/* ── 헤더 ── */}
        <div style={boxStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Link href="/contact/semi" style={{ ...btnGhost(), ...smallBtn, textDecoration: 'none' }}>← 목록</Link>
            <span className="num" style={{ ...countBadge, color: BLUE }}>{project.project_no}</span>
            <span style={{ ...cardTitle, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.title}</span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {views.length > 0 && (
                <button type="button" onClick={() => downloadExcel('history')} disabled={exporting !== null}
                  style={btnGhost(exporting !== null)}>
                  {exporting === 'history' ? '만드는 중...' : '전체 이력 엑셀'}
                </button>
              )}
              {canManageProject && (
                <button type="button" onClick={() => setEditingProject(true)} style={btnGhost()}>정보 수정</button>
              )}
              <Link href={writeHref} style={{ ...btnPrimary(), textDecoration: 'none' }}>보고서 작성</Link>
              {canManageProject && (
                <button type="button" disabled={deleting !== null}
                  onClick={() => deleteProject({ reports: views.length, actions: actionRows.length })}
                  style={btnDanger(deleting !== null)}>
                  {deleting === 'project' ? '삭제 중...' : 'Project 삭제'}
                </button>
              )}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10, fontSize: 12, color: SUB }}>
            <span><span style={{ color: MUTED }}>{FIELD_BY_KEY.customer_name.label}</span> {project.customer_name}</span>
            <span><span style={{ color: MUTED }}>{FIELD_BY_KEY.site_dept.label}</span> {project.site_dept?.trim() || '-'}</span>
            <span><span style={{ color: MUTED }}>{FIELD_BY_KEY.title.label}</span> {project.title}</span>
          </div>
        </div>

        {/* ── 요약 카드 ── */}
        <div className="sp-cards">
          <StatCard label="접촉 횟수" value={`${views.length}회`} />
          <StatCard label="최근 접촉일" value={latest?.input.contact_date || '-'} sub={latest ? relDay(latest.input.contact_date, today) : ''} />
          <StatCard label={FIELD_BY_KEY.next_contact_date.label}
            value={latest?.input.next_contact_date || '-'}
            sub={latest?.input.next_contact_date ? relDay(latest.input.next_contact_date, today) : ''} />
          <StatCard label="미완료 Action" value={`${openActions.length}건`} />
        </div>

        {/* ── 미완료 Action — 요약 카드 바로 아래, 전체 폭. 0건이면 한 줄 ── */}
        {openActions.length === 0 ? (
          <div style={{ ...cardStyle, padding: '10px 16px', marginBottom: 12, fontSize: 13, color: MUTED }}>미완료 Action 없음</div>
        ) : (
          <section style={boxStyle}>
            <div style={cardHeader}>
              <span style={cardTitle}>미완료 Action</span>
              <span style={countBadge}>{openActions.length}건</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', minWidth: 680, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ fontSize: 11, fontWeight: 700, color: MUTED, textAlign: 'left' }}>
                    <th style={th}>{ACTION_LABELS.what}</th>
                    <th style={th}>{ACTION_LABELS.owner}</th>
                    <th style={th}>{ACTION_LABELS.due_date}</th>
                    <th style={th}>{ACTION_LABELS.status}</th>
                    <th style={th}>{FIELD_BY_KEY.contact_date.label}</th>
                  </tr>
                </thead>
                <tbody>
                  {openActions.map(a => {
                    const overdue = !!a.due_date && a.due_date < today
                    const v = viewById.get(a.reportId)
                    return (
                      <tr key={a.id} style={{ borderTop: `1px solid ${BORDER}`, fontSize: 13, color: TEXT }}>
                        <td style={td}>{a.what}</td>
                        <td style={{ ...td, color: SUB }}>{a.owner}</td>
                        <td className="num" style={{ ...td, color: overdue ? DANGER_TEXT : SUB, fontWeight: overdue ? 700 : 500, whiteSpace: 'nowrap' }}>
                          {a.due_date}{overdue ? ' (지남)' : ''}
                        </td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{statusSelect(a)}</td>
                        <td className="num" style={{ ...td, whiteSpace: 'nowrap' }}>
                          <button type="button" onClick={() => select(a.reportId)}
                            style={{ border: 'none', background: 'transparent', padding: 0, color: BLUE, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                            {v ? `${seqLabel(v.seq)} (${v.input.contact_date})` : '-'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {views.length === 0 ? (
          <div style={{ ...cardStyle, textAlign: 'center', padding: 40, color: MUTED, fontSize: 13, lineHeight: 1.7 }}>
            아직 접촉 보고서가 없습니다<br />
            <Link href={writeHref} style={{ ...btnPrimary(), display: 'inline-block', marginTop: 10, textDecoration: 'none' }}>보고서 작성</Link>
          </div>
        ) : (
          <div className="sp-cols">
            {/* ── 좌: 접촉 이력 — 우 상세 높이만큼 늘고 안에서 스크롤 ── */}
            <div className="sp-left">
              <section className="sp-left-card" style={cardStyle}>
                <div style={cardHeader}>
                  <span style={cardTitle}>접촉 이력</span>
                  <span style={countBadge}>{views.length}건</span>
                </div>
                <div className="sp-timeline">
                  <Timeline views={views} selectedId={selected?.id ?? null} onSelect={select} />
                </div>
              </section>
            </div>

            {/* ── 우: 선택한 보고서 ── */}
            <div className="sp-right" ref={detailRef}>
              {selected && (
                <ReportDetail
                  key={selected.id}
                  view={selected}
                  actions={actionsByReport.get(selected.id) ?? []}
                  statusCell={statusSelect}
                  buttons={(
                    <>
                      <button type="button" onClick={() => downloadExcel(selected.id)} disabled={exporting !== null}
                        style={{ ...btnGhost(exporting !== null), ...smallBtn }}>
                        {exporting === selected.id ? '만드는 중...' : '이 보고서 엑셀'}
                      </button>
                      {canManageReport(selected) && (
                        <Link href={`${writeHref}?report_id=${selected.id}`} style={{ ...btnGhost(), ...smallBtn, textDecoration: 'none' }}>
                          이 보고서 수정
                        </Link>
                      )}
                      {canManageReport(selected) && (
                        <button type="button" disabled={deleting !== null}
                          onClick={() => deleteReport(selected.id, (actionsByReport.get(selected.id) ?? []).length)}
                          style={{ ...btnDanger(deleting !== null), ...smallBtn }}>
                          {deleting === selected.id ? '삭제 중...' : '이 보고서 삭제'}
                        </button>
                      )}
                    </>
                  )}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {editingProject && (
        <ProjectEditModal
          project={project}
          onClose={() => setEditingProject(false)}
          onSaved={saved => setProject(p => (p ? { ...p, ...saved } : p))}
        />
      )}
    </main>
  )
}

/** useSearchParams 를 Suspense 로 감싼다(의뢰서 목록과 같은 방식). */
export default function SemiProjectDetailPage() {
  return (
    <Suspense fallback={<main style={{ padding: '24px 28px', background: PAGE_BG, minHeight: '100vh' }} />}>
      <SemiProjectDetailInner />
    </Suspense>
  )
}

const th: CSSProperties = { padding: '0 8px 8px 0', whiteSpace: 'nowrap' }
const td: CSSProperties = { padding: '9px 8px 9px 0', verticalAlign: 'top', lineHeight: 1.5 }

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 11, fontWeight: 600, color: MUTED }}>{label}</div>
      <div className="num" style={{ fontSize: 20, fontWeight: 600, color: BLUE, letterSpacing: '-0.5px', marginTop: 6 }}>{value}</div>
      {sub ? <div style={{ fontSize: 12, color: SUB, marginTop: 2 }}>{sub}</div> : null}
    </div>
  )
}

/** 접촉 이력 — 최신순, 해가 바뀌는 자리에 연도 구분선. 항목 앞에 차수(#n). */
function Timeline({ views, selectedId, onSelect }: { views: ReportView[]; selectedId: number | null; onSelect: (id: number) => void }) {
  let lastYear = ''
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {views.map(v => {
        const year = v.input.contact_date.slice(0, 4)
        const showYear = year !== lastYear
        lastYear = year
        const on = v.id === selectedId
        const n = v.changed.size
        return (
          <div key={v.id}>
            {showYear && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 6px' }}>
                <span className="num" style={{ fontSize: 11, fontWeight: 700, color: MUTED }}>{year}</span>
                <span style={{ flex: 1, height: 1, background: BORDER }} />
              </div>
            )}
            <button type="button" onClick={() => onSelect(v.id)} aria-current={on ? 'true' : undefined}
              onMouseEnter={e => { if (!on) e.currentTarget.style.background = ROW_HOVER_BG }}
              onMouseLeave={e => { if (!on) e.currentTarget.style.background = 'transparent' }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '10px 10px', marginBottom: 2,
                border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
                background: on ? NEUTRAL_BG : 'transparent',
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span className="num" style={{ fontSize: 12, fontWeight: 700, color: BLUE }}>{seqLabel(v.seq)}</span>
                <span className="num" style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>{v.input.contact_date}</span>
                <span style={{ fontSize: 12, color: SUB }}>{v.input.contact_method}</span>
                <span style={{ fontSize: 12, color: FAINT }}>·</span>
                <span style={{ fontSize: 12, color: MUTED }}>{v.authorName}</span>
                {n > 0 && <span style={{ ...countBadge, color: BLUE, marginLeft: 'auto' }}>변경 {n}건</span>}
              </div>
              {v.input.purpose.trim() && (
                <div style={{ fontSize: 13, color: TEXT, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {v.input.purpose}
                </div>
              )}
              {v.input.meeting_content.trim() && (
                <div style={{
                  fontSize: 12, color: MUTED, marginTop: 2, lineHeight: 1.5,
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                }}>
                  {v.input.meeting_content}
                </div>
              )}
            </button>
          </div>
        )
      })}
    </div>
  )
}

/** 선택한 보고서 한 장. 상자 사이 간격은 gap 으로만 둔다 — 마지막 상자 아래 여백이 없어야 좌 이력 상자와 끝이 맞는다. */
function ReportDetail({ view, actions, statusCell, buttons }: {
  view: ReportView
  actions: ActionView[]
  /** Action 상태 칸 — 바로 바꾸는 셀렉트(저장은 부모가 한다). */
  statusCell: (a: ActionView) => ReactNode
  /** 엑셀·수정·삭제 버튼 — 권한·진행 상태는 부모가 들고 있다. */
  buttons?: ReactNode
}) {
  // 바뀐 칸이 있는 그룹은 처음부터 편다.
  const [open, setOpen] = useState<Set<number>>(
    () => new Set(REST_GROUPS.filter(g => g.fields.some(f => view.changed.has(f.key as FieldKey))).map(g => g.section.no)),
  )
  const value = (k: FieldKey, opts?: { big?: boolean }) => (
    <ReadField key={k} def={FIELD_BY_KEY[k]} value={view.input[k]}
      changed={view.changed.has(k)} prevValue={view.prevInput ? view.prevInput[k] : ''} big={opts?.big} />
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 머리 — 「#3 · 2026-10-12」 */}
      <section style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="num" style={cardTitle}>{`${seqLabel(view.seq)} · ${view.input.contact_date}`}</span>
          <span style={{ fontSize: 12, color: MUTED }}>{AUTHOR_FIELD.label} {view.authorName}</span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>{buttons}</span>
        </div>
      </section>

      <Box title="이번 접촉">
        <div style={gridStyle}>{CONTACT_KEYS.map(k => value(k))}</div>
      </Box>

      <Box title={SECTIONS.find(s => s.no === 2)?.label ?? ''}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {NOTE_KEYS.map(k => value(k, { big: true }))}
        </div>
      </Box>

      <Box title="Action Items">
        {view.noAction ? (
          <div style={{ fontSize: 13, color: SUB }}>Action 없음</div>
        ) : actions.length === 0 ? (
          <div style={{ fontSize: 13, color: MUTED }}>-</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 680, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ fontSize: 11, fontWeight: 700, color: MUTED, textAlign: 'left' }}>
                  <th style={th}>{ACTION_LABELS.what}</th>
                  <th style={th}>{ACTION_LABELS.owner}</th>
                  <th style={th}>{ACTION_LABELS.due_date}</th>
                  <th style={th}>{ACTION_LABELS.status}</th>
                  <th style={th}>{ACTION_LABELS.priority}</th>
                  <th style={th}>{ACTION_LABELS.note}</th>
                </tr>
              </thead>
              <tbody>
                {actions.map(a => (
                  <tr key={a.id} style={{ borderTop: `1px solid ${BORDER}`, fontSize: 13, color: TEXT }}>
                    <td style={td}>{a.what}</td>
                    <td style={{ ...td, color: SUB }}>{a.owner}</td>
                    <td className="num" style={{ ...td, color: SUB, whiteSpace: 'nowrap' }}>{a.due_date}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{statusCell(a)}</td>
                    <td style={{ ...td, color: SUB, whiteSpace: 'nowrap' }}>{a.priority}</td>
                    <td style={{ ...td, color: SUB }}>{a.note || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Box>

      <Box title={FIELD_BY_KEY.next_contact_date.label}>
        {NEXT_KEYS.map(k => value(k))}
      </Box>

      <Box title="이어받은 항목" right={view.prevInput ? undefined : <span style={{ fontSize: 12, color: MUTED }}>첫 보고서</span>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {REST_GROUPS.map(g => {
            const isOpen = open.has(g.section.no)
            const n = g.fields.filter(f => view.changed.has(f.key as FieldKey)).length
            return (
              <div key={g.section.no} style={{ border: `1px solid ${BORDER}`, borderRadius: 8 }}>
                <button type="button" aria-expanded={isOpen}
                  onClick={() => setOpen(o => { const s = new Set(o); if (s.has(g.section.no)) s.delete(g.section.no); else s.add(g.section.no); return s })}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 12px',
                    border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                  }}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke={MUTED} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease', flexShrink: 0 }}>
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                  <span style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>{g.section.label}</span>
                  <span style={{ fontSize: 12, color: MUTED }}>{g.fields.length}개</span>
                  {n > 0 && <span style={{ ...countBadge, color: BLUE }}>변경 {n}건</span>}
                </button>
                {isOpen && (
                  <div style={{ ...gridStyle, padding: '4px 12px 12px' }}>
                    {g.fields.map(f => value(f.key as FieldKey))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </Box>
    </div>
  )
}

function Box({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section style={cardStyle}>
      <div style={cardHeader}>
        <span style={cardTitle}>{title}</span>
        {right && <span style={{ marginLeft: 'auto' }}>{right}</span>}
      </div>
      {children}
    </section>
  )
}

/** 읽기 전용 칸 하나. 바뀐 칸은 「변경됨」과 직전 보고서의 값을 작게 붙인다. */
function ReadField({ def, value, changed, prevValue, big }: {
  def: FieldDef; value: string; changed: boolean; prevValue: string; big?: boolean
}) {
  const empty = !value.trim()
  return (
    <div>
      <span style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>{def.label}</span>
        {changed && <span style={{ fontSize: 11, fontWeight: 700, color: BLUE, background: NEUTRAL_BG, borderRadius: 99, padding: '1px 7px' }}>변경됨</span>}
      </span>
      <div style={{
        fontSize: big ? 14 : 13, color: empty ? FAINT : TEXT, lineHeight: 1.7,
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        ...(big ? { background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 6, padding: '10px 12px', minHeight: 60 } : null),
      }}>
        {empty ? '-' : value}
      </div>
      {changed && (
        <div style={{ marginTop: 4, fontSize: 11, color: MUTED, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          이전: {prevValue.trim() ? prevValue : '(비어 있음)'}
        </div>
      )}
    </div>
  )
}

// ── Project 정보 수정 모달 ─────────────────────────────────────────────
// 목록의 「새 Project」 모달과 같은 틀·같은 검증(번호: validateProjectNo, 나머지: 등록표 검증에서 Project 칸 오류만,
// 길이 상한 PROJECT_TEXT_MAX). 번호도 고칠 수 있다 — 겹치면(대소문자 무시, 자기 자신 제외) 서버가 번호 칸 오류로 돌려준다.

const fieldStyle: CSSProperties = {
  width: '100%', padding: '9px 10px', border: `1px solid ${BORDER}`, borderRadius: 6,
  fontSize: 13, color: TEXT, background: CARD_BG, outline: 'none', boxSizing: 'border-box',
  fontFamily: 'inherit',
}

type ModalKey = FieldKey | typeof PROJECT_NO_KEY

function projectErrors(projectNo: string, values: Record<FieldKey, string>): Partial<Record<ModalKey, string>> {
  const out: Partial<Record<ModalKey, string>> = {}
  const noErr = validateProjectNo(projectNo)
  if (noErr) out[PROJECT_NO_KEY] = noErr
  const checked = validateReport(values, [], { noAction: true })
  for (const k of PROJECT_KEYS) if (checked.errors[k]) out[k] = checked.errors[k]
  return out
}

function ProjectEditModal({ project, onClose, onSaved }: {
  project: Project
  onClose: () => void
  onSaved: (p: Pick<Project, 'project_no' | 'customer_name' | 'site_dept' | 'title'>) => void
}) {
  const toast = useToast()
  const [projectNo, setProjectNo] = useState(project.project_no)
  const [values, setValues] = useState<Record<FieldKey, string>>(() => ({
    ...emptyInput(), customer_name: project.customer_name, site_dept: project.site_dept ?? '', title: project.title,
  }))
  const { errors, setErrors, clearError, validate } = useFieldErrors<ModalKey>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const change = (k: FieldKey, v: string) => {
    setValues(prev => ({ ...prev, [k]: v.slice(0, PROJECT_TEXT_MAX) }))
    clearError(k)
  }

  const submit = async () => {
    if (busy) return
    if (!validate(projectErrors(projectNo, values))) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/semi-contact/project', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: project.project_id,
          [PROJECT_NO_KEY]: projectNo,
          customer_name: values.customer_name, site_dept: values.site_dept, title: values.title,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        // 칸별 오류(번호 중복 포함)는 그 칸 아래에만, 그 밖의 오류는 모달 아래 상자에 보인다.
        const fe = json.fieldErrors && typeof json.fieldErrors === 'object' ? json.fieldErrors : null
        if (fe) setErrors(fe)
        if (!fe) setError(json.error || `Project 정보를 수정하지 못했습니다 (${res.status})`)
        console.error('[contact/semi/detail] Project 정보 수정 실패', { status: res.status, error: json })
        return
      }
      const p = json.project ?? {}
      onSaved({ project_no: p.project_no, customer_name: p.customer_name, site_dept: p.site_dept ?? null, title: p.title })
      toast.success('Project 정보를 수정했습니다')
      onClose()
    } catch (e) {
      console.error('[contact/semi/detail] Project 정보 수정 실패', errorInfo(e))
      setError('Project 정보를 수정하지 못했습니다. 잠시 뒤 다시 시도해주세요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalOverlay onClose={busy ? () => {} : onClose}>
      <div style={{
        background: CARD_BG, borderRadius: 8, padding: '14px 16px', width: '100%', maxWidth: 500,
        maxHeight: '86vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.22)',
      }}>
        <div style={cardHeader}>
          <span style={cardTitle}>Project 정보 수정</span>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle} htmlFor="pe-project_no">{PROJECT_NO_LABEL}</label>
          <input id="pe-project_no" value={projectNo} maxLength={PROJECT_NO_MAX} disabled={busy}
            onChange={e => { setProjectNo(e.target.value); clearError(PROJECT_NO_KEY) }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit() }}
            style={{ ...fieldStyle, border: errors[PROJECT_NO_KEY] ? errBorder : fieldStyle.border }} />
          <FieldError message={errors[PROJECT_NO_KEY]} />
        </div>
        {PROJECT_KEYS.map(k => {
          const f = FIELD_BY_KEY[k]
          const id = `pe-${k}`
          return (
            <div key={k} style={{ marginBottom: 12 }}>
              <label style={labelStyle} htmlFor={id}>
                {f.label}
                {!f.required && <span style={{ fontWeight: 500 }}> (선택)</span>}
              </label>
              <input id={id} value={values[k]} maxLength={PROJECT_TEXT_MAX} disabled={busy}
                onChange={e => change(k, e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit() }}
                style={{ ...fieldStyle, border: errors[k] ? errBorder : fieldStyle.border }} />
              <FieldError message={errors[k]} />
            </div>
          )
        })}
        {error && (
          <div style={{
            fontSize: 12, lineHeight: 1.6, color: '#be123c', background: '#fef2f2',
            border: `1px solid ${BORDER}`, borderRadius: 8, padding: '8px 10px', marginBottom: 12,
          }}>
            {error}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={onClose} disabled={busy} style={{ ...btnGhost(busy), flex: 1 }}>닫기</button>
          <button type="button" onClick={submit} disabled={busy} style={{ ...btnPrimary(busy), flex: 1 }}>
            {busy ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}
