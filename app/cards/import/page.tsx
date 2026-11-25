'use client'

/**
 * 명함 여러 장 등록 — **검토 화면** (2026-11-25, PC 전용).
 *
 * 시안: 캔버스 「명함 일괄 등록 — 검토 화면 (PC)」 그대로.
 *   상단  올리기 ✓ → 읽기 ✓ → 검토 → 등록 · 「나중에 이어서」
 *   좌    이번 묶음의 쪽 목록(사람 명함은 「이름 · 회사」, 그 밖은 회색 ↳ 줄)
 *   중    그 쪽 이미지 — **브라우저 메모리**의 Blob 이다(서버에 보내지 않았다)
 *   우    읽힌 칸 전부(파란 바탕 = 자동 채움) · 「‹ 이전 · 건너뛰기 · 승인 → 다음」
 *   하단  집계 · 「남은 N건 전부 승인」 · 「다음 20쪽 읽기 →」 또는 「끝내기」
 *
 * ── 승인한 것만 등록된다 ─────────────────────────────────────────────────
 *   읽은 줄은 status='draft' 로 담겨 목록·검색·엑셀에 나오지 않는다.
 *   승인하면 active 가 되고, 건너뛰면 그 줄을 지운다(사건 card_skipped).
 *
 * ── 이미지가 없을 때 ────────────────────────────────────────────────────
 *   새로고침하거나 「이어서」로 들어오면 메모리의 Blob 이 없다. 그때는 글자만 보며
 *   검토한다 — 가운데에 「본인 PDF 의 N쪽을 보며 검토해 주세요」가 선다.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { usePageGuard } from '@/hooks/usePageGuard'
import AccessGate from '@/components/common/AccessGate'
import { useToast } from '@/components/common/Toast'
import { useConfirm } from '@/components/common/confirmContext'
import {
  BLUE, BLUE_BORDER, BLUE_TINT, BORDER, CARD_BG, DANGER, MUTED, NEUTRAL_BG, PAGE_BG, SKELETON, SUB, TEXT,
} from '@/components/common/ui'
import { LABEL_WEIGHT, TEXT_LABEL } from '@/lib/textTokens'
import { R } from '@/lib/radius'
import {
  CARD_FIELDS, FIELD_INPUT_TYPE, FIELD_LABEL, MEMO_MAX, type BusinessCard,
} from '@/lib/businessCard'
import { costLabel } from '@/lib/businessCardBulk'
import { getSession, clearSession, type ImportPage } from '@/lib/cardImportSession'
import {
  REVIEW_LABEL, blockedReason, discardQuestion, pageLabel, pageRangeLabel, readFileName,
  rowLabel, tallyLabel, tallyOf, type ReviewState,
} from '@/lib/cardReview'

/** 뱃지 색 — 시안의 .st.* 를 토큰으로 옮겼다(상태색은 고객사 규칙과 같은 값). */
const BADGE: Record<ReviewState, { bg: string; fg: string }> = {
  approved: { bg: '#dcfce7', fg: '#166534' },
  wait: { bg: NEUTRAL_BG, fg: SUB },
  skipped: { bg: '#fee2e2', fg: '#b91c1c' },
  merged: { bg: '#e0e7ff', fg: '#3730a3' },
  dup: { bg: '#fef3c7', fg: '#92400e' },
  none: { bg: NEUTRAL_BG, fg: MUTED },
  empty: { bg: NEUTRAL_BG, fg: MUTED },
}

/** 합쳐진 면을 알리는 띠의 바탕 — 합침 뱃지와 같은 계열. */
const MERGE_TINT = '#eef2ff'
/** 「건너뛰기」 단추의 테두리 — 고객사 삭제 단추와 같은 값. */
const DANGER_TINT_BORDER = '#fecaca'

