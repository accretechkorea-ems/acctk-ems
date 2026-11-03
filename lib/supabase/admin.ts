// service role 클라이언트 **한 곳**. 서버 전용이다.
//
// ── 왜 모으는가(docs/audit-2026-10.md D15 · A2·A7) ───────────────────────────
//   2026-10-23 조사에서 「service role 키가 56곳에 흩어진 것이 유일한 구조적 약점」으로
//   꼽혔다. 키가 바뀌는 것은 문제가 아니다(환경변수다). 문제는 **새 라우트에서 설정을
//   다르게 만들 여지**다 — 누군가 `auth: { persistSession: true }` 를 켜거나 URL 을
//   anon 쪽으로 적어도 아무도 모른다. 입구를 하나로 두면 그 여지가 사라진다.
//
// ── 어디서 쓰나 ─────────────────────────────────────────────────────────────
//   보통은 **직접 부르지 않는다.** 라우트는 loadCaller 가 돌려주는 `sb` 를 쓰고
//   (lib/apiCaller.ts), 그 안에서 이 함수가 한 번 불린다.
//   직접 부르는 자리는 셋뿐이다.
//     · lib/apiCaller.ts            — loadCaller 가 돌려줄 클라이언트를 만든다
//     · /api/lead                   — 로그인 없는 공개 폼이라 호출자가 없다
//     · lib/* 의 서버 전용 모듈      — 결재 완료 처리·알림·메일처럼 라우트 밖에서 도는 코드
//
// ── 화면에서 쓰지 마라 ──────────────────────────────────────────────────────
//   이 키는 RLS 를 통째로 지나간다. 클라이언트 번들에 들어가면 **누구나 모든 표를 읽고
//   쓴다.** `SUPABASE_SERVICE_ROLE_KEY` 는 NEXT_PUBLIC_ 접두어가 없어 번들에 들어가지
//   않지만(값이 undefined 가 된다), 그 사실에 기대지 말고 서버 파일에서만 import 한다.
//
// ── 세션 클라이언트와 가려 쓰기 ─────────────────────────────────────────────
//   · 판정 자료(engineers·teams)·라우트 본문 — **이것**(RLS 에 막혀 비면 사고다)
//   · 사용자 권한으로 지워야 하는 쓰기        — 세션 클라이언트(lib/supabase/server.ts)
//     예: /api/quote-delete 의 견적 DELETE 는 quotes 의 RLS 를 타야 한다.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/** 환경변수가 없을 때 — 어디를 봐야 하는지까지 적는다. */
const missing = (name: string): never => {
  throw new Error(
    `${name} 가 없습니다 — Vercel 환경변수(또는 .env.local)를 확인해 주세요. `
    + 'service role 클라이언트를 만들 수 없어 이 요청은 처리하지 못합니다.',
  )
}

/**
 * service role 클라이언트.
 *
 * **매번 새로 만든다.** 모듈에 하나를 들고 있지 않는 이유 — Next 의 서버 런타임은 요청마다
 * 모듈을 다시 쓰고(같은 인스턴스를 여러 요청이 공유한다) supabase-js 클라이언트는 그
 * 자체로 상태가 거의 없어(세션을 저장하지 않는다 — 아래 설정) 만드는 비용이 낮다.
 * 요청 하나에서 여러 번 필요하면 **받아서 넘겨 쓴다**(loadCaller 의 sb 가 그 길이다).
 *
 * 설정 두 가지를 못 박는다.
 *   persistSession   false — 서버에는 저장할 곳이 없다(기본값이 true 라 명시한다).
 *   autoRefreshToken false — service role 키는 만료가 없어 갱신 타이머가 필요 없다.
 *                            켜 두면 서버리스 함수가 타이머 때문에 늦게 끝날 수 있다.
 */
export function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url) missing('NEXT_PUBLIC_SUPABASE_URL')
  if (!key) missing('SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url!, key!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * service role 로 일할 준비가 되었는가 — **만들어 보지 않고** 환경변수만 본다.
 *
 * 몇몇 라우트가 본문에 들어가기 전에 이것을 보고, 설정이 없으면 **사람이 읽을 JSON** 으로
 * 돌려보낸다(그러지 않으면 클라이언트를 만드는 순간 터져서 화면이 응답을 파싱하지 못하고
 * 빈 `{}` 만 남는다 — app/api/inquiry 의 envReady 가 그 이유로 생겼다).
 *
 * 그 라우트들이 이 함수를 쓰므로, 키 이름을 적는 자리는 이 파일 하나로 남는다.
 */
export const adminEnvReady = (): boolean =>
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY
