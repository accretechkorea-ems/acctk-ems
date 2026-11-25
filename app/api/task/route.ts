// 할 일 — 담기·고치기·완료·지우기 (2026-11-26).
//
// ── 왜 라우트인가 ────────────────────────────────────────────────────────
//   이 저장소의 규칙대로 **쓰기는 service role 라우트에서만** 한다. 만든 사람(created_by)은
//   화면이 보낸 값을 믿지 않고 **세션에서** 넣는다. 표의 RLS 에도 같은 규칙을 걸어
//   두었다(db/tasks_20261126.sql) — 이중 잠금이다.
//
// ── 무엇을 하나 ──────────────────────────────────────────────────────────
//   list   — 내 것(또는 내가 적어 준 것) 중 **아직 안 끝낸** 줄. 대상을 주면 그 대상의 줄만.
//   create — 내 것으로 담는다(받는 사람은 남이어도 된다 — 지금 화면은 늘 나다).
//   update — 제목·기한·메모·연결 대상을 고친다.
//   done   — 완료/되돌리기(done_at 을 찍거나 지운다). 지우지 않는다 — 한 일도 기록이다.
//   delete — 줄을 지운다.
//
// ── 표가 아직 없을 때 ────────────────────────────────────────────────────
//   503 으로 **무엇을 돌려야 하는지** 말해 준다(TASK_SCHEMA_MESSAGE). 화면은 그 문구를
//   한 줄로 띄우고 나머지 카드는 그대로 돈다 — 홈이 통째로 깨지지 않는다.

import { NextResponse } from 'next/server'
import { adminClient, loadCaller } from '@/lib/apiCaller'
import { TASK_SCHEMA_MESSAGE, isTaskKind, isTaskRefType, type TaskRow } from '@/lib/tasks'

const supabaseAdmin = adminClient()
const TAG = 'task'
const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

/** 그 오류가 「표·칸이 아직 없다」인가. */
const missing = (err: { code?: string | null } | null) =>
  err != null && (err.code === '42P01' || err.code === '42703' || err.code === 'PGRST204' || err.code === 'PGRST205')

const COLUMNS = 'task_id, title, due_date, done_at, engineer_id, created_by, kind, ref_type, ref_id, memo'
const TITLE_MAX = 200
const MEMO_MAX = 2000

/** 화면이 보낸 값에서 담을 것만. 길이도 여기서 자른다. */
function pick(body: Record<string, unknown>) {
  const due = String(body.due_date ?? '').trim()
  const refId = Number(body.ref_id)
  return {
    title: String(body.title ?? '').trim().slice(0, TITLE_MAX),
    due_date: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
    kind: isTaskKind(body.kind) ? body.kind : 'manual',
    ref_type: isTaskRefType(body.ref_type) ? body.ref_type : null,
    ref_id: Number.isInteger(refId) && refId > 0 ? refId : null,
    memo: String(body.memo ?? '').trim().slice(0, MEMO_MAX) || null,
  }
}

