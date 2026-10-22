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
import type { ApprovalDocument, ApprovalLine } from '@/lib/approval/types'
import { createPolledStore } from './polledStore'

/**
 * 라우트가 주는 **그대로**다. 배지는 건수만, 홈 카드는 doc_type 만 쓰지만, 결재함 화면의
 * 미결 탭이 같은 한 벌을 쓰기 때문에 칸을 줄이지 않는다 — 줄이면 그 화면이 다시 읽어야 한다.
 */
export type ApprovalDoc = ApprovalDocument & {
  approval_lines: ApprovalLine[]
  progress?: { total: number; done: number; currentStep: number | null; currentApproverId: number | null }
  delegated?: boolean
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
