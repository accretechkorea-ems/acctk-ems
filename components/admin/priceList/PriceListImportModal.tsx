'use client'

// 가격표 등록 모달 — /admin 의 「가격표 등록」 카드가 연다.
//
// 흐름: ① 종류 고르기 ② 엑셀 고르기 ③ 미리보기 ④ 확인 ⑤ 결과.
// 상태는 usePriceListImport, 엑셀 읽기는 priceListImport.ts, 표 그리기는 PriceListPreview 가 한다.
//
// ── 맨 위 설명문을 반드시 둔다 ──────────────────────────────────────────────
//   반년에 한 번 쓰는 화면이고 그때 담당자가 바뀌어 있을 수 있다. 화면만 보고 따라 할 수 있어야
//   한다 — 무엇을 올리는지, 올리면 무엇이 바뀌고 무엇이 그대로인지, 어느 값이 필수인지.
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
import { kindsForLine } from '@/lib/priceListKinds'
import type { PriceLine, PriceListKind } from '@/lib/priceListKinds'
import PriceListPreview from './PriceListPreview'
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

/** 종류 묶음 — 어느 견적 양식이 쓰는 가격표인지 제목에 적어 둔다. */
const LINE_GROUPS: readonly { line: PriceLine; title: string; note: string }[] = [
  { line: '80', title: '80 가격표', note: '80 파츠·80 장비 견적서가 쓴다 (본사 Price list)' },
  { line: '20', title: '20 가격표', note: '20 견적서가 쓴다 (Transaction Price list)' },
]

