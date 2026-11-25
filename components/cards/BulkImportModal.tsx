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
 * ── 사진·PDF 는 남지 않는다 ─────────────────────────────────────────────
 *   보내고 버린다. 올리는 저장소도, 기록도 없다.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import ModalOverlay from '@/components/common/ModalOverlay'
import { useConfirm } from '@/components/common/ConfirmDialog'
import ModalCard, { keepPads } from '@/components/common/ModalCard'
import { BLUE, BLUE_BORDER, BLUE_TINT, BORDER, CARD_BG, DANGER, MUTED, SUB, TEXT } from '@/components/common/ui'
import { LABEL_WEIGHT, TEXT_LABEL } from '@/lib/textTokens'
import { R } from '@/lib/radius'
import { putSession } from '@/lib/cardImportSession'
import { REVIEW_CHUNK, writeFileName } from '@/lib/cardReview'
import {
  BULK_REASON_LABEL, BULK_SQL_FILE, EMPTY_TALLY, MAX_PER_REQUEST, addLines, costLabel,
  acceptRetry, newBatchId, undoQuestion, worthRetry,
  progressLabel, progressPercent, stopQuestion, summaryLabel,
  type BulkLine, type BulkReason, type BulkTally,
} from '@/lib/businessCardBulk'

/** 한 장 — 보낼 파일과 「몇 번째 장인가」. */
type Piece = { file: File; label: string }

/** 끝난 뒤 보여 줄 한 줄. */
type Done = {
  label: string; ok: boolean; reason?: BulkReason; name?: string | null
  /** 뒷면이면 **어느 명함에 합쳐졌나**. */
  mergedInto?: number
}

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

/**
 * 거꾸로 들어간 쪽을 **180° 돌려** 다시 만든다.
 * 스캐너에 뒤집혀 들어간 명함은 글자가 안 잡혀 「사람 이름 없음」·「빈 면」으로 떨어진다.
 * PDF 는 쪽을 돌리고(회전값만 더한다), 사진은 캔버스로 돌려 다시 그린다.
 * 돌리지 못하면 null — 그러면 원래 판정을 그대로 둔다.
 */
async function flip(file: File): Promise<File | null> {
  try {
    if (file.type === 'application/pdf') {
      const { PDFDocument, degrees } = await import('pdf-lib')
      const doc = await PDFDocument.load(await file.arrayBuffer())
      for (const pg of doc.getPages()) pg.setRotation(degrees((pg.getRotation().angle + 180) % 360))
      const bytes = await doc.save()
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      return new File([buf], file.name, { type: 'application/pdf' })
    }
    const bitmap = await createImageBitmap(file)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.translate(bitmap.width / 2, bitmap.height / 2)
    ctx.rotate(Math.PI)
    ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2)
    bitmap.close()
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', QUALITY))
    return blob ? new File([blob], file.name, { type: 'image/jpeg' }) : null
  } catch {
    return null
  }
}

