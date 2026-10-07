'use client'

// 전자결재 — 상신/보관함 · 결재수신함 · 전체.
//
// 아마란스 양식에 맞춘 화면이다. 직원들이 이미 아마란스로 결재하고 있어 이름·배치를 맞추면
// 따로 배울 것이 없다. 판정·라우트는 그대로다 — 함 이름과 배치, 표시 형식만 바꿨다.
//   함 구성·분류·표시 규칙: components/approval/boxes.ts
//   문서 상세(문서 정보 + 결재표): components/approval/DocDetail.tsx
//
// 배치
//   · 왼쪽 위: 기간(쇼룸 가동률과 같은 PeriodPickerModal) + 검색(문서번호·제목·상신자, 300ms)
//   · 왼쪽: 함 목록(180px). 그룹 제목 아래 하위 함을 편다. 본문이 좁아지면 가로 탭으로 떨어진다.
//   · 본문 오른쪽 위: 모든문서 · 진행문서 · 종결문서 라디오
//   · 그 아래: 표 머리(기안일/결재일 · 제목/문서번호 · 기안자/기안부서 · 결재상태)와 목록.
//     행을 누르면 그 자리에서 상세가 펼쳐진다(지금과 같다).
//
// 보는 자리는 (source, scope) 한 쌍뿐이다 — 왼쪽 함도 오른쪽 라디오도 같은 값을 움직이므로
// 둘이 어긋나지 않는다. 주소가 원본이고(?box=&view=), 옛 주소(?tab=&sub=)도 그대로 받는다.
//
// 목록 자체는 /api/approval 이 service role 로 걸러 준다. 화면에서 직접 읽는 것은 이력과
// 직원 이름뿐이고, 둘 다 RLS 가 참여자에게만 열어 준다.

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { usePageGuard } from '@/hooks/usePageGuard'
import AccessGate from '@/components/common/AccessGate'
import PeriodNav from '@/components/showroom/PeriodNav'
import { periodRange, type Period } from '@/lib/showroom'
import { todayKST } from '@/lib/date'
import { canViewMenu, isSuperAdmin } from '@/lib/permissions'
import {
  BLUE, BORDER, DANGER, FAINT, MUTED, NEUTRAL_BG, PAGE_BG, SUB, TEXT,
  PULSE_KEYFRAMES, cardStyle, cardHeader, cardTitle, countBadge,
  btnGhost, inputStyle, rowStyle, skeletonBlock,
} from '@/components/common/ui'
import DocDetail, { type ApprovalDoc } from '@/components/approval/DocDetail'
import { prefetchPanel } from '@/components/approval/panels'
import DelegationModal from '@/components/approval/DelegationModal'
import type { ProgressPerson } from '@/components/approval/ApprovalTable'
import { DOC_TYPES } from '@/lib/approval/docTypes'
import {
  BOX_GROUPS, DOC_TYPE_ALL, SCOPES,
  activeItem, approvalDate, attachmentCount, dateColumnLabel, detailBox, docTypeFilter,
  docTypeOptions, filterDocs, isServerFiltered, itemCount, listUrl, parseView,
  readCollapsedGroups, showsScopeRadio, statusText, viewQuery, writeCollapsedGroups,
  type DoneCounts, type Scope, type Source,
} from '@/components/approval/boxes'
import { PAGE_SIZE, clampPage, pageRange, pageWindow, totalPages } from '@/lib/paging'
import { openApprovalDoc } from '@/lib/approval/docWindow'
import { listenDocSignal } from '@/lib/approval/docSignal'
import { isMobileViewport } from '@/lib/viewport'

const APPROVAL_PATH = '/approval'

/** 처음에 보여주는 기간 — 최근 3개월. */
const DEFAULT_MONTHS = 3

/**
 * 화면 전환 모션 기준 — 짧게, 끝에서 부드럽게 멈추는 가속도.
 * 결재 화면 안의 전환은 전부 이 값을 쓴다.
 */
const MOTION_MS = 140
const MOTION_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)'

/** 검색 디바운스. 글자를 칠 때마다 목록을 다시 거르지 않는다. */
const SEARCH_DEBOUNCE_MS = 300

/** 함 목록을 처음에 함께 읽어 건수를 채운다. 「전체」는 고를 때만 읽는다(문서가 많다). */
const BASE_SOURCES: Source[] = ['inbox', 'outbox', 'done', 'cc']

