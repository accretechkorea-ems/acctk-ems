// 견적 검토표(/api/quote-approval 의 'review') 응답을 화면 쪽에서 들고 있는 캐시.
//
// 왜 두는가 — 결재함에서 문서 행을 접었다 펴면 패널이 새로 마운트되고, 그때마다 같은 응답을
// 처음부터 다시 부른다. 그 요청은 서버에서 왕복 일곱 겹짜리라(권한 판정 → 견적 → 품목·업체·사람)
// 회색 자리표시가 눈에 보이게 머문다. 한 번 읽은 것은 들고 있는다.
//
// **오래된 상태를 보여 줄 위험이 없다.** 두 가지 이유다.
//   ① 이 응답에는 **결재 상태가 없다.** 상신·승인·반려로 바뀌는 값(status·결재선·도장)은 목록과
//      결재표가 각자 따로 읽는다. 캐시가 묵어도 「반려된 문서를 진행중으로 보여 주는」 일은 생기지
//      않는다 — 여기 담긴 것은 견적의 내용(품목·금액·원가·이익·거래 구분)뿐이다.
//   ② 그 내용은 **바뀌지 않는다.** 결재에 올라간 견적은 '결재중' 으로 잠겨 수정 경로가 없고
//      (승인 게이트 — lib/approval/quoteApprovalKeys.ts), 고치려면 반려받아 새로 상신해야 한다.
//      그러면 문서 id 가 달라져 캐시 키도 달라진다.
// 그래도 TTL 을 둔 이유는 「영원히」를 피하려는 것이다 — 업체 이름·담당자 이름처럼 견적 밖에서
// 바뀔 수 있는 값이 섞여 있다. 5분이면 한 번 들여다보는 동안은 즉시 뜨고, 다시 열 때는 새로 읽는다.
//
// 담지 않는 것 —
//   · 실패한 응답(권한 없음·조회 실패). 다시 누르면 다시 물어봐야 한다.
//   · itemsOk·expensesOk 가 false 인 응답. 그 화면에는 「다시 시도」가 떠 있고, 눌렀을 때 캐시가
//     같은 실패를 돌려주면 버튼이 거짓말이 된다.
//
// 새 패키지는 쓰지 않는다 — Map 하나다.

import type { QuoteReview } from '@/lib/approval/quoteReview'

/** 캐시 유효 시간(ms). */
export const REVIEW_TTL_MS = 5 * 60 * 1000

/** 'review' 응답에서 화면이 쓰는 것 — 검토표와 PDF 대상 견적 id. */
export type ReviewResult = { review: QuoteReview; quoteId: number | null }

/**
 * 캐시에 담아도 되는 응답인가 — **온전한 응답만** 담는다.
 * 품목이나 부대비용을 못 읽은 응답은 「다시 시도」가 걸린 화면이라 담지 않는다.
 */
export function isCacheable(res: ReviewResult | null | undefined): boolean {
  if (!res?.review) return false
  return res.review.itemsOk !== false && res.review.expensesOk !== false
}

type Entry = { at: number; value: ReviewResult }

/** 아직 살아 있는 항목인가. */
export const isFresh = (entry: Entry | undefined, now: number): boolean =>
  !!entry && now - entry.at < REVIEW_TTL_MS

export type ReviewCache = {
  /** 지금 바로 쓸 수 있는 값. 없으면 null — 패널이 첫 그림에서 자리표시를 띄울지 고르는 데 쓴다. */
  peek(documentId: number): ReviewResult | null
  /**
   * 읽어 온다. 캐시에 있으면 그것을, 같은 문서를 이미 부르고 있으면 **그 promise 를 함께 쓴다**
   * (행을 빠르게 두 번 펴도 요청은 한 번이다). 실패하면 null.
   * force: true 는 캐시를 무시하고 새로 부른다(「다시 시도」).
   */
  load(documentId: number, opts?: { force?: boolean }): Promise<ReviewResult | null>
  /** 결과를 기다리지 않고 미리 불러 둔다(행을 펼치는 순간). 실패는 조용히 버린다. */
  prefetch(documentId: number): void
}

/**
 * 캐시 본체 — 가져오는 방법(fetcher)과 시계(now)를 받아 만든다.
 * 그래서 이 로직은 네트워크·DB 없이 그대로 검증할 수 있다(가짜 fetcher·가짜 시계를 넣는다).
 */
export function createReviewCache(
  fetcher: (documentId: number) => Promise<ReviewResult | null>,
  now: () => number = Date.now,
): ReviewCache {
  const store = new Map<number, Entry>()
  const inflight = new Map<number, Promise<ReviewResult | null>>()

  const peek = (documentId: number): ReviewResult | null => {
    const hit = store.get(documentId)
    if (isFresh(hit, now())) return hit!.value
    // 묵은 항목은 그 자리에서 치운다 — 두고 있으면 Map 이 자라기만 한다.
    if (hit) store.delete(documentId)
    return null
  }

  const load = (documentId: number, opts?: { force?: boolean }): Promise<ReviewResult | null> => {
    if (!opts?.force) {
      const hit = peek(documentId)
      if (hit) return Promise.resolve(hit)
      const running = inflight.get(documentId)
      if (running) return running
    }
    const p = fetcher(documentId)
      .then(res => {
        if (isCacheable(res)) store.set(documentId, { at: now(), value: res! })
        return res
      })
      .catch(() => null)
      .finally(() => {
        // 내가 띄운 요청만 치운다 — force 로 겹쳐 돌 때 남의 것을 지우지 않게.
        if (inflight.get(documentId) === p) inflight.delete(documentId)
      })
    inflight.set(documentId, p)
    return p
  }

  return {
    peek,
    load,
    prefetch(documentId) { void load(documentId) },
  }
}

/** 브라우저에서 'review' 를 한 번 부른다. 실패·권한 없음은 null(부르는 쪽이 「못 읽었다」를 그린다). */
async function fetchReview(documentId: number): Promise<ReviewResult | null> {
  const res = await fetch('/api/quote-approval', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'review', document_id: documentId }),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json?.review) {
    console.error('[approval/review] 검토 정보 조회 실패', { documentId, status: res.status, error: json?.error })
    return null
  }
  return {
    review: json.review as QuoteReview,
    quoteId: typeof json.quoteId === 'number' ? json.quoteId : null,
  }
}

/** 화면 전체가 함께 쓰는 캐시 하나. 모듈 수준이라 패널이 마운트를 거듭해도 그대로 남는다. */
export const reviewCache = createReviewCache(fetchReview)
