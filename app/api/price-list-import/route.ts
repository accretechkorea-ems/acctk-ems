// 가격표 등록 — 미리보기(preview) · 적용(apply).
//
// ── 두 동작이 한 라우트에 있는 이유 ─────────────────────────────────────────
//   받는 값(종류 + 행 배열)과 검사가 똑같다. 미리보기는 **읽기만** 하고,
//   적용은 같은 값을 그대로 RPC 에 넘긴다. 검사를 두 벌 두면 한쪽만 느슨해진다.
//
// ── 권한 ────────────────────────────────────────────────────────────────────
//   superadmin 만. 순서는 app/api/office/route.ts 와 같다 —
//   createServerClient → auth.getUser → 401 → engineers 조회 → isSuperAdmin → 403.
//   화면에서도 관리자에게만 카드를 보이지만 그것만으로는 막을 수 없어 여기서 다시 판정한다.
//
//   p_applied_by 는 **세션의 engineer_id** 로 서버가 채운다. 본문 값은 보지 않는다
//   (create_quote 가 created_by 를 강제하는 것과 같은 규칙).
//
// ── 왜 파일을 올리지 않는가 ─────────────────────────────────────────────────
//   엑셀은 브라우저가 읽는다(lib/priceListParse.ts). 서버로 오는 것은 **DB 에 들어갈 칸만**
//   담은 행 배열이다. 파일 자체(수십~수백 KB의 서식·수식)를 올릴 이유가 없고,
//   요청 본문 한도(Vercel 약 4.5MB)에도 여유가 생긴다. 한 시트 1,000줄이면 200KB 안쪽이다.
//
// ── 쓰기는 RPC 하나로 끝낸다 ────────────────────────────────────────────────
//   apply_price_list_import() 가 한 트랜잭션에서 덮어쓰기·삽입·이력을 모두 한다.
//   중간에 실패하면 아무것도 바뀌지 않는다. 이 함수는 service_role 에만 실행 권한이 있다.

import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { isSuperAdmin } from '@/lib/permissions'
import { PRICE_LIST_SHEETS } from '@/lib/priceListKinds'
import { PARSE_ROW_MAX } from '@/lib/priceListParse'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

/** 칸 길이 상한. 전부 text 칸이라 서버에서 막지 않으면 무제한으로 들어온다. */
const MAX = { item_code: 100, variant: 20, short: 100, long: 500, file_name: 200, valid_text: 500 }
/** cost_jpy·price_jpy 는 **integer 칸**이다. int4 한도(2,147,483,647)를 넘으면 저장에서 터진다. */
const PRICE_MAX = 2_000_000_000
/** variant 는 파서가 만드는 세 값뿐이다. */
const VARIANTS: readonly string[] = ['', 'jig_in', 'jig_out']
/** 비교·저장에 쓰는 글자 칸. */
const TEXT_FIELDS = ['plnt', 'grp', 'item_name_jp', 'model_jp', 'note1_jp', 'note2_jp', 'note3_jp'] as const

/**
 * 납기 — **주 숫자 문자열**이다('10' = 10주). 20 가격표 줄에만 온다.
 * 화면이 뒤에 「주」를 붙여 보여 주므로(QuoteItemRow) 숫자만 받는다.
 * 세 자리를 넘을 납기는 없다(999주 = 19년).
 */
const DELIVERY_RE = /^\d{1,3}$/

type TextField = typeof TEXT_FIELDS[number]
type CleanRow = {
  item_code: string
  variant: string
  price_jpy: number | null
  cost_jpy: number | null
  /**
   * 20 가격표 줄에만 담긴다. **지금 DB 함수는 이 칸을 저장하지 않는다** —
   * jsonb_populate_recordset 이 임시표에 담아 두기만 하고, 함수의 update·insert 목록에
   * 없어서 쓰이지 않는다(오류도 나지 않는다). 함수를 교체하면 그때부터 저장된다.
   */
  delivery_time?: string | null
} & Record<TextField, string | null>

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const nullableStr = (v: unknown, max: number): string | null | { error: string } => {
  if (v === null || v === undefined || v === '') return null
  if (typeof v !== 'string') return { error: '글자가 아닌 값이 들어 있습니다.' }
  const s = v.trim()
  if (s === '') return null
  if (s.length > max) return { error: `${max}자를 넘는 값이 있습니다.` }
  return s
}

