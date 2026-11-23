'use client'

/**
 * 고객사 **필터 모달** — 지도 보기와 목록 보기가 **같은 창, 같은 상태**를 쓴다.
 *
 * 왜 모았나(2026-11-20)
 *   조건이 세 군데에 흩어져 있었다 — 지도 위에 떠 있는 상태·계열 칩, 목록 좌 패널의
 *   드롭다운 넷, 그리고 그 아래 토글 칩 셋. 지도에서 켠 조건이 목록으로 넘어가지 않아
 *   같은 일을 두 번 골라야 했다. 이제 상태를 하나로 두고 창도 하나다.
 *
 * 고른 것은 **「적용」을 눌러야** 반영된다(활동 이력 필터와 같은 방식). 대신 아래에
 * 「조건 일치 N곳」을 실시간으로 보여 준다.
 */

import { useMemo, useState } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import ModalCard from '@/components/common/ModalCard'
import { R } from '@/lib/radius'
import { RECENT_KEYS, RECENT_LABEL, DIRECT_SALE, type ListFilter, type RecentKey } from '@/lib/customerList'
import { defaultFilter, type FilterOptions } from '@/lib/customerFilterChips'

const BORDER = '#ebebeb'
const TEXT = '#111827'
const SUB = '#4b5563'
const MUTED = '#6b7280'
const BLUE = '#234ea2'

const STATUS_DOT: Record<string, string> = { '활성': '#16a34a', '잠재': '#f59e0b', '이탈': '#ef4444' }

type Props = {
  value: ListFilter
  options: FilterOptions
  /** 고른 상태로 몇 곳이 남는가 — 부르는 쪽이 같은 규칙으로 센다. */
  matchCount: (next: ListFilter) => number
  onApply: (next: ListFilter) => void
  onClose: () => void
}

const labelStyle = { fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 } as const
const linkStyle = { border: 'none', background: 'none', padding: 0, fontSize: 12, fontWeight: 500, color: BLUE, cursor: 'pointer', fontFamily: 'inherit' } as const

/** 고르는 칸 하나 — 켜지면 테두리·바탕이 액센트로 바뀐다. */
function Pick({ on, children, onClick }: { on: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px',
        border: `1px solid ${on ? BLUE : BORDER}`, borderRadius: R.control,
        background: on ? '#eff4ff' : '#ffffff', color: on ? BLUE : '#374151',
        fontSize: 13, fontWeight: on ? 700 : 500, cursor: 'pointer', fontFamily: 'inherit',
      }}>
      {children}
    </button>
  )
}

