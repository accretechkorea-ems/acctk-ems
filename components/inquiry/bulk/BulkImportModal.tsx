'use client'

// ───────────────────────── TEMP-BULK-IMPORT ─────────────────────────
// 일괄 등록(임시). 처음 한두 달 동안 지난 파일을 넣고 나면 이 폴더째 지운다.
// 지우는 법은 lib/inquiries.ts 의 BULK_IMPORT_ENABLED 주석에 적어 두었다.
// ─────────────────────────────────────────────────────────────────────
//
// 흐름: 파일 올리기 → 미리보기(번호로 묶기·검사) → 카운터 확인 한 번 → 한 행씩 등록.
//
// 서버는 기존 것만 쓴다 — register · message_add · /api/inquiry-attachment.
// 새 action 을 만들지 않았다. 등록 모달(RegisterModal)과 같은 순서로 같은 값을 보낸다.
//
// ※ RegisterModal 의 흐름을 공용 함수로 뽑지 않았다. 뽑으려면 그 컴포넌트의 몸통을 고쳐야 하는데
//   「기존 파일은 진입 버튼과 모달 마운트 몇 줄만」이라는 조건과 어긋나고, 흐름도 실제로 다르다
//   (여기는 행마다 묻지 않고 confirm_bump 를 미리 정해 보내며, 순차 처리·중단·재시도가 붙는다).
//   임시 기능이 영구 코드를 흔들지 않게 두는 편이 지울 때도 깨끗하다.

import { useMemo, useRef, useState } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import { useToast } from '@/components/common/Toast'
import { useConfirm } from '@/components/common/ConfirmDialog'
import { createClient } from '@/lib/supabase/client'
import {
  CARD_BG, BORDER, TEXT, SUB, MUTED, NEUTRAL_BG, BLUE, FAINT,
  cardHeader, cardTitle, btnPrimary, btnGhost,
} from '@/components/common/ui'
import { engineerLabel, isCurrentlyEmployed } from '@/lib/engineers'
import { todayKST } from '@/lib/date'
import {
  INQUIRY_TYPE_LABEL, REQ80_SERIES, REQ20_SERIES, INQUIRY_TYPE_ITEMS, type InquiryType,
} from '@/lib/inquiries'
import { errorInfo } from '@/lib/errorInfo'
import { failText, uploadFiles, sizeText, type UploadFail } from '../files'
import { parseFiles, hitToNo, type Hit } from './parseFileNames'
import {
  buildRows, bumpSummary, checkFile, rowError, recalc, markDuplicates, applyTypeChange,
  revertRow, moveFile, sortRows, touched, needsYear, chunk, fileYmd,
  QUERY_CHUNK, type Row,
} from './plan'

/** 한 번에 받는 파일 수 상한. 미리보기 표가 읽을 수 있는 선. */
const MAX_PICK = 200

type Engineer = { engineer_id: number; name: string | null; position: string | null; resigned_date: string | null }

/** 처리 상태 — 행마다 하나. */
type RunState =
  | { s: 'idle' }
  | { s: 'running' }
  | { s: 'done' }
  | { s: 'partial'; fails: UploadFail[]; messageId: number }
  | { s: 'failed'; reason: string }

/** 미분류·모호 파일을 어떻게 할지. */
type Pending = {
  file: File
  hits: Hit[]
  /** '' = 아직 안 정함, 'skip' = 제외, 'row:<no>' = 그 행에 붙이기, 'new' = 새 번호 */
  choice: string
  newType: InquiryType | ''
  newSeq: string
  newSeries: string
}

const field: React.CSSProperties = {
  padding: '5px 8px', border: `1px solid ${BORDER}`, borderRadius: 6,
  fontSize: 12, color: TEXT, background: CARD_BG, outline: 'none',
  boxSizing: 'border-box', fontFamily: 'inherit', width: '100%',
}
const th: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: MUTED, textAlign: 'left',
  padding: '6px 8px', whiteSpace: 'nowrap', background: NEUTRAL_BG,
}
const td: React.CSSProperties = {
  fontSize: 12, color: TEXT, padding: '8px', borderTop: `1px solid ${BORDER}`, verticalAlign: 'top',
}

