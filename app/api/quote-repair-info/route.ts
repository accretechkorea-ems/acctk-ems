// 견적의 **수리 건 정보** — 읽기·저장 한 라우트.
//
// ── 왜 서비스 롤인가 ────────────────────────────────────────────────────────
//   읽어야 하는 표가 둘인데 RLS 범위가 서로 다르다.
//     repairs            — 20 수리 화면 사람들의 표다. 견적만 쓰는 사람에게 열려 있지 않다.
//     quote_repair_info  — 견적과 같은 범위(부모 견적이 보이면 보인다).
//   화면에서 두 표를 각자 묻게 두면, 수리 권한이 없는 사람은 「수리 건인지조차」 알 수 없어
//   뱃지도 패널도 비어 버린다. 그래서 이 라우트가 **좁게** 열어 준다 — 돌려주는 칸은
//   화면이 그리는 것뿐이고(금액·원가 같은 것은 없다), 쓰기는 아래 권한을 다시 본다.
//
// ── 권한 ───────────────────────────────────────────────────────────────────
//   읽기  로그인한 사람(견적 목록·작성 화면에 이미 들어와 있는 사람이다).
//   쓰기  **견적 작성자 + superadmin** — 견적을 고칠 수 있는 사람과 같은 규칙이다
//         (lib/apiCaller.ts 의 isOwnerOrSuperAdmin. 대필로 쓴 건은 대필한 사람의 것이다).
//
// 동작은 action 하나로 가른다(POST 한 길) — 목록 뱃지가 한 번에 100건씩 묻기 때문이다.
//   states  견적 여러 건의 「수리 건인가 · 얼마나 적었나」
//   detail  견적 한 건의 수리 건 + 적어 둔 내용 + 내가 고칠 수 있는가
//   repair  수리 건 한 줄(아직 저장하지 않은 견적이 쓴다)
//   search  수리 건 고르기(같은 고객사 건이 앞에 선다)
//   save    증상·원인·결과 덮어쓰기(upsert)

import { adminClient } from '@/lib/supabase/admin'
import { isOwnerOrSuperAdmin, loadCaller } from '@/lib/apiCaller'
import { repairInfoState, type RepairInfoRow } from '@/lib/quoteRepairInfo'
import { NextResponse } from 'next/server'

const sb = adminClient()

/** 화면이 그리는 수리 건의 칸 — 이것 말고는 내보내지 않는다. */
const REPAIR_SELECT =
  'repair_id, item_type, serial_number, received_date, repair_done_at, shipped_date, status, customer_name, product_type, quote_id'

/** 한 번에 물어볼 수 있는 견적 수. 화면(lib/quoteRepairInfo.ts)도 같은 수로 끊는다. */
const MAX_IDS = 100
/** 고르기 목록에 내는 수. */
const SEARCH_LIMIT = 20
/** 한 칸에 담을 수 있는 글자 — 화면 textarea 와 같은 상한이다. */
const TEXT_MAX = 2000

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

/** 들어온 글자 다듬기 — 빈 글자는 null(= 적지 않음)이다. */
const text = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s === '' ? null : s.slice(0, TEXT_MAX)
}

const intOf = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

