// 서버 라우트의 **호출자 확인 한 벌** — 「누가 불렀나 · 그 사람이 이 일을 해도 되나」.
//
// 왜 모으는가(docs/audit-2026-10.md D10 · 2026-11-02 전수 조사).
//   라우트 53개가 같은 일을 **제각각** 하고 있었다. 전처리에만 629줄(라우트당 평균 11.9줄)이
//   들어가고, 그 과정에서 네 가지가 갈렸다.
//     (가) 팀 권한 신선도 — 같은 'quote' 판정인데 어디는 캐시(30초), 어디는 새로 읽는다.
//          권한을 끈 직후 30초 동안 견적 PDF 는 열리고 견적 작성은 막혔다.
//     (나) 호출자 행을 읽는 클라이언트 — 세션(RLS 적용) 41개 vs service role 6개.
//          engineers 의 GRANT 를 조이면 세션으로 읽는 쪽만 조용히 403 이 된다.
//     (다) 「본인인가」의 칸 이름이 7가지, 비교가 28곳에 인라인으로 흩어져 있다.
//     (라) 퇴사 확인이 8/53 뿐이다.
//   이 파일은 그 넷을 **규칙으로 못 박는다.** 라우트 교체는 D11~D14 에서 묶음별로 한다 —
//   지금은 함수와 하네스만 둔다(라우트는 한 줄도 바꾸지 않았다).
//
// ── 정한 것 ────────────────────────────────────────────────────────────────
//   ① engineers 는 **service role 로 읽는다.** 판정 자료가 RLS·GRANT 에 막혀 비면
//      「권한 없음」으로 떨어지는데, 그것은 판정이 아니라 사고다(lib/semiContactServer.ts 가
//      이미 같은 선택을 하고 그 이유를 적어 두었다).
//   ② **퇴사자는 기본 차단.** 결재 계열 8개만 보던 검사를 전체 기준으로 올린다.
//      퇴사 처리는 email 을 null 로 지우므로(app/api/delete-user) 조회 자체가 비는 것이
//      보통이지만, 그것은 **우연히 안전한 것**이라 규칙으로 둔다.
//   ③ **신선도는 메서드가 정한다** — 쓰기는 새로 읽고(fresh), GET 은 캐시(30초).
//      메서드를 알 수 없으면 새로 읽는다(낡은 판정이 **허용**으로 기울지 않게).
//   ④ **service role 클라이언트를 함께 돌려준다**(sb). 라우트가 또 만들지 않는다 —
//      지금 38곳이 각자 createClient 를 부른다(D15).
//   ⑤ 401·403 응답 모양은 지금 쓰는 그대로다 — `{ error: 'Unauthorized' }`(401) ·
//      `{ error: 'Forbidden' }`(403). 46곳·72곳이 이 문구라, 화면·측정 도구가 그대로 돈다.
//
// ── 판정 실패는 403, 조회 실패도 403 ──────────────────────────────────────
//   호출자 행을 **읽지 못했을 때**도 403 이다(fail-closed). 500 으로 돌리면 「서버 탓」처럼
//   보이지만, 열람 판정이 실패를 허용으로 떨어뜨리는 것보다 낫다
//   (lib/approval/docAccess.ts 가 같은 규칙을 쓴다).

import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { canViewMenu, isSuperAdmin, type EngineerLike } from '@/lib/permissions'
import { canAccessSemiContact } from '@/lib/division'
import { sessionEmailForRead } from '@/lib/sessionEmail'
import { withTeamPerm as realWithTeamPerm } from '@/lib/teamPermsServer'

/** 무엇을 요구하는가. 라우트가 이것 하나만 적는다. */
export type Need =
  /** 로그인한 직원이면 된다(환율·본인 자료 등). */
  | { kind: 'login' }
  /** 메뉴 권한 — **하나라도** 통과하면 된다(`/api/device-image` 의 고객사 ‖ 쇼룸). */
  | { kind: 'menu'; keys: string[] }
  /** 관리자 전용(canManageEngineers 와 같은 판정이다). */
  | { kind: 'superadmin' }
  /** 접촉 보고서 — 사업부 + contact_semi(lib/division.ts). */
  | { kind: 'semi' }
  /** 사람이 아니라 Cron 이 부른다 — CRON_SECRET 헤더만 본다. */
  | { kind: 'cron' }

/** 판정과 라우트 본문이 함께 쓰는 호출자. engineers 한 행 + 팀 권한. */
export type Caller = EngineerLike & {
  engineer_id: number
  name: string | null
  position: string | null
  email: string
  resigned_date: string | null
  can_switch_division: boolean | null
}

/** 호출자 행에서 읽는 칸 — 판정에 필요한 것만. */
export const CALLER_COLUMNS =
  'engineer_id, name, position, email, permission_level, teams, resigned_date, can_switch_division'

/** 최소한의 요청 모양 — NextRequest 를 그대로 넘기면 된다(시험에서는 가짜를 넘긴다). */
export type RequestLike = {
  method?: string
  headers: { get(name: string): string | null }
}

