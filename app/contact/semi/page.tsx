'use client'

// 반도체 고객 접촉 보고 — Project 목록(/contact/semi).
//
// 위에서 아래로: 제목 「접촉 보고서」 + Project 건수 + 「+ 새 Project」 → 필터 줄(팀 토글 · 검색 · 결과 건수) → 목록.
// 디자인은 components/common/ui.ts 토큰(cardStyle·cardTitle·countBadge·rowStyle·btn*·inputStyle)을 따른다.
//
// 거르기(2026-11-22) — 검색어·기간·작성자는 **서버가 거른다**. 검색어는 Project 칸뿐 아니라
// **보고서 본문 전문**(접촉방법·고객 담당자·목적·FACT·detail 의 모든 글자)을 보는데, 그 글자는
// 화면에 없는 자료라 서버에서 찾아야 한다. 네 조건(팀·검색어·기간·작성자)은 **URL 쿼리**에
// 그대로 남는다 — 새로고침해도, Project 를 열었다 뒤로 와도 보던 화면이 그대로다.
// 검색어만 300ms 디바운스를 둔다(한 글자마다 서버를 부르지 않게). 기간·작성자는 고르는 즉시다.
//
// 데이터 — GET /api/semi-contact/projects[?team=&q=&from=&to=&author=] 하나로 읽는다. 팀 판정(만든 사람 또는 보고서 작성자 중
// 그 팀 소속이 있는가)은 서버가 하고, 화면은 결과만 받는다. 토글 칸(「전체」 + 사업부가 반도체인 팀, display_order 순)도
// 같은 응답의 teams 로 만든다 — 팀이 늘면 칸도 저절로 는다. 최근 접촉·접촉 횟수·정렬(최근 접촉 내림차순, 없으면
// 생성일)도 서버가 계산한다. 검색은 받은 목록(토글로 거른 뒤)을 화면에서 거른다(번호·고객사·사업장/부서·안건, 대소문자 무시).
//
// 행을 누르면 Project 상세로, 행 끝의 「보고서 작성」은 작성 화면으로 간다(클릭이 행으로 번지지 않게 막는다).
// 진입 — 메뉴 키 contact_semi(lib/menuPerms.ts). usePageGuard 가 판정하고 권한이 없으면 AccessGate 를 그린다.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { usePageGuard } from '@/hooks/usePageGuard'
import AccessGate from '@/components/common/AccessGate'
import ModalOverlay from '@/components/common/ModalOverlay'
import ModalCard from '@/components/common/ModalCard'
import { useToast } from '@/components/common/Toast'
import { FieldError, errBorder, useFieldErrors } from '@/components/common/fieldErrors'
import {
  PAGE_BG, CARD_BG, BORDER, TEXT, MUTED, SUB, FAINT, ROW_HOVER_BG, NEUTRAL_BG, BLUE,
  cardStyle, cardHeader, cardTitle, countBadge, rowStyle, btnPrimary, btnGhost, inputStyle,
} from '@/components/common/ui'
import { errorInfo } from '@/lib/errorInfo'
import { apiErrorText, emptyInput, FIELD_BY_KEY, type FieldKey, validateReport } from '@/lib/semiContact'
import {
  PROJECT_KEYS, PROJECT_NO_KEY, PROJECT_NO_LABEL, PROJECT_NO_MAX, PROJECT_TEXT_MAX, validateProjectNo,
} from '@/lib/semiContact/project'
import { R } from '@/lib/radius'

