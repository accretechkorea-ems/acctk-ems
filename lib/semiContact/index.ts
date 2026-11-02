// 반도체 고객 접촉 보고 — 순수 모듈 묶음. 화면·라우트·엑셀은 이 파일에서 가져온다.
//   fields   필드 등록표(라벨·섹션·선택지·이어쓰기·저장 위치)와 Action 줄 모양
//   prefill  이어쓰기(직전 보고에서 가져오기)와 바뀐 칸 찾기
//   validate 입력 검증(필드별 오류 문장)
//   storage  입력 객체 ↔ DB 행

/**
 * 라우트가 돌려준 오류를 **사람이 읽는 문장**으로.
 *
 * 접촉 보고서 라우트도 2026-11-02(D14b)부터 401·403 을 저장소 공용 모양으로 돌려준다
 * ('Unauthorized'/'Forbidden' — lib/apiCaller.ts). 그 글자를 그대로 띄우면 영어가 보이므로
 * **화면이 한국어로 바꿔 띄운다.** 종전에 라우트가 적어 보내던 문구와 같은 말이다.
 *   401 — 로그인이 필요합니다. 다시 로그인해 주세요.
 *   403 — 이 메뉴를 사용할 권한이 없습니다.
 * 그 밖의 상태는 라우트가 보낸 문구(입력 오류·중복 등)를 그대로 쓴다.
 */
export function apiErrorText(status: number, body: unknown, fallback: string): string {
  if (status === 401) return '로그인이 필요합니다. 다시 로그인해 주세요.'
  if (status === 403) return '이 메뉴를 사용할 권한이 없습니다.'
  const e = (body as { error?: unknown } | null)?.error
  return typeof e === 'string' && e ? e : fallback
}

export * from './fields'
export * from './prefill'
export * from './validate'
export * from './storage'
