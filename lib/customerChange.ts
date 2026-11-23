'use client'

// 고객사 **바꾸기 라우트** 한 번(/api/customer-change) — 화면 셋이 함께 쓴다.
//
// 저장과 **사건 기록**(customer_events)을 서버가 한 자리에서 한다. 브라우저가 표를 직접
// 고치면 사건을 적을 수 없다 — 그 표는 service role 만 쓸 수 있다.
// 돌려주는 모양은 화면이 쓰기 좋게 { ok, data } | { ok:false, error } 로 맞춘다.

export type ChangeResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string }

export async function customerChange(body: Record<string, unknown>): Promise<ChangeResult> {
  try {
    const res = await fetch('/api/customer-change', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || json?.error) {
      // 401 은 로그인이 끊긴 것이다(퇴사 처리 포함) — 서버가 보낸 말을 그대로 보여 준다.
      return { ok: false, error: json?.error ?? `서버 오류 (${res.status})` }
    }
    return { ok: true, data: json }
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || '저장하지 못했습니다' }
  }
}