const card: React.CSSProperties = {
  background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: R.card,
}
const btn = (kind: 'plain' | 'primary' | 'ghost' | 'danger' = 'plain'): React.CSSProperties => ({
  height: 36, padding: '0 14px', borderRadius: R.control, fontSize: 13, fontWeight: 500,
  fontFamily: 'inherit', cursor: 'pointer',
  border: kind === 'ghost' ? '1px solid transparent' : `1px solid ${kind === 'primary' ? BLUE : kind === 'danger' ? DANGER_TINT_BORDER : BORDER}`,
  background: kind === 'primary' ? BLUE : kind === 'ghost' ? 'transparent' : CARD_BG,
  color: kind === 'primary' ? '#fff' : kind === 'danger' ? DANGER : kind === 'ghost' ? SUB : TEXT,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
})
const labelStyle: React.CSSProperties = {
  fontSize: 12, color: TEXT_LABEL, fontWeight: LABEL_WEIGHT, marginBottom: 4,
}
const field = (auto: boolean): React.CSSProperties => ({
  width: '100%', height: 36, padding: '0 10px', boxSizing: 'border-box',
  border: `1px solid ${auto ? BLUE_BORDER : BORDER}`, borderRadius: R.control,
  background: auto ? BLUE_TINT : CARD_BG, fontSize: 13, color: TEXT,
  outline: 'none', fontFamily: 'inherit',
})

/** 한 쪽의 검토 상태 + 그 쪽이 담은 줄. */
type Row = {
  page: number
  state: ReviewState
  cardId: number | null
  mergedIntoPage: number | null
  /** 편집 중인 값(승인할 때 저장한다). */
  form: Record<string, string>
  /** 사진에서 읽어 채운 칸 — 파랗게 칠한다. */
  auto: Set<string>
}

function Badge({ state }: { state: ReviewState }) {
  const c = BADGE[state]
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: R.tag,
      background: c.bg, color: c.fg, whiteSpace: 'nowrap',
    }}>
      {REVIEW_LABEL[state]}
    </span>
  )
}

