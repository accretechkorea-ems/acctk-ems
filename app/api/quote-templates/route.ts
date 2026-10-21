// 장비 구성 템플릿 쓰기 — 생성·수정·삭제·사용 기록.
//
// **왜 서버인가.** quote_templates · quote_template_items 에는 **쓰기 RLS 정책이 없다**
// (quote_category_template_schema.sql 단계 4·5). 브라우저(authenticated)는 정책도 권한도
// 없어 두 겹으로 막히고, 여기서 service role 로만 쓴다. quote_items 의 느슨한 정책을
// 베끼지 않으려고 일부러 그렇게 뒀다.
//
// **누가 쓸 수 있나.** 견적 작성 권한(quote 메뉴) 또는 superadmin. 「견적 권한자는 누구나
// 남의 템플릿도 고치고 지울 수 있다」가 확정된 규칙이라 소유자 검사는 하지 않는다.
// 다만 화면은 남의 것을 고칠 때 「복사 저장」을 기본으로 둔다.
//
// **행위자는 세션에서 강제한다.** owner_id·owner_name·updated_by·deleted_by 를 본문에서
// 받지 않는다 — create_quote 가 created_by 를 강제하는 것과 같은 규칙이다. 이 표에는 감사
// 트리거를 붙이지 않았으므로(service role 은 행위자를 잃는다) 이 칸들이 유일한 기록이다.
//
// 삭제는 soft delete 다. 행을 지우면 「남의 것을 복사해 저장」한 쪽에서 출처를 되짚을 수 없고
// 실수로 지운 것을 되살릴 수도 없다.

import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { canViewMenu } from '@/lib/permissions'
import { loadTeamPerms, attachTeamPerm } from '@/lib/teamPermsServer'
import { GROUP_KINDS } from '@/lib/quoteForms'
// ⚠ 상한은 **lib/quoteTemplateLimits.ts** 에서 가져온다. lib/quoteTemplates.ts 는
//   `'use client'` 라서 거기서 가져오면 Next 가 client reference proxy 로 바꿔 끼우고,
//   서버에서는 숫자가 아니게 된다(그 탓에 이름 검사가 늘 실패했다. 그 파일 머리말 참조).
import {
  TEMPLATE_ITEM_MAX, TEMPLATE_NAME_MAX, TEMPLATE_PRICE_MAX, TEMPLATE_QTY_MAX,
} from '@/lib/quoteTemplateLimits'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

/** 줄의 묶음 — 화면의 네 묶음과 같다(스키마 CHECK 와도 같아야 한다). */
const ITEM_GROUP_KINDS: readonly string[] = [...GROUP_KINDS, 'domestic']
/** 줄 종류 — app/quote/types.ts 의 RowKind 와 같은 목록. */
const ITEM_ROW_KINDS: readonly string[] = ['price_list', 'manual_jpy', 'domestic', 'service', 'discount']

/**
 * 가격표 줄의 구분값(price_list.variant) 길이 상한.
 *
 * **허용 목록을 두지 않는다.** 예전에는 'jig_in'·'jig_out' 세 값만 받았는데, 그건 CMM 본체의
 * Net price 두 열을 쪼개던 시절 것이다. 지금 구분값은 빈 글자이거나 **묶음 제목**(가격표
 * 엑셀의 「■…」 줄)이라 임의의 글자다. 목록으로 막으면 그런 품목이 든 구성을 저장할 수 없다.
 */
const VARIANT_MAX = 200

type ItemInput = {
  group_kind: string
  row_kind: string
  part_code: string | null
  /** 직접 적은 줄의 구입가(엔). 값이 있을 때만 담는다(DB 에 칸이 없을 수 있다). */
  default_cost_jpy?: number
  variant: string
  item_name: string | null
  qty_per_unit: number
  default_checked: boolean
  default_sell_price: number | null
  sort_order: number
}

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

