// 관리자 행위 기록 — **서버 라우트에서만** 부른다 (2026-11-27 야간3 4).
//
//   await writeAdminEvent(sb, { actorId: caller.engineer_id, action: 'password_reset',
//                               targetType: 'engineer', targetId: String(id),
//                               detail: { email, forced } })
//
// ── 표가 아직 없어도 돈다 ──────────────────────────────────────────────────
//   db/admin_events_20261127.sql 을 적용하기 전에는 42P01/PGRST205 가 난다. 그때는
//   **서버 로그 한 줄**로 떨어진다 — 기록이 없는 것보다 낫고, 본 일(비밀번호 초기화 등)을
//   막지도 않는다. 적용하면 그다음부터 표에 쌓인다.
//
// ── 비밀번호 값은 절대 담지 않는다 ────────────────────────────────────────
//   detail 에 넣는 것은 「누구에게·언제·무엇을」뿐이다. 아래 SECRET_KEYS 에 걸리는 열쇠는
//   값을 지우고 적는다 — 부르는 쪽이 실수로 넣어도 표에는 남지 않는다.

import type { SupabaseClient } from '@supabase/supabase-js'

/** 적는 일 — 코드가 정본이다(SQL 머리말과 같은 낱말). */
export const ADMIN_ACTIONS = [
  'password_reset',
  'engineer_updated',
  'division_switched',
  'customer_restored',
  'team_created',
  'team_deleted',
  'quote_revived',
] as const
export type AdminAction = (typeof ADMIN_ACTIONS)[number]

/** 값이 들어오면 안 되는 열쇠 — 들어와도 지우고 적는다. */
export const SECRET_KEYS = ['password', 'temp_password', 'tempPassword', 'token', 'secret', 'key']

/** detail 에서 비밀을 턴다. 중첩은 한 겹만 본다(기록은 얕게 적는 것이 규칙이다). */
export function scrubDetail(detail: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(detail ?? {})) {
    if (SECRET_KEYS.some(s => k.toLowerCase().includes(s.toLowerCase()))) continue
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? scrubDetail(v as Record<string, unknown>) : v
  }
  return out
}

export type AdminEventInput = {
  actorId: number | null
  action: AdminAction
  targetType?: string | null
  /** 표마다 타입이 달라 **글자**로 적는다(정수·uuid·팀 이름). */
  targetId?: string | number | null
  detail?: Record<string, unknown>
}

/** 그 오류가 「표가 아직 없다」인가. */
const tableMissing = (err: unknown): boolean => {
  const code = (err as { code?: string } | null)?.code
  return code === '42P01' || code === 'PGRST205' || code === 'PGRST204'
}

/**
 * 한 줄 적는다. **던지지 않는다** — 기록을 못 적었다고 본 일을 되돌리지 않는다.
 * 돌려주는 값: 'written' · 'logged'(표가 없어 콘솔로) · 'failed'.
 */
export async function writeAdminEvent(
  sb: SupabaseClient,
  input: AdminEventInput,
): Promise<'written' | 'logged' | 'failed'> {
  const row = {
    actor_engineer_id: input.actorId ?? null,
    action: input.action,
    target_type: input.targetType ?? null,
    target_id: input.targetId == null ? null : String(input.targetId),
    detail: scrubDetail(input.detail ?? {}),
  }
  try {
    const { error } = await sb.from('admin_events').insert(row)
    if (!error) return 'written'
    if (tableMissing(error)) {
      // 표가 아직 없다 — 서버 로그로 떨어진다(db/admin_events_20261127.sql 적용 전).
      console.log('[adminEvent]', JSON.stringify(row))
      return 'logged'
    }
    console.error('[adminEvent] 적지 못했다 — 본 일은 그대로다', error)
    return 'failed'
  } catch (e) {
    console.error('[adminEvent] 적지 못했다 — 본 일은 그대로다', e)
    return 'failed'
  }
}
