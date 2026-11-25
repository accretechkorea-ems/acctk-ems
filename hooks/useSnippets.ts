'use client'

/**
 * 문구함을 읽고 쓰는 **한 길** (2026-11-25).
 *
 * 화면은 라우트(app/api/snippets)만 쓴다 — 표를 직접 만지지 않는다(저장소 규칙).
 * 고르기 드롭다운·저장 창·내 문구 탭이 이 훅 하나를 나눠 쓴다.
 *
 * 읽기는 **열 때** 한 번 한다(문구는 자주 바뀌지 않는다). 담거나 고치면 다시 읽는다.
 */

import { useCallback, useRef, useState } from 'react'
import { SCHEMA_MESSAGE, type Snippet, type SnippetKind, type SnippetScope } from '@/lib/snippets'

export type SnippetForm = {
  title: string
  body: string
  kind: SnippetKind
  scope: SnippetScope
}

type Result = { ok: true; snippet_id?: number } | { ok: false; error: string }

async function call(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch('/api/snippets', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => null) as Record<string, unknown> | null
  if (!json) return { error: '문구함에 연결하지 못했습니다' }
  // 표가 아직 없을 때의 503 — 라우트가 적어 보낸 문구를 그대로 올린다.
  return json
}

export function useSnippets(kind?: SnippetKind) {
  const [rows, setRows] = useState<Snippet[]>([])
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  /** 한 번은 읽었나 — 드롭다운을 열 때마다 다시 읽지 않는다. */
  const [loaded, setLoaded] = useState(false)
  /**
   * 「읽는 중·읽었다」를 ref 로도 들고 있다 — load 를 **상태와 무갈이**로 두기 위해서다.
   * 상태를 보면 load 가 렌더마다 새 함수가 되고, 그것을 effect 의 의존으로 쓰면
   * 열 때마다 다시 읽는다(혹은 되돌이가 된다).
   */
  const busyRef = useRef(false)
  const loadedRef = useRef(false)

  const load = useCallback(async (opts: { force?: boolean } = {}) => {
    if (busyRef.current) return
    if (loadedRef.current && !opts.force) return
    busyRef.current = true
    setLoading(true)
    try {
      const json = await call({ action: 'list', ...(kind ? { kind } : {}) })
      if (Array.isArray(json.rows)) {
        setRows(json.rows as Snippet[])
        setNotice(null)
        loadedRef.current = true
        setLoaded(true)
      } else {
        setNotice(String(json.error ?? SCHEMA_MESSAGE))
      }
    } finally {
      busyRef.current = false
      setLoading(false)
    }
  }, [kind])

  const create = useCallback(async (form: SnippetForm): Promise<Result> => {
    const json = await call({ action: 'create', ...form })
    if (json.ok !== true) return { ok: false, error: String(json.error ?? '담지 못했습니다') }
    await load({ force: true })
    return { ok: true, snippet_id: Number(json.snippet_id) }
  }, [load])

  const update = useCallback(async (id: number, form: SnippetForm): Promise<Result> => {
    const json = await call({ action: 'update', snippet_id: id, ...form })
    if (json.ok !== true) return { ok: false, error: String(json.error ?? '고치지 못했습니다') }
    await load({ force: true })
    return { ok: true, snippet_id: id }
  }, [load])

  const remove = useCallback(async (id: number): Promise<Result> => {
    const json = await call({ action: 'delete', snippet_id: id })
    if (json.ok !== true) return { ok: false, error: String(json.error ?? '지우지 못했습니다') }
    await load({ force: true })
    return { ok: true, snippet_id: id }
  }, [load])

  return { rows, loading, notice, loaded, load, create, update, remove }
}