/** 숫자 칸 — 정수이고 범위 안이어야 한다. 파서가 이미 반올림해서 보낸다. */
function readPrice(v: unknown, label: string, code: string): number | null | { error: string } {
  if (v === null || v === undefined || v === '') return null
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    return { error: `${code} 의 ${label} 가 숫자가 아닙니다.` }
  }
  if (!Number.isInteger(v)) return { error: `${code} 의 ${label} 가 정수가 아닙니다.` }
  if (v < 0 || v > PRICE_MAX) {
    return { error: `${code} 의 ${label}(${v.toLocaleString('ko-KR')})가 허용 범위를 벗어났습니다.` }
  }
  return v
}

/**
 * 본문의 행 배열을 **서버가 만든 깨끗한 행**으로 바꾼다.
 * 클라이언트가 보낸 객체를 그대로 RPC 로 넘기지 않는다 — 모르는 칸(sheet_name·id 등)이
 * 섞여 들어오면 뜻이 달라진다. 한 줄이라도 어긋나면 전체를 되돌린다(조용히 버리지 않는다).
 */
function readRows(raw: unknown): { ok: true; rows: CleanRow[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: '행 목록이 배열이 아닙니다.' }
  if (raw.length === 0) return { ok: false, error: '등록할 행이 없습니다.' }
  if (raw.length > PARSE_ROW_MAX) {
    return { ok: false, error: `한 번에 등록할 수 있는 행은 ${PARSE_ROW_MAX.toLocaleString('ko-KR')}개까지입니다 (받은 행 ${raw.length.toLocaleString('ko-KR')}).` }
  }

  const rows: CleanRow[] = []
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i] as Record<string, unknown>
    if (!r || typeof r !== 'object') return { ok: false, error: `${i + 1}번째 행을 읽을 수 없습니다.` }

    const code = str(r.item_code)
    if (!code) return { ok: false, error: `${i + 1}번째 행에 품번이 없습니다.` }
    if (code.length > MAX.item_code) return { ok: false, error: `품번이 너무 깁니다: ${code.slice(0, 20)}…` }

    const variant = str(r.variant)
    if (!VARIANTS.includes(variant)) return { ok: false, error: `${code} 의 구분값이 올바르지 않습니다: ${variant}` }

    const price = readPrice(r.price_jpy, '정가', code)
    if (price && typeof price === 'object') return { ok: false, error: price.error }
    const cost = readPrice(r.cost_jpy, '구입가', code)
    if (cost && typeof cost === 'object') return { ok: false, error: cost.error }
    // 구입가가 없는 줄은 화면에서 이미 빠진다. 여기까지 왔다면 보내는 쪽이 잘못 골랐다는 뜻이다.
    if (cost === null) return { ok: false, error: `${code} 에 구입가가 없습니다 — 구입가 없는 줄은 보낼 수 없습니다.` }

    const row = { item_code: code, variant, price_jpy: price, cost_jpy: cost } as CleanRow

    // 납기 — 보내오지 않는 줄(80 가격표)은 칸 자체가 없다. 보냈다면 주 숫자여야 한다.
    if (r.delivery_time !== undefined && r.delivery_time !== null && r.delivery_time !== '') {
      const d = str(r.delivery_time)
      if (!DELIVERY_RE.test(d)) {
        return { ok: false, error: `${code} 의 납기 값이 올바르지 않습니다: ${d.slice(0, 20)}` }
      }
      row.delivery_time = d
    } else if (r.delivery_time === null) {
      // 납기를 모른다는 뜻으로 명시해 보낸 경우. 그대로 담는다.
      row.delivery_time = null
    }
    for (const f of TEXT_FIELDS) {
      const v = nullableStr(r[f], f === 'plnt' || f === 'grp' ? MAX.short : MAX.long)
      if (v && typeof v === 'object') return { ok: false, error: `${code} 의 ${f}: ${v.error}` }
      row[f] = v
    }
    rows.push(row)
  }
  return { ok: true, rows }
}