export async function POST(req: Request) {
  const { error: authErr, caller } = await loadCaller({ kind: 'login' }, { tag: 'quote-repair-info', req })
  if (authErr) return authErr

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const action = typeof body.action === 'string' ? body.action : ''

  // ── 목록 뱃지 ─────────────────────────────────────────────────────────────
  if (action === 'states') {
    const ids = Array.isArray(body.quoteIds)
      ? [...new Set(body.quoteIds.map(intOf).filter((n): n is number => n !== null))].slice(0, MAX_IDS)
      : []
    const states: Record<number, RepairInfoRow> = {}
    if (ids.length === 0) return NextResponse.json({ states })

    const [{ data: repairs, error: rErr }, { data: infos, error: iErr }] = await Promise.all([
      sb.from('repairs').select('quote_id').in('quote_id', ids),
      sb.from('quote_repair_info').select('quote_id, symptom, cause, result').in('quote_id', ids),
    ])
    if (rErr || iErr) {
      console.error('[quote-repair-info] states 조회 실패', { error: rErr ?? iErr })
      return bad('수리 정보를 확인하지 못했습니다.', 500)
    }
    const repairSet = new Set((repairs ?? []).map(r => Number(r.quote_id)))
    const infoMap = new Map((infos ?? []).map(r => [Number(r.quote_id), r]))
    for (const id of ids) {
      // 수리 건이 아닌 견적은 뱃지도 버튼도 내지 않는다 — 그 줄에는 없는 개념이다.
      if (!repairSet.has(id)) continue
      states[id] = { isRepair: true, state: repairInfoState(infoMap.get(id) ?? null) }
    }
    return NextResponse.json({ states })
  }

  // ── 견적 한 건 ────────────────────────────────────────────────────────────
  if (action === 'detail') {
    const quoteId = intOf(body.quoteId)
    if (quoteId === null) return bad('견적을 지정해주세요.')

    const [{ data: quote }, { data: repair }, { data: info }] = await Promise.all([
      sb.from('quotes').select('quote_id, created_by, engineer_id').eq('quote_id', quoteId).maybeSingle(),
      sb.from('repairs').select(REPAIR_SELECT).eq('quote_id', quoteId).maybeSingle(),
      sb.from('quote_repair_info').select('symptom, cause, result').eq('quote_id', quoteId).maybeSingle(),
    ])
    if (!quote) return bad('견적을 찾을 수 없습니다.', 404)
    return NextResponse.json({
      repair: repair ?? null,
      info: info ?? null,
      canEdit: isOwnerOrSuperAdmin(quote, caller),
    })
  }

  // ── 수리 건 한 줄 ─────────────────────────────────────────────────────────
  if (action === 'repair') {
    const repairId = intOf(body.repairId)
    if (repairId === null) return bad('수리 건을 지정해주세요.')
    const { data } = await sb.from('repairs').select(REPAIR_SELECT).eq('repair_id', repairId).maybeSingle()
    return NextResponse.json({ repair: data ?? null })
  }

  // ── 고르기 ────────────────────────────────────────────────────────────────
  if (action === 'search') {
    const keyword = typeof body.keyword === 'string' ? body.keyword.trim().slice(0, 60) : ''
    const customerName = typeof body.customerName === 'string' ? body.customerName.trim() : ''
    let q = sb.from('repairs').select(REPAIR_SELECT)
      .order('received_date', { ascending: false })
      .order('repair_id', { ascending: false })
      .limit(SEARCH_LIMIT * 3)
    if (keyword) {
      // 회사명·시리얼·제품 구분 중 하나만 맞아도 후보다.
      const like = `%${keyword.replace(/[%,]/g, '')}%`
      q = q.or(`customer_name.ilike.${like},serial_number.ilike.${like},product_type.ilike.${like}`)
    }
    const { data, error } = await q
    if (error) {
      console.error('[quote-repair-info] search 실패', { error })
      return bad('수리 목록을 불러오지 못했습니다.', 500)
    }
    // **같은 고객사 건이 먼저**다 — 견적을 쓰는 사람은 거의 그 회사 건을 찾는다.
    // 이미 다른 견적에 연결된 건은 뒤로 민다(고를 수는 있다 — 바꿔 다는 일이 있다).
    const rows = (data ?? []).map(r => ({
      ...r,
      _same: customerName && (r.customer_name ?? '').trim() === customerName ? 0 : 1,
      _linked: r.quote_id == null ? 0 : 1,
    }))
    rows.sort((a, b) => a._same - b._same || a._linked - b._linked)
    return NextResponse.json({ repairs: rows.slice(0, SEARCH_LIMIT) })
  }

  // ── 저장 ──────────────────────────────────────────────────────────────────
  if (action === 'save') {
    const quoteId = intOf(body.quoteId)
    if (quoteId === null) return bad('견적을 지정해주세요.')

    const { data: quote } = await sb.from('quotes')
      .select('quote_id, created_by, engineer_id').eq('quote_id', quoteId).maybeSingle()
    if (!quote) return bad('견적을 찾을 수 없습니다.', 404)
    if (!isOwnerOrSuperAdmin(quote, caller)) {
      console.warn('[quote-repair-info] 남의 견적 저장 시도', { quoteId, by: caller.engineer_id })
      return bad('본인이 작성한 견적만 고칠 수 있습니다.', 403)
    }

    const fields = { symptom: text(body.symptom), cause: text(body.cause), result: text(body.result) }
    // 작성자는 **처음 만든 사람**을 남기고, 고친 사람은 updated_by 로 따로 적는다.
    const { data: existing } = await sb.from('quote_repair_info')
      .select('quote_id').eq('quote_id', quoteId).maybeSingle()
    const now = new Date().toISOString()
    const row = existing
      ? { quote_id: quoteId, ...fields, updated_by: caller.engineer_id, updated_at: now }
      : { quote_id: quoteId, ...fields, created_by: caller.engineer_id, updated_by: caller.engineer_id, updated_at: now }

    const { error } = await sb.from('quote_repair_info').upsert(row, { onConflict: 'quote_id' })
    if (error) {
      console.error('[quote-repair-info] 저장 실패', { quoteId, error })
      return bad('저장하지 못했습니다.', 500)
    }
    return NextResponse.json({ ok: true, state: repairInfoState(fields) })
  }

  return bad('알 수 없는 요청입니다.')
}
