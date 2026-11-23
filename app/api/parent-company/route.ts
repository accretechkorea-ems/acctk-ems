// 회사(부모 업체) 관리 — 이름·분류 수정, 삭제, **병합·사업장 이동·사업장명 수정**.
//
// 2026-11-19: 관리 화면의 「회사 관리」 카드는 걷고, 고객사 **목록 보기**가 이 라우트를
// 부른다. 라우트를 남긴 이유는 아래 두 가지가 화면 쪽에 없기 때문이다 —
//   · 회사 이름이 바뀌면 **자식 사업장의 company_name 도 다시 만들어야 한다**
//     (사업장 줄에는 「회사명 사업장명」이 합쳐져 들어 있다 — lib/customerLabel.ts).
//   · 지우거나 병합하기 직전에 **service role 로 다시 세어** 경합을 막는다.
//
// 라우트로 둔 이유:
//   · 삭제는 되돌릴 수 없고, 사업장이 남아 있으면 그 사업장들의 parent_customer_id 가 끊긴다.
//     화면에서 세는 것만으로는 그 사이에 다른 사람이 업체를 연결했을 때를 막지 못하므로,
//     지우기 직전에 서버가 다시 세어 0 이 아니면 거부한다.
//   · service role 로 세야 RLS·필터에 가려 실제보다 적게 세는 일이 없다.
import { adminClient } from '@/lib/supabase/admin'
import { withNameEnFallback } from '@/lib/nameEn'
import { INDUSTRIES } from '@/lib/leadOptions'
import { loadCaller } from '@/lib/apiCaller'
import { writeCustomerEvents } from '@/lib/customerEvents'
import { NextResponse } from 'next/server'

const supabaseAdmin = adminClient()

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

/** 이 소속회사에 붙어 있는 살아있는 업체 수. 삭제 판정의 유일한 근거다. */
async function childCount(parentId: number): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('customers')
    .select('customer_id', { count: 'exact', head: true })
    .eq('parent_customer_id', parentId)
    .is('deleted_at', null)
  if (error) throw error
  return count ?? 0
}

/**
 * 어떤 회사의 자식 사업장 이름을 **그 회사 이름으로 다시 만든다**.
 * 사업장 줄의 company_name 에는 「회사명 사업장명」이 합쳐져 들어 있다(lib/customerLabel.ts).
 * 회사명이 바뀌거나 사업장이 다른 회사로 옮겨 가면 이 값이 옛 회사명을 들고 남는다.
 */
async function rebuildChildNames(parentId: number, companyName: string): Promise<number> {
  const { data: children } = await supabaseAdmin
    .from('customers')
    .select('customer_id, site_name')
    .eq('parent_customer_id', parentId)
    .is('deleted_at', null)
  let renamed = 0
  for (const child of children ?? []) {
    const site = (child.site_name ?? '').trim()
    const combined = site ? `${companyName} ${site}` : companyName
    const { error } = await supabaseAdmin
      .from('customers').update({ company_name: combined }).eq('customer_id', child.customer_id)
    if (error) console.error('[parent-company] child rename failed', { child: child.customer_id, error })
    else renamed++
  }
  return renamed
}

/**
 * 줄 합치기는 **DB 함수 한 번**이다(db/merge_customer_sites_20261119.sql).
 *
 * customers 를 가리키는 표가 12개라, 화면이나 라우트가 표를 하나씩 옮기면 중간에 끊겼을 때
 * 절반만 옮겨진 상태가 남는다. 함수 한 번은 한 트랜잭션이라 전부 되거나 전부 안 된다.
 * 회사 병합도 사업장 병합도 **같은 함수**를 쓴다 — 규칙을 둘로 두지 않는다.
 */
type MergeReport = {
  keep_id: number
  from_ids: number[]
  dry_run: boolean
  /** 표.칸 → 옮긴(또는 옮길) 줄 수. */
  moved: Record<string, number>
  /** 남길 줄에 이미 같은 짝이 있어 지운 줄(showroom_sites 처럼 customer_id 가 기본키인 표). */
  dropped?: Record<string, number>
  /** 비어 있어 from 값으로 채운 칸. */
  filled?: string[]
  total: number
}

