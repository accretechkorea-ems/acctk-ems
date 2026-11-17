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
//   save    증상·원인·결과 덮어쓰기(upsert) + 사진 설명
//   photo-add     사진 올리기(줄인 data URL 을 받아 버킷에 넣고 줄을 더한다)
//   photo-delete  사진 지우기(**저장소 파일까지**)
//   photo-order   보이는 차례 그대로 sort_order 다시 매기기
//   doc-data      거래명세서·수리내역서를 그리는 데 드는 자료 한 묶음
//   doc-save      그린 PDF 를 quote-pdfs 에 올리고 열어 볼 주소를 돌려준다
//
// ── 사진을 왜 이 라우트에 두나 ──────────────────────────────────────────────
//   권한 판정이 글자 저장과 **완전히 같고**(작성자 + superadmin), 드로어가 열릴 때
//   수리 건·글자·사진을 한 번에 받아야 하며(detail), 서비스 롤로 올리고 DB 에는 경로만
//   남기는 방식은 service-attachment 라우트와 같다. 라우트를 더 쪼개면 같은 권한 코드가
//   두 곳이 된다.

import { adminClient } from '@/lib/supabase/admin'
import { isOwnerOrSuperAdmin, loadCaller } from '@/lib/apiCaller'
import { MAX_PHOTOS, PHOTO_MAX_BYTES, repairInfoState, type RepairInfoRow } from '@/lib/quoteRepairInfo'
import { CUSTOMER_NAME_SELECT, customerDisplayName } from '@/lib/customerLabel'
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

/** 견적서 PDF 와 **같은 버킷**이다 — 한 견적에서 나온 문서가 한곳에 모인다. */
const DOC_BUCKET = 'quote-pdfs'
/** 그린 PDF 의 상한. A4 한 장에 사진 넉 장이면 1MB 안쪽이다(실측 ~0.5MB). */
const DOC_MAX_BYTES = 8 * 1024 * 1024

/** 사진 버킷 — 비공개다. 보여 줄 때는 1시간 서명 URL 을 만든다. */
const PHOTO_BUCKET = 'quote-repair-photos'
/** 서명 URL 수명(초). */
const SIGN_TTL = 60 * 60
/** 사진 설명 길이 — 한 줄 설명이다. */
const CAPTION_MAX = 200

/**
 * 받은 data URL 을 바이트로. 화면이 이미 줄여서 보내지만(lib/leadCardImage.ts) 화면을
 * 거치지 않는 호출을 가정하고 **여기서 다시 본다** — 형식과 크기 둘 다.
 */
function parsePhoto(dataUrl: unknown): { bytes: Buffer; contentType: string } | { error: string } {
  if (typeof dataUrl !== 'string') return { error: '사진을 읽지 못했습니다.' }
  const m = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/)
  if (!m) return { error: 'JPG/PNG로 변환해 올려주세요' }
  const bytes = Buffer.from(m[2], 'base64')
  if (bytes.length === 0) return { error: '사진을 읽지 못했습니다.' }
  if (bytes.length > PHOTO_MAX_BYTES) return { error: '사진이 너무 큽니다(줄인 뒤 2MB 이하만 올릴 수 있습니다)' }
  return { bytes, contentType: m[1] }
}

/** 그 견적의 사진 — 차례대로, 서명 URL 을 붙여서. */
async function listPhotos(quoteId: number) {
  const { data } = await sb.from('quote_repair_photos')
    .select('photo_id, storage_path, caption, sort_order')
    .eq('quote_id', quoteId)
    .order('sort_order', { ascending: true })
    .order('photo_id', { ascending: true })
  const rows = data ?? []
  if (rows.length === 0) return []
  const { data: signed } = await sb.storage.from(PHOTO_BUCKET)
    .createSignedUrls(rows.map(r => r.storage_path), SIGN_TTL)
  const urlOf = new Map((signed ?? []).map(x => [x.path, x.signedUrl]))
  // 파일이 사라진 줄 — 주소를 만들어 주지 못한 것이 그 표시다. 화면이 「파일 없음」으로
  // 적고 ✕ 로 지울 수 있게 한다(줄만 남아 빈 네모가 되는 것을 막는다).
  return rows.map(r => ({ ...r, url: urlOf.get(r.storage_path) ?? null, missing: !urlOf.get(r.storage_path) }))
}

