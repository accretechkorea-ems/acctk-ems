'use client'

// 가격표 등록 모달 — /admin 의 「가격표 등록」 카드가 연다.
//
// ── 크기를 고정한다 ─────────────────────────────────────────────────────────
//   폭 1,100 · 높이 85vh. 시트가 둘일 때와 아홉일 때 모달이 늘었다 줄었다 하면
//   눈이 따라가지 못한다. **가운데 시트 표만 스크롤**하고 머리·바닥은 제자리에 있다.
//
// ── 흐름 ────────────────────────────────────────────────────────────────────
//   ① 큰 버튼 둘(80 / 20) → 그 아래로 드롭존이 펼쳐진다
//   ② 파일을 놓으면 바로 모든 시트를 읽어 표에 띄운다
//   ③ 등록 → 시트마다 따로 적용하고 그 자리에서 결과로 바뀐다
//
// 상태는 usePriceListImport, 엑셀 읽기는 priceListImport.ts, 표는 PriceListSheetTable 이 한다.
// 권한은 서버가 다시 본다(app/api/price-list-import/route.ts). 버튼 잠금은 거들기일 뿐이다.

import { useState } from 'react'
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
import PriceListDropZone from './PriceListDropZone'
import PriceListLatest from './PriceListLatest'
import { usePriceListImport } from './usePriceListImport'

export type PriceListImportModalProps = {
  onClose: () => void
  /** superadmin 인가. 아니면 버튼을 잠근다(실제 통제는 서버가 한다). */
  canEdit: boolean
}

const num = (n: number) => n.toLocaleString('ko-KR')

/** 두 버튼 — 이 선택이 행의 line 이 되고, 견적 검색에서 20/80 을 가르는 값이 된다. */
const LINE_CHOICES: readonly { line: PriceLine; label: string; note: string }[] = [
  { line: '80', label: '80 Price List 등록', note: '본사 Price list · 80 파츠·80 장비 견적서' },
  { line: '20', label: '20 Price List 등록', note: 'Transaction Price list · 20 견적서' },
]