/** 문서 상태 dot — 글자는 중립으로 두고 색은 dot 에만 준다(디자인 규칙). */
const STATUS_DOT: Record<string, string> = {
  '진행중': '#234ea2',
  '완료': '#16a34a',
  '반려': '#ef4444',
  '회수': '#9ca3af',
  '임시저장': '#d1d5db',
  // 폐기 — 더 볼 일이 없는 문서라 가장 흐린 회색(임시저장과 같은 층위).
  '폐기': '#d1d5db',
}

/** 표 열 폭 — 머리와 행이 같은 값을 써야 줄이 맞는다. */
const COL = { date: 88, requester: 116, status: 150, gap: 10 }
/** 카드 좌우 여백(16) + 행 좌우 여백(12). 머리는 카드 끝까지 늘이고 글자만 행과 맞춘다. */
const HEAD_PAD = 28

const pad = (n: number) => String(n).padStart(2, '0')

/** n 개월 전 같은 날. 그 달에 같은 날짜가 없으면 말일로 맞춘다. */
function monthsAgo(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const idx = y * 12 + (m - 1) - n
  const year = Math.floor(idx / 12)
  const month = (idx % 12) + 1
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${year}-${pad(month)}-${pad(Math.min(d, last))}`
}

const dateText = (iso: string | null): string => {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`
}

/**
 * 본문이 좁아지면 함 목록을 가로 탭으로 떨어뜨린다 — 창이 아니라 본문 폭을 본다(사이드바 접힘과 무관).
 * 그때는 그룹 제목이 항목 앞에 나란히 선다.
 *
 * 움직이는 것은 색(opacity 계열)뿐이라 배치를 다시 계산하지 않는다. 시간·가속도는 화면 전환과
 * 같은 기준(MOTION_MS · MOTION_EASE)으로 맞춘다.
 * 모션을 줄이길 원하는 사용자에게는 이 화면 안의 전환·애니메이션을 전부 끈다 — 불러오는 중
 * 깜빡임(PULSE_KEYFRAMES)까지 함께 멈춘다.
 */
const SHELL_CSS = `
  .ap-shell { container-type: inline-size; }
  .ap-body { display: flex; gap: 12px; align-items: flex-start; }
  .ap-rail { width: 180px; flex-shrink: 0; display: flex; flex-direction: column; }
  .ap-railgroup { display: flex; flex-direction: column; gap: 2px; }
  .ap-main { flex: 1; min-width: 0; }
  .ap-boxbtn { transition: background ${MOTION_MS}ms ${MOTION_EASE}; }
  .ap-boxbtn:hover { background: ${NEUTRAL_BG}; }
  .ap-grouptitle { transition: color ${MOTION_MS}ms ${MOTION_EASE}; }
  .ap-grouptitle:hover { color: ${TEXT}; }
  /* 펼칠 때만 움직인다 — 접을 때는 항목이 사라지므로 나갈 자리가 없다.
     움직이는 것은 opacity 와 transform 뿐이라 배치를 다시 계산하지 않는다. */
  .ap-railgroup > .ap-boxbtn { animation: ap-unfold ${MOTION_MS}ms ${MOTION_EASE}; }
  @keyframes ap-unfold { from { opacity: 0; transform: translateY(-2px); } to { opacity: 1; transform: none; } }
  .ap-sortbtn { transition: color ${MOTION_MS}ms ${MOTION_EASE}; }
  .ap-sortbtn:hover { color: ${TEXT}; }
  /* 함 목록 아래 붙는 자리 — 함이 아니라 설정이라 구분선을 두고 떼어 놓는다.
     좁아져 가로 탭이 되면 줄 맨 오른쪽으로 밀어 붙인다(함 목록 뒤에 그대로 이어지지 않게). */
  .ap-railfoot { margin-top: 14px; padding: 10px 10px 0; border-top: 1px solid ${BORDER}; }
  @container (max-width: 900px) {
    .ap-body { flex-direction: column; }
    .ap-rail { width: 100%; flex-direction: row; overflow-x: auto; gap: 4px; align-items: center; }
    .ap-railgroup { flex-direction: row; align-items: center; }
    .ap-railtitle { padding: 0 2px 0 8px !important; }
    .ap-boxbtn { width: auto !important; flex: 0 0 auto; }
    .ap-railfoot { margin: 0 0 0 auto; padding: 0 0 0 8px; border-top: none; flex: 0 0 auto; }
  }
  @media (prefers-reduced-motion: reduce) {
    .ap-shell, .ap-shell * {
      transition: none !important;
      animation: none !important;
    }
  }
`

