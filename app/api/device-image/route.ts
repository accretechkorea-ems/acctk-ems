import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { canViewMenu } from '@/lib/permissions'
import { withTeamPerm } from '@/lib/teamPermsServer'
import {
  DEVICE_BUCKET, DEVICE_IMAGE_WIDTHS, deviceImagePath, isDefaultDeviceImage, isSafeDeviceImageName,
} from '@/lib/deviceImage'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/** 서명 URL 만료 — 코드베이스의 다른 서명 URL 과 같은 1시간. */
const SIGNED_URL_TTL = 60 * 60
/** 한 번에 서명할 수 있는 장수. 쇼룸 한 화면이 8장, 고객사 상세가 수십 장일 수 있다. */
const MAX_PATHS = 60

/**
 * 장비 사진의 서명 URL.
 *
 *   GET  /api/device-image?path=device-110-….jpg&w=240     한 장
 *   POST /api/device-image  { paths: [...], w: 240 }        여러 장(한 요청)
 *
 * device-images 버킷은 비공개다(2026-10-23 전환 — 그 전에는 공개였다). 그래서 화면은
 * 주소를 직접 만들 수 없고 여기를 지난다. w 를 주면 **변환된 작은 그림**을 서명한다 —
 * 240px 카드에 319KB 원본을 내려보낼 이유가 없다.
 *
 * **묶음(POST)이 기본 길이다.** 쇼룸 카드 여덟 장이 각자 GET 하면 서명 조회가 여덟 번이다.
 */

/** 로그인한 직원인가 + 장비를 볼 수 있는 메뉴 권한이 있는가. */
async function loadCaller(): Promise<{ ok: true } | { ok: false; res: NextResponse }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: row } = await supabaseAdmin
    .from('engineers')
    .select('engineer_id, permission_level, teams, resigned_date')
    .eq('email', user.email!)
    .single()
  if (!row || row.resigned_date) {
    return { ok: false, res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  const caller = await withTeamPerm(row)
  // 장비 사진은 고객사 화면과 쇼룸에 나온다 — 둘 중 하나라도 볼 수 있으면 허용한다.
  if (!canViewMenu(caller, 'customers') && !canViewMenu(caller, 'showroom')) {
    return { ok: false, res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { ok: true }
}

/** 폭 — 목록 안의 값만. 주지 않으면 원본을 서명한다. */
function parseWidth(raw: string | null): number | null | 'bad' {
  if (raw === null || raw === '') return null
  const n = Number(raw)
  return (DEVICE_IMAGE_WIDTHS as readonly number[]).includes(n) ? n : 'bad'
}

/**
 * 서명해도 되는 경로만 남긴다.
 *
 * 두 가지가 통과한다.
 *   · devices.image_url 이 가리키는 파일 — 저장된 값이 **옛 공개 주소일 수도** 있어
 *     그 칸을 통째로 읽어 경로로 바꿔 맞춘다(행이 34개뿐이다).
 *   · default_* 카탈로그 사진 — DB 가 가리키지 않는다(lib/deviceImage.ts).
 */
async function allowedPaths(wanted: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  const needDb = wanted.filter(p => !isDefaultDeviceImage(p))
  for (const p of wanted) if (isDefaultDeviceImage(p)) out.add(p)
  if (needDb.length === 0) return out

  const { data, error } = await supabaseAdmin
    .from('devices')
    .select('image_url')
    .not('image_url', 'is', null)
  if (error) {
    console.error('[device-image] 소유 확인 실패', error)
    return out
  }
  const known = new Set((data ?? []).map(r => deviceImagePath(r.image_url)).filter((v): v is string => !!v))
  for (const p of needDb) if (known.has(p)) out.add(p)
  return out
}

async function signOne(path: string, width: number | null): Promise<string | null> {
  const { data, error } = await supabaseAdmin.storage
    .from(DEVICE_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL,
      width ? { transform: { width, resize: 'contain' } } : undefined)
  if (error || !data) {
    console.error('[device-image] signed url 발급 실패', path, error?.message)
    return null
  }
  return data.signedUrl
}

export async function GET(req: NextRequest) {
  const auth = await loadCaller()
  if (!auth.ok) return auth.res

  const raw = req.nextUrl.searchParams.get('path')
  if (!raw) return NextResponse.json({ error: 'path required' }, { status: 400 })
  const path = deviceImagePath(raw)
  if (!path || !isSafeDeviceImageName(path)) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  }
  const width = parseWidth(req.nextUrl.searchParams.get('w'))
  if (width === 'bad') return NextResponse.json({ error: 'Invalid w' }, { status: 400 })

  const allowed = await allowedPaths([path])
  if (!allowed.has(path)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const signedUrl = await signOne(path, width)
  if (!signedUrl) return NextResponse.json({ error: '파일을 불러오지 못했습니다.' }, { status: 500 })
  return NextResponse.json({ signedUrl, expiresIn: SIGNED_URL_TTL })
}

/**
 * 여러 장을 한 번에.
 *
 * 돌려주는 모양: `{ urls: { "<경로>": "<서명 주소>" }, expiresIn: 3600 }`
 * 서명하지 못한 경로는 **그냥 빠진다** — 보조 정보라 한 장 때문에 화면을 막지 않는다.
 */
export async function POST(req: NextRequest) {
  const auth = await loadCaller()
  if (!auth.ok) return auth.res

  const body = await req.json().catch(() => null) as { paths?: unknown; w?: unknown } | null
  if (!body || !Array.isArray(body.paths)) {
    return NextResponse.json({ error: 'paths required' }, { status: 400 })
  }
  if (body.paths.length > MAX_PATHS) {
    return NextResponse.json({ error: `한 번에 ${MAX_PATHS}장까지입니다.` }, { status: 400 })
  }
  const width = parseWidth(body.w == null ? null : String(body.w))
  if (width === 'bad') return NextResponse.json({ error: 'Invalid w' }, { status: 400 })

  const paths = [...new Set(
    body.paths
      .map(p => deviceImagePath(typeof p === 'string' ? p : null))
      .filter((p): p is string => !!p && isSafeDeviceImageName(p)),
  )]
  if (paths.length === 0) return NextResponse.json({ urls: {}, expiresIn: SIGNED_URL_TTL })

  const allowed = await allowedPaths(paths)
  const urls: Record<string, string> = {}
  await Promise.all([...allowed].map(async p => {
    const signed = await signOne(p, width)
    if (signed) urls[p] = signed
  }))
  return NextResponse.json({ urls, expiresIn: SIGNED_URL_TTL })
}
