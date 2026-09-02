// 사무실 추가·수정·비활성화.
//
// offices 에는 SELECT 정책만 있고 쓰기 정책이 없다. 모든 쓰기는 이 라우트가 service role 로 한다.
// 화면에서도 관리자에게만 카드를 보이지만, 그것만으로는 막을 수 없어 여기서 다시 판정한다.
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { isSuperAdmin } from '@/lib/permissions'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

/** 사무실 이름·주소 등의 길이 상한. 컬럼이 text 라 서버에서 막지 않으면 무제한으로 들어온다. */
const MAX = { code: 30, label: 30, address: 200 }
/** code 는 engineers.office 에 그대로 들어가는 값이라 영문 소문자·숫자·하이픈으로 제한한다. */
const CODE_RE = /^[a-z0-9-]+$/

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/** 좌표는 비워둘 수 있지만, 넣는다면 실제 범위 안이어야 한다. */
function parseCoord(v: unknown, min: number, max: number, label: string): number | null | { error: string } {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n)) return { error: `${label} 값이 올바르지 않습니다.` }
  if (n < min || n > max) return { error: `${label} 는 ${min} ~ ${max} 사이여야 합니다.` }
  return n
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
  if (callerErr) console.error('[office] caller lookup failed', { email: user.email, error: callerErr })
  // 사무실은 길찾기·동선·직원 소속이 모두 참조하는 기준 데이터라 superadmin 으로 제한한다.
  if (!caller || !isSuperAdmin(caller)) return bad('Forbidden', 403)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return bad('요청을 읽을 수 없습니다.')
  }

  const action = typeof body.action === 'string' ? body.action : ''

  // 좌표는 세 action 중 create·update 가 함께 쓴다.
  type Coords = { ok: true; latitude: number | null; longitude: number | null } | { ok: false; error: string }
  const readCoords = (): Coords => {
    const lat = parseCoord(body.latitude, -90, 90, '위도')
    if (lat && typeof lat === 'object') return { ok: false, error: lat.error }
    const lng = parseCoord(body.longitude, -180, 180, '경도')
    if (lng && typeof lng === 'object') return { ok: false, error: lng.error }
    return { ok: true, latitude: lat as number | null, longitude: lng as number | null }
  }

  // ── 추가 ──
  if (action === 'create') {
    const code = str(body.code).toLowerCase()
    const label = str(body.label)
    const address = str(body.address)
    if (!code) return bad('코드를 입력해주세요.')
    if (!CODE_RE.test(code)) return bad('코드는 영문 소문자·숫자·하이픈만 쓸 수 있습니다.')
    if (code.length > MAX.code) return bad(`코드는 ${MAX.code}자를 넘을 수 없습니다.`)
    if (!label) return bad('이름을 입력해주세요.')
    if (label.length > MAX.label) return bad(`이름은 ${MAX.label}자를 넘을 수 없습니다.`)
    if (!address) return bad('주소를 입력해주세요.')
    if (address.length > MAX.address) return bad(`주소는 ${MAX.address}자를 넘을 수 없습니다.`)

    const coords = readCoords()
    if (!coords.ok) return bad(coords.error)

    // code 는 unique 라 DB 도 막지만, 사람이 읽을 문구로 돌려주려고 먼저 본다.
    const { data: dup } = await supabaseAdmin.from('offices').select('office_id').eq('code', code).maybeSingle()
    if (dup) return bad(`코드 '${code}' 는 이미 쓰고 있습니다.`)

    const sortOrder = Number(body.sort_order)
    const { data, error } = await supabaseAdmin
      .from('offices')
      .insert({
        code, label, address,
        latitude: coords.latitude, longitude: coords.longitude,
        sort_order: Number.isInteger(sortOrder) ? sortOrder : 0,
      })
      .select('office_id, code')
      .single()
    if (error || !data) {
      console.error('[office] create failed', error)
      return bad('저장하지 못했습니다.', 500)
    }
    console.log('[office] create', { code, callerId: caller.engineer_id })
    return NextResponse.json({ success: true, officeId: data.office_id })
  }

  // ── 수정 ── code 는 바꾸지 않는다(engineers.office 가 참조하는 값이라 끊긴다).
  if (action === 'update') {
    const officeId = Number(body.officeId)
    if (!Number.isInteger(officeId) || officeId <= 0) return bad('사무실을 지정해주세요.')

    const { data: office } = await supabaseAdmin
      .from('offices').select('office_id, code').eq('office_id', officeId).maybeSingle()
    if (!office) return bad('사무실을 찾을 수 없습니다.', 404)

    const label = str(body.label)
    const address = str(body.address)
    if (!label) return bad('이름을 입력해주세요.')
    if (label.length > MAX.label) return bad(`이름은 ${MAX.label}자를 넘을 수 없습니다.`)
    if (!address) return bad('주소를 입력해주세요.')
    if (address.length > MAX.address) return bad(`주소는 ${MAX.address}자를 넘을 수 없습니다.`)

    const coords = readCoords()
    if (!coords.ok) return bad(coords.error)

    const sortOrder = Number(body.sort_order)
    const { error } = await supabaseAdmin
      .from('offices')
      .update({
        label, address,
        latitude: coords.latitude, longitude: coords.longitude,
        sort_order: Number.isInteger(sortOrder) ? sortOrder : 0,
        updated_at: new Date().toISOString(),
      })
      .eq('office_id', officeId)
    if (error) {
      console.error('[office] update failed', { officeId, error })
      return bad('저장하지 못했습니다.', 500)
    }
    console.log('[office] update', { officeId, code: office.code, callerId: caller.engineer_id })
    return NextResponse.json({ success: true })
  }

  // ── 비활성화 ── 하드 삭제하지 않는다. 소속된 재직 직원이 있으면 막는다.
  if (action === 'deactivate') {
    const officeId = Number(body.officeId)
    if (!Number.isInteger(officeId) || officeId <= 0) return bad('사무실을 지정해주세요.')

    const { data: office } = await supabaseAdmin
      .from('offices').select('office_id, code, label').eq('office_id', officeId).maybeSingle()
    if (!office) return bad('사무실을 찾을 수 없습니다.', 404)

    const { data: members, error: memErr } = await supabaseAdmin
      .from('engineers')
      .select('engineer_id')
      .eq('office', office.code)
      .is('resigned_date', null)
    if (memErr) {
      console.error('[office] member count failed', { officeId, error: memErr })
      return bad('소속 인원을 확인하지 못했습니다.', 500)
    }
    const count = (members ?? []).length
    if (count > 0) {
      return bad(`${office.label} 사무실에 소속된 재직 직원이 ${count}명 있습니다. 먼저 다른 사무실로 옮겨주세요.`)
    }

    const { error } = await supabaseAdmin
      .from('offices')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('office_id', officeId)
    if (error) {
      console.error('[office] deactivate failed', { officeId, error })
      return bad('저장하지 못했습니다.', 500)
    }
    console.log('[office] deactivate', { officeId, code: office.code, callerId: caller.engineer_id })
    return NextResponse.json({ success: true })
  }

  // ── 다시 사용 ── 비활성화한 사무실을 되살린다.
  if (action === 'activate') {
    const officeId = Number(body.officeId)
    if (!Number.isInteger(officeId) || officeId <= 0) return bad('사무실을 지정해주세요.')
    const { error } = await supabaseAdmin
      .from('offices')
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .eq('office_id', officeId)
    if (error) {
      console.error('[office] activate failed', { officeId, error })
      return bad('저장하지 못했습니다.', 500)
    }
    return NextResponse.json({ success: true })
  }

  return bad('알 수 없는 요청입니다.')
}
