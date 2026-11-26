// 비밀번호 **초기화** — 관리자가 직원의 비밀번호를 임시값으로 바꾼다 (2026-11-26).
//
// ── 왜 라우트인가 ──────────────────────────────────────────────────────────
//   남의 비밀번호를 바꾸는 일은 `auth.admin.updateUserById` 라 **service role** 이 필요하다.
//   그 열쇠는 브라우저에 내려가면 안 된다 — 서버만 쥔다.
//
// ── 임시 비밀번호를 다루는 규칙 ────────────────────────────────────────────
//   ① **서버가 만든다**(lib/tempPassword.ts). 브라우저가 만들어 보내면 그 값이 네트워크에
//     한 번 더 떠다니고, 「누가 만든 값인가」도 알 수 없다.
//   ② **한 번만 돌려준다.** 응답 말고는 어디에도 남기지 않는다 — DB 에도, 로그에도 없다.
//     (아래 로그 줄을 보면 값이 없다. 일부러 그렇다. 여기에 값을 넣지 마라.)
//   ③ 받은 사람은 그것으로 한 번 들어와 **제 비밀번호로 바꿔야** 한다 —
//     `engineers.must_change_password = true` 가 그 떠밀기를 켠다.
//
// ── 칸이 아직 없으면 ───────────────────────────────────────────────────────
//   `must_change_password` 는 db/must_change_password_20261126.sql 로 더한다.
//   없으면(42703) **비밀번호만 바꾸고** 표식은 조용히 건너뛴다 — 초기화 자체는 되어야 한다.
//   응답의 `forced` 가 그 사실을 알려 주고, 화면이 한 줄로 덧붙인다.

import { loadCaller } from '@/lib/apiCaller'
import { writeAdminEvent } from '@/lib/adminEvents'
import { NextResponse } from 'next/server'
import { makeTempPassword } from '@/lib/tempPassword'

const TAG = 'admin/reset-password'

/** 칸·표가 아직 없다는 뜻인가 — 그때는 조용히 건너뛴다. */
const schemaMissing = (code?: string): boolean =>
  code === '42703' || code === 'PGRST204' || code === 'PGRST205' || code === '42P01'

export async function POST(req: Request) {
  // 권한 — 직원 계정을 다루는 자리와 **같은 판정**이다(lib/permissions.ts 의
  // canManageEngineers = superadmin). 이 앱의 등급은 superadmin·member 둘뿐이다.
  const { error: authErr, caller, sb } = await loadCaller({ kind: 'superadmin' }, { tag: TAG, method: 'POST' })
  if (authErr) return authErr

  const body = await req.json().catch(() => ({}))
  const engineerId = Number((body as { engineer_id?: unknown }).engineer_id)
  if (!Number.isInteger(engineerId) || engineerId <= 0) {
    return NextResponse.json({ error: '직원을 찾지 못했습니다' }, { status: 400 })
  }

  // 누구의 것인가 — 이름·이메일을 먼저 읽는다(화면에 보여 줄 이름이고, 계정도 이메일로 찾는다).
  const { data: target, error: readErr } = await sb
    .from('engineers')
    .select('engineer_id, name, email, resigned_date')
    .eq('engineer_id', engineerId)
    .maybeSingle()
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
  if (!target?.email) return NextResponse.json({ error: '직원을 찾지 못했습니다' }, { status: 404 })

  // 로그인 계정을 찾는다. auth 쪽은 이메일로 거를 수 있다.
  const { data: list, error: listErr } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 })
  const user = list.users.find(u => (u.email ?? '').toLowerCase() === target.email.toLowerCase())
  if (!user) return NextResponse.json({ error: '이 직원의 로그인 계정을 찾지 못했습니다' }, { status: 404 })

  const tempPassword = makeTempPassword()

  const { error: setErr } = await sb.auth.admin.updateUserById(user.id, { password: tempPassword })
  if (setErr) return NextResponse.json({ error: setErr.message }, { status: 500 })

  // 표식 — 칸이 없으면 건너뛴다(초기화는 이미 됐다).
  let forced = true
  const { error: flagErr } = await sb
    .from('engineers')
    .update({ must_change_password: true })
    .eq('engineer_id', engineerId)
  if (flagErr) {
    if (!schemaMissing(flagErr.code)) {
      console.error(`[${TAG}] 강제 변경 표식을 켜지 못했다`, { engineerId, code: flagErr.code })
    }
    forced = false
  }

  // ── 사건 기록 ──
  // **누가 · 누구를 · 언제**만 남긴다. 임시 비밀번호는 **적지 않는다** —
  // 로그는 오래 남고 여러 사람이 본다. 여기에 값을 넣지 마라.
  console.log(`[${TAG}] 비밀번호 초기화`, {
    by: caller.engineer_id, byName: caller.name,
    target: engineerId, targetName: target.name,
    at: new Date().toISOString(),
    forced,
  })

  // 관리자 기록표에도 한 줄 (2026-11-27 야간3 4). ⚠ **값은 넣지 않는다** —
  // writeAdminEvent 가 비밀 열쇠를 한 번 더 턴다(lib/adminEvents.ts 의 scrubDetail).
  await writeAdminEvent(sb, {
    actorId: caller.engineer_id, action: 'password_reset',
    targetType: 'engineer', targetId: engineerId,
    detail: { targetName: target.name, forced },
  })

  // 관리자 기록표에도 한 줄 (2026-11-27 야간3 4). ⚠ **값은 넣지 않는다** —
  // writeAdminEvent 가 비밀 열쇠를 한 번 더 턴다(lib/adminEvents.ts 의 scrubDetail).
  await writeAdminEvent(sb, {
    actorId: caller.engineer_id, action: 'password_reset',
    targetType: 'engineer', targetId: engineerId,
    detail: { targetName: target.name, forced },
  })

  // 임시 비밀번호는 **이 응답에만** 있다. 화면이 한 번 보여 주고 버린다.
  return NextResponse.json({ ok: true, tempPassword, name: target.name, forced })
}
