'use client'

// 반도체 고객 접촉 보고 — Project 목록(/contact/semi).
//
// 위에서 아래로: 제목 「접촉 보고서」 + Project 건수 + 「+ 새 Project」 → 필터 줄(팀 토글 · 검색 · 결과 건수) → 목록.
// 디자인은 components/common/ui.ts 토큰(cardStyle·cardTitle·countBadge·rowStyle·btn*·inputStyle)을 따른다.
//
// 데이터 — GET /api/semi-contact/projects[?team=<팀 이름>] 하나로 읽는다. 팀 판정(만든 사람 또는 보고서 작성자 중
// 그 팀 소속이 있는가)은 서버가 하고, 화면은 결과만 받는다. 토글 칸(「전체」 + 사업부가 반도체인 팀, display_order 순)도
// 같은 응답의 teams 로 만든다 — 팀이 늘면 칸도 저절로 는다. 최근 접촉·접촉 횟수·정렬(최근 접촉 내림차순, 없으면
// 생성일)도 서버가 계산한다. 검색은 받은 목록(토글로 거른 뒤)을 화면에서 거른다(번호·고객사·사업장/부서·안건, 대소문자 무시).
//
// 행을 누르면 Project 상세로, 행 끝의 「보고서 작성」은 작성 화면으로 간다(클릭이 행으로 번지지 않게 막는다).
// 진입 — 메뉴 키 contact_semi(lib/menuPerms.ts). usePageGuard 가 판정하고 권한이 없으면 AccessGate 를 그린다.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { usePageGuard } from '@/hooks/usePageGuard'
import AccessGate from '@/components/common/AccessGate'
import ModalOverlay from '@/components/common/ModalOverlay'
import { useToast } from '@/components/common/Toast'
import { FieldError, errBorder, useFieldErrors } from '@/components/common/fieldErrors'
import {
  PAGE_BG, CARD_BG, BORDER, TEXT, MUTED, SUB, FAINT, ROW_HOVER_BG, NEUTRAL_BG, BLUE,
  cardStyle, cardHeader, cardTitle, countBadge, rowStyle, btnPrimary, btnGhost, inputStyle,
} from '@/components/common/ui'
import { kstYmd } from '@/lib/date'
import { errorInfo } from '@/lib/errorInfo'
import { FIELD_BY_KEY, emptyInput, validateReport, type FieldKey } from '@/lib/semiContact'
import {
  PROJECT_KEYS, PROJECT_NO_KEY, PROJECT_NO_LABEL, PROJECT_NO_MAX, PROJECT_TEXT_MAX, validateProjectNo,
} from '@/lib/semiContact/project'

/**
 * 열 폭. 머리 줄과 행이 이 상수 하나를 함께 쓴다(의뢰서 목록과 같은 방식).
 *   번호·최근 접촉·횟수·생성일·작성 버튼 — 고정 폭 / 고객사·사업장·안건 — 남는 폭을 나눠 쓴다.
 */
const COL = { no: 140, last: 168, count: 64, created: 88, write: 84, gap: 10 }
const FLEX_CUSTOMER = 1
const FLEX_SITE = 0.8
const FLEX_TITLE = 1.4
/** 카드 좌우 여백(16) + 행 좌우 여백(12). 머리는 카드 끝까지 늘이고 글자만 행과 맞춘다. */
const HEAD_PAD = 28

