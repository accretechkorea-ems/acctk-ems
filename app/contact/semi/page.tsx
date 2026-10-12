'use client'

// 반도체 고객 접촉 보고 — Project 목록(껍데기).
//
// 지금 있는 것: 목록 + 「새 Project」(모달 → POST /api/semi-contact/project 가 번호 발급과 저장을 한다).
// 행을 눌러 들어갈 Project 상세·보고서 작성·엑셀은 다음 단계에서 붙인다. 검색·필터·페이지 나누기도 그때
// 의뢰서 목록(app/inquiries/page.tsx, lib/paging.ts)의 방식을 따라 넣는다.
//
// 진입 — 메뉴 키 contact_semi(lib/menuPerms.ts). usePageGuard 가 경로로 키를 찾아 판정하고,
// 권한이 없으면 AccessGate 를 그린다(주소로 직접 들어와도 같다).
//
// 목록은 브라우저 supabase 클라이언트(로그인 세션)로 직접 읽는다. RLS(semi_projects_select)가
// has_menu_perm('contact_semi') 로 걸러 주므로 화면이 따로 거르지 않는다(semi_contact_schema.sql).
// 칸 이름(고객사·사업장/부서·Project/구매안건)은 필드 등록표(lib/semiContact)에서 읽는다 — 엑셀·작성 화면과 같은 이름.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { usePageGuard } from '@/hooks/usePageGuard'
import AccessGate from '@/components/common/AccessGate'
import ModalOverlay from '@/components/common/ModalOverlay'
import { useToast } from '@/components/common/Toast'
import { FieldError, errBorder, useFieldErrors } from '@/components/common/fieldErrors'
import {
  PAGE_BG, CARD_BG, BORDER, TEXT, MUTED, SUB, FAINT,
  cardStyle, cardHeader, cardTitle, countBadge, rowStyle, btnPrimary, btnGhost,
} from '@/components/common/ui'
import { kstYmd } from '@/lib/date'
import { errorInfo } from '@/lib/errorInfo'
import { FIELD_BY_KEY, emptyInput, validateReport, type FieldKey } from '@/lib/semiContact'
import { PROJECT_KEYS, PROJECT_TEXT_MAX } from '@/lib/semiContact/project'

/** 한 번에 읽는 최대 행 수. 페이지 나누기를 붙이기 전까지의 안전 상한이다. */
const LIST_LIMIT = 200

/**
 * 열 폭. 머리 줄과 행이 이 상수 하나를 함께 쓴다(의뢰서 목록과 같은 방식).
 *   번호·작성자·등록일 — 고정 폭 / 고객사·사업장·안건 — 남는 폭을 나눠 쓴다.
 */
const COL = { no: 128, author: 96, date: 92, write: 92, gap: 10 }
const FLEX_CUSTOMER = 1
const FLEX_SITE = 0.8
const FLEX_TITLE = 1.6
/** 카드 좌우 여백(16) + 행 좌우 여백(12). 머리는 카드 끝까지 늘이고 글자만 행과 맞춘다. */
const HEAD_PAD = 28

/** 좁은 화면에서는 사업장·작성자 칸을 숨긴다. container-type 이 있어야 @container 가 동작한다. */
const SHELL_CSS = `
  .cs-shell { container-type: inline-size; }
  @container (max-width: 720px) {
    .cs-site, .cs-author { display: none !important; }
  }
`

type ProjectRow = {
  project_id: number
  project_no: string
  customer_name: string
  site_dept: string | null
  title: string
  created_at: string
  engineers: { name: string | null } | null
}

const SELECT = 'project_id, project_no, customer_name, site_dept, title, created_at, engineers(name)'

