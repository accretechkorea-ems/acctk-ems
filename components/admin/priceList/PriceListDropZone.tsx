'use client'

// 엑셀 드롭존 — 80/20 을 고르면 그 아래로 **펼쳐지는** 영역.
//
// ── 높이 애니메이션 ─────────────────────────────────────────────────────────
//   CSS 는 height: auto 로 애니메이션하지 못한다. 그래서 max-height 를 넉넉히 잡아
//   0 → MAX 로 움직인다(내용이 그보다 작으므로 눈에는 자연 높이로 열린다).
//   prefers-reduced-motion 이면 transition 을 끊는다 — 그 판정은 **CSS 가 한다**
//   (자바스크립트로 보면 화면이 한 번 더 그려지고, 그 판정을 상태로 들면 효과 안에서
//    상태를 바꾸게 된다).

import { useRef, useState } from 'react'
import { BLUE, FAINT, MUTED, NEUTRAL_BG, SUB, TEXT } from '@/components/common/ui'
import { HEADER_NAMES, REQUIRED_HEADERS } from '@/lib/priceListParse'

export type PriceListDropZoneProps = {
  /** 열려 있는가(80/20 중 하나를 골랐는가). */
  open: boolean
  disabled: boolean
  /** 고른 파일 이름·크기(없으면 빈 값). */
  fileName: string
  fileSize: number
  busy: boolean
  onFile: (file: File) => void
  onClear: () => void
}

/** 열렸을 때의 최대 높이 — 내용(안내 두 줄 + 파일 줄)보다 넉넉하게. */
const OPEN_MAX = 260

// 드롭존 색 — 둘 다 이미 쓰는 값이다(app/inventory/page.tsx 의 엑셀 드롭 영역과 같은 톤).
//   기본   #eff4ff — 연한 파랑. 영역이 여기부터라는 것만 알려 준다.
//   끌어 올림 #dce9ff — 한 단계 진하게. 파일이 들어오면 다시 기본 톤이다.
// 테두리는 두 상태 모두 점선으로 둔다 — 「여기에 놓으라」는 표시다.
const BG = '#eff4ff'
const BG_OVER = '#dce9ff'

const kb = (n: number) => `${Math.max(1, Math.round(n / 1024)).toLocaleString('ko-KR')}KB`

export default function PriceListDropZone(props: PriceListDropZoneProps) {
  const { open, disabled, fileName, fileSize, busy, onFile, onClear } = props
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [over, setOver] = useState(false)
  const [reject, setReject] = useState('')

  /** .xlsx 만 받는다. 아니면 이유를 그 자리에 보여 준다. */
  const take = (file: File | undefined | null) => {
    setOver(false)
    if (!file) return
    if (!/\.xlsx$/i.test(file.name)) {
      setReject(`.xlsx 파일만 올릴 수 있습니다 — 고른 파일: ${file.name}`)
      return
    }
    setReject('')
    onFile(file)
  }

  return (
    <>
      <style>{`
        .pl-dz-wrap { transition: max-height 200ms ease, opacity 200ms ease; }
        @media (prefers-reduced-motion: reduce) { .pl-dz-wrap { transition: none; } }
      `}</style>

      <div
        className="pl-dz-wrap"
        style={{ maxHeight: open ? OPEN_MAX : 0, opacity: open ? 1 : 0, overflow: 'hidden' }}
        aria-hidden={!open}
      >
        <div
          onDragOver={e => { e.preventDefault(); if (!disabled) setOver(true) }}
          onDragLeave={() => setOver(false)}
          onDrop={e => { e.preventDefault(); if (!disabled) take(e.dataTransfer.files?.[0]) }}
          onClick={() => { if (!disabled) inputRef.current?.click() }}
          style={{
            marginTop: 10,
            border: `1px dashed ${over ? BLUE : '#c7d7f8'}`,
            borderRadius: 8,
            background: over ? BG_OVER : BG,
            padding: '14px 16px',
            cursor: disabled ? 'not-allowed' : 'pointer',
            transition: 'background 0.15s ease, border-color 0.15s ease',
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx"
            disabled={disabled}
            onChange={e => take(e.target.files?.[0])}
            style={{ display: 'none' }}
          />

          {!fileName && (
            <div style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>
              엑셀 파일을 여기에 끌어다 놓거나 눌러서 고르세요
              <span style={{ fontSize: 11, fontWeight: 500, color: MUTED }}>{'  (.xlsx)'}</span>
            </div>
          )}

          {fileName && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, wordBreak: 'break-all' }}>{fileName}</div>
                <div style={{ fontSize: 11, fontWeight: 500, color: MUTED, marginTop: 2 }}>
                  {fileSize > 0 ? kb(fileSize) : ''}
                  {busy ? ' · 읽는 중…' : ''}
                </div>
              </div>
              <span style={{ flex: 1 }} />
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onClear(); setReject('') }}
                disabled={busy}
                style={{
                  fontSize: 11, fontWeight: 700, color: busy ? FAINT : SUB, background: NEUTRAL_BG,
                  border: 'none', borderRadius: 6, padding: '5px 10px', cursor: busy ? 'not-allowed' : 'pointer',
                }}
              >
                다른 파일
              </button>
            </div>
          )}

          {/* 머리글 안내 — 드롭존 안쪽 작은 글자. 올리기 전에 할 일이 이것뿐이다. */}
          <div style={{ fontSize: 11, fontWeight: 500, color: MUTED, lineHeight: 1.7, marginTop: fileName ? 10 : 6 }}>
            머리글을 <b style={{ color: SUB }}>{HEADER_NAMES.join(' / ')}</b> 로 맞춰 주세요
            {` — ${REQUIRED_HEADERS.join('·')} 는 필수, 나머지는 선택. `}
            <b style={{ color: SUB }}>■ 섹션 줄은 지우지 마세요.</b>
            <br />파일을 통째로 올리면 모든 시트를 한 번에 등록합니다. 가격표가 아닌 시트는 저절로 건너뜁니다.
          </div>

          {reject && (
            <div style={{ fontSize: 11, fontWeight: 600, color: '#dc2626', marginTop: 6 }}>{reject}</div>
          )}
        </div>
      </div>
    </>
  )
}