/** 좁은 화면에서는 사업장·생성일 칸을 숨긴다. container-type 이 있어야 @container 가 동작한다. */
const SHELL_CSS = `
  .cs-shell { container-type: inline-size; }
  @container (max-width: 820px) {
    .cs-site, .cs-created { display: none !important; }
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
}

export default function ContactSemiPage() {
  const router = useRouter()
  const { loading: guardLoading, authorized } = usePageGuard()

  /** 고른 팀. null 이면 「전체」. */
  const [team, setTeam] = useState<string | null>(null)
  const [rows, setRows] = useState<ProjectRow[] | null>(null)
  /** 토글 칸 — 사업부가 반도체인 팀 이름(display_order 순). 못 읽으면 빈 목록이라 「전체」만 보인다. */
  const [teams, setTeams] = useState<string[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  /** 올리면 목록을 다시 읽는다(새 Project 를 만든 뒤). */
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!authorized) return
    let cancelled = false
    const load = async () => {
      setBusy(true)
      try {
        const res = await fetch(`/api/semi-contact/projects${team ? `?team=${encodeURIComponent(team)}` : ''}`)
        const json = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) {
          console.error('[contact/semi] Project 목록 조회 실패', { status: res.status, error: json })
          setLoadError(json.error || `목록을 불러오지 못했습니다 (${res.status})`)
          setRows([])
          return
        }
        setLoadError(null)
        setRows((json.projects ?? []) as ProjectRow[])
        setTeams(Array.isArray(json.teams) ? (json.teams as unknown[]).filter((t): t is string => typeof t === 'string') : [])
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
  }, [authorized, team, reloadKey])

  // 검색 — 번호·고객사·사업장/부서·안건 부분 일치, 대소문자 무시. 서버가 정한 순서는 그대로 둔다.
  const words = q.trim().toLowerCase()
  const shown = useMemo(() => {
    if (!rows) return []
    if (!words) return rows
    return rows.filter(r =>
      [r.project_no, r.customer_name, r.site_dept ?? '', r.title].some(v => v.toLowerCase().includes(words)))
  }, [rows, words])


  if (!authorized) return <AccessGate loading={guardLoading} />

  const total = rows?.length ?? null
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

        {/* ── 필터 줄 — 팀 토글 · 검색 · 결과 건수 ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <TeamToggle teams={teams} value={team} onChange={setTeam} />
          <span style={{ position: 'relative', flex: '1 1 240px', minWidth: 200 }}>
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Project 번호, 고객사, 사업장/부서, 안건 검색"
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
          {rows !== null && (
            <span className="num" style={{ marginLeft: 'auto', fontSize: 12, color: MUTED, whiteSpace: 'nowrap' }}>
              결과 {shown.length}건
            </span>
          )}
        </div>

        {/* 표 머리 — 카드 끝까지 늘이고 글자만 행과 맞춘다 */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: COL.gap,
          margin: '0 -16px', padding: `0 ${HEAD_PAD}px 8px`,
          borderBottom: `1px solid ${BORDER}`,
          fontSize: 11, fontWeight: 700, color: MUTED, whiteSpace: 'nowrap',
        }}>
          <span style={{ width: COL.no, flexShrink: 0 }}>{PROJECT_NO_LABEL}</span>
          <span style={{ flex: FLEX_CUSTOMER, minWidth: 0 }}>{FIELD_BY_KEY.customer_name.label}</span>
          <span className="cs-site" style={{ flex: FLEX_SITE, minWidth: 0 }}>{FIELD_BY_KEY.site_dept.label}</span>
          <span style={{ flex: FLEX_TITLE, minWidth: 0 }}>{FIELD_BY_KEY.title.label}</span>
          <span style={{ width: COL.last, flexShrink: 0 }}>최근 접촉</span>
          <span style={{ width: COL.count, flexShrink: 0, textAlign: 'right' }}>접촉 횟수</span>
          <span className="cs-created" style={{ width: COL.created, flexShrink: 0 }}>생성일</span>
          <span style={{ width: COL.write, flexShrink: 0 }} />
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
              style={{ ...rowStyle(i === 0), display: 'flex', alignItems: 'center', gap: COL.gap, cursor: 'pointer' }}
            >
              <span className="num" style={{
                width: COL.no, flexShrink: 0, fontSize: 13, fontWeight: 700, color: TEXT,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }} title={r.project_no}>
                {r.project_no}
              </span>
              <span style={cellText(FLEX_CUSTOMER, TEXT)} title={r.customer_name}>{r.customer_name}</span>
              <span className="cs-site" style={cellText(FLEX_SITE, r.site_dept?.trim() ? SUB : FAINT)} title={r.site_dept ?? undefined}>
                {r.site_dept?.trim() || '-'}
              </span>
              <span style={cellText(FLEX_TITLE, TEXT)} title={r.title}>{r.title}</span>
              <span style={{
                width: COL.last, flexShrink: 0, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {r.last_contact_date ? (
                  <>
                    <span className="num" style={{ color: TEXT }}>{r.last_contact_date}</span>
                    <span style={{ color: FAINT }}> · </span>
                    <span style={{ color: SUB }}>{r.last_contact_author ?? '-'}</span>
                  </>
                ) : <span style={{ color: FAINT }}>-</span>}
              </span>
              <span className="num" style={{ width: COL.count, flexShrink: 0, fontSize: 13, color: r.report_count ? TEXT : FAINT, textAlign: 'right' }}>
                {r.report_count}
              </span>
              <span className="cs-created num" style={{ width: COL.created, flexShrink: 0, fontSize: 12, color: MUTED, whiteSpace: 'nowrap' }}>
                {kstYmd(r.created_at)}
              </span>
              <span style={{ width: COL.write, flexShrink: 0, display: 'flex', justifyContent: 'flex-end' }}>
                <Link
                  href={`/contact/semi/${r.project_id}/write`}
                  onClick={e => e.stopPropagation()}
                  onKeyDown={e => e.stopPropagation()}
                  style={{ ...btnGhost(), padding: '5px 10px', fontSize: 12, textDecoration: 'none' }}
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
      background: NEUTRAL_BG, borderRadius: 6, padding: 3, flexShrink: 0,
    }}>
      <span aria-hidden style={{
        position: 'absolute', top: 3, bottom: 3, left: 3, width: cell,
        background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 5, boxSizing: 'border-box',
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
function cellText(flex: number, color: string) {
  return {
    flex, minWidth: 0, fontSize: 13, color,
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
        if (!fe) setError(json.error || `Project 를 만들지 못했습니다 (${res.status})`)
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
    <ModalOverlay onClose={busy ? () => {} : onClose}>
      <div style={{
        background: CARD_BG, borderRadius: 8, padding: '14px 16px', width: '100%', maxWidth: 500,
        maxHeight: '86vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.22)',
      }}>
        <div style={cardHeader}>
          <span style={cardTitle}>새 Project</span>
        </div>

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
