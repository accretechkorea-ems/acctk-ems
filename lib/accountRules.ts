// 계정 문턱 한 벌 — **퇴사자 차단**과 **비밀번호 최소 길이** (2026-11-23).
//
// 왜 모으는가
//   · 퇴사 차단이 지금까지 **서버 라우트에만** 있었다(lib/apiCaller.ts). 화면은 그대로 열리고,
//     로그인도 그대로 됐다. 「퇴사 처리」를 눌러도 그 사람은 어제처럼 들어와 목록을 읽었다
//     (읽기는 RLS 가 재직 여부를 보지 않는다). 막는 자리가 넷이라 글자와 판정을 한곳에 둔다.
//       ① 로그인      app/login/page.tsx     — 들어오는 문
//       ② 세션 갱신   lib/appData/me.ts      — 이미 열려 있는 화면(다음 조회에서 끊긴다)
//       ③ 화면 이동   middleware.ts          — 이미 열려 있는 탭(다음 이동에서 /login)
//       ④ 서버 라우트 lib/apiCaller.ts       — 쓰기·읽기 모두 401
//   · 비밀번호 최소 길이가 **생성 8 / 변경 6** 으로 갈려 있었다(docs/maintenance-audit-20261123.md G8).
//     짧은 쪽이 사실상의 기준이 되므로 **둘 다 8** 로 맞추고 숫자를 여기 하나만 둔다.
//
// 순수 모듈이다(import 가 없다) — 미들웨어(Edge)·서버 라우트·브라우저가 함께 읽는다.
// 하네스(scripts/account-guard-check.js)가 키 없이 같은 함수를 시험한다.

/** 퇴사자에게 보이는 한 마디. 로그인 화면·API 응답이 같은 글자를 쓴다. */
export const RESIGNED_MESSAGE = '퇴사 처리된 계정입니다'

/** 퇴사로 끊긴 뒤 돌아가는 로그인 주소의 까닭 값(?reason=). */
export const RESIGNED_REASON = 'resigned'

/** 비밀번호 최소 길이 — 만들 때도 바꿀 때도 같다. */
export const PASSWORD_MIN = 8

/** 길이가 모자랄 때의 문구. 화면 셋이 같은 말을 쓴다. */
export const PASSWORD_SHORT_MESSAGE = `비밀번호는 ${PASSWORD_MIN}자 이상이어야 합니다.`

/** 판정에 쓰는 최소 모양 — engineers 한 행을 그대로 넘길 수 있게 느슨하게 둔다. */
export type ResignedLike = { resigned_date?: string | null } | null | undefined

/**
 * 퇴사 처리된 계정인가 — **날짜가 들어 있으면 끝이다**(미래 날짜도 퇴사로 본다).
 *
 * 미래 날짜를 봐주지 않는 이유: 퇴사일을 미리 적어 두는 쓰임이 지금 없고, 「오늘 이후면
 * 아직 재직」으로 두면 그 판정이 네 자리에서 각각 시계를 봐야 한다. 미리 적는 쓰임이
 * 생기면 그때 이 함수 하나만 고친다.
 */
export function isResigned(row: ResignedLike): boolean {
  return !!(row?.resigned_date ?? null)
}

/** 비밀번호가 쓸 수 있는 길이인가. 앞뒤 공백은 지우지 않는다(비밀번호의 공백도 글자다). */
export function isPasswordLongEnough(value: string | null | undefined): boolean {
  return (value ?? '').length >= PASSWORD_MIN
}
