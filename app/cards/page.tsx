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
  checkedLabel, COMPANY_PHONE_MARK, displayPhone, visibleDivisions, type BusinessCard, type CardForm,
} from '@/lib/businessCard'
import { applyCardFilter, countUnchecked, filterFromQuery, isUnchecked, queryFromFilter, type CardFilter } from '@/lib/businessCardQuery'
import { canDeleteCard, selectionTitle, skippedNotice } from '@/lib/businessCardBulk'
import { exportCardXlsx } from '@/lib/businessCardExcel'
import CardFormModal from '@/components/cards/CardFormModal'
import BulkImportModal from '@/components/cards/BulkImportModal'
// 선택 띠의 가름선 — 고객사 목록의 선택 바와 **같은 값**을 그대로 쓴다(새 색을 만들지 않는다).
import { BAR_LINE } from '@/components/home/list/BulkBar'
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
/**
 * 읽어 볼 차례 — **긴 것부터**. 42703 이 나면 다음 것으로 내려간다.
 * 칸이 더 생길 때마다 맨 앞에 한 줄을 더하면 된다(SQL 적용 전에도 목록이 뜬다).
 */
const SELECT_TRIES = [
  `${SELECT_BASE}, name_en, company_en, import_batch_id`,
  `${SELECT_BASE}, name_en, company_en`,
  SELECT_BASE,
] as const

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
  /** 여러 장 등록 창 — PDF·사진 묶음을 읽어 바로 담는다(2026-11-24). */
  const [bulkOpen, setBulkOpen] = useState(false)
  const [narrow, setNarrow] = useState(false)
  /** 고른 명함 — 선택 삭제(2026-11-25). */
  const [picked, setPicked] = useState<Set<number>>(new Set())
  /** 폰에서는 체크칸을 늘 두지 않는다 — 「선택」을 눌러야 나온다. */
  const [picking, setPicking] = useState(false)

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
    // 아직 없는 칸이 섞여 있으면 42703 으로 **조회 전체가 거절된다** — 짧은 것으로 내려간다.
    let { data, error } = await read(SELECT_TRIES[0])
    for (let i = 1; i < SELECT_TRIES.length && error?.code === '42703'; i++) {
      ({ data, error } = await read(SELECT_TRIES[i]))
    }
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
  /** 확인 전 몇 건 — 조건과 무관하게 「이 사람에게 몇 건 남았나」를 센다. */
  const unchecked = useMemo(() => countUnchecked(rows, allowed), [rows, allowed])

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

  /** 가져오기 묶음 — 최근 10개(날짜·건수). 묶음 칸이 없으면 빈 목록이다. */
  const batches = useMemo(() => {
    const m = new Map<string, { count: number; day: string }>()
    for (const c of rows) {
      const id = String(c.import_batch_id ?? '')
      if (!id) continue
      const day = String(c.registered_at ?? '').slice(0, 10)
      const had = m.get(id)
      if (had) { had.count += 1; if (day > had.day) had.day = day }
      else m.set(id, { count: 1, day })
    }
    return [...m].sort((a, b) => b[1].day.localeCompare(a[1].day)).slice(0, 10)
  }, [rows])

  /** 고른 줄 가운데 **내가 지울 수 있는 것**과 그렇지 못한 수. */
  const pickedRows = useMemo(() => shown.filter(c => picked.has(c.card_id)), [shown, picked])
  const deletable = useMemo(() => pickedRows.filter(c => canDeleteCard(me, c)), [pickedRows, me])
  const skipped = pickedRows.length - deletable.length

  /** 보이는 줄이 모두 골라졌나 — 머리글 체크칸의 상태. */
  const allPicked = shown.length > 0 && shown.every(c => picked.has(c.card_id))
  const toggleAll = () => {
    setPicked(allPicked ? new Set() : new Set(shown.map(c => c.card_id)))
  }
  const togglePick = (id: number) => {
    setPicked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** 고른 줄을 지운다 — 권한 밖은 빼고, 서버가 한 번 더 센다. */
  const deletePicked = async () => {
    if (deletable.length === 0) return
    const yes = await confirm({
      title: `명함 ${deletable.length}건을 지울까요?`,
      message: [
        '지운 명함은 목록에서 사라집니다.',
        skippedNotice(skipped),
      ].filter(Boolean).join('\n'),
      confirmText: '삭제',
      cancelText: '그대로 두기',
      variant: 'danger',
    })
    if (!yes) return
    setBusy(true)
    try {
      const res = await fetch('/api/cards/delete', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'cards', card_ids: deletable.map(c => c.card_id) }),
      })
      const json = await res.json() as { ok?: boolean; deleted?: number; skipped?: number; error?: string }
      if (!json?.ok) { toast.error(json?.error ?? '지우지 못했습니다'); return }
      toast.success(`${json.deleted ?? 0}건을 지웠습니다`)
      setPicked(new Set())
      await load()
    } catch {
      toast.error('지우지 못했습니다')
    } finally {
      setBusy(false)
    }
  }

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
      {/* 확인 전 — 여러 장 등록으로 담은 줄이 여기 모인다. 0건이면 칩을 두지 않는다. */}
      {unchecked > 0 && (
        <button type="button"
          onClick={() => setFilter({ checked: filter.checked === 'none' ? '' : 'none' })}
          style={{
            ...btn(), borderRadius: R.pill,
            border: `1px solid ${filter.checked === 'none' ? BLUE : BORDER}`,
            color: filter.checked === 'none' ? BLUE : SUB,
            fontWeight: 700,
          }}>
          확인 전 {unchecked}건
        </button>
      )}
      {!narrow && (
        <>
          <input type="date" value={filter.from} onChange={e => setFilter({ from: e.target.value })} style={{ ...btn(), padding: '0 8px' }} />
          <span style={{ color: MUTED, fontSize: 12 }}>~</span>
          <input type="date" value={filter.to} onChange={e => setFilter({ to: e.target.value })} style={{ ...btn(), padding: '0 8px' }} />
          <button type="button" style={btn()} onClick={() => void exportCardXlsx(shown, today)}>⬇ 엑셀</button>
          <button type="button" style={btn()} onClick={() => setBulkOpen(true)}>여러 장 등록</button>
          <button type="button" style={btn(true)} onClick={openNew}>＋ 명함 등록</button>
        </>
      )}
      {/* 가져오기 묶음 — 최근 10개. 묶음이 없으면 칸을 두지 않는다. */}
      {batches.length > 0 && (
        <select value={filter.batch} onChange={e => { setPicked(new Set()); setFilter({ batch: e.target.value }) }} style={btn()}>
          <option value="">가져오기 전체</option>
          {batches.map(([id, b]) => (
            <option key={id} value={id}>{b.day} · {b.count}건</option>
          ))}
        </select>
      )}
      {/* 폰에서도 열 수 있게 — 날짜·엑셀은 넓은 화면에서만이지만 이 길은 둔다. */}
      {narrow && (
        <>
          <button type="button" style={btn()} onClick={() => setBulkOpen(true)}>여러 장 등록</button>
          <button type="button" style={btn(picking)}
            onClick={() => { setPicking(v => !v); setPicked(new Set()) }}>
            {picking ? '선택 끝' : '선택'}
          </button>
        </>
      )}
    </div>
  )

  return (
    <main style={{ padding: narrow ? '12px 12px 96px' : 16, background: PAGE_BG, minHeight: '100vh', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {header}

      {/* 고른 것이 있으면 검은 띠 — 고객사 목록의 선택 바와 같은 모양이다. */}
      {picked.size > 0 && (
        <div className="ems-bulk-bar"
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px',
            background: TEXT, color: CARD_BG, fontSize: 12, flexWrap: 'wrap', flexShrink: 0,
            borderRadius: R.control,
          }}>
          <b style={{ fontWeight: 700 }}>{selectionTitle(picked.size)}</b>
          {skipped > 0 && (
            <span style={{ color: MUTED }}>{skippedNotice(skipped)}</span>
          )}
          <span style={{ width: 1, height: 16, background: BAR_LINE, margin: '0 4px' }} />
          <button type="button" disabled={busy || deletable.length === 0}
            title={deletable.length === 0 ? '지울 수 있는 명함이 없습니다' : '고른 명함을 지웁니다'}
            onClick={() => void deletePicked()}
            style={{
              height: 26, padding: '0 10px', borderRadius: R.icon,
              border: `1px solid ${BAR_LINE}`, background: 'transparent',
              color: busy || deletable.length === 0 ? MUTED : CARD_BG,
              fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
              cursor: busy || deletable.length === 0 ? 'not-allowed' : 'pointer',
            }}>
            삭제
          </button>
          <button type="button" onClick={() => setPicked(new Set())}
            style={{
              height: 26, padding: '0 10px', borderRadius: R.icon,
              border: `1px solid ${BAR_LINE}`, background: 'transparent', color: CARD_BG,
              fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
            }}>
            선택 해제
          </button>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: SUB, fontSize: 13 }}>불러오는 중…</div>
      ) : shown.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: SUB, fontSize: 13 }}>
          {rows.length === 0 ? '담긴 명함이 없습니다 — 「＋ 명함 등록」으로 시작하세요' : '조건에 맞는 명함이 없습니다'}
        </div>
      ) : narrow ? (
        /* ── 폰 — 카드 한 줄(보드 ①) ── */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* 폰에서 「선택」을 켜면 머리줄에 전체 고르기가 선다. */}
          {picking && shown.length > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: TEXT_LABEL, padding: '2px 2px' }}>
              <input type="checkbox" checked={allPicked} onChange={toggleAll} style={{ cursor: 'pointer' }} />
              모두 고르기
            </label>
          )}
          {shown.map(c => (
            <div key={c.card_id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {picking && (
                <input type="checkbox" checked={picked.has(c.card_id)}
                  onChange={() => togglePick(c.card_id)}
                  aria-label={`${c.name} 고르기`} style={{ cursor: 'pointer', flexShrink: 0 }} />
              )}
            <button type="button" onClick={() => openCard(c)}
              style={{
                flex: 1, minWidth: 0,
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
                {/* 휴대폰이 없으면 회사 전화를 대신. 둘 다 없으면 아무것도 적지 않는다. */}
                {(() => {
                  const got = displayPhone(c)
                  if (!got) return null
                  return (
                    <span style={{ color: BLUE }}>
                      {got.isCompany && (
                        <span style={{ color: SUB, marginRight: 3 }}>{COMPANY_PHONE_MARK}</span>
                      )}
                      {got.number}
                    </span>
                  )
                })()}
                <span>등록 {String(c.registered_at).slice(0, 10)}</span>
                <span>{c.division}</span>
                {/* 확인 전이면 그 사실을, 확인한 날이 등록일과 다르면 그 달을. 같으면 적지 않는다. */}
                {checkedLabel(c) && <span>{checkedLabel(c)}</span>}
              </div>
            </button>
            </div>
          ))}
        </div>
      ) : (
        /* ── PC — 표(보드) ── */
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: R.card, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                <th style={{ ...th, width: 34, paddingRight: 0 }}>
                  <input type="checkbox" checked={allPicked} onChange={toggleAll}
                    aria-label="모두 고르기" style={{ cursor: 'pointer' }} />
                </th>
                <th style={th}>이름</th><th style={th}>회사 · 부서</th><th style={th}>직급</th>
                <th style={th}>휴대폰</th><th style={th}>이메일</th><th style={th}>사업부</th>
                <th style={th}>등록일</th><th style={th}>마지막 확인</th><th style={th}>등록자</th><th style={th} />
              </tr>
            </thead>
            <tbody>
              {shown.map(c => (
                <tr key={c.card_id} style={{ height: 44, borderTop: `1px solid ${BORDER}`, cursor: 'pointer' }}
                  onClick={() => openCard(c)}>
                  {/* 체크칸은 줄 열기와 섞이지 않게 눌림을 여기서 멈춘다. */}
                  <td style={{ ...td, paddingRight: 0 }} onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={picked.has(c.card_id)}
                      onChange={() => togglePick(c.card_id)}
                      aria-label={`${c.name} 고르기`} style={{ cursor: 'pointer' }} />
                  </td>
                  <td style={td}><b>{c.name}</b><En value={c.name_en} /></td>
                  <td style={{ ...td, whiteSpace: 'normal' }}>
                    {[c.company, c.department].filter(Boolean).join(' · ') || '—'}
                    <En value={c.company_en} />
                  </td>
                  <td style={td}>{c.position ?? '—'}</td>
                  {/* 휴대폰이 없으면 회사 전화를 대신 보여 준다(앞에 작은 「회사」). */}
                  <td style={{ ...td, color: BLUE }}>
                    {(() => {
                      const got = displayPhone(c)
                      if (!got) return '—'
                      return (
                        <>
                          {got.isCompany && (
                            <span style={{ fontSize: 11, color: SUB, marginRight: 4 }}>{COMPANY_PHONE_MARK}</span>
                          )}
                          <a href={`tel:${got.number}`} onClick={e => e.stopPropagation()}
                            style={{ color: BLUE, textDecoration: 'none' }}>{got.number}</a>
                        </>
                      )
                    })()}
                  </td>
                  <td style={td}>
                    {c.email ? <a href={`mailto:${c.email}`} onClick={e => e.stopPropagation()} style={{ color: TEXT, textDecoration: 'none' }}>{c.email}</a> : '—'}
                  </td>
                  <td style={td}>{c.division}</td>
                  <td style={td}>
                    {String(c.registered_at).slice(0, 10)}{' '}
                    <AgeTag registeredAt={c.registered_at} today={today} />
                  </td>
                  {/* 확인 전이면 그렇게 적는다. 등록일과 같은 날이면 날짜를 되풀이하지 않는다. */}
                  <td style={{ ...td, color: SUB }}>
                    {isUnchecked(c)
                      ? '확인 전'
                      : String(c.verified_at).slice(0, 10) === String(c.registered_at).slice(0, 10)
                        ? '등록일과 같음'
                        : String(c.verified_at).slice(0, 10)}
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

      {bulkOpen && (
        <BulkImportModal
          division={filter.division || teamDivisionOf(me)}
          onClose={() => setBulkOpen(false)}
          onDone={t => { if (t.saved > 0) void load() }}
          onShowUnchecked={() => setFilter({ checked: 'none' })}
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