export default function BulkImportModal({
  engineers, myId, onClose, onDone,
}: {
  engineers: Engineer[]
  myId: number | null
  onClose: () => void
  /** 한 건이라도 등록됐으면 부른다(목록을 다시 읽는다). */
  onDone: () => void
}) {
  const toast = useToast()
  const confirmDialog = useConfirm()
  const today = todayKST()
  const supabase = useMemo(() => createClient(), [])

  const [step, setStep] = useState<'pick' | 'preview'>('pick')
  const [rows, setRows] = useState<Row[]>([])
  const [pending, setPending] = useState<Pending[]>([])
  const [checking, setChecking] = useState(false)
  const [run, setRun] = useState<Record<string, RunState>>({})
  const [running, setRunning] = useState(false)
  const [doneCount, setDoneCount] = useState(0)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  /** 「중단」을 누르면 올린다 — 현재 행이 끝난 뒤 멈춘다. */
  const stopRef = useRef(false)

  const selectable = engineers.filter(e => isCurrentlyEmployed(e.resigned_date, today))

  // ── 1단계: 파일 받기 ─────────────────────────────────────────────
  const take = async (list: FileList | null) => {
    if (!list || list.length === 0) return
    const picked = Array.from(list).slice(0, MAX_PICK)
    if (list.length > MAX_PICK) toast.error(`한 번에 ${MAX_PICK}개까지만 읽습니다 (${list.length}개 중)`)

    const parsed = parseFiles(picked)
    const matched = parsed.flatMap(p => (p.kind === 'matched' ? [{ file: p.file, hit: p.hit }] : []))
    const rest = parsed.flatMap(p => (p.kind === 'matched' ? [] : [{
      file: p.file,
      hits: p.kind === 'ambiguous' ? p.hits : [],
      choice: '', newType: '' as const, newSeq: '', newSeries: '',
    }]))

    const built = buildRows(matched, myId ?? '')
    setRows(built)
    setPending(rest)
    setStep('preview')
    await precheck(built)
  }

  type Found = {
    id: string; inquiry_no: string; inquiry_type: string; period_key: string
    seq: number; equipment_series: string | null
  }

  /**
   * 사전 검사 — 번호가 이미 있는지, 80 의뢰서의 계열이 다른지.
   * 브라우저 supabase 로 읽기만 한다(RLS 가 걸러 준다).
   *
   * 번호는 **100개씩 끊어** 조회한다. in 은 쿼리 문자열로 나가므로 한 번에 200개를 보내면
   * URL 이 수천 자가 되고 응답 행도 기본 상한(1000)에 가까워진다(plan.ts 의 QUERY_CHUNK).
   */
  const precheck = async (list: Row[]) => {
    if (list.length === 0) { setRows(list); return }
    setChecking(true)
    try {
      const found: Found[] = []
      for (const part of chunk(list.map(r => r.no).filter(Boolean), QUERY_CHUNK)) {
        const { data, error: qErr } = await supabase
          .from('inquiries')
          .select('id, inquiry_no, inquiry_type, period_key, seq, equipment_series')
          .in('inquiry_no', part)
        if (qErr) { setError(`이미 등록된 번호를 확인하지 못했습니다: ${qErr.message}`); return }
        found.push(...((data ?? []) as Found[]))
      }

      // 80 의뢰서는 (연도, 일련번호)가 같고 계열만 다른 건이 이미 있으면 알린다.
      const years = [...new Set(list.filter(r => r.type === 'req80').map(r => String(r.year ?? '')))]
      const sameSeq: Found[] = []
      for (const part of chunk(years.filter(Boolean), QUERY_CHUNK)) {
        const { data: d2 } = await supabase
          .from('inquiries')
          .select('id, inquiry_no, inquiry_type, period_key, seq, equipment_series')
          .eq('inquiry_type', 'req80')
          .in('period_key', part)
        sameSeq.push(...((d2 ?? []) as Found[]))
      }

      setRows(markDuplicates(list.map(r => {
        const hit = found.find(f => f.inquiry_no === r.no)
        const other = r.type === 'req80'
          ? sameSeq.find(f => f.seq === r.seq && String(f.period_key) === String(r.year) && f.inquiry_no !== r.no)
          : undefined
        const next: Row = {
          ...r,
          existing: hit ? 'exists' : 'new',
          existingId: hit?.id,
          warn: other ? `같은 순번이 다른 계열로 이미 있습니다 (${other.inquiry_no})` : null,
        }
        return { ...next, error: rowError(next) }
      })))
    } catch (e) {
      console.error('[bulk] 사전 검사 실패', errorInfo(e))
      setError('사전 검사를 하지 못했습니다.')
    } finally {
      setChecking(false)
    }
  }

  /** 번호를 고친 행 하나만 다시 확인한다(바뀐 번호만 추가 조회). */
  const recheckOne = async (row: Row) => {
    if (!row.no) return
    const { data } = await supabase
      .from('inquiries')
      .select('id, inquiry_no')
      .in('inquiry_no', [row.no])
    const hit = ((data ?? []) as { id: string; inquiry_no: string }[])[0]
    setRows(prev => markDuplicates(prev.map(r => {
      if (r.id !== row.id) return r
      const next: Row = { ...r, existing: hit ? 'exists' : 'new', existingId: hit?.id }
      return { ...next, error: rowError(next) }
    })))
  }

  // ── 행 고치기 ───────────────────────────────────────────────────
  // 모든 편집은 patch 하나를 지난다 — recalc(번호·발행일 다시 만들기)와 중복 검사를
  // 빠뜨릴 자리를 만들지 않으려는 것이다.
  const patch = (id: string, part: Partial<Row>) =>
    setRows(prev => markDuplicates(prev.map(r => (r.id === id ? recalc({ ...r, ...part }) : r))))

  /**
   * 번호에 영향을 주는 편집(종류·계열·일련번호·연도·번호용 날짜).
   * 고친 뒤 **그 행만** 다시 조회한다 — 전체를 다시 훑지 않는다.
   */
  const patchNo = (id: string, part: Partial<Row>) => {
    const cur = rows.find(r => r.id === id)
    if (!cur) return
    const nextRow = recalc({ ...cur, ...part })
    setRows(prev => markDuplicates(prev.map(r => (r.id === id ? nextRow : r))))
    void recheckOne(nextRow)
  }

  /** 종류 변경 — 종류별 입력 기억을 오가며 복원한다(plan.applyTypeChange). */
  const changeType = (id: string, next: InquiryType) => {
    const cur = rows.find(r => r.id === id)
    if (!cur) return
    const nextRow = applyTypeChange(cur, next)
    setRows(prev => markDuplicates(prev.map(r => (r.id === id ? nextRow : r))))
    void recheckOne(nextRow)
  }

  const revert = (id: string) =>
    setRows(prev => markDuplicates(prev.map(r => (r.id === id ? revertRow(r) : r))))

  /** 파일을 다른 행으로 옮긴다. 비게 된 행은 사라지고 양쪽 다 다시 검사한다(plan.moveFile). */
  const move = (fromId: string, index: number, toId: string) =>
    setRows(prev => moveFile(prev, fromId, index, toId))

  const applyOwnerAll = (ownerId: number) =>
    setRows(prev => prev.map(r => recalc({ ...r, createdBy: ownerId })))

  /** 확인 필요·미분류 파일의 선택을 행에 반영한다. */
  const resolvePending = () => {
    const keep: Pending[] = []
    let next = [...rows]
    for (const p of pending) {
      if (p.choice === 'skip' || p.choice === '') { if (p.choice === '') keep.push(p); continue }
      if (p.choice.startsWith('row:')) {
        const id = p.choice.slice(4)
        next = next.map(r => (r.id === id ? { ...r, files: [...r.files, p.file] } : r))
        continue
      }
      if (p.choice === 'new') {
        const t = p.newType
        const seq = Number(p.newSeq)
        if (!t || !Number.isInteger(seq) || seq < 1) { keep.push(p); continue }
        const hit: Hit = {
          type: t, seq,
          year: t === 'hq_repair' || t === 'spare80' ? undefined : Number(fileYmd(p.file).slice(0, 4)),
          series: t === 'req80' ? p.newSeries : undefined,
          date: t === 'spare80' ? fileYmd(p.file) : undefined,
          matched: '',
        }
        if (t === 'req80' && !REQ80_SERIES.includes(p.newSeries)) { keep.push(p); continue }
        // 행 만들기는 buildRows 한 곳에만 둔다 — 여기서 Row 를 손으로 조립하면
        // 필드가 늘 때마다 두 곳을 고쳐야 한다.
        const made = buildRows([{ file: p.file, hit }], myId ?? '')[0]
        if (!made || !made.no) { keep.push(p); continue }
        const found = next.find(r => r.no === made.no)
        if (found) {
          next = next.map(r => (r.id === found.id ? { ...r, files: [...r.files, p.file] } : r))
        } else {
          next = [...next, made]
        }
      }
    }
    next = sortRows(markDuplicates(next.map(recalc)))
    setRows(next)
    setPending(keep)
    precheck(next)
  }

  // ── 등록 ────────────────────────────────────────────────────────
  // 등록 직전의 현재 상태로 고른다 — 번호를 고쳤으면 고친 값이 기준이다.
  // (종류, 기간)별 일련번호 오름차순 규칙은 편집 뒤에도 유지한다.
  const targets = sortRows(rows.filter(r => r.include && !r.error && (r.existing === 'new' || r.attachToExisting)))
  const editedTargets = targets.filter(touched)

  const start = async () => {
    if (running || targets.length === 0) return
    setError('')

    // 카운터 요약 — peek 로 지금 카운터를 읽어 한 번만 묻는다.
    let counters: { type: string; period_key: string; last_seq: number }[] = []
    try {
      const res = await fetch('/api/inquiry', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'peek' }),
      })
      const json = await res.json().catch(() => null)
      if (res.ok && Array.isArray(json?.counters)) counters = json.counters
    } catch (e) {
      console.error('[bulk] peek 실패', errorInfo(e))
    }
    const bumps = bumpSummary(targets, counters)
    const lines = bumps.map(b =>
      `· ${INQUIRY_TYPE_LABEL[b.type]} ${b.periodKey}: ${b.current}번 → ${b.max}번 (사이 ${b.skipped}개가 사용된 번호가 됩니다)`)

    // 자동 인식과 다르게 고친 행을 함께 보여 준다 — 종류를 잘못 고른 채 큰 번호가 카운터를
    // 올리는 실수를 여기서 한 번 더 거른다(카운터는 내릴 수 없다).
    const editedLines = editedTargets.map(r =>
      `· ${r.auto.no} → ${r.no} (${INQUIRY_TYPE_LABEL[r.auto.type]} → ${INQUIRY_TYPE_LABEL[r.type]})`)

    const ok = await confirmDialog({
      title: `${targets.length}건을 등록합니다`,
      message: [
        ...(editedLines.length > 0
          ? [`자동 인식과 다르게 고친 행이 ${editedLines.length}개 있습니다.`, ...editedLines, '']
          : []),
        ...(lines.length > 0 ? ['번호가 건너뜁니다.', ...lines, ''] : []),
        '한 번 등록된 번호는 되돌릴 수 없습니다 — 취소해도 「취소」 상태로 남습니다.',
      ].join('\n'),
      confirmText: '등록 시작',
      variant: lines.length > 0 || editedLines.length > 0 ? 'danger' : undefined,
    })
    if (!ok) return

    stopRef.current = false
    setRunning(true)
    setDoneCount(0)
    let made = 0
    try {
      for (const row of targets) {
        if (stopRef.current) break
        setRun(p => ({ ...p, [row.id]: { s: 'running' } }))
        const r = await runRow(row)
        setRun(p => ({ ...p, [row.id]: r }))
        if (r.s !== 'failed') made += 1
        setDoneCount(n => n + 1)
      }
    } finally {
      setRunning(false)
      if (made > 0) onDone()
    }
  }

  /** 한 행 — register → message_add → uploadFiles. 등록 모달과 같은 순서·같은 값이다. */
  const runRow = async (row: Row): Promise<RunState> => {
    try {
      let inquiryId = row.existingId ?? ''
      if (row.existing === 'new') {
        const res = await fetch('/api/inquiry', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'register', type: row.type, issued_date: row.issuedDate,
            equipment_series: row.type === 'req80' ? row.series : undefined,
            seq: row.seq, title: row.title, status: 'done', created_by: row.createdBy,
            // 행마다 묻지 않는다 — 시작 전에 한 번 확인받았다(과거 연도는 머리말 참고).
            confirm_bump: true,
          }),
        })
        const json = await res.json().catch(() => null)
        if (!res.ok) return { s: 'failed', reason: json?.error || `등록 실패 (HTTP ${res.status})` }
        inquiryId = String(json?.inquiry?.id ?? '')
        if (!inquiryId) return { s: 'failed', reason: '등록은 됐지만 id 를 읽지 못했습니다.' }
      }
      if (row.files.length === 0) return { s: 'done' }

      const mRes = await fetch('/api/inquiry', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // 발신 고정 — 등록 모달과 같은 값이다(사람이 고를 것이 없다).
          action: 'message_add', inquiry_id: inquiryId, entry_date: row.issuedDate, direction: 'sent', body: '',
        }),
      })
      const mJson = await mRes.json().catch(() => null)
      const messageId = Number(mJson?.message?.id)
      if (!mRes.ok || !Number.isInteger(messageId)) {
        return { s: 'partial', messageId: 0, fails: row.files.map(f => ({ name: f.name, reason: mJson?.error || '내용 기록을 만들지 못했습니다.' })) }
      }
      const fails = await uploadFiles(messageId, row.files)
      return fails.length > 0 ? { s: 'partial', fails, messageId } : { s: 'done' }
    } catch (e) {
      console.error('[bulk] 행 처리 실패', { no: row.no, ...errorInfo(e) })
      return { s: 'failed', reason: e instanceof Error ? e.message : '알 수 없는 오류' }
    }
  }

  /** 파일만 다시 올린다 — 번호는 이미 등록됐으므로 새로 만들지 않는다. */
  const retryFiles = async (row: Row) => {
    const st = run[row.id]
    if (!st || st.s !== 'partial' || st.messageId === 0) return
    setRun(p => ({ ...p, [row.id]: { s: 'running' } }))
    const again = row.files.filter(f => st.fails.some(x => x.name === f.name))
    const fails = await uploadFiles(st.messageId, again)
    setRun(p => ({ ...p, [row.id]: fails.length > 0 ? { s: 'partial', fails, messageId: st.messageId } : { s: 'done' } }))
  }

  const retryFailed = async () => {
    const again = targets.filter(r => run[r.id]?.s === 'failed')
    if (again.length === 0) return
    setRunning(true)
    stopRef.current = false
    try {
      for (const row of again) {
        if (stopRef.current) break
        setRun(p => ({ ...p, [row.id]: { s: 'running' } }))
        // 결과를 먼저 받아 두고 넣는다 — setRun 의 콜백은 async 가 아니다.
        const r = await runRow(row)
        setRun(p => ({ ...p, [row.id]: r }))
      }
    } finally { setRunning(false); onDone() }
  }

  const close = async () => {
    if (running) {
      const ok = await confirmDialog({
        title: '등록이 진행 중입니다',
        message: '창을 닫아도 이미 등록된 건은 그대로 남습니다. 남은 건은 등록되지 않습니다.',
        confirmText: '닫기', variant: 'danger',
      })
      if (!ok) return
      stopRef.current = true
    }
    onClose()
  }

  const counts = {
    done: Object.values(run).filter(r => r.s === 'done').length,
    partial: Object.values(run).filter(r => r.s === 'partial').length,
    failed: Object.values(run).filter(r => r.s === 'failed').length,
  }

  return (
    <ModalOverlay onClose={close}>
      <div style={{
        background: CARD_BG, borderRadius: 8, padding: '14px 16px', width: '100%', maxWidth: 1100,
        maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.22)',
      }}>
        <div style={cardHeader}>
          <span style={cardTitle}>일괄 등록 <span style={{ fontSize: 12, fontWeight: 600, color: MUTED }}>(임시 기능)</span></span>
          {step === 'preview' && (
            <span style={{ marginLeft: 'auto', fontSize: 12, color: MUTED }}>
              {rows.length}건 · 등록 대상 {targets.length}건
              {checking && ' · 확인 중...'}
            </span>
          )}
        </div>

        {step === 'pick' ? (
          <>
            <div style={{ fontSize: 13, color: SUB, lineHeight: 1.7, marginBottom: 12 }}>
              지난 파일을 한 번에 올립니다. 파일 이름에서 번호를 찾아 의뢰서별로 묶고,
              다음 화면에서 확인한 뒤 등록합니다. 한 번에 {MAX_PICK}개까지.
            </div>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); take(e.dataTransfer.files) }}
              style={{
                display: 'block', width: '100%', border: `1px dashed ${BORDER}`, borderRadius: 8,
                padding: '40px 16px', background: CARD_BG, textAlign: 'center',
                fontSize: 13, color: MUTED, fontFamily: 'inherit', cursor: 'pointer', lineHeight: 1.7,
              }}
            >
              파일을 끌어다 놓거나 <span style={{ color: BLUE, fontWeight: 700 }}>눌러서 고르기</span>
              <br /><span style={{ fontSize: 12, color: FAINT }}>이름만 읽습니다 — 내용은 등록할 때 올립니다</span>
            </button>
            <input ref={inputRef} type="file" multiple hidden
              onChange={e => { take(e.target.files); e.target.value = '' }} />
          </>
        ) : (
          <>
            {error && (
              <div style={{
                fontSize: 12, lineHeight: 1.6, color: '#be123c', background: '#fef2f2',
                border: `1px solid ${BORDER}`, borderRadius: 8, padding: '8px 10px', marginBottom: 12,
              }}>{error}</div>
            )}

            {/* 담당자 일괄 적용 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: MUTED }}>담당자 일괄 적용</span>
              <select
                defaultValue="" disabled={running}
                onChange={e => { if (e.target.value) applyOwnerAll(Number(e.target.value)) }}
                style={{ ...field, width: 180 }}
              >
                <option value="">고르기</option>
                {selectable.map(e => (
                  <option key={e.engineer_id} value={e.engineer_id}>{engineerLabel(e)}</option>
                ))}
              </select>
            </div>

            {/* 미리보기 표 — 번호는 종류·계열·일련번호·연도로 조립한 파생값이라 읽기 전용이다.
                고치는 것은 그 재료들이다(buildInquiryNo 를 거친다). */}
            <div style={{ overflowX: 'auto', border: `1px solid ${BORDER}`, borderRadius: 8, marginBottom: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1180 }}>
                <thead>
                  <tr>
                    <th style={{ ...th, width: 34 }} />
                    <th style={{ ...th, width: 120 }}>종류</th>
                    <th style={{ ...th, width: 180 }}>번호 재료</th>
                    <th style={{ ...th, width: 150 }}>번호</th>
                    <th style={{ ...th, width: 170 }}>업체명</th>
                    <th style={{ ...th, width: 120 }}>발행일</th>
                    <th style={{ ...th, width: 130 }}>담당자</th>
                    <th style={th}>파일</th>
                    <th style={{ ...th, width: 150 }}>상태</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const st = run[r.id]
                    const edited = touched(r)
                    return (
                      <tr key={r.id} style={{ background: r.error ? '#fef2f2' : undefined }}>
                        <td style={td}>
                          <input type="checkbox" checked={r.include} disabled={running}
                            onChange={e => patch(r.id, { include: e.target.checked })} />
                        </td>

                        {/* 종류 — 바꾸면 연도·계열·번호용 날짜가 그 종류의 기억에서 복원된다. */}
                        <td style={td}>
                          <select value={r.type} disabled={running} style={field}
                            onChange={e => changeType(r.id, e.target.value as InquiryType)}>
                            {INQUIRY_TYPE_ITEMS.map(t => (
                              <option key={t.type} value={t.type}>{t.label}</option>
                            ))}
                          </select>
                          {edited && (
                            <div style={{ fontSize: 11, color: MUTED, marginTop: 3 }}>
                              <span style={{
                                background: NEUTRAL_BG, borderRadius: 99, padding: '1px 6px', fontWeight: 700,
                              }} title={`자동 인식: ${INQUIRY_TYPE_LABEL[r.auto.type]} ${r.auto.no}`}>
                                수정함
                              </span>
                              <button type="button" onClick={() => revert(r.id)} disabled={running}
                                style={{
                                  border: 'none', background: 'transparent', padding: '0 0 0 4px',
                                  color: BLUE, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                                }}>
                                되돌리기
                              </button>
                              <div style={{ color: FAINT, wordBreak: 'break-all' }}>자동 인식 {r.auto.no}</div>
                            </div>
                          )}
                        </td>

                        {/* 번호 재료 — 계열 · 일련번호 · 연도(또는 번호용 날짜). */}
                        <td style={td}>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {r.type === 'req80' && (
                              <select value={r.series ?? ''} disabled={running} style={{ ...field, width: 64 }}
                                onChange={e => patchNo(r.id, { series: e.target.value })}>
                                <option value="">계열</option>
                                {REQ80_SERIES.map(v => <option key={v} value={v}>{v}</option>)}
                              </select>
                            )}
                            {r.type === 'req20' && (
                              <span style={{ ...field, width: 64, color: SUB, background: NEUTRAL_BG }}>{REQ20_SERIES}</span>
                            )}
                            <input
                              value={String(r.seq || '')} inputMode="numeric" disabled={running}
                              aria-label="일련번호" placeholder="일련번호"
                              style={{ ...field, width: 72 }}
                              onChange={e => patchNo(r.id, { seq: Number(e.target.value.replace(/[^0-9]/g, '').slice(0, 5)) })}
                            />
                            {needsYear(r.type) && (
                              <input
                                value={String(r.year ?? '')} inputMode="numeric" disabled={running}
                                aria-label="연도" placeholder="연도"
                                style={{ ...field, width: 64 }}
                                onChange={e => patchNo(r.id, { year: Number(e.target.value.replace(/[^0-9]/g, '').slice(0, 4)) })}
                              />
                            )}
                            {r.type === 'spare80' && (
                              <input
                                type="date" value={r.numDate ?? ''} disabled={running}
                                aria-label="번호에 들어갈 날짜"
                                style={{ ...field, width: 130, colorScheme: 'light' }}
                                onChange={e => patchNo(r.id, { numDate: e.target.value })}
                              />
                            )}
                          </div>
                        </td>

                        <td style={{ ...td, fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {r.no || <span style={{ color: MUTED, fontWeight: 500 }}>—</span>}
                        </td>

                        <td style={td}>
                          <input value={r.title} maxLength={200} disabled={running} style={field}
                            onChange={e => patch(r.id, { title: e.target.value })} />
                          {/* 업체명을 읽어 적을 수 있게 첫 파일의 원래 이름을 보여 준다. */}
                          <div style={{ fontSize: 11, color: FAINT, marginTop: 3, wordBreak: 'break-all' }}>
                            {r.files[0]?.name ?? ''}
                          </div>
                        </td>

                        <td style={td}>
                          {r.dateLocked ? (
                            <span style={{ color: SUB }}>{r.issuedDate || '—'}<br />
                              <span style={{ fontSize: 11, color: FAINT }}>번호의 날짜</span></span>
                          ) : (
                            <input type="date" value={r.issuedDate} disabled={running}
                              style={{ ...field, colorScheme: 'light' }}
                              onChange={e => patch(r.id, { issuedDate: e.target.value })} />
                          )}
                        </td>

                        <td style={td}>
                          <select value={r.createdBy} disabled={running} style={field}
                            onChange={e => patch(r.id, { createdBy: e.target.value ? Number(e.target.value) : '' })}>
                            <option value="">고르기</option>
                            {selectable.map(e => (
                              <option key={e.engineer_id} value={e.engineer_id}>{engineerLabel(e)}</option>
                            ))}
                          </select>
                        </td>

                        <td style={td}>
                          {r.files.map((f, i) => {
                            const c = checkFile(f)
                            return (
                              <div key={`${f.name}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                                <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-all', color: c.error ? '#be123c' : TEXT }}>
                                  {f.name} <span style={{ color: MUTED }}>{sizeText(f.size)}</span>
                                  {c.error && <span style={{ color: '#be123c' }}> — {c.error}</span>}
                                  {!c.error && c.warn && <span style={{ color: MUTED }}> — {c.warn}</span>}
                                </span>
                                {!running && (
                                  <>
                                    {/* 다른 행으로 옮긴다. 파일이 0개가 된 행은 사라진다. */}
                                    <select
                                      value="" disabled={rows.length < 2}
                                      aria-label={`${f.name} 다른 행으로 이동`}
                                      style={{ ...field, width: 90, flexShrink: 0 }}
                                      onChange={e => { if (e.target.value) move(r.id, i, e.target.value) }}
                                    >
                                      <option value="">이동</option>
                                      {rows.filter(x => x.id !== r.id).map(x => (
                                        <option key={x.id} value={x.id}>{x.no || x.auto.no}</option>
                                      ))}
                                    </select>
                                    <button type="button" aria-label={`${f.name} 제외`}
                                      onClick={() => patch(r.id, { files: r.files.filter((_, k) => k !== i) })}
                                      style={{ border: 'none', background: 'transparent', color: MUTED, cursor: 'pointer', fontSize: 12, padding: 0, flexShrink: 0 }}>
                                      ✕
                                    </button>
                                  </>
                                )}
                              </div>
                            )
                          })}
                        </td>

                        <td style={td}>
                          {r.error ? <span style={{ color: '#be123c' }}>{r.error}</span>
                            : st?.s === 'running' ? '처리 중...'
                            : st?.s === 'done' ? <span style={{ color: BLUE, fontWeight: 700 }}>완료</span>
                            : st?.s === 'partial' ? (
                              <span style={{ color: '#be123c' }}>
                                <span title={failText(st.fails)}>번호는 등록됨, 파일 {st.fails.length}개 실패</span>
                                <button type="button" onClick={() => retryFiles(r)} disabled={running}
                                  style={{ ...btnGhost(running), display: 'block', marginTop: 4, padding: '3px 8px', fontSize: 11 }}>
                                  파일 다시 올리기
                                </button>
                              </span>
                            )
                            : st?.s === 'failed' ? <span style={{ color: '#be123c' }}>{st.reason}</span>
                            : r.existing === 'exists' ? (
                              <label style={{ display: 'flex', gap: 4, alignItems: 'flex-start', color: MUTED }}>
                                <input type="checkbox" checked={r.attachToExisting} disabled={running}
                                  onChange={e => patch(r.id, { attachToExisting: e.target.checked })} />
                                <span>이미 등록된 번호<br />
                                  <span style={{ fontSize: 11 }}>체크하면 파일만 추가</span></span>
                              </label>
                            )
                            : <span style={{ color: SUB }}>신규 등록</span>}
                          {r.warn && <div style={{ fontSize: 11, color: MUTED, marginTop: 3 }}>{r.warn}</div>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* 확인 필요·미분류 */}
            {pending.length > 0 && (
              <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: MUTED, marginBottom: 8 }}>
                  확인 필요 · 미분류 {pending.length}개
                  <span style={{ fontWeight: 500 }}> — 고르지 않은 파일은 등록에서 빠집니다</span>
                </div>
                {pending.map((p, i) => (
                  <div key={`${p.file.name}-${i}`} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
                    <span style={{ flex: '1 1 240px', minWidth: 0, fontSize: 12, wordBreak: 'break-all' }}>
                      {p.file.name}
                      {p.hits.length > 1 && (
                        <span style={{ color: MUTED }}> — 번호가 둘 이상({p.hits.map(h => hitToNo(h)).join(', ')})</span>
                      )}
                    </span>
                    <select value={p.choice} disabled={running} style={{ ...field, width: 200 }}
                      onChange={e => setPending(prev => prev.map((x, k) => (k === i ? { ...x, choice: e.target.value } : x)))}>
                      <option value="">고르기</option>
                      <option value="skip">제외</option>
                      <optgroup label="이 번호에 붙이기">
                        {rows.map(r => <option key={r.id} value={`row:${r.id}`}>{r.no || r.auto.no}</option>)}
                      </optgroup>
                      <option value="new">새 번호로 등록</option>
                    </select>
                    {p.choice === 'new' && (
                      <>
                        <select value={p.newType} disabled={running} style={{ ...field, width: 130 }}
                          onChange={e => setPending(prev => prev.map((x, k) => (k === i ? { ...x, newType: e.target.value as InquiryType } : x)))}>
                          <option value="">종류</option>
                          {INQUIRY_TYPE_ITEMS.map(t => <option key={t.type} value={t.type}>{t.label}</option>)}
                        </select>
                        {p.newType === 'req80' && (
                          <select value={p.newSeries} disabled={running} style={{ ...field, width: 80 }}
                            onChange={e => setPending(prev => prev.map((x, k) => (k === i ? { ...x, newSeries: e.target.value } : x)))}>
                            <option value="">계열</option>
                            {REQ80_SERIES.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        )}
                        <input value={p.newSeq} placeholder="일련번호" disabled={running} style={{ ...field, width: 90 }}
                          onChange={e => setPending(prev => prev.map((x, k) => (k === i ? { ...x, newSeq: e.target.value.replace(/[^0-9]/g, '').slice(0, 5) } : x)))} />
                      </>
                    )}
                  </div>
                ))}
                <button type="button" onClick={resolvePending} disabled={running}
                  style={{ ...btnGhost(running), marginTop: 4 }}>고른 대로 반영</button>
              </div>
            )}

            {/* 진행·요약 */}
            {(running || doneCount > 0) && (
              <div style={{ fontSize: 12, color: SUB, lineHeight: 1.7, marginBottom: 10 }}>
                진행 {doneCount} / {targets.length} · 완료 {counts.done} · 파일 일부 실패 {counts.partial} · 실패 {counts.failed}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" onClick={close} style={{ ...btnGhost(), flex: '0 0 auto' }}>닫기</button>
              {running ? (
                <button type="button" onClick={() => { stopRef.current = true }}
                  style={{ ...btnGhost(), marginLeft: 'auto' }}>중단</button>
              ) : (
                <>
                  {counts.failed > 0 && (
                    <button type="button" onClick={retryFailed} style={{ ...btnGhost(), marginLeft: 'auto' }}>
                      실패한 행만 다시 시도
                    </button>
                  )}
                  <button
                    type="button" onClick={start} disabled={checking || targets.length === 0}
                    style={{ ...btnPrimary(checking || targets.length === 0), marginLeft: counts.failed > 0 ? 0 : 'auto' }}
                  >
                    {targets.length}건 등록
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </ModalOverlay>
  )
}
