'use client'

/**
 * 홈 화면 앱에서만 뜨는 **한 줄 안내** (2026-11-26).
 *
 * ── 왜 필요한가 ────────────────────────────────────────────────────────────
 *   홈 화면에 깐 앱(standalone)은 Safari 와 **쿠키 그릇이 따로**다. Safari 에서 로그인해
 *   쓰던 사람이 앱을 처음 열면 로그인 화면이 뜬다 — 「방금 로그인했는데 왜 또?」가 된다.
 *   한 줄로 그 사실만 알린다. 고칠 수 있는 것이 아니라 **알면 끝나는 일**이다.
 *
 * ── 왜 useSyncExternalStore 인가 ──────────────────────────────────────────
 *   `display-mode: standalone` 은 **브라우저만 아는 값**이다. 서버가 그린 것과 브라우저가
 *   그린 것이 다르면 수화가 어긋난다(2026-11-26 에 그런 오류를 전 화면에서 하나 잡았다).
 *   useEffect + setState 로 해도 되지만 그것은 「그리고 나서 고치는」 모양이라
 *   set-state-in-effect 경고가 붙는다. 이 훅은 **서버 몫의 답을 따로 받는다** —
 *   서버는 늘 false 로 그리고, 브라우저는 처음부터 제 값을 쓴다. 어긋날 자리가 없다.
 */

import { useSyncExternalStore } from 'react'
import { R } from '@/lib/radius'

const QUERY = '(display-mode: standalone)'

/** 바뀌면 알려 준다 — 창을 Safari 에서 열었다 앱에서 열었다 할 수 있다. */
function subscribe(onChange: () => void): () => void {
  try {
    const mq = window.matchMedia(QUERY)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  } catch {
    // 비공개 모드·막힌 환경 — 안내가 안 뜰 뿐, 로그인은 그대로 된다.
    return () => {}
  }
}

/** 브라우저의 답. iOS Safari 는 navigator.standalone 으로도 알려 준다. */
function getSnapshot(): boolean {
  try {
    const nav = window.navigator as Navigator & { standalone?: boolean }
    return window.matchMedia(QUERY).matches || nav.standalone === true
  } catch {
    return false
  }
}

/** 서버의 답 — 알 수 없으니 **없는 것으로** 그린다. */
const getServerSnapshot = (): boolean => false

export default function StandaloneNote() {
  const standalone = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  if (!standalone) return null

  return (
    <div
      style={{
        marginTop: 16, padding: '10px 12px', background: '#111',
        border: '0.5px solid #2a2a2a', borderRadius: R.tile,
        fontSize: 12, lineHeight: 1.6, color: '#6b7280', textAlign: 'center',
      }}
    >
      홈 화면 앱은 Safari 와 로그인이 따로입니다. 한 번만 더 로그인해 주세요.
    </div>
  )
}
