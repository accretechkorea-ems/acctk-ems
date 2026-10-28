// 서버·엣지에서 Sentry 를 켠다(Next.js 규약 파일).
//
// **DSN 이 없으면 아무것도 하지 않는다** — 로컬·CI 는 키 없이 돌아야 한다.
// 무엇을 보내고 무엇을 지우는지는 lib/sentryOptions.ts 한곳에 있다.

import * as Sentry from '@sentry/nextjs'
import { SENTRY_COMMON, scrubEvent, sentryDsn } from '@/lib/sentryOptions'

export async function register() {
  const dsn = sentryDsn('server')
  if (!dsn) return
  Sentry.init({
    dsn,
    ...SENTRY_COMMON,
    beforeSend: event => scrubEvent(event),
  })
}

/**
 * 서버 라우트·서버 컴포넌트의 **미처리 예외**를 받는다(Next.js 가 부른다).
 *
 * 라우트가 try/catch 로 잡아 400·500 을 돌려주는 경우는 여기 오지 않는다 — 그건 이미
 * 다루고 있는 오류다. 여기 오는 것은 **아무도 잡지 않은** 것이다.
 */
export const onRequestError = Sentry.captureRequestError