/**
 * 열 폭. 머리 줄과 행이 같은 grid-template-columns(.cs-grid)를 쓴다 — 머리/행이 어긋나지 않게.
 *   번호·최근 접촉·횟수·작성 버튼 — 고정 폭 / 고객사·사업장·안건 — 남는 폭을 나눠 쓴다(안건이 가장 많이).
 *   최근 접촉 — 가장 긴 「YYYY-MM-DD · 이름 직책」(네 글자 이름 + 「관리자」)이 들어가는 폭.
 *   접촉 횟수 — 최근 접촉 칸 끝과 버튼 왼쪽 끝 사이 전체. 양옆 간격이 같아 숫자가 정확히 그 가운데에 온다.
 *   작성 버튼 — 버튼이 칸을 꽉 채워, 칸의 왼쪽 끝이 곧 버튼의 왼쪽 끝이다.
 * 생성일은 화면에 보이지 않는다(정렬 기준으로만 서버가 쓴다).
 */
const COL = { no: 156, last: 168, count: 72, write: 84, gap: 10 }
const FR_CUSTOMER = 1
const FR_SITE = 0.8
const FR_TITLE = 1.4
/** 카드 좌우 여백(16) + 행 좌우 여백(12). 머리는 카드 끝까지 늘이고 글자만 행과 맞춘다. */
const HEAD_PAD = 28

const gridCols = (site: boolean) => [
  `${COL.no}px`, `minmax(0, ${FR_CUSTOMER}fr)`, ...(site ? [`minmax(0, ${FR_SITE}fr)`] : []), `minmax(0, ${FR_TITLE}fr)`,
  `${COL.last}px`, `${COL.count}px`, `${COL.write}px`,
].join(' ')

/** 머리·행 공용 grid. 좁은 화면에서는 사업장 칸을 숨기고 그 칸을 뺀 열 정의로 바꾼다. container-type 이 있어야 @container 가 동작한다. */
const SHELL_CSS = `
  .cs-shell { container-type: inline-size; }
  .cs-grid { display: grid; grid-template-columns: ${gridCols(true)}; column-gap: ${COL.gap}px; align-items: center; }
  @container (max-width: 820px) {
    .cs-grid { grid-template-columns: ${gridCols(false)}; }
    .cs-site { display: none !important; }
  }
`

/** GET /api/semi-contact/projects 가 돌려주는 한 행. */
type ProjectRow = {
  project_id: number
  project_no: string
  customer_name: string
  site_dept: string | null
  title: string
  created_at: string
  report_count: number
  last_contact_date: string | null
  last_contact_author: string | null
  last_contact_author_position: string | null
}