/** 글자 칸 — 앞뒤 공백을 떼고 빈 값은 null 로. */
const text = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (t === '') return null
  // ⚠ max 가 숫자가 아니면 **자르지 않는다.** 예전에 상한이 숫자가 아닌 값으로 들어와
  //   slice(0, NaN) 이 빈 글자를 만들고, 그게 「이름을 입력해주세요」로 둔갑했다.
  //   값이 틀렸으면 길이 검사를 건너뛰는 쪽이, 글자를 지워 버리는 쪽보다 낫다.
  if (!Number.isFinite(max) || max <= 0) {
    console.error('[quote-templates] 길이 상한이 숫자가 아니다', { max })
    return t
  }
  return t.slice(0, max)
}

/** 숫자 칸 — 유한한 값이고 범위 안이어야 한다. 아니면 null. */
const num = (v: unknown, min: number, max: number): number | null => {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  // 상한이 숫자가 아니면 **범위 검사를 건너뛴다**(그 사실을 로그로 남긴다).
  // 그냥 비교하면 NaN 과의 비교가 늘 거짓이라 검사가 **조용히 없어진다.**
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    console.error('[quote-templates] 숫자 범위가 숫자가 아니다', { min, max })
    return n
  }
  if (n < min || n > max) return null
  return n
}

/**
 * 줄 목록을 검사해 저장할 모양으로 다듬는다.
 * 한 줄이라도 모양이 틀리면 **통째로 거절한다** — 일부만 저장되면 사람이 본 것과 달라진다.
 */
