// 회사 공휴일 관리 (superadmin). 가동률의 평일 수가 이 표(company_holidays)를 따른다.
//
//   GET    ?year=YYYY               그해 목록
//   POST   { holiday_date, name }   수동 추가(임시공휴일·선거일 등). 이미 있는 날짜면 409
//   DELETE { holiday_date }         삭제 — 자동 계산분도 지울 수 있다
//                                   (회사가 정상 근무하는 날로 처리하고 싶을 때)
//
// 법정공휴일은 /api/showroom/stats 가 그해 첫 조회 때 lib/holidays.ts 계산으로 채운다.
// 새 테이블에는 읽기 정책만 있다 — 쓰기는 service role 로 한다.
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { isSuperAdmin } from '@/lib/permissions'

type Caller = { engineer_id: number; name: string | null; permission_level: string | null; teams: string | null }

const NAME_MAX = 50

const admin = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

/** 로그인 + superadmin. app/api/showroom/devices/route.ts 의 authorize() 와 같다. */
async function authorize() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: bad('Unauthorized', 401) }

  const { data: callerRow, error: callerErr } = await supabase
    .from('engineers')
    .select('engineer_id, name, permission_level, teams')
    .eq('email', user.email!)
    .single()
  if (callerErr) console.error('[showroom/holidays] caller lookup failed', { email: user.email, error: callerErr })
  if (!callerRow) return { error: bad('Forbidden', 403) }
  if (!isSuperAdmin(callerRow as Caller)) return { error: bad('Forbidden', 403) }
  return { error: null }
}

/** 실제로 있는 날짜인지까지 본다('2026-02-30' 은 거절). */
function parseDate(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const t = new Date(Date.UTC(y, mo - 1, d))
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null
  return s
}

// ── GET: 그해 목록 ──────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await authorize()
  if (auth.error) return auth.error

  const year = Number(req.nextUrl.searchParams.get('year'))
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return bad('연도가 올바르지 않습니다.')

  const { data, error } = await admin()
    .from('company_holidays')
    .select('holiday_date, name, is_manual')
    .gte('holiday_date', `${year}-01-01`)
    .lte('holiday_date', `${year}-12-31`)
    .order('holiday_date', { ascending: true })
  if (error) {
    console.error('[showroom/holidays] list failed', { year, error })
    return bad('공휴일 목록을 불러오지 못했습니다.', 500)
  }
  return NextResponse.json({ holidays: data ?? [] })
}

// ── POST: 수동 추가 ─────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await authorize()
  if (auth.error) return auth.error

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const date = parseDate(body.holiday_date)
  if (!date) return bad('날짜를 확인해주세요.')
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return bad('이름을 입력해주세요.')
  if (name.length > NAME_MAX) return bad(`이름은 ${NAME_MAX}자 이내로 입력해주세요.`)

  const { error } = await admin()
    .from('company_holidays')
    .insert({ holiday_date: date, name, is_manual: true })
  if (error) {
    // holiday_date 가 PK 다 — 이미 있는 날짜(자동 계산분 포함)면 unique 위반.
    if (error.code === '23505') return bad('이미 등록된 날짜입니다.', 409)
    console.error('[showroom/holidays] insert failed', { date, error })
    return bad('공휴일 추가에 실패했습니다.', 500)
  }
  return NextResponse.json({ success: true, holiday_date: date })
}

// ── DELETE: 삭제 ────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const auth = await authorize()
  if (auth.error) return auth.error

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const date = parseDate(body.holiday_date)
  if (!date) return bad('날짜를 확인해주세요.')

  const { data, error } = await admin()
    .from('company_holidays')
    .delete()
    .eq('holiday_date', date)
    .select('holiday_date')
  if (error) {
    console.error('[showroom/holidays] delete failed', { date, error })
    return bad('공휴일 삭제에 실패했습니다.', 500)
  }
  if (!data || data.length === 0) return bad('등록되지 않은 날짜입니다.', 404)
  return NextResponse.json({ success: true, holiday_date: date })
}
