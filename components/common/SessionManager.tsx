'use client'

// 30분 무활동 자동 로그아웃 — **1분 전에 알리고**, 숨은 탭에서는 돌아온 순간에 판정한다.
//
// ── 2026-10-28 전에는 무엇이 문제였나 ──────────────────────────────────────
//   안내가 alert() 한 줄이었고, 그것도 signOut() **뒤**에 있었다. 브라우저는 **숨은 탭의
//   대화창을 띄우지 않고 그냥 닫는다**(Chrome 은 2017년부터). 30분을 쉰다는 것은 보통 그
//   탭이 숨어 있다는 뜻이라, 로그아웃은 일어나고 안내만 사라졌다 — 돌아와 보면 이유 없이
//   로그인 화면이었다. 탭이 여럿이면 더 분명했다: 안내는 타이머가 터진 탭에만 있고,
//   보고 있던 탭은 세션만 조용히 끊겼다.
//
// ── 지금 규칙 ──────────────────────────────────────────────────────────────
//   보이는 탭   29분 → 경고 모달(「계속 사용」) · 30분 → signOut → /login?reason=idle
//   숨은 탭     **아무것도 하지 않는다.** 돌아온 순간(visibilitychange) 경과를 다시 재서
//               30분을 넘었으면 로그아웃, 29~30분이면 경고 모달.
//   다른 탭     한 탭이 무활동으로 로그아웃하면 SIGNED_OUT 을 받아 같은 곳으로 간다.
//               「무활동 때문」임은 localStorage 표식(IDLE_FLAG)으로 가른다 — 사이드바에서
//               손으로 로그아웃한 경우에 「30분 동안 활동이 없어」라고 하면 거짓말이 된다.
//   연장        활동(클릭·키·마우스)과 「계속 사용」은 localStorage 의 lastActivity 를
//               갱신한다. 그 칸은 탭이 공유하므로 **모든 탭의 타이머가 함께 연장된다.**
//
//   숨은 탭에서 바로 끊지 않으므로, 탭을 열어 둔 채 30분이 지나면 세션은 돌아올 때까지
//   살아 있다. 돌아오는 즉시 끊기고 이유가 보인다 — 조용히 끊고 이유를 못 보여 주는
//   종전 동작보다 이쪽이 낫다고 보았다.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { isPublicPath } from '@/lib/publicPaths'
import ModalOverlay from './ModalOverlay'
import { Z } from '@/lib/zIndex'

/** 로그아웃까지의 무활동 시간. */
const IDLE_MS = 30 * 60 * 1000
/** 경고 모달이 뜨는 시점 — 로그아웃 1분 전. */
const WARN_MS = 29 * 60 * 1000
/**
 * 검사 간격. 예전에는 60초였는데 그러면 「1분 전 경고」가 1분 뒤에 뜨거나
 * 아예 못 뜨고 지나간다(29분과 30분 사이가 한 칸이다). 10초면 경고와 로그아웃이
 * 제 시각에 걸린다. 하는 일은 localStorage 한 칸 읽기뿐이다.
 */
const TICK_MS = 10 * 1000
/** 활동 시각(모든 탭이 공유한다). */
const ACTIVITY_KEY = 'lastActivity'
/** 무활동 로그아웃 표식 — 다른 탭이 사유를 알아보는 데 쓴다. */
const IDLE_FLAG = 'idleLogoutAt'
/** 그 표식을 믿어 주는 시간. 지나면 손으로 한 로그아웃으로 본다. */
const IDLE_FLAG_TTL = 15 * 1000

/** /login 이 읽는 사유 값. 로그인 화면이 이 글자로 안내를 낸다. */
export const IDLE_REASON = 'idle'
/** 무활동으로 끊겼을 때 가는 곳. 로그인 화면·여기 둘이 같은 글자를 쓴다. */
export const IDLE_LOGIN_PATH = `/login?reason=${IDLE_REASON}`