export default function BulkImportModal({ division, resume, onClose, onDone }: {
  /** 담을 사업부 — 목록 화면이 보고 있는 값. */
  division: string
  /**
   * **이어 읽기**(2026-11-25) — 검토 화면의 「다음 20쪽 읽기 →」가 넘겨 준다.
   * 쪼개 둔 쪽을 그대로 받으므로 파일을 다시 올리지 않는다. 묶음 id 도 **그대로** 써서
   * 앞서 담은 줄과 한 묶음으로 남는다(되돌리기 한 번에 전부 지워진다).
   */
  resume?: { batchId: string; pieces: Piece[]; pageFrom: number; total: number; fileName: string; usage: { input: number; output: number } } | null
  onClose: () => void
  /** 한 장이라도 담겼으면 목록을 다시 읽게 알린다. */
  onDone: (tally: BulkTally) => void
}) {
  const confirmDialog = useConfirm()
  const router = useRouter()
  const [files, setFiles] = useState<File[]>([])
  const [phase, setPhase] = useState<'pick' | 'running' | 'finished'>('pick')
  const [total, setTotal] = useState(0)
  const [tally, setTally] = useState<BulkTally>(EMPTY_TALLY)
  const [rows, setRows] = useState<Done[]>([])
  const [openList, setOpenList] = useState<'dup' | 'failed' | 'merged' | 'noPerson' | null>(null)
  const [note, setNote] = useState('')
  /** 지금까지 쓴 토큰 — 끝에 「읽기 비용 약 N원」으로 적는다. */
  const [usage, setUsage] = useState({ input: 0, output: 0 })
  const pickRef = useRef<HTMLInputElement>(null)
  /** 중단 눌림 — 돌고 있는 반복이 다음 묶음 전에 본다. */
  const stop = useRef(false)
  /** 이번 가져오기 묶음 — 창을 여는 순간 하나 만들어 둔다(되돌리기가 이것으로 지운다). */
  const batchId = useRef(resume?.batchId ?? newBatchId())
  /** 되돌리기를 한 번 눌렀나 — 두 번 지우지 않는다. */
  const [undone, setUndone] = useState<number | null>(null)
  const [undoing, setUndoing] = useState(false)

  const add = (list: FileList | null) => {
    if (!list) return
    const next = [...files, ...Array.from(list)].slice(0, MAX_FILES)
    setFiles(next)
  }

  /**
   * `ready` 를 주면 **그 쪽들을 그대로** 읽는다(이어 읽기) — 파일을 다시 쪼개지 않는다.
   * `pageFrom` 은 그 쪽들이 **전체에서 몇 쪽부터**인가다(21쪽이면 20).
   */
  const run = useCallback(async (ready?: Piece[], pageFrom = 0, totalPages?: number) => {
    setPhase('running')
    setNote(ready ? '' : '파일을 준비하는 중…')
    stop.current = false

    // ── 쪼개고 줄인다(이어 읽기는 이미 쪼개져 있다) ──
    let pieces: Piece[] = ready ?? []
    if (!ready) {
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
    }
    pieces = [...pieces]
    // **20쪽씩** 읽고 멈춘다 — 그 뒤는 검토 화면이 이어받는다(사람이 지치지 않는 단위).
    const batch = pieces.slice(0, REVIEW_CHUNK)
    const rest = pieces.slice(REVIEW_CHUNK)
    setTotal(batch.length)
    setNote('')

    let acc = EMPTY_TALLY
    const done: Done[] = []
    const used = { input: 0, output: 0 }
    /**
     * 직전 명함과 **그 쪽 번호**. 뒷면은 바로 다음 쪽일 때만 붙으므로 둘을 같이 넘긴다.
     * 요청은 **앞 응답이 온 뒤에** 보낸다 — 나란히 보내면 순서가 뒤섞인다.
     */
    let prevCardId: number | null = null
    let prevPage: number | null = null

    /** 한 묶음을 보낸다. 한 번 더 보내 본다 — 네트워크가 흔들렸다고 묶음을 버리지 않는다. */
    const send = async (
      group: Piece[],
      at: { pageBase: number; prevId: number | null; prevPage: number | null; retry?: boolean },
    ): Promise<BulkLine[]> => {
      for (let attempt = 1; attempt <= 2; attempt++) {
        const body = new FormData()
        body.append('division', division)
        body.append('import_batch_id', batchId.current)
        if (at.retry) body.append('retry', '1')
        body.append('page_base', String(at.pageBase))
        if (at.prevId != null && at.prevPage != null) {
          body.append('prev_card_id', String(at.prevId))
          body.append('prev_page', String(at.prevPage))
        }
        for (const p of group) body.append('files', p.file, p.file.name)
        try {
          const res = await fetch('/api/cards/ocr-bulk', { method: 'POST', body })
          const json = await res.json() as {
            ok?: boolean; lines?: BulkLine[]; reason?: string
            usage?: { input: number; output: number }
          }
          if (json?.ok && Array.isArray(json.lines)) {
            used.input += json.usage?.input ?? 0
            used.output += json.usage?.output ?? 0
            return json.lines
          }
          if (attempt === 2) {
            return group.map((_, i) => ({
              index: i, ok: false as const, reason: (json?.reason ?? 'api') as BulkReason,
            }))
          }
        } catch {
          if (attempt === 2) {
            return group.map((_, i) => ({ index: i, ok: false as const, reason: 'api' as BulkReason }))
          }
        }
      }
      return []
    }

    /**
     * 쪽마다 어떤 명함이 되었나(절대 쪽 번호 → card_id).
     * 뒷면은 **바로 앞 쪽**에만 붙으므로, 돌려 읽는 쪽도 제 앞 쪽을 찾아 보내야 한다.
     */
    const cardByPage = new Map<number, number>()
    /** 쪽 → 그 쪽의 판정. 검토 화면이 뱃지를 그릴 때 쓴다. */
    const lineByPage = new Map<number, BulkLine>()
    /** card_id → 그 명함이 **처음 담긴 쪽**. 합쳐진 면이 어느 쪽에 붙었는지 되짚는다. */
    const pageOfCard = new Map<number, number>()
    const noteResult = (page: number, line: BulkLine) => {
      lineByPage.set(page, line)
      const id = line.card_id
      if (id == null) return
      cardByPage.set(page, id)
      if (line.ok && !pageOfCard.has(id)) pageOfCard.set(id, page)
    }
    /** 그 쪽의 까닭 — 담겼으면 null. */
    const reasonOf = (page: number): BulkReason | null => {
      const l = lineByPage.get(page)
      return !l || l.ok ? null : l.reason
    }
    /** 이 쪽이 합쳐 들어간 명함의 **쪽 번호**. */
    const mergedPageOf = (page: number): number | null => {
      const l = lineByPage.get(page)
      if (!l || l.ok || l.reason !== 'merged') return null
      const id = l.merged_into ?? l.card_id
      return id != null ? (pageOfCard.get(id) ?? null) : null
    }

    for (let base = 0; base < batch.length; base += MAX_PER_REQUEST) {
      if (stop.current) break
      const group = batch.slice(base, base + MAX_PER_REQUEST)
      let got = await send(group, { pageBase: pageFrom + base, prevId: prevCardId, prevPage })
      got.forEach(l => noteResult(pageFrom + base + l.index, l))

      /**
       * 거꾸로 들어간 쪽을 **한 번 더** — 모델이 「글자가 거꾸로 보인다」고 한 쪽만이다.
       * **그 쪽 차례에서** 바로 처리한다(다음 묶음으로 미루지 않는다) — 미루면 차례가
       * 밀려 엉뚱한 명함에 붙는다(2026-11-25 실측).
       */
      for (let k = 0; k < got.length && !stop.current; k++) {
        if (!worthRetry(got[k])) continue
        const page = pageFrom + base + got[k].index
        const p = group[got[k].index]
        if (!p) continue
        const flipped = await flip(p.file)
        if (!flipped) continue
        const again = await send([{ file: flipped, label: p.label }], {
          pageBase: page, prevId: cardByPage.get(page - 1) ?? null, prevPage: page - 1, retry: true,
        })
        const now = again[0]
        if (!now || !acceptRetry(now)) continue
        got = got.map((l, i) => (i === k ? { ...now, index: got[k].index } : l))
        noteResult(page, now)
        acc = { ...acc, flipped: acc.flipped + 1 }
      }

      // 다음 묶음의 「직전 명함」 — **마지막 쪽**의 결과로 잡는다.
      const lastPage = pageFrom + base + group.length - 1
      for (let page = lastPage; page >= pageFrom + base; page--) {
        const id = cardByPage.get(page)
        if (id != null) { prevCardId = id; prevPage = page; break }
      }

      acc = addLines(acc, got)
      for (const l of got) {
        const p = group[l.index]
        done.push(l.ok
          ? { label: p?.label ?? '', ok: true }
          : {
            label: p?.label ?? '', ok: false, reason: l.reason,
            name: l.name, mergedInto: l.merged_into,
          })
      }
      setTally(acc)
      setRows([...done])
      setUsage({ ...used })
    }

    // ── 읽기가 끝났다 — **검토 화면**으로 넘긴다 ──
    // 쪽 이미지는 서버에 보내지 않았다. 브라우저 메모리에만 담아 넘긴다.
    const name = resume?.fileName || files[0]?.name || ''
    putSession({
      batchId: batchId.current,
      fileName: name,
      total: totalPages ?? pieces.length,
      pages: batch.map((p, i) => ({
        page: pageFrom + i,
        blob: p.file,
        reason: reasonOf(pageFrom + i),
        cardId: lineByPage.get(pageFrom + i)?.card_id ?? null,
        mergedIntoPage: mergedPageOf(pageFrom + i),
      })),
      rest: rest.map((p, i) => ({ page: pageFrom + batch.length + i, file: p.file })),
      // 비용은 **이어서** 센다 — 앞 20쪽에 쓴 토큰을 잃지 않는다.
      usage: {
        input: (resume?.usage.input ?? 0) + used.input,
        output: (resume?.usage.output ?? 0) + used.output,
      },
    })
    if (name) writeFileName(batchId.current, name)
    setPhase('finished')
    onDone(acc)
    router.push('/cards/import')
  }, [files, division, onDone, router, resume])

  /**
   * 이어 읽기 — 창이 뜨자마자 남은 쪽을 읽는다(파일 고르기를 건너뛴다).
   * 한 번만 돈다(ref) — run 이 다시 만들어져도 두 번 읽지 않는다.
   */
  const resumed = useRef(false)
  useEffect(() => {
    if (!resume || resumed.current) return
    resumed.current = true
    void run(resume.pieces, resume.pageFrom, resume.total)
  }, [resume, run])


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

  /** 이번 가져오기를 통째로 무른다 — **새로 담긴 줄만** 지운다. */
  const undo = async () => {
    const yes = await confirmDialog({
      title: '이번 가져오기를 되돌릴까요?',
      message: undoQuestion(tally.saved),
      confirmText: '되돌리기',
      cancelText: '그대로 두기',
      variant: 'danger',
    })
    if (!yes) return
    setUndoing(true)
    try {
      const res = await fetch('/api/cards/delete', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'batch', import_batch_id: batchId.current }),
      })
      const json = await res.json() as { ok?: boolean; deleted?: number; error?: string }
      if (json?.ok) {
        setUndone(json.deleted ?? 0)
        onDone({ ...tally, saved: 0 })
      } else {
        setNote(json?.error ?? '되돌리지 못했습니다')
      }
    } catch {
      setNote('되돌리지 못했습니다')
    } finally {
      setUndoing(false)
    }
  }

  const dupRows = rows.filter(r => !r.ok && r.reason === 'dup')
  const mergedRows = rows.filter(r => !r.ok && r.reason === 'merged')
  const noPersonRows = rows.filter(r => !r.ok && r.reason === 'no_person')
  const failRows = rows.filter(r => !r.ok && !['dup', 'merged', 'no_person'].includes(r.reason ?? ''))
  const pct = progressPercent(tally.done, total)

  /** 펼침 단추 하나 — 묶음 이름과 줄들. */
  const foldable = (
    key: 'dup' | 'merged' | 'noPerson' | 'failed',
    title: string,
    list: readonly Done[],
    line: (r: Done) => string,
  ) => list.length === 0 ? null : (
    <>
      <button type="button" onClick={() => setOpenList(openList === key ? null : key)}
        style={{
          height: 32, border: `1px solid ${BORDER}`, borderRadius: R.control, background: CARD_BG,
          color: TEXT_LABEL, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          textAlign: 'left', padding: '0 10px',
        }}>
        {title} {list.length}건 {openList === key ? '접기' : '펼치기'}
      </button>
      {openList === key && (
        <div style={{
          maxHeight: 160, overflowY: 'auto', border: `1px solid ${BORDER}`,
          borderRadius: R.control, padding: '6px 10px',
        }}>
          {list.map((r, i) => (
            <div key={i} style={{ fontSize: 12, color: SUB, padding: '3px 0' }}>{line(r)}</div>
          ))}
        </div>
      )}
    </>
  )

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

            {phase === 'finished' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {foldable('merged', '뒷면 합침', mergedRows,
                  r => `${r.label} → ${r.mergedInto ? `${r.mergedInto}번 ` : ''}명함에 합침`)}
                {foldable('dup', '중복', dupRows,
                  r => `${r.label} — 이미 있는 명함${r.name ? ` · ${r.name}` : ''}`)}
                {foldable('noPerson', '사람 이름 없음', noPersonRows,
                  r => `${r.label} — 사람 이름 없음${r.name ? `(${r.name})` : ''}`)}
                {foldable('failed', '실패', failRows,
                  r => `${r.label} — ${BULK_REASON_LABEL[r.reason ?? 'api']}`)}
              </div>
            )}

            {/* 읽기 비용 — 마지막 줄. 토큰이 0이면 적지 않는다. */}
            {phase === 'finished' && usage.input + usage.output > 0 && (
              <div style={{ fontSize: 12, color: SUB }}>
                {costLabel(usage)} <span style={{ color: MUTED }}>
                  (입력 {usage.input.toLocaleString('ko-KR')} · 출력 {usage.output.toLocaleString('ko-KR')} 토큰)
                </span>
              </div>
            )}

            {/* 되돌리기 — 새로 담긴 줄만 지운다. 한 번 누르면 더 뜨지 않는다. */}
            {phase === 'finished' && tally.saved > 0 && undone == null && (
              <button type="button" onClick={() => void undo()} disabled={undoing}
                style={{
                  height: BTN_H, border: `1px solid ${BORDER}`, borderRadius: R.control,
                  background: CARD_BG, color: DANGER, fontWeight: 700, fontSize: 13,
                  cursor: undoing ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                }}>
                {undoing ? '되돌리는 중…' : '이번 가져오기 되돌리기'}
              </button>
            )}
            {undone != null && (
              <div style={{ fontSize: 12, color: SUB }}>
                되돌렸습니다 — {undone}건을 지웠습니다. 합쳐진 뒷면·기존 명함은 그대로입니다.
              </div>
            )}

          </div>
        )}
      </ModalCard>
    </ModalOverlay>
  )
}
