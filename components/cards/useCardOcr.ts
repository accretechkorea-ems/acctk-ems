'use client'

/**
 * 명함 사진을 읽는다 — 줄여서 **우리 서버**로 보내고, 칸을 받아 온다 (2026-11-23).
 *
 * ── 흐름 ─────────────────────────────────────────────────────────────────
 *   찍기/고르기 → 캔버스로 축소(긴 변 1,200px · jpg 80) → /api/cards/ocr → 칸 채움
 *
 * ── 왜 서버인가 ──────────────────────────────────────────────────────────
 *   2026-11-23 까지는 브라우저에서 돌리는 공개 OCR 패키지가 읽었다. 실제 사진에서 쓸 수 없어
 *   Claude 비전으로 바꿨고, 열쇠는 서버에만 둔다 — 브라우저에 열쇠를 내려보내지 않는다.
 *
 * ── 사진은 남지 않는다 ───────────────────────────────────────────────────
 *   줄인 사진을 한 번 보내고 버린다. 라우트도 메모리에서만 쓴다(app/api/cards/ocr).
 *   저장하는 곳도, 로그에 적는 곳도 없다.
 *
 * ── 실패하면 ─────────────────────────────────────────────────────────────
 *   읽지 못해도 창은 닫히지 않는다. 안내 한 줄을 띄우고 **직접 입력**으로 그대로 간다.
 */

import { useCallback, useRef, useState } from 'react'
import { OCR_READING, type OcrFields } from '@/lib/businessCardOcr'
import { CARD_FIELDS, type CardField } from '@/lib/businessCard'

/** 보내기 전에 줄이는 크기 — 긴 변 기준. */
const MAX_EDGE = 1200
/** jpg 품질. */
const QUALITY = 0.8

export type OcrPhase = 'idle' | 'reading' | 'done' | 'error'

export type OcrState = {
  phase: OcrPhase
  /** 사람에게 보여 줄 한 줄. */
  message: string
  /** 칸에 담은 결과. */
  fields: OcrFields
  /** 몇 초 걸렸나(보고용). */
  seconds: number
}

const EMPTY: OcrState = { phase: 'idle', message: '', fields: {}, seconds: 0 }

const SAY: Record<string, string> = {
  no_key: 'OCR 설정이 안 되어 있습니다. 관리자에게 문의해 주세요 — 직접 입력할 수 있습니다',
  too_big: '사진이 너무 큽니다 — 다시 찍어 주세요',
  bad_type: '읽을 수 없는 형식입니다 — 사진(jpg·png)이나 PDF 로 올려 주세요',
  parse: '사진에서 글자를 읽지 못했습니다 — 직접 입력해 주세요',
}
const SAY_DEFAULT = '사진에서 글자를 읽지 못했습니다 — 직접 입력해 주세요'

/**
 * 사진을 긴 변 1,200px·jpg 로 줄인다. 큰 사진을 그대로 올리면 느리고 비싸다.
 * 줄이지 못하면(캔버스를 못 쓰는 환경) 원본을 그대로 보낸다 — 라우트가 10MB 에서 막는다.
 *
 * **PDF 는 줄이지 않는다**(2026-11-24) — 캔버스가 PDF 를 열지 못해 아래 catch 로
 * 떨어지지만, 뜻이 드러나게 먼저 돌려보낸다. 모델이 document 블록으로 그대로 읽는다.
 */
async function shrink(file: File): Promise<Blob> {
  if (file.type === 'application/pdf') return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', QUALITY))
    return blob ?? file
  } catch {
    return file
  }
}

/** 라우트가 돌려준 칸 중 **표에 있는 것만** 남긴다(name_en 같은 칸은 아직 표에 없다). */
function pickKnown(got: Record<string, unknown>): OcrFields {
  const out: OcrFields = {}
  for (const f of CARD_FIELDS) {
    const v = String(got[f] ?? '').trim()
    if (v) out[f as CardField] = v
  }
  return out
}

export function useCardOcr() {
  const [state, setState] = useState<OcrState>(EMPTY)
  /** 창이 닫힌 뒤에 응답이 와도 상태를 건드리지 않게. */
  const seq = useRef(0)

  const reset = useCallback(() => { seq.current += 1; setState(EMPTY) }, [])

  const read = useCallback(async (file: File): Promise<OcrFields | null> => {
    const mine = ++seq.current
    const started = Date.now()
    setState({ ...EMPTY, phase: 'reading', message: OCR_READING })
    try {
      const small = await shrink(file)
      const body = new FormData()
      // 이름은 꼬리표일 뿐이다 — 라우트는 형식(type)을 본다. 그래도 맞춰 둔다.
      body.append('image', small, small.type === 'application/pdf' ? 'card.pdf' : 'card.jpg')
      const res = await fetch('/api/cards/ocr', { method: 'POST', body })
      const got = await res.json().catch(() => null) as
        { ok?: boolean; reason?: string; fields?: Record<string, unknown> } | null
      if (mine !== seq.current) return null

      if (!got?.ok || !got.fields) {
        setState({ ...EMPTY, phase: 'error', message: SAY[String(got?.reason ?? '')] ?? SAY_DEFAULT })
        return null
      }
      const fields = pickKnown(got.fields)
      const seconds = Math.round((Date.now() - started) / 100) / 10
      setState({ phase: 'done', message: `${seconds}초 걸렸습니다`, fields, seconds })
      return fields
    } catch (e) {
      console.error('[card] 사진을 읽지 못했다', e)
      if (mine === seq.current) setState({ ...EMPTY, phase: 'error', message: SAY_DEFAULT })
      return null
    }
  }, [])

  return { ...state, read, reset }
}
