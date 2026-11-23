'use client'

// 엑셀 내보내기 — **단위를 고르는 창** (2026-11-22).
//
// ── 왜 창인가 ──────────────────────────────────────────────────────────────
//   전에는 단추를 누르면 바로 네 시트짜리 파일이 내려왔다. 받는 사람은 그 중 한 장만
//   쓰는데 나머지가 늘 따라왔고, 「사업장」 한 장이 장비 줄로 펴져 있어 사업장을 세려면
//   눈으로 묶어야 했다. 이제 **무엇을 한 줄로 볼지** 먼저 고르고, 그 시트 하나만 받는다.
//
// ── 창이 말해 주는 것 ──────────────────────────────────────────────────────
//   · 단위 넷 — 각 줄 아래에 **어떤 열이 나오는지** 한 줄로 적는다.
//     고를 수 있는 단위는 **지금 보고 있는 탭**이 정한다(lib/customerExportSheets.ts
//     의 unitsForTab) — 회사 탭은 회사·사업장·장비, 대리점 탭은 대리점,
//     정리 필요 탭은 사업장 하나다.
//   · 담당자 열 포함 — 끄면 맨 오른쪽 5×N 열이 통째로 빠진다.
//   · 회색 띠 — 지금 걸린 필터 요약 · 조건 일치 N곳 · **예상 N줄**.
//     예상 줄 수는 서버가 **파일과 같은 함수**로 센 값이다(창이 따로 세지 않는다 —
//     두 군데에서 세면 언젠가 어긋난다). 창이 열릴 때 한 번 받아 네 단위를 다 들고 있다.
//   · 바닥 — 파일 이름 미리보기 · 취소 · 다운로드.
//
// 생김새는 공용 카드(ModalCard)와 토큰을 따른다. 기준 보드의 파랑(#1e40af)·틴트(#eff6ff)는
// 디자인 표에 없는 값이라 표의 액센트(#234ea2)·브랜드 틴트(#eff4ff)·블루 보더(#c7d7f8)를 썼다.

import { useState } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import ModalCard, { keepPads } from '@/components/common/ModalCard'
import { R } from '@/lib/radius'
import {
  UNIT_DESC, UNIT_LABEL, customerExportFileName, defaultUnitForTab, unitsForTab,
  type ExportTab, type ExportUnit,
} from '@/lib/customerExportSheets'

// 색은 공용 한 벌에서 온다(components/common/ui.ts) — 같은 값을 창마다 적지 않는다.
import { BAND_BG, BLUE, BLUE_BORDER, BLUE_TINT, BORDER, CARD_BG, MUTED, SUB, TEXT } from '@/components/common/ui'

export type ExportModalProps = {
  /** 지금 보고 있는 탭 — 고를 수 있는 단위를 정한다. */
  tab: ExportTab
  /** 지금 걸린 필터 요약 한 줄(없으면 「조건 없음」). */
  filterText: string
  /** 조건 일치 사업장 수 — 띠에 적는다. */
  siteCount: number
  /** 단위별 예상 줄 수. 아직 못 받았으면 null. */
  counts: Record<ExportUnit, number> | null
  /** 내려받는 중인가. */
  busy: boolean
  onClose: () => void
  onDownload: (unit: ExportUnit, withContacts: boolean) => void
}

