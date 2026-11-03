// 쇼룸 장비 '설정' 수정. superadmin 전용.
//
// 장비를 따로 등록하지 않는다 — showroom_sites 에 지정된 사무실(customers)의 devices 가
// 곧 쇼룸 장비다. showroom_devices 는 그 장비의 설정(일 가용시간·상태·사용여부·정렬·비고)만
// 담고, 행이 없으면 기본값으로 본다. 그래서 POST(등록)가 없고 PATCH 하나가 upsert 로 동작한다.
//
// 새 테이블에는 읽기 정책만 있다 — 쓰기는 전부 service role 로 한다.
import { adminClient } from '@/lib/supabase/admin'
import { loadCaller } from '@/lib/apiCaller'
import { NextRequest, NextResponse } from 'next/server'
import {
  DEFAULT_DAILY_HOURS, DEFAULT_DEVICE_STATUS, MAX_DAILY_HOURS, DEVICE_STATUSES,
  assertShowroomDevice,
} from '@/lib/showroom'

const admin = adminClient

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

/**
 * 로그인 + 관리자 확인. 속은 공용 함수다(lib/apiCaller.ts) — Need 가 superadmin 이면
 * 거기서 isSuperAdmin 까지 본다. 돌려주는 모양({ error, caller })은 그대로 두어
 * 부르는 자리(PATCH)를 손대지 않았다.
 */
async function authorize() {
  return loadCaller({ kind: 'superadmin' }, { tag: 'showroom/devices', method: 'PATCH' })
}

/** daily_hours 검증. DB check(> 0 and <= 24)와 같은 범위. */
function parseDailyHours(v: unknown): number | null {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0 || n > MAX_DAILY_HOURS) return null
  return n
}

// ── PATCH: 장비 설정 저장 (행이 없으면 만든다) ──────────────────────
export async function PATCH(req: NextRequest) {
  const auth = await authorize()
  if (auth.error) return auth.error

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const deviceId = Number(body.device_id)
  if (!Number.isInteger(deviceId) || deviceId <= 0) return bad('장비를 선택해주세요.')

  const supabaseAdmin = admin()
  const notDevice = await assertShowroomDevice(supabaseAdmin, deviceId)
  if (notDevice) return bad(notDevice, 404)

  // 지금 설정을 읽어 두고, 보내온 항목만 덮어쓴다.
  // (행이 없으면 기본값 위에 덮어 upsert 한다 — 빠진 항목이 null 로 들어가지 않게 하려는 것이다)
  const { data: current, error: curErr } = await supabaseAdmin
    .from('showroom_devices')
    .select('device_id, daily_hours, device_status, is_active, sort_order, note')
    .eq('device_id', deviceId)
    .maybeSingle()
  if (curErr) {
    console.error('[showroom/devices] current lookup failed', { deviceId, error: curErr })
    return bad('장비 설정을 읽지 못했습니다.', 500)
  }

  const next = {
    device_id: deviceId,
    daily_hours: current?.daily_hours ?? DEFAULT_DAILY_HOURS,
    device_status: current?.device_status ?? DEFAULT_DEVICE_STATUS,
    is_active: current?.is_active ?? true,
    sort_order: current?.sort_order ?? 0,
    note: current?.note ?? null,
    updated_at: new Date().toISOString(),
  }

  if ('daily_hours' in body) {
    const h = parseDailyHours(body.daily_hours)
    if (h === null) return bad(`일 가용시간은 0 초과 ${MAX_DAILY_HOURS} 이하로 입력해주세요.`)
    next.daily_hours = h
  }
  if ('device_status' in body) {
    const s = body.device_status
    if (typeof s !== 'string' || !(DEVICE_STATUSES as readonly string[]).includes(s)) {
      return bad('장비상태가 올바르지 않습니다.')
    }
    next.device_status = s
  }
  if ('is_active' in body) {
    if (typeof body.is_active !== 'boolean') return bad('사용여부가 올바르지 않습니다.')
    next.is_active = body.is_active
  }
  if ('sort_order' in body) {
    const n = Number(body.sort_order)
    if (!Number.isInteger(n)) return bad('정렬순서는 정수로 입력해주세요.')
    next.sort_order = n
  }
  if ('note' in body) {
    next.note = typeof body.note === 'string' ? body.note.trim() || null : null
  }

  const { error: upErr } = await supabaseAdmin
    .from('showroom_devices')
    .upsert(next, { onConflict: 'device_id' })
  if (upErr) {
    console.error('[showroom/devices] upsert failed', { deviceId, error: upErr })
    return bad('장비 설정 저장에 실패했습니다.', 500)
  }

  return NextResponse.json({ success: true, device_id: deviceId })
}
