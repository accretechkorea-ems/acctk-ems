// 브라우저에서 Sentry 를 켠다(Next.js 규약 파일).
//
// **DSN 이 없으면 아무것도 하지 않는다.** 기본 통합만 쓴다 — 미처리 예외와
// 처리되지 않은 약속 거부를 잡는 것이 전부다(Replay·성능 추적은 넣지 않는다).

import * as Sentry from '@sentry/nextjs'
import { SENTRY_COMMON, scrubEvent, sentryDsn } from '@/lib/sentryOptions'

const dsn = sentryDsn('browser')
if (dsn) {
  Sentry.init({
    dsn,
    ...SENTRY_COMMON,
    beforeSend: event => scrubEvent(event),
  })
}
