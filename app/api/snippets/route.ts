// 문구함 — 읽기·담기·고치기·지우기 (2026-11-25).
//
// ── 왜 라우트인가 ────────────────────────────────────────────────────────
//   이 저장소의 규칙대로 **쓰기는 service role 라우트에서만** 한다. 주인(owner_engineer_id)
//   은 화면이 보낸 값을 믿지 않고 **세션에서** 넣는다 — 남의 이름으로 담을 수 없다.
//   표의 RLS 에도 같은 규칙을 걸어 두었다(db/text_snippets_20261125.sql) — 이중 잠금이다.
//
// ── 무엇을 하나 ──────────────────────────────────────────────────────────
//   list   — 내 것 + 공용. 용도를 주면 그 용도(+공통)만.
//   create — 내 것으로 담는다.
//   update — 내 것, 또는 공용인데 내가 admin 이상일 때만(lib/snippets 의 canEditSnippet).
//   delete — 고치기와 같은 조건.
//
// ── 표가 아직 없을 때 ────────────────────────────────────────────────────
//   503 으로 **무엇을 돌려야 하는지** 말해 준다. 화면이 그 문구를 그대로 띄운다.

import { NextResponse } from 'next/server'
import { adminClient, loadCaller } from '@/lib/apiCaller'
import {
  BODY_MAX, SCHEMA_MESSAGE, TITLE_MAX, canEditSnippet, isSnippetKind, isSnippetScope,
  snippetBlockedReason, visibleKinds, type Snippet, type SnippetKind,
} from '@/lib/snippets'

const supabaseAdmin = adminClient()
const TAG = 'snippets'
const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

/** 그 오류가 「표·칸이 아직 없다」인가. */
const missing = (err: { code?: string | null } | null) =>
  err != null && (err.code === '42P01' || err.code === '42703' || err.code === 'PGRST204' || err.code === 'PGRST205')

const COLUMNS = 'snippet_id, title, body, kind, scope, owner_engineer_id, division, created_at, updated_at'

/** 화면이 보낸 값에서 담을 것만 — 길이도 여기서 자른다. */
function pick(body: Record<string, unknown>): { title: string; body: string; kind: SnippetKind; scope: 'private' | 'shared' } {
  return {
    title: String(body.title ?? '').trim().slice(0, TITLE_MAX),
    body: String(body.body ?? '').slice(0, BODY_MAX),
    kind: isSnippetKind(body.kind) ? body.kind : 'common',
    scope: isSnippetScope(body.scope) ? body.scope : 'private',
  }
}

