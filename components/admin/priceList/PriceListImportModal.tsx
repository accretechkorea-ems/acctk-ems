'use client'

// 가격표 등록 모달 — /admin 의 「가격표 등록」 카드가 연다.
//
// 흐름: ① 80/20 고르기 ② 엑셀 파일 고르기 ③ 시트별 미리보기 ④ 확인 ⑤ 시트별 결과.
// 상태는 usePriceListImport, 엑셀 읽기는 priceListImport.ts, 표는 PriceListSheetTable 이 한다.
//
// ── 종류를 고르지 않는다 ────────────────────────────────────────────────────
//   예전에는 종류(시트) 열넷 중 하나를 골라 그 시트만 올렸다. 고르는 일이 곧 실수였다.
//   지금은 **80/20 만 고르고 파일을 통째로** 올린다 — 시트 이름은 엑셀이 들고 있고,
//   가격표 시트가 아닌 것(개정 이력·판촉)은 머리글이 없어 저절로 건너뛴다.
//
// 권한은 서버가 다시 본다(app/api/price-list-import/route.ts). 버튼 잠금은 거들기일 뿐이다.

import { useRef, useState } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import { useToast } from '@/components/common/Toast'
import { useConfirm } from '@/components/common/ConfirmDialog'
import {
  BLUE, BORDER, CARD_BG, DANGER, FAINT, MUTED, NEUTRAL_BG, SUB, TEXT,
  btnGhost, btnPrimary,
} from '@/components/common/ui'
import type { PriceLine } from '@/lib/priceListKinds'
import PriceListSheetTable from './PriceListSheetTable'
import PriceListHeaderGuide from './PriceListHeaderGuide'
import PriceListHistory from './PriceListHistory'
import { usePriceListImport } from './usePriceListImport'

export type PriceListImportModalProps = {
  onClose: () => void
  /** superadmin 인가. 아니면 버튼을 잠근다(실제 통제는 서버가 한다). */
  canEdit: boolean
}

const num = (n: number) => n.toLocaleString('ko-KR')
const sectionTitle: React.CSSProperties = { fontSize: 13, fontWeight: 800, color: TEXT, marginBottom: 8 }

/** 두 버튼 — 이 선택이 행의 line 이 되고, 견적 검색에서 20/80 을 가르는 값이 된다. */
const LINE_CHOICES: readonly { line: PriceLine; label: string; note: string }[] = [
  { line: '80', label: '80 가격표 등록', note: '본사 Price list · 80 파츠·80 장비 견적서가 쓴다' },
  { line: '20', label: '20 가격표 등록', note: 'Transaction Price list · 20 견적서가 쓴다' },
]