async function mergeRows(keepId: number, fromIds: number[], dryRun: boolean): Promise<{ ok: true; report: MergeReport } | { ok: false; message: string; status: number }> {
  const { data, error } = await supabaseAdmin.rpc('merge_customer_sites', {
    keep_id: keepId, from_ids: fromIds, dry_run: dryRun,
  })
  if (error) {
    console.error('[parent-company] merge rpc failed', { keepId, fromIds, dryRun, error })
    // 함수를 아직 적용하지 않았으면 PostgREST 가 못 찾는다 — 무엇을 해야 하는지 알려 준다.
    if (error.code === 'PGRST202' || /function .*merge_customer_sites/i.test(error.message ?? '')) {
      return { ok: false, status: 501, message: 'DB 함수 merge_customer_sites 가 아직 없습니다 (db/merge_customer_sites_20261119.sql 적용 필요)' }
    }
    return { ok: false, status: 400, message: error.message || '합치지 못했습니다' }
  }
  return { ok: true, report: data as MergeReport }
}

/**
 * 액션마다 문턱이 다르다.
 *
 *   **사업장 수준**(rename-site · move) — 고객사 메뉴를 보는 사람이면 된다.
 *     사업장명·소속은 수정 폼에서도 누구나 고치는 값이다(hooks/customer/useCustomerCrud.ts).
 *     이 둘이 라우트를 거치는 이유는 권한이 아니라 **company_name 을 다시 만들기 위해서**다 —
 *     여기서 superadmin 을 요구하면 평소 하던 수정이 막힌다(2026-11-19 실측에서 403 이었다).
 *
 *   **회사 수준**(rename · merge · delete · convert-agency) — superadmin.
 *     회사 한 줄에 사업장 여럿이 물려 있어, 이름·병합·삭제는 그 전부에 닿는다.
 *
 *   2026-11-23 — **사업장 병합(merge-sites)을 사업장 수준으로 내렸다.** 고객사를 볼 수 있는
 *   사람이면 합칠 수 있다. 되돌릴 수 없는 일이지만 그 때문에 한 사람에게 몰리면 현장이
 *   잘못 들어온 줄을 그대로 두고 쓴다 — 지금까지 「정리 필요 820곳」이 쌓인 까닭이다.
 *   대신 **누가 합쳤는지 사건으로 남긴다**(customer_events 의 sites_merged).
 *   지우는 쪽(delete·convert-agency)은 그대로 superadmin 이다.
 */
