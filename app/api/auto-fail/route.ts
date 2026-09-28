// 유효기간이 지난 견적을 자동으로 미수주(status '실패') 처리한다.
//
// 기준은 lib/quoteStatus.ts 의 quoteExpiry — 작성일 + 1개월 − 1일이며, 견적서 PDF 에 찍히는
// 「작성일로부터 1개월」 문구와 같다. 예전에는 이 라우트만 30일을 세어 31일 달에 하루가 어긋났다.
//
// 부르는 길이 둘이다.
//   GET  — Vercel Cron(하루 한 번). Authorization: Bearer <CRON_SECRET> 로만 통과한다.
//   POST — 화면에서 부르는 기존 경로. 로그인한 superadmin 만(canManageEngineers).
// 둘 다 같은 함수(sweep)를 쓴다 — 처리 규칙이 갈리지 않게.
//
// 만료 여부는 SQL 로 자르지 않고 읽어 온 뒤 코드에서 판정한다. quoteExpiry 는 달마다 길이가
// 다른 월 단위 계산이라 `quote_date < 오늘-30일` 같은 한 줄로는 정확히 표현되지 않는다.
// '견적중' 건만 읽으므로 양이 적다(전체 견적의 일부).

import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { canManageEngineers } from '@/lib/permissions'
import { todayKST } from '@/lib/date'
import { AUTO_FAIL_REASON, FAIL_STATUS, PENDING_STATUS, isExpired } from '@/lib/quoteStatus'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/** 국내수리 견적은 '견적중' 을 거치지 않는 별도 흐름이라 자동 실주 대상이 아니다. */
const SKIP_QUOTE_TYPE = 'repair_domestic'

type SweepResult = { updated: number; checked: number; ids: number[] }

/** 유효기간이 지난 '견적중' 견적을 미수주로 바꾼다. 실패하면 던진다(부른 쪽이 500 을 낸다). */
async function sweep(): Promise<SweepResult> {
  const today = todayKST()

  // NULL 을 살리기 위해 neq 대신 or(is null) 로 처리한다.
  const { data, error } = await supabaseAdmin
    .from('quotes')
    .select('quote_id, quote_date')
    .eq('status', PENDING_STATUS)
    .or(`quote_type.is.null,quote_type.neq.${SKIP_QUOTE_TYPE}`)
  if (error) throw error

  const rows = (data ?? []) as { quote_id: number; quote_date: string | null }[]
  const ids = rows.filter(q => isExpired(q.quote_date, today)).map(q => q.quote_id)
  if (ids.length === 0) return { updated: 0, checked: rows.length, ids }

  // 그사이 누군가 상태를 바꿨으면 건드리지 않는다(조건부 UPDATE).
  const { data: done, error: updErr } = await supabaseAdmin
    .from('quotes')
    .update({ status: FAIL_STATUS, fail_reason: AUTO_FAIL_REASON })
    .in('quote_id', ids)
    .eq('status', PENDING_STATUS)
    .select('quote_id')
  if (updErr) throw updErr

  return { updated: (done ?? []).length, checked: rows.length, ids }
}

// ── GET: Vercel Cron ────────────────────────────────────────────────
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[auto-fail] CRON_SECRET 이 없어 Cron 호출을 받지 않는다')
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const r = await sweep()
    // Cron 은 사람이 보지 않으므로 로그에 남긴다.
    console.log('[auto-fail] cron', r)
    return NextResponse.json(r)
  } catch (e) {
    console.error('[auto-fail] cron failed', e)
    return NextResponse.json({ error: '자동 처리에 실패했습니다.' }, { status: 500 })
  }
}

// ── POST: 화면에서 부르는 기존 경로 ─────────────────────────────────
export async function POST() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: caller } = await supabase
    .from('engineers')
    .select('permission_level')
    .eq('email', user.email!)
    .single()
  if (!caller || !canManageEngineers(caller)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const r = await sweep()
    return NextResponse.json(r)
  } catch (e) {
    console.error('[auto-fail] manual failed', e)
    return NextResponse.json({ error: '자동 처리에 실패했습니다.' }, { status: 500 })
  }
}
