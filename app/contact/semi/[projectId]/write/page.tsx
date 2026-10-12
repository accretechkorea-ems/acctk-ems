'use client'

// 반도체 고객 접촉 보고 — 보고서 작성 화면(/contact/semi/<projectId>/write).
//
// 위에서 아래로: 헤더(Project, 읽기 전용) → 이번 접촉 → 새롭게 확인된 내용(FACT·회의 내용, 가장 크게)
// → Action Items → 다음 접촉 예정일 → 이어받은 항목(나머지 칸, 섹션별로 접힘) → 하단 고정 바(임시저장 상태·취소·저장).
// 칸 이름·섹션·선택지는 전부 필드 등록표(lib/semiContact/fields.ts)에서 읽는다 — 이 화면은 배치만 정한다.
//
// 이어쓰기 — 같은 Project 의 직전 보고서(contact_date desc, report_id desc 첫 건)를 브라우저 세션으로 읽어
// fromStorage 로 입력 모양으로 되돌린 뒤 prefillFromPrevious 로 가져오기(carry) 칸만 채운다. 직전 보고가 없으면 빈 값.
// 가져온 값을 바꾸면 changedFields 가 그 칸을 「변경됨」으로 잡는다(되돌리면 풀린다).
//
// 임시저장 — 입력이 바뀌면 1초 뒤 이 브라우저에 저장한다(lib/semiContact/draft.ts). DB 에는 저장하지 않는다.
// 저장 — POST /api/semi-contact/report. 검증은 저장 전에 같은 규칙(validateReport)으로 한 번 보고,
// 서버가 돌려준 fieldErrors·actionErrors 도 같은 자리에 붙인다.
//
// 진입은 usePageGuard 가 판정한다(경로 → contact_semi → canAccessSemiContact).
//
// 수정 모드 — 주소에 ?report_id=<id> 가 있으면 그 보고서를 고친다(같은 화면을 쓴다).
//   · 미리 채우기 대신 그 보고서의 저장된 값과 Action(action_id 포함)을 브라우저 세션으로 읽는다.
//   · 「변경됨」은 그 보고서의 직전 보고서((contact_date, report_id) 가 더 앞인 것 중 마지막) 대비로 계산한다.
//   · 작성자 본인이나 superadmin 만 연다(서버 PATCH 와 같은 규칙). 임시저장 키는 semi-draft-edit:<engineerId>:<reportId>.
//   · 저장은 PATCH /api/semi-contact/report, 성공하면 Project 상세로 돌아가 그 보고서를 고른 채 연다.
// 헤더의 접촉 차수(#n) — 새 보고서는 기존 건수 + 1, 수정은 그 보고서보다 앞선 건수 + 1(head count 한 번).

import { Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { usePageGuard } from '@/hooks/usePageGuard'
import { isSuperAdmin } from '@/lib/permissions'
import AccessGate from '@/components/common/AccessGate'
import { useToast } from '@/components/common/Toast'
import { useConfirm } from '@/components/common/ConfirmDialog'
import { FieldError, errBorder } from '@/components/common/fieldErrors'
import {
  PAGE_BG, CARD_BG, BORDER, TEXT, MUTED, SUB, BLUE, NEUTRAL_BG,
  cardStyle, cardHeader, cardTitle, countBadge, btnPrimary, btnGhost, btnDanger,
} from '@/components/common/ui'
import { kstStamp, nowHmKST, todayKST } from '@/lib/date'
import { errorInfo } from '@/lib/errorInfo'
import { loadTeamPerms } from '@/lib/teamPerms'
import {
  ACTION_LABELS, ACTION_PRIORITIES, ACTION_STATUSES, FIELDS, FIELD_BY_KEY, FIELD_KEYS, SECTIONS,
  actionFromStorage, changedFields, emptyAction, emptyInput, fromStorage, meaningfulActions, prefillFromPrevious, validateReport,
  type ActionField, type ActionInput, type FieldDef, type FieldKey, type ReportInput,
} from '@/lib/semiContact'
import { PROJECT_KEYS } from '@/lib/semiContact/project'
import { clearDraftAt, loadDraftAt, saveDraftAt, semiDraftKey, semiEditDraftKey } from '@/lib/semiContact/draft'
import { seqLabel } from '@/lib/semiContact/sequence'

// ── 배치 ─────────────────────────────────────────────────────────────
/** 「이번 접촉」 상자. */
const CONTACT_KEYS: FieldKey[] = ['contact_date', 'contact_method', 'customer_contact', 'purpose']
/** 「새롭게 확인된 내용」 상자 — 이 화면의 핵심. FACT 를 맨 위에 둔다. */
const NOTE_KEYS: FieldKey[] = ['fact', 'meeting_content']
/** 「다음 접촉 예정일」 상자. */
const NEXT_KEYS: FieldKey[] = ['next_contact_date']
/** 위 상자·헤더에 놓인 칸. 나머지는 전부 「이어받은 항목」으로 간다. */
const PLACED = new Set<FieldKey>([...PROJECT_KEYS, ...CONTACT_KEYS, ...NOTE_KEYS, ...NEXT_KEYS])
/** 이어받은 항목 — 섹션별로, 등록표 순서대로. 칸이 없는 섹션은 뺀다. */
const INHERITED_GROUPS = SECTIONS
  .map(s => ({ section: s, fields: (FIELDS as readonly FieldDef[]).filter(f => f.section === s.no && !PLACED.has(f.key as FieldKey)) }))
  .filter(g => g.fields.length > 0)

/** 임시저장 디바운스(ms). */
const DRAFT_DELAY = 1000

type Project = { project_id: number; project_no: string; customer_name: string; site_dept: string | null; title: string }
/** 화면 안의 Action 줄. rid 는 React key·오류 자리용(저장하지 않는다). action_id 는 수정 모드에서 기존 줄에만 있다. */
type ActionRow = ActionInput & { rid: number; action_id?: number }
type ActionErrors = Record<number, Partial<Record<ActionField, string>>>

const fieldStyle: CSSProperties = {
  width: '100%', padding: '9px 10px', border: `1px solid ${BORDER}`, borderRadius: 6,
  fontSize: 13, color: TEXT, background: CARD_BG, outline: 'none', boxSizing: 'border-box',
  fontFamily: 'inherit', colorScheme: 'light',
}
const labelStyle: CSSProperties = { fontSize: 11, fontWeight: 700, color: MUTED, marginBottom: 5, display: 'block' }
const gridStyle: CSSProperties = { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }
const boxStyle: CSSProperties = { ...cardStyle, marginBottom: 12 }

/** 입력 상태를 비교·저장할 모양으로(rid 는 뺀다). */
function snapshotOf(values: ReportInput, actions: ActionRow[], noAction: boolean): string {
  return JSON.stringify({ values, actions: actions.map(({ rid: _rid, ...a }) => a), noAction })
}

function SemiReportWriteInner() {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const params = useParams<{ projectId: string }>()
  const projectId = Number(params?.projectId)
  const searchParams = useSearchParams()
  const editParam = searchParams.get('report_id')
  /** 수정 모드면 고칠 보고서 id, 새 보고서면 null. 주소의 값이 숫자가 아니면 아래 첫 읽기에서 안내한다. */
  const editId = editParam !== null && Number.isInteger(Number(editParam)) && Number(editParam) > 0 ? Number(editParam) : null
  const { engineer, loading: guardLoading, authorized } = usePageGuard()
  const engineerId = engineer?.engineer_id ?? null
  /** 임시저장 키 — 새 보고서는 Project 별, 수정은 보고서 별. */
  const draftKey = engineerId == null ? null : editId !== null ? semiEditDraftKey(engineerId, editId) : semiDraftKey(engineerId, projectId)
  /** 나가기·저장 뒤 돌아갈 곳 — 수정은 그 보고서를 고른 Project 상세, 새 보고서는 목록(종전 그대로). */
  const backHref = editId !== null ? `/contact/semi/${projectId}?report=${editId}` : '/contact/semi'

  const [project, setProject] = useState<Project | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  /** 직전 보고서(입력 모양). 없으면 null — 「변경됨」 비교도 하지 않는다. */
  const [prev, setPrev] = useState<ReportInput | null>(null)
  const [values, setValues] = useState<ReportInput>(() => emptyInput())
  const [actions, setActions] = useState<ActionRow[]>([])
  const [noAction, setNoAction] = useState(false)
  /** 첫 읽기와 「이어서 작성」 결정이 끝났는지. 그 전에는 임시저장·이탈 확인을 하지 않는다. */
  const [ready, setReady] = useState(false)
  const [baseline, setBaseline] = useState('')
  const [errors, setErrors] = useState<Partial<Record<FieldKey | 'actions', string>>>({})
  const [actionErrors, setActionErrors] = useState<ActionErrors>({})
  const [saving, setSaving] = useState(false)
  const [draftLabel, setDraftLabel] = useState('')
  const [openGroups, setOpenGroups] = useState<Set<number>>(() => new Set())
  const [teamNames, setTeamNames] = useState<string[]>([])
  /** 접촉 차수(#n). 세지 못했으면 null(표시하지 않는다). */
  const [seqNo, setSeqNo] = useState<number | null>(null)
  /** 수정 모드에서 이 보고서에 저장돼 있던 Action 수(삭제 확인창 문구용). */
  const [savedActionCount, setSavedActionCount] = useState(0)
  /** 보고서를 지우는 중(수정 모드). 그동안 하단 버튼을 모두 막는다. */
  const [deleting, setDeleting] = useState(false)

  const nextRid = useRef(1)
  const newRow = (a?: Partial<ActionInput> & { action_id?: number }): ActionRow => ({ ...emptyAction(), ...a, owner_id: null, rid: nextRid.current++ })
  /** 저장 성공·확인 뒤 나가는 중 — 이탈 확인을 다시 띄우지 않는다. */
  const leaving = useRef(false)
  const scrollToError = useRef(false)

  // ── 첫 읽기: Project → 직전 보고서 → 미리 채우기 → 임시저장본 확인 ──
  useEffect(() => {
    if (!authorized || engineerId == null) return
    if (!Number.isInteger(projectId) || projectId <= 0) { setLoadError('Project 주소가 올바르지 않습니다.'); return }
    if (editParam !== null && editId === null) { setLoadError('보고서 주소가 올바르지 않습니다.'); return }
    let cancelled = false
    const load = async () => {
      const { data: p, error: pErr } = await supabase
        .from('semi_projects')
        .select('project_id, project_no, customer_name, site_dept, title')
        .eq('project_id', projectId)
        .maybeSingle()
      if (cancelled) return
      if (pErr || !p) {
        if (pErr) console.error('[contact/semi/write] Project 조회 실패', errorInfo(pErr))
        setLoadError(pErr ? `Project 를 불러오지 못했습니다: ${pErr.message}` : 'Project 를 찾을 수 없습니다.')
        return
      }
      const proj = p as Project
      const projInput = { customer_name: proj.customer_name, site_dept: proj.site_dept ?? '', title: proj.title }

      let base: ReportInput
      let baseActions: ActionRow[]
      let baseNoAction = false
      let prevInput: ReportInput | null = null
      let seq: number | null = null

      if (editId !== null) {
        // ── 수정: 그 보고서의 저장된 값·Action, 그 보고서의 직전 보고서, 앞선 건수 ──
        const { data: row, error: rErr } = await supabase
          .from('semi_contact_reports').select('*')
          .eq('report_id', editId).eq('project_id', projectId)
          .maybeSingle()
        if (cancelled) return
        if (rErr || !row) {
          if (rErr) console.error('[contact/semi/write] 보고서 조회 실패', errorInfo(rErr))
          setLoadError(rErr ? `보고서를 불러오지 못했습니다: ${rErr.message}` : '보고서를 찾을 수 없습니다.')
          return
        }
        const rep = row as Record<string, unknown>
        // 화면 가드는 메뉴 권한만 본다 — 수정은 작성자 본인이나 superadmin 만(서버 PATCH 와 같은 규칙).
        if (rep.author_id !== engineerId && !isSuperAdmin(engineer)) {
          setLoadError('이 보고서는 작성자 본인이나 관리자만 수정할 수 있습니다.')
          return
        }
        // 「앞선 보고서」 = (contact_date, report_id) 가 이 보고서보다 앞인 것. 직전 보고서와 차수 계산이 같은 기준을 쓴다.
        const date = String(rep.contact_date ?? '')
        const before = `contact_date.lt.${date},and(contact_date.eq.${date},report_id.lt.${editId})`
        const [acts, last, cnt] = await Promise.all([
          supabase.from('semi_actions').select('*').eq('report_id', editId).order('action_id', { ascending: true }),
          supabase.from('semi_contact_reports').select('*').eq('project_id', projectId).or(before)
            .order('contact_date', { ascending: false }).order('report_id', { ascending: false })
            .limit(1).maybeSingle(),
          supabase.from('semi_contact_reports').select('report_id', { count: 'exact', head: true })
            .eq('project_id', projectId).or(before),
        ])
        if (cancelled) return
        if (acts.error) {
          console.error('[contact/semi/write] Action 조회 실패', errorInfo(acts.error))
          setLoadError(`Action 을 불러오지 못했습니다: ${acts.error.message}`)
          return
        }
        // 직전 보고서·건수를 못 읽어도 수정은 막지 않는다(변경 표시·차수만 빠진다).
        if (last.error) console.error('[contact/semi/write] 직전 보고서 조회 실패', errorInfo(last.error))
        if (cnt.error) console.error('[contact/semi/write] 차수 조회 실패', errorInfo(cnt.error))
        base = fromStorage(rep, projInput)
        const loaded = ((acts.data ?? []) as Record<string, unknown>[])
          .map(x => newRow({ ...actionFromStorage(x), action_id: Number(x.action_id) }))
        baseActions = loaded.length > 0 ? loaded : [newRow()]
        setSavedActionCount(loaded.length)
        const det = rep.detail
        baseNoAction = !!det && typeof det === 'object' && (det as Record<string, unknown>).no_action === true
        prevInput = last.data ? fromStorage(last.data as Record<string, unknown>, projInput) : null
        seq = cnt.error ? null : (cnt.count ?? 0) + 1
      } else {
        // ── 새 보고서: 직전 보고 = 같은 Project 에서 (contact_date desc, report_id desc) 첫 건(prefill.ts 의 규칙) ──
        const [lastRes, cnt] = await Promise.all([
          supabase
            .from('semi_contact_reports')
            .select('*')
            .eq('project_id', projectId)
            .order('contact_date', { ascending: false })
            .order('report_id', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase.from('semi_contact_reports').select('report_id', { count: 'exact', head: true }).eq('project_id', projectId),
        ])
        if (cancelled) return
        // 직전 보고를 못 읽으면 빈 값으로 시작한다(작성은 막지 않는다).
        if (lastRes.error) console.error('[contact/semi/write] 직전 보고서 조회 실패', errorInfo(lastRes.error))
        if (cnt.error) console.error('[contact/semi/write] 차수 조회 실패', errorInfo(cnt.error))
        prevInput = lastRes.data ? fromStorage(lastRes.data as Record<string, unknown>, projInput) : null
        base = prefillFromPrevious(prevInput, projInput)
        base.contact_date = todayKST()
        baseActions = [newRow()]
        seq = cnt.error ? null : (cnt.count ?? 0) + 1
      }

      let v = base, a = baseActions, n = baseNoAction

      const draft = draftKey ? loadDraftAt(draftKey) : null
      if (draft && draftKey) {
        const when = kstStamp(draft.savedAt)
        const resume = await confirm({
          title: '이어서 작성할까요?',
          message: editId !== null
            ? `이 보고서를 고치던 임시저장본이 있습니다${when ? `(${when})` : ''}. 「버리기」를 누르면 지우고 저장된 내용으로 시작합니다.`
            : `임시저장된 보고서가 있습니다${when ? `(${when})` : ''}. 「버리기」를 누르면 지우고 새로 씁니다.`,
          confirmText: '이어서 작성',
          cancelText: '버리기',
        })
        if (cancelled) return
        if (resume) {
          const restored = { ...base }
          for (const k of FIELD_KEYS) {
            const dv = draft.values[k]
            if (typeof dv === 'string') restored[k] = dv
          }
          // Project 칸은 늘 지금의 Project 값이다(저장 라우트도 본문 값을 쓰지 않는다).
          for (const k of PROJECT_KEYS) restored[k] = base[k]
          v = restored
          a = draft.actions.length > 0 ? draft.actions.map(x => newRow(x)) : baseActions
          n = draft.noAction
        } else {
          clearDraftAt(draftKey)
        }
      }

      setProject(proj)
      setPrev(prevInput)
      setValues(v)
      setActions(a)
      setNoAction(n)
      setSeqNo(seq)
      // 비교 기준은 「처음 불러온 상태」다(새 보고서는 미리 채운 값, 수정은 저장된 값) —
      // 임시저장본을 이어서 쓰면 처음부터 변경이 있는 상태다.
      setBaseline(snapshotOf(base, baseActions, baseNoAction))
      setReady(true)
    }
    load()
    return () => { cancelled = true }
    // 첫 진입에 한 번만 읽는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorized, engineerId, projectId, supabase])

  // ── 담당 팀 제안 — 기존 팀 로더에서 반도체 팀 이름만. 못 읽으면 자유 입력만 ──
  useEffect(() => {
    if (!authorized) return
    let cancelled = false
    loadTeamPerms()
      .then(map => {
        if (cancelled) return
        setTeamNames([...map].filter(([, p]) => p.division === '반도체').map(([name]) => name).sort((a, b) => a.localeCompare(b, 'ko')))
      })
      .catch(e => console.error('[contact/semi/write] 팀 목록 조회 실패', errorInfo(e)))
    return () => { cancelled = true }
  }, [authorized])

  const snapshot = useMemo(() => snapshotOf(values, actions, noAction), [values, actions, noAction])
  const dirty = ready && snapshot !== baseline
  const dirtyRef = useRef(false)
  dirtyRef.current = dirty

  // ── 임시저장(1초 디바운스) ──
  useEffect(() => {
    if (!ready || engineerId == null || !dirty || leaving.current) return
    const t = setTimeout(() => {
      const ok = draftKey !== null && saveDraftAt(draftKey, {
        values, actions: actions.map(({ rid: _rid, ...a }) => a), noAction, savedAt: new Date().toISOString(),
      })
      setDraftLabel(ok ? `임시저장됨 ${nowHmKST()}` : '임시저장하지 못했습니다')
    }, DRAFT_DELAY)
    return () => clearTimeout(t)
  }, [snapshot, ready, dirty, engineerId, draftKey, values, actions, noAction])

  // ── 이탈 확인: 새로고침·탭 닫기 ──
  useEffect(() => {
    const onBefore = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current || leaving.current) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBefore)
    return () => window.removeEventListener('beforeunload', onBefore)
  }, [])

  // ── 이탈 확인: 브라우저 뒤로 가기 ──
  // 같은 주소로 기록을 하나 더 쌓아 두고(지금 state 를 그대로 복사해 Next 라우터가 자기 기록으로 읽게 한다),
  // 뒤로 가기가 그 한 칸을 소모하면 변경이 있을 때만 묻는다. 남으면 한 칸을 다시 쌓고, 나가면 두 칸 뒤로 간다.
  const guardPushed = useRef(false)
  useEffect(() => {
    if (!ready || guardPushed.current) return
    guardPushed.current = true
    window.history.pushState(window.history.state, '', window.location.href)
    const onPop = async () => {
      if (leaving.current) return
      if (!dirtyRef.current) { leaving.current = true; window.history.back(); return }
      window.history.pushState(window.history.state, '', window.location.href)
      const ok = await confirm({
        title: '작성을 그만둘까요?',
        message: '저장하지 않은 내용이 있습니다. 나가도 임시저장본은 남아 다음에 이어서 쓸 수 있습니다.',
        confirmText: '나가기',
        cancelText: '계속 작성',
      })
      if (ok) { leaving.current = true; window.history.go(-2) }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [ready, confirm])

  // ── 「변경됨」 — 직전 보고에서 가져온 칸 중 바뀐 것 ──
  const changed = useMemo(() => new Set(changedFields(prev, values)), [prev, values])
  const groupChangeCount = (fields: FieldDef[]) => fields.filter(f => changed.has(f.key as FieldKey)).length

  // 변경이 있는 그룹은 자동으로 편다(접는 것은 사람이 한다).
  useEffect(() => {
    const need = INHERITED_GROUPS.filter(g => groupChangeCount(g.fields) > 0).map(g => g.section.no)
    if (need.length === 0) return
    setOpenGroups(prevOpen => need.every(n => prevOpen.has(n)) ? prevOpen : new Set([...prevOpen, ...need]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changed])

  // 오류가 붙으면 그 칸이 든 그룹을 펴고 첫 오류 칸으로 스크롤한다.
  useEffect(() => {
    if (!scrollToError.current) return
    const keys = Object.keys(errors) as FieldKey[]
    const need = INHERITED_GROUPS.filter(g => g.fields.some(f => keys.includes(f.key as FieldKey))).map(g => g.section.no)
    if (need.some(n => !openGroups.has(n))) { setOpenGroups(o => new Set([...o, ...need])); return }
    scrollToError.current = false
    requestAnimationFrame(() => {
      const el = document.querySelector('[data-has-error="true"]')
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }, [errors, actionErrors, openGroups])

  // ── 입력 ──
  const setField = (k: FieldKey, v: string) => {
    setValues(p => ({ ...p, [k]: v }))
    if (errors[k]) setErrors(e => { const n = { ...e }; delete n[k]; return n })
  }
  const setAction = (rid: number, k: ActionField, v: string) => {
    setActions(rows => rows.map(r => (r.rid === rid ? { ...r, [k]: v } : r)))
    if (actionErrors[rid]?.[k]) {
      setActionErrors(e => { const row = { ...e[rid] }; delete row[k]; return { ...e, [rid]: row } })
    }
    if (errors.actions) setErrors(e => { const n = { ...e }; delete n.actions; return n })
  }
  const addAction = () => {
    setActions(rows => [...rows, newRow()])
    if (errors.actions) setErrors(e => { const n = { ...e }; delete n.actions; return n })
  }
  const removeAction = (rid: number) => setActions(rows => {
    const next = rows.filter(r => r.rid !== rid)
    return next.length > 0 ? next : [newRow()]
  })

  // ── 나가기(취소·← 목록) ──
  const leave = async () => {
    if (dirty) {
      // 마지막 입력이 디바운스에 걸려 있을 수 있으니 지금 한 번 남겨 둔다.
      if (draftKey !== null) {
        saveDraftAt(draftKey, {
          values, actions: actions.map(({ rid: _rid, ...a }) => a), noAction, savedAt: new Date().toISOString(),
        })
      }
      const ok = await confirm({
        title: '작성을 그만둘까요?',
        message: '저장하지 않은 내용이 있습니다. 나가도 임시저장본은 남아 다음에 이어서 쓸 수 있습니다.',
        confirmText: '나가기',
        cancelText: '계속 작성',
      })
      if (!ok) return
    }
    leaving.current = true
    router.push(backHref)
  }

  // ── 삭제(수정 모드에서만) — Project 상세에 있던 확인창·DELETE 로직을 옮겼다 ──
  // 서버(DELETE /api/semi-contact/report)가 권한(작성자 본인 또는 superadmin)을 다시 본다.
  // 지우면 이 보고서의 수정용 임시저장본도 지우고 Project 상세로 간다.
  const deleteReport = async () => {
    if (editId === null || deleting || saving) return
    const ok = await confirm({
      title: '보고서 삭제',
      message: `이 보고서와 Action ${savedActionCount}건이 삭제됩니다. 복구할 수 없습니다.`,
      confirmText: '삭제',
      variant: 'danger',
    })
    if (!ok) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/semi-contact/report?report_id=${editId}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        console.error('[contact/semi/write] 보고서 삭제 실패', { status: res.status, error: json })
        toast.error(json.error || `보고서를 삭제하지 못했습니다 (${res.status})`)
        return
      }
      if (draftKey !== null) clearDraftAt(draftKey)
      leaving.current = true
      toast.success('보고서를 삭제했습니다')
      router.push(`/contact/semi/${projectId}`)
    } catch (e) {
      console.error('[contact/semi/write] 보고서 삭제 실패', errorInfo(e))
      toast.error('보고서를 삭제하지 못했습니다. 잠시 뒤 다시 시도해주세요.')
    } finally {
      setDeleting(false)
    }
  }

  // ── 저장 ──
  /** 검증 결과의 줄별 오류(빈 줄을 뺀 순서)를 화면의 줄(rid)로 옮긴다. */
  const mapActionErrors = (rows: ActionRow[], perIndex: { index: number; errors: Partial<Record<ActionField, string>> }[]): ActionErrors => {
    const out: ActionErrors = {}
    for (const { index, errors: e } of perIndex) {
      const row = rows[index]
      if (row && Object.keys(e).length > 0) out[row.rid] = e
    }
    return out
  }

  const submit = async () => {
    if (saving || !ready) return
    const sendRows = noAction ? [] : actions

    // 저장 전에 같은 규칙으로 한 번 본다(서버도 다시 본다).
    const checked = validateReport(values, sendRows, { noAction })
    const kept = sendRows.filter(r => meaningfulActions([r]).length > 0)
    const localRowErrors: ActionErrors = {}
    checked.actionErrors.forEach((e, j) => { if (Object.keys(e).length > 0 && kept[j]) localRowErrors[kept[j].rid] = e })
    if (!checked.ok) {
      setErrors(checked.errors)
      setActionErrors(localRowErrors)
      scrollToError.current = true
      toast.error('입력값을 확인해주세요')
      return
    }

    setSaving(true)
    try {
      const isEdit = editId !== null
      const res = await fetch('/api/semi-contact/report', {
        // 수정은 PATCH — 기존 줄은 action_id 를 함께 보내 서버가 수정·추가·삭제를 가른다.
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(isEdit ? { report_id: editId } : { project_id: projectId }),
          fields: values,
          actions: sendRows.map(({ rid: _rid, ...a }) => ({ ...a, owner_id: null })),
          no_action: noAction,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.status === 400 && (json.fieldErrors || json.actionErrors)) {
        setErrors((json.fieldErrors ?? {}) as Partial<Record<FieldKey | 'actions', string>>)
        setActionErrors(mapActionErrors(sendRows, Array.isArray(json.actionErrors) ? json.actionErrors : []))
        scrollToError.current = true
        toast.error(json.error || '입력값을 확인해주세요')
        return
      }
      if (!res.ok) {
        console.error('[contact/semi/write] 저장 실패', { status: res.status, error: json })
        toast.error(json.error || `보고서를 저장하지 못했습니다 (${res.status})`)
        return
      }
      if (draftKey !== null) clearDraftAt(draftKey)
      leaving.current = true
      toast.success(isEdit ? '보고서를 수정했습니다' : '보고서를 저장했습니다')
      router.push(isEdit ? backHref : '/contact/semi')
    } catch (e) {
      console.error('[contact/semi/write] 저장 실패', errorInfo(e))
      toast.error('보고서를 저장하지 못했습니다. 잠시 뒤 다시 시도해주세요.')
    } finally {
      setSaving(false)
    }
  }

  // ── 그리기 ──
  if (!authorized) return <AccessGate loading={guardLoading} />

  if (loadError) {
    return (
      <main style={{ padding: '24px 28px', background: PAGE_BG, minHeight: '100vh' }}>
        <div style={cardStyle}>
          <div style={{ textAlign: 'center', padding: 40, color: '#ef4444', fontSize: 13, fontWeight: 700, lineHeight: 1.7 }}>
            {loadError}<br />
            <Link href="/contact/semi" style={{ color: BLUE, fontSize: 12, fontWeight: 700 }}>← 목록</Link>
          </div>
        </div>
      </main>
    )
  }

  if (!ready || !project) {
    return (
      <main style={{ padding: '24px 28px', background: PAGE_BG, minHeight: '100vh' }}>
        <div style={{ ...cardStyle, textAlign: 'center', padding: 40, color: MUTED, fontSize: 13 }}>불러오는 중...</div>
      </main>
    )
  }

  const field = (k: FieldKey, opts?: { rows?: number; autoFocus?: boolean }) => (
    <FieldControl
      key={k}
      def={FIELD_BY_KEY[k]}
      value={values[k]}
      onChange={v => setField(k, v)}
      error={errors[k]}
      changed={changed.has(k)}
      prevValue={prev ? prev[k] : ''}
      rows={opts?.rows}
      autoFocus={opts?.autoFocus}
      disabled={saving}
    />
  )

  const disabledActions = noAction || saving

  return (
    <main style={{ padding: '24px 28px 0', background: PAGE_BG, minHeight: '100vh', boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>

        {/* ── 헤더 — Project(읽기 전용) ── */}
        <div style={boxStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={leave} style={{ ...btnGhost(), padding: '5px 10px', fontSize: 12 }}>
              {editId !== null ? '← 상세' : '← 목록'}
            </button>
            <span className="num" style={{ ...countBadge, color: BLUE }}>{project.project_no}</span>
            <span className="num" style={{ fontSize: 13, fontWeight: 700, color: TEXT, whiteSpace: 'nowrap' }}>
              {editId !== null ? `${seqLabel(seqNo)} 수정`.trim() : `새 보고서 ${seqLabel(seqNo)}`.trim()}
            </span>
            <span style={{ ...cardTitle, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {project.title}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10, fontSize: 12, color: SUB }}>
            <span><span style={{ color: MUTED }}>{FIELD_BY_KEY.customer_name.label}</span> {project.customer_name}</span>
            <span><span style={{ color: MUTED }}>{FIELD_BY_KEY.site_dept.label}</span> {project.site_dept?.trim() || '-'}</span>
            <span><span style={{ color: MUTED }}>{FIELD_BY_KEY.title.label}</span> {project.title}</span>
          </div>
        </div>

        {/* ── 이번 접촉 ── */}
        <Box title="이번 접촉">
          <div style={gridStyle}>{CONTACT_KEYS.map(k => field(k))}</div>
        </Box>

        {/* ── 새롭게 확인된 내용 — 이 화면의 핵심. 첫 화면에서 바로 쓰도록 FACT 에 커서를 둔다 ── */}
        <Box title={SECTIONS.find(s => s.no === 2)?.label ?? ''}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {field('fact', { rows: 10, autoFocus: true })}
            {field('meeting_content', { rows: 8 })}
          </div>
        </Box>

        {/* ── Action Items ── */}
        <Box
          title="Action Items"
          right={(
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: SUB, cursor: 'pointer' }}>
              <input type="checkbox" checked={noAction} disabled={saving}
                onChange={e => {
                  setNoAction(e.target.checked)
                  if (errors.actions) setErrors(x => { const n = { ...x }; delete n.actions; return n })
                }} />
              Action 없음
            </label>
          )}
        >
          <datalist id="semi-teams">
            {teamNames.map(n => <option key={n} value={n} />)}
          </datalist>
          <div style={{ overflowX: 'auto', opacity: noAction ? 0.5 : 1 }} aria-disabled={noAction}>
            <table style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ fontSize: 11, fontWeight: 700, color: MUTED, textAlign: 'left' }}>
                  <th style={{ padding: '0 6px 8px 0', width: '30%' }}>{ACTION_LABELS.what}</th>
                  <th style={{ padding: '0 6px 8px', width: '16%' }}>{ACTION_LABELS.owner}</th>
                  <th style={{ padding: '0 6px 8px', width: 140 }}>{ACTION_LABELS.due_date}</th>
                  <th style={{ padding: '0 6px 8px', width: 110 }}>{ACTION_LABELS.status}</th>
                  <th style={{ padding: '0 6px 8px', width: 100 }}>{ACTION_LABELS.priority}</th>
                  <th style={{ padding: '0 6px 8px' }}>{ACTION_LABELS.note}</th>
                  <th style={{ width: 32 }} />
                </tr>
              </thead>
              <tbody>
                {actions.map(r => {
                  const e = actionErrors[r.rid] ?? {}
                  const cell = (k: ActionField, el: ReactNode) => (
                    <td style={{ padding: '4px 6px', verticalAlign: 'top' }} data-has-error={e[k] ? 'true' : undefined}>
                      {el}
                      <FieldError message={e[k]} />
                    </td>
                  )
                  const inputProps = (k: ActionField) => ({
                    value: r[k],
                    disabled: disabledActions,
                    onChange: (ev: { target: { value: string } }) => setAction(r.rid, k, ev.target.value),
                    style: { ...fieldStyle, ...(e[k] ? { border: errBorder } : null) },
                  })
                  return (
                    <tr key={r.rid} style={{ borderTop: `1px solid ${BORDER}` }}>
                      {cell('what', <input {...inputProps('what')} />)}
                      {cell('owner', <input {...inputProps('owner')} list="semi-teams" placeholder="팀 이름" />)}
                      {cell('due_date', <input type="date" {...inputProps('due_date')} />)}
                      {cell('status', (
                        <select {...inputProps('status')}>
                          {ACTION_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      ))}
                      {cell('priority', (
                        <select {...inputProps('priority')}>
                          {ACTION_PRIORITIES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      ))}
                      {cell('note', <input {...inputProps('note')} />)}
                      <td style={{ padding: '4px 0', verticalAlign: 'top' }}>
                        <button type="button" aria-label="줄 삭제" disabled={disabledActions} onClick={() => removeAction(r.rid)}
                          style={{
                            width: 32, height: 36, border: 'none', background: 'transparent', color: MUTED,
                            cursor: disabledActions ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 8 }} data-has-error={errors.actions ? 'true' : undefined}>
            <button type="button" onClick={addAction} disabled={disabledActions} style={btnGhost(disabledActions)}>+ 줄 추가</button>
            <FieldError message={errors.actions} />
          </div>
        </Box>

        {/* ── 다음 접촉 예정일 ── */}
        <Box title={FIELD_BY_KEY.next_contact_date.label}>
          <div style={{ maxWidth: 260 }}>{NEXT_KEYS.map(k => field(k))}</div>
        </Box>

        {/* ── 이어받은 항목 — 나머지 칸, 섹션별로 접힘 ── */}
        <Box title="이어받은 항목" right={prev ? undefined : <span style={{ fontSize: 12, color: MUTED }}>직전 보고서 없음</span>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {INHERITED_GROUPS.map(g => {
              const open = openGroups.has(g.section.no)
              const n = groupChangeCount(g.fields)
              return (
                <div key={g.section.no} style={{ border: `1px solid ${BORDER}`, borderRadius: 8 }}>
                  <button type="button" aria-expanded={open}
                    onClick={() => setOpenGroups(o => { const s = new Set(o); if (s.has(g.section.no)) s.delete(g.section.no); else s.add(g.section.no); return s })}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 12px',
                      border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                    }}>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke={MUTED} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                      style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease', flexShrink: 0 }}>
                      <path d="m9 6 6 6-6 6" />
                    </svg>
                    <span style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>{g.section.label}</span>
                    <span style={{ fontSize: 12, color: MUTED }}>{g.fields.length}개</span>
                    {n > 0 && <span style={{ ...countBadge, color: BLUE }}>변경 {n}건</span>}
                  </button>
                  {open && (
                    <div style={{ ...gridStyle, padding: '4px 12px 12px' }}>
                      {g.fields.map(f => field(f.key as FieldKey, f.kind === 'longtext' ? { rows: 4 } : undefined))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </Box>

        {/* ── 하단 고정 바 ── */}
        <div style={{
          position: 'sticky', bottom: 0, zIndex: 5, background: CARD_BG, borderTop: `1px solid ${BORDER}`,
          margin: '0 -28px', padding: '10px 28px', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          {/* 삭제 — 수정 모드에서만(새 보고서에는 지울 것이 없다) */}
          {editId !== null && (
            <button type="button" onClick={deleteReport} disabled={saving || deleting} style={btnDanger(saving || deleting)}>
              {deleting ? '삭제 중...' : '삭제'}
            </button>
          )}
          <span style={{ fontSize: 12, color: MUTED, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {draftLabel || (dirty ? '변경 사항이 있습니다' : '')}
          </span>
          <button type="button" onClick={leave} disabled={saving || deleting} style={{ ...btnGhost(saving || deleting), marginLeft: 'auto' }}>취소</button>
          <button type="button" onClick={submit} disabled={saving || deleting} style={btnPrimary(saving || deleting)}>
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </main>
  )
}

export default function SemiReportWritePage() {
  return (
    <Suspense fallback={<main style={{ padding: '24px 28px', background: PAGE_BG, minHeight: '100vh' }} />}>
      <SemiReportWriteInner />
    </Suspense>
  )
}

/** 제목이 있는 상자(카드). right 는 제목 줄 오른쪽 끝에 붙는다. */
function Box({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section style={boxStyle}>
      <div style={cardHeader}>
        <span style={cardTitle}>{title}</span>
        {right && <span style={{ marginLeft: 'auto' }}>{right}</span>}
      </div>
      {children}
    </section>
  )
}

/**
 * 등록표 칸 하나. kind 에 따라 입력·여러 줄·날짜·선택을 그린다.
 * changed 면 「변경됨」과 직전 보고의 값을 작게 보여 준다(직전 값이 비었으면 「(비어 있음)」).
 */
function FieldControl({ def, value, onChange, error, changed, prevValue, rows, autoFocus, disabled }: {
  def: FieldDef
  value: string
  onChange: (v: string) => void
  error?: string
  changed: boolean
  prevValue: string
  rows?: number
  autoFocus?: boolean
  disabled?: boolean
}) {
  const id = `sf-${def.key}`
  const style: CSSProperties = { ...fieldStyle, ...(error ? { border: errBorder } : null) }
  let control: ReactNode
  if (def.kind === 'select') {
    control = (
      <select id={id} value={value} disabled={disabled} onChange={e => onChange(e.target.value)} style={style}>
        <option value="">선택</option>
        {(def.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  } else if (def.kind === 'date') {
    control = <input id={id} type="date" value={value} disabled={disabled} onChange={e => onChange(e.target.value)} style={style} />
  } else if (def.kind === 'longtext') {
    control = (
      <textarea id={id} value={value} disabled={disabled} autoFocus={autoFocus} rows={rows ?? 4}
        onChange={e => onChange(e.target.value)} style={{ ...style, resize: 'vertical', lineHeight: 1.6 }} />
    )
  } else {
    control = <input id={id} value={value} disabled={disabled} autoFocus={autoFocus} onChange={e => onChange(e.target.value)} style={style} />
  }
  return (
    <div data-has-error={error ? 'true' : undefined}>
      <label htmlFor={id} style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>{def.label}{def.required && <span style={{ color: '#dc2626' }}> *</span>}</span>
        {changed && <span style={{ fontSize: 11, fontWeight: 700, color: BLUE, background: NEUTRAL_BG, borderRadius: 99, padding: '1px 7px' }}>변경됨</span>}
      </label>
      {control}
      {changed && (
        <div style={{ marginTop: 4, fontSize: 11, color: MUTED, lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          title={prevValue}>
          이전: {prevValue.trim() ? prevValue : '(비어 있음)'}
        </div>
      )}
      <FieldError message={error} />
    </div>
  )
}
