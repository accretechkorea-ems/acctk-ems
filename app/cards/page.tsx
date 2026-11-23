'use client'

/**
 * 명함 — 목록 (2026-11-23).
 *
 * 보드 「명함 시안 · PC 목록」·「명함 시안 · 모바일 ①」 그대로.
 *   PC : 표 — 이름 · 회사·부서 · 직급 · 휴대폰 · 이메일 · 사업부 · 등록일(+나이) · 마지막 확인 · 등록자 · [확인]
 *   폰 : 카드 한 줄 — 이름·직급·나이 / 회사·부서 / 휴대폰·등록일·사업부·확인
 *
 * 보드와 다르게 한 곳(규칙이 이긴다)
 *   · 파랑은 보드의 #1e40af 가 아니라 토큰 BLUE(#234ea2)다.
 *   · 나이 꼬리표에 **틴트 배경을 쓰지 않는다** — 디자인 규칙이 「상태색은 dot 으로만,
 *     배지에 틴트 금지」다. 색 점 + 글자로 같은 것을 말한다.
 *
 * 조건은 주소에 남는다(lib/businessCardQuery.ts) — 찾아 둔 목록을 그대로 보낼 수 있게.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { usePageGuard } from '@/hooks/usePageGuard'
import AccessGate from '@/components/common/AccessGate'
import { useToast } from '@/components/common/Toast'
import { useConfirm } from '@/components/common/confirmContext'
import { canSwitchDivision, teamDivisionOf, DIVISIONS } from '@/lib/division'
import { isSuperAdmin } from '@/lib/permissions'
import {
  AGE_TONES, ageLabel, ageTone, daysBetween, defaultDivision, registrarLabel,
  verifiedLabel, visibleDivisions, type BusinessCard, type CardForm,
} from '@/lib/businessCard'
import { applyCardFilter, filterFromQuery, queryFromFilter, type CardFilter } from '@/lib/businessCardQuery'
import { exportCardXlsx } from '@/lib/businessCardExcel'
import CardFormModal from '@/components/cards/CardFormModal'
import { BLUE, BORDER, CARD_BG, MUTED, PAGE_BG, SUB, TEXT } from '@/components/common/ui'
import { LABEL_WEIGHT, TEXT_LABEL } from '@/lib/textTokens'
import { R } from '@/lib/radius'

/**
 * 읽는 칸. 영문 둘은 db/business_cards_en_20261123.sql 로 더한다 —
 * **그 SQL 을 돌리기 전에는 이 select 가 통째로 42703 으로 거절된다.**
 * 그래서 영문 없는 짧은 목록을 함께 두고, 42703 이면 그것으로 다시 읽는다
 * (lib/division.ts 의 TEAM_PERM_COLUMNS_LEGACY 와 같은 길이다 — 칸 하나 때문에
 *  화면 전체가 비는 일을 한 번 겪었다).
 */
const SELECT_BASE = 'card_id, name, company, department, position, mobile, phone, fax, email, address, website, memo, ' +
  'division, registered_at, verified_at, input_method, engineer_id, registered_name, registered_team, registered_div, deleted_at'
const SELECT = `${SELECT_BASE}, name_en, company_en`

const btn = (primary = false): React.CSSProperties => ({
  height: 34, padding: '0 12px', borderRadius: R.control, cursor: 'pointer', fontFamily: 'inherit',
  border: primary ? 'none' : `1px solid ${BORDER}`,
  background: primary ? BLUE : CARD_BG, color: primary ? '#fff' : TEXT,
  fontSize: 13, fontWeight: primary ? 700 : 500, whiteSpace: 'nowrap',
})
const th: React.CSSProperties = {
  padding: '10px 14px', fontSize: 12, fontWeight: LABEL_WEIGHT, color: TEXT_LABEL, textAlign: 'left', whiteSpace: 'nowrap',
}
const td: React.CSSProperties = { padding: '0 14px', fontSize: 13, color: TEXT, whiteSpace: 'nowrap' }

/**
 * 영문 값 — 한글 옆에 **작은 글씨**로. 값이 없으면 **아무것도 그리지 않는다**(자리도 안 쓴다).
 * 색은 안내 글자 토큰 SUB — lib/textTokens.ts 의 TEXT_NOTE 다(값을 직접 적지 않는다).
 */
function En({ value }: { value?: string | null }) {
  const v = String(value ?? '').trim()
  if (!v) return null
  return <span style={{ fontSize: 11, color: SUB, fontWeight: 400, marginLeft: 5 }}>{v}</span>
}