/** 저장할 수 있는 사람인가 — 견적 작성자 + superadmin(글자 저장과 같은 규칙). */
async function guardEdit(quoteId: number, caller: Parameters<typeof isOwnerOrSuperAdmin>[1]) {
  const { data: quote } = await sb.from('quotes')
    .select('quote_id, created_by, engineer_id').eq('quote_id', quoteId).maybeSingle()
  if (!quote) return bad('견적을 찾을 수 없습니다.', 404)
  if (!isOwnerOrSuperAdmin(quote, caller)) return bad('본인이 작성한 견적만 고칠 수 있습니다.', 403)
  return null
}

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

    // 거래명세서가 이미 있는가 — 버킷을 한 번 훑어 이름으로 맞춘다(행마다 묻지 않는다).
    const { data: quoteRows } = await sb.from('quotes').select('quote_id, quote_number').in('quote_id', ids)
    const docName = new Map<number, string>()
    for (const q of quoteRows ?? []) {
      docName.set(Number(q.quote_id), `${(q.quote_number ?? '').trim().replace(/^No\./i, '')}T.pdf`)
    }
    const { data: files } = await sb.storage.from(DOC_BUCKET).list('', { limit: 1000 })
    const fileSet = new Set((files ?? []).map(f => f.name))

    const [{ data: repairs, error: rErr }, { data: infos, error: iErr }, { data: photos }] = await Promise.all([
      sb.from('repairs').select('quote_id').in('quote_id', ids),
      sb.from('quote_repair_info').select('quote_id, symptom, cause, result').in('quote_id', ids),
      // 완료 판정에 **사진 수**가 든다(2026-11-16 부터). 수만 세면 되므로 경로는 받지 않는다.
      sb.from('quote_repair_photos').select('quote_id').in('quote_id', ids),
    ])
    if (rErr || iErr) {
      console.error('[quote-repair-info] states 조회 실패', { error: rErr ?? iErr })
      return bad('수리 정보를 확인하지 못했습니다.', 500)
    }
    const repairSet = new Set((repairs ?? []).map(r => Number(r.quote_id)))
    const infoMap = new Map((infos ?? []).map(r => [Number(r.quote_id), r]))
    const photoCount = new Map<number, number>()
    for (const r of photos ?? []) {
      const id = Number(r.quote_id)
      photoCount.set(id, (photoCount.get(id) ?? 0) + 1)
    }
    // **요청한 견적을 모두 담는다**(2026-11-16). 행 아이콘이 수리 건이 아닌 20 견적서에도
    // 서야 해서(거래명세서는 수리와 무관하게 낸다), 수리 건 여부는 칸으로만 알린다.
    for (const id of ids) {
      const info = infoMap.get(id) ?? null
      states[id] = {
        isRepair: repairSet.has(id),
        state: repairInfoState(info, photoCount.get(id) ?? 0),
        // 적은 줄이 **있기만 하면** 참이다(내용이 비어 있어도) — 아이콘 색이 그 값을 본다.
        hasInfo: info !== null,
        hasTransaction: fileSet.has(docName.get(id) ?? ''),
      }
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
      photos: await listPhotos(quoteId),
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

    // 사진 설명 — 저장 버튼이 글자와 함께 보낸다(사진 자체는 고를 때 이미 올라갔다).
    const captions = (body.captions ?? null) as Record<string, unknown> | null
    if (captions && typeof captions === 'object') {
      for (const [k, v] of Object.entries(captions)) {
        const photoId = intOf(k)
        if (photoId === null) continue
        const caption = typeof v === 'string' ? (v.trim().slice(0, CAPTION_MAX) || null) : null
        // 남의 견적 사진을 고치지 못하게 quote_id 를 함께 건다.
        await sb.from('quote_repair_photos').update({ caption }).eq('photo_id', photoId).eq('quote_id', quoteId)
      }
    }

    const { count } = await sb.from('quote_repair_photos')
      .select('photo_id', { count: 'exact', head: true }).eq('quote_id', quoteId)
    return NextResponse.json({ ok: true, state: repairInfoState(fields, count ?? 0) })
  }

  // ── 사진 올리기 ───────────────────────────────────────────────────────────
  if (action === 'photo-add') {
    const quoteId = intOf(body.quoteId)
    if (quoteId === null) return bad('견적을 지정해주세요.')
    const denied = await guardEdit(quoteId, caller)
    if (denied) return denied

    const items = Array.isArray(body.items) ? body.items : []
    if (items.length === 0) return bad('올릴 사진이 없습니다.')

    const { count } = await sb.from('quote_repair_photos')
      .select('photo_id', { count: 'exact', head: true }).eq('quote_id', quoteId)
    const already = count ?? 0
    if (already + items.length > MAX_PHOTOS) {
      return bad(`사진은 ${MAX_PHOTOS}장까지 올릴 수 있습니다 (현재 ${already}장).`)
    }

    // 먼저 전부 검증한다 — 반쯤 올리고 막히는 것보다 시작 전에 막는 편이 낫다
    // (service-attachment 라우트와 같은 차례다).
    const stamp = Date.now()
    const prepared: { path: string; bytes: Buffer; contentType: string }[] = []
    for (let i = 0; i < items.length; i++) {
      const parsed = parsePhoto((items[i] as { dataUrl?: unknown })?.dataUrl)
      if ('error' in parsed) return bad(parsed.error)
      // 경로 규칙은 이 저장소 관행대로 **평평한 이름**이다(폴더를 쓰지 않는다).
      prepared.push({ path: `qr-${quoteId}-${stamp}-${i}.jpg`, ...parsed })
    }

    const uploaded: string[] = []
    for (const p of prepared) {
      const { error } = await sb.storage.from(PHOTO_BUCKET)
        .upload(p.path, p.bytes, { contentType: p.contentType, upsert: false })
      if (error) {
        console.error('[quote-repair-info] 사진 업로드 실패', { quoteId, path: p.path, error })
        // 올라간 것을 되돌린다 — 줄이 없는 파일이 버킷에 남지 않게.
        if (uploaded.length > 0) await sb.storage.from(PHOTO_BUCKET).remove(uploaded)
        return bad('사진을 올리지 못했습니다.', 500)
      }
      uploaded.push(p.path)
    }

    const { error: insErr } = await sb.from('quote_repair_photos').insert(
      uploaded.map((path, i) => ({
        quote_id: quoteId, storage_path: path, caption: null,
        sort_order: already + i, uploaded_by: caller.engineer_id,
      })),
    )
    if (insErr) {
      console.error('[quote-repair-info] 사진 줄 저장 실패', { quoteId, error: insErr })
      await sb.storage.from(PHOTO_BUCKET).remove(uploaded)
      return bad('사진을 올리지 못했습니다.', 500)
    }
    return NextResponse.json({ ok: true, photos: await listPhotos(quoteId) })
  }

  // ── 사진 지우기 ───────────────────────────────────────────────────────────
  if (action === 'photo-delete') {
    const quoteId = intOf(body.quoteId)
    const photoId = intOf(body.photoId)
    if (quoteId === null || photoId === null) return bad('사진을 지정해주세요.')
    const denied = await guardEdit(quoteId, caller)
    if (denied) return denied

    const { data: row } = await sb.from('quote_repair_photos')
      .select('photo_id, storage_path').eq('photo_id', photoId).eq('quote_id', quoteId).maybeSingle()
    if (!row) return bad('사진을 찾을 수 없습니다.', 404)

    // 파일을 먼저 지운다 — 줄만 남으면 화면에서 깨진 사진이 되지만, 파일만 남으면
    // 아무도 모르는 쓰레기가 된다(지울 길이 화면에 없다).
    const { error: rmErr } = await sb.storage.from(PHOTO_BUCKET).remove([row.storage_path])
    if (rmErr) console.error('[quote-repair-info] 저장소 파일 삭제 실패 — 고아 파일이 남는다', { path: row.storage_path, error: rmErr })
    const { error } = await sb.from('quote_repair_photos').delete().eq('photo_id', photoId).eq('quote_id', quoteId)
    if (error) {
      console.error('[quote-repair-info] 사진 줄 삭제 실패', { photoId, error })
      return bad('사진을 지우지 못했습니다.', 500)
    }
    return NextResponse.json({ ok: true, photos: await listPhotos(quoteId) })
  }

  // ── 차례 ──────────────────────────────────────────────────────────────────
  if (action === 'photo-order') {
    const quoteId = intOf(body.quoteId)
    if (quoteId === null) return bad('견적을 지정해주세요.')
    const denied = await guardEdit(quoteId, caller)
    if (denied) return denied

    const ids = Array.isArray(body.photoIds)
      ? body.photoIds.map(intOf).filter((n): n is number => n !== null)
      : []
    if (ids.length === 0) return bad('차례를 알 수 없습니다.')
    for (let i = 0; i < ids.length; i++) {
      await sb.from('quote_repair_photos').update({ sort_order: i }).eq('photo_id', ids[i]).eq('quote_id', quoteId)
    }
    return NextResponse.json({ ok: true })
  }

  // ── 문서 자료 ─────────────────────────────────────────────────────────────
  //
  // 거래명세서·수리내역서가 쓰는 칸을 **한 번에** 돌려준다. 표가 다섯이라(견적·품목·
  // 고객사·담당자·작성자 + 수리 건·수리 정보·사진) 화면이 따로 물으면 왕복이 여덟 번이고,
  // 그중 셋(repairs·contacts·engineers)은 견적 화면 사람들에게 RLS 로 열려 있지도 않다.
  if (action === 'doc-data') {
    const quoteId = intOf(body.quoteId)
    if (quoteId === null) return bad('견적을 지정해주세요.')

    const { data: quote } = await sb.from('quotes')
      .select('quote_id, quote_number, quote_date, status, recipient, recipient_contact_id, customer_id, dealer_id, engineer_id, created_by')
      .eq('quote_id', quoteId).maybeSingle()
    if (!quote) return bad('견적을 찾을 수 없습니다.', 404)

    // 공급받는자 — **대리점 견적이면 최종 사용 업체**가 받는 쪽이다(customer_id 가 그것이다).
    const [{ data: customer }, { data: contact }, { data: engineer }, { data: items }, { data: repair }, { data: info }] = await Promise.all([
      quote.customer_id == null
        ? Promise.resolve({ data: null })
                // 이름은 「회사명 사업장명」으로 나간다 — 회사명은 부모 줄에 있어 함께 읽는다.
        : sb.from('customers').select(`${CUSTOMER_NAME_SELECT}, address`).eq('customer_id', quote.customer_id).maybeSingle(),
      quote.recipient_contact_id == null
        ? Promise.resolve({ data: null })
        : sb.from('contacts').select('name, position, phone').eq('contact_id', quote.recipient_contact_id).maybeSingle(),
      sb.from('engineers').select('name, position, tel, office').eq('engineer_id', quote.created_by ?? quote.engineer_id).maybeSingle(),
      sb.from('quote_items')
        .select('item_id, row_kind, product_name, model_name, part_code, quantity, supply_amount, price_list(model_jp)')
        .eq('quote_id', quoteId).order('item_id', { ascending: true }),
      sb.from('repairs').select(REPAIR_SELECT).eq('quote_id', quoteId).maybeSingle(),
      sb.from('quote_repair_info').select('symptom, cause, result').eq('quote_id', quoteId).maybeSingle(),
    ])

    return NextResponse.json({
      quote,
      // 거래명세서·수리내역서가 그대로 찍는 한 줄 이름(lib/customerLabel.ts).
      customer: customer ? { company_name: customerDisplayName(customer), address: customer.address ?? null } : null,
      contact: contact ?? null,
      engineer: engineer ?? null,
      items: items ?? [],
      repair: repair ?? null,
      info: info ?? null,
      photos: await listPhotos(quoteId),
    })
  }

  // ── 이미 있는 문서 열기 ───────────────────────────────────────────────────
  //
  // 영수증 아이콘이 파란 줄(= 파일이 이미 있다)은 **다시 만들지 않는다** — 20초를 기다릴
  // 까닭이 없고, 한 번 낸 문서를 손도 안 댔는데 새로 찍어 두는 것도 이상하다.
  if (action === 'doc-url') {
    const quoteId = intOf(body.quoteId)
    const kind = body.kind === 'repair' ? 'repair' : body.kind === 'transaction' ? 'transaction' : null
    if (quoteId === null || kind === null) return bad('문서를 지정해주세요.')
    const { data: quote } = await sb.from('quotes').select('quote_number').eq('quote_id', quoteId).maybeSingle()
    if (!quote) return bad('견적을 찾을 수 없습니다.', 404)
    const name = `${(quote.quote_number ?? '').trim().replace(/^No./i, '')}${kind === 'transaction' ? 'T' : 'R'}.pdf`
    const { data: signed } = await sb.storage.from(DOC_BUCKET).createSignedUrl(name, SIGN_TTL)
    return NextResponse.json({ ok: !!signed?.signedUrl, name, url: signed?.signedUrl ?? null })
  }

  // ── 문서 저장 ─────────────────────────────────────────────────────────────
  //
  // 그리는 일은 화면이 한다(견적서 PDF 와 같은 @react-pdf/renderer). 여기서는 **올리기만**
  // 한다 — 파일 이름을 서버가 정해야 남의 견적 번호로 덮어쓰는 길이 막힌다.
  if (action === 'doc-save') {
    const quoteId = intOf(body.quoteId)
    const kind = body.kind === 'repair' ? 'repair' : body.kind === 'transaction' ? 'transaction' : null
    if (quoteId === null || kind === null) return bad('문서를 지정해주세요.')

    const { data: quote } = await sb.from('quotes')
      .select('quote_id, quote_number').eq('quote_id', quoteId).maybeSingle()
    if (!quote) return bad('견적을 찾을 수 없습니다.', 404)

    const raw = typeof body.dataUrl === 'string' ? body.dataUrl : ''
    const m = raw.match(/^data:application\/pdf;base64,([A-Za-z0-9+/=]+)$/)
    if (!m) return bad('문서를 읽지 못했습니다.')
    const bytes = Buffer.from(m[1], 'base64')
    if (bytes.length === 0 || bytes.length > DOC_MAX_BYTES) return bad('문서 크기가 올바르지 않습니다.')

    // 이름은 견적번호에서 만든다(lib/quoteDocs.ts 와 같은 규칙).
    const name = `${(quote.quote_number ?? '').trim().replace(/^No\./i, '')}${kind === 'transaction' ? 'T' : 'R'}.pdf`
    const { error } = await sb.storage.from(DOC_BUCKET)
      .upload(name, bytes, { contentType: 'application/pdf', upsert: true })
    if (error) {
      console.error('[quote-repair-info] 문서 업로드 실패', { quoteId, name, error })
      return bad('문서를 저장하지 못했습니다.', 500)
    }
    const { data: signed } = await sb.storage.from(DOC_BUCKET).createSignedUrl(name, SIGN_TTL)
    return NextResponse.json({ ok: true, name, url: signed?.signedUrl ?? null, bytes: bytes.length })
  }

  return bad('알 수 없는 요청입니다.')
}