function readItems(raw: unknown): { ok: true; items: ItemInput[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: '구성 줄이 올바르지 않습니다.' }
  if (raw.length === 0) return { ok: false, error: '저장할 구성 줄이 없습니다.' }
  if (raw.length > TEMPLATE_ITEM_MAX) {
    return { ok: false, error: `구성 줄은 ${TEMPLATE_ITEM_MAX}개까지 저장할 수 있습니다.` }
  }
  const items: ItemInput[] = []
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i] as Record<string, unknown>
    const group = typeof r?.group_kind === 'string' ? r.group_kind : ''
    if (!ITEM_GROUP_KINDS.includes(group)) {
      return { ok: false, error: `${i + 1}번째 줄의 묶음 값이 올바르지 않습니다.` }
    }
    const rowKind = typeof r?.row_kind === 'string' ? r.row_kind : ''
    if (!ITEM_ROW_KINDS.includes(rowKind)) {
      return { ok: false, error: `${i + 1}번째 줄의 종류 값이 올바르지 않습니다.` }
    }
    // 구분값은 임의의 글자다(길이만 본다). 없으면 '' (구분 없음)으로 본다.
    const variant = typeof r?.variant === 'string' ? r.variant.trim() : ''
    if (variant.length > VARIANT_MAX) {
      return { ok: false, error: `${i + 1}번째 줄의 구분 값이 너무 깁니다.` }
    }
    const qty = num(r?.qty_per_unit, 0, TEMPLATE_QTY_MAX)
    if (qty === null) return { ok: false, error: `${i + 1}번째 줄의 수량이 올바르지 않습니다.` }
    // 판매단가는 비어 있어도 된다(이익률로 역산하는 줄). 값이 있으면 범위를 본다.
    let sell: number | null = null
    if (r?.default_sell_price != null && r.default_sell_price !== '') {
      sell = num(r.default_sell_price, 0, TEMPLATE_PRICE_MAX)
      if (sell === null) return { ok: false, error: `${i + 1}번째 줄의 판매단가가 올바르지 않습니다.` }
    }
    // 품번도 품명도 없는 줄은 저장해 봐야 불러올 때 알아볼 수 없다.
    const partCode = text(r?.part_code, 100)
    const itemName = text(r?.item_name, 300)
    if (partCode === null && itemName === null) {
      return { ok: false, error: `${i + 1}번째 줄에 품번이나 품명이 있어야 합니다.` }
    }
    // 구입가(엔) — 직접 적은 줄만 보낸다. 범위는 판매단가와 같게 본다.
    let cost: number | null = null
    if (r?.default_cost_jpy != null && r.default_cost_jpy !== '') {
      cost = num(r.default_cost_jpy, 0, TEMPLATE_PRICE_MAX)
      if (cost === null) return { ok: false, error: `${i + 1}번째 줄의 구입가가 올바르지 않습니다.` }
    }

    items.push({
      group_kind: group,
      row_kind: rowKind,
      part_code: partCode,
      // 값이 없으면 **칸을 넣지 않는다** — 아직 칸이 없는 DB 에서도 저장이 된다.
      ...(cost !== null && cost > 0 ? { default_cost_jpy: cost } : {}),
      variant,
      item_name: itemName,
      qty_per_unit: qty,
      default_checked: r?.default_checked !== false,
      default_sell_price: sell,
      sort_order: num(r?.sort_order, 0, 100000) ?? i,
    })
  }
  return { ok: true, items }
}

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return bad('Unauthorized', 401)

  const { data: caller } = await supabase
    .from('engineers')
    .select('engineer_id, name, position, permission_level, teams')
    .eq('email', user.email!)
    .single()
  if (!caller) return bad('Forbidden', 403)

  // 견적 작성 권한(또는 superadmin). canViewMenu 는 superadmin 이면 늘 통과한다.
  // 권한 변경이 바로 먹어야 하므로 캐시를 건너뛴다(발주 라우트와 같은 규칙).
  const teamPerms = await loadTeamPerms({ fresh: true })
  if (!canViewMenu(attachTeamPerm(teamPerms, caller), 'quote')) {
    return bad('견적 작성 권한이 없습니다.', 403)
  }

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  // 본문을 못 읽은 경우를 **이름 탓으로 돌리지 않는다.** 예전에는 body 가 null 이면
  // body?.name 이 undefined 라서 「템플릿 이름을 입력해주세요」가 떴다 — 화면에는 이름이
  // 보이는데 그 문구가 뜨면 어디를 고쳐야 하는지 알 수 없다.
  if (!body) return bad('요청을 읽을 수 없습니다.')
  const action = typeof body?.action === 'string' ? body.action : ''
  const now = new Date().toISOString()

  // ── 사용 기록 — used_count + 1, last_used_at. 가장 가벼운 길이라 먼저 가른다. ──
  if (action === 'use') {
    const id = text(body?.id, 64)
    if (!id) return bad('템플릿을 지정해주세요.')
    // 두 사람이 같은 템플릿을 동시에 써도 세지 못하는 일이 없게 DB 가 세게 한다.
    const { data: cur, error: readErr } = await supabaseAdmin
      .from('quote_templates').select('used_count').eq('id', id).maybeSingle()
    if (readErr || !cur) return bad('템플릿을 찾을 수 없습니다.', 404)
    const { error } = await supabaseAdmin
      .from('quote_templates')
      .update({ used_count: (cur.used_count ?? 0) + 1, last_used_at: now })
      .eq('id', id)
    if (error) {
      console.error('[quote-templates] 사용 기록 실패', { id, error })
      return bad('사용 기록을 남기지 못했습니다.', 500)
    }
    return NextResponse.json({ id })
  }

  // ── 삭제 — soft delete. 행을 지우지 않는다. ──
  if (action === 'delete') {
    const id = text(body?.id, 64)
    if (!id) return bad('템플릿을 지정해주세요.')
    const { data, error } = await supabaseAdmin
      .from('quote_templates')
      .update({ is_deleted: true, deleted_at: now, deleted_by: caller.engineer_id, updated_at: now })
      .eq('id', id)
      .eq('is_deleted', false)     // 이미 지운 것을 또 지우지 않는다
      .select('id')
    if (error) {
      console.error('[quote-templates] 삭제 실패', { id, error })
      return bad('삭제하지 못했습니다.', 500)
    }
    if (!data || data.length === 0) return bad('이미 삭제되었거나 없는 템플릿입니다.', 404)
    return NextResponse.json({ id })
  }

  // ── 생성·수정 — 둘 다 이름·줄 검사를 똑같이 한다. ──
  if (action !== 'create' && action !== 'update') return bad('알 수 없는 요청입니다.')

  const name = text(body?.name, TEMPLATE_NAME_MAX)
  if (!name) return bad('템플릿 이름을 입력해주세요.')
  const modelKey = text(body?.model_key, 100)
  const category = text(body?.category, 60)

  const parsed = readItems(body?.items)
  if (!parsed.ok) return bad(parsed.error)

  // 만든 사람 이름은 **세션에서** 만든다(직급까지 붙여 목록에서 바로 알아보게).
  const ownerName = [caller.name, caller.position].filter(Boolean).join(' ').trim() || '이름 없음'

  if (action === 'create') {
    const { data: head, error } = await supabaseAdmin
      .from('quote_templates')
      .insert({
        name,
        owner_id: caller.engineer_id,
        owner_name: ownerName,
        form_kind: 'equip80',          // 구성 템플릿은 장비 양식 전용이다
        category,
        model_key: modelKey,
        updated_by: caller.engineer_id,
        updated_at: now,
      })
      .select('id')
      .single()
    if (error || !head) {
      console.error('[quote-templates] 생성 실패', { error })
      return bad('템플릿을 저장하지 못했습니다.', 500)
    }
    const insErr = await insertItems(head.id, parsed.items)
    if (insErr) {
      // 줄을 못 넣었으면 머리만 남는다 — 쓸 수 없는 껍데기라 지우고 실패로 알린다.
      await supabaseAdmin.from('quote_templates').delete().eq('id', head.id)
      console.error('[quote-templates] 줄 저장 실패', { id: head.id, error: insErr })
      return bad('구성 줄을 저장하지 못했습니다.', 500)
    }
    return NextResponse.json({ id: head.id })
  }

  // update — 머리를 고치고 줄은 **지우고 다시 넣는다**(줄 단위 비교를 두지 않는다).
  const id = text(body?.id, 64)
  if (!id) return bad('템플릿을 지정해주세요.')

  const { data: updated, error: headErr } = await supabaseAdmin
    .from('quote_templates')
    .update({ name, category, model_key: modelKey, updated_by: caller.engineer_id, updated_at: now })
    .eq('id', id)
    .eq('is_deleted', false)
    .select('id')
  if (headErr) {
    console.error('[quote-templates] 수정 실패', { id, error: headErr })
    return bad('템플릿을 고치지 못했습니다.', 500)
  }
  if (!updated || updated.length === 0) return bad('삭제되었거나 없는 템플릿입니다.', 404)

  const { error: delErr } = await supabaseAdmin
    .from('quote_template_items').delete().eq('template_id', id)
  if (delErr) {
    console.error('[quote-templates] 옛 줄 삭제 실패', { id, error: delErr })
    return bad('구성 줄을 고치지 못했습니다.', 500)
  }
  const insErr = await insertItems(id, parsed.items)
  if (insErr) {
    console.error('[quote-templates] 새 줄 저장 실패', { id, error: insErr })
    return bad('구성 줄을 저장하지 못했습니다.', 500)
  }
  return NextResponse.json({ id })
}

/** 줄을 한 번에 넣는다. 실패하면 오류를 돌려준다(부르는 쪽이 뒷정리를 한다). */
async function insertItems(templateId: string, items: ItemInput[]) {
  const { error } = await supabaseAdmin
    .from('quote_template_items')
    .insert(items.map(it => ({ ...it, template_id: templateId })))
  // 칸이 아직 없는 DB — 무엇을 해야 하는지 한글로 알린다(42703 = undefined_column).
  if (error?.code === '42703' && error.message.includes('default_cost_jpy')) {
    return {
      ...error,
      message: '직접 적은 줄의 구입가를 저장할 칸이 없습니다 — 관리자에게 '
        + 'quote_template_items.default_cost_jpy 추가를 요청해 주세요.',
    }
  }
  return error
}