function ImportReviewInner() {
  const { loading: guardLoading, authorized } = usePageGuard()
  const router = useRouter()
  const params = useSearchParams()
  const toast = useToast()
  const confirm = useConfirm()

  /** 읽기 단계가 넘겨준 묶음(이미지 포함). 「이어서」로 들어오면 없다. */
  const session = useMemo(() => getSession(), [])
  const batchId = session?.batchId ?? String(params.get('batch') ?? '')

  const [rows, setRows] = useState<Row[]>([])
  const [at, setAt] = useState(0)
  const [loading, setLoading] = useState(true)
  const [schemaMissing, setSchemaMissing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [rotate, setRotate] = useState(0)
  const [big, setBig] = useState(false)

  /** 쪽 → 이미지 주소. 메모리의 Blob 에서 만들고 떠날 때 거둔다. */
  const urls = useRef<Map<number, string>>(new Map())
  useEffect(() => {
    const made = urls.current
    return () => {
      for (const u of made.values()) URL.revokeObjectURL(u)
      made.clear()
    }
  }, [])
  const urlOf = (p: ImportPage | undefined): string | null => {
    if (!p?.blob) return null
    const had = urls.current.get(p.page)
    if (had) return had
    const next = URL.createObjectURL(p.blob)
    urls.current.set(p.page, next)
    return next
  }

  /** 대기 줄을 읽어 와 쪽 목록을 세운다. */
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/cards/import', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'list', import_batch_id: batchId }),
      })
      const json = await res.json() as { ok?: boolean; rows?: BusinessCard[]; error?: string }
      if (!json?.ok) { setSchemaMissing(json?.error ?? '검토 대기를 읽지 못했습니다'); return }

      const drafts = new Map<number, BusinessCard>()
      for (const r of json.rows ?? []) drafts.set(Number(r.import_page ?? -1), r)

      /** 읽기 단계가 넘겨준 쪽이 있으면 그 차례대로, 없으면 대기 줄만 세운다. */
      const pages = session?.pages ?? [...drafts.keys()].sort((a, b) => a - b)
        .map(page => ({ page, blob: null, reason: null, cardId: null, mergedIntoPage: null } as ImportPage))

      const next: Row[] = pages.map(p => {
        const draft = drafts.get(p.page)
        const state: ReviewState = draft ? 'wait'
          : p.reason === 'merged' ? 'merged'
            : p.reason === 'dup' ? 'dup'
              : p.reason === 'empty' ? 'empty'
                : p.reason == null ? 'approved' : 'none'
        const form: Record<string, string> = {}
        const auto = new Set<string>()
        for (const f of CARD_FIELDS) {
          const v = String((draft as unknown as Record<string, unknown> | undefined)?.[f] ?? '')
          form[f] = v
          if (v) auto.add(f)
        }
        return {
          page: p.page, state, cardId: draft?.card_id ?? p.cardId ?? null,
          mergedIntoPage: p.mergedIntoPage, form, auto,
        }
      })
      setRows(next)
      const first = next.findIndex(r => r.state === 'wait')
      setAt(first >= 0 ? first : 0)
    } catch {
      setSchemaMissing('검토 대기를 읽지 못했습니다')
    } finally {
      setLoading(false)
    }
  }, [batchId, session])

  useEffect(() => { void load() }, [load])

  const cur = rows[at]
  const tally = useMemo(() => tallyOf(rows.map(r => r.state)), [rows])
  const fileName = useMemo(
    () => session?.fileName || (batchId ? readFileName(batchId) : null) || '',
    [session, batchId],
  )

  const setField = (f: string, v: string) => {
    setRows(prev => prev.map((r, i) => {
      if (i !== at) return r
      const auto = new Set(r.auto)
      auto.delete(f)
      return { ...r, form: { ...r.form, [f]: v }, auto }
    }))
  }

  /** 다음 대기 줄로. 없으면 그 자리에 머문다. */
  const goNext = useCallback(() => {
    setAt(prev => {
      for (let i = prev + 1; i < rows.length; i++) if (rows[i].state === 'wait') return i
      for (let i = 0; i < rows.length; i++) if (rows[i].state === 'wait') return i
      return Math.min(prev + 1, rows.length - 1)
    })
  }, [rows])

  const approve = useCallback(async () => {
    const row = rows[at]
    if (!row || row.state !== 'wait' || !row.cardId || busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/cards/import', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'approve', card_id: row.cardId, patch: row.form }),
      })
      const json = await res.json() as { ok?: boolean; error?: string }
      if (!json?.ok) { toast.error(json?.error ?? '등록하지 못했습니다'); return }
      setRows(prev => prev.map((r, i) => (i === at ? { ...r, state: 'approved' } : r)))
      goNext()
    } finally {
      setBusy(false)
    }
  }, [rows, at, busy, toast, goNext])

  const skip = useCallback(async () => {
    const row = rows[at]
    if (!row || row.state !== 'wait' || !row.cardId || busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/cards/import', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'skip', card_id: row.cardId }),
      })
      const json = await res.json() as { ok?: boolean; error?: string }
      if (!json?.ok) { toast.error(json?.error ?? '건너뛰지 못했습니다'); return }
      setRows(prev => prev.map((r, i) => (i === at ? { ...r, state: 'skipped', cardId: null } : r)))
      goNext()
    } finally {
      setBusy(false)
    }
  }, [rows, at, busy, toast, goNext])

  const approveAll = async () => {
    if (busy || tally.wait === 0) return
    setBusy(true)
    try {
      const res = await fetch('/api/cards/import', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'approve_all', import_batch_id: batchId }),
      })
      const json = await res.json() as { ok?: boolean; approved?: number; error?: string }
      if (!json?.ok) { toast.error(json?.error ?? '등록하지 못했습니다'); return }
      setRows(prev => prev.map(r => (r.state === 'wait' ? { ...r, state: 'approved' } : r)))
      toast.success(`${json.approved ?? 0}건을 등록했습니다`)
    } finally {
      setBusy(false)
    }
  }

  /** Enter = 승인, ←/→ = 이동. 글자를 치는 중에는 Enter 만 듣는다. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const typing = el != null && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
      if (e.key === 'Enter') { e.preventDefault(); void approve(); return }
      if (typing) return
      if (e.key === 'ArrowLeft') { e.preventDefault(); setAt(p => Math.max(0, p - 1)) }
      if (e.key === 'ArrowRight') { e.preventDefault(); setAt(p => Math.min(rows.length - 1, p + 1)) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [approve, rows.length])

  const leave = () => { clearSession(); router.push('/cards') }

  /**
   * **이 묶음 버리기** — 읽은 글자를 통째로 버리고 목록으로 나간다 (2026-11-25 3차).
   * 승인한 줄은 이미 명함첩에 있으므로 남는다. 대기 줄만 사라진다.
   */
  const discard = async () => {
    if (busy || !batchId) return
    const yes = await confirm({
      title: '이 묶음을 버릴까요?',
      message: discardQuestion(tally.wait),
      confirmText: '버리기', cancelText: '그만두기', variant: 'danger',
    })
    if (!yes) return
    setBusy(true)
    try {
      const res = await fetch('/api/cards/import', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'discard', import_batch_id: batchId }),
      })
      const json = await res.json() as { ok?: boolean; discarded?: number; error?: string }
      if (!json?.ok) { toast.error(json?.error ?? '버리지 못했습니다'); return }
      toast.success(`${json.discarded ?? 0}건을 버렸습니다`)
      leave()
    } finally {
      setBusy(false)
    }
  }

  if (!authorized) return <AccessGate loading={guardLoading} />

  if (schemaMissing) {
    return (
      <main style={{ padding: 24, background: PAGE_BG, minHeight: '100vh' }}>
        <div style={{ ...card, padding: '18px 20px', maxWidth: 620 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: TEXT, marginBottom: 8 }}>검토를 열 수 없습니다</div>
          <div style={{ fontSize: 13, color: SUB, lineHeight: 1.8 }}>{schemaMissing}</div>
          <button type="button" style={{ ...btn(), marginTop: 14 }} onClick={leave}>명함 목록으로</button>
        </div>
      </main>
    )
  }

  const img = session?.pages.find(p => p.page === cur?.page)
  const src = urlOf(img)
  const isPdf = img?.blob?.type === 'application/pdf'
  const from = rows[0]?.page ?? 0
  const to = rows[rows.length - 1]?.page ?? 0
  const blocked = blockedReason(tally)

  return (
    <main style={{
      height: '100vh', background: PAGE_BG, padding: 16, boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      {/* 상단 — 단계 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
        <b style={{ fontSize: 18, color: TEXT }}>여러 장 등록</b>
        <span style={{ fontSize: 12, color: SUB }}>
          {[fileName, session ? `${session.total}쪽` : null].filter(Boolean).join(' · ') || '검토 대기'}
        </span>
        <span style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: SUB }}>
          <Step done>올리기</Step><Line /><Step done>읽기 {rows.length > 0 ? pageRangeLabel(from, to) : ''}</Step>
          <Line /><Step on>검토</Step><Line /><Step>등록</Step>
        </div>
        <span style={{ flex: 1 }} />
        <button type="button" style={btn('danger')} disabled={busy || !batchId}
          onClick={() => void discard()}>이 묶음 버리기</button>
        <button type="button" style={btn('ghost')} onClick={leave}>나중에 이어서</button>
      </div>

      {/* 본문 3단 */}
      <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0 }}>
        {/* 좌 — 쪽 목록 */}
        <div style={{ ...card, width: 250, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{
            padding: '12px 14px', borderBottom: `1px solid ${BORDER}`,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <b style={{ fontSize: 13, color: TEXT }}>{rows.length > 0 ? pageRangeLabel(from, to) : '검토'}</b>
            <span style={{ fontSize: 12, color: SUB }}>명함 {tally.approved + tally.wait + tally.skipped}장</span>
            <span style={{ flex: 1 }} />
            <Badge state="approved" />
          </div>
          <div style={{ padding: 6, display: 'flex', flexDirection: 'column', gap: 1, overflowY: 'auto' }}>
            {loading && <div style={{ padding: 14, fontSize: 12, color: SUB }}>불러오는 중…</div>}
            {rows.map((r, i) => {
              const dim = r.state !== 'wait' && r.state !== 'approved'
              return (
                <button key={r.page} type="button" onClick={() => setAt(i)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, height: 40, padding: '0 10px',
                    borderRadius: R.control, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                    border: `1px solid ${i === at ? BLUE : 'transparent'}`,
                    background: i === at ? BLUE_TINT : 'transparent',
                  }}>
                  <span style={{ width: 26, fontSize: 12, color: MUTED, flexShrink: 0 }}>{r.page + 1}</span>
                  <span style={{
                    flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    fontSize: 13, color: dim ? SUB : TEXT,
                  }}>
                    {rowLabel({ state: r.state, name: r.form.name, company: r.form.company, mergedInto: r.mergedIntoPage })}
                  </span>
                  <Badge state={r.state} />
                </button>
              )
            })}
          </div>
        </div>

        {/* 중 — 쪽 이미지 */}
        <div style={{ ...card, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: NEUTRAL_BG }}>
          <div style={{
            padding: '10px 14px', background: CARD_BG, borderBottom: `1px solid ${BORDER}`,
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <b style={{ fontSize: 13, color: TEXT }}>{cur ? pageLabel(cur.page) : ''}</b>
            <span style={{ fontSize: 12, color: SUB }}>올린 파일에서 바로 보여 줍니다 · 서버에 저장하지 않습니다</span>
            <span style={{ flex: 1 }} />
            <button type="button" style={{ ...btn(), height: 30, fontSize: 12 }}
              onClick={() => setRotate(r => (r + 90) % 360)}>↻ 회전</button>
            <button type="button" style={{ ...btn(), height: 30, fontSize: 12 }}
              onClick={() => setBig(v => !v)}>{big ? '작게' : '⤢ 크게'}</button>
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, overflow: 'auto' }}>
            {src == null ? (
              <div style={{ fontSize: 13, color: SUB, textAlign: 'center', lineHeight: 1.9 }}>
                본인 PDF 의 <b style={{ color: TEXT }}>{cur ? pageLabel(cur.page) : ''}</b>을 보며 검토해 주세요.
                <br />
                <span style={{ fontSize: 12, color: MUTED }}>
                  올린 파일은 저장하지 않으므로, 창을 닫으면 이미지는 남지 않습니다.
                </span>
              </div>
            ) : isPdf ? (
              <iframe title="쪽 이미지" src={src}
                style={{
                  width: big ? '100%' : 620, height: big ? '100%' : 420, border: 'none',
                  transform: `rotate(${rotate}deg)`, background: CARD_BG, borderRadius: R.control,
                }} />
            ) : (
              // 명함 사진은 **메모리의 object URL** 이다 — next/image 가 다룰 수 있는 주소가 아니다.
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="쪽 이미지" src={src}
                style={{
                  maxWidth: big ? '100%' : 620, maxHeight: '100%',
                  transform: `rotate(${rotate}deg)`, borderRadius: R.control,
                  boxShadow: '0 2px 10px rgba(0,0,0,.12)',
                }} />
            )}
          </div>
        </div>

        {/* 우 — 읽힌 칸 */}
        <div style={{ ...card, width: 400, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '12px 14px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 8 }}>
            <b style={{ fontSize: 13, color: TEXT }}>읽힌 내용</b>
            <span style={{ fontSize: 12, color: SUB }}>파란 칸 = 사진에서 읽음 · 바로 고칠 수 있음</span>
          </div>
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto', flex: 1 }}>
            {!cur && <div style={{ fontSize: 13, color: SUB }}>검토할 쪽이 없습니다.</div>}
            {cur && mergedPages(rows, cur.page).length > 0 && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                borderRadius: R.control, background: MERGE_TINT, color: BADGE.merged.fg, fontSize: 12,
              }}>
                ⤶ {mergedPages(rows, cur.page).map(p => pageLabel(p)).join(' · ')}을 이 명함에 합쳤습니다
              </div>
            )}
            {cur && cur.state !== 'wait' && (
              <div style={{ fontSize: 12, color: SUB }}>
                이 쪽은 <b style={{ color: TEXT }}>{REVIEW_LABEL[cur.state]}</b> 입니다 — 고칠 수 없습니다.
              </div>
            )}
            {cur && cur.state === 'wait' && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {(['name', 'name_en', 'position', 'department'] as const).map(f => (
                    <Field key={f} f={f} row={cur} onChange={setField} />
                  ))}
                </div>
                <Field f="company" row={cur} onChange={setField} />
                <Field f="company_en" row={cur} onChange={setField} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {(['mobile', 'phone', 'fax', 'email'] as const).map(f => (
                    <Field key={f} f={f} row={cur} onChange={setField} />
                  ))}
                </div>
                <Field f="address" row={cur} onChange={setField} />
                <Field f="website" row={cur} onChange={setField} />
                <div>
                  <div style={labelStyle}>{FIELD_LABEL.memo}</div>
                  <textarea value={cur.form.memo ?? ''} maxLength={MEMO_MAX}
                    onChange={e => setField('memo', e.target.value)}
                    style={{ ...field(false), height: 56, padding: '8px 10px', resize: 'vertical' }} />
                </div>
              </>
            )}
          </div>
          <div style={{ padding: '12px 14px', borderTop: `1px solid ${BORDER}`, display: 'flex', gap: 8, alignItems: 'center' }}>
            <button type="button" style={{ ...btn('ghost'), padding: '0 8px' }}
              onClick={() => setAt(p => Math.max(0, p - 1))}>‹ 이전</button>
            <span style={{ flex: 1 }} />
            <button type="button" style={btn('danger')} disabled={busy || cur?.state !== 'wait'}
              onClick={() => void skip()}>건너뛰기</button>
            <button type="button" style={{ ...btn('primary'), minWidth: 150 }}
              disabled={busy || cur?.state !== 'wait'} onClick={() => void approve()}>
              승인 → 다음
              <span style={{
                fontSize: 11, border: '1px solid rgba(255,255,255,.5)', borderRadius: R.tag,
                padding: '0 5px', marginLeft: 4,
              }}>Enter</span>
            </button>
          </div>
        </div>
      </div>

      {/* 하단 바 */}
      <div style={{ ...card, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
        <span style={{ fontSize: 13, color: TEXT }}>{tallyLabel(tally)}</span>
        <span style={{ fontSize: 12, color: SUB }}>
          승인한 것만 등록됩니다. 건너뛴 쪽은 요약에 남습니다.
          {session && ` · ${costLabel(session.usage)}`}
        </span>
        <span style={{ flex: 1 }} />
        {blocked && <span style={{ fontSize: 12, color: BADGE.dup.fg }}>{blocked}</span>}
        <button type="button" style={btn()} disabled={busy || tally.wait === 0}
          onClick={() => void approveAll()}>남은 {tally.wait}건 전부 승인</button>
        <button type="button" style={btn('primary')} disabled={busy || blocked != null}
          onClick={async () => {
            if (session && session.rest.length > 0) {
              const ok = await confirm({
                title: '다음 쪽을 읽을까요?',
                message: '남은 쪽은 이 화면에서 바로 읽을 수 없습니다 — 목록으로 돌아가 「여러 장 등록」에서 나머지 파일을 올려 주세요.',
                confirmText: '목록으로', cancelText: '더 검토하기',
              })
              if (!ok) return
            }
            leave()
          }}>
          {session && session.rest.length > 0 ? '등록하고 다음 쪽 읽기 →' : '끝내기'}
        </button>
      </div>
    </main>
  )
}

/** 이 쪽에 합쳐 들어온 면들. */
function mergedPages(rows: readonly Row[], page: number): number[] {
  return rows.filter(r => r.state === 'merged' && r.mergedIntoPage === page).map(r => r.page)
}

function Field({ f, row, onChange }: {
  f: string; row: Row; onChange: (f: string, v: string) => void
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={labelStyle}>{FIELD_LABEL[f as keyof typeof FIELD_LABEL]}</div>
      <input value={row.form[f] ?? ''} type={FIELD_INPUT_TYPE[f as keyof typeof FIELD_INPUT_TYPE] ?? 'text'}
        onChange={e => onChange(f, e.target.value)} style={field(row.auto.has(f))} />
    </div>
  )
}

function Step({ children, on, done }: { children: React.ReactNode; on?: boolean; done?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        width: 22, height: 22, borderRadius: '50%', fontSize: 11, fontWeight: 700,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: done ? BADGE.approved.bg : on ? BLUE : SKELETON,
        color: done ? BADGE.approved.fg : on ? CARD_BG : SUB,
      }}>{done ? '✓' : on ? '3' : '4'}</span>
      <b style={{ color: on || done ? TEXT : SUB, fontWeight: on ? 700 : 500 }}>{children}</b>
    </span>
  )
}

function Line() {
  return <span style={{ width: 18, height: 1, background: BORDER }} />
}

// useSearchParams 는 **Suspense 경계 안에서만** 쓸 수 있다 — 없으면 빌드가 멈춘다.
export default function ImportReviewPage() {
  return (
    <Suspense fallback={null}>
      <ImportReviewInner />
    </Suspense>
  )
}
