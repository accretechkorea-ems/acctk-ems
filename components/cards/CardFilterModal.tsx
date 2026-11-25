'use client'

/**
 * 명함 **필터 모달** (2026-11-25).
 *
 * 상단에 드롭다운 넷(사업부·등록자·기간·가져오기)이 늘어서 있었다. 화면이 좁아지면
 * 줄이 접히고, 무엇이 걸려 있는지 한눈에 보이지 않았다. 고객사 목록처럼
 * **「필터」 단추 하나**로 모은다 — 창의 틀도 그쪽(CustomerFilterModal)과 같다.
 *
 * 고른 것은 **「적용」을 눌러야** 반영된다. 아래에 「조건 일치 N장」을 실시간으로 보여 준다.
 */

import { useMemo, useState } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import ModalCard from '@/components/common/ModalCard'
import { BLUE, BLUE_TINT, BORDER, CARD_BG, MUTED, SUB, TEXT } from '@/components/common/ui'
import { LABEL_WEIGHT, TEXT_LABEL } from '@/lib/textTokens'
import { R } from '@/lib/radius'
import { EMPTY_FILTER, type CardFilter } from '@/lib/businessCardQuery'

const labelStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: LABEL_WEIGHT, color: TEXT_LABEL, marginBottom: 8,
  display: 'flex', alignItems: 'center', gap: 8,
}
const field: React.CSSProperties = {
  height: 34, padding: '0 10px', boxSizing: 'border-box', width: '100%',
  border: `1px solid ${BORDER}`, borderRadius: R.control, background: CARD_BG,
  fontSize: 13, color: TEXT, outline: 'none', fontFamily: 'inherit',
}

/** 고르는 칸 하나 — 켜지면 테두리·바탕이 액센트로 바뀐다(고객사 필터와 같다). */
function Pick({ on, children, onClick }: { on: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px',
        border: `1px solid ${on ? BLUE : BORDER}`, borderRadius: R.control,
        background: on ? BLUE_TINT : CARD_BG, color: on ? BLUE : TEXT_LABEL,
        fontSize: 12, fontWeight: on ? 700 : 500, cursor: 'pointer', fontFamily: 'inherit',
      }}>
      {children}
    </button>
  )
}

export type CardFilterOptions = {
  /** 고를 수 있는 사업부 — 한 쪽만 보는 사람에게는 칸을 두지 않는다. */
  divisions: readonly string[]
  /** 등록자 — [engineer_id, 이름]. */
  registrars: readonly (readonly [number, string])[]
  /** 가져오기 묶음 — [id, 날짜, 건수]. 없으면 칸을 두지 않는다. */
  batches: readonly (readonly [string, { day: string; count: number }])[]
}

export default function CardFilterModal({ value, options, matchCount, onApply, onClose }: {
  value: CardFilter
  options: CardFilterOptions
  /** 고른 상태로 몇 장이 남는가 — 부르는 쪽이 같은 규칙으로 센다. */
  matchCount: (next: CardFilter) => number
  onApply: (next: CardFilter) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<CardFilter>(value)
  const set = (patch: Partial<CardFilter>) => setDraft(d => ({ ...d, ...patch }))
  const count = useMemo(() => matchCount(draft), [draft, matchCount])

  /** 검색어는 이 창이 건드리지 않는다 — 위의 검색칸이 들고 있다. */
  const clearAll = () => setDraft({ ...EMPTY_FILTER, q: draft.q })

  return (
    <ModalOverlay onClose={onClose}>
      <ModalCard
        width={460}
        ariaLabel="명함 필터"
        title={<div style={{ fontSize: 17, fontWeight: 800, color: TEXT }}>필터</div>}
        onClose={onClose}
        footer={<>
          <button type="button" onClick={clearAll}
            style={{
              height: 38, flex: 1, border: `1px solid ${BORDER}`, borderRadius: R.control,
              background: CARD_BG, color: SUB, fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
            }}>
            조건 비우기
          </button>
          <button type="button" onClick={() => { onApply(draft); onClose() }}
            style={{
              height: 38, flex: 2, border: 'none', borderRadius: R.control,
              background: BLUE, color: '#fff', fontWeight: 700, fontSize: 14,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>
            적용 · {count}장
          </button>
        </>}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {options.divisions.length > 1 && (
            <div>
              <div style={labelStyle}>사업부</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <Pick on={draft.division === ''} onClick={() => set({ division: '' })}>전체</Pick>
                {options.divisions.map(d => (
                  <Pick key={d} on={draft.division === d} onClick={() => set({ division: d })}>{d}</Pick>
                ))}
              </div>
            </div>
          )}

          <div>
            <div style={labelStyle}>등록자</div>
            <select value={draft.engineerId || ''} style={field}
              onChange={e => set({ engineerId: Number(e.target.value) || 0 })}>
              <option value="">전체</option>
              {options.registrars.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </div>

          <div>
            <div style={labelStyle}>등록 기간</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="date" value={draft.from} onChange={e => set({ from: e.target.value })} style={field} />
              <span style={{ color: MUTED, fontSize: 12 }}>~</span>
              <input type="date" value={draft.to} onChange={e => set({ to: e.target.value })} style={field} />
            </div>
          </div>

          {options.batches.length > 0 && (
            <div>
              <div style={labelStyle}>가져오기 묶음</div>
              <select value={draft.batch} style={field} onChange={e => set({ batch: e.target.value })}>
                <option value="">전체</option>
                {options.batches.map(([id, b]) => (
                  <option key={id} value={id}>{b.day} · {b.count}건</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </ModalCard>
    </ModalOverlay>
  )
}
