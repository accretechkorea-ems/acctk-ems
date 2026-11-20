'use client'

// **PDF 모달 뷰어** — 견적서·거래명세서·수리내역서를 그 자리에서 본다.
//
// 새 탭으로 던지면 돌아올 때 목록이 처음 상태로 되감긴다(필터·스크롤). 한 건씩 훑으며
// 확인하는 일이라 **보던 화면 위에** 띄우는 편이 짧다.
//
// ── 서명 URL 을 iframe 에 **직접 넣지 않는다** ─────────────────────────────
//   CSP 의 frame-src 에 Supabase 도메인이 없어서, 서명 URL 을 그대로 넣으면 브라우저가
//   「이 콘텐츠는 차단되어 있습니다」로 막는다. 그 도메인을 frame-src 에 여는 대신
//   **파일을 받아 와 blob: 로 바꿔** 띄운다 — frame-src 에는 blob: 이 이미 있고(react-pdf
//   미리보기가 쓴다), 받아 오는 길은 connect-src 가 이미 열어 둔 그 길이다. 그래서
//   CSP 는 한 글자도 바꾸지 않았다. 닫을 때 그 blob 주소를 반납한다(revokeObjectURL).
//
// ── 못 그리면 새 탭 ────────────────────────────────────────────────────────
//   내려받기가 실패하거나 iframe 이 **12초** 안에 못 그리면 원래 서명 URL 로 새 탭을 연다.
//   (모바일 사파리처럼 처음부터 못 그리는 환경은 lib/pdfViewer.ts 가 먼저 가른다.)
//
// ── 창은 **폭을 먼저** 잡는다 ─────────────────────────────────────────────
//   사람이 먼저 보는 것은 글자 크기다. 쪽 비율에 맞춰 가로를 정하면 노트북에서 창이
//   500px 까지 좁아져 글자가 읽히지 않았다. 가로를 화면의 92%(최대 1100px)로 넓게 잡고
//   세로는 화면의 96% 로 둔다(lib/pdfViewer.ts 의 pdfViewerBox). 쪽은 가로에 맞춰 펴지고
//   (view=FitH) 넘치는 만큼은 뷰어 안에서 구른다. 창 바탕은 뷰어 배경색과 같게 둔다.
//
// ── 모션은 이 모달의 것이다 ────────────────────────────────────────────────
//   공용 ModalOverlay 를 건드리지 않는다(29개 모달이 함께 쓰는 자리다). 열릴 때 배경
//   0→1(150ms)과 창 0→1·아래서 8px·0.98→1(180ms ease-out), 닫힐 때 역순 120ms.
//   prefers-reduced-motion 이면 둘 다 즉시다.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Z } from '@/lib/zIndex'
import { useOverlayEsc } from '@/components/common/overlayStack'
import { PDF_VIEW_PARAMS, VIEWER_BG, VIEWER_HEADER_H, pdfViewerBox } from '@/lib/pdfViewer'
import type { PdfDoc } from '@/lib/pdfViewer'
import { R } from '@/lib/radius'

const BORDER = '#ebebeb'
const MUTED = '#9ca3af'

/** 내려받기 + 그리기가 이 시간 안에 안 끝나면 새 탭으로 보낸다. */
const LOAD_TIMEOUT = 12000

export type PdfViewerModalProps = {
  doc: PdfDoc
  onClose: () => void
}