export default function ContactSemiPage() {
  const supabase = useMemo(() => createClient(), [])
  const { loading: guardLoading, authorized } = usePageGuard()

  const [rows, setRows] = useState<ProjectRow[] | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  /** 올리면 목록을 다시 읽는다(새 Project 를 만든 뒤). */
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!authorized) return
    let cancelled = false
    const load = async () => {
      // 최근 번호가 위로. 순번이 1000 을 넘으면 문자열 정렬이 어긋나므로 project_no 가 아니라
      // (period_year, seq) 숫자 칸으로 정렬한다(semi_contact_schema.sql 의 설명).
      const { data, error, count } = await supabase
        .from('semi_projects')
        .select(SELECT, { count: 'exact' })
        .order('period_year', { ascending: false })
        .order('seq', { ascending: false })
        .limit(LIST_LIMIT)
      if (cancelled) return
      if (error) {
        console.error('[contact/semi] Project 목록 조회 실패', errorInfo(error))
        setLoadError(error.message || '알 수 없는 오류')
        setRows([])
        return
      }
      setLoadError(null)
      setRows((data ?? []) as unknown as ProjectRow[])
      setTotal(count ?? null)
    }
    load()
    return () => { cancelled = true }
  }, [authorized, supabase, reloadKey])

  if (!authorized) return <AccessGate loading={guardLoading} />

  const shown = rows?.length ?? 0
  const truncated = total !== null && total > shown

  return (
    <main style={{ padding: '24px 28px', background: PAGE_BG, minHeight: '100vh' }}>
      <style>{SHELL_CSS}</style>

      <div className="cs-shell" style={cardStyle}>
        <div style={cardHeader}>
          <span style={{ ...cardTitle, fontSize: 20 }}>접촉 보고서</span>
          {total !== null && <span style={countBadge}>Project {total}건</span>}
          {truncated && (
            <span style={{ fontSize: 12, color: MUTED }}>최근 {shown}건만 보입니다</span>
          )}
          <button
            type="button"
            onClick={() => setCreating(true)}
            style={{ ...btnPrimary(), marginLeft: 'auto' }}
          >
            새 Project
          </button>
        </div>

        {/* 표 머리 — 카드 끝까지 늘이고 글자만 행과 맞춘다 */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: COL.gap,
          margin: '0 -16px', padding: `0 ${HEAD_PAD}px 8px`,
          borderBottom: `1px solid ${BORDER}`,
          fontSize: 11, fontWeight: 700, color: MUTED, whiteSpace: 'nowrap',
        }}>
          <span style={{ width: COL.no, flexShrink: 0 }}>Project 번호</span>
          <span style={{ flex: FLEX_CUSTOMER, minWidth: 0 }}>{FIELD_BY_KEY.customer_name.label}</span>
          <span className="cs-site" style={{ flex: FLEX_SITE, minWidth: 0 }}>{FIELD_BY_KEY.site_dept.label}</span>
          <span style={{ flex: FLEX_TITLE, minWidth: 0 }}>{FIELD_BY_KEY.title.label}</span>
          <span className="cs-author" style={{ width: COL.author, flexShrink: 0 }}>작성자</span>
          <span style={{ width: COL.date, flexShrink: 0 }}>등록일</span>
          <span style={{ width: COL.write, flexShrink: 0 }} />
        </div>

        {loadError ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#ef4444', fontSize: 13, fontWeight: 700, lineHeight: 1.7 }}>
            목록을 불러오지 못했습니다<br />
            <span style={{ fontSize: 12, fontWeight: 500 }}>{loadError}</span>
          </div>
        ) : rows === null ? (
          <div style={{ textAlign: 'center', padding: 40, color: MUTED, fontSize: 13 }}>불러오는 중...</div>
        ) : rows.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: MUTED, fontSize: 13, lineHeight: 1.7 }}>
            등록된 Project가 없습니다
          </div>
        ) : (
          rows.map((r, i) => (
            // Project 상세 화면은 아직 없다 — 행 자체는 누를 곳이 없고, 끝의 「보고서 작성」만 작성 화면으로 간다.
            <div
              key={r.project_id}
              style={{ ...rowStyle(i === 0), display: 'flex', alignItems: 'center', gap: COL.gap }}
            >
              <span className="num" style={{
                width: COL.no, flexShrink: 0, fontSize: 13, fontWeight: 700, color: TEXT,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {r.project_no}
              </span>
              <span style={cellText(FLEX_CUSTOMER, TEXT)} title={r.customer_name}>
                {r.customer_name}
              </span>
              <span className="cs-site" style={cellText(FLEX_SITE, r.site_dept?.trim() ? SUB : FAINT)} title={r.site_dept ?? undefined}>
                {r.site_dept?.trim() || '-'}
              </span>
              <span style={cellText(FLEX_TITLE, TEXT)} title={r.title}>
                {r.title}
              </span>
              <span className="cs-author" style={{
                width: COL.author, flexShrink: 0, fontSize: 12, color: SUB,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {r.engineers?.name ?? '-'}
              </span>
              <span className="num" style={{ width: COL.date, flexShrink: 0, fontSize: 12, color: MUTED, whiteSpace: 'nowrap' }}>
                {kstYmd(r.created_at)}
              </span>
              <span style={{ width: COL.write, flexShrink: 0, display: 'flex', justifyContent: 'flex-end' }}>
                <Link
                  href={`/contact/semi/${r.project_id}/write`}
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

// ── 새 Project 모달 ─────────────────────────────────────────────────
// 의뢰서의 「기존 번호 등록」 모달(app/inquiries/page.tsx)과 같은 틀이다.
// 받는 칸은 등록표에서 storage 가 'project' 인 것뿐(고객사·사업장/부서·Project/구매안건).
// 번호는 화면이 미리 보여 주지 않는다 — 저장할 때 서버가 발급한다(미리 보여 준 번호는 다른 사람이 먼저 가져갈 수 있다).

const fieldStyle: React.CSSProperties = {
  width: '100%', padding: '9px 10px', border: `1px solid ${BORDER}`, borderRadius: 6,
  fontSize: 13, color: TEXT, background: CARD_BG, outline: 'none', boxSizing: 'border-box',
  fontFamily: 'inherit',
}
const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: MUTED, marginBottom: 5, display: 'block',
}

/** 등록표 검증에서 Project 칸의 오류만 골라낸다(라우트와 같은 규칙). */
function projectErrors(values: Record<FieldKey, string>): Partial<Record<FieldKey, string>> {
  const checked = validateReport(values, [], { noAction: true })
  const out: Partial<Record<FieldKey, string>> = {}
  for (const k of PROJECT_KEYS) if (checked.errors[k]) out[k] = checked.errors[k]
  return out
}

function NewProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast()
  const [values, setValues] = useState<Record<FieldKey, string>>(() => emptyInput())
  const { errors, setErrors, clearError, validate } = useFieldErrors<FieldKey>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const change = (k: FieldKey, v: string) => {
    setValues(prev => ({ ...prev, [k]: v.slice(0, PROJECT_TEXT_MAX) }))
    clearError(k)
  }

  const submit = async () => {
    if (busy) return
    if (!validate(projectErrors(values))) return
    setBusy(true)
    setError('')
    try {
      const body: Record<string, string> = {}
      for (const k of PROJECT_KEYS) body[k] = values[k]
      const res = await fetch('/api/semi-contact/project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        // 칸별 오류는 그 칸 아래에, 나머지는 모달 아래 상자에 보인다.
        if (json.fieldErrors && typeof json.fieldErrors === 'object') setErrors(json.fieldErrors)
        setError(json.error || `Project 를 만들지 못했습니다 (${res.status})`)
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

  return (
    <ModalOverlay onClose={busy ? () => {} : onClose}>
      <div style={{
        background: CARD_BG, borderRadius: 8, padding: '14px 16px', width: '100%', maxWidth: 500,
        maxHeight: '86vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.22)',
      }}>
        <div style={cardHeader}>
          <span style={cardTitle}>새 Project</span>
        </div>

        <div style={{ fontSize: 12, color: SUB, lineHeight: 1.6, marginBottom: 12 }}>
          Project 번호(PRJ-연도-순번)는 저장할 때 발급됩니다.
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
              <input
                id={id}
                value={values[k]}
                maxLength={PROJECT_TEXT_MAX}
                onChange={e => change(k, e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit() }}
                disabled={busy}
                style={{ ...fieldStyle, border: errors[k] ? errBorder : fieldStyle.border }}
              />
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

/** 남는 폭을 나눠 쓰는 글자 칸. 한 줄로 자르고 넘치면 말줄임. */
function cellText(flex: number, color: string) {
  return {
    flex, minWidth: 0, fontSize: 13, color,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  } as const
}
