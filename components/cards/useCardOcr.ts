'use client'

/**
 * 명함 사진에서 글자를 읽는다 — **브라우저에서만** (2026-11-23).
 *
 * ── 사진은 아무 데도 가지 않는다 ─────────────────────────────────────────
 * 파일을 서버로 보내지 않는다. tesseract.js 가 브라우저 안에서 읽고, 끝나면 그 객체를
 * 버린다. 남는 것은 사람이 확인한 **글자뿐**이다. 올리는 라우트도 저장하는 곳도 없다.
 *
 * ── 바깥 CDN 도 쓰지 않는다 ─────────────────────────────────────────────
 * tesseract.js 는 기본값으로 워커·코어·언어 데이터를 바깥에서 받아 온다. 개인정보를
 * 다루는 자리라 전부 **우리 서버**에서 내준다(public/ocr/, scripts/copy-ocr-assets.js).
 *
 * ── 일꾼은 한 번만 만든다 ───────────────────────────────────────────────
 * 언어 데이터를 읽는 데 몇 초가 걸린다. 화면이 떠 있는 동안 한 번 만들어 두고 다시 쓴다.
 * 창을 닫으면 치운다(terminate) — 탭에 일꾼이 쌓이지 않게.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { fieldsFromText, type OcrFields } from '@/lib/businessCardOcr'

/** 우리 서버가 내주는 자리. 바깥 주소가 아니다. */
const OCR_BASE = '/ocr'
const LANGS = 'kor+eng'

export type OcrPhase = 'idle' | 'loading' | 'reading' | 'done' | 'error'

export type OcrState = {
  phase: OcrPhase
  /** 0~100. 「읽는 중 … N%」 */
  percent: number
  /** 사람에게 보여 줄 한 줄. */
  message: string
  /** 읽은 글자(원문). 칸 배치가 빗나갔을 때 사람이 보고 고칠 수 있게 들고 있는다. */
  text: string
  /** 칸에 나눈 결과. */
  fields: OcrFields
  /** 몇 초 걸렸나(보고용). */
  seconds: number
}

const EMPTY: OcrState = { phase: 'idle', percent: 0, message: '', text: '', fields: {}, seconds: 0 }

/** tesseract 가 돌려주는 진행 단계 → 사람 말. */
function phraseOf(status: string): string {
  if (status.includes('loading language')) return '언어 데이터를 읽는 중'
  if (status.includes('initializing')) return '준비하는 중'
  if (status.includes('recognizing')) return '글자를 읽는 중'
  return '읽는 중'
}

export function useCardOcr() {
  const [state, setState] = useState<OcrState>(EMPTY)
  /** 만들어 둔 일꾼. 타입은 tesseract 의 Worker 지만 import 를 미루려고 unknown 으로 둔다. */
  const workerRef = useRef<{ recognize: (f: File) => Promise<{ data: { text: string } }>; terminate: () => Promise<unknown> } | null>(null)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      const w = workerRef.current
      workerRef.current = null
      if (w) void w.terminate().catch(() => {})
    }
  }, [])

  const reset = useCallback(() => setState(EMPTY), [])

  /**
   * 사진 한 장을 읽는다. 끝나면 칸에 나눈 결과를 돌려준다(실패하면 null).
   * 패키지는 **누를 때** 불러온다 — 명함 화면을 열기만 한 사람에게 1.6MB 를 내리지 않는다.
   */
  const read = useCallback(async (file: File): Promise<OcrFields | null> => {
    const started = Date.now()
    setState({ ...EMPTY, phase: 'loading', message: '준비하는 중' })
    try {
      if (!workerRef.current) {
        const { createWorker } = await import('tesseract.js')
        const worker = await createWorker(LANGS, 1, {
          workerPath: `${OCR_BASE}/worker.min.js`,
          corePath: OCR_BASE,
          langPath: OCR_BASE,
          // gzip 으로 두고 그대로 읽는다(파일이 셋 다 .gz 다).
          gzip: true,
          logger: (m: { status?: string; progress?: number }) => {
            if (!aliveRef.current) return
            const pct = Math.round((m.progress ?? 0) * 100)
            setState(s => ({
              ...s,
              phase: (m.status ?? '').includes('recognizing') ? 'reading' : 'loading',
              percent: pct,
              message: `${phraseOf(m.status ?? '')} … ${pct}%`,
            }))
          },
        })
        if (!aliveRef.current) { void worker.terminate().catch(() => {}); return null }
        workerRef.current = worker as unknown as typeof workerRef.current
      }

      setState(s => ({ ...s, phase: 'reading', message: '글자를 읽는 중 … 0%' }))
      const res = await workerRef.current!.recognize(file)
      if (!aliveRef.current) return null

      const text = res?.data?.text ?? ''
      const fields = fieldsFromText(text)
      const seconds = Math.round((Date.now() - started) / 100) / 10
      setState({ phase: 'done', percent: 100, message: `${seconds}초 걸렸습니다`, text, fields, seconds })
      return fields
    } catch (e) {
      console.error('[card] 사진을 읽지 못했다', e)
      if (aliveRef.current) {
        setState({ ...EMPTY, phase: 'error', message: '사진에서 글자를 읽지 못했습니다 — 직접 입력해 주세요' })
      }
      return null
    }
  }, [])

  return { ...state, read, reset }
}
