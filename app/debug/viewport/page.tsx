'use client'

/**
 * **화면 진단** — 실기기(특히 iPhone Safari)에서 지금 무엇이 어떻게 재어지는지 (2026-11-26).
 *
 * ── 왜 화면으로 두는가 ───────────────────────────────────────────────────
 *   「고객사 목록이 오른쪽으로 잘린다」는 말이 iPhone 에서만 나왔다. Playwright
 *   WebKit(390)·크로미움 에뮬레이션 둘 다 재현되지 않아(scripts/ios-overflow.js)
 *   **그 기기에서 직접 읽는 수**가 필요하다. 폰에서 열어 「복사」를 누르면 JSON 한
 *   덩이가 클립보드에 담긴다.
 *
 * 메뉴에는 두지 않는다 — 주소를 아는 사람만 연다(로그인은 필요하다).
 * 권한은 lib/menuPerms.ts 의 PARENT_MENU 에서 'public'(로그인 전원)으로 걸어 두었다.
 *
 * 아무것도 쓰지 않는다. 읽기만 하는 화면이다.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePageGuard } from '@/hooks/usePageGuard'
import AccessGate from '@/components/common/AccessGate'
import { useToast } from '@/components/common/Toast'
import { R } from '@/lib/radius'
import { BLUE, BORDER, CARD_BG, MUTED, PAGE_BG, SUB, TEXT } from '@/components/common/ui'

/** 한 요소를 가리키는 짧은 이름 — 태그 + id + class 앞부분. */
function selectorOf(el: Element): string {
  const tag = el.tagName.toLowerCase()
  const id = el.id ? `#${el.id}` : ''
  const cls = String((el as HTMLElement).className || '')
    .split(/\s+/).filter(Boolean).slice(0, 3).map(c => `.${c}`).join('')
  return `${tag}${id}${cls}`.slice(0, 60)
}

type Report = Record<string, unknown>

/** 지금 화면의 값을 통째로 읽는다. 여기서 재는 것이 곧 보고서다. */
function readAll(probe: HTMLElement | null): Report {
  const de = document.documentElement
  const vv = window.visualViewport
  const box = (sel: string) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return {
      top: Math.round(r.top), left: Math.round(r.left), height: Math.round(r.height),
      width: Math.round(r.width), right: Math.round(r.right),
      display: cs.display, visibility: cs.visibility, zIndex: cs.zIndex, position: cs.position,
      marginLeft: cs.marginLeft, paddingLeft: cs.paddingLeft,
    }
  }

  // 창 밖으로 나간 요소 — 오른쪽(right > 창)과 왼쪽(left < 0) 둘 다.
  const vw = window.innerWidth
  const out: { selector: string; left: number; right: number; width: number; position: string }[] = []
  for (const el of Array.from(document.querySelectorAll('body *'))) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    if (r.right <= vw + 0.5 && r.left >= -0.5) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    out.push({
      selector: selectorOf(el),
      left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width),
      position: cs.position,
    })
  }
  out.sort((a, b) => (b.right - vw) - (a.right - vw) || a.left - b.left)

  // 안전 영역 — env() 는 값으로 읽을 수 없다. 자리표 요소의 padding 으로 받아 px 로 읽는다.
  const safe = probe ? (() => {
    const cs = getComputedStyle(probe)
    return { top: cs.paddingTop, right: cs.paddingRight, bottom: cs.paddingBottom, left: cs.paddingLeft }
  })() : null

  const sheets = Array.from(document.styleSheets).map(s => {
    let rules = -1
    try { rules = s.cssRules?.length ?? -1 } catch { rules = -1 }   // 다른 출처면 못 읽는다
    return { href: s.href ? s.href.replace(location.origin, '') : '(inline)', rules }
  })

  return {
    때: new Date().toISOString(),
    userAgent: navigator.userAgent,
    창: { innerWidth: window.innerWidth, innerHeight: window.innerHeight, dpr: window.devicePixelRatio },
    문서: { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, bodyScrollWidth: document.body.scrollWidth },
    visualViewport: vv
      ? { width: Math.round(vv.width), height: Math.round(vv.height), scale: Number(vv.scale.toFixed(3)), offsetLeft: Math.round(vv.offsetLeft), offsetTop: Math.round(vv.offsetTop), pageLeft: Math.round(vv.pageLeft) }
      : '(없음)',
    html: { overflowX: getComputedStyle(de).overflowX, width: getComputedStyle(de).width },
    body: { overflowX: getComputedStyle(document.body).overflowX, width: getComputedStyle(document.body).width },
    'ems-topbar': box('.ems-topbar'),
    'ems-main': box('.ems-main'),
    'ems-sidebar': box('.ems-sidebar'),
    '≤768 매치': window.matchMedia('(max-width: 768px)').matches,
    safeArea: safe,
    넘친요소: out.slice(0, 10),
    넘친수: out.length,
    스타일시트: { 수: sheets.length, 목록: sheets.slice(0, 8) },
    'globals.css 적용': getComputedStyle(de).getPropertyValue('--color-brand').trim() || '(없음 — globals.css 가 안 들었다)',
  }
}