export default function PriceListImportModal({ onClose, canEdit }: PriceListImportModalProps) {
  const toast = useToast()
  const confirmDialog = useConfirm()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [showHistory, setShowHistory] = useState(true)
  const c = usePriceListImport()

  const locked = !canEdit || c.busy
  const lockMsg = canEdit ? undefined : '가격표는 슈퍼관리자만 등록할 수 있습니다'

  const pick = (kind: PriceListKind) => {
    if (c.busy) return
    c.chooseKind(c.kind?.sheet === kind.sheet ? null : kind)
    if (fileRef.current) fileRef.current.value = ''
  }

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) void c.chooseFile(f)
  }

  const handleApply = async () => {
    if (!c.kind || !c.parse) return
    const n = c.parse.rows.length
    const ok = await confirmDialog({
      title: '가격표를 등록할까요?',
      message:
        `${c.kind.sheet} · ${num(n)}건을 등록합니다.\n`
        + `같은 품번은 덮어쓰고, 파일에 없는 품목은 그대로 남습니다`
        + (c.counts ? ` (그대로 남는 품목 ${num(c.counts.kept)}건).` : '.')
        + '\n지난 견적의 금액은 바뀌지 않습니다.',
      confirmText: '등록',
    })
    if (!ok) return
    const err = await c.apply()
    if (err) toast.error(err)
    else toast.success('가격표를 등록했습니다')
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div style={{ background: CARD_BG, borderRadius: 18, padding: 24, width: '100%', maxWidth: 860, maxHeight: '86vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.22)' }}>
        {/* ── 머리 ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: TEXT }}>가격표 등록</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: '50%', background: NEUTRAL_BG, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: SUB }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {/* ── 설명문 ── */}
        <div style={{ fontSize: 12, color: SUB, lineHeight: 1.8, marginBottom: 16, background: NEUTRAL_BG, borderRadius: 8, padding: '12px 14px' }}>
          본사에서 온 <b style={{ color: TEXT }}>가격표 엑셀</b>을 종류(시트) 하나씩 올립니다. 여러 시트가 든 통파일도 됩니다 — 고른 종류와 같은 이름의 시트를 자동으로 읽습니다.
          <br />· <b style={{ color: TEXT }}>필수는 품번과 구입가(Net price)</b>입니다. 정가(List price)는 없어도 등록됩니다.
          <br />· 구입가가 없는 줄은 <b style={{ color: TEXT }}>등록하지 않고</b> 미리보기에 건수로 보여 줍니다.
          <br />· 같은 종류의 같은 품번은 <b style={{ color: TEXT }}>덮어씁니다.</b> 파일에 없는 기존 품목은 <b style={{ color: TEXT }}>그대로 남습니다</b>(지우지 않습니다).
          <br />· 다른 종류의 품목은 건드리지 않습니다. 80 가격표의 납기·재고처럼 손으로 넣은 값도 그대로 둡니다.
          <br />· <b style={{ color: TEXT }}>20 가격표</b>는 거래가격표(TRANSACTION PRICE)를 읽습니다. 묶음 제목 줄(「[이름]」)은 품목이 아니라 묶음으로 읽고, 납기(「1.0 month」)는 주로 환산합니다.
          <br />· <b style={{ color: TEXT }}>이미 저장된 견적의 금액은 바뀌지 않습니다</b> — 견적은 저장할 때의 가격을 자기 안에 복사해 둡니다.
          <br />· 미리보기에서 <b style={{ color: TEXT }}>무엇이 바뀌는지 확인한 뒤</b> 등록하세요. 등록은 한 번에 전부 적용되거나 전부 취소됩니다.
        </div>

        <div style={{ overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* ── ① 종류 ── 80 가격표와 20 가격표를 나눠 보여 준다(쓰는 견적 양식이 다르다) */}
          <div>
            <div style={sectionTitle}>① 종류 고르기</div>
            {LINE_GROUPS.map(g => (
              <div key={g.line} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, marginBottom: 6 }}>
                  {g.title}
                  <span style={{ fontWeight: 500, color: FAINT }}>{` · ${g.note}`}</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {kindsForLine(g.line).map(k => {
                    const on = c.kind?.sheet === k.sheet
                    return (
                      <button
                        key={k.sheet}
                        onClick={() => pick(k)}
                        disabled={locked}
                        title={lockMsg ?? k.hint}
                        style={{
                          padding: '8px 12px', borderRadius: 8, cursor: locked ? 'not-allowed' : 'pointer',
                          border: `1px solid ${on ? '#c7d7f8' : BORDER}`,
                          background: on ? NEUTRAL_BG : CARD_BG, textAlign: 'left',
                        }}
                      >
                        <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: on ? BLUE : TEXT }}>{k.sheet}</span>
                        <span style={{ display: 'block', fontSize: 11, fontWeight: 500, color: MUTED, marginTop: 2 }}>{k.hint}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* ── 머리글 규칙 안내 ── 종류를 고른 뒤에 보인다. 열을 못 찾았으면 펼친 채로. */}
          {c.kind && (
            <PriceListHeaderGuide
              key={c.kind.sheet + (c.headerFailed ? ':open' : '')}
              defaultOpen={c.headerFailed}
            />
          )}

          {/* ── ② 파일 ── */}
          <div>
            <div style={sectionTitle}>② 엑셀 파일 고르기</div>
            {!c.kind && <div style={{ fontSize: 12, color: FAINT }}>종류를 먼저 고르세요.</div>}
            {c.kind && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={onFile}
                  disabled={locked}
                  style={{ fontSize: 12, color: SUB }}
                />
                {c.fileName && (
                  <button onClick={() => { c.clearFile(); if (fileRef.current) fileRef.current.value = '' }} style={btnGhost(c.busy)} disabled={c.busy}>
                    파일 비우기
                  </button>
                )}
                {c.busy && <span style={{ fontSize: 12, color: MUTED }}>읽는 중…</span>}
              </div>
            )}
          </div>

          {/* ── ③ 미리보기 ── */}
          {c.error && !c.parse && (
            <div style={{ border: `1px solid ${DANGER}`, borderRadius: 8, padding: '10px 12px', fontSize: 12, color: DANGER, lineHeight: 1.7 }}>
              {c.error}
            </div>
          )}
          {c.parse && (
            <div>
              <div style={sectionTitle}>③ 미리보기</div>
              <PriceListPreview
                parse={c.parse}
                sheetNote={c.sheetNote}
                counts={c.counts}
                changes={c.changes}
                bytes={c.bytes}
              />
              {c.error && (
                <div style={{ marginTop: 10, border: `1px solid ${DANGER}`, borderRadius: 8, padding: '10px 12px', fontSize: 12, color: DANGER, lineHeight: 1.7 }}>
                  {c.error}
                  <br />아무것도 바뀌지 않았습니다.
                </div>
              )}
            </div>
          )}

          {/* ── ⑤ 결과 ── */}
          {c.result && (
            <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: TEXT, marginBottom: 6 }}>등록을 마쳤습니다</div>
              <div style={{ fontSize: 12, color: SUB, lineHeight: 1.8 }}>
                {c.result.sheet_name} · 받은 줄 {num(c.result.received)}건
                <br />새로 들어간 품목 <b style={{ color: TEXT }}>{num(c.result.inserted)}</b>건 ·
                {' '}값이 달라 덮어쓴 품목 <b style={{ color: TEXT }}>{num(c.result.updated)}</b>건 ·
                {' '}이미 같아서 그대로 둔 품목 {num(c.result.unchanged)}건
                <br />구입가가 없어 제외한 줄 {num(c.result.skipped)}건 · 값이 같아 합친 중복 {num(c.result.merged)}건
                <br />파일에 없던 기존 품목은 그대로 남아 있습니다. 지난 견적의 금액은 바뀌지 않았습니다.
              </div>
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
            {c.blockReason || (c.parse ? `${c.kind?.sheet} · ${num(c.parse.rows.length)}건을 등록합니다.` : '')}
          </span>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={btnGhost(false)}>닫기</button>
          <button
            onClick={() => void handleApply()}
            disabled={locked || c.blockReason !== ''}
            title={lockMsg}
            style={btnPrimary(locked || c.blockReason !== '')}
          >
            {c.result ? '다시 등록' : '등록'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}
