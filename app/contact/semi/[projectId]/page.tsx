'use client'

// 반도체 고객 접촉 보고 — Project 상세(/contact/semi/<projectId>[?report=<reportId>]).
//
// 위에서 아래로: 헤더(← 목록 아이콘·Project/구매안건·번호 배지 / 고객사·사업장·생성자 / 정보 수정·Excel·+ 새 접촉 보고) → 요약 카드 4개
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
//   · 보고서 수정·삭제 → 작성 화면의 수정 모드(write?report_id=) — 삭제 버튼도 그 화면 하단에 있다(작성자 본인·superadmin)
//   · Project 정보 수정·삭제 → 「Project 정보 수정」 모달(PATCH·DELETE /api/semi-contact/project, 만든 본인·superadmin)
//   · Action 상태 → PATCH /api/semi-contact/action (접근 권한만 있으면 누구나 — 담당이 팀이다)
// 주소의 ?report= 가 있으면 그 보고서를 고른 채 연다(수정 화면에서 돌아올 때).

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { EditIconButton, PencilGlyph } from '@/components/common/IconButton'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { usePageGuard } from '@/hooks/usePageGuard'
import AccessGate from '@/components/common/AccessGate'
import ModalOverlay from '@/components/common/ModalOverlay'
import ModalCard, { keepPads } from '@/components/common/ModalCard'
import { useToast } from '@/components/common/Toast'
import ExcelIconButton from '@/components/common/ExcelIconButton'
import { useConfirm } from '@/components/common/ConfirmDialog'
import { FieldError, errBorder, useFieldErrors } from '@/components/common/fieldErrors'
import { isSuperAdmin } from '@/lib/permissions'
import {
  PAGE_BG, CARD_BG, BORDER, TEXT, MUTED, SUB, FAINT, BLUE, NEUTRAL_BG, ROW_HOVER_BG,
  cardStyle, cardHeader, cardTitle, countBadge, btnPrimary, btnGhost, btnDanger, inputStyle,
} from '@/components/common/ui'
import { daysBetween, todayKST } from '@/lib/date'
import { errorInfo } from '@/lib/errorInfo'
import { ACTION_LABELS, ACTION_STATUSES, actionFromStorage, apiErrorText, AUTHOR_FIELD, changedFields, emptyInput, FIELD_BY_KEY, FIELDS, fromStorage, isSectionShown, SECTIONS, type ActionInput, type FieldDef, type FieldKey, type ReportInput, validateReport } from '@/lib/semiContact'
import {
  PROJECT_KEYS, PROJECT_NO_KEY, PROJECT_NO_LABEL, PROJECT_NO_MAX, PROJECT_TEXT_MAX, validateProjectNo,
} from '@/lib/semiContact/project'
import {
  filterReports, normQuery, reportMatchCount, sectionHasHit, splitHits,
} from '@/lib/semiContact/reportSearch'
import { contactSequence, seqLabel } from '@/lib/semiContact/sequence'
import { nextContactShown, nextContactTbdOf } from '@/lib/semiContact/storage'
import { layoutOf } from '@/lib/semiContact/layout'
import { R } from '@/lib/radius'
import { LABEL_WEIGHT, TEXT_LABEL } from '@/lib/textTokens'

// ── 배치(작성 화면과 같다) ──────────────────────────────────────────────
const CONTACT_KEYS: FieldKey[] = ['contact_date', 'contact_method', 'customer_contact', 'purpose']
/** 「새롭게 확인된 내용」 — 작성 화면과 같이 회의 내용이 위, FACT 가 아래. */
const NOTE_KEYS: FieldKey[] = ['meeting_content', 'fact']
const NEXT_KEYS: FieldKey[] = ['next_contact_date']
const PLACED = new Set<FieldKey>([...PROJECT_KEYS, ...CONTACT_KEYS, ...NOTE_KEYS, ...NEXT_KEYS])
/**
 * 이어받은 항목의 섹션 묶음. **읽는 화면에서 가리는 섹션은 여기서 뺀다** —
 * isSectionShown(lib/semiContact/fields.ts 의 HIDE_SALES_JUDGEMENT). 칸만 빼면 빈 머리줄이
 * 남아 「무언가 가렸다」가 그대로 보이므로 섹션을 통째로 뺀다.
 * 자료·입력 폼·저장·PDF·엑셀·API 는 그대로다 — 가리는 것은 이 화면 하나뿐이다.
 */
