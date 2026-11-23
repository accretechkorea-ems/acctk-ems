'use client'

/**
 * 활동 이력 **필터 모달** — 종류·사업장·기간을 겹쳐 고른다.
 *
 * 왜 모달인가: 머리줄에 세그먼트(종류 하나)와 칩 줄(사업장)을 함께 두니, 사업장이
 * 여섯 곳을 넘으면 줄이 옆으로 밀리고 종류는 둘 이상 고를 수 없었다. 고르는 일은
 * 여기서 하고, 머리줄에는 **걸린 것만** 칩으로 남긴다.
 *
 * 고른 것은 **「적용」을 눌러야** 반영된다 — 체크를 하나 누를 때마다 뒤 목록이
 * 다시 그려지면 긴 목록에서 손이 머문다. 대신 아래에 「조건 일치 N건」을 실시간으로
 * 보여 주어, 적용 전에 몇 건이 남는지 알 수 있게 한다.
 *
 * 규칙은 lib/timelineFilter.ts 가 정본이다(전부 고름 = 좁히지 않음).
 */

import { useMemo, useState } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import { R } from '@/lib/radius'
import type { TimelineFilter, TimelineKind } from '@/lib/timelineFilter'

const BORDER = '#ebebeb'
const TEXT = '#111827'
const LABEL = '#374151'
const SUB = '#4b5563'
const MUTED = '#6b7280'
const BLUE = '#234ea2'

type Props = {
  value: TimelineFilter
  available: { kinds: TimelineKind[]; siteIds: number[] }
  kindCounts: Record<string, number>
  siteCounts: Map<number, number>
  siteName: (id: number) => string
  /** 고른 상태로 몇 건이 남는가 — 부르는 쪽이 같은 규칙으로 센다. */
  matchCount: (next: TimelineFilter) => number
  onApply: (next: TimelineFilter) => void
  onClose: () => void
}

const labelStyle = { fontSize: 12, fontWeight: 700, color: LABEL, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } as const

const linkStyle = { border: 'none', background: 'none', padding: 0, fontSize: 12, fontWeight: 500, color: BLUE, cursor: 'pointer', fontFamily: 'inherit' } as const

const inputStyle = {
  height: 34, border: `1px solid ${BORDER}`, borderRadius: R.control, padding: '0 10px',
  fontSize: 13, color: TEXT, background: '#ffffff', width: '100%', boxSizing: 'border-box' as const,
  fontFamily: 'inherit',
}

/** 체크 칩 하나 — 네모 체크 + 이름 + 건수. 켜지면 테두리·바탕이 액센트로 바뀐다. */
function Check({ on, name, count, onToggle }: { on: boolean; name: string; count: number; onToggle: () => void }) {
  return (
    <label style={{
      display: 'inline-flex', alignItems: 'center', gap: 8, height: 34, padding: '0 11px',
      border: `1px solid ${on ? BLUE : BORDER}`, borderRadius: R.control,
      background: on ? '#eff4ff' : '#ffffff', color: on ? BLUE : TEXT,
      fontSize: 13, fontWeight: on ? 700 : 500, cursor: 'pointer', minWidth: 0,
    }}>
      <input type="checkbox" checked={on} onChange={onToggle} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
      <span className="num" style={{ fontSize: 11, color: on ? BLUE : MUTED }}>{count}</span>
    </label>
  )
}