export default function PdfViewerModal({ doc, onClose }: PdfViewerModalProps) {
  const reduced = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const [shown, setShown] = useState(reduced)
  const [closing, setClosing] = useState(false)
  /** 받아 온 파일의 blob 주소 — iframe 은 이것만 본다. */
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closedRef = useRef(false)
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  /** 창 치수 — A4 비율로 잡는다(lib/pdfViewer.ts 의 pdfViewerBox). 화면이 바뀌면 다시 잰다. */
  const [box, setBox] = useState(() => (typeof window === 'undefined'
    ? { width: 720, height: 980, bodyHeight: 980 - VIEWER_HEADER_H }
    : pdfViewerBox(window.innerWidth, window.innerHeight)))

  useEffect(() => {
    const onResize = () => setBox(pdfViewerBox(window.innerWidth, window.innerHeight))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const stopTimer = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } }

  /** 못 그린다 — 원래 주소로 새 탭을 열고 모달을 닫는다. */
  const bailToTab = () => {
    if (closedRef.current) return
    closedRef.current = true
    stopTimer()
    window.open(doc.url, '_blank')
    onClose()
  }

  useEffect(() => {
    if (reduced) return
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [reduced])

  // 파일을 받아 blob 주소로 바꾼다. 닫을 때 반납한다.
  useEffect(() => {
    let alive = true
    let made: string | null = null
    timer.current = setTimeout(bailToTab, LOAD_TIMEOUT)
    ;(async () => {
      try {
        const res = await fetch(doc.url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const blob = await res.blob()
        if (!alive) return
        made = URL.createObjectURL(blob)
        setBlobUrl(made)
      } catch (e) {
        console.error('[pdfViewer] 파일을 받지 못했다 — 새 탭으로 보낸다', e)
        if (alive) bailToTab()
      }
    })()
    return () => {
      alive = false
      stopTimer()
      if (made) URL.revokeObjectURL(made)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.url])

  const close = () => {
    if (closedRef.current) return
    closedRef.current = true
    if (reduced) { onClose(); return }
    setClosing(true)
    setTimeout(onClose, 120)
  }

  // Esc — **맨 위 오버레이만** 받는다(components/common/overlayStack.ts).
  // 뷰어는 수리 정보 모달·견적 목록 팝업 위에서 열리므로, 각자 keydown 을 달면 Esc 한 번에
  // 두 겹이 닫힌다.
  useOverlayEsc(true, () => close())

  /**
   * 인쇄 — 뷰어 안의 문서를 그대로 인쇄 대화상자로 보낸다.
   * blob 은 이 화면과 같은 출처라 contentWindow 를 만질 수 있다. 그래도 막는 브라우저가
   * 있어(PDF 를 플러그인으로 그리는 자리) 실패하면 새 탭으로 보낸다 — 거기서 인쇄하면 된다.
   */
  const printDoc = () => {
    const w = frameRef.current?.contentWindow
    try {
      if (w) { w.focus(); w.print(); return }
    } catch (e) {
      console.error('[pdfViewer] 인쇄를 열지 못했다 — 새 탭으로 보낸다', e)
    }
    window.open(doc.url, '_blank')
  }

  const open = shown && !closing
  const motion = reduced ? 'none' : undefined
  const linkStyle: React.CSSProperties = {
    padding: '4px 9px', border: `1px solid ${BORDER}`, borderRadius: R.icon,
    fontSize: 11, fontWeight: 700, color: '#234ea2', textDecoration: 'none',
    background: '#fff', cursor: 'pointer',
  }

  // **body 끝에 붙인다**(포털) — 모달 안에서 열려도 그 모달의 스택 컨텍스트·overflow 에
  // 갇히지 않는다. 띄울 곳이 아직 없으면(서버 렌더) 아무것도 그리지 않는다.
  if (typeof document === 'undefined') return null

  return createPortal((
    <div
      onMouseDown={e => { if (e.target === e.currentTarget) close() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: Z.viewer,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        opacity: open ? 1 : 0,
        transition: motion ?? `opacity ${closing ? 120 : 150}ms ease-out`,
      }}
    >
      <div
        style={{
          // 가로세로가 A4 를 따른다 — 그래야 뷰어가 좌우를 제 배경색으로 채우지 않는다.
          width: box.width, height: box.height, background: VIEWER_BG, borderRadius: R.control,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.22)',
          opacity: open ? 1 : 0,
          transform: open ? 'translateY(0) scale(1)' : 'translateY(8px) scale(0.98)',
          transition: motion ?? `opacity ${closing ? 120 : 180}ms ease-out, transform ${closing ? 120 : 180}ms ease-out`,
        }}
      >
        <div style={{
          height: VIEWER_HEADER_H, flexShrink: 0, boxSizing: 'border-box',
          display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px',
          background: '#fff', borderBottom: `1px solid ${BORDER}`,
        }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {doc.name}
          </span>
          <span style={{ flex: 1 }} />
          {/* 문서마다 다른 한 가지 — 수리내역서에서는 「정보 수정」이다. */}
          {doc.action && (
            <button onClick={() => { doc.action?.onClick(); close() }} style={linkStyle}>
              {doc.action.label}
            </button>
          )}
          <button onClick={printDoc} style={linkStyle}>인쇄</button>
          <a href={doc.url} target="_blank" rel="noopener noreferrer" style={linkStyle}>새 탭</a>
          {/* 내려받기는 blob 주소로 한다 — 다른 도메인의 주소에는 download 가 먹지 않는다. */}
          <a href={blobUrl ?? doc.url} download={doc.name} style={linkStyle}>다운로드</a>
          <button onClick={close} title="닫기" aria-label="닫기"
            style={{ width: 24, height: 24, padding: 0, background: 'none', border: 'none', cursor: 'pointer', color: MUTED, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        {blobUrl ? (
          <iframe
            ref={frameRef}
            // 검은 툴바·쪽 목록을 감추고 가로에 맞춰 편다(듣지 않는 브라우저는 기본 모양).
            src={blobUrl + PDF_VIEW_PARAMS}
            title={doc.name}
            onLoad={stopTimer}
            onError={bailToTab}
            style={{ flex: 1, width: '100%', border: 'none', background: VIEWER_BG }}
          />
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: MUTED, background: VIEWER_BG }}>
            문서를 불러오는 중…
          </div>
        )}
      </div>
    </div>
  ), document.body)
}