export default function PriceListImportModal({ onClose, canEdit }: PriceListImportModalProps) {
  const toast = useToast()
  const confirmDialog = useConfirm()
  const [showHistory, setShowHistory] = useState(false)
  const c = usePriceListImport()

  const locked = !canEdit || c.busy
  const lockMsg = canEdit ? undefined : '가격표는 슈퍼관리자만 등록할 수 있습니다'

  const handleApply = async () => {
    const names = c.planned.map(s => s.parse.sheetName)
    const ok = await confirmDialog({
      title: '가격표를 등록할까요?',
      message:
        `${c.line} Price List · 시트 ${names.length}개 · ${num(c.totals.registered)}건을 등록합니다.\n`
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

  const showResult = c.outcomes.length > 0

  return (
    <ModalOverlay onClose={onClose}>
      <div
        style={{
          background: CARD_BG, borderRadius: 18, width: '100%', maxWidth: 1100,
          // 크기 고정 — 내용이 늘어도 모달은 그대로 있고 가운데만 스크롤한다.
          height: '85vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.22)', overflow: 'hidden',
        }}
      >
        {/* ══ 머리(고정) ══ */}
        <div style={{ padding: '20px 24px 14px', borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: TEXT }}>가격표 등록</div>
            <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: '50%', background: NEUTRAL_BG, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: SUB }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>

          {/* 큰 버튼 둘 — 가로로 나란히. 누르면 아래 드롭존이 펼쳐진다. */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {LINE_CHOICES.map(ch => {
              const on = c.line === ch.line
              return (
                <button
                  key={ch.line}
                  // 같은 버튼을 다시 눌러도 고른 파일을 날리지 않는다.
                  // 다른 버튼으로 바꾸면 파일은 비운다 — 80 파일을 20 으로 읽으면 안 된다.
                  onClick={() => { if (c.line !== ch.line) c.chooseLine(ch.line) }}
                  disabled={locked}
                  title={lockMsg ?? ch.note}
                  aria-pressed={on}
                  style={{
                    padding: '14px 16px', borderRadius: 10, textAlign: 'left',
                    cursor: locked ? 'not-allowed' : 'pointer',
                    border: `1px solid ${on ? '#c7d7f8' : BORDER}`,
                    background: on ? NEUTRAL_BG : CARD_BG,
                    boxShadow: on ? 'inset 0 1px 2px rgba(0,0,0,0.06)' : 'none',
                    transition: 'background 0.15s ease, border-color 0.15s ease',
                  }}
                >
                  <span style={{ display: 'block', fontSize: 15, fontWeight: 800, color: on ? BLUE : TEXT }}>
                    {ch.label}
                  </span>
                  <span style={{ display: 'block', fontSize: 11, fontWeight: 500, color: MUTED, marginTop: 3 }}>
                    {ch.note}
                  </span>
                </button>
              )
            })}
          </div>

          <PriceListDropZone
            open={c.line !== null}
            disabled={locked}
            fileName={c.fileName}
            fileSize={c.fileSize}
            busy={c.busy && !c.progress}
            onFile={f => void c.chooseFile(f)}
            onClear={c.clearFile}
          />

          {c.error && (
            <div style={{ marginTop: 10, border: `1px solid ${DANGER}`, borderRadius: 8, padding: '8px 12px', fontSize: 12, color: DANGER, lineHeight: 1.7 }}>
              {c.error}
            </div>
          )}
        </div>

        {/* ══ 가운데(여기만 스크롤) ══ */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 24px' }}>
          {c.sheets.length === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 12, color: FAINT, padding: '18px 0', textAlign: 'center' }}>
                {c.line === null ? '위에서 80 / 20 을 고르세요.' : '파일을 올리면 시트별로 무엇이 등록될지 보여 드립니다.'}
              </div>
              {c.line !== null && <PriceListHeaderGuide />}
            </div>
          )}

          {c.sheets.length > 0 && (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: TEXT }}>
                  시트별 {showResult ? '결과' : '미리보기'}
                </span>
                <span style={{ fontSize: 11, fontWeight: 500, color: MUTED }}>
                  {`${c.line} Price List · 시트 ${num(c.totals.sheets)}개 중 ${num(c.totals.planned)}개 등록 예정`}
                </span>
              </div>
              <PriceListSheetTable sheets={c.sheets} outcomes={c.outcomes} />

              {showResult && !c.progress && (
                <div style={{ marginTop: 10, fontSize: 12, color: SUB, lineHeight: 1.7 }}>
                  등록을 마쳤습니다. 파일에 없던 기존 품목은 그대로 남아 있고, 지난 견적의 금액은 바뀌지 않았습니다.
                  {c.resultTotals.failed > 0 && ' 실패한 시트는 아무것도 바뀌지 않았습니다 — 고쳐서 다시 올리면 됩니다.'}
                </div>
              )}

              <div style={{ marginTop: 14 }}>
                <PriceListHeaderGuide />
              </div>
            </>
          )}

          {/* 지금 등록된 파일 — 이력 버튼 바로 위. */}
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <PriceListLatest latest={c.latest} loading={c.historyLoading} />
            <div>
              <button
                onClick={() => setShowHistory(v => !v)}
                style={{ fontSize: 13, fontWeight: 800, color: TEXT, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
              >
                최근 등록 이력 {showHistory ? '▾' : '▸'}
              </button>
              {showHistory && (
                <div style={{ marginTop: 6 }}>
                  <PriceListHistory rows={c.history} loading={c.historyLoading} />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ══ 바닥(고정) — 합계와 버튼 ══ */}
        <div style={{ borderTop: `1px solid ${BORDER}`, padding: '12px 24px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            {c.sheets.length > 0 && (
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {!showResult ? (
                  <>
                    <Sum label="등록 대상" value={num(c.totals.registered)} accent />
                    <Sum label="품목 줄" value={num(c.totals.itemRows)} />
                    <Sum label="구입가 없어 제외" value={num(c.totals.noCost)} />
                    <Sum label="묶음 제목" value={num(c.totals.sections)} />
                    <Sum label="건너뜀 시트" value={num(c.totals.skipped)} />
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
            )}
            <span style={{ flex: 1, minWidth: 20 }} />
            <span style={{ fontSize: 11, fontWeight: 500, color: c.progress ? BLUE : MUTED, lineHeight: 1.6, maxWidth: 360 }}>
              {c.progress
                ? `${c.progress.done + 1}/${c.progress.total} ${c.progress.sheetName} 등록 중…`
                : c.blockReason}
            </span>
            <button onClick={onClose} style={btnGhost(false)}>닫기</button>
            <button
              onClick={() => void handleApply()}
              disabled={locked || c.blockReason !== ''}
              title={lockMsg}
              style={btnPrimary(locked || c.blockReason !== '')}
            >
              {showResult ? '다시 등록' : '등록'}
            </button>
          </div>
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