export default function TimelineFilterModal({ value, available, kindCounts, siteCounts, siteName, matchCount, onApply, onClose }: Props) {
  const [draft, setDraft] = useState<TimelineFilter>(value)
  const match = useMemo(() => matchCount(draft), [draft, matchCount])

  const toggleKind = (k: TimelineKind) => setDraft(d => ({
    ...d,
    kinds: d.kinds.includes(k) ? d.kinds.filter(v => v !== k) : [...d.kinds, k],
  }))
  const toggleSite = (id: number) => setDraft(d => ({
    ...d,
    siteIds: d.siteIds.includes(id) ? d.siteIds.filter(v => v !== id) : [...d.siteIds, id],
  }))

  return (
    <ModalOverlay onClose={onClose}>
      <div role="dialog" aria-modal="true" aria-label="활동 이력 필터" onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 520, maxHeight: '92vh', overflowY: 'auto',
          background: '#ffffff', borderRadius: R.modal, border: `1px solid ${BORDER}`,
          boxShadow: '0 20px 60px rgba(0,0,0,0.22)', display: 'flex', flexDirection: 'column',
        }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 22px 0' }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: TEXT, letterSpacing: '-0.3px' }}>활동 이력 필터</h2>
        </div>

        <div style={{ padding: '16px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 종류 */}
          <div>
            <div style={labelStyle}>
              종류
              <button type="button" style={linkStyle} onClick={() => setDraft(d => ({ ...d, kinds: [...available.kinds] }))}>전체 선택</button>
              <button type="button" style={linkStyle} onClick={() => setDraft(d => ({ ...d, kinds: [] }))}>해제</button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {available.kinds.map(k => (
                <Check key={k} on={draft.kinds.includes(k)} name={k} count={kindCounts[k] ?? 0} onToggle={() => toggleKind(k)} />
              ))}
            </div>
          </div>

          {/* 사업장 — 회사 전체 모드에서만 자리가 있다. */}
          {available.siteIds.length > 1 && (
            <div>
              <div style={labelStyle}>
                사업장
                <button type="button" style={linkStyle} onClick={() => setDraft(d => ({ ...d, siteIds: [...available.siteIds] }))}>전체 선택</button>
                <button type="button" style={linkStyle} onClick={() => setDraft(d => ({ ...d, siteIds: [] }))}>해제</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {available.siteIds.map(id => (
                  <Check key={id} on={draft.siteIds.includes(id)} name={siteName(id) || `사업장 ${id}`}
                    count={siteCounts.get(id) ?? 0} onToggle={() => toggleSite(id)} />
                ))}
              </div>
            </div>
          )}

          {/* 기간 */}
          <div>
            <div style={labelStyle}>
              기간
              {(draft.from || draft.to) && (
                <button type="button" style={linkStyle} onClick={() => setDraft(d => ({ ...d, from: '', to: '' }))}>지우기</button>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <input type="date" aria-label="시작일" value={draft.from} max={draft.to || undefined}
                onChange={e => setDraft(d => ({ ...d, from: e.target.value }))} style={inputStyle} />
              <input type="date" aria-label="종료일" value={draft.to} min={draft.from || undefined}
                onChange={e => setDraft(d => ({ ...d, to: e.target.value }))} style={inputStyle} />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 22px 18px', borderTop: `1px solid ${BORDER}` }}>
          <button type="button" onClick={() => setDraft({ kinds: [...available.kinds], siteIds: [...available.siteIds], from: '', to: '' })}
            style={{ border: 'none', background: 'none', padding: 0, fontSize: 13, fontWeight: 600, color: SUB, cursor: 'pointer', fontFamily: 'inherit' }}>
            초기화
          </button>
          <span style={{ flex: 1, fontSize: 12, color: SUB }}>조건 일치 <b className="num" style={{ color: TEXT, fontWeight: 700 }}>{match}</b>건</span>
          <button type="button" onClick={onClose}
            style={{ height: 36, padding: '0 14px', background: '#ffffff', color: SUB, borderRadius: R.control, border: `1px solid ${BORDER}`, cursor: 'pointer', fontWeight: 600, fontSize: 13, fontFamily: 'inherit' }}>
            취소
          </button>
          <button type="button" onClick={() => onApply(draft)}
            style={{ height: 36, padding: '0 16px', background: BLUE, color: '#ffffff', borderRadius: R.control, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, fontFamily: 'inherit' }}>
            적용
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}