export default function CustomerFilterModal({ value, options, matchCount, onApply, onClose }: Props) {
  const [draft, setDraft] = useState<ListFilter>(value)
  const match = useMemo(() => matchCount(draft), [draft, matchCount])

  const toggle = (key: 'statuses' | 'categories', v: string) => setDraft(d => ({
    ...d,
    [key]: d[key].includes(v) ? d[key].filter(x => x !== v) : [...d[key], v],
  }))
  const toggleNum = (key: 'agencies', v: number) => setDraft(d => ({
    ...d,
    [key]: d[key].includes(v) ? d[key].filter(x => x !== v) : [...d[key], v],
  }))
  const toggleRegion = (v: string) => setDraft(d => ({
    ...d,
    regions: d.regions.includes(v) ? d.regions.filter(x => x !== v) : [...d.regions, v],
  }))

  return (
    <ModalOverlay onClose={onClose}>
      {/* 구조는 공용 카드가 든다 — 머리줄 고정 / 본문 스크롤 / 바닥줄 고정.
          겉모양은 옛 값 그대로다: 폭 520 · 머리줄 16/20 + 아래 구분선 · 제목 15/700 ·
          본문 18/20 에 세로 gap 18 · 바닥줄 14/20 + 위 구분선 + 바탕 #fafafa.
          ✕ 는 두지 않는다 — 길은 [취소]·Esc·바깥 클릭 셋이고 모두 같은 함수다.
          대화창 표시(role·aria-modal·aria-label)는 그대로 카드에 넘긴다. */}
      <ModalCard
        width={520}
        closeX={false}
        role="dialog"
        ariaModal
        ariaLabel="고객사 필터"
        headStyle={{ alignItems: 'center', padding: '16px 20px', borderBottom: `1px solid ${BORDER}` }}
        bodyStyle={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 18 }}
        footStyle={{ padding: '14px 20px', borderTop: `1px solid ${BORDER}`, background: '#fafafa' }}
        title={<>
          <b style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>필터</b>
        </>}
        footer={<>
          <button type="button" onClick={() => setDraft(d => defaultFilter(options, d))}
            style={{ border: 'none', background: 'none', padding: 0, fontSize: 13, fontWeight: 600, color: SUB, cursor: 'pointer', fontFamily: 'inherit' }}>
            초기화
          </button>
          <span style={{ flex: 1, textAlign: 'right', fontSize: 12, color: SUB }}>
            조건 일치 <b className="num" style={{ color: TEXT, fontWeight: 700 }}>{match.toLocaleString('ko-KR')}</b>곳
          </span>
          <button type="button" onClick={onClose}
            style={{ height: 34, padding: '0 14px', background: '#ffffff', color: SUB, borderRadius: R.control, border: `1px solid ${BORDER}`, cursor: 'pointer', fontWeight: 600, fontSize: 13, fontFamily: 'inherit' }}>
            취소
          </button>
          <button type="button" onClick={() => onApply(draft)}
            style={{ height: 34, padding: '0 16px', background: BLUE, color: '#ffffff', borderRadius: R.control, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, fontFamily: 'inherit' }}>
            적용
          </button>
        </>}
      >
          {/* 상태 */}
          <div>
            <div style={labelStyle}>
              상태
              <button type="button" style={linkStyle} onClick={() => setDraft(d => ({ ...d, statuses: [...options.statuses] }))}>전체 선택</button>
              <button type="button" style={linkStyle} onClick={() => setDraft(d => ({ ...d, statuses: [] }))}>해제</button>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {options.statuses.map(s => (
                <Pick key={s} on={draft.statuses.includes(s)} onClick={() => toggle('statuses', s)}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_DOT[s] ?? MUTED }} />
                  {s}
                </Pick>
              ))}
            </div>
          </div>

          {/* 장비 계열 */}
          <div>
            <div style={labelStyle}>
              장비 계열
              <button type="button" style={linkStyle} onClick={() => setDraft(d => ({ ...d, categories: [...options.categories] }))}>전체 선택</button>
              <button type="button" style={linkStyle} onClick={() => setDraft(d => ({ ...d, categories: [] }))}>해제</button>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {options.categories.map(c => (
                <Pick key={c} on={draft.categories.includes(c)} onClick={() => toggle('categories', c)}>{c}</Pick>
              ))}
            </div>
          </div>

          {/* 대리점 — 많아서 고른 것만 칩으로 남기고 목록은 셀렉트로 더한다. */}
          <div>
            <div style={labelStyle}>
              대리점
              {draft.agencies.length > 0 && (
                <button type="button" style={linkStyle} onClick={() => setDraft(d => ({ ...d, agencies: [] }))}>해제</button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <Pick on={draft.agencies.includes(DIRECT_SALE)} onClick={() => toggleNum('agencies', DIRECT_SALE)}>ACCT-K</Pick>
              {draft.agencies.filter(id => id !== DIRECT_SALE).map(id => (
                <Pick key={id} on onClick={() => toggleNum('agencies', id)}>
                  {options.agencies.find(a => a.id === id)?.name ?? `대리점 ${id}`}
                </Pick>
              ))}
              <select value="" onChange={e => { if (e.target.value) toggleNum('agencies', Number(e.target.value)) }}
                style={{ height: 32, border: `1px solid ${BORDER}`, borderRadius: R.control, padding: '0 10px', fontSize: 13, color: MUTED, background: '#fff', fontFamily: 'inherit' }}>
                <option value="" disabled hidden>대리점 더하기…</option>
                {options.agencies.filter(a => a.id !== DIRECT_SALE && !draft.agencies.includes(a.id))
                  .map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          </div>

          {/* 지역 */}
          <div>
            <div style={labelStyle}>
              지역
              {draft.regions.length > 0 && (
                <button type="button" style={linkStyle} onClick={() => setDraft(d => ({ ...d, regions: [] }))}>해제</button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {options.regions.map(r => (
                <Pick key={r} on={draft.regions.includes(r)} onClick={() => toggleRegion(r)}>{r}</Pick>
              ))}
            </div>
          </div>

          {/* 최근 활동 — 하나만 고른다(겹칠 수 없는 조건이다). */}
          <div>
            <div style={labelStyle}>최근 활동</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {RECENT_KEYS.filter(k => k !== 'any').map(k => (
                <Pick key={k} on={draft.recent === k}
                  onClick={() => setDraft(d => ({ ...d, recent: (d.recent === k ? 'any' : k) as RecentKey }))}>
                  {RECENT_LABEL[k]}
                </Pick>
              ))}
              <Pick on={draft.openQuotesOnly} onClick={() => setDraft(d => ({ ...d, openQuotesOnly: !d.openQuotesOnly }))}>진행 견적</Pick>
              <Pick on={draft.noIndustryOnly} onClick={() => setDraft(d => ({ ...d, noIndustryOnly: !d.noIndustryOnly }))}>분류 없음</Pick>
            </div>
          </div>
      </ModalCard>
    </ModalOverlay>
  )
}
