// 개인 결재선 — 자주 쓰는 결재선을 이름 붙여 저장해 두고 불러 쓴다.
//
// 본인 것만 읽고 쓴다(approval_line_presets 의 RLS 도 owner_id 본인만 열어 준다).
// 쓰기는 다른 결재 라우트와 같게 service role 로 한다.
//
// lines 는 결재선 지정 모달이 만드는 모양 그대로 저장한다 —
//   [{ step, kind, approverId, isDelegatedAuthority }]
// 불러온 뒤 상신 시점에 서버가 다시 검증하므로, 저장 시점 이후 퇴사한 사람이 섞여 있어도
// 상신에서 걸린다. 그래도 저장할 때 한 번 걸러 두면 불러온 직후 바로 알 수 있다.

import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { docTypeOf } from '@/lib/approval/docTypes'
import { validateLineInput } from '@/lib/approval/engine'
import type { LineInput } from '@/lib/approval/types'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

/** 세션 → engineers. 퇴사자는 막는다. */
async function loadCaller(): Promise<{ id: number; error: null } | { id: null; error: NextResponse }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return { id: null, error: bad('Unauthorized', 401) }
  const { data: row } = await supabase
    .from('engineers')
    .select('engineer_id, resigned_date')
    .eq('email', user.email)
    .single()
  const me = row as { engineer_id: number; resigned_date: string | null } | null
  if (!me || me.resigned_date) return { id: null, error: bad('Forbidden', 403) }
  return { id: me.engineer_id, error: null }
}

export async function GET() {
  const { id, error: authErr } = await loadCaller()
  if (authErr) return authErr

  const { data, error } = await supabaseAdmin
    .from('approval_line_presets')
    .select('preset_id, name, doc_type, lines, created_at')
    .eq('owner_id', id)
    .order('created_at', { ascending: false })
  if (error) {
    console.error('[approval/presets] list failed', error)
    return bad('개인 결재선을 불러오지 못했습니다.', 500)
  }
  return NextResponse.json({ presets: data ?? [] })
}

export async function POST(req: Request) {
  const { id, error: authErr } = await loadCaller()
  if (authErr) return authErr

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name) return bad('이름을 입력해주세요.')
  if (name.length > 40) return bad('이름은 40자까지 쓸 수 있습니다.')

  // 유형을 지정하면 등록된 유형이어야 한다. 지정하지 않으면 모든 유형에서 쓴다.
  const docType = body?.docType == null || body.docType === '' ? null : String(body.docType)
  if (docType !== null && !docTypeOf(docType)) return bad('등록되지 않은 문서 유형입니다.')

  if (!Array.isArray(body?.lines)) return bad('결재선을 지정해주세요.')
  const lines = (body.lines as LineInput[]).map(l => ({
    step: Number(l?.step),
    kind: l?.kind,
    approverId: Number(l?.approverId),
    isDelegatedAuthority: l?.isDelegatedAuthority === true,
  })) as LineInput[]

  const ids = [...new Set(lines.map(l => l.approverId).filter(n => Number.isInteger(n) && n > 0))]
  const { data: engs, error: engErr } = await supabaseAdmin
    .from('engineers')
    .select('engineer_id, resigned_date')
    .in('engineer_id', ids.length > 0 ? ids : [0])
  if (engErr) {
    console.error('[approval/presets] approver lookup failed', engErr)
    return bad('결재자를 확인하지 못했습니다.', 500)
  }
  const active = new Set(
    ((engs ?? []) as { engineer_id: number; resigned_date: string | null }[])
      .filter(e => !e.resigned_date)
      .map(e => e.engineer_id),
  )
  // 상신 때와 같은 검증을 쓴다 — 저장해 둔 결재선이 상신에서만 걸리는 일이 없게 한다.
  const msg = validateLineInput(lines, id, active)
  if (msg) return bad(msg)

  const { data, error } = await supabaseAdmin
    .from('approval_line_presets')
    .insert({ owner_id: id, name, doc_type: docType, lines })
    .select('preset_id, name, doc_type, lines, created_at')
    .single()
  if (error) {
    console.error('[approval/presets] insert failed', error)
    return bad('저장하지 못했습니다.', 500)
  }
  return NextResponse.json({ ok: true, preset: data })
}

export async function DELETE(req: Request) {
  const { id, error: authErr } = await loadCaller()
  if (authErr) return authErr

  const presetId = Number(new URL(req.url).searchParams.get('presetId'))
  if (!Number.isInteger(presetId) || presetId <= 0) return bad('삭제할 결재선을 지정해주세요.')

  // owner_id 를 조건에 함께 넣어 남의 것을 지우지 못하게 한다.
  const { data, error } = await supabaseAdmin
    .from('approval_line_presets')
    .delete()
    .eq('preset_id', presetId)
    .eq('owner_id', id)
    .select('preset_id')
  if (error) {
    console.error('[approval/presets] delete failed', { presetId, error })
    return bad('삭제하지 못했습니다.', 500)
  }
  if (!data || data.length === 0) return bad('결재선을 찾을 수 없습니다.', 404)
  return NextResponse.json({ ok: true, presetId })
}
