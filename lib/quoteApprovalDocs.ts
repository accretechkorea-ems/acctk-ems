// 견적서 결재 — 화면 쪽 읽기와 표시 판정.
//
// lib/approval/quoteApproval.ts 와 나눠 둔 이유는 그 파일 머리말과 같다 — 그쪽은 service role 을 쓰는
// 서버 전용 모듈이라 화면에서 import 할 수 없다. 여기에는 브라우저가 쓰는 조회와 순수 판정만 둔다.
//
// 「결재 올리기」 버튼의 표시 판정이 이 파일 하나다. 목록이 둘(내 견적·실적 현황)이라 각자 짜면
// 한쪽만 고쳐져 버튼이 어긋난다. 결재 연결을 떼어 낼 때는 이 파일을 쓰는 두 자리만 지우면 된다.

import { createClient } from '@/lib/supabase/client'
import { APPROVABLE_STATUSES, isApprovalTarget } from '@/lib/quoteStatus'
import { QUOTE_TARGET_TABLE, QUOTE_TYPE, type QuoteGate } from '@/lib/approval/quoteApprovalKeys'

/**
 * 한 번에 물어보는 견적 id 수. `.in()` 은 쿼리 문자열로 나가므로 길면 URL 이 막힌다
 * (부품 검색·쇼룸 승인 조회가 쓰는 것과 같은 단위다).
 */
const CHUNK = 100

/**
 * 그 견적들 가운데 **결재 문서가 있는** 견적 id.
 *
 * 상태를 가리지 않는다 — 진행중뿐 아니라 반려·회수·폐기된 문서가 있는 견적도 「이미 올린 건」이라
 * 다시 올릴 수 없다(상신 라우트가 같은 기준으로 409 를 낸다).
 *
 * RLS 로 읽힌다 — approval_documents 의 SELECT 정책은 「상신자 본인 · 결재선에 있는 사람 ·
 * superadmin」이다(approval_schema.sql). 견적서 문서의 상신자는 언제나 작성자(created_by)이고
 * 버튼도 작성자에게만 보이므로, 판정에 필요한 문서는 전부 본인 것이라 정책 안에 들어온다.
 * 조회가 실패하면 **빈 집합이 아니라 null** 을 돌려준다 — 못 읽은 것을 「문서가 없다」로 보면
 * 이미 올린 견적에 버튼이 다시 나타난다.
 */
export async function loadQuoteApprovalDocIds(quoteIds: number[]): Promise<Set<number> | null> {
  const ids = [...new Set(quoteIds.filter(n => Number.isInteger(n) && n > 0))]
  if (ids.length === 0) return new Set()
  const supabase = createClient()
  const found = new Set<number>()
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK)
    const { data, error } = await supabase
      .from('approval_documents')
      .select('target_id')
      .eq('doc_type', QUOTE_TYPE)
      .eq('target_table', QUOTE_TARGET_TABLE)
      .in('target_id', slice)
    if (error) {
      console.error('[quoteApproval] 결재 문서 조회 실패', { count: slice.length, error })
      return null
    }
    for (const r of (data ?? []) as { target_id: number | null }[]) {
      if (r.target_id != null) found.add(r.target_id)
    }
  }
  return found
}

/** 「결재 올리기」 판정에 필요한 견적의 칸. */
export type ApprovalCandidate = {
  quote_id: number
  /** 생성 시각(timestamptz 문자열). 결재 도입 경계를 가르는 값이다 — 견적일이 아니다. */
  created_at: string | null
  status: string
  /** 작성자. 대필이면 실적 담당자와 다르다. 빈 값은 결재 도입 전 데이터다. */
  created_by: number | null
}

/**
 * 그 견적에 「결재 올리기」를 보여 줄까 — 순수 함수다. 상신 라우트의 검증과 같은 순서로 본다.
 *
 * `docIds` 가 null 이면(조회 실패) 보여 주지 않는다 — 이미 올린 건에 버튼이 다시 나타나는 쪽이
 * 버튼이 잠깐 사라지는 쪽보다 나쁘다.
 */
export function canSubmitApproval(
  q: ApprovalCandidate,
  myId: number | null,
  docIds: Set<number> | null,
): boolean {
  if (myId == null || docIds == null) return false
  if (q.created_by == null || q.created_by !== myId) return false
  if (!isApprovalTarget(q.created_at)) return false
  if (!(APPROVABLE_STATUSES as readonly string[]).includes(q.status)) return false
  return !docIds.has(q.quote_id)
}

// ── 승인 게이트 (서버에 묻는다) ──────────────────────────────────────
//
// 게이트는 브라우저가 스스로 셀 수 없다 — approval_documents 의 읽기 정책이 「상신자·결재선
// 참여자·관리자」라, 실적 현황에 뜨는 **남의 견적**의 결재 문서는 읽히지 않는다.
// 그래서 /api/quote-approval 의 'gates' 가 service role 로 재서 값만 돌려준다.

/** 한 번에 묻는 견적 id 수. 라우트 상한(300)보다 작게 둔다. */
const GATE_REQUEST_CHUNK = 200

/**
 * 게이트 표. 못 읽으면 **null** — 부르는 쪽은 그 행을 「확인 중」으로 두고 허용 동작을 감춘다
 * (못 읽은 것을 허용으로 떨어뜨리면 승인되지 않은 견적이 빠져나간다).
 */
export async function fetchQuoteGates(quoteIds: number[]): Promise<Map<number, QuoteGate> | null> {
  const ids = [...new Set(quoteIds.filter(n => Number.isSafeInteger(n) && n > 0))]
  const out = new Map<number, QuoteGate>()
  if (ids.length === 0) return out
  for (let i = 0; i < ids.length; i += GATE_REQUEST_CHUNK) {
    const slice = ids.slice(i, i + GATE_REQUEST_CHUNK)
    try {
      const res = await fetch('/api/quote-approval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'gates', quote_ids: slice }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        console.error('[quoteApproval] 게이트 조회 실패', { count: slice.length, status: res.status, error: json?.error })
        return null
      }
      const gates = (json?.gates ?? {}) as Record<string, QuoteGate>
      for (const [k, v] of Object.entries(gates)) {
        const id = Number(k)
        if (Number.isSafeInteger(id)) out.set(id, v)
      }
    } catch (e) {
      console.error('[quoteApproval] 게이트 조회 실패', { count: slice.length, error: e })
      return null
    }
  }
  return out
}

/**
 * 그 행의 게이트. 표를 못 읽었으면(null) **null** 을 돌려 「확인 중」으로 둔다.
 * 표는 읽었는데 그 견적이 없으면(그사이 지워졌다) 역시 null 이다 — 허용으로 떨어뜨리지 않는다.
 */
export const gateFor = (quoteId: number, gates: Map<number, QuoteGate> | null): QuoteGate | null =>
  gates == null ? null : (gates.get(quoteId) ?? null)
