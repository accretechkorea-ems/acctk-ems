'use client'

// **엑셀 미리보기 모달** — 올라온 .xlsx 를 내려받지 않고 그 자리에서 본다.
//
// ── 왜 필요한가 ───────────────────────────────────────────────────────────
//   의뢰서 첨부의 절반 가까이가 엑셀이다(.xlsx 63 · .pdf 88). 지금은 누르면 받아서 열어야
//   하고, 보고 나면 내려받은 파일이 쌓인다. PDF 를 모달로 보게 된 것과 같은 이유다.
//
// ── 파싱은 **브라우저에서만** 한다 ────────────────────────────────────────
//   파일을 서버로 되보내지 않는다. 서명 URL 로 받아 그 자리에서 exceljs 로 읽는다.
//   exceljs 는 이미 엑셀 내보내기 단추들이 **동적 import** 로 쓰고 있어(견적·리드·쇼룸),
//   이 모달도 열 때만 같은 덩어리를 받는다 — 첫 화면 번들은 그대로다.
//
// ── 미리보기는 사본이다 ───────────────────────────────────────────────────
//   병합·굵게·배경색·테두리·열 너비까지는 옮기지만 차트·그림·조건부 서식은 빠진다.
//   그래서 머리줄에 그 사실을 적고 「다운로드」를 늘 함께 둔다.
//
// 크기는 **PDF 뷰어와 같은 규칙**이다(lib/pdfViewer.ts 의 pdfViewerBox — 화면 폭의 92%,
// 최대 1100px · 높이 96%). 엑셀은 가로로 넓어 720px 로는 한 화면에 몇 칸 들어오지 않았다.
// 모션은 수리 정보 모달 그대로다(150/180ms, 닫을 때 120ms).

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Z } from '@/lib/zIndex'
import { useOverlayEsc } from '@/components/common/overlayStack'
import { pdfViewerBox } from '@/lib/pdfViewer'

/** 미리보기로 열 수 있는 형식. 그 밖(.xls·.csv·.eml …)은 받아서 봐야 한다. */
const PREVIEWABLE = /\.(xlsx|xlsm)$/i
/** 이보다 큰 파일은 **앞부분만** 본다. */
export const XLSX_BIG_BYTES = 5 * 1024 * 1024
/** 한 시트에서 그리는 최대 줄. 큰 파일은 더 적게 본다. */
export const XLSX_MAX_ROWS = 1000
export const XLSX_BIG_MAX_ROWS = 200
/** 한 시트에서 그리는 최대 칸(가로). */
const MAX_COLS = 40

export type XlsxDoc = {
  /** 서명 URL(열람용 — Content-Disposition 이 attachment 면 안 된다). */
  url: string
  /** 보여 줄 파일 이름. */
  name: string
  /** 아는 경우의 파일 크기(바이트). 모르면 받아 본 뒤에 안다. */
  byteSize?: number | null
  /** 「다운로드」가 쓸 주소. 없으면 url 을 그대로 쓴다. */
  downloadUrl?: string
}

/** 미리보기를 못 하는 이유 — 화면에 그대로 적는다. */
export function previewBlockReason(name: string): string | null {
  const n = (name ?? '').trim()
  if (PREVIEWABLE.test(n)) return null
  if (/\.xls$/i.test(n)) return '구형 엑셀(.xls)은 미리보기할 수 없습니다.'
  if (/\.csv$/i.test(n)) return 'CSV 는 미리보기할 수 없습니다.'
  return '이 형식은 미리보기할 수 없습니다.'
}

type CellBox = {
  text: string
  bold: boolean
  bg: string | null
  align: 'left' | 'center' | 'right'
  border: { top: boolean; right: boolean; bottom: boolean; left: boolean }
  rowSpan: number
  colSpan: number
}

type SheetBox = {
  name: string
  rows: CellBox[][]
  widths: number[]
  /** 잘라서 보여 주는 중인가. */
  truncated: boolean
  totalRows: number
}

const BORDER = '#ebebeb'
const MUTED = '#9ca3af'
const TEXT = '#111827'