/** 바깥 사정 — 시험에서 갈아끼운다. 라우트는 넘기지 않는다. */
export type CallerDeps = {
  /** 로그인 확인용 세션 클라이언트. */
  session: () => Promise<{
    auth: {
      getUser: () => Promise<{ data: { user: { email?: string | null } | null } }>
      getClaims?: () => Promise<{ data: { claims?: Record<string, unknown> } | null; error: unknown }>
    }
  }>
  /** service role 클라이언트. */
  admin: () => SupabaseClient
  /** 팀 권한 부착. */
  withTeamPerm: <T extends EngineerLike>(e: T | null, opts?: { fresh?: boolean }) => Promise<T | null>
  /** Cron 비밀값. */
  cronSecret: () => string | undefined
}

export type LoadOptions = {
  /** 로그에 찍는 라우트 이름. 'showroom/requests' 처럼 짧게. */
  tag: string
  /** 팀 권한 캐시를 건너뛸까. 적지 않으면 메서드가 정한다(위 ③). */
  fresh?: boolean
  /**
   * 읽기 전용 — 토큰을 **그 자리에서** 검증한다(Auth 서버 왕복 없음. 측정 291~631ms).
   * **쓰기에는 쓰지 않는다** — 로컬 검증은 「로그아웃했지만 아직 만료되지 않은 토큰」을
   * 걸러내지 못한다(lib/sessionEmail.ts). 쓰기 메서드와 함께 오면 **무시하고** 경고를 남긴다.
   */
  readOnly?: boolean
  /** 요청. need 가 'cron' 이면 **반드시** 넘긴다(헤더를 본다). 그 밖에는 메서드를 읽는 데만 쓴다. */
  req?: RequestLike
  /** req 를 넘기지 않는 라우트가 메서드만 알려줄 때. */
  method?: string
  /** 시험용. */
  deps?: Partial<CallerDeps>
}

export type LoadFail = { error: NextResponse; caller: null; sb: null }
export type LoadOk = { error: null; caller: Caller; sb: SupabaseClient }
/** Cron 은 사람이 없다 — caller 가 null 이다. */
export type LoadCron = { error: null; caller: null; sb: SupabaseClient }

const unauthorized = (): NextResponse => NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
const forbidden = (): NextResponse => NextResponse.json({ error: 'Forbidden' }, { status: 403 })

/** 읽기만 하는 메서드 — 이때만 팀 권한 캐시를 쓴다. */
const READ_METHODS = ['GET', 'HEAD', 'OPTIONS']

/**
 * 팀 권한을 새로 읽을까 — **쓰기면 새로, 읽기면 캐시.**
 * 메서드를 모르면 새로 읽는다(낡은 판정이 허용으로 기울지 않게).
 */
export function freshFor(method: string | null | undefined, explicit?: boolean): boolean {
  if (explicit !== undefined) return explicit
  if (!method) return true
  return !READ_METHODS.includes(method.toUpperCase())
}

const defaultDeps: CallerDeps = {
  // 세션 클라이언트는 next/headers 를 쓴다 — 요청 밖(하네스)에서 모듈을 읽기만 할 때
  // 끌려 들어오지 않게 **부를 때** 가져온다.
  session: async () => {
    const mod = await import('@/lib/supabase/server')
    return mod.createClient()
  },
  admin: () => createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  ),
  withTeamPerm: realWithTeamPerm,
  cronSecret: () => process.env.CRON_SECRET,
}

/**
 * 요구(need)를 호출자가 만족하는가 — **순수 판정**. 조회가 끝난 뒤 이것만 본다.
 * 하네스가 그대로 돌린다.
 */
export function meetsNeed(need: Need, caller: Caller): boolean {
  switch (need.kind) {
    case 'login': return true
    case 'superadmin': return isSuperAdmin(caller)
    case 'semi': return canAccessSemiContact(caller)
    // 키를 **하나라도** 통과하면 된다. 빈 목록은 거부한다 —
    // 실수로 keys: [] 를 넘겼을 때 통과하는 것이 가장 나쁘다.
    case 'menu': return need.keys.length > 0 && need.keys.some(k => canViewMenu(caller, k))
    // cron 은 사람 판정이 없다(여기 오지 않는다).
    case 'cron': return false
  }
}

/**
 * 호출자 확인 한 벌.
 *
 *   const { error, caller, sb } = await loadCaller({ kind: 'menu', keys: ['showroom'] }, { tag: TAG, req })
 *   if (error) return error
 *   // 여기서부터 caller 는 재직 중인 직원이고, sb 는 service role 이다.
 *
 * Cron 라우트만 caller 가 null 이다 — 타입이 그렇게 좁혀진다.
 */