/** 나이 꼬리표 — 색 점 + 글자(틴트 배경은 쓰지 않는다). */
function AgeTag({ registeredAt, today }: { registeredAt: string; today: string }) {
  const days = daysBetween(registeredAt, today)
  const tone = ageTone(days)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: SUB, whiteSpace: 'nowrap' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: AGE_TONES[tone], flexShrink: 0 }} />
      {ageLabel(days)}
    </span>
  )
}

function CardsPageInner() {
  const { engineer: me, loading: guardLoading, authorized } = usePageGuard()
  const supabase = createClient()
  const router = useRouter()
  const params = useSearchParams()
  const toast = useToast()
  const confirm = useConfirm()

  const [rows, setRows] = useState<BusinessCard[]>([])
  const [loading, setLoading] = useState(true)
  const [schemaMissing, setSchemaMissing] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<BusinessCard | null>(null)
  const [busy, setBusy] = useState(false)
  const [narrow, setNarrow] = useState(false)

  const filter = useMemo(() => filterFromQuery(params), [params])
  const today = new Date().toISOString()

  /** 폰이면 카드, 넓으면 표. 보드가 그 둘을 다르게 그렸다. */
  useEffect(() => {
    const check = () => setNarrow(window.innerWidth < 900)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  const load = useCallback(async () => {
    const read = (cols: string) => supabase
      .from('business_cards').select(cols)
      .is('deleted_at', null)
      .order('registered_at', { ascending: false })
      .limit(2000)
    let { data, error } = await read(SELECT)
    // 영문 칸이 아직 없다 — 그 둘만 빼고 다시 읽는다(목록이 비지 않게).
    if (error?.code === '42703') ({ data, error } = await read(SELECT_BASE))
    if (error) {
      // 표가 아직 없으면 화면이 깨지는 대신 무엇을 돌려야 하는지 말해 준다.
      if (error.code === '42P01' || error.code === 'PGRST205') setSchemaMissing(true)
      else console.error('[cards] 목록을 읽지 못했다', error)
      setLoading(false)
      return
    }
    setRows((data ?? []) as unknown as BusinessCard[])
    setLoading(false)
  }, [supabase])

  useEffect(() => { void load() }, [load])

  const canSwitch = canSwitchDivision(me)
  const allowed = useMemo(
    () => visibleDivisions({ canSwitch, teamDivision: teamDivisionOf(me) }),
    [canSwitch, me],
  )
  const shown = useMemo(() => applyCardFilter(rows, filter, allowed), [rows, filter, allowed])

  /** 조건을 주소에 적는다 — 새로고침·공유에도 같은 화면이 뜬다. */
  const setFilter = (next: Partial<CardFilter>) => {
    router.replace(`/cards${queryFromFilter({ ...filter, ...next })}`, { scroll: false })
  }

  /** 등록자 목록 — 지금 보이는 명함에서 뽑는다(없는 사람을 고르게 하지 않는다). */
  const registrars = useMemo(() => {
    const m = new Map<number, string>()
    for (const c of rows) {
      const id = Number(c.engineer_id ?? 0)
      if (id > 0 && !m.has(id)) m.set(id, (c.registered_name ?? '').trim() || `#${id}`)
    }
    return [...m].sort((a, b) => a[1].localeCompare(b[1], 'ko'))
  }, [rows])

  const call = async (body: Record<string, unknown>): Promise<boolean> => {
    setBusy(true)
    try {
      const res = await fetch('/api/business-card', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) { toast.error((json?.error as string) ?? `실패했습니다 (${res.status})`); return false }
      return true
    } catch (e) {
      console.error('[cards] 보내지 못했다', e)
      toast.error('네트워크 오류로 보내지 못했습니다')
      return false
    } finally {
      setBusy(false)
    }
  }

  const save = async (form: CardForm) => {
    const patch: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(form)) {
      if (k === 'division' || k === 'input_method') continue
      patch[k] = v
    }
    const ok = editing
      ? await call({ action: 'update', card_id: editing.card_id, patch, division: form.division })
      : await call({ action: 'create', patch, division: form.division, input_method: form.input_method })
    if (!ok) return
    setFormOpen(false)
    setEditing(null)
    await load()
    toast.success(editing ? '고쳤습니다' : `${form.name} 명함을 담았습니다`)
  }

  const verify = async (card: BusinessCard) => {
    if (!await call({ action: 'verify', card_id: card.card_id })) return
    await load()
    toast.success(`${card.name} — 오늘 확인으로 적었습니다`)
  }

  const remove = async (card: BusinessCard) => {
    const ok = await confirm({
      title: '명함 삭제', message: `${card.name} 명함을 지우시겠습니까? 되돌릴 수 있습니다.`,
      confirmText: '삭제', variant: 'danger',
    })
    if (!ok) return
    if (!await call({ action: 'delete', card_id: card.card_id, reason: '목록에서 삭제' })) return
    setFormOpen(false); setEditing(null)
    await load()
    toast.success('지웠습니다')
  }

  const openNew = () => { setEditing(null); setFormOpen(true) }
  const openCard = (c: BusinessCard) => { setEditing(c); setFormOpen(true) }

  if (!authorized) return <AccessGate loading={guardLoading} />

  if (schemaMissing) {
    return (
      <main style={{ padding: 24, background: PAGE_BG, minHeight: '100vh' }}>
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: R.card, padding: '18px 20px', maxWidth: 560 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: TEXT, marginBottom: 8 }}>명함 표가 아직 없습니다</div>
          <div style={{ fontSize: 13, color: SUB, lineHeight: 1.8 }}>
            <code>db/business_cards_20261123.sql</code> 을 먼저 적용해 주세요.
          </div>
        </div>
      </main>
    )
  }

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <b style={{ fontSize: 18, color: TEXT, letterSpacing: '-0.3px' }}>명함</b>
      <span style={{ fontSize: 12, color: SUB }}>전사 · {shown.length}장</span>
      <span style={{ flex: 1 }} />
      <input
        value={filter.q}
        onChange={e => setFilter({ q: e.target.value })}
        placeholder="이름 · 회사 · 부서 · 전화 · 이메일"
        style={{
          width: narrow ? '100%' : 300, height: 34, padding: '0 10px', boxSizing: 'border-box',
          border: `1px solid ${BORDER}`, borderRadius: R.control, fontSize: 13, color: TEXT,
          background: CARD_BG, outline: 'none', fontFamily: 'inherit',
        }} />
      {allowed.length > 1 && (
        <select value={filter.division} onChange={e => setFilter({ division: e.target.value })} style={btn()}>
          <option value="">사업부 전체</option>
          {DIVISIONS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      )}
      <select value={filter.engineerId || ''} onChange={e => setFilter({ engineerId: Number(e.target.value) || 0 })} style={btn()}>
        <option value="">등록자 전체</option>
        {registrars.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select>
      {!narrow && (
        <>
          <input type="date" value={filter.from} onChange={e => setFilter({ from: e.target.value })} style={{ ...btn(), padding: '0 8px' }} />
          <span style={{ color: MUTED, fontSize: 12 }}>~</span>
          <input type="date" value={filter.to} onChange={e => setFilter({ to: e.target.value })} style={{ ...btn(), padding: '0 8px' }} />
          <button type="button" style={btn()} onClick={() => void exportCardXlsx(shown, today)}>⬇ 엑셀</button>
          <button type="button" style={btn(true)} onClick={openNew}>＋ 명함 등록</button>
        </>
      )}
    </div>
  )

  return (
    <main style={{ padding: narrow ? '12px 12px 96px' : 16, background: PAGE_BG, minHeight: '100vh', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {header}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: SUB, fontSize: 13 }}>불러오는 중…</div>
      ) : shown.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: SUB, fontSize: 13 }}>
          {rows.length === 0 ? '담긴 명함이 없습니다 — 「＋ 명함 등록」으로 시작하세요' : '조건에 맞는 명함이 없습니다'}
        </div>
      ) : narrow ? (
        /* ── 폰 — 카드 한 줄(보드 ①) ── */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {shown.map(c => (
            <button key={c.card_id} type="button" onClick={() => openCard(c)}
              style={{
                background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: R.card, padding: '12px 14px',
                display: 'flex', flexDirection: 'column', gap: 3, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <b style={{ fontSize: 15, color: TEXT }}>{c.name}<En value={c.name_en} /></b>
                <span style={{ fontSize: 12, color: SUB }}>{c.position ?? ''}</span>
                <span style={{ flex: 1 }} />
                <AgeTag registeredAt={c.registered_at} today={today} />
              </div>
              <div style={{ fontSize: 13, color: TEXT_LABEL }}>
                {[c.company, c.department].filter(Boolean).join(' · ') || '—'}
                <En value={c.company_en} />
              </div>
              <div style={{ fontSize: 12, color: SUB, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {c.mobile && <span style={{ color: BLUE }}>{c.mobile}</span>}
                <span>등록 {String(c.registered_at).slice(0, 10)}</span>
                <span>{c.division}</span>
                {verifiedLabel(c.verified_at) && <span>{verifiedLabel(c.verified_at)}</span>}
              </div>
            </button>
          ))}
        </div>
      ) : (
        /* ── PC — 표(보드) ── */
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: R.card, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                <th style={th}>이름</th><th style={th}>회사 · 부서</th><th style={th}>직급</th>
                <th style={th}>휴대폰</th><th style={th}>이메일</th><th style={th}>사업부</th>
                <th style={th}>등록일</th><th style={th}>마지막 확인</th><th style={th}>등록자</th><th style={th} />
              </tr>
            </thead>
            <tbody>
              {shown.map(c => (
                <tr key={c.card_id} style={{ height: 44, borderTop: `1px solid ${BORDER}`, cursor: 'pointer' }}
                  onClick={() => openCard(c)}>
                  <td style={td}><b>{c.name}</b><En value={c.name_en} /></td>
                  <td style={{ ...td, whiteSpace: 'normal' }}>
                    {[c.company, c.department].filter(Boolean).join(' · ') || '—'}
                    <En value={c.company_en} />
                  </td>
                  <td style={td}>{c.position ?? '—'}</td>
                  <td style={{ ...td, color: BLUE }}>
                    {c.mobile ? <a href={`tel:${c.mobile}`} onClick={e => e.stopPropagation()} style={{ color: BLUE, textDecoration: 'none' }}>{c.mobile}</a> : '—'}
                  </td>
                  <td style={td}>
                    {c.email ? <a href={`mailto:${c.email}`} onClick={e => e.stopPropagation()} style={{ color: TEXT, textDecoration: 'none' }}>{c.email}</a> : '—'}
                  </td>
                  <td style={td}>{c.division}</td>
                  <td style={td}>
                    {String(c.registered_at).slice(0, 10)}{' '}
                    <AgeTag registeredAt={c.registered_at} today={today} />
                  </td>
                  <td style={{ ...td, color: c.verified_at ? TEXT : SUB }}>
                    {c.verified_at ? String(c.verified_at).slice(0, 10) : '—'}
                  </td>
                  <td style={td}>{registrarLabel(c)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button type="button" onClick={e => { e.stopPropagation(); void verify(c) }} disabled={busy}
                      style={{ ...btn(), height: 28, fontSize: 12 }}>확인</button>
                    {isSuperAdmin(me) && (
                      <button type="button" onClick={e => { e.stopPropagation(); void remove(c) }} disabled={busy}
                        style={{ ...btn(), height: 28, fontSize: 12, marginLeft: 6, color: '#dc2626', borderColor: '#fecaca' }}>삭제</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!narrow && (
        <div style={{ fontSize: 12, color: SUB, lineHeight: 1.8 }}>
          「확인」 = 아직 그 회사·부서·직급에 있는 걸 확인했을 때 누릅니다 → 마지막 확인 날짜가 갱신됩니다(등록일은 그대로).
          1년 넘으면 주황, 3년 넘으면 빨강. 줄을 누르면 고칠 수 있습니다.
        </div>
      )}

      {/* 폰 — 우하단 고정 버튼(보드 ①) */}
      {narrow && (
        <button type="button" onClick={openNew}
          style={{
            position: 'fixed', right: 16, bottom: 16, height: 48, padding: '0 18px', borderRadius: R.pill,
            background: BLUE, color: '#fff', border: 'none', fontWeight: 700, fontSize: 14, cursor: 'pointer',
            boxShadow: '0 6px 16px rgba(35,78,162,0.35)', fontFamily: 'inherit', zIndex: 20,
          }}>
          ＋ 명함 등록
        </button>
      )}

      {formOpen && (
        <CardFormModal
          key={editing?.card_id ?? 'new'}
          initial={editing}
          existing={rows}
          defaultDivision={defaultDivision(me)}
          busy={busy}
          onSave={form => void save(form)}
          onOpenExisting={c => { setEditing(c) }}
          onClose={() => { setFormOpen(false); setEditing(null) }}
        />
      )}
    </main>
  )
}

// useSearchParams 는 **Suspense 경계 안에서만** 쓸 수 있다 — 없으면 빌드가 멈춘다
// (prerender 중 "should be wrapped in a suspense boundary"). 다른 화면과 같은 패턴이다.
export default function CardsPage() {
  return (
    <Suspense fallback={null}>
      <CardsPageInner />
    </Suspense>
  )
}