export default function ContactSemiPage() {
  const router = useRouter()
  const { loading: guardLoading, authorized } = usePageGuard()

  /** 고른 팀. null 이면 「전체」. */
  const [team, setTeam] = useState<string | null>(null)
  const [rows, setRows] = useState<ProjectRow[] | null>(null)
  /** 토글 칸 — 사업부가 반도체인 팀 이름(display_order 순). 못 읽으면 빈 목록이라 「전체」만 보인다. */
  const [teams, setTeams] = useState<string[]>([])
  /** 전체 엑셀을 만드는 중인가 — 단추를 잠그고 「만드는 중…」을 보인다(지시 M). */
  const [exporting, setExporting] = useState(false)
  const toast = useToast()
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  /** 서버로 보내는 검색어 — 300ms 디바운스. 칸의 글자(q)와 따로 둔다. */
  const [debouncedQ, setDebouncedQ] = useState('')
  /** 접촉일 기간 — 'YYYY-MM-DD'. 빈 글자면 그쪽 끝은 열려 있다. */
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  /** 작성자 — engineers.engineer_id. '' 면 전체. */
  const [author, setAuthor] = useState('')
  /** 작성자 칸 — 보고서를 쓴 사람 목록(서버가 준다). */
  const [authors, setAuthors] = useState<{ engineer_id: number; name: string }[]>([])
  /** 거르기 전 Project 수 — 「전체 N건 중」. */
  const [total, setTotal] = useState<number | null>(null)
  /**
   * URL 쿼리를 읽기 전에는 조회하지 않는다. 서버에서 그린 첫 화면과 글자가 달라지지
   * 않게 상태는 빈 값으로 시작하고, 붙은 뒤(마운트)에 주소에서 한 번 채운다.
   */
  const [ready, setReady] = useState(false)
  const [creating, setCreating] = useState(false)
  /** 올리면 목록을 다시 읽는다(새 Project 를 만든 뒤). */
  const [reloadKey, setReloadKey] = useState(0)

  // 주소 → 상태 (한 번). 뒤로 가기로 돌아와도 이 자리를 지난다(그때는 화면이 다시 붙는다).
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    const t = sp.get('team')
    if (t) setTeam(t)
    const q0 = sp.get('q') ?? ''
    setQ(q0); setDebouncedQ(q0)
    setFrom(sp.get('from') ?? '')
    setTo(sp.get('to') ?? '')
    setAuthor(sp.get('author') ?? '')
    setReady(true)
  }, [])

  // 검색어 디바운스 — 300ms 동안 더 치지 않으면 그때 보낸다.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q), 300)
    return () => clearTimeout(id)
  }, [q])

  /**
   * 상태 → 주소. **replaceState** 다 — 글자를 칠 때마다 뒤로 가기 기록을 쌓지 않는다.
   * Project 를 열었다 뒤로 오면 이 주소로 돌아오므로 보던 조건이 그대로다.
   */
  useEffect(() => {
    if (!ready) return
    const sp = new URLSearchParams()
    if (team) sp.set('team', team)
    if (debouncedQ.trim()) sp.set('q', debouncedQ.trim())
    if (from) sp.set('from', from)
    if (to) sp.set('to', to)
    if (author) sp.set('author', author)
    const qs = sp.toString()
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname)
  }, [ready, team, debouncedQ, from, to, author])

  useEffect(() => {
    if (!authorized || !ready) return
    let cancelled = false
    const load = async () => {
      setBusy(true)
      try {
        const sp = new URLSearchParams()
        if (team) sp.set('team', team)
        if (debouncedQ.trim()) sp.set('q', debouncedQ.trim())
        if (from) sp.set('from', from)
        if (to) sp.set('to', to)
        if (author) sp.set('author', author)
        const qs = sp.toString()
        const res = await fetch(`/api/semi-contact/projects${qs ? `?${qs}` : ''}`)
        const json = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) {
          console.error('[contact/semi] Project 목록 조회 실패', { status: res.status, error: json })
          setLoadError(apiErrorText(res.status, json, `목록을 불러오지 못했습니다 (${res.status})`))
          setRows([])
          return
        }
        setLoadError(null)
        setRows((json.projects ?? []) as ProjectRow[])
        setTeams(Array.isArray(json.teams) ? (json.teams as unknown[]).filter((t): t is string => typeof t === 'string') : [])
        setAuthors(Array.isArray(json.authors) ? (json.authors as { engineer_id: number; name: string }[]) : [])
        setTotal(typeof json.total === 'number' ? json.total : null)
      } catch (e) {
        if (cancelled) return
        console.error('[contact/semi] Project 목록 조회 실패', errorInfo(e))
        setLoadError('목록을 불러오지 못했습니다. 잠시 뒤 다시 시도해주세요.')
        setRows([])
      } finally {
        if (!cancelled) setBusy(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [authorized, ready, team, debouncedQ, from, to, author, reloadKey])

  /**
   * 거르기는 **서버가 한다**(검색어는 보고서 본문 전문까지 본다 — 화면에 없는 자료다).
   * 그래서 받은 목록이 곧 보여 줄 목록이다. 순서도 서버가 정한 대로 둔다.
   */
  const shown = rows ?? []
  const words = debouncedQ.trim()
  /** 조건이 하나라도 걸려 있는가 — 「조건을 지웁니다」 단추와 빈 목록 안내가 쓴다. */
  const narrowed = words !== '' || from !== '' || to !== '' || author !== ''
  const clearAll = () => { setQ(''); setFrom(''); setTo(''); setAuthor('') }

  /**
   * 전체 엑셀 — **목록과 같은 조건**을 라우트에 그대로 넘긴다(2026-11-26, 지시 M).
   *
   * 거르기는 라우트가 목록과 **같은 순수 모듈**로 다시 한다(lib/semiContact/search.ts) —
   * 화면이 고른 id 목록을 보내지 않는 이유다. 보내면 쪽이 넘어간 목록·방금 올라온 보고서와
   * 어긋나고, 조건이 두 곳에 적히면 반드시 갈린다.
   *
   * 파일은 라우트가 만들어 보낸다(권한 검사와 service role 읽기를 한 곳에서 한다).
   */
  const exportAll = async () => {
    if (exporting) return
    setExporting(true)
    try {
      const sp = new URLSearchParams({ all: '1' })
      if (team) sp.set('team', team)
      if (words) sp.set('q', words)
      if (from) sp.set('from', from)
      if (to) sp.set('to', to)
      if (author) sp.set('author', author)
      const res = await fetch(`/api/semi-contact/export?${sp.toString()}`)
      if (!res.ok) {
        const json = await res.json().catch(() => null) as { error?: string } | null
        toast.error(json?.error ?? `엑셀을 만들지 못했습니다 (${res.status})`)
        return
      }
      // 파일명은 서버가 정한다(조건이 꼬리에 붙는다) — 헤더에서 꺼낸다.
      const cd = res.headers.get('Content-Disposition') ?? ''
      const star = /filename\*=UTF-8''([^;]+)/.exec(cd)
      const name = star ? decodeURIComponent(star[1]) : '접촉보고서_전체.xlsx'
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      URL.revokeObjectURL(url)
      // 건별 시트를 몇 장 넣었는지 — 상한을 넘겼으면 그 사실까지 말해 준다.
      const counts = res.headers.get('X-Export-Counts')
      const made = counts ? JSON.parse(counts) as { projects: number; reports: number; sheets: number; skipped: number } : null
      toast.success(made
        ? `Project ${made.projects}건 · 보고서 ${made.reports}건을 받았습니다${made.skipped > 0 ? ` (건별 시트는 ${made.sheets}장, ${made.skipped}건은 「전체」 시트에만)` : ''}`
        : '엑셀을 받았습니다')
    } catch (e) {
      console.error('[semi] 전체 엑셀 실패', e)
      toast.error('네트워크 오류로 엑셀을 받지 못했습니다')
    } finally {
      setExporting(false)
    }
  }

  if (!authorized) return <AccessGate loading={guardLoading} />

  const openProject = (id: number) => router.push(`/contact/semi/${id}`)

  return (
    <main style={{ padding: '24px 28px', background: PAGE_BG, minHeight: '100vh' }}>
      <style>{SHELL_CSS}</style>

      <div className="cs-shell" style={cardStyle}>
        <div style={cardHeader}>
          <span style={{ ...cardTitle, fontSize: 20 }}>접촉 보고서</span>
          {total !== null && <span style={countBadge}>Project {total}건</span>}
          {busy && rows !== null && <span style={{ fontSize: 12, color: MUTED }}>불러오는 중...</span>}
          <button type="button" onClick={() => setCreating(true)} style={{ ...btnPrimary(), marginLeft: 'auto' }}>
            + 새 Project
          </button>
        </div>

        {/* ── 필터 줄 — 팀 토글 · 검색 · 접촉일 기간 · 작성자 · 결과 건수 ──
            좁은 화면에서는 줄바꿈으로 흐른다(flexWrap). 검색 칸이 남는 폭을 먹는다. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <TeamToggle teams={teams} value={team} onChange={setTeam} />
          <span style={{ position: 'relative', flex: '1 1 240px', minWidth: 200 }}>
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="번호·고객사·사업장/부서·안건·보고서 본문 검색"
              aria-label="검색"
              style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', paddingRight: q ? 30 : undefined }}
            />
            {q && (
              <button type="button" aria-label="검색어 지우기" onClick={() => setQ('')}
                style={{
                  position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                  border: 'none', background: 'transparent', color: MUTED, cursor: 'pointer', padding: 0,
                  display: 'flex', alignItems: 'center',
                }}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
              </button>
            )}
          </span>

          {/* 접촉일 기간 — 양끝 포함. 한쪽만 적어도 된다(그쪽 끝만 막힌다). */}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <input type="date" className="date-fit" value={from} onChange={e => setFrom(e.target.value)}
              aria-label="접촉일 시작" title="접촉일 시작"
              style={{ ...inputStyle, width: 140, colorScheme: 'light' }} />
            <span style={{ fontSize: 12, color: MUTED }}>~</span>
            <input type="date" className="date-fit" value={to} onChange={e => setTo(e.target.value)}
              aria-label="접촉일 끝" title="접촉일 끝"
              style={{ ...inputStyle, width: 140, colorScheme: 'light' }} />
          </span>

          {/* 작성자 — 보고서를 쓴 사람만 칸에 선다(서버가 준 목록). */}
          <select value={author} onChange={e => setAuthor(e.target.value)} aria-label="작성자"
            style={{ ...inputStyle, width: 120, flexShrink: 0 }}>
            <option value="">작성자 전체</option>
            {authors.map(a => <option key={a.engineer_id} value={String(a.engineer_id)}>{a.name}</option>)}
          </select>

          {narrowed && (
            <button type="button" onClick={clearAll}
              style={{ ...btnGhost(), padding: '0 10px', height: 32, flexShrink: 0 }}>조건 지우기</button>
          )}

          {/* 전체 엑셀 — **지금 걸린 조건 그대로** 한 파일로(2026-11-26, 지시 M).
              Project 하나씩 받던 건별 엑셀은 Project 상세에 그대로 있다. */}
          <button
            type="button"
            onClick={() => { void exportAll() }}
            disabled={exporting || shown.length === 0}
            title={shown.length === 0 ? '내보낼 Project 가 없습니다' : '목록에 걸린 조건 그대로 한 파일로 내려받습니다'}
            style={{ ...btnGhost(exporting || shown.length === 0), padding: '0 10px', height: 32, flexShrink: 0 }}
          >
            {exporting ? '만드는 중…' : '전체 엑셀'}
          </button>

          {rows !== null && (
            <span className="num" style={{ marginLeft: 'auto', fontSize: 12, color: MUTED, whiteSpace: 'nowrap' }}>
              {narrowed && total !== null ? `전체 ${total}건 중 ` : ''}결과 {shown.length}건
            </span>
          )}
        </div>

        {/* 표 머리 — 카드 끝까지 늘이고 글자만 행과 맞춘다 */}
        <div className="cs-grid" style={{
          margin: '0 -16px', padding: `0 ${HEAD_PAD}px 8px`,
          borderBottom: `1px solid ${BORDER}`,
          fontSize: 11, fontWeight: 700, color: MUTED, whiteSpace: 'nowrap',
        }}>
          <span>{PROJECT_NO_LABEL}</span>
          <span style={{ minWidth: 0 }}>{FIELD_BY_KEY.customer_name.label}</span>
          <span className="cs-site" style={{ minWidth: 0 }}>{FIELD_BY_KEY.site_dept.label}</span>
          <span style={{ minWidth: 0 }}>{FIELD_BY_KEY.title.label}</span>
          <span style={{ textAlign: 'center' }}>최근 접촉</span>
          <span style={{ textAlign: 'center' }}>접촉 횟수</span>
          <span />
        </div>

        {loadError ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#ef4444', fontSize: 13, fontWeight: 700, lineHeight: 1.7 }}>
            목록을 불러오지 못했습니다<br />
            <span style={{ fontSize: 12, fontWeight: 500 }}>{loadError}</span>
          </div>
        ) : rows === null ? (
          <div style={{ textAlign: 'center', padding: 40, color: MUTED, fontSize: 13 }}>불러오는 중...</div>
        ) : shown.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: MUTED, fontSize: 13, lineHeight: 1.7 }}>
            {words
              ? '검색 결과가 없습니다'
              : team
                ? `${team} 팀의 Project가 없습니다`
                : '등록된 Project가 없습니다'}
          </div>
        ) : (
          shown.map((r, i) => (
            <div
              key={r.project_id}
              role="link"
              tabIndex={0}
              onClick={() => openProject(r.project_id)}
              onKeyDown={e => { if (e.key === 'Enter') openProject(r.project_id) }}
              onMouseEnter={e => (e.currentTarget.style.background = ROW_HOVER_BG)}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              className="cs-grid"
              style={{ ...rowStyle(i === 0), cursor: 'pointer' }}
            >
              <span className="num" style={{
                minWidth: 0, fontSize: 13, fontWeight: 700, color: TEXT,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }} title={r.project_no}>
                {r.project_no}
              </span>
              <span style={cellText(TEXT)} title={r.customer_name}>{r.customer_name}</span>
              <span className="cs-site" style={cellText(r.site_dept?.trim() ? SUB : FAINT)} title={r.site_dept ?? undefined}>
                {r.site_dept?.trim() || '-'}
              </span>
              <span style={cellText(TEXT)} title={r.title}>{r.title}</span>
              <span style={{
                minWidth: 0, fontSize: 12, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {r.last_contact_date ? (
                  <>
                    <span className="num" style={{ color: TEXT }}>{r.last_contact_date}</span>
                    <span style={{ color: FAINT }}> · </span>
                    <span style={{ color: SUB }}>
                      {r.last_contact_author
                        ? (r.last_contact_author_position ? `${r.last_contact_author} ${r.last_contact_author_position}` : r.last_contact_author)
                        : '-'}
                    </span>
                  </>
                ) : <span style={{ color: FAINT }}>-</span>}
              </span>
              <span className="num" style={{ fontSize: 13, color: r.report_count ? TEXT : FAINT, textAlign: 'center' }}>
                {r.report_count}
              </span>
              <span style={{ display: 'flex' }}>
                <Link
                  href={`/contact/semi/${r.project_id}/write`}
                  onClick={e => e.stopPropagation()}
                  onKeyDown={e => e.stopPropagation()}
                  style={{ ...btnGhost(), flex: 1, padding: '5px 0', fontSize: 12, textAlign: 'center', whiteSpace: 'nowrap', textDecoration: 'none' }}
                >
                  보고서 작성
                </Link>
              </span>
            </div>
          ))
        )}
      </div>

      {creating && (
        <NewProjectModal
          onClose={() => setCreating(false)}
          onCreated={() => setReloadKey(k => k + 1)}
        />
      )}
    </main>
  )
}