const SITE_LEVEL = new Set(['rename-site', 'move', 'merge-sites'])

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const action: string = body?.action ?? ''

  // 인증·권한 — 액션에 맞는 문턱(lib/apiCaller.ts 의 Need 가 그 판정을 한다).
  const { error: authErr, caller } = SITE_LEVEL.has(action)
    ? await loadCaller({ kind: 'menu', keys: ['customers'] }, { tag: 'parent-company', method: 'POST' })
    : await loadCaller({ kind: 'superadmin' }, { tag: 'parent-company', method: 'POST' })
  if (authErr) return authErr

  // ── 사업장 이름만 고치기 — 회사를 지정하지 않는다 ──────────────────────
  //   site_name 을 바꾸고 company_name 을 「회사명 사업장명」으로 다시 만든다.
  //   목록 보기의 사업장 표가 그 자리에서 고칠 때 부른다.
  if (action === 'rename-site') {
    const siteId = Number(body?.siteId)
    if (!Number.isInteger(siteId) || siteId <= 0) return bad('사업장을 지정해주세요.')
    const siteName = typeof body?.siteName === 'string' ? body.siteName.trim() : ''

    const { data: site } = await supabaseAdmin
      .from('customers')
      .select('customer_id, is_parent, parent_customer_id, deleted_at')
      .eq('customer_id', siteId)
      .maybeSingle()
    if (!site || site.deleted_at) return bad('사업장을 찾을 수 없습니다.', 404)
    if (site.is_parent) return bad('회사 줄은 사업장명을 가질 수 없습니다.')

    // 회사 이름을 읽어 합친 이름을 만든다. 회사가 없으면(미연결) 사업장명만 쓴다.
    let companyName = ''
    if (site.parent_customer_id != null) {
      const { data: parent } = await supabaseAdmin
        .from('customers').select('company_name').eq('customer_id', site.parent_customer_id).maybeSingle()
      companyName = (parent?.company_name ?? '').trim()
    }
    const combined = companyName
      ? (siteName ? `${companyName} ${siteName}` : companyName)
      : siteName
    if (!combined) return bad('사업장명을 입력해주세요.')

    const { error } = await supabaseAdmin
      .from('customers')
      .update({ site_name: siteName || null, company_name: combined })
      .eq('customer_id', siteId)
    if (error) {
      console.error('[parent-company] rename-site failed', { siteId, error })
      return bad('사업장명을 수정하지 못했습니다.', 500)
    }
    console.log('[parent-company] rename-site', { siteId, siteName, by: caller.email })
    return NextResponse.json({ success: true, company_name: combined })
  }

  // ── 사업장을 다른 회사로 옮기기 ───────────────────────────────────────
  //   참조(견적·장비·담당자·서비스)는 **사업장에 붙어 있으므로 그대로** 따라간다.
  //   바뀌는 칸은 parent_customer_id 와, 그에 따라 다시 만드는 company_name 둘이다.
  if (action === 'move') {
    const toParentId = Number(body?.toParentId)
    const siteIds: number[] = Array.isArray(body?.siteIds)
      ? body.siteIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0)
      : []
    if (!Number.isInteger(toParentId) || toParentId <= 0) return bad('옮길 회사를 지정해주세요.')
    if (siteIds.length === 0) return bad('옮길 사업장을 고르세요.')

    const { data: to } = await supabaseAdmin
      .from('customers').select('customer_id, company_name, is_parent, deleted_at')
      .eq('customer_id', toParentId).maybeSingle()
    if (!to || to.deleted_at) return bad('옮길 회사를 찾을 수 없습니다.', 404)
    if (!to.is_parent) return bad('회사가 아닙니다.')

    // 회사 줄을 사업장처럼 옮기려는 요청은 막는다(순환이 생긴다).
    const { data: targets } = await supabaseAdmin
      .from('customers').select('customer_id, is_parent, site_name, parent_customer_id').in('customer_id', siteIds)
    if ((targets ?? []).some(t => t.is_parent)) return bad('회사 줄은 옮길 수 없습니다.')
    // 옮기기 **전** 소속 — 사건의 before 다(고친 뒤에는 읽을 수 없다).
    const targetsBefore = targets

    const companyName = (to.company_name ?? '').trim()
    let moved = 0
    for (const t of targets ?? []) {
      const site = (t.site_name ?? '').trim()
      const combined = site ? `${companyName} ${site}` : companyName
      const { error } = await supabaseAdmin
        .from('customers')
        .update({ parent_customer_id: toParentId, company_name: combined })
        .eq('customer_id', t.customer_id)
      if (error) console.error('[parent-company] move failed', { site: t.customer_id, error })
      else moved++
    }
    // 사건 — 어느 회사에서 어느 회사로 옮겼는지. 옮긴 사업장 줄마다 한 줄이다.
    const fromIdsOfMove = new Map<number, number | null>()
    for (const t of targetsBefore ?? []) fromIdsOfMove.set(Number(t.customer_id), t.parent_customer_id ?? null)
    const fromNames = new Map<number, string>()
    const fromSet = [...new Set([...fromIdsOfMove.values()].filter((v): v is number => v != null))]
    if (fromSet.length > 0) {
      const { data: fromRows } = await supabaseAdmin
        .from('customers').select('customer_id, company_name').in('customer_id', fromSet)
      for (const f of fromRows ?? []) fromNames.set(Number(f.customer_id), (f.company_name ?? '').trim())
    }
    await writeCustomerEvents(supabaseAdmin, (targets ?? []).map(t => ({
      customer_id: Number(t.customer_id),
      event_type: 'site_moved' as const,
      occurred_at: new Date().toISOString(),
      actor_engineer_id: caller.engineer_id,
      payload: {
        site_name: (t.site_name ?? '').trim() || null,
        before: fromNames.get(Number(fromIdsOfMove.get(Number(t.customer_id)) ?? -1)) ?? null,
        after: companyName,
      },
    })))
    console.log('[parent-company] move', { toParentId, siteIds, moved, by: caller.email })
    return NextResponse.json({ success: true, moved })
  }

  // ── 사업장 병합 ────────────────────────────────────────────────────────
  //   같은 회사 안의 사업장 여러 줄을 한 줄로 합친다. 회사 병합과 **같은 함수**다.
  //   dryRun=true 면 표별 건수만 세어 돌려준다 — 확인 창이 그 숫자를 보여 준다.
  if (action === 'merge-sites') {
    const keepId = Number(body?.keepId)
    const fromIds: number[] = Array.isArray(body?.fromIds) ? body.fromIds.map(Number).filter(Number.isInteger) : []
    if (!Number.isInteger(keepId) || keepId <= 0) return bad('남길 사업장을 고르세요.')
    if (fromIds.length === 0) return bad('합칠 사업장을 고르세요.')
    if (fromIds.includes(keepId)) return bad('남길 사업장이 합칠 목록에 들어 있습니다.')

    const dryRun = body?.dryRun === true
    const r = await mergeRows(keepId, fromIds, dryRun)
    if (!r.ok) return bad(r.message, r.status)
    if (dryRun) return NextResponse.json({ success: true, report: r.report })

    // 남길 사업장의 이름 — 넘어온 값이 있으면 그것으로, 없으면 지금 값 그대로.
    const siteName = typeof body?.siteName === 'string' ? body.siteName.trim() : null
    const { data: keep } = await supabaseAdmin
      .from('customers').select('customer_id, site_name, parent_customer_id').eq('customer_id', keepId).maybeSingle()
    const parentOfKeep = keep?.parent_customer_id ?? null
    if (parentOfKeep != null) {
      const { data: parentRow } = await supabaseAdmin
        .from('customers').select('company_name').eq('customer_id', parentOfKeep).maybeSingle()
      const company = (parentRow?.company_name ?? '').trim()
      const nextSite = siteName != null ? siteName : (keep?.site_name ?? '').trim()
      const { error: upErr } = await supabaseAdmin.from('customers').update({
        site_name: nextSite || null,
        company_name: nextSite ? `${company} ${nextSite}` : company,
      }).eq('customer_id', keepId)
      if (upErr) console.error('[parent-company] merge-sites rename failed', { keepId, error: upErr })
    }
    // 사건 — **남은 줄에** 한 줄 적는다. 합쳐진 줄은 사라지므로 거기에 적으면 읽을 수 없다.
    await writeCustomerEvents(supabaseAdmin, [{
      customer_id: keepId,
      event_type: 'sites_merged' as const,
      occurred_at: new Date().toISOString(),
      actor_engineer_id: caller.engineer_id,
      payload: {
        kept: (keep?.site_name ?? '').trim() || null,
        merged_ids: fromIds,
        merged_count: fromIds.length,
        moved: r.report ?? null,
      },
    }])
    console.log('[parent-company] merge-sites', { keepId, fromIds, report: r.report, by: caller.email })
    return NextResponse.json({ success: true, report: r.report })
  }
  const parentId = Number(body?.parentId)
  if (!Number.isInteger(parentId) || parentId <= 0) return bad('회사를 지정해주세요.')

  // 대상이 실제로 소속회사인지 확인한다 — 일반 업체 행이 이 라우트로 지워지면 안 된다.
  const { data: target } = await supabaseAdmin
    .from('customers')
    .select('customer_id, company_name, is_parent, deleted_at')
    .eq('customer_id', parentId)
    .maybeSingle()
  if (!target || target.deleted_at) return bad('회사를 찾을 수 없습니다.', 404)
  if (!target.is_parent) return bad('회사가 아닙니다.')

  // ── 이름·분류 수정 ──
  if (action === 'rename') {
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    if (!name) return bad('회사명을 입력해주세요.')
    // 분류는 리드 등록과 **같은 목록**이다(lib/leadOptions.ts) — 폼을 우회한 값을 여기서 막는다.
    const industry = typeof body?.industry === 'string' ? body.industry.trim() : ''
    // 영문 회사명 — 선택 입력이다. 보내지 않으면 지금 값을 그대로 둔다.
    const nameEn = typeof body?.nameEn === 'string' ? body.nameEn.trim() : null
    if (industry && !INDUSTRIES.includes(industry)) return bad('분류 값이 올바르지 않습니다.')

    // 같은 이름의 소속회사가 이미 있으면 막는다(자기 자신은 제외).
    const { data: dup } = await supabaseAdmin
      .from('customers')
      .select('customer_id')
      .eq('is_parent', true)
      .is('deleted_at', null)
      .eq('company_name', name)
      .neq('customer_id', parentId)
    if (dup && dup.length > 0) return bad('같은 이름의 회사가 이미 있습니다.')

    const { error } = await withNameEnFallback(useEn => supabaseAdmin
      .from('customers')
      .update({
        company_name: name,
        ...(body?.industry === undefined ? null : { industry: industry || null }),
        // 영문명 칸이 없는 DB 면 이름·분류만 고친다(그 칸은 SQL 을 적용한 뒤에 쓰인다).
        ...(nameEn === null || !useEn ? null : { name_en: nameEn || null }),
      })
      .eq('customer_id', parentId))
    if (error) {
      console.error('[parent-company] rename failed', { parentId, error })
      return bad('이름을 수정하지 못했습니다.', 500)
    }

    // 사업장 줄의 이름도 함께 고친다 — 자세한 까닭은 rebuildChildNames 의 주석에.
    const renamed = await rebuildChildNames(parentId, name)
    console.log('[parent-company] rename', { parentId, from: target.company_name, to: name, renamed, by: caller.email })
    return NextResponse.json({ success: true, renamedSites: renamed })
  }

  // ── 병합 ──────────────────────────────────────────────────────────────
  //   target(parentId) 을 into(intoParentId) 로 합친다.
  //     · 자식 사업장을 전부 옮기고 이름을 다시 만든다.
  //     · industry·name_en·note 는 **남는 쪽이 비어 있을 때만** 가져온다
  //       (살아 있는 값을 덮지 않는다).
  //     · 지워지는 회사 줄은 **soft delete**(deleted_at) — 되돌리기는 없다고 알린다.
  if (action === 'merge') {
    const intoId = Number(body?.intoParentId)
    if (!Number.isInteger(intoId) || intoId <= 0) return bad('합칠 회사를 지정해주세요.')
    if (intoId === parentId) return bad('같은 회사끼리는 합칠 수 없습니다.')

    const { data: into } = await supabaseAdmin
      .from('customers').select('customer_id, company_name, is_parent, deleted_at')
      .eq('customer_id', intoId).maybeSingle()
    if (!into || into.deleted_at) return bad('합칠 회사를 찾을 수 없습니다.', 404)
    if (!into.is_parent) return bad('합칠 대상이 회사가 아닙니다.')

    // 자식 이동·빈 칸 채우기·soft delete 를 DB 함수가 한 트랜잭션으로 한다.
    const r = await mergeRows(intoId, [parentId], body?.dryRun === true)
    if (!r.ok) return bad(r.message, r.status)
    if (r.report.dry_run) return NextResponse.json({ success: true, report: r.report })

    // 옮겨 온 사업장의 이름을 받는 회사 이름으로 다시 만든다.
    const renamed = await rebuildChildNames(intoId, (into.company_name ?? '').trim())
    console.log('[parent-company] merge', { from: parentId, into: intoId, renamed, report: r.report, by: caller.email })
    return NextResponse.json({ success: true, movedSites: renamed, report: r.report })
  }

  /**
   * ── 대리점으로 전환 ──
   *
   * 회사 줄을 닫고 그 **하나뿐인 사업장 줄**을 대리점으로 바꾼다. 판정과 바꾸기를
   * DB 함수 한 번(한 트랜잭션)이 한다 — db/convert_company_to_agency_20261121.sql.
   * 라우트가 다시 세지 않는 이유: 그 함수가 service role 로 **자기 트랜잭션 안에서**
   * 세므로, 여기서 센 값과 어긋날 틈이 없다.
   *
   *   dryRun: true  — 검사만. 막히면 막는 참조 목록을, 괜찮으면 따라갈 것들의 건수를.
   *   dryRun: false — 전환. 돌아온 값에 새 대리점의 id(site_id)가 있다.
   */
  if (action === 'convert-agency') {
    const dryRun = body?.dryRun !== false
    const { data, error } = await supabaseAdmin.rpc('convert_company_to_agency', {
      p_company_id: parentId, p_dry_run: dryRun,
    })
    if (error) {
      console.error('[parent-company] convert rpc failed', { parentId, dryRun, error })
      // 함수를 아직 적용하지 않았으면 PostgREST 가 못 찾는다 — 무엇을 해야 하는지 알려 준다.
      if (error.code === 'PGRST202' || /function .*convert_company_to_agency/i.test(error.message ?? '')) {
        return bad('DB 함수 convert_company_to_agency 가 아직 없습니다 (db/convert_company_to_agency_20261121.sql 적용 필요)', 501)
      }
      // 함수가 raise 한 사유(사업장이 2곳 이상·이미 대리점…)를 그대로 올린다.
      return bad(error.message || '전환하지 못했습니다', 400)
    }
    const report = data as { ok?: boolean; site_id?: number }
    if (!dryRun && report?.ok) {
      console.log('[parent-company] convert-agency', { parentId, siteId: report.site_id, by: caller.email })
    }
    return NextResponse.json({ success: true, report })
  }

  // ── 삭제 ──
  if (action === 'delete') {
    let children: number
    try {
      children = await childCount(parentId)
    } catch (e) {
      console.error('[parent-company] child count failed', { parentId, error: e })
      return bad('사업장 수를 확인하지 못했습니다.', 500)
    }
    // 화면에서 이미 걸렀더라도 여기서 다시 센다 — 그 사이에 업체가 연결됐을 수 있다.
    if (children > 0) return bad(`사업장 ${children}곳이 연결되어 있습니다.`, 409)

    const { error } = await supabaseAdmin
      .from('customers').delete().eq('customer_id', parentId)
    if (error) {
      console.error('[parent-company] delete failed', { parentId, error })
      return bad('삭제하지 못했습니다.', 500)
    }
    console.log('[parent-company] delete', { parentId, name: target.company_name, by: caller.email })
    return NextResponse.json({ success: true })
  }

  return bad('알 수 없는 요청입니다.')
}