/** 첨부 클립 — lucide 모양의 인라인 SVG(패키지는 쓰지 않는다). */
function Clip() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  )
}

/** 위임 — 사람에게서 사람으로 넘기는 모양. lucide 스타일 인라인 SVG(패키지는 쓰지 않는다). */
function Delegate() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <polyline points="16 11 18 13 22 9" />
    </svg>
  )
}

/** 묶음 접힘 표시 — 펼치면 아래, 접으면 오른쪽을 가리킨다(돌려서 쓴다 — transform 이라 가볍다). */
function GroupCaret({ open }: { open: boolean }) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, transform: open ? 'none' : 'rotate(-90deg)', transition: `transform ${MOTION_MS}ms ${MOTION_EASE}` }}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

/** 새 창 — 바깥을 가리키는 화살표. lucide 스타일 인라인 SVG(패키지는 쓰지 않는다). */
function ExternalLink() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  )
}

/** 정렬 방향 — 최신순이면 아래꺾쇠, 오래된순이면 위꺾쇠. */
function Caret({ down }: { down: boolean }) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      {down ? <polyline points="6 9 12 15 18 9" /> : <polyline points="18 15 12 9 6 15" />}
    </svg>
  )
}

/** 라디오 — 네이티브 모양이 브라우저마다 달라 직접 그린다. 색은 가운데 점에만 준다. */
function ScopeRadio({ value, onChange }: { value: Scope; onChange: (next: Scope) => void }) {
  return (
    <span role="radiogroup" aria-label="문서 범위" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      {SCOPES.map(s => {
        const on = s.value === value
        return (
          <button
            key={s.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(s.value)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: 0,
              border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 12, fontWeight: on ? 700 : 600, color: on ? TEXT : MUTED,
            }}
          >
            <span style={{
              width: 13, height: 13, borderRadius: '50%', flexShrink: 0,
              border: `1px solid ${on ? BLUE : FAINT}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {on && <span style={{ width: 6, height: 6, borderRadius: '50%', background: BLUE }} />}
            </span>
            {s.label}
          </button>
        )
      })}
    </span>
  )
}

/** 목록 응답 — 문서와, 기결함이 함께 주는 총 건수·함 건수. */
type ListResult = { documents: ApprovalDoc[]; total: number | null; counts: DoneCounts | null }

const EMPTY_RESULT: ListResult = { documents: [], total: null, counts: null }

/** 함 하나를 읽는다. 상태를 쓰지 않으므로 컴포넌트 밖에 둔다(효과 의존성이 늘지 않는다). */
async function fetchList(url: string): Promise<ListResult> {
  try {
    const res = await fetch(url)
    const json = await res.json().catch(() => null)
    if (!res.ok) { console.error('[approval] list failed', { url, json }); return EMPTY_RESULT }
    return {
      documents: (json?.documents ?? []) as ApprovalDoc[],
      total: typeof json?.total === 'number' ? json.total : null,
      counts: (json?.counts ?? null) as DoneCounts | null,
    }
  } catch (e) {
    console.error('[approval] list failed', { url, error: e })
    return EMPTY_RESULT
  }
}

function ApprovalPageInner() {
  const router = useRouter()
  const params = useSearchParams()
  const { engineer: me, loading: guardLoading, authorized } = usePageGuard()
  // 결재 화면은 전원 공개다(4단계). 남의 문서까지 보는 「전체」 함만 approvals 권한으로 잠근다 —
  // 라우트의 box=all 잠금과 같은 판정이다.
  const canSeeAll = canViewMenu(me, 'approvals')
  const myId = me?.engineer_id ?? null
  // 위임 설정 — 누구나 자기 위임을 걸고, superadmin 은 남의 위임도 다룬다(라우트가 다시 판정한다).
  const isSuper = isSuperAdmin(me)
  const [delegationOpen, setDelegationOpen] = useState(false)

  const { source, scope } = parseView({
    box: params.get('box'), tab: params.get('tab'),
    view: params.get('view'), sub: params.get('sub'),
  })
  const here = activeItem(source, scope)

  const go = (nextSource: Source, nextScope: Scope) => {
    // 함·구분을 옮기면 페이지는 늘 처음으로 — 3페이지를 보다 좁히면 빈 화면이 된다.
    setPage(1)
    const q = viewQuery(nextSource, nextScope)
    router.replace(q ? `${APPROVAL_PATH}?${q}` : APPROVAL_PATH, { scroll: false })
  }

  // ── 기간·검색·정렬 ──
  const [period, setPeriod] = useState<Period>(() => {
    const today = todayKST()
    return { mode: 'custom', from: monthsAgo(today, DEFAULT_MONTHS), to: today }
  })
  const range = periodRange(period)
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setQuery(searchInput), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [searchInput])
  // 기본 최신순. 기안일(결재일) 머리를 누르면 뒤집는다.
  const [desc, setDesc] = useState(true)

  // ── 왼쪽 묶음 접힘 ──
  // 기본은 모두 펼침. 계정이 확인되면 그 계정의 저장값으로 맞춘다(사이드바 접힘과 같은 방식).
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([])
  useEffect(() => {
    if (myId == null) return
    // 저장값은 브라우저에만 있다. 렌더 중에 읽으면 서버가 그린 것과 달라지므로(수화 불일치)
    // 첫 그림은 기본값(모두 펼침)으로 두고, 계정이 확인된 뒤에 입힌다 — 사이드바 접힘과 같은 순서다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCollapsedGroups(readCollapsedGroups(myId))
  }, [myId])

  const toggleGroup = (groupKey: string) => {
    const next = collapsedGroups.includes(groupKey)
      ? collapsedGroups.filter(k => k !== groupKey)
      : [...collapsedGroups, groupKey]
    setCollapsedGroups(next)
    if (myId != null) writeCollapsedGroups(myId, next)
  }

  // ── 목록 ── 읽어 온 곳마다 따로 담아 둔다(왼쪽 건수를 함께 보여주기 위해서다).
  const [docsBySource, setDocsBySource] = useState<Partial<Record<Source, ApprovalDoc[]>>>({})
  const [reloadKey, setReloadKey] = useState(0)
  const [openId, setOpenId] = useState<number | null>(null)
  // 문서 종류 — 등록표에서 읽은 값 하나다(화면에 유형 이름을 적지 않는다).
  const [docTypeSel, setDocTypeSel] = useState<string>(DOC_TYPE_ALL)
  const docType = docTypeFilter(docTypeSel)
  // 서버가 끊어 주는 함(기결문서(종결))의 페이지와 총 건수.
  const [page, setPage] = useState(1)
  // 왼쪽 함 목록의 기결 세 숫자 — 서버가 센 값이다(상한과 무관하다).
  const [doneCounts, setDoneCounts] = useState<DoneCounts | null>(null)

  // 기본 네 곳 — 화면에 들어오면 한 번에 읽고, 처리 뒤에는 다시 읽는다.
  useEffect(() => {
    if (!authorized) return
    let cancelled = false
    const run = async () => {
      // 기결함은 서버가 끊어 주는 쪽(종결)이 아니라 **옛 규칙 쪽**을 읽어 둔다 — 왼쪽 건수와
      // 기결문서·기결문서(진행)이 쓰는 한 벌이다. 종결은 아래 효과가 따로 읽는다.
      const pairs = await Promise.all(
        BASE_SOURCES.map(async s => [s, await fetchList(listUrl(s, 'all'))] as const),
      )
      if (cancelled) return
      setDocsBySource(prev => ({
        ...prev,
        ...Object.fromEntries(pairs.map(([s, r]) => [s, r.documents])),
      }))
      const counts = pairs.find(([s]) => s === 'done')?.[1].counts
      if (counts) setDoneCounts(counts)
      setOpenId(null)
    }
    run()
    return () => { cancelled = true }
  }, [authorized, reloadKey])

  // 전체 — 고른 동안에만 읽는다.
  useEffect(() => {
    if (!authorized || source !== 'all' || !canSeeAll) return
    let cancelled = false
    const run = async () => {
      const r = await fetchList(listUrl('all', 'all'))
      if (cancelled) return
      setDocsBySource(prev => ({ ...prev, all: r.documents }))
    }
    run()
    return () => { cancelled = true }
  }, [authorized, source, canSeeAll, reloadKey])

  // 문서 창에서 처리한 결과를 받는다 — 같은 출처의 다른 탭·창이 보낸 한 줄이다
  // (lib/approval/docSignal.ts). 목록이 열려 있지 않으면 듣는 쪽이 없을 뿐 아무 일도 없다.
  useEffect(() => {
    if (!authorized) return
    return listenDocSignal(sig => {
      setReloadKey(k => k + 1)
      // 처리된 문서를 펼쳐 두고 있었으면 접는다 — 그 안의 버튼은 이미 뜻이 달라졌다.
      setOpenId(prev => (prev === sig.documentId ? null : prev))
    })
  }, [authorized])

  // ── 직원 이름·직급·부서 ── 결재표·문서 정보에서 번호를 사람으로 바꾼다. 한 번만 읽는다.
  const [people, setPeople] = useState<Record<number, ProgressPerson>>({})
  useEffect(() => {
    if (!authorized) return
    let cancelled = false
    const run = async () => {
      const supabase = createClient()
      const { data, error } = await supabase.from('engineers').select('engineer_id, name, position, teams')
      if (cancelled) return
      if (error) {
        console.error('[approval] engineers load failed', error)
        return
      }
      const map: Record<number, ProgressPerson> = {}
      for (const e of (data ?? []) as { engineer_id: number; name: string | null; position: string | null; teams: string | null }[]) {
        map[e.engineer_id] = { name: e.name, position: e.position, teams: e.teams }
      }
      setPeople(map)
    }
    run()
    return () => { cancelled = true }
  }, [authorized])

  // 기결문서(종결) — 서버가 기간·종류를 limit 보다 먼저 걸고 페이지로 끊어 준다.
  // 그 함을 보고 있을 때만 읽고, 기간·종류·페이지가 바뀌면 다시 읽는다.
  const serverSide = isServerFiltered(source, scope)
  // 요청 조건을 열쇠 하나로 묶는다 — 받아 둔 열쇠가 지금 열쇠와 다르면 「불러오는 중」이다.
  // 효과 안에서 미리 비우지 않아도 되므로 쓸데없는 그림이 한 번 줄어든다(의뢰서 목록의 loadedKey 와 같은 방식).
  const closedKey = serverSide
    ? [range.from, range.to, docType ?? '', page, reloadKey].join('|')
    : ''
  const [closed, setClosed] = useState<{ key: string; rows: ApprovalDoc[]; total: number | null } | null>(null)
  useEffect(() => {
    if (!authorized || !serverSide) return
    let cancelled = false
    const run = async () => {
      const r = await fetchList(listUrl('done', 'closed', {
        from: range.from, to: range.to, docType, page, size: PAGE_SIZE,
      }))
      if (cancelled) return
      setClosed({ key: closedKey, rows: r.documents, total: r.total })
      if (r.counts) setDoneCounts(r.counts)
    }
    run()
    return () => { cancelled = true }
  }, [authorized, serverSide, closedKey, range.from, range.to, docType, page])

  const closedReady = serverSide && closed !== null && closed.key === closedKey
  const serverTotal = closedReady ? closed.total : null
  // 건수가 확정된 뒤 범위를 넘은 페이지는 **보여 줄 때** 끌어내린다(상태를 고치지 않는다).
  // 서버도 같은 식으로 자르므로(pageSlice → clampPage) 돌아온 목록과 번호가 어긋나지 않는다.
  const pageNo = serverTotal === null ? page : clampPage(page, serverTotal, PAGE_SIZE)

  const raw = serverSide ? (closedReady ? closed.rows : undefined) : docsBySource[source]
  const listLoading = authorized && raw === undefined
  const docs = filterDocs(raw ?? [], {
    source, scope, query, from: range.from, to: range.to, myId, people, desc, docType,
  })
  // 「전체」는 권한자에게만 보인다 — 라우트의 box=all 잠금과 같은 판정이다.
  const groups = BOX_GROUPS
    .map(g => ({ ...g, items: g.items.filter(i => i.source !== 'all' || canSeeAll) }))
    .filter(g => g.items.length > 0)

  if (!authorized) return <AccessGate loading={guardLoading} />

  return (
    <main style={{ padding: '24px 28px', background: PAGE_BG, minHeight: '100vh' }}>
      <style>{PULSE_KEYFRAMES}</style>
      <style>{SHELL_CSS}</style>

      <div className="ap-shell">
        <div className="ap-body">
          {/* 함 목록 — 그룹 제목(11px 회색, 사이드바와 같은 방식) 아래 하위 함 */}
          <nav className="ap-rail" aria-label="결재함">
            {groups.map((g, gi) => {
              // 접힌 묶음은 제목만 남긴다. 다만 지금 고른 함은 남겨 둔다 —
              // 어디를 보고 있는지 표시가 사라지면 길을 잃는다(아마란스도 선택 항목은 감추지 않는다).
              const folded = g.title !== null && collapsedGroups.includes(g.key)
              const shownItems = folded ? g.items.filter(i => i.key === here.key) : g.items
              return (
              <div key={g.key} className="ap-railgroup">
                {g.title
                  ? (
                    <button
                      type="button"
                      className="ap-railtitle ap-grouptitle"
                      onClick={() => toggleGroup(g.key)}
                      aria-expanded={!folded}
                      title={folded ? `${g.title} 펼치기` : `${g.title} 접기`}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 4, width: '100%',
                        border: 'none', background: 'transparent', cursor: 'pointer',
                        fontFamily: 'inherit', textAlign: 'left',
                        fontSize: 11, fontWeight: 600, color: MUTED, letterSpacing: '0.2px',
                        padding: gi === 0 ? '0 10px 6px' : '14px 10px 6px',
                      }}
                    >
                      <GroupCaret open={!folded} />
                      {g.title}
                    </button>
                  )
                  : <div style={{ height: 14 }} />}
                {shownItems.map(item => {
                  const n = itemCount(item, docsBySource, doneCounts)
                  const on = item.key === here.key
                  return (
                    <button
                      key={item.key}
                      type="button"
                      className="ap-boxbtn"
                      aria-current={on ? 'page' : undefined}
                      onClick={() => go(item.source, item.scope)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                        padding: '8px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
                        background: on ? NEUTRAL_BG : 'transparent',
                        color: on ? TEXT : SUB,
                        fontSize: 13, fontWeight: on ? 700 : 600, fontFamily: 'inherit', textAlign: 'left',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {/* 상신함 미결은 다시 손봐야 하는 건이라 눈에 띄게 — 색은 dot 에만(디자인 규칙) */}
                      {item.scope === 'unfinished' && (n ?? 0) > 0 && (
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: DANGER, flexShrink: 0 }} />
                      )}
                      <span>{item.label}</span>
                      <span style={{ marginLeft: 'auto', paddingLeft: 6, fontSize: 12, fontWeight: 600, color: MUTED }}>
                        {n === null ? '' : n}
                      </span>
                    </button>
                  )
                })}
              </div>
              )
            })}

            {/* 위임 설정 — 함이 아니라 내 설정이라 목록 끝에 구분선을 두고 둔다. */}
            <div className="ap-railfoot">
              <button
                type="button"
                className="ap-boxbtn"
                onClick={() => setDelegationOpen(true)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                  padding: '8px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
                  background: 'transparent', color: SUB,
                  fontSize: 13, fontWeight: 600, fontFamily: 'inherit', textAlign: 'left',
                  whiteSpace: 'nowrap',
                }}
              >
                <Delegate />
                <span>위임 설정</span>
              </button>
            </div>
          </nav>

          <div className="ap-main">
            <div style={cardStyle}>
              {/* 기간 · 검색 — 카드 안 첫 줄. 예전에는 카드 밖에 띠로 떠 있어 자리를 버렸다.
                  왼쪽이 기간, 오른쪽이 검색이다(아래 라디오 줄과 같은 좌우 배치). */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                <PeriodNav period={period} onChange={next => { setPeriod(next); setPage(1) }} />
                {/* 문서 종류 — 선택지는 등록표(lib/approval/docTypes.ts)에서 온다. */}
                <select
                  value={docTypeSel}
                  onChange={e => { setDocTypeSel(e.target.value); setPage(1) }}
                  title="문서 종류"
                  style={{ ...inputStyle, fontSize: 13, cursor: 'pointer' }}
                >
                  {docTypeOptions().map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                  {query && (
                    <span style={{ fontSize: 12, color: MUTED, whiteSpace: 'nowrap' }}>「{query}」 검색 결과</span>
                  )}
                  <input
                    value={searchInput}
                    onChange={e => setSearchInput(e.target.value)}
                    placeholder="문서번호 · 제목 · 상신자 검색"
                    style={{ ...inputStyle, width: 240, fontSize: 13 }}
                  />
                </span>
              </div>

              <div style={cardHeader}>
                {/* 함 이름은 이 화면에서 가장 큰 글자다 — 카드 하나에 모아 두니 어디를 보고 있는지가 먼저 읽혀야 한다. */}
                <span style={{ ...cardTitle, fontSize: 20 }}>{here.label}</span>
                <span style={countBadge}>
                  {listLoading ? '...'
                    : serverSide && serverTotal !== null ? `${serverTotal}건`
                      : `${docs.length}건`}
                </span>
                {/* 하위 구분 — 아마란스처럼 오른쪽 위 라디오. 왼쪽 함과 같은 값을 움직인다. */}
                {showsScopeRadio(source, scope) && (
                  <span style={{ marginLeft: 'auto' }}>
                    <ScopeRadio value={scope} onChange={next => go(source, next)} />
                  </span>
                )}
              </div>

              {/* 표 머리 — 카드 끝까지 늘이고 글자는 아래 행과 줄을 맞춘다. */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: COL.gap,
                margin: '-14px -16px 0', padding: `7px ${HEAD_PAD}px`,
                background: NEUTRAL_BG, fontSize: 11, fontWeight: 700, color: SUB,
              }}>
                <button
                  type="button"
                  className="ap-sortbtn"
                  onClick={() => setDesc(v => !v)}
                  title={desc ? '오래된 순으로 보기' : '최신 순으로 보기'}
                  style={{
                    width: COL.date, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 3,
                    padding: 0, border: 'none', background: 'transparent', cursor: 'pointer',
                    fontFamily: 'inherit', fontSize: 11, fontWeight: 700, color: SUB, textAlign: 'left',
                  }}
                >
                  {dateColumnLabel(source)}
                  <Caret down={desc} />
                </button>
                <span style={{ flex: 1, minWidth: 0 }}>제목 / 문서번호</span>
                <span style={{ width: COL.requester, flexShrink: 0 }}>기안자 / 기안부서</span>
                <span style={{ width: COL.status, flexShrink: 0 }}>결재상태</span>
              </div>

              {listLoading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 14 }}>
                  {[0, 1, 2].map(i => (
                    <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <div style={skeletonBlock(70, 12)} />
                      <div style={skeletonBlock('40%', 14)} />
                      <div style={skeletonBlock('20%', 12)} />
                    </div>
                  ))}
                </div>
              ) : docs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '36px 0', fontSize: 13, color: MUTED }}>
                  {query || (raw?.length ?? 0) > 0 ? '조건에 맞는 문서가 없습니다' : here.empty}
                </div>
              ) : (
                docs.map((d, i) => {
                  const type = DOC_TYPES[d.doc_type]?.label ?? d.doc_type
                  const open = openId === d.document_id
                  const files = attachmentCount(d.summary)
                  const requester = people[d.requester_id]
                  // 위임으로 들어온 건 — 지금 차례의 결재자가 내가 아닌 경우다(라우트가 delegated 로 알려 준다).
                  const owner = d.delegated ? people[d.progress?.currentApproverId ?? -1] : undefined
                  return (
                    <div key={d.document_id} style={rowStyle(i === 0)}>
                      {/* 행 전체를 누르면 지금까지처럼 그 자리에서 펼쳐진다. 오른쪽 끝의 「새 창」만
                          문서 양식 화면을 띄운다 — 버튼 안에 버튼을 둘 수 없어 형제로 나란히 둔다. */}
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                      <button
                        type="button"
                        onClick={() => {
                          const opening = !open
                          setOpenId(opening ? d.document_id : null)
                          // 펼치는 순간 유형별 패널의 데이터를 미리 부른다. 패널은 상세가 그려진
                          // **뒤에** 자기 요청을 띄우므로, 그리기를 기다리는 만큼 먼저 출발한다.
                          // 어느 유형이 무엇을 미리 부를지는 등록표(panels.ts)가 안다 —
                          // 여기에 문서 종류 이름을 적지 않는다.
                          if (opening) prefetchPanel(d.doc_type, d.document_id)
                        }}
                        style={{
                          display: 'flex', alignItems: 'flex-start', gap: COL.gap, width: '100%', textAlign: 'left',
                          border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', fontFamily: 'inherit',
                        }}>
                        {/* 기안일 — 기결문서에서는 내가 처리한 날(결재일) */}
                        <span style={{ width: COL.date, flexShrink: 0, fontSize: 12, color: MUTED, paddingTop: 2 }}>
                          {dateText(approvalDate(d, source, myId, scope))}
                        </span>

                        {/* 제목 / 문서 종류 · 문서번호 */}
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ fontSize: 14, fontWeight: 600, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {d.title}
                            </span>
                            {files > 0 && (
                              <span style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }} title={`첨부 ${files}개`}>
                                <Clip />
                                <span style={{ fontSize: 11, color: MUTED }}>{files}</span>
                              </span>
                            )}
                            {d.delegated && (
                              <span
                                title={owner?.name ? `${owner.name}님을 대신하여 결재` : '위임받아 대신 결재'}
                                style={{ fontSize: 11, fontWeight: 700, color: SUB, background: NEUTRAL_BG, borderRadius: 99, padding: '1px 7px', flexShrink: 0 }}>
                                대결
                              </span>
                            )}
                          </span>
                          <span style={{ display: 'block', fontSize: 11, color: MUTED, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {type}<span style={{ color: FAINT }}> · </span>{d.doc_no}
                          </span>
                        </span>

                        {/* 기안자 / 기안부서 */}
                        <span style={{ width: COL.requester, flexShrink: 0 }}>
                          <span style={{ display: 'block', fontSize: 12, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {requester?.name ?? `#${d.requester_id}`}
                          </span>
                          <span style={{ display: 'block', fontSize: 11, color: MUTED, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {requester?.teams?.trim() || '-'}
                          </span>
                        </span>

                        {/* 결재상태 */}
                        <span style={{ width: COL.status, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, paddingTop: 2 }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_DOT[d.status] ?? FAINT, flexShrink: 0 }} />
                          <span style={{ fontSize: 12, color: SUB, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {statusText(d, people)}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        title="새 창으로 열기"
                        aria-label="새 창으로 열기"
                        onClick={() => openApprovalDoc(d.document_id, {
                          mobile: isMobileViewport(),
                          navigate: url => router.push(url),
                        })}
                        style={{
                          flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          width: 24, height: 24, marginTop: 1, padding: 0, border: 'none', borderRadius: 6,
                          background: 'transparent', color: MUTED, cursor: 'pointer', fontFamily: 'inherit',
                        }}
                      >
                        <ExternalLink />
                      </button>
                      </div>

                      {open && (
                        <div style={{ marginTop: 10, marginLeft: -12, marginRight: -12 }}>
                          <DocDetail
                            doc={d}
                            people={people}
                            box={detailBox(source)}
                            onChanged={() => setReloadKey(k => k + 1)}
                          />
                        </div>
                      )}
                    </div>
                  )
                })
              )}
              {/* 페이지 나누기 — 서버가 끊어 주는 함(기결문서(종결))에만 나온다.
                  방식은 의뢰서 목록과 같다(lib/paging.ts 를 둘이 함께 쓴다). */}
              {serverSide && !listLoading && serverTotal !== null && (() => {
                const shownRange = pageRange(pageNo, serverTotal, PAGE_SIZE)
                const lastPage = totalPages(serverTotal, PAGE_SIZE)
                return (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                  padding: '10px 12px 2px', borderTop: `1px solid ${BORDER}`,
                }}>
                  <span style={{ fontSize: 12, color: MUTED }}>
                    총 {serverTotal}건
                    {shownRange && ` 중 ${shownRange.from}–${shownRange.to}`}
                  </span>
                  {lastPage > 1 && (
                    <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                      <button type="button" disabled={pageNo <= 1} onClick={() => setPage(pageNo - 1)}
                        style={{ ...btnGhost(pageNo <= 1), padding: '5px 10px', fontSize: 12 }}>이전</button>
                      {pageWindow(pageNo, serverTotal, 1, PAGE_SIZE).map((pg, i) => (
                        pg === '…'
                          ? <span key={`gap-${i}`} style={{ fontSize: 12, color: FAINT, padding: '0 2px' }}>…</span>
                          : (
                            <button
                              key={pg} type="button"
                              aria-current={pg === pageNo ? 'page' : undefined}
                              onClick={() => setPage(pg)}
                              style={{
                                border: 'none', borderRadius: 6, padding: '5px 10px', fontSize: 12,
                                fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
                                background: pg === pageNo ? BLUE : NEUTRAL_BG,
                                color: pg === pageNo ? '#ffffff' : SUB,
                              }}
                            >
                              {pg}
                            </button>
                          )
                      ))}
                      <button type="button" disabled={pageNo >= lastPage} onClick={() => setPage(pageNo + 1)}
                        style={{ ...btnGhost(pageNo >= lastPage), padding: '5px 10px', fontSize: 12 }}>다음</button>
                    </span>
                  )}
                </div>
                )
              })()}
            </div>
          </div>
        </div>
      </div>

      {/* 위임 설정 — 결재 목록과 상태를 나누지 않는다. 닫을 때 목록을 다시 읽어, 위임을 걸거나 풀면
          미결함(내 차례 + 위임받은 건)이 바로 맞는다. */}
      <DelegationModal
        open={delegationOpen}
        onClose={() => { setDelegationOpen(false); setReloadKey(k => k + 1) }}
        myId={myId}
        isSuper={isSuper}
      />
    </main>
  )
}

// useSearchParams 는 Suspense 경계가 필요하다(쇼룸·견적 화면과 같은 방식).
export default function ApprovalPage() {
  return (
    <Suspense fallback={null}>
      <ApprovalPageInner />
    </Suspense>
  )
}