export default function PriceListImportModal({ onClose, canEdit }: PriceListImportModalProps) {
  const toast = useToast()
  const confirmDialog = useConfirm()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const c = usePriceListImport()

  const locked = !canEdit || c.busy
  const lockMsg = canEdit ? undefined : '가격표는 슈퍼관리자만 등록할 수 있습니다'

  const pickLine = (line: PriceLine) => {
    if (c.busy) return
    c.chooseLine(c.line === line ? null : line)
    if (fileRef.current) fileRef.current.value = ''
  }

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) void c.chooseFile(f)
  }

  const handleApply = async () => {
    const names = c.planned.map(s => s.parse.sheetName)
    const ok = await confirmDialog({
      title: '가격표를 등록할까요?',
      message:
        `${c.line} 가격표 · 시트 ${names.length}개 · ${num(c.totals.registered)}건을 등록합니다.\n`
        + `${names.join(' / ')}\n\n`
        + '같은 품번은 덮어쓰고, 파일에 없는 품목은 그대로 남습니다.\n'
        + '시트마다 따로 적용되므로 한 시트가 실패해도 나머지는 그대로 들어갑니다.\n'
        + '지난 견적의 금액은 바뀌지 않습니다.',
      confirmText: '등록',
    })
    if (!ok) return
    const done = await c.apply()
    const failed = done.filter(d => !d.ok).length
    if (failed === 0) toast.success(`${done.length}개 시트를 등록했습니다`)
    else toast.error(`${failed}개 시트가 실패했습니다 — 표에서 이유를 확인해 주세요`)
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div style={{ background: CARD_BG, borderRadius: 18, padding: 24, width: '100%', maxWidth: 900, maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.22)' }}>
        {/* ── 머리 ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: TEXT }}>가격표 등록</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: '50%', background: NEUTRAL_BG, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: SUB }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {/* ── 안내문 하나 ── */}
        <div style={{ fontSize: 12, color: SUB, lineHeight: 1.8, marginBottom: 14, background: NEUTRAL_BG, borderRadius: 8, padding: '12px 14px' }}>
          머리글을 <b style={{ color: TEXT }}>품번 / 품명 / 모델 / 정가 / 구입가 / 납기 / 비고</b> 로 맞춰 올리세요.
          <b style={{ color: TEXT }}> 품번·구입가는 필수</b>, 나머지는 선택입니다. <b style={{ color: TEXT }}>■ 섹션 줄은 지우지 마세요.</b>
          <br />파일을 통째로 올리면 모든 시트를 한 번에 등록합니다 — 가격표가 아닌 시트(개정 이력 등)는 저절로 건너뜁니다.
          <br />같은 품번은 덮어쓰고, 파일에 없는 품목과 <b style={{ color: TEXT }}>이미 저장된 견적의 금액은 그대로</b> 둡니다.
        </div>

        <div style={{ overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* ── ① 80 / 20 ── */}
          <div>
            <div style={sectionTitle}>① 어느 가격표인가</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {LINE_CHOICES.map(ch => {
                const on = c.line === ch.line
                return (
                  <button
                    key={ch.line}
                    onClick={() => pickLine(ch.line)}
                    disabled={locked}
                    title={lockMsg ?? ch.note}
                    style={{
                      padding: '10px 14px', borderRadius: 8, cursor: locked ? 'not-allowed' : 'pointer',
                      border: `1px solid ${on ? '#c7d7f8' : BORDER}`,
                      background: on ? NEUTRAL_BG : CARD_BG, textAlign: 'left', minWidth: 240,
                    }}
                  >
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: on ? BLUE : TEXT }}>{ch.label}</span>
                    <span style={{ display: 'block', fontSize: 11, fontWeight: 500, color: MUTED, marginTop: 2 }}>{ch.note}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* ── 머리글 규칙 안내 ── */}
          {c.line && <PriceListHeaderGuide />}

          {/* ── ② 파일 ── */}
          <div>
            <div style={sectionTitle}>② 엑셀 파일 고르기</div>
            {!c.line && <div style={{ fontSize: 12, color: FAINT }}>80 / 20 을 먼저 고르세요.</div>}
            {c.line && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={onFile} disabled={locked} style={{ fontSize: 12, color: SUB }} />
                {c.fileName && (
                  <button onClick={() => { c.clearFile(); if (fileRef.current) fileRef.current.value = '' }} style={btnGhost(c.busy)} disabled={c.busy}>
                    파일 비우기
                  </button>
                )}
                {c.busy && !c.progress && <span style={{ fontSize: 12, color: MUTED }}>읽는 중…</span>}
              </div>
            )}
          </div>

          {c.error && (
            <div style={{ border: `1px solid ${DANGER}`, borderRadius: 8, padding: '10px 12px', fontSize: 12, color: DANGER, lineHeight: 1.7 }}>
              {c.error}
            </div>
          )}

          {/* ── ③ 시트별 미리보기 · 결과 ── */}
          {c.sheets.length > 0 && (
            <div>
              <div style={sectionTitle}>
                ③ 시트별 {c.outcomes.length > 0 ? '결과' : '미리보기'}
              </div>

              {/* 합계 — 맨 위에 */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, padding: '10px 12px', border: `1px solid ${BORDER}`, borderRadius: 8, marginBottom: 10 }}>
                {c.outcomes.length === 0 ? (
                  <>
                    <Sum label="시트" value={`${num(c.totals.planned)} / ${num(c.totals.sheets)}`} />
                    <Sum label="등록 대상" value={num(c.totals.registered)} accent />
                    <Sum label="품목 줄" value={num(c.totals.itemRows)} />
                    <Sum label="구입가 없어 제외" value={num(c.totals.noCost)} />
                    <Sum label="묶음 제목" value={num(c.totals.sections)} />
                    <Sum label="건너뜀" value={num(c.totals.skipped)} />
                  </>
                ) : (
                  <>
                    <Sum label="신규" value={num(c.resultTotals.inserted)} accent />
                    <Sum label="변경" value={num(c.resultTotals.updated)} />
                    <Sum label="동일" value={num(c.resultTotals.unchanged)} />
                    <Sum label="제외" value={num(c.resultTotals.skipped)} />
                    <Sum label="실패 시트" value={num(c.resultTotals.failed)} danger={c.resultTotals.failed > 0} />
                  </>
                )}
              </div>

              <PriceListSheetTable sheets={c.sheets} outcomes={c.outcomes} />

              {c.progress && (
                <div style={{ marginTop: 10, fontSize: 12, fontWeight: 600, color: BLUE }}>
                  {`${c.progress.done + 1}/${c.progress.total} ${c.progress.sheetName} 등록 중…`}
                </div>
              )}
              {c.outcomes.length > 0 && !c.progress && (
                <div style={{ marginTop: 10, fontSize: 12, color: SUB, lineHeight: 1.7 }}>
                  등록을 마쳤습니다. 파일에 없던 기존 품목은 그대로 남아 있고, 지난 견적의 금액은 바뀌지 않았습니다.
                  {c.resultTotals.failed > 0 && ' 실패한 시트는 아무것도 바뀌지 않았습니다 — 고쳐서 다시 올리면 됩니다.'}
                </div>
              )}
            </div>
          )}

          {/* ── 이력 ── */}
          <div>
            <button
              onClick={() => setShowHistory(v => !v)}
              style={{ ...sectionTitle, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
            >
              최근 등록 이력 {showHistory ? '▾' : '▸'}
            </button>
            {showHistory && <PriceListHistory rows={c.history} loading={c.historyLoading} />}
          </div>
        </div>

        {/* ── 바닥 ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 16, marginTop: 4, borderTop: `1px solid ${BORDER}` }}>
          <span style={{ fontSize: 11, fontWeight: 500, color: MUTED, lineHeight: 1.6 }}>
            {c.blockReason || `${c.line} 가격표 · 시트 ${num(c.totals.planned)}개 · ${num(c.totals.registered)}건을 등록합니다.`}
          </span>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={btnGhost(false)}>닫기</button>
          <button
            onClick={() => void handleApply()}
            disabled={locked || c.blockReason !== ''}
            title={lockMsg}
            style={btnPrimary(locked || c.blockReason !== '')}
          >
            {c.outcomes.length > 0 ? '다시 등록' : '등록'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

/** 합계 한 칸. */
function Sum({ label, value, accent, danger }: { label: string; value: string; accent?: boolean; danger?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: MUTED }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: danger ? DANGER : accent ? BLUE : TEXT }}>{value}</div>
    </div>
  )
}
