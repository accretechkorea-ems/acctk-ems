'use client'

/**
 * 명함 **여러 장 등록** (2026-11-24).
 *
 * ── 어떤 일이 벌어지나 ───────────────────────────────────────────────────
 *   ① 파일을 고른다 — 사진 여러 장, 또는 스캐너가 만든 PDF(페이지당 명함 하나).
 *   ② PDF 는 **브라우저에서** 페이지별 1장짜리 PDF 로 쪼갠다(pdf-lib).
 *      사진은 긴 변 1,200px·jpg 80 으로 줄인다.
 *   ③ 세 개씩 /api/cards/ocr-bulk 로 보낸다. 라우트가 읽고 **바로 담는다**.
 *   ④ 진행률과 집계를 보여 주고, 끝나면 등록·중복·실패를 펼쳐 볼 수 있게 적는다.
 *
 * ── 왜 세 개씩 나눠 보내나 ───────────────────────────────────────────────
 *   Vercel 함수의 제한 시간 때문이다(lib/businessCardBulk.ts MAX_PER_REQUEST).
 *   나눠 보내면 중간에 멈춰도 **앞의 묶음은 이미 담긴 뒤**다 — 그래서 중단해도
 *   잃는 것이 없고, 닫기를 누르면 그 사실을 먼저 알려 준다.
 *
 * ── 담긴 줄은 「확인 전」이다 ────────────────────────────────────────────
 *   아무도 눈으로 보지 않았으므로 verified_at 을 비워 둔다. 목록에서 「확인 전」으로
 *   걸러 보고, 한 장씩 눌러 확인한다.
 *
 * ── 사진·PDF 는 남지 않는다 ─────────────────────────────────────────────
 *   보내고 버린다. 올리는 저장소도, 기록도 없다.
 */

import { useCallback, useRef, useState } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import { useConfirm } from '@/components/common/ConfirmDialog'
import ModalCard, { keepPads } from '@/components/common/ModalCard'
import { BLUE, BLUE_BORDER, BLUE_TINT, BORDER, CARD_BG, MUTED, SUB, TEXT } from '@/components/common/ui'
import { LABEL_WEIGHT, TEXT_LABEL } from '@/lib/textTokens'
import { R } from '@/lib/radius'
import {
  BULK_REASON_LABEL, BULK_SQL_FILE, EMPTY_TALLY, MAX_PER_REQUEST, addLines, chunk,
  progressLabel, progressPercent, stopQuestion, summaryLabel,
  type BulkLine, type BulkReason, type BulkTally,
} from '@/lib/businessCardBulk'

/** 한 장 — 보낼 파일과 「몇 번째 장인가」. */
type Piece = { file: File; label: string }

/** 끝난 뒤 보여 줄 한 줄. */
type Done = { label: string; ok: boolean; reason?: BulkReason; name?: string | null }

const PADS = keepPads({ x: 16, top: 14, bottom: 10 }, 10, 12)
const BTN_H = 40
const MAX_EDGE = 1200
const QUALITY = 0.8
/** 한 번에 받는 파일 수 — 수백 장을 한 번에 고르는 자리라 넉넉히 둔다. */
const MAX_FILES = 400

const label: React.CSSProperties = { fontSize: 12, fontWeight: LABEL_WEIGHT, color: TEXT_LABEL }

/** 사진을 긴 변 1,200px·jpg 로 줄인다. 줄이지 못하면 원본을 보낸다. */
async function shrink(file: File): Promise<File> {
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
    return blob ? new File([blob], 'card.jpg', { type: 'image/jpeg' }) : file
  } catch {
    return file
  }
}

/**
 * PDF 를 페이지마다 한 장짜리 PDF 로 쪼갠다. **브라우저에서만** 돈다 —
 * pdf-lib 는 누를 때 불러온다(명함 화면을 열기만 한 사람에게 내리지 않는다).
 */