export default function SessionManager() {
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createClient()
  // 공개 페이지는 로그인 세션이 없다. 감시를 걸어두면 외부 방문자가 폼을 오래 붙들고 있을 때
  // 자동 로그아웃 안내가 뜨고 /login 으로 튕긴다. 훅 순서는 유지한 채 동작만 건너뛴다.
  const isPublic = isPublicPath(pathname)

  const [warnOpen, setWarnOpen] = useState(false)
  // 로그아웃을 두 번 하지 않게. 10초 검사와 visibilitychange 가 겹칠 수 있다.
  const leavingRef = useRef(false)

  /** 마지막 활동으로부터 지난 시간(ms). 값이 없으면 0 — 막 들어온 것으로 본다. */
  const idleFor = () => {
    const raw = Number(localStorage.getItem(ACTIVITY_KEY))
    if (!Number.isFinite(raw) || raw <= 0) return 0
    return Date.now() - raw
  }

  const touch = useCallback(() => {
    localStorage.setItem(ACTIVITY_KEY, String(Date.now()))
    // 경고가 떠 있었다면 닫는다 — 사람이 돌아왔다. 다음 검사(최대 10초)를 기다리지 않는다.
    // 이미 false 면 React 가 다시 그리지 않으므로 조건 없이 부른다(마우스 이동마다 온다).
    setWarnOpen(false)
  }, [])

  /** 무활동으로 끊는다. 다른 탭이 사유를 알 수 있게 표식을 먼저 남긴다. */
  const logoutIdle = useCallback(async () => {
    if (leavingRef.current) return
    leavingRef.current = true
    setWarnOpen(false)
    try {
      localStorage.setItem(IDLE_FLAG, String(Date.now()))
      await supabase.auth.signOut()
    } catch (e) {
      console.error('[session] 자동 로그아웃 실패', e)
    }
    router.replace(IDLE_LOGIN_PATH)
  }, [router, supabase])

  /**
   * 지금 상태를 판정한다 — 10초마다, 그리고 탭으로 **돌아온 순간**.
   *
   * **숨은 탭에서는 아무것도 하지 않는다.** 그 자리에서 끊으면 안내를 보여 줄 수 없고,
   * 모달을 띄워도 아무도 못 본다. 판정은 돌아올 때 한 번에 한다.
   */
  const check = useCallback(() => {
    if (document.visibilityState !== 'visible') return
    const idle = idleFor()
    if (idle >= IDLE_MS) { void logoutIdle(); return }
    // 29분을 넘었으면 열고, 활동으로 줄어들었으면 닫는다(같은 값이면 React 가 다시 그리지 않는다).
    setWarnOpen(idle >= WARN_MS)
  }, [logoutIdle])

  // ── 활동 기록 ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (isPublic) return
    let lastMouseMove = 0
    const onMouseMove = () => {
      const now = Date.now()
      if (now - lastMouseMove < 10000) return
      lastMouseMove = now
      touch()
    }

    localStorage.setItem(ACTIVITY_KEY, String(Date.now()))
    // 지난 무활동 표식은 지운다. 남겨 두면 끊긴 뒤 바로 다시 로그인하고 **손으로** 로그아웃한
    // 경우(15초 안)에 다른 탭이 「30분 동안 활동이 없어」라는 거짓 사유를 보게 된다.
    localStorage.removeItem(IDLE_FLAG)

    window.addEventListener('click', touch)
    window.addEventListener('keydown', touch)
    window.addEventListener('mousemove', onMouseMove)

    return () => {
      window.removeEventListener('click', touch)
      window.removeEventListener('keydown', touch)
      window.removeEventListener('mousemove', onMouseMove)
    }
  }, [isPublic, touch])

  // ── 검사 — 10초마다 + 탭으로 돌아올 때 ────────────────────────────────
  useEffect(() => {
    if (isPublic) return
    const interval = setInterval(check, TICK_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [isPublic, check])

  // ── 다른 탭에서 끊긴 경우 ─────────────────────────────────────────────
  // 무활동 표식이 방금 찍힌 것이면 같은 곳으로 간다. 표식이 없으면(= 손으로 한 로그아웃)
  // 종전처럼 그대로 둔다 — 그 흐름은 사이드바가 제 갈 곳으로 보낸다.
  useEffect(() => {
    if (isPublic) return
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event !== 'SIGNED_OUT') return
      const at = Number(localStorage.getItem(IDLE_FLAG))
      if (!Number.isFinite(at) || Date.now() - at > IDLE_FLAG_TTL) return
      leavingRef.current = true
      setWarnOpen(false)
      router.replace(IDLE_LOGIN_PATH)
    })
    return () => { listener.subscription.unsubscribe() }
  }, [isPublic, router, supabase])

  if (!warnOpen) return null

  // 경고 모달 — 확인 창(ConfirmDialog)과 같은 모양·같은 층(Z.confirm)이다. 단추는 하나다:
  // 「취소」가 뜻을 가질 자리가 아니다(아무것도 하지 않으면 1분 뒤에 끊긴다).
  // 바깥을 눌러도 「계속 사용」으로 본다 — 누른 것 자체가 활동이다.
  return (
    <ModalOverlay onClose={touch} style={{ zIndex: Z.confirm }}>
      <style>{`@keyframes session-warn-in { from { opacity: 0; transform: scale(0.97) translateY(8px); } to { opacity: 1; transform: scale(1) translateY(0); } }`}</style>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 400, background: '#ffffff', borderRadius: 8, padding: 24,
          boxShadow: '0 20px 60px rgba(0,0,0,0.22)', border: '1px solid #ebebeb',
          animation: 'session-warn-in 0.18s ease',
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, color: '#111827', letterSpacing: '-0.2px', marginBottom: 10 }}>
          1분 뒤 자동 로그아웃됩니다
        </div>
        <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.6, marginBottom: 22 }}>
          30분 동안 활동이 없었습니다. 계속 사용하시겠습니까?
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            autoFocus
            onClick={touch}
            onMouseEnter={e => { e.currentTarget.style.background = '#1c3e87' }}
            onMouseLeave={e => { e.currentTarget.style.background = '#234ea2' }}
            style={{
              padding: '9px 18px', background: '#234ea2', color: '#fff', borderRadius: 6,
              border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13,
              fontFamily: 'inherit', transition: 'background 0.15s ease',
            }}
          >
            계속 사용
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}