// ── 팀 토글 ─────────────────────────────────────────────────────────
// 회색 트랙(#f3f4f6, 반지름 6, 안쪽 3) 안에 같은 폭의 칸을 grid 로 늘어놓고, 고른 칸 뒤의 흰 인디케이터
// (반지름 5, 1px #ebebeb)가 transform 으로 미끄러진다. 글자 12/700, 고른 칸 #234ea2 · 나머지 #9ca3af.
// 칸 폭은 그려진 이름들의 폭을 재서 가장 긴 것(최소 96px)으로 모두 맞춘다 — 칸 폭이 같아야 인디케이터 이동량이 일정하다.

/** 칸의 최소 폭(px). */
const TOGGLE_MIN = 96
/** 칸 안 좌우 여백(px) — 가장 긴 이름에 더해 칸 폭을 정한다. */
const TOGGLE_PAD = 24

function TeamToggle({ teams, value, onChange }: {
  teams: string[]
  value: string | null
  onChange: (team: string | null) => void
}) {
  const items: { label: string; team: string | null }[] = [{ label: '전체', team: null }, ...teams.map(t => ({ label: t, team: t }))]
  const labelRefs = useRef<(HTMLSpanElement | null)[]>([])
  const [cell, setCell] = useState(TOGGLE_MIN)
  const labelsKey = items.map(i => i.label).join('\u0001')

  // 이름 폭을 재서 칸 폭을 정한다(팀 목록이 바뀔 때마다).
  useLayoutEffect(() => {
    const widest = Math.max(0, ...labelRefs.current.map(el => (el ? el.scrollWidth : 0)))
    setCell(Math.max(TOGGLE_MIN, Math.ceil(widest) + TOGGLE_PAD))
  }, [labelsKey])

  const idx = Math.max(0, items.findIndex(i => i.team === value))
  return (
    <div role="tablist" aria-label="팀" style={{
      position: 'relative', display: 'inline-grid', gridTemplateColumns: `repeat(${items.length}, ${cell}px)`,
      background: NEUTRAL_BG, borderRadius: R.icon, padding: 3, flexShrink: 0,
    }}>
      <span aria-hidden style={{
        position: 'absolute', top: 3, bottom: 3, left: 3, width: cell,
        background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: R.tag, boxSizing: 'border-box',
        transform: `translateX(${idx * cell}px)`, transition: 'transform 0.2s ease',
      }} />
      {items.map((it, i) => {
        const on = i === idx
        return (
          <button key={it.team ?? '__all'} type="button" role="tab" aria-selected={on}
            onClick={() => onChange(it.team)}
            style={{
              position: 'relative', zIndex: 1, height: 28, padding: '0 6px', border: 'none', background: 'transparent',
              fontSize: 12, fontWeight: 700, color: on ? BLUE : MUTED, cursor: 'pointer', fontFamily: 'inherit',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', transition: 'color 0.15s ease',
            }}>
            <span ref={el => { labelRefs.current[i] = el }}>{it.label}</span>
          </button>
        )
      })}
    </div>
  )
}

