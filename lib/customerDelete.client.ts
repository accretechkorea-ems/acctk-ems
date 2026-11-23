'use client'

// 지우기 라우트 한 번(/api/customer-delete) — 화면이 쓰는 얇은 함수.
//
// 규칙은 lib/customerDelete.ts(순수)에 있고, 여기는 **부르는 법**만 둔다.
// 나누는 까닭: 순수 모듈은 하네스와 서버 라우트가 함께 읽는데, 'use client' 가 붙으면
// 서버에서 읽을 때 번들러가 경고를 낸다.

export type DeleteCallResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string }

export async function customerDelete(body: Record<string, unknown>): Promise<DeleteCallResult> {
  try {
    const res = await fetch('/api/customer-delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || json?.error) return { ok: false, error: json?.error ?? `서버 오류 (${res.status})` }
    return { ok: true, data: json }
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || '지우지 못했습니다' }
  }
}