export default function ExportModal({
  tab, filterText, siteCount, counts, busy, onClose, onDownload,
}: ExportModalProps) {
  const units = unitsForTab(tab)
  const [picked, setPicked] = useState<ExportUnit>(() => defaultUnitForTab(tab))
  const [withContacts, setWithContacts] = useState(true)
  // 고른 것이 이 탭에 없으면 기본값으로 읽는다(창이 떠 있는 동안 탭이 바뀌지는 않지만,
  // 상태를 고쳐 맞추는 대신 **읽을 때 바로잡는다** — 효과 안에서 상태를 바꾸지 않는다).
  const unit = units.includes(picked) ? picked : defaultUnitForTab(tab)
  const setUnit = setPicked

  // 회사 단위에는 담당자 열이 없다(사람이 회사 줄에 달리지 않는다) — 체크칸을 잠근다.
  const contactsAvailable = unit !== 'company'
  const rows = counts?.[unit] ?? null

  return (
    <ModalOverlay onClose={busy ? () => {} : onClose} closeOn={busy ? 'none' : 'both'}>
      {/* 머리줄 고정 / 본문 / 바닥줄 고정은 공용 카드가 든다. 여백은 보드 값 그대로. */}
      <ModalCard
        width={480}
        closeX
        {...keepPads({ x: 20, top: 16, bottom: 14 }, 16, 0)}
        headStyle={{ alignItems: 'center', padding: '16px 20px', borderBottom: `1px solid ${BORDER}` }}
        bodyStyle={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}
        footStyle={{ padding: '14px 20px', borderTop: `1px solid ${BORDER}`, background: BAND_BG }}
        title={<><span style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>엑셀 내보내기</span></>}
        footer={<>
          <span style={{ fontSize: 12, color: MUTED, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {customerExportFileName(unit)}
          </span>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose} disabled={busy}
            style={{
              height: 34, padding: '0 12px', borderRadius: R.control, border: `1px solid ${BORDER}`,
              background: CARD_BG, color: SUB, fontSize: 13, fontWeight: 600,
              cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit', flexShrink: 0,
            }}>
            취소
          </button>
          <button type="button" onClick={() => onDownload(unit, withContacts && contactsAvailable)} disabled={busy}
            style={{
              height: 34, padding: '0 14px', borderRadius: R.control, border: 'none',
              background: BLUE, color: CARD_BG, fontSize: 13, fontWeight: 700,
              cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1,
              fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0,
            }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v3h16v-3" />
            </svg>
            {busy ? '만드는 중…' : '다운로드'}
          </button>
        </>}
      >
        {/* ── 단위 ── */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: SUB, marginBottom: 8 }}>단위</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {units.map(u => {
              const on = u === unit
              return (
                <label key={u}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px',
                    border: `1px solid ${on ? BLUE_BORDER : BORDER}`, borderRadius: R.control,
                    background: on ? BLUE_TINT : CARD_BG, cursor: 'pointer',
                  }}>
                  <input type="radio" name="export-unit" checked={on} onChange={() => setUnit(u)}
                    style={{ marginTop: 3, accentColor: BLUE }} />
                  <span style={{ minWidth: 0 }}>
                    <b style={{ fontSize: 13, fontWeight: 700, color: on ? BLUE : TEXT }}>{UNIT_LABEL[u]}</b>
                    <span style={{ display: 'block', fontSize: 12, color: SUB, marginTop: 2, lineHeight: 1.5 }}>
                      {UNIT_DESC[u]}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>
        </div>

        {/* ── 담당자 열 ── */}
        <label style={{
          display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
          color: contactsAvailable ? TEXT : MUTED, cursor: contactsAvailable ? 'pointer' : 'default',
        }}>
          <input type="checkbox" checked={withContacts && contactsAvailable} disabled={!contactsAvailable}
            onChange={e => setWithContacts(e.target.checked)} style={{ accentColor: BLUE }} />
          담당자 열 포함
          <span style={{ fontSize: 12, color: MUTED }}>
            {contactsAvailable
              ? '(맨 오른쪽, 담당자1·2… 이름/직급/부서/전화/이메일)'
              : '(회사 단위에는 담당자 열이 없습니다)'}
          </span>
        </label>

        {/* ── 지금 조건 ── */}
        <div style={{
          padding: '10px 12px', borderRadius: R.control, background: BAND_BG,
          border: `1px solid ${BORDER}`, fontSize: 12, color: SUB,
          display: 'flex', gap: 14, flexWrap: 'wrap',
        }}>
          <span>지금 조건 <b style={{ color: TEXT, fontWeight: 700 }}>{filterText}</b></span>
          <span>사업장 <b className="num" style={{ color: TEXT, fontWeight: 700 }}>{siteCount.toLocaleString('ko-KR')}</b>곳</span>
          <span>
            예상{' '}
            <b className="num" style={{ color: TEXT, fontWeight: 700 }}>
              {rows == null ? '세는 중…' : rows.toLocaleString('ko-KR')}
            </b>
            {rows == null ? '' : '줄'}
          </span>
        </div>
      </ModalCard>
    </ModalOverlay>
  )
}