/** 같은 종류의 현재 행을 전부 읽는다. PostgREST 는 한 번에 1,000행까지라 끊어 읽는다. */
async function loadCurrent(sheetName: string): Promise<Map<string, CleanRow>> {
  const map = new Map<string, CleanRow>()
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('price_list')
      .select(`item_code, variant, price_jpy, cost_jpy, ${TEXT_FIELDS.join(', ')}`)
      .eq('sheet_name', sheetName)
      .order('item_code')
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`현재 가격표를 읽지 못했습니다: ${error.message}`)
    const page = (data ?? []) as unknown as CleanRow[]
    for (const row of page) map.set(`${row.item_code}\u0000${row.variant ?? ''}`, row)
    if (page.length < PAGE) break
  }
  return map
}

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return bad('Unauthorized', 401)

  const { data: caller, error: callerErr } = await supabase
    .from('engineers')
    .select('engineer_id, name, permission_level')
    .eq('email', user.email!)
    .single()
  if (callerErr) console.error('[price-list-import] caller lookup failed', { email: user.email, error: callerErr })
  // 가격표는 모든 견적의 원가가 기대는 기준 데이터라 superadmin 으로 제한한다.
  if (!caller || !isSuperAdmin(caller)) return bad('Forbidden', 403)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return bad('요청을 읽을 수 없습니다. 파일이 너무 큰지 확인해 주세요.')
  }

  const action = str(body.action)
  const sheetName = str(body.sheet_name)
  // 종류는 일곱 개 중 하나만. 다른 글자를 받으면 같은 종류가 둘로 갈린다.
  if (!PRICE_LIST_SHEETS.includes(sheetName)) {
    return bad(`종류가 올바르지 않습니다: ${sheetName || '(비어 있음)'}`)
  }

  const parsed = readRows(body.rows)
  if (!parsed.ok) return bad(parsed.error)
  const rows = parsed.rows

  // ── 미리보기 — 읽기만 한다 ──
  if (action === 'preview') {
    let current: Map<string, CleanRow>
    try {
      current = await loadCurrent(sheetName)
    } catch (e) {
      return bad(e instanceof Error ? e.message : '현재 가격표를 읽지 못했습니다.', 500)
    }

    let isNew = 0, priceChanged = 0, otherChanged = 0, same = 0
    const matched = new Set<string>()
    const changes: {
      item_code: string; variant: string
      old_cost: number | null; new_cost: number | null
      old_price: number | null; new_price: number | null
    }[] = []

    for (const r of rows) {
      const key = `${r.item_code}\u0000${r.variant}`
      const old = current.get(key)
      if (!old) { isNew++; continue }
      matched.add(key)
      const priceDiff = old.cost_jpy !== r.cost_jpy || old.price_jpy !== r.price_jpy
      if (priceDiff) {
        priceChanged++
        // 목록은 앞에서 스물까지만 보낸다 — 화면이 보여 주는 만큼이면 된다.
        if (changes.length < 20) {
          changes.push({
            item_code: r.item_code, variant: r.variant,
            old_cost: old.cost_jpy, new_cost: r.cost_jpy,
            old_price: old.price_jpy, new_price: r.price_jpy,
          })
        }
        continue
      }
      // 가격은 같고 이름·규격만 바뀐 줄. 서버 함수는 이것도 「덮어쓴 줄」로 센다.
      const textDiff = TEXT_FIELDS.some(f => (old[f] ?? null) !== (r[f] ?? null))
      if (textDiff) otherChanged++
      else same++
    }

    return NextResponse.json({
      ok: true,
      sheet_name: sheetName,
      counts: {
        incoming: rows.length,
        isNew, priceChanged, otherChanged, same,
        // 파일에 없어서 그대로 남는 기존 품목 수(지우지 않는다).
        kept: current.size - matched.size,
        current: current.size,
      },
      changes,
    })
  }

  // ── 적용 — RPC 한 번, 한 트랜잭션 ──
  if (action === 'apply') {
    const fileName = str(body.file_name).slice(0, MAX.file_name)
    if (!fileName) return bad('파일 이름이 비어 있습니다.')
    const validText = str(body.valid_text).slice(0, MAX.valid_text) || null

    const { data, error } = await supabaseAdmin.rpc('apply_price_list_import', {
      p_sheet_name: sheetName,
      p_file_name: fileName,
      p_valid_text: validText,
      // 적용한 사람은 **세션에서** 채운다. 본문에 무엇이 와도 보지 않는다.
      p_applied_by: caller.engineer_id,
      p_rows: rows,
    })
    if (error) {
      console.error('[price-list-import] apply 실패', { sheetName, rows: rows.length, error })
      // 함수가 던진 문구를 그대로 보여 준다(한글로 쓰여 있다). 아무것도 바뀌지 않았다.
      return bad(error.message || '적용하지 못했습니다.', 500)
    }
    return NextResponse.json({ ok: true, result: data })
  }

  return bad(`알 수 없는 동작입니다: ${action || '(비어 있음)'}`)
}