async function splitPdf(file: File): Promise<Piece[]> {
  const { PDFDocument } = await import('pdf-lib')
  const src = await PDFDocument.load(await file.arrayBuffer())
  const count = src.getPageCount()
  const out: Piece[] = []
  for (let i = 0; i < count; i++) {
    const one = await PDFDocument.create()
    const [page] = await one.copyPages(src, [i])
    one.addPage(page)
    const bytes = await one.save()
    // ArrayBuffer 로 한 번 복사해 넘긴다 — Uint8Array 를 그대로 주면 타입이 어긋난다.
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    out.push({
      file: new File([buf], `page-${i + 1}.pdf`, { type: 'application/pdf' }),
      label: count > 1 ? `${file.name} ${i + 1}쪽` : file.name,
    })
  }
  return out
}

export default function BulkImportModal({ division, onClose, onDone, onShowUnchecked }: {
  /** 담을 사업부 — 목록 화면이 보고 있는 값. */
  division: string
  onClose: () => void
  /** 한 장이라도 담겼으면 목록을 다시 읽게 알린다. */
  onDone: (tally: BulkTally) => void
  /** 「확인 전 보기」 — 목록에 그 조건을 건다. */
  onShowUnchecked: () => void
}) {
  const confirmDialog = useConfirm()
  const [files, setFiles] = useState<File[]>([])
  const [phase, setPhase] = useState<'pick' | 'running' | 'finished'>('pick')
  const [total, setTotal] = useState(0)
  const [tally, setTally] = useState<BulkTally>(EMPTY_TALLY)
  const [rows, setRows] = useState<Done[]>([])
  const [openList, setOpenList] = useState<'dup' | 'failed' | null>(null)
  const [note, setNote] = useState('')
  const pickRef = useRef<HTMLInputElement>(null)
  /** 중단 눌림 — 돌고 있는 반복이 다음 묶음 전에 본다. */
  const stop = useRef(false)

  const add = (list: FileList | null) => {
    if (!list) return
    const next = [...files, ...Array.from(list)].slice(0, MAX_FILES)
    setFiles(next)
  }

  const run = useCallback(async () => {
    setPhase('running')
    setNote('파일을 준비하는 중…')
    stop.current = false

    // ── 쪼개고 줄인다 ──
    const pieces: Piece[] = []
    for (const f of files) {
      if (f.type === 'application/pdf') {
        try {
          pieces.push(...await splitPdf(f))
        } catch {
          pieces.push({ file: f, label: `${f.name}(쪼개지 못함)` })
        }
      } else {
        pieces.push({ file: await shrink(f), label: f.name })
      }
    }
    setTotal(pieces.length)
    setNote('')

    let acc = EMPTY_TALLY
    const done: Done[] = []
    for (const group of chunk(pieces, MAX_PER_REQUEST)) {
      if (stop.current) break
      const body = new FormData()
      body.append('division', division)
      for (const p of group) body.append('files', p.file, p.file.name)

      /** 한 번 더 보낸다 — 네트워크가 한 번 흔들렸다고 묶음을 버리지 않는다. */
      let lines: BulkLine[] | null = null
      for (let attempt = 1; attempt <= 2 && !lines; attempt++) {
        try {
          const res = await fetch('/api/cards/ocr-bulk', { method: 'POST', body })
          const json = await res.json() as { ok?: boolean; lines?: BulkLine[]; reason?: string }
          if (json?.ok && Array.isArray(json.lines)) lines = json.lines
          else if (attempt === 2) {
            lines = group.map((_, i) => ({
              index: i, ok: false as const, reason: (json?.reason ?? 'api') as BulkReason,
            }))
          }
        } catch {
          if (attempt === 2) lines = group.map((_, i) => ({ index: i, ok: false as const, reason: 'api' as BulkReason }))
        }
      }

      const got = lines ?? []
      acc = addLines(acc, got)
      for (const l of got) {
        const p = group[l.index]
        done.push(l.ok
          ? { label: p?.label ?? '', ok: true }
          : { label: p?.label ?? '', ok: false, reason: l.reason, name: l.name })
      }
      setTally(acc)
      setRows([...done])
    }

    setPhase('finished')
    onDone(acc)
  }, [files, division, onDone])

  /**
   * 닫기. 돌고 있으면 먼저 묻는다 — **이미 담긴 것은 남는다**는 사실을 앞에 적는다.
   * 브라우저 confirm 은 쓰지 않는다(공용 ConfirmDialog).
   */
  const tryClose = () => {
    if (phase !== 'running') { onClose(); return }
    void (async () => {
      const yes = await confirmDialog({
        title: '여러 장 등록을 멈출까요?',
        message: stopQuestion(tally.saved),
        confirmText: '중단',
        cancelText: '계속',
      })
      if (!yes) return
      stop.current = true
      setNote('중단하는 중 — 보내 둔 묶음이 끝나면 멈춥니다')
    })()
  }

  const dupRows = rows.filter(r => !r.ok && r.reason === 'dup')
  const failRows = rows.filter(r => !r.ok && r.reason !== 'dup')
  const pct = progressPercent(tally.done, total)

  return (
    <ModalOverlay onClose={tryClose}>
      <ModalCard
        width={520}
        closeX={false}
        {...PADS}
        title={<div style={{ fontSize: 17, fontWeight: 800, color: TEXT }}>여러 장 등록</div>}
        footer={<>
          <button type="button" onClick={tryClose}
            style={{
              height: BTN_H, flex: 1, border: `1px solid ${BORDER}`, borderRadius: R.control,
              background: CARD_BG, color: SUB, fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
            }}>
            {phase === 'running' ? '중단' : '닫기'}
          </button>
          {phase === 'pick' && (
            <button type="button" onClick={() => void run()} disabled={files.length === 0}
              style={{
                height: BTN_H, flex: 2, border: 'none', borderRadius: R.control,
                background: files.length === 0 ? '#e5e7eb' : BLUE,
                color: files.length === 0 ? MUTED : '#fff',
                fontWeight: 700, fontSize: 14, fontFamily: 'inherit',
                cursor: files.length === 0 ? 'not-allowed' : 'pointer',
              }}>
              시작
            </button>
          )}
        </>}
      >
        {phase === 'pick' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); add(e.dataTransfer?.files ?? null) }}
              onClick={() => pickRef.current?.click()}
              style={{
                border: `1px dashed ${BLUE_BORDER}`, borderRadius: R.card, background: BLUE_TINT,
                padding: '26px 16px', textAlign: 'center', cursor: 'pointer',
              }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: TEXT }}>파일을 끌어다 놓거나 눌러서 고르세요</div>
              <div style={{ fontSize: 12, color: SUB, marginTop: 6, lineHeight: 1.7 }}>
                사진 여러 장 또는 PDF — 스캐너가 만든 PDF 는 한 쪽에 명함 한 장이면 됩니다<br />
                쪽마다 한 장씩 읽어 담습니다 · 사진·PDF 는 저장하지 않습니다
              </div>
            </div>
            <input ref={pickRef} type="file" accept="image/*,application/pdf" multiple hidden
              onChange={e => add(e.target.files)} />
            {files.length > 0 && (
              <>
                <div style={label}>고른 파일 {files.length}개</div>
                <div style={{
                  maxHeight: 180, overflowY: 'auto', border: `1px solid ${BORDER}`,
                  borderRadius: R.control, padding: '6px 10px',
                }}>
                  {files.map((f, i) => (
                    <div key={`${f.name}-${i}`} style={{ fontSize: 12, color: SUB, padding: '3px 0' }}>
                      {f.name}
                    </div>
                  ))}
                </div>
                <button type="button" onClick={() => setFiles([])}
                  style={{
                    height: 30, alignSelf: 'flex-start', padding: '0 10px', border: `1px solid ${BORDER}`,
                    borderRadius: R.control, background: CARD_BG, color: SUB, fontSize: 12,
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                  비우기
                </button>
              </>
            )}
            <div style={{ fontSize: 12, color: SUB, lineHeight: 1.7 }}>
              담긴 명함은 「확인 전」으로 들어갑니다 — 목록에서 걸러 보고 한 장씩 확인해 주세요.
            </div>
          </div>
        )}

        {phase !== 'pick' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <b style={{ fontSize: 20, color: TEXT }}>{progressLabel(tally.done, total)}</b>
              <span style={{ fontSize: 12, color: SUB }}>
                {phase === 'finished' ? '끝났습니다' : note || '읽는 중…'}
              </span>
            </div>
            <div style={{ height: 8, background: '#f3f4f6', borderRadius: R.pill, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: BLUE, transition: 'width 0.15s ease' }} />
            </div>
            <div style={{ fontSize: 13, color: TEXT_LABEL, fontWeight: LABEL_WEIGHT }}>{summaryLabel(tally)}</div>

            {/* 표가 아직 일괄을 받지 않는다 — 한 장도 담기지 않으므로 맨 위에 크게 말한다. */}
            {rows.some(r => r.reason === 'schema') && (
              <div style={{
                border: `1px solid ${BLUE_BORDER}`, background: BLUE_TINT, borderRadius: R.control,
                padding: '9px 11px', fontSize: 12, color: BLUE, lineHeight: 1.7,
              }}>
                표 손질이 먼저 필요합니다 — <code>{BULK_SQL_FILE}</code> 을 적용해 주세요.
                <br />그때까지는 여러 장 등록이 한 장도 담기지 않습니다(한 장씩 등록은 그대로 됩니다).
              </div>
            )}

            {phase === 'finished' && (dupRows.length > 0 || failRows.length > 0) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {dupRows.length > 0 && (
                  <button type="button" onClick={() => setOpenList(openList === 'dup' ? null : 'dup')}
                    style={{
                      height: 32, border: `1px solid ${BORDER}`, borderRadius: R.control, background: CARD_BG,
                      color: TEXT_LABEL, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                      textAlign: 'left', padding: '0 10px',
                    }}>
                    중복 {dupRows.length}건 {openList === 'dup' ? '접기' : '펼치기'}
                  </button>
                )}
                {openList === 'dup' && (
                  <div style={{ maxHeight: 160, overflowY: 'auto', border: `1px solid ${BORDER}`, borderRadius: R.control, padding: '6px 10px' }}>
                    {dupRows.map((r, i) => (
                      <div key={i} style={{ fontSize: 12, color: SUB, padding: '3px 0' }}>
                        {r.label} — 이미 있는 명함{r.name ? ` · ${r.name}` : ''}
                      </div>
                    ))}
                  </div>
                )}
                {failRows.length > 0 && (
                  <button type="button" onClick={() => setOpenList(openList === 'failed' ? null : 'failed')}
                    style={{
                      height: 32, border: `1px solid ${BORDER}`, borderRadius: R.control, background: CARD_BG,
                      color: TEXT_LABEL, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                      textAlign: 'left', padding: '0 10px',
                    }}>
                    실패 {failRows.length}건 {openList === 'failed' ? '접기' : '펼치기'}
                  </button>
                )}
                {openList === 'failed' && (
                  <div style={{ maxHeight: 160, overflowY: 'auto', border: `1px solid ${BORDER}`, borderRadius: R.control, padding: '6px 10px' }}>
                    {failRows.map((r, i) => (
                      <div key={i} style={{ fontSize: 12, color: SUB, padding: '3px 0' }}>
                        {r.label} — {BULK_REASON_LABEL[r.reason ?? 'api']}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {phase === 'finished' && tally.saved > 0 && (
              <button type="button" onClick={() => { onShowUnchecked(); onClose() }}
                style={{
                  height: BTN_H, border: `1px solid ${BLUE_BORDER}`, borderRadius: R.control,
                  background: BLUE_TINT, color: BLUE, fontWeight: 700, fontSize: 13,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>
                확인 전 보기
              </button>
            )}
          </div>
        )}
      </ModalCard>
    </ModalOverlay>
  )
}
