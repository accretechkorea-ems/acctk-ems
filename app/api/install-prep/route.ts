// 신규 설치 준비 체크리스트 — 조회(GET) · 저장(POST).
//
// 왜 라우트인가 —
//   · service_install_prep 에는 읽기 정책만 있다. 쓰기는 service role 로만 이뤄져야 한다.
//   · 「협의완료로 바꾼 사람」은 책임 소재라 대리 입력을 막아야 한다. done_by 를 본문에서
//     받지 않고 세션의 호출자로 박는다(service_attachments.uploaded_by 와 같은 규칙).
//
// 접근 권한은 고객사 열람 권한(canViewCustomers)을 기준으로 한다 — 고객 현장 자료다.
// 항목·상태값은 lib/installPrep.ts 의 화이트리스트로 본다(DB 의 CHECK 와 같은 목록이다).

import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { canViewMenu } from '@/lib/permissions'
import { withTeamPerm } from '@/lib/teamPermsServer'
import { isPrepStatus, PREP_DONE, prepItemOf } from '@/lib/installPrep'

const PREP_COLUMNS =
  'prep_id, service_id, item_key, status, vendor, contact, planned_at, counterpart, note, done_by, done_at, created_at, updated_at, engineers(name, position)'

/** 한 번에 읽을 수 있는 서비스 기록 수 — 대시보드의 예정 건이 이보다 많을 일은 없다. */
const MAX_IDS = 100
/** 글자 칸 상한. 넘치면 잘라 저장한다(업체명·연락처·상대·메모). */
const TEXT_MAX = 200

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

type Caller = { engineer_id: number; permission_level: string | null; teams: string | null }

/** 로그인 + 고객사 열람 권한. 통과하면 caller 를 돌려준다. */
async function authorize(): Promise<{ error: NextResponse; caller: null } | { error: null; caller: Caller }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return { error: bad('Unauthorized', 401), caller: null }

  const { data: row, error } = await supabase
    .from('engineers')
    .select('engineer_id, permission_level, teams')
    .eq('email', user.email)
    .single()
  if (error) console.error('[install-prep] caller lookup failed', { email: user.email, error })
  const caller = await withTeamPerm((row ?? null) as Caller | null)
  if (!caller || !canViewMenu(caller, 'customers')) return { error: bad('Forbidden', 403), caller: null }
  return { error: null, caller }
}

/** 양의 정수만. 목록은 쉼표로 받는다. */
function parseIds(raw: string | null): number[] {
  if (!raw) return []
  const ids = raw.split(',')
    .map(v => Number(v.trim()))
    .filter(n => Number.isInteger(n) && n > 0)
  return [...new Set(ids)].slice(0, MAX_IDS)
}

const text = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, TEXT_MAX) : null
}

/** 'HH:MM' 또는 'HH:MM:SS' 만 받는다. 그 밖은 비운다(잘못된 값으로 저장이 깨지지 않게). */
const time = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(t) ? t : null
}

// ── GET — 조회 ──────────────────────────────────────────────────────
// ?serviceId=1 또는 ?serviceIds=1,2,3 (대시보드가 예정 건을 한 번에 읽는다)
export async function GET(req: NextRequest) {
  const { error: authErr } = await authorize()
  if (authErr) return authErr

  const params = req.nextUrl.searchParams
  const ids = parseIds(params.get('serviceIds') ?? params.get('serviceId'))
  if (ids.length === 0) return bad('serviceId 가 필요합니다.')

  const { data, error } = await supabaseAdmin
    .from('service_install_prep')
    .select(PREP_COLUMNS)
    .in('service_id', ids)
    .order('service_id')
    .order('prep_id')
  if (error) {
    console.error('[install-prep] list failed', { ids, error })
    return bad('설치 준비 항목을 불러오지 못했습니다.', 500)
  }
  return NextResponse.json({ items: data ?? [] })
}

// ── POST — 저장(upsert) ─────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const { caller, error: authErr } = await authorize()
  if (authErr) return authErr

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return bad('본문을 읽지 못했습니다.')

  const serviceId = Number(body.serviceId)
  if (!Number.isInteger(serviceId) || serviceId <= 0) return bad('serviceId 가 올바르지 않습니다.')

  const item = prepItemOf(body.itemKey)
  if (!item) return bad('itemKey 가 올바르지 않습니다.')

  const status = body.status
  if (!isPrepStatus(status)) return bad('status 가 올바르지 않습니다.')

  // 없는 서비스 기록에 준비 항목만 남지 않게 한다(FK 가 막지만 400 으로 알려 주는 편이 낫다).
  const { data: service, error: svcErr } = await supabaseAdmin
    .from('service_history')
    .select('service_id')
    .eq('service_id', serviceId)
    .maybeSingle()
  if (svcErr) {
    console.error('[install-prep] service lookup failed', { serviceId, error: svcErr })
    return bad('서비스 기록을 확인하지 못했습니다.', 500)
  }
  if (!service) return bad('서비스 기록을 찾을 수 없습니다.', 404)

  const done = status === PREP_DONE
  const row = {
    service_id: serviceId,
    item_key: item.key,
    status,
    // 항목마다 쓰는 칸이 다르다 — 쓰지 않는 칸은 비워 둔다(엉뚱한 값이 남지 않게).
    vendor: item.fields === 'vendor' ? text(body.vendor) : null,
    contact: item.fields === 'vendor' ? text(body.contact) : null,
    planned_at: item.fields === 'vendor' ? time(body.plannedAt) : null,
    counterpart: item.fields === 'counterpart' ? text(body.counterpart) : null,
    note: text(body.note),
    // done_by 는 본문 값을 쓰지 않는다 — 누른 사람이 곧 담당자다(대리 입력 없음).
    // 되돌릴 때는 둘 다 지운다. 「지금 누가 책임지는가」만 남기고 이력은 audit_log 가 갖는다.
    done_by: done ? caller.engineer_id : null,
    done_at: done ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabaseAdmin
    .from('service_install_prep')
    .upsert(row, { onConflict: 'service_id,item_key' })
    .select(PREP_COLUMNS)
    .single()
  if (error) {
    console.error('[install-prep] upsert failed', { serviceId, itemKey: item.key, error })
    return bad('설치 준비 항목을 저장하지 못했습니다.', 500)
  }

  console.log('[install-prep] 저장', { serviceId, itemKey: item.key, status, by: caller.engineer_id })
  return NextResponse.json({ item: data })
}
