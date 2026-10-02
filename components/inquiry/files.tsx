'use client'

// 의뢰서 첨부 파일 고르기·올리기 — 의뢰서 목록(기존 번호 등록)과 상세(내용 기록)가 함께 쓴다.
//
// app/inquiries/[id]/page.tsx 안에 있던 것을 그대로 옮겼다. page 파일은 default export 말고는
// 내보낼 수 없어서, 두 화면이 같은 컴포넌트를 쓰려면 밖에 두어야 한다. 동작은 바꾸지 않았다
// (compact 만 더했다 — 좁은 자리에 넣을 때 높이를 낮춘다).

import { useRef, useState } from 'react'
import { BORDER, CARD_BG, TEXT, MUTED, NEUTRAL_BG, BLUE, FAINT } from '@/components/common/ui'
import { errorInfo } from '@/lib/errorInfo'

/** 내용 기록 하나에 올릴 수 있는 파일 수. 서버(/api/inquiry-attachment)와 같은 값이어야 한다. */
const MAX_FILES = 10
/** 파일 하나의 상한. 서버와 같은 20MB. */
const MAX_BYTES = 20 * 1024 * 1024
/** 바이트를 사람이 읽는 크기로. */
export const sizeText = (n: number | null): string => {
  if (!n || n <= 0) return ''
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`
  return `${(n / (1024 * 1024)).toFixed(1)}MB`
}

/** File → data URL. 서버가 base64 본문을 받는다(service-attachment 와 같은 방식). */
const toDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('파일을 읽지 못했습니다.'))
    r.readAsDataURL(file)
  })

/** 올리지 못한 파일 하나 — 이름과 사유를 함께 들고 다닌다. */
export type UploadFail = { name: string; reason: string }

/** 「파일명 — 사유」 여러 줄. 토스트에 그대로 넣는다. */
export const failText = (list: UploadFail[]): string =>
  list.map(f => `${f.name} — ${f.reason}`).join('\n')

/**
 * 고른 파일을 서버로 올린다. 실패한 파일을 사유와 함께 돌려준다(빈 배열이면 전부 성공).
 *
 * 한 번에 다 보내지 않고 하나씩 보내는 이유 — 하나가 막혀도 나머지는 올라가야 하고,
 * 어느 파일이 왜 막혔는지 사람에게 알려 줘야 하기 때문이다.
 *
 * 사유를 반드시 채운다. 예전에는 이름만 돌려줘서 화면에 「올리지 못한 파일: …」만 뜨고
 * 서버가 보낸 이유(형식이 확장자와 다름·용량 초과 등)가 콘솔에만 남았다 —
 * 쓰는 사람은 무엇을 고쳐야 할지 알 수 없었다.
 * 서버가 사유를 주지 못하는 경우(본문이 너무 커서 플랫폼이 먼저 끊는 413 등)에는
 * 응답이 JSON 이 아니므로, 최소한 상태 코드라도 보여 준다.
 */
export async function uploadFiles(messageId: number, files: File[]): Promise<UploadFail[]> {
  const failed: UploadFail[] = []
  for (const f of files) {
    try {
      const dataUrl = await toDataUrl(f)
      const res = await fetch('/api/inquiry-attachment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId, files: [{ name: f.name, dataUrl }] }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        const reason = typeof json?.error === 'string' && json.error
          ? json.error
          // 본문이 JSON 이 아니다 — 서버 코드에 닿기 전에 끊긴 경우다.
          // 413 은 요청 본문 상한에 걸린 것이라 따로 풀어서 알려 준다.
          : res.status === 413
            ? '파일이 너무 커서 서버에 닿지 못했습니다 (요청 본문 상한 초과)'
            : `서버 오류 (HTTP ${res.status})`
        console.error('[inquiries] 파일 업로드 실패', {
          file: f.name, status: res.status, jsonBody: json !== null, ...errorInfo(json?.error),
        })
        failed.push({ name: f.name, reason })
      }
    } catch (e) {
      // 예외는 Error 라서 { error: e } 로 찍으면 {} 가 된다 — 펴서 남긴다.
      console.error('[inquiries] 파일 업로드 실패', { file: f.name, ...errorInfo(e) })
      failed.push({ name: f.name, reason: e instanceof Error ? e.message : '네트워크 오류' })
    }
  }
  return failed
}

/**
 * 파일 고르기 — 세 자리가 함께 쓴다.
 *   · 「내용 추가」 모달(상세) — 내용 기록을 만든 뒤 그 아래에 올린다.
 *   · 내용 기록 카드의 제자리 편집(상세) — 이미 있는 기록에 더 올린다. compact 로 쓴다.
 *   · 「기존 번호 등록」 모달(목록) — 파일 한 칸.
 * (「파일 추가」 전용 모달은 없앴다 — 카드 편집이 그 일을 대신한다.)
 *
 * 고르는 길이 셋이다. 상자를 누르거나, 안쪽 「고르기」를 누르거나, 끌어다 놓거나.
 * 상자 전체가 눌리지 않으면 점선 안을 눌러도 아무 일이 없어 「파일 선택이 없다」고 느낀다 —
 * 실제로 그런 제보가 있었다. 그래서 상자를 button 으로 두고 키보드로도 닿게 했다.
 *
 * 고른 파일 목록은 부모가 들고 있다(files·onChange). 이 컴포넌트는 고르는 일만 한다 —
 * 부르는 자리마다 저장 흐름이 달라(내용 기록을 먼저 만드는가 아닌가) 목록의 주인은 부모여야 한다.
 *
 * 크기·개수는 여기서 먼저 거른다. 서버도 같은 값으로 다시 막지만, 20MB 파일을 base64 로
 * 부풀려 보낸 뒤 거절당하는 것보다 고를 때 막는 편이 낫다.
 */
export default function FilePicker({
  files, onChange, disabled, compact, label,
}: {
  files: File[]
  onChange: (next: File[]) => void
  disabled?: boolean
  /** 좁은 자리(등록 모달의 보낸/받은 두 칸)에 넣을 때. 높이만 낮추고 동작은 같다. */
  compact?: boolean
  /** 상자 안에 보일 이름. 없으면 일반 문구만 나온다. */
  label?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [warn, setWarn] = useState('')

  const add = (incoming: FileList | null) => {
    if (!incoming || incoming.length === 0) return
    const next = [...files]
    const tooBig: string[] = []
    for (const f of Array.from(incoming)) {
      if (f.size > MAX_BYTES) { tooBig.push(f.name); continue }
      if (next.length >= MAX_FILES) break
      next.push(f)
    }
    const tooMany = files.length + Array.from(incoming).length > MAX_FILES
    // 「올리기 전에 화면에서 막았다」와 「서버가 거절했다」가 구분되도록 말머리를 붙인다.
    // 이쪽은 아직 서버에 가지도 않은 상태다.
    setWarn(
      tooBig.length > 0 ? `올리기 전 제외됨 — 20MB 초과: ${tooBig.join(', ')}`
        : tooMany ? `올리기 전 제외됨 — 파일은 ${MAX_FILES}개까지 올릴 수 있습니다.`
        : '',
    )
    onChange(next)
  }

  return (
    <div>
      {/* 상자 전체가 버튼이다 — 아무 데나 눌러도 파일 창이 열린다. 끌어다 놓기도 같은 자리에서 받는다. */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); if (!disabled) setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); if (!disabled) add(e.dataTransfer.files) }}
        style={{
          display: 'block', width: '100%',
          border: `1px dashed ${over ? BLUE : BORDER}`, borderRadius: 8,
          padding: compact ? '10px 12px' : '14px 16px',
          background: over ? '#eff4ff' : CARD_BG, textAlign: 'center',
          fontSize: 12, color: MUTED, lineHeight: compact ? 1.5 : 1.7, fontFamily: 'inherit',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        {label && <span style={{ display: 'block', fontWeight: 700, color: TEXT, marginBottom: 2 }}>{label}</span>}
        {compact
          ? <span style={{ color: BLUE, fontWeight: 700 }}>끌어다 놓거나 눌러서 고르기</span>
          : <>파일을 끌어다 놓거나 <span style={{ color: BLUE, fontWeight: 700 }}>눌러서 고르기</span></>}
        {!compact && <><br /><span style={{ color: FAINT }}>최대 {MAX_FILES}개 · 하나당 20MB</span></>}
      </button>

      {/* 숨은 input 은 상자 밖에 둔다 — 안에 두면 클릭이 상자 버튼으로 되돌아와 창이 두 번 열린다. */}
      <input
        ref={inputRef} type="file" multiple hidden
        onChange={e => { add(e.target.files); e.target.value = '' }}
      />

      {warn && <div style={{ fontSize: 12, color: '#be123c', lineHeight: 1.6, marginTop: 6 }}>{warn}</div>}

      {files.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {files.map((f, i) => (
            <div key={`${f.name}-${i}`} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              fontSize: 12, color: TEXT, background: NEUTRAL_BG, borderRadius: 6, padding: '6px 8px',
            }}>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {f.name}
              </span>
              <span style={{ color: MUTED, flexShrink: 0 }}>{sizeText(f.size)}</span>
              <button
                type="button" disabled={disabled}
                onClick={() => onChange(files.filter((_, k) => k !== i))}
                style={{
                  border: 'none', background: 'transparent', cursor: 'pointer', color: MUTED,
                  fontSize: 12, padding: 0, flexShrink: 0, fontFamily: 'inherit',
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
