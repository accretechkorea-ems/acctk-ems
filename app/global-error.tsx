'use client'

// React 가 그리다가 터졌을 때의 마지막 그물(Next.js 규약 파일).
//
// 이 파일이 없으면 Next.js 의 기본 오류 화면이 뜨고 **아무 기록도 남지 않는다.**
// 여기서 Sentry 에 한 번 올리고(DSN 이 없으면 Sentry 쪽이 조용히 아무것도 하지 않는다)
// 사람에게는 「새로 고쳐 보라」만 말한다 — 스택을 보여 줘도 할 수 있는 일이 없다.
//
// global-error 는 **자기 html·body 를 그려야 한다**(루트 레이아웃을 쓰지 못한다).

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang="ko">
      <body style={{ margin: 0, background: '#fafafa', fontFamily: 'var(--font-sans), sans-serif' }}>
        <div style={{
          minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div style={{
            background: '#ffffff', border: '1px solid #ebebeb', borderRadius: 8,
            padding: '24px 28px', maxWidth: 420, width: '100%', textAlign: 'center',
          }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#111827', letterSpacing: '-0.3px', marginBottom: 8 }}>
              화면을 그리지 못했습니다
            </div>
            <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.7, marginBottom: 18 }}>
              잠깐 생긴 문제일 수 있습니다. 새로 고쳐 보시고, 다시 같은 화면에서 멈추면
              알려 주세요. 오류는 자동으로 기록됩니다.
            </div>
            {/* 참조 번호 — Next.js 가 서버 오류에 붙이는 값이다. 있으면 보여 준다
                (Sentry 에서 그 번호로 찾을 수 있다). */}
            {error.digest && (
              <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 14 }}>
                참조 번호 {error.digest}
              </div>
            )}
            <button
              onClick={() => reset()}
              style={{
                padding: '9px 18px', background: '#234ea2', color: '#ffffff', border: 'none',
                borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}
            >
              다시 시도
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
