'use client'

// **PDF 모달 뷰어** — 견적서·거래명세서·수리내역서를 그 자리에서 본다.
//
// 새 탭으로 던지면 돌아올 때 목록이 처음 상태로 되감긴다(필터·스크롤). 한 건씩 훑으며
// 확인하는 일이라 **보던 화면 위에** 띄우는 편이 짧다.
//
// ── 여는 길이 막히면 새 탭 ─────────────────────────────────────────────────
//   iframe 안에서 PDF 를 못 그리는 환경이 있다(모바일 사파리). 그 판정은 lib/pdfViewer.ts
//   가 미리 하고, 그래도 iframe 이 **실패하거나 12초가 지나도 못 그리면** 여기서 새 탭으로
//   보내고 모달을 닫는다 — 빈 네모를 보여 주고 끝내지 않는다.
//
// ── 모션은 이 모달의 것이다 ────────────────────────────────────────────────
//   공용 ModalOverlay 를 건드리지 않는다(29개 모달이 함께 쓰는 자리다). 열릴 때 배경
//   0→1(150ms)과 창 0→1·아래서 8px·0.98→1(180ms ease-out), 닫힐 때 역순 120ms.
//   prefers-reduced-motion 이면 둘 다 즉시다.

import { useEffect, useRef, useState } from 'react'
import { Z } from '@/lib/zIndex'
import type { PdfDoc } from '@/lib/pdfViewer'

const BORDER = '#ebebeb'
const MUTED = '#9ca3af'

/** iframe 이 이 시간 안에 못 뜨면 새 탭으로 보낸다. */
const LOAD_TIMEOUT = 12000

export type PdfViewerModalProps = {
  doc: PdfDoc
  onClose: () => void
}

export default function PdfViewerModal({ doc, onClose }: PdfViewerModalProps) {
  /** 움직임을 줄여 달라는 설정이면 모션 없이 즉시 바꾼다. */
  const reduced = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const [shown, setShown] = useState(reduced)
  const [closing, setClosing] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 다음 프레임에 켜야 전환이 돈다(처음 그릴 때 이미 켜져 있으면 전환이 없다).
  useEffect(() => {
    if (reduced) return
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [reduced])

  const close = () => {
    if (reduced) { onClose(); return }
    setClosing(true)
    setTimeout(onClose, 120)
  }

  // Esc — 이 모달은 공용 오버레이를 쓰지 않으므로 여기서 받는다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 못 그리면 새 탭 — 뜨면 시계를 끈다.
  useEffect(() => {
    timer.current = setTimeout(() => {
      window.open(doc.url, '_blank')
      onClose()
    }, LOAD_TIMEOUT)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [doc.url, onClose])

  const onLoaded = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } }
  const onFailed = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    window.open(doc.url, '_blank')
    onClose()
  }

  const open = shown && !closing
  const motion = reduced ? 'none' : undefined

  return (
    <div
      onMouseDown={e => { if (e.target === e.currentTarget) close() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: Z.modal,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        opacity: open ? 1 : 0,
        transition: motion ?? `opacity ${closing ? 120 : 150}ms ease-out`,
      }}
    >
      <div
        style={{
          width: 'min(1000px, 90vw)', height: '90vh', background: '#fff', borderRadius: 8,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.22)',
          opacity: open ? 1 : 0,
          transform: open ? 'translateY(0) scale(1)' : 'translateY(8px) scale(0.98)',
          transition: motion ?? `opacity ${closing ? 120 : 180}ms ease-out, transform ${closing ? 120 : 180}ms ease-out`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: `1px solid ${BORDER}` }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {doc.name}
          </span>
          <span style={{ flex: 1 }} />
          <a href={doc.url} target="_blank" rel="noopener noreferrer"
            style={{ padding: '4px 9px', border: `1px solid ${BORDER}`, borderRadius: 6, fontSize: 11, fontWeight: 700, color: '#234ea2', textDecoration: 'none' }}>
            새 탭
          </a>
          <a href={doc.url} download={doc.name}
            style={{ padding: '4px 9px', border: `1px solid ${BORDER}`, borderRadius: 6, fontSize: 11, fontWeight: 700, color: '#234ea2', textDecoration: 'none' }}>
            다운로드
          </a>
          <button onClick={close} title="닫기" aria-label="닫기"
            style={{ width: 24, height: 24, padding: 0, background: 'none', border: 'none', cursor: 'pointer', color: MUTED, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <iframe
          src={doc.url}
          title={doc.name}
          onLoad={onLoaded}
          onError={onFailed}
          style={{ flex: 1, width: '100%', border: 'none', background: '#f3f4f6' }}
        />
      </div>
    </div>
  )
}