export async function POST(req: Request) {
  const { error: authErr, caller } = await loadCaller({ kind: 'login' }, { tag: TAG, req, method: 'POST' })
  if (authErr) return authErr

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return bad('요청을 읽지 못했습니다')
  const action = String(body.action ?? '')
  const now = new Date().toISOString()
  const me = Number(caller.engineer_id)

  // ── 읽기 ───────────────────────────────────────────────────────────────
  if (action === 'list') {
    let q = supabaseAdmin
      .from('tasks')
      .select(COLUMNS)
      // 내 일 또는 내가 적어 준 일. admin 이상도 **자기 목록**만 본다 — 홈은 내 화면이다
      // (남의 일을 보는 화면은 따로 없다. RLS 가 넓은 것은 나중을 위한 것이다).
      .or(`engineer_id.eq.${me},created_by.eq.${me}`)
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('task_id', { ascending: true })
    // 대상 하나의 줄만 — 포캐스트 카드·견적 상세가 「이 건에 걸린 할 일」을 셀 때.
    if (isTaskRefType(body.ref_type)) {
      const refId = Number(body.ref_id)
      if (!Number.isInteger(refId) || refId <= 0) return bad('연결 대상을 찾지 못했습니다')
      q = q.eq('ref_type', body.ref_type).eq('ref_id', refId)
    }
    // 끝낸 줄은 기본으로 뺀다(done: 'all' 이면 함께 준다 — 나중에 「지난 할 일」 화면이 쓸 수 있다).
    if (body.done !== 'all') q = q.is('done_at', null)
    const { data, error } = await q
    if (error) {
      if (missing(error)) return NextResponse.json({ error: TASK_SCHEMA_MESSAGE, schema: true }, { status: 503 })
      console.error(`[${TAG}] list failed`, error)
      return NextResponse.json({ error: '할 일을 읽지 못했습니다' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, rows: (data ?? []) as unknown as TaskRow[] })
  }

  // ── 담기 — 만든 사람은 **세션에서** ────────────────────────────────────
  if (action === 'create') {
    const form = pick(body)
    if (!form.title) return bad('할 일을 한 줄로 적어주세요')
    // 받는 사람은 남이어도 된다. 안 주면 나다.
    const toId = Number(body.engineer_id)
    const engineerId = Number.isInteger(toId) && toId > 0 ? toId : me
    const { data: made, error } = await supabaseAdmin
      .from('tasks')
      .insert({ ...form, engineer_id: engineerId, created_by: me, created_at: now, updated_at: now })
      .select('task_id')
      .single()
    if (error || !made) {
      if (missing(error)) return NextResponse.json({ error: TASK_SCHEMA_MESSAGE, schema: true }, { status: 503 })
      console.error(`[${TAG}] create failed`, error)
      return NextResponse.json({ error: '할 일을 담지 못했습니다' }, { status: 500 })
    }
    console.log(`[${TAG}] create`, { id: made.task_id, kind: form.kind, ref: form.ref_type, by: caller.email })
    return NextResponse.json({ ok: true, task_id: Number(made.task_id) })
  }

  // ── 아래 셋은 줄을 먼저 읽고 **내 줄인지** 본다 ────────────────────────
  const id = Number(body.task_id)
  if (!Number.isInteger(id) || id <= 0) return bad('할 일을 찾지 못했습니다')
  const { data: row, error: readErr } = await supabaseAdmin
    .from('tasks').select(COLUMNS).eq('task_id', id).maybeSingle()
  if (readErr) {
    if (missing(readErr)) return NextResponse.json({ error: TASK_SCHEMA_MESSAGE, schema: true }, { status: 503 })
    console.error(`[${TAG}] read failed`, { id, code: readErr.code })
    return NextResponse.json({ error: '할 일을 읽지 못했습니다' }, { status: 500 })
  }
  if (!row) return bad('할 일을 찾지 못했습니다', 404)
  const mine = Number(row.engineer_id) === me || Number(row.created_by) === me
  const boss = caller.permission_level === 'admin' || caller.permission_level === 'superadmin'
  if (!mine && !boss) {
    console.warn(`[${TAG}] 권한 없는 요청`, { id, action, by: caller.email })
    return NextResponse.json({ error: '이 할 일을 고칠 권한이 없습니다' }, { status: 403 })
  }

  // ── 완료·되돌리기 ──────────────────────────────────────────────────────
  if (action === 'done') {
    const done = body.done !== false
    const { error } = await supabaseAdmin
      .from('tasks').update({ done_at: done ? now : null, updated_at: now }).eq('task_id', id)
    if (error) {
      console.error(`[${TAG}] done failed`, { id, code: error.code })
      return NextResponse.json({ error: '할 일을 고치지 못했습니다' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, task_id: id, done })
  }

  // ── 고치기 ─────────────────────────────────────────────────────────────
  if (action === 'update') {
    const form = pick({ ...row, ...body })
    if (!form.title) return bad('할 일을 한 줄로 적어주세요')
    const { error } = await supabaseAdmin
      .from('tasks').update({ ...form, updated_at: now }).eq('task_id', id)
    if (error) {
      console.error(`[${TAG}] update failed`, { id, code: error.code })
      return NextResponse.json({ error: '할 일을 고치지 못했습니다' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, task_id: id })
  }

  // ── 지우기 ─────────────────────────────────────────────────────────────
  if (action === 'delete') {
    const { error } = await supabaseAdmin.from('tasks').delete().eq('task_id', id)
    if (error) {
      console.error(`[${TAG}] delete failed`, { id, code: error.code })
      return NextResponse.json({ error: '할 일을 지우지 못했습니다' }, { status: 500 })
    }
    console.log(`[${TAG}] delete`, { id, by: caller.email })
    return NextResponse.json({ ok: true, task_id: id })
  }

  return bad('무엇을 할지 알 수 없습니다')
}