/** exceljs 의 값 한 칸 → 글자. 수식은 **계산값**을 쓴다. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cellText(value: any): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') {
    if ('result' in value) return cellText(value.result)        // 수식 — 계산값
    if ('text' in value) return String(value.text)              // 서식 있는 글자·하이퍼링크
    if ('richText' in value) return (value.richText ?? []).map((r: { text: string }) => r.text).join('')
    if (value instanceof Date) return value.toISOString().slice(0, 10)
    if ('error' in value) return String(value.error)
    return ''
  }
  if (typeof value === 'number') return String(Math.round(value * 1e6) / 1e6)
  return String(value)
}

/** ARGB(FF1F4E79) → #1f4e79. 흰색·없음은 null 로 접는다(칸마다 흰 배경을 칠하지 않는다). */
function argbToHex(argb: string | undefined): string | null {
  if (!argb || argb.length < 6) return null
  const hex = `#${argb.slice(-6).toLowerCase()}`
  return hex === '#ffffff' ? null : hex
}

export default function XlsxPreviewModal({ doc, onClose }: { doc: XlsxDoc; onClose: () => void }) {
  const reduced = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const [shown, setShown] = useState(reduced)
  const [closing, setClosing] = useState(false)
  const [sheets, setSheets] = useState<SheetBox[] | null>(null)
  const [active, setActive] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [big, setBig] = useState(false)
  const closedRef = useRef(false)
  /** 창 치수 — PDF 뷰어와 같은 규칙. 화면이 바뀌면 다시 잰다. */
  const [box, setBox] = useState(() => (typeof window === 'undefined'
    ? { width: 1100, height: 900, bodyHeight: 852 }
    : pdfViewerBox(window.innerWidth, window.innerHeight)))

  useEffect(() => {
    const onResize = () => setBox(pdfViewerBox(window.innerWidth, window.innerHeight))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (reduced) return
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [reduced])

  const close = () => {
    if (closedRef.current) return
    closedRef.current = true
    if (reduced) { onClose(); return }
    setClosing(true)
    setTimeout(onClose, 120)
  }

  // Esc — 맨 위 오버레이만(PDF 뷰어와 같은 규칙).
  useOverlayEsc(true, () => close())

  // 파일을 받아 그 자리에서 읽는다 — 서버로 되보내지 않는다.
  useEffect(() => {
    let alive = true
    const blocked = previewBlockReason(doc.name)
    if (blocked) { setError(blocked); return }
    ;(async () => {
      try {
        const res = await fetch(doc.url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const buf = await res.arrayBuffer()
        if (!alive) return
        const isBig = buf.byteLength > XLSX_BIG_BYTES
        setBig(isBig)
        const rowLimit = isBig ? XLSX_BIG_MAX_ROWS : XLSX_MAX_ROWS
        const ExcelJS = (await import('exceljs')).default
        const wb = new ExcelJS.Workbook()
        await wb.xlsx.load(buf)
        if (!alive) return

        const made: SheetBox[] = []
        wb.eachSheet(ws => {
          // 병합된 칸 — 왼쪽 위만 그리고 나머지는 건너뛴다.
          const spans = new Map<string, { rowSpan: number; colSpan: number }>()
          const covered = new Set<string>()
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for (const range of Object.values((ws as any)._merges ?? {}) as any[]) {
            const { top, left, bottom, right } = range.model ?? range
            spans.set(`${top}:${left}`, { rowSpan: bottom - top + 1, colSpan: right - left + 1 })
            for (let r = top; r <= bottom; r++) {
              for (let c = left; c <= right; c++) if (!(r === top && c === left)) covered.add(`${r}:${c}`)
            }
          }
          // 칸 수는 **병합이 뻗은 끝**까지 본다 — columnCount 는 값이 든 칸만 세어서,
          // 제목처럼 빈 칸을 가로지르는 병합이 있으면 모자란다(그러면 표가 한 줄로 찌그러진다).
          let widest = ws.columnCount || 1
          for (const key of spans.keys()) {
            const [r0, c0] = key.split(':').map(Number)
            const sp = spans.get(key)!
            if (c0 + sp.colSpan - 1 > widest) widest = c0 + sp.colSpan - 1
            void r0
          }
          const colCount = Math.min(widest, MAX_COLS)
          const widths: number[] = []
          for (let c = 1; c <= colCount; c++) {
            const w = ws.getColumn(c).width
            widths.push(Math.round((w ?? 10) * 7.5))   // 엑셀 폭 1 ≒ 글자 하나 ≒ 7.5px
          }
          const rows: CellBox[][] = []
          const total = ws.rowCount || 0
          const lastRow = Math.min(total, rowLimit)
          for (let r = 1; r <= lastRow; r++) {
            const row = ws.getRow(r)
            const cells: CellBox[] = []
            for (let c = 1; c <= colCount; c++) {
              if (covered.has(`${r}:${c}`)) continue
              const cell = row.getCell(c)
              const span = spans.get(`${r}:${c}`)
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const fill = cell.fill as any
              const b = cell.border ?? {}
              cells.push({
                text: cellText(cell.value),
                bold: !!cell.font?.bold,
                bg: fill?.type === 'pattern' ? argbToHex(fill.fgColor?.argb) : null,
                align: cell.alignment?.horizontal === 'center' ? 'center'
                  : cell.alignment?.horizontal === 'right' ? 'right' : 'left',
                border: { top: !!b.top, right: !!b.right, bottom: !!b.bottom, left: !!b.left },
                rowSpan: span?.rowSpan ?? 1,
                colSpan: span?.colSpan ?? 1,
              })
            }
            rows.push(cells)
          }
          made.push({ name: ws.name, rows, widths, truncated: total > lastRow, totalRows: total })
        })
        if (made.length === 0) { setError('읽을 수 있는 시트가 없습니다.'); return }
        setSheets(made)
      } catch (e) {
        console.error('[xlsx] 미리보기 실패', e)
        if (!alive) return
        // exceljs 는 암호가 걸린 파일에서 바로 던진다 — 사람에게는 한 줄로 알린다.
        setError('이 파일은 미리보기할 수 없습니다(암호가 걸려 있거나 형식이 다를 수 있습니다).')
      }
    })()
    return () => { alive = false }
  }, [doc.url, doc.name])

  const open = shown && !closing
  const motion = reduced ? 'none' : undefined
  const sheet = sheets?.[active] ?? null
  const linkStyle: React.CSSProperties = {
    padding: '4px 9px', border: `1px solid ${BORDER}`, borderRadius: 6,
    fontSize: 11, fontWeight: 700, color: '#234ea2', textDecoration: 'none', background: '#fff', cursor: 'pointer',
  }

  // **body 끝에 붙인다**(포털) — 모달 안에서 열려도 그 모달의 스택 컨텍스트·overflow 에
  // 갇히지 않는다. 띄울 곳이 아직 없으면(서버 렌더) 아무것도 그리지 않는다.
  if (typeof document === 'undefined') return null

  return createPortal((
    <div
      onMouseDown={e => { if (e.target === e.currentTarget) close() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: Z.viewer,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        opacity: open ? 1 : 0,
        transition: motion ?? `opacity ${closing ? 120 : 150}ms ease-out`,
      }}
    >
      <div
        style={{
          // 치수는 PDF 뷰어와 같다. 모션만 수리 정보 모달 그대로다.
          width: box.width, height: box.height, maxWidth: '100%', background: '#fff', borderRadius: 8,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.22)',
          opacity: open ? 1 : 0,
          transform: open ? 'translateY(0) scale(1)' : 'translateY(8px) scale(0.98)',
          transition: motion ?? `opacity ${closing ? 120 : 180}ms ease-out, transform ${closing ? 120 : 180}ms ease-out`,
        }}
      >
        {/* 머리줄 — 파일 이름 · 다운로드 · 닫기 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {doc.name}
          </span>
          <span style={{ flex: 1 }} />
          <a href={doc.downloadUrl ?? doc.url} download={doc.name} style={linkStyle}>다운로드</a>
          <button onClick={close} title="닫기" aria-label="닫기"
            style={{ width: 24, height: 24, padding: 0, background: 'none', border: 'none', cursor: 'pointer', color: MUTED, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {/* 안내문 — 미리보기는 사본이라는 것을 늘 적어 둔다. */}
        <div style={{ padding: '8px 14px', borderBottom: `1px solid ${BORDER}`, fontSize: 11, color: MUTED, lineHeight: 1.6, flexShrink: 0 }}>
          미리보기입니다. 실제 파일과 내용은 같으나 서식·차트·이미지는 다르거나 빠질 수 있습니다.
          {big && <span style={{ color: '#234ea2', fontWeight: 700 }}>{' '}큰 파일이라 앞부분만 보여 줍니다 — 전체는 다운로드하세요.</span>}
        </div>

        {/* 시트 탭 */}
        {sheets && sheets.length > 1 && (
          <div style={{ display: 'flex', gap: 4, padding: '8px 14px 0', borderBottom: `1px solid ${BORDER}`, overflowX: 'auto', flexShrink: 0 }}>
            {sheets.map((s, i) => (
              <button key={s.name + i} onClick={() => setActive(i)}
                style={{
                  padding: '5px 10px', border: 'none', borderBottom: `2px solid ${i === active ? '#234ea2' : 'transparent'}`,
                  background: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                  fontSize: 12, fontWeight: 700, color: i === active ? '#234ea2' : MUTED,
                }}>
                {s.name}
              </button>
            ))}
          </div>
        )}

        {/* 본문 — 표만 구른다 */}
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#fff' }}>
          {error ? (
            <div style={{ padding: 40, textAlign: 'center', fontSize: 12, color: MUTED, lineHeight: 1.8 }}>
              {error}
              <div style={{ marginTop: 12 }}>
                <a href={doc.downloadUrl ?? doc.url} download={doc.name} style={linkStyle}>다운로드</a>
              </div>
            </div>
          ) : !sheet ? (
            <div style={{ padding: 40, textAlign: 'center', fontSize: 12, color: MUTED }}>엑셀을 읽는 중…</div>
          ) : (
            <>
              {/* 폭은 엑셀 값을 '힌트'로만 준다 — 못 박으면(tableLayout:fixed) 긴 제목이 한 글자씩 접힌다. */}
              <table style={{ borderCollapse: 'collapse', fontSize: 11, color: TEXT, width: 'max-content', minWidth: '100%' }}>
                {/* 열 너비는 **최소값**으로만 준다 — 엑셀은 빈 옆칸으로 글자가 넘쳐 보이지만
                    HTML 표는 칸 안에서 접힌다. 폭을 못 박으면 제목이 한 글자씩 세로로 접힌다. */}
                <colgroup>
                  {sheet.widths.map((w, i) => <col key={i} style={{ minWidth: Math.max(40, Math.min(w, 200)) }} />)}
                </colgroup>
                <tbody>
                  {sheet.rows.map((row, r) => (
                    <tr key={r}>
                      {row.map((c, i) => (
                        <td key={i} rowSpan={c.rowSpan} colSpan={c.colSpan}
                          style={{
                            padding: '3px 5px', verticalAlign: 'middle', textAlign: c.align,
                            minWidth: 40,
                            fontWeight: c.bold ? 700 : 400,
                            background: c.bg ?? undefined,
                            // 한 줄로 두고 표가 가로로 자라게 한다(모달 안에서 가로로 구른다).
                            whiteSpace: 'nowrap', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis',
                            borderTop: c.border.top ? `1px solid ${'#d1d5db'}` : undefined,
                            borderRight: c.border.right ? `1px solid ${'#d1d5db'}` : undefined,
                            borderBottom: c.border.bottom ? `1px solid ${'#d1d5db'}` : undefined,
                            borderLeft: c.border.left ? `1px solid ${'#d1d5db'}` : undefined,
                          }}>
                          {c.text}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {sheet.truncated && (
                <div style={{ padding: '10px 14px', fontSize: 11, color: MUTED }}>
                  {`${sheet.totalRows.toLocaleString('ko-KR')}줄 가운데 앞 ${sheet.rows.length.toLocaleString('ko-KR')}줄만 보여 줍니다 — 전체는 다운로드하세요.`}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  ), document.body)
}