const KEY: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: MUTED, marginBottom: 2 }
const VAL: React.CSSProperties = {
  fontSize: 15, color: TEXT, wordBreak: 'break-all', lineHeight: 1.5,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
}

export default function ViewportDebugPage() {
  const { loading, authorized } = usePageGuard()
  const toast = useToast()
  const probeRef = useRef<HTMLDivElement | null>(null)
  const [report, setReport] = useState<Report | null>(null)

  const refresh = useCallback(() => { setReport(readAll(probeRef.current)) }, [])

  useEffect(() => {
    if (!authorized) return
    // 처음 한 번은 **그린 뒤**에 잰다(배치가 끝난 값이 필요하다).
    const t = setTimeout(refresh, 400)
    const on = () => refresh()
    window.addEventListener('resize', on)
    window.addEventListener('orientationchange', on)
    window.visualViewport?.addEventListener('resize', on)
    window.visualViewport?.addEventListener('scroll', on)
    return () => {
      clearTimeout(t)
      window.removeEventListener('resize', on)
      window.removeEventListener('orientationchange', on)
      window.visualViewport?.removeEventListener('resize', on)
      window.visualViewport?.removeEventListener('scroll', on)
    }
  }, [authorized, refresh])

  if (!authorized) return <AccessGate loading={loading} />

  const copy = async () => {
    const text = JSON.stringify(report ?? readAll(probeRef.current), null, 2)
    try {
      await navigator.clipboard.writeText(text)
      toast.success('진단값을 복사했습니다')
    } catch {
      // 클립보드가 막힌 기기(iOS 의 일부 상황) — 글자를 골라 둬서 손으로 복사하게 한다.
      const el = document.getElementById('debug-json')
      if (el) {
        const range = document.createRange()
        range.selectNodeContents(el)
        const sel = window.getSelection()
        sel?.removeAllRanges(); sel?.addRange(range)
      }
      toast.error('복사가 막혀 있습니다 — 아래 글자를 길게 눌러 복사하세요')
    }
  }

  const rows = Object.entries(report ?? {})

  return (
    <div style={{ background: PAGE_BG, minHeight: '100vh', padding: 12, boxSizing: 'border-box' }}>
      {/* 안전 영역 자리표 — 보이지 않지만 env() 를 px 로 바꿔 준다. */}
      <div ref={probeRef} aria-hidden
        style={{
          position: 'absolute', width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none',
          paddingTop: 'env(safe-area-inset-top)', paddingRight: 'env(safe-area-inset-right)',
          paddingBottom: 'env(safe-area-inset-bottom)', paddingLeft: 'env(safe-area-inset-left)',
        }} />

      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap',
      }}>
        <b style={{ fontSize: 17, fontWeight: 800, color: TEXT, letterSpacing: '-0.3px' }}>화면 진단</b>
        <span style={{ fontSize: 12, color: MUTED }}>읽기만 합니다</span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={refresh}
          style={{ height: 40, padding: '0 14px', borderRadius: R.control, border: `1px solid ${BORDER}`, background: CARD_BG, color: SUB, fontSize: 14, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>
          다시 재기
        </button>
        <button type="button" onClick={() => void copy()}
          style={{ height: 40, padding: '0 16px', borderRadius: R.control, border: 'none', background: BLUE, color: CARD_BG, fontSize: 14, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>
          복사
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: R.card, padding: '10px 12px' }}>
            <div style={KEY}>{k}</div>
            <div style={VAL}>
              {typeof v === 'object' && v !== null
                ? JSON.stringify(v, null, 1).replace(/[{}"]/g, '').split('\n').filter(l => l.trim()).join('\n')
                : String(v)}
            </div>
          </div>
        ))}
      </div>

      {/* 클립보드가 막힌 기기를 위한 날것 — 길게 눌러 복사한다. */}
      <pre id="debug-json"
        style={{
          marginTop: 12, padding: 10, background: CARD_BG, border: `1px solid ${BORDER}`,
          borderRadius: R.card, fontSize: 11, color: SUB, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          userSelect: 'all',
        }}>
        {JSON.stringify(report ?? {}, null, 2)}
      </pre>
    </div>
  )
}