export async function POST(req: Request) {
  const { error: authErr, caller } = await loadCaller({ kind: 'login' }, { tag: TAG, req, method: 'POST' })
  if (authErr) return authErr

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return bad('요청을 읽지 못했습니다')
  const action = String(body.action ?? '')
  const now = new Date().toISOString()

  /** 그 줄을 읽고 **고칠 수 있는지**까지 본다. 화면이 보낸 판정을 믿지 않는다. */
  const mine = async (id: number) => {
    const { data, error } = await supabaseAdmin
      .from('text_snippets').select(COLUMNS).eq('snippet_id', id).maybeSingle()
    if (error) return { row: null, schema: missing(error) }
    if (!data) return { row: null, schema: false }
    return { row: data as unknown as Snippet, schema: false }
  }

  // ── 읽기 — 내 것 + 공용 ────────────────────────────────────────────────
  if (action === 'list') {
    let q = supabaseAdmin
      .from('text_snippets')
      .select(COLUMNS)
      .or(`scope.eq.shared,owner_engineer_id.eq.${Number(caller.engineer_id)}`)
      .order('kind', { ascending: true })
      .order('title', { ascending: true })
    // 자리마다 쓰는 용도만 — 고르기 드롭다운이 준다. 내 문구 탭은 주지 않는다(전부).
    if (isSnippetKind(body.kind)) q = q.in('kind', visibleKinds(body.kind))
    const { data, error } = await q
    if (error) {
      if (missing(error)) return NextResponse.json({ error: SCHEMA_MESSAGE }, { status: 503 })
      console.error(`[${TAG}] list failed`, error)
      return NextResponse.json({ error: '문구를 읽지 못했습니다' }, { status: 500 })
    }
    const rows = (data ?? []) as unknown as Snippet[]

    // 만든 사람 이름 — 공용 문구에 누가 만들었는지 보이게 한 번에 읽어 붙인다.
    const ids = [...new Set(rows.map(r => r.owner_engineer_id))]
    const names = new Map<number, string>()
    if (ids.length > 0) {
      const { data: people } = await supabaseAdmin
        .from('engineers').select('engineer_id, name').in('engineer_id', ids)
      for (const p of people ?? []) names.set(Number(p.engineer_id), String(p.name ?? ''))
    }
    return NextResponse.json({
      ok: true,
      rows: rows.map(r => ({ ...r, owner_name: names.get(r.owner_engineer_id) ?? null })),
    })
  }

  // ── 담기 — 주인은 **세션에서** ─────────────────────────────────────────
  if (action === 'create') {
    const form = pick(body)
    const blocked = snippetBlockedReason(form)
    if (blocked) return bad(blocked)

    const { data: made, error } = await supabaseAdmin
      .from('text_snippets')
      .insert({
        ...form,
        owner_engineer_id: caller.engineer_id,
        division: typeof body.division === 'string' && body.division.trim() ? body.division.trim() : null,
        created_at: now, updated_at: now,
      })
      .select('snippet_id')
      .single()
    if (error || !made) {
      if (missing(error)) return NextResponse.json({ error: SCHEMA_MESSAGE }, { status: 503 })
      console.error(`[${TAG}] create failed`, error)
      return NextResponse.json({ error: '문구를 담지 못했습니다' }, { status: 500 })
    }
    console.log(`[${TAG}] create`, { id: made.snippet_id, kind: form.kind, scope: form.scope, by: caller.email })
    return NextResponse.json({ ok: true, snippet_id: Number(made.snippet_id) })
  }

  const id = Number(body.snippet_id)
  if (!Number.isInteger(id) || id <= 0) return bad('문구를 찾지 못했습니다')
  const { row, schema } = await mine(id)
  if (schema) return NextResponse.json({ error: SCHEMA_MESSAGE }, { status: 503 })
  if (!row) return bad('문구를 찾지 못했습니다', 404)
  // 내 것, 또는 공용 + admin 이상. 아니면 403 — 화면이 아니라 **여기서** 막는다.
  if (!canEditSnippet(caller, row)) {
    console.warn(`[${TAG}] 권한 없는 요청`, { id, action, by: caller.email })
    return NextResponse.json({ error: '이 문구를 고칠 권한이 없습니다' }, { status: 403 })
  }

  // ── 고치기 ─────────────────────────────────────────────────────────────
  if (action === 'update') {
    const form = pick({ ...row, ...body })
    const blocked = snippetBlockedReason(form)
    if (blocked) return bad(blocked)
    const { error } = await supabaseAdmin
      .from('text_snippets')
      .update({ ...form, updated_at: now })
      .eq('snippet_id', id)
    if (error) {
      console.error(`[${TAG}] update failed`, { id, code: error.code })
      return NextResponse.json({ error: '문구를 고치지 못했습니다' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, snippet_id: id })
  }

  // ── 지우기 ─────────────────────────────────────────────────────────────
  if (action === 'delete') {
    const { error } = await supabaseAdmin.from('text_snippets').delete().eq('snippet_id', id)
    if (error) {
      console.error(`[${TAG}] delete failed`, { id, code: error.code })
      return NextResponse.json({ error: '문구를 지우지 못했습니다' }, { status: 500 })
    }
    console.log(`[${TAG}] delete`, { id, by: caller.email })
    return NextResponse.json({ ok: true, snippet_id: id })
  }

  return bad('무엇을 할지 알 수 없습니다')
}
