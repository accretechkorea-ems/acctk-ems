'use client'

// 결재 미결함(내 차례인 문서) — **앱 당 한 벌**이다. 사이드바 배지와 홈 카드가 같이 본다.
//
// 「지금 내 차례인가」 판정은 서버에만 있어(위임·결재선·건너뛰기) 라우트를 그대로 쓴다.
// 예전에는 사이드바와 홈 카드가 각각 /api/approval?box=inbox 를 불러, 한 화면에서 그 라우트가
// 두 번 돌았다 — 라우트 안에서 세션 조회·engineers·approval_documents·approval_delegations 를
// 다시 읽으므로 가장 비싼 중복이었다(docs/perf-baseline.md ②).
//
// 결재를 처리한 직후에는 refreshApprovalInbox() 로 즉시 다시 읽는다(배지가 바로 줄어든다).

import { useEffect, useSyncExternalStore } from 'react'
import { createPolledStore } from './polledStore'

/** 배지·카드가 쓰는 만큼 — 라우트는 더 많은 칸을 주지만 여기서 들고 있을 이유가 없다. */
export type ApprovalDoc = {
  document_id: number
  doc_no: string | null
  title: string | null
  doc_type: string | null
}

const store = createPolledStore<ApprovalDoc[]>('approvalInbox', [], async () => {
  const res = await fetch('/api/approval?box=inbox')
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
  return (json?.documents ?? []) as ApprovalDoc[]
})

/** 결재·반려·회수·재상신 직후에 부른다. */
export const refreshApprovalInbox = store.refresh

/** 로그아웃 — 받아 둔 목록을 버린다. */
export function resetApprovalInbox(): void {
  store.reset()
}

/** 사이드바 배지와 홈 카드가 같이 쓰는 훅. */
export function useApprovalInbox(engineerId: number | null) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  useEffect(() => { store.setKey(engineerId) }, [engineerId])
  return {
    docs: snapshot.data,
    count: snapshot.data.length,
    loading: snapshot.loading,
    error: snapshot.error,
    refresh: store.refresh,
  }
}