const REST_GROUPS = SECTIONS
  .filter(s => isSectionShown(s.no))
  .map(s => ({ section: s, fields: (FIELDS as readonly FieldDef[]).filter(f => f.section === s.no && !PLACED.has(f.key as FieldKey)) }))
  .filter(g => g.fields.length > 0)

/** 완료 상태. 등록표의 Action 상태(Open · In Progress · Done) 중 이것만 완료로 본다 — DB 부분 인덱스와 같은 기준. */
const DONE_STATUS = 'Done'

/** 직전 보고서와 값이 다른 칸의 행 배경(왼쪽 막대는 액센트 #234ea2). */
const CHANGED_BG = '#f4f7fd'
/** Excel 아이콘 색 — 디자인 표의 상태색 「활성」 초록. */

/** 위험(기한 지남) 글자색 — 디자인 표의 「위험」 값. */
const DANGER_TEXT = '#ef4444'

type Project = {
  project_id: number; project_no: string; customer_name: string; site_dept: string | null; title: string
  created_by: number; created_at: string
  /** 만든 사람(engineers 임베드). */
  creator: { name: string | null } | null
}
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
  /** 다음 Contact 예정일 「미정」(detail.next_contact_tbd). */
  nextTbd: boolean
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
  /* 검색 일치 — 노란 바탕(디자인 표에 없는 값이라 2026-11-22 지시의 #fef3c7).
     지금 보고 있는 일치만 액센트 테두리를 더해 구별한다(새 색을 만들지 않는다). */
  .sem-hit { background: #fef3c7; color: inherit; border-radius: ${R.tag}px; padding: 0 1px; }
  .sem-hit-on { outline: 1px solid ${BLUE}; }
  @container (max-width: 900px) {
    .sp-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .sp-cols { grid-template-columns: minmax(0, 1fr); }
    .sp-left, .sp-right { grid-column: 1; }
    .sp-left { position: static; min-height: 0; }
    .sp-left-card { position: static; }
    .sp-timeline { max-height: 420px; }
  }
`

const labelStyle: CSSProperties = { fontSize: 11, fontWeight: LABEL_WEIGHT, color: TEXT_LABEL, marginBottom: 5, display: 'block' }
const gridStyle: CSSProperties = { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }
const boxStyle: CSSProperties = { ...cardStyle, marginBottom: 12 }

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
  /** Project 를 지우는 중. 그동안 삭제 버튼을 막는다(중복 방지). */
  const [deletingProject, setDeletingProject] = useState(false)
  /** 상태를 저장 중인 Action id — 그 셀렉트만 막는다. */
  const [savingStatus, setSavingStatus] = useState<Set<number>>(() => new Set())
  const [editingProject, setEditingProject] = useState(false)
  /** 이 Project 안에서의 검색 — 친 글자와 300ms 뒤의 값. */
  const [qInput, setQInput] = useState('')
  const [qDebounced, setQDebounced] = useState('')
  /** 주소의 q= 를 읽어 넣었는가 — 넣기 전에는 주소를 고치지 않는다. */
  const [qReady, setQReady] = useState(false)
  /** 지금 보고 있는 일치의 번호. 그림에 쓰지 않으므로 ref 다(상태로 두면 효과에서 고쳐야 한다). */
  const hitAt = useRef(0)

  // 주소 → 검색어(새로고침·뒤로 가기에서 그대로 돌아온다).
  useEffect(() => {
    const q0 = new URLSearchParams(window.location.search).get('q') ?? ''
    setQInput(q0); setQDebounced(q0); setQReady(true)
  }, [])

  // 검색어 디바운스 — 300ms 동안 더 치지 않으면 그때 거른다.
  useEffect(() => {
    const id = setTimeout(() => setQDebounced(qInput), 300)
    return () => clearTimeout(id)
  }, [qInput])

  /** 검색어 → 주소. report= 는 그대로 두고 q= 만 넣고 뺀다(replaceState — 기록을 쌓지 않는다). */
  useEffect(() => {
    if (!qReady) return
    const sp = new URLSearchParams(window.location.search)
    const v = qDebounced.trim()
    if (v) sp.set('q', v); else sp.delete('q')
    const qs = sp.toString()
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname)
  }, [qReady, qDebounced])

  /**
   * ▲▼ 이동 — 그려 놓은 mark 를 **DOM 순서**로 집는다. 그리는 쪽에서 번호를 세지 않는다
   * (렌더가 여러 번 돌 수 있어 렌더 중에 센 번호는 믿을 수 없다).
   */
  const focusHit = useCallback((i: number) => {
    const list = Array.from(detailRef.current?.querySelectorAll<HTMLElement>('mark[data-sem-hit]') ?? [])
    if (list.length === 0) return
    const n = ((i % list.length) + list.length) % list.length
    hitAt.current = n
    for (const el of list) el.classList.remove('sem-hit-on')
    list[n].classList.add('sem-hit-on')
    list[n].scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [])

  // 검색어가 바뀌면 첫 일치로 간다(효과는 그린 뒤에 돈다 — mark 가 이미 있다).
  useEffect(() => {
    hitAt.current = 0
    if (normQuery(qDebounced)) focusHit(0)
  }, [qDebounced, focusHit])

  useEffect(() => {
    if (!authorized) return
    if (!Number.isInteger(projectId) || projectId <= 0) { setLoadError('Project 주소가 올바르지 않습니다.'); return }
    let cancelled = false
    const load = async () => {
      const [p, r, a] = await Promise.all([
        supabase.from('semi_projects')
          .select('project_id, project_no, customer_name, site_dept, title, created_by, created_at, creator:engineers!semi_projects_created_by_fkey(name)')
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
      setProject(p.data as unknown as Project)
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
  }, [authorized, projectId, supabase])

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
        nextTbd: nextContactTbdOf(row),
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
        toast.error(apiErrorText(res.status, json, `엑셀을 내려받지 못했습니다 (${res.status})`))
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

  // ── Project 삭제 — 「Project 정보 수정」 모달에서 부른다. 서버(DELETE /api/semi-contact/project)가 권한을 다시 본다 ──
  // 보고서 한 장의 삭제는 작성 화면의 수정 모드(write?report_id=) 하단으로 옮겼다.

  /** Project 를 통째로 지운다. 지우면 목록으로 간다. */
  const deleteProject = async (counts: { reports: number; actions: number }) => {
    if (deletingProject) return
    const ok = await confirm({
      title: 'Project 삭제',
      message: `보고서 ${counts.reports}건, Action ${counts.actions}건이 함께 삭제되며 복구할 수 없습니다.`,
      confirmText: '삭제',
      variant: 'danger',
    })
    if (!ok) return
    setDeletingProject(true)
    try {
      const res = await fetch(`/api/semi-contact/project?project_id=${projectId}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        console.error('[contact/semi/detail] Project 삭제 실패', { status: res.status, error: json })
        toast.error(apiErrorText(res.status, json, `Project 를 삭제하지 못했습니다 (${res.status})`))
        return
      }
      toast.success(`Project 를 삭제했습니다 (보고서 ${json.deleted?.reports ?? 0}건, Action ${json.deleted?.actions ?? 0}건)`)
      router.push('/contact/semi')
    } catch (e) {
      console.error('[contact/semi/detail] Project 삭제 실패', errorInfo(e))
      toast.error('Project 를 삭제하지 못했습니다. 잠시 뒤 다시 시도해주세요.')
    } finally {
      setDeletingProject(false)
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
        toast.error(apiErrorText(res.status, json, `Action 상태를 바꾸지 못했습니다 (${res.status})`))
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
        padding: '4px 8px', border: `1px solid ${BORDER}`, borderRadius: R.icon, fontSize: 12, color: TEXT,
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

  // ── 이 Project 안에서의 검색 ──
  // 거르기·세기는 모두 순수 모듈이 한다(lib/semiContact/reportSearch.ts). 「다음 Contact 예정일」은
  // 화면에 보이는 글자(미정 포함)를 넘긴다 — 세는 값과 보이는 값이 달라지면 안 된다.
  const q = normQuery(qDebounced)
  const items = views.map(v => {
    const rep = {
      view: v,
      input: { ...v.input, next_contact_date: nextContactShown(v.input.next_contact_date, v.nextTbd) },
      authorName: v.authorName,
      actions: actionsByReport.get(v.id) ?? [],
    }
    return { ...rep, hits: reportMatchCount(rep, q) }
  })
  const shown = filterReports(items, q)
  // 고른 보고서가 걸러져 사라졌으면 남은 것의 첫 줄을 연다(아무것도 안 걸리면 전처럼 둔다).
  const selected = shown.find(x => x.view.id === selectedId)?.view
    ?? (q ? shown[0]?.view : undefined)
    ?? views.find(v => v.id === selectedId)
    ?? latest
  const selectedHits = items.find(x => x.view.id === selected?.id)?.hits ?? 0
  // 수정·삭제 버튼은 권한이 있는 사람에게만 보인다(서버가 같은 규칙으로 다시 막는다).
  const isSuper = isSuperAdmin(engineer)
  const myId = engineer?.engineer_id ?? null
  const canManageProject = isSuper || (myId !== null && project.created_by === myId)
  const canManageReport = (v: ReportView) => isSuper || (myId !== null && v.row.author_id === myId)

  const select = (id: number) => {
    setSelectedId(id)
    hitAt.current = 0
    // 검색 중이면 그 보고서의 첫 일치로 간다(그려진 뒤에 찾아야 하므로 한 틱 뒤).
    if (q) { setTimeout(() => focusHit(0), 0); return }
    // 위아래로 쌓인 좁은 화면에서는 상세가 아래에 있으니 그쪽으로 옮겨 준다.
    if (detailRef.current && window.innerWidth <= 900) detailRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <main style={{ padding: '24px 28px', background: PAGE_BG, minHeight: '100vh', boxSizing: 'border-box' }}>
      <style>{SHELL_CSS}</style>
      <div className="sp-shell" style={{ maxWidth: 1280, margin: '0 auto' }}>

        {/* ── 헤더 — 목록 화살표 · 안건 · 번호 배지 / 고객사 · 사업장/부서 · 생성자 / 오른쪽 아이콘·버튼 ── */}
        <div style={boxStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Link href="/contact/semi" aria-label="목록으로" title="목록으로" style={{ ...iconBtn, background: 'transparent' }}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></svg>
            </Link>
            <span style={{ ...cardTitle, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.title}</span>
            <span className="num" style={countBadge}>{project.project_no}</span>
            <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              {canManageProject && (
                <EditIconButton size={30} label="Project 정보 수정" onClick={() => setEditingProject(true)} />
              )}
              {views.length > 0 && (
                /* 초록 XLS 문서 아이콘이던 것을 공용 ⬇ 로 바꿨다(2026-11-26 묶음2 E) —
                   시스템 안에서 「엑셀로 받기」는 한 모양이다. 동작은 그대로다. */
                <ExcelIconButton size={30} label="Excel 출력"
                  busy={exporting === 'history'} disabled={exporting !== null}
                  onClick={() => void downloadExcel('history')} />
              )}
              <Link href={writeHref} style={{ ...btnPrimary(), textDecoration: 'none' }}>+ 새 접촉 보고</Link>
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 6, marginLeft: 38, fontSize: 12, color: SUB }}>
            <span>{project.customer_name}</span>
            <span style={{ color: FAINT }}>·</span>
            <span>{project.site_dept?.trim() || '-'}</span>
            <span style={{ color: FAINT }}>·</span>
            <span style={{ fontSize: 11, color: MUTED }}>{project.creator?.name ?? '-'}</span>
          </div>
        </div>

        {/* ── 요약 카드 ── */}
        <div className="sp-cards">
          <StatCard label="접촉 횟수" value={`${views.length}회`} />
          <StatCard label="최근 접촉일" value={latest?.input.contact_date || '-'} sub={latest ? relDay(latest.input.contact_date, today) : ''} />
          <StatCard label={FIELD_BY_KEY.next_contact_date.label}
            value={(latest ? nextContactShown(latest.input.next_contact_date, latest.nextTbd) : '') || '-'}
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
                  {q !== '' && (
                    <span className="num" style={{ marginLeft: 'auto', fontSize: 12, color: MUTED, whiteSpace: 'nowrap' }}>
                      결과 {shown.length}건
                    </span>
                  )}
                </div>

                {/* ── 검색 — **이 Project 의 보고서 안에서만** 찾는다 ──
                    대상은 보고서의 글자 칸 전부(가린 섹션·Project 칸은 뺀다 — reportSearch.ts). */}
                <div style={{ position: 'relative', marginBottom: 8 }}>
                  <input value={qInput} onChange={e => setQInput(e.target.value)}
                    placeholder="이 Project 의 보고서 검색"
                    aria-label="이 Project 의 보고서 검색"
                    style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', paddingRight: qInput ? 30 : undefined }} />
                  {qInput && (
                    <button type="button" aria-label="검색어 지우기" onClick={() => setQInput('')}
                      style={{
                        position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                        border: 'none', background: 'transparent', color: MUTED, cursor: 'pointer', padding: 0,
                        display: 'flex', alignItems: 'center',
                      }}>
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
                    </button>
                  )}
                </div>

                <div className="sp-timeline">
                  {q !== '' && shown.length === 0 ? (
                    <div style={{ fontSize: 13, color: MUTED, padding: '12px 2px', lineHeight: 1.7 }}>
                      일치하는 보고서가 없습니다
                    </div>
                  ) : (
                    <Timeline items={shown} selectedId={selected?.id ?? null} onSelect={select} q={q} />
                  )}
                </div>
              </section>
            </div>

            {/* ── 우: 선택한 보고서 ── */}
            <div className="sp-right" ref={detailRef}>
              {/* ── 일치 띠 — 「N곳 일치 · ▲ ▼」. 세는 수는 물들이는 수와 같은 함수다. ── */}
              {q !== '' && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
                  padding: '8px 12px', background: NEUTRAL_BG, borderRadius: R.control, border: `1px solid ${BORDER}`,
                }}>
                  <span className="num" style={{ fontSize: 12, fontWeight: 600, color: selectedHits > 0 ? TEXT : MUTED }}>
                    {selectedHits > 0 ? `${selectedHits}곳 일치` : '이 보고서에는 일치가 없습니다'}
                  </span>
                  {selectedHits > 0 && (
                    <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4 }}>
                      <button type="button" aria-label="이전 일치" title="이전 일치" onClick={() => focusHit(hitAt.current - 1)} style={iconBtn}>
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6" /></svg>
                      </button>
                      <button type="button" aria-label="다음 일치" title="다음 일치" onClick={() => focusHit(hitAt.current + 1)} style={iconBtn}>
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                      </button>
                    </span>
                  )}
                </div>
              )}
              {selected && (
                <ReportDetail
                  key={selected.id}
                  view={selected}
                  q={q}
                  actions={actionsByReport.get(selected.id) ?? []}
                  statusCell={statusSelect}
                  buttons={(
                    <>
                      {canManageReport(selected) && (
                        <Link href={`${writeHref}?report_id=${selected.id}`} title="이 접촉 보고서 수정" aria-label="이 접촉 보고서 수정" style={iconBtn}>
                          <PencilIcon />
                        </Link>
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
          deleting={deletingProject}
          onDelete={() => deleteProject({ reports: views.length, actions: actionRows.length })}
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

/**
 * 접촉 이력 — 최신순. 항목 앞에 차수(#n).
 *
 * 연도는 **적지 않는다**(2026-11-22 지시) — 최신 연도부터 내려오고 줄마다 날짜가 적혀 있어
 * 「2026」 머리줄은 같은 말을 두 번 하는 것이었다. 해가 바뀌는 자리에만 **글자 없는 얇은 줄** 하나를
 * 두어 끊어 보인다.
 */
function Timeline({ items, selectedId, onSelect, q }: {
  items: { view: ReportView; hits: number }[]
  selectedId: number | null
  onSelect: (id: number) => void
  /** 다듬은 검색어(빈 글자면 검색 중이 아니다). */
  q: string
}) {
  /** 연도 구분선을 어디에 둘지 — **앞 줄과 비교**해서 정한다(렌더 중에 바깥 변수를 세지 않는다). */
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {items.map(({ view: v, hits }, i) => {
        const year = v.input.contact_date.slice(0, 4)
        const prevYear = i > 0 ? items[i - 1].view.input.contact_date.slice(0, 4) : year
        const yearBreak = year !== prevYear
        const on = v.id === selectedId
        const n = v.changed.size
        return (
          <div key={v.id}>
            {yearBreak && <div style={{ height: 1, background: BORDER, margin: '8px 0 7px' }} />}
            <button type="button" onClick={() => onSelect(v.id)} aria-current={on ? 'true' : undefined}
              onMouseEnter={e => { if (!on) e.currentTarget.style.background = ROW_HOVER_BG }}
              onMouseLeave={e => { if (!on) e.currentTarget.style.background = 'transparent' }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '10px 10px', marginBottom: 2,
                border: 'none', borderRadius: R.icon, cursor: 'pointer', fontFamily: 'inherit',
                background: on ? NEUTRAL_BG : 'transparent',
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span className="num" style={{ fontSize: 12, fontWeight: 700, color: BLUE }}>{seqLabel(v.seq)}</span>
                <span className="num" style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>{v.input.contact_date}</span>
                <span style={{ fontSize: 12, color: SUB }}>{v.input.contact_method}</span>
                <span style={{ fontSize: 12, color: FAINT }}>·</span>
                <span style={{ fontSize: 12, color: MUTED }}>{v.authorName}</span>
                {(n > 0 || q !== '') && (
                  <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {n > 0 && <span style={{ ...countBadge, color: BLUE }}>변경 {n}건</span>}
                    {q !== '' && <span className="num" style={{ ...countBadge, color: BLUE }}>일치 {hits}곳</span>}
                  </span>
                )}
              </div>
              {v.input.purpose.trim() && (
                <div style={{ fontSize: 13, color: TEXT, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <Hi text={v.input.purpose} q={q} />
                </div>
              )}
              {v.input.meeting_content.trim() && (
                <div style={{
                  fontSize: 12, color: MUTED, marginTop: 2, lineHeight: 1.5,
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                }}>
                  <Hi text={v.input.meeting_content} q={q} />
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
function ReportDetail({ view, actions, statusCell, buttons, q }: {
  view: ReportView
  actions: ActionView[]
  /** 다듬은 검색어 — 걸린 자리를 물들인다(빈 글자면 그냥 글자다). */
  q: string
  /** Action 상태 칸 — 바로 바꾸는 셀렉트(저장은 부모가 한다). */
  statusCell: (a: ActionView) => ReactNode
  /** 엑셀·수정 아이콘 — 권한·진행 상태는 부모가 들고 있다. */
  buttons?: ReactNode
}) {
  // 이어받은 항목은 처음에 모두 펼쳐 둔다(접기는 그대로 쓸 수 있다).
  const [open, setOpen] = useState<Set<number>>(() => new Set(REST_GROUPS.map(g => g.section.no)))
  const value = (k: FieldKey, opts?: { big?: boolean }) => (
    <ReadField key={k} def={FIELD_BY_KEY[k]} q={q}
      value={k === 'next_contact_date' ? nextContactShown(view.input[k], view.nextTbd) : view.input[k]}
      changed={view.changed.has(k)} prevValue={view.prevInput ? view.prevInput[k] : ''} big={opts?.big} />
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 머리 — 「#3 · 2026-10-12」 */}
      <section style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="num" style={cardTitle}>{`${seqLabel(view.seq)} · ${view.input.contact_date}`}</span>
          <span style={{ fontSize: 12, color: MUTED }}>{AUTHOR_FIELD.label} <Hi text={view.authorName} q={q} /></span>
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>{buttons}</span>
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
                    <td style={td}><Hi text={a.what} q={q} /></td>
                    <td style={{ ...td, color: SUB }}><Hi text={a.owner} q={q} /></td>
                    <td className="num" style={{ ...td, color: SUB, whiteSpace: 'nowrap' }}><Hi text={a.due_date} q={q} /></td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{statusCell(a)}</td>
                    <td style={{ ...td, color: SUB, whiteSpace: 'nowrap' }}><Hi text={a.priority} q={q} /></td>
                    <td style={{ ...td, color: SUB }}>{a.note ? <Hi text={a.note} q={q} /> : '-'}</td>
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

      <Box
        title="이어받은 항목"
        badge={view.prevInput && view.changed.size > 0
          ? <span className="num" style={{ ...countBadge, color: BLUE }}>{`직전(${seqLabel(view.seq - 1)}) 대비 변경 ${view.changed.size}건`}</span>
          : undefined}
        right={view.prevInput ? undefined : <span style={{ fontSize: 12, color: MUTED }}>첫 보고서</span>}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {REST_GROUPS.map(g => {
            // 일치가 든 섹션은 접혀 있어도 펴 둔다 — 「N곳 일치」라 적고서 감추면 안 된다.
            const isOpen = open.has(g.section.no) || sectionHasHit(view.input, g.fields.map(f => f.key), q)
            const n = g.fields.filter(f => view.changed.has(f.key as FieldKey)).length
            return (
              <div key={g.section.no} style={{ border: `1px solid ${BORDER}`, borderRadius: R.control }}>
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
                  <div style={{ borderTop: `1px solid ${BORDER}` }}>
                    {layoutOf(g.section.no, g.fields).map(({ def: f }, i) => (
                      <InheritRow key={f.key} first={i === 0} def={f} q={q} value={view.input[f.key as FieldKey]}
                        changed={view.changed.has(f.key as FieldKey)}
                        prevValue={view.prevInput ? view.prevInput[f.key as FieldKey] : ''} />
                    ))}
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

function Box({ title, badge, right, children }: { title: string; badge?: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <section style={cardStyle}>
      <div style={cardHeader}>
        <span style={cardTitle}>{title}</span>
        {badge}
        {right && <span style={{ marginLeft: 'auto' }}>{right}</span>}
      </div>
      {children}
    </section>
  )
}

// ── 직전 보고서 대비 바뀐 칸 표시 ─────────────────────────────────────
// 판정은 views 를 만들 때 changedFields(직전 보고서 → 이 보고서, 가져오기 칸만, 공백 접기·빈 값 = null)로 이미 했다.
// 여기서는 모양만: 왼쪽 4px 막대(#234ea2) + 행 배경 + 항목명 액센트 700 + 「변경」 pill + 「직전: ~~값~~」.
// 바뀌지 않은 칸도 같은 폭의 투명 막대를 두어 글자 줄이 흔들리지 않게 한다.

/** 「변경」 pill — 채운 액센트, 흰 글자. */
function ChangedPill() {
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color: CARD_BG, background: BLUE, borderRadius: R.pill, padding: '1px 7px', lineHeight: 1.6, flexShrink: 0 }}>
      변경
    </span>
  )
}

/** 「직전: ~~값~~」. 직전 값이 비었으면 취소선 없이 (비어 있음). */
function PrevLine({ value }: { value: string }) {
  return (
    <div style={{ marginTop: 2, fontSize: 12, color: MUTED, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      직전: {value.trim() ? <s>{value}</s> : '(비어 있음)'}
    </div>
  )
}

/** 바뀐 칸의 바깥 모양(막대·배경). */
const changedFrame = (changed: boolean): CSSProperties => ({
  borderLeft: `4px solid ${changed ? BLUE : 'transparent'}`,
  background: changed ? CHANGED_BG : 'transparent',
})

/**
 * 검색어가 걸린 자리를 물들인다. 토막 나누기는 순수 모듈이 한다(splitHits) — **세는 함수와
 * 물들이는 함수가 같은 규칙**을 봐야 「N곳 일치」가 맞는다. ▲▼ 이동은 여기서 그린 mark 를
 * DOM 순서로 집는다(data-sem-hit).
 */
function Hi({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>
  return (
    <>
      {splitHits(text, q).map((part, i) => (
        part.hit
          ? <mark key={i} data-sem-hit="1" className="sem-hit">{part.text}</mark>
          : <span key={i}>{part.text}</span>
      ))}
    </>
  )
}

/** 읽기 전용 칸 하나(이번 접촉·새롭게 확인된 내용·다음 Contact 예정일). */
function ReadField({ def, value, changed, prevValue, big, q }: {
  def: FieldDef; value: string; changed: boolean; prevValue: string; big?: boolean; q: string
}) {
  const empty = !value.trim()
  return (
    <div style={{ ...changedFrame(changed), padding: '4px 8px', borderRadius: changed ? 0 : undefined }}>
      <span style={{ ...labelStyle, ...(changed ? { color: BLUE } : null) }}>{def.label}</span>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{
          flex: 1, minWidth: 0,
          fontSize: big ? 14 : 13, color: empty ? FAINT : TEXT, lineHeight: 1.7,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          ...(big ? { background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: R.icon, padding: '10px 12px', minHeight: 60 } : null),
        }}>
          {empty ? '-' : <Hi text={value} q={q} />}
        </div>
        {changed && <ChangedPill />}
      </div>
      {changed && <PrevLine value={prevValue} />}
    </div>
  )
}

/** 이어받은 항목 한 줄 — 「항목명 | 값」. 좁으면 값이 아래로 내려간다. */
function InheritRow({ def, value, changed, prevValue, first, q }: {
  def: FieldDef; value: string; changed: boolean; prevValue: string; first: boolean; q: string
}) {
  const empty = !value.trim()
  return (
    <div style={{
      ...changedFrame(changed),
      display: 'flex', flexWrap: 'wrap', gap: '2px 12px', padding: '8px 12px 8px 8px',
      borderTop: first ? 'none' : `1px solid ${BORDER}`,
    }}>
      <span style={{ flex: '0 0 160px', fontSize: 12, fontWeight: changed ? 700 : 600, color: changed ? BLUE : SUB, lineHeight: 1.7 }}>
        {def.label}
      </span>
      <div style={{ flex: '1 1 240px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <span style={{ minWidth: 0, fontSize: 13, color: empty ? FAINT : TEXT, lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {empty ? '-' : <Hi text={value} q={q} />}
          </span>
          {changed && <ChangedPill />}
        </div>
        {changed && <PrevLine value={prevValue} />}
      </div>
    </div>
  )
}

// ── 아이콘 버튼 ───────────────────────────────────────────────────────

/** 30×30 아이콘 버튼(연필 등) — 중립 배경 #f3f4f6, 글자 #6b7280, 반지름 6. */
const iconBtn: CSSProperties = {
  width: 30, height: 30, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  border: 'none', borderRadius: R.icon, background: NEUTRAL_BG, color: SUB, cursor: 'pointer', padding: 0,
  textDecoration: 'none',
}

/** 연필 — 모양은 공용에서 가져온다(components/common/IconButton.tsx). */
function PencilIcon() {
  return <PencilGlyph size={15} />
}

// 초록 XLS 문서 아이콘(ExcelButton)은 2026-11-26 묶음2 E 에서 걷었다 —
// 시스템 안에서 「엑셀로 받기」는 공용 ⬇ 하나다(components/common/ExcelIconButton.tsx).

// ── Project 정보 수정 모달 ─────────────────────────────────────────────
// 목록의 「새 Project」 모달과 같은 틀·같은 검증(번호: validateProjectNo, 나머지: 등록표 검증에서 Project 칸 오류만,
// 길이 상한 PROJECT_TEXT_MAX). 번호도 고칠 수 있다 — 겹치면(대소문자 무시, 자기 자신 제외) 서버가 번호 칸 오류로 돌려준다.

const fieldStyle: CSSProperties = {
  width: '100%', padding: '9px 10px', border: `1px solid ${BORDER}`, borderRadius: R.icon,
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

function ProjectEditModal({ project, onClose, onSaved, onDelete, deleting }: {
  project: Project
  onClose: () => void
  onSaved: (p: Pick<Project, 'project_no' | 'customer_name' | 'site_dept' | 'title'>) => void
  /** Project 삭제 — 확인창과 이동은 부모가 한다. 이 모달은 정보 수정 권한이 있는 사람에게만 열린다. */
  onDelete: () => void
  deleting: boolean
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
        if (!fe) setError(apiErrorText(res.status, json, `Project 정보를 수정하지 못했습니다 (${res.status})`))
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
    // 저장 중에는 닫히지 않는다(closeOn 'none'). 그 밖에는 확인 뒤 닫는다.
    <ModalOverlay onClose={onClose} closeOn={busy ? 'none' : 'both'} confirmClose>
      {/* 공용 카드로 옮겼다(2026-11-26, 지시 P) — 열림 모션 150ms · Esc·바깥 클릭·✕ 가
          한 함수를 지난다(저장 중에는 셋 다 막히고, 고치던 것이 있으면 확인을 지난다).
          겉모양은 그대로다: 폭 500 · 최대 높이 86vh · 여백 14/16 · 머리줄은 공용 cardHeader.
          전에는 **카드 전체가** 구르고 단추 줄도 함께 올라갔다 — 이제 본문만 구르고
          단추가 늘 바닥에 있는다(그 점만 달라졌다). */}
      <ModalCard
        width={500}
        closeX={false}
        {...keepPads({ x: 16, top: 14, bottom: 14 }, 0, 12)}
        style={{ borderRadius: R.control, maxHeight: '86vh' }}
        title={<div style={cardHeader}><span style={cardTitle}>Project 정보 수정</span></div>}
        footer={<>
          <button type="button" onClick={onDelete} disabled={busy || deleting} style={btnDanger(busy || deleting)}>
            {deleting ? '삭제 중...' : 'Project 삭제'}
          </button>
          <button type="button" onClick={onClose} disabled={busy || deleting} style={{ ...btnGhost(busy || deleting), flex: 1 }}>닫기</button>
          <button type="button" onClick={submit} disabled={busy || deleting} style={{ ...btnPrimary(busy || deleting), flex: 1 }}>
            {busy ? '저장 중...' : '저장'}
          </button>
        </>}
      >
        <>
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
            border: `1px solid ${BORDER}`, borderRadius: R.control, padding: '8px 10px', marginBottom: 12,
          }}>
            {error}
          </div>
        )}
        </>
      </ModalCard>
    </ModalOverlay>
  )
}