/** 남는 폭을 나눠 쓰는 글자 칸. 한 줄로 자르고 넘치면 말줄임. */
function cellText(color: string) {
  return {
    minWidth: 0, fontSize: 13, color,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  } as const
}

// ── 새 Project 모달 ─────────────────────────────────────────────────
// 의뢰서의 「기존 번호 등록」 모달(app/inquiries/page.tsx)과 같은 틀이다.
// 받는 칸: Project 번호(직접 입력, 필수) + 등록표에서 storage 가 'project' 인 칸(고객사·사업장/부서·Project/구매안건).
// 번호 형식은 보지 않는다. 겹치면(대소문자 무시) 서버가 번호 칸 오류로 돌려준다.

type ModalKey = FieldKey | typeof PROJECT_NO_KEY

const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: MUTED, marginBottom: 5, display: 'block',
}

/** 번호 + 등록표 검증에서 Project 칸 오류만 골라낸다(라우트와 같은 규칙). */
function projectErrors(projectNo: string, values: Record<FieldKey, string>): Partial<Record<ModalKey, string>> {
  const out: Partial<Record<ModalKey, string>> = {}
  const noErr = validateProjectNo(projectNo)
  if (noErr) out[PROJECT_NO_KEY] = noErr
  const checked = validateReport(values, [], { noAction: true })
  for (const k of PROJECT_KEYS) if (checked.errors[k]) out[k] = checked.errors[k]
  return out
}

function NewProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast()
  const [projectNo, setProjectNo] = useState('')
  const [values, setValues] = useState<Record<FieldKey, string>>(() => emptyInput())
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
      const body: Record<string, string> = { [PROJECT_NO_KEY]: projectNo }
      for (const k of PROJECT_KEYS) body[k] = values[k]
      const res = await fetch('/api/semi-contact/project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        // 칸별 오류는 그 칸 아래에, 나머지는 모달 아래 상자에 보인다. 번호 중복은 번호 칸 아래에만 보인다.
        const fe = json.fieldErrors && typeof json.fieldErrors === 'object' ? json.fieldErrors : null
        if (fe) setErrors(fe)
        if (!fe) setError(apiErrorText(res.status, json, `Project 를 만들지 못했습니다 (${res.status})`))
        console.error('[contact/semi] Project 만들기 실패', { status: res.status, error: json })
        return
      }
      toast.success(`${json.project?.project_no ?? 'Project'} 만들었습니다`)
      onCreated()
      onClose()
    } catch (e) {
      console.error('[contact/semi] Project 만들기 실패', errorInfo(e))
      setError('Project 를 만들지 못했습니다. 잠시 뒤 다시 시도해주세요.')
    } finally {
      setBusy(false)
    }
  }

  const input = (id: string, value: string, onChange: (v: string) => void, max: number, err?: string, autoFocus?: boolean) => (
    <input
      id={id}
      value={value}
      maxLength={max}
      autoFocus={autoFocus}
      onChange={e => onChange(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit() }}
      disabled={busy}
      style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', ...(err ? { border: errBorder } : null) }}
    />
  )

  return (
    // 저장 중에는 닫히지 않는다(closeOn 'none'). 그 밖에는 확인 뒤 닫는다.
    <ModalOverlay onClose={onClose} closeOn={busy ? 'none' : 'both'} confirmClose>
      {/* 구조는 공용 카드가 든다 — 머리줄 고정 / 본문 스크롤 / 바닥줄 고정.
          전에는 카드 자체가 구르는 칸이었다(maxHeight 86vh + overflowY auto) — 칸이 많아지면
          제목과 [저장]이 같이 밀렸다. 이제 본문만 구른다.
          겉모양은 옛 값 그대로다: 여백 14/16 · 머리줄 아래 구분선(cardHeader 의 12+14) ·
          제목 17/800(cardTitle) · 버튼 둘이 반씩(flex: 1).
          ✕ 는 두지 않는다 — 길은 [닫기]·Esc·바깥 클릭 셋이고 저장 중에는 셋 다 막힌다. */}
      <ModalCard
        width={500}
        closeX={false}
        headStyle={{ alignItems: 'center', gap: 8, padding: '14px 16px 12px', marginBottom: 14, borderBottom: `1px solid ${BORDER}` }}
        bodyStyle={{ padding: '0 16px' }}
        footStyle={{ padding: '0 16px 14px' }}
        title={<>
          <span style={cardTitle}>새 Project</span>
        </>}
        footer={<>
          <button type="button" onClick={onClose} disabled={busy} style={{ ...btnGhost(busy), flex: 1 }}>닫기</button>
          <button type="button" onClick={submit} disabled={busy} style={{ ...btnPrimary(busy), flex: 1 }}>
            {busy ? '저장 중...' : '저장'}
          </button>
        </>}
      >

        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle} htmlFor="np-project_no">{PROJECT_NO_LABEL}</label>
          {input('np-project_no', projectNo, v => { setProjectNo(v); clearError(PROJECT_NO_KEY) }, PROJECT_NO_MAX, errors[PROJECT_NO_KEY], true)}
          <FieldError message={errors[PROJECT_NO_KEY]} />
        </div>

        {PROJECT_KEYS.map(k => {
          const f = FIELD_BY_KEY[k]
          const id = `np-${k}`
          return (
            <div key={k} style={{ marginBottom: 12 }}>
              <label style={labelStyle} htmlFor={id}>
                {f.label}
                {!f.required && <span style={{ fontWeight: 500 }}> (선택)</span>}
              </label>
              {input(id, values[k], v => change(k, v), PROJECT_TEXT_MAX, errors[k])}
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

      </ModalCard>
    </ModalOverlay>
  )
}