export async function loadCaller<N extends Need>(
  need: N,
  opts: LoadOptions,
): Promise<N extends { kind: 'cron' } ? (LoadFail | LoadCron) : (LoadFail | LoadOk)> {
  const deps: CallerDeps = { ...defaultDeps, ...opts.deps }
  const method = opts.method ?? opts.req?.method
  const fresh = freshFor(method, opts.fresh)
  // readOnly 가 되는지는 **메서드**가 정한다 — fresh 를 손으로 덮었다고 바뀌지 않는다.
  const isWrite = method ? !READ_METHODS.includes(method.toUpperCase()) : true
  const fail = (error: NextResponse): LoadFail => ({ error, caller: null, sb: null })

  // ── Cron — 사람이 없다. 비밀값만 본다 ──
  if (need.kind === 'cron') {
    const secret = deps.cronSecret()
    if (!secret) {
      console.error(`[${opts.tag}] CRON_SECRET 이 없어 Cron 호출을 받지 않는다`)
      return out(fail(NextResponse.json({ error: 'Not configured' }, { status: 503 })))
    }
    const given = opts.req?.headers.get('authorization')
    if (given !== `Bearer ${secret}`) return out(fail(unauthorized()))
    return out({ error: null, caller: null, sb: deps.admin() } as LoadCron)
  }

  // ── 사람 ──
  const session = await deps.session()
  const email = opts.readOnly && !isWrite
    // readOnly 는 **읽기 메서드에서만** 쓴다(위 LoadOptions.readOnly 설명).
    ? await sessionEmailForRead(session as Parameters<typeof sessionEmailForRead>[0])
    : (await session.auth.getUser()).data.user?.email ?? null
  if (opts.readOnly && isWrite) {
    console.warn(`[${opts.tag}] readOnly 는 읽기 메서드에서만 쓴다 — 이번에는 getUser 로 확인했다`, { method })
  }
  if (!email) return out(fail(unauthorized()))

  const sb = deps.admin()
  const { data, error } = await sb
    .from('engineers')
    .select(CALLER_COLUMNS)
    .eq('email', email)
    .maybeSingle()
  if (error) {
    // 판정 자료를 못 읽었다 — 허용으로 떨어뜨리지 않는다(머리말).
    console.error(`[${opts.tag}] caller lookup failed`, { email, error })
    return out(fail(forbidden()))
  }
  const row = (data ?? null) as (Caller & { resigned_date: string | null }) | null
  if (!row) return out(fail(forbidden()))
  // 퇴사자는 막는다. 퇴사 처리가 email 을 지우므로 보통은 위에서 이미 비지만,
  // 그것은 우연히 안전한 것이라 여기서 규칙으로 둔다.
  if (row.resigned_date) return out(fail(forbidden()))

  const caller = await deps.withTeamPerm(row, { fresh })
  if (!caller) return out(fail(forbidden()))
  if (!meetsNeed(need, caller)) return out(fail(forbidden()))

  return out({ error: null, caller, sb } as LoadOk)
}

/**
 * 돌려주는 모양을 조건부 반환 타입에 맞춘다.
 * 구현은 한 벌(LoadFail | LoadOk | LoadCron)이고, 부르는 쪽에서는 need 에 따라 좁혀진다 —
 * 그 둘을 잇는 자리라 여기 한 번만 캐스팅한다.
 */
function out<T>(r: LoadFail | LoadOk | LoadCron): T {
  return r as T
}

// ════════════════════════════════════════════════════════════════
// 「본인인가」 — 칸 이름 7가지를 한 곳에서
// ════════════════════════════════════════════════════════════════

/**
 * 소유자 칸의 **우선순위**. 앞쪽 칸이 값으로 들어 있으면 그 칸만 본다.
 *
 * 왜 순서가 필요한가 — 견적은 `created_by ?? engineer_id` 다(app/api/quote-duplicate).
 * 대필로 쓴 견적은 **실적 담당자(engineer_id)가 아니라 대필한 사람(created_by)의 것**이다.
 * 아무 칸이나 하나라도 맞으면 참으로 하면 그 규칙이 깨진다.
 */
export const OWNER_COLUMNS = [
  'created_by', 'requester_id', 'author_id', 'uploaded_by', 'owner_id', 'assigned_to', 'engineer_id',
] as const

export type OwnerColumn = (typeof OWNER_COLUMNS)[number]

/** 그 줄의 소유자 번호와 어느 칸에서 읽었는지. 소유자 칸이 없으면 null. */
export function ownerOf(row: unknown): { id: number; column: OwnerColumn } | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  for (const column of OWNER_COLUMNS) {
    const v = r[column]
    if (v === undefined || v === null) continue
    const id = Number(v)
    if (!Number.isInteger(id) || id <= 0) continue
    return { id, column }
  }
  return null
}

/**
 * 그 줄이 이 사람 것인가 — 28곳에 흩어진 인라인 비교를 대신한다.
 * **소유자 칸이 아예 없으면 거짓이다**(모르는 줄을 본인 것으로 보지 않는다).
 */
export function isOwner(row: unknown, caller: Pick<Caller, 'engineer_id'> | null | undefined): boolean {
  if (!caller || !Number.isInteger(caller.engineer_id)) return false
  const owner = ownerOf(row)
  return owner !== null && owner.id === caller.engineer_id
}

/** 본인이거나 관리자인가 — 수정·삭제 권한에서 가장 많이 쓰는 모양(28곳 중 19곳). */
export function isOwnerOrSuperAdmin(row: unknown, caller: Caller | null | undefined): boolean {
  return isOwner(row, caller) || isSuperAdmin(caller)
}
