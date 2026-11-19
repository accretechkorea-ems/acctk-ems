'use client'

// 고객사 화면 **맨 위 한 줄** — 보기 토글 · 검색 · 엑셀 · 등록 버튼.
//
// ── 왜 이 줄이 생겼나 ─────────────────────────────────────────────────────
//   「업체 등록」 버튼이 **지도 안**에 있었다(MapView 우측 상단). 목록 보기에서는 지도를
//   내리므로 그 버튼이 함께 사라진다. 그래서 두 보기가 함께 쓰는 줄로 끌어올렸다.
//   검색칸도 같다 — 지도 보기에서는 왼쪽 사이드바에 있었는데, 목록 보기에서는 좌 패널이
//   트리라 둘 자리가 없다. 한 줄에서 두 보기를 다 먹인다.
//
//   모바일에서는 이 줄을 감춘다 — 좁은 화면은 예전 「업체 목록 | 지도」 탭이 맡는다
//   (app/page.tsx 의 .mobile-tab-bar). 한 화면에 토글이 둘이면 뜻이 겹친다.

import { useState, type CSSProperties } from 'react'
import SegmentedControl from '@/components/common/SegmentedControl'

const BORDER = '#ebebeb'
const TEXT = '#111827'
const SUB = '#6b7280'
const MUTED = '#9ca3af'
const BLUE = '#234ea2'

export type HomeView = 'map' | 'list'

type Props = {
  view: HomeView
  setView: (v: HomeView) => void
  query: string
  setQuery: (v: string) => void
  /** 지금 보이는 업체 수 — 검색칸 오른쪽에 붙는다. */
  count: number
  loading?: boolean
  onExport: () => void
  exporting: boolean
  /** 엑셀 버튼을 보여 줄지 — superadmin 만. */
  canExport: boolean
  /** 「+ 업체 등록」 — 기존 등록 폼을 연다(회사명 검색 → 없으면 새 회사로). */
  onAdd: () => void
}

const btn: CSSProperties = {
  height: 34, padding: '0 12px', borderRadius: 6, border: `1px solid ${BORDER}`,
  background: '#ffffff', color: TEXT, fontSize: 13, fontWeight: 700, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
}
const primary: CSSProperties = { ...btn, background: BLUE, borderColor: BLUE, color: '#ffffff' }

export default function ListHeader({
  view, setView, query, setQuery, count, loading, onExport, exporting, canExport, onAdd,
}: Props) {
  const [focused, setFocused] = useState(false)
  const exportOff = exporting || loading || count === 0

  return (
    <div className="home-header" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
      <SegmentedControl
        options={[{ label: '지도', value: 'map' }, { label: '목록', value: 'list' }]}
        value={view}
        onChange={v => setView(v as HomeView)}
        height={34}
      />

      {/* 검색 — 두 보기가 같은 칸을 쓴다(지도 보기의 사이드바 검색칸을 여기로 올렸다). */}
      <div style={{ position: 'relative', flex: 1, minWidth: 220, maxWidth: 460 }}>
        <div style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', display: 'flex' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={focused ? BLUE : MUTED} strokeWidth="2.2" style={{ transition: 'stroke 0.15s ease' }}>
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="회사명, 사업장명, 주소, 대리점 검색"
          style={{
            width: '100%', height: 34, boxSizing: 'border-box', padding: '0 68px 0 32px',
            border: `1px solid ${focused ? BLUE : BORDER}`, borderRadius: 6, background: '#ffffff',
            color: TEXT, fontSize: 13, outline: 'none', transition: 'border-color 0.15s ease',
          }}
        />
        <div style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', gap: 6 }}>
          {query ? (
            <button type="button" onClick={() => setQuery('')} aria-label="검색어 지우기"
              style={{ width: 19, height: 19, borderRadius: '50%', border: 'none', background: '#f3f4f6', color: SUB, fontSize: 10, fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              ✕
            </button>
          ) : (
            <span style={{ fontSize: 12, color: MUTED, fontWeight: 600, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
              {loading ? '-' : `${count}개`}
            </span>
          )}
        </div>
      </div>

      <span style={{ flex: 1 }} />

      {/* 엑셀·등록은 **목록 모드에서만** 낸다. 지도는 보는 화면이고, 거기서 쓰던 등록 버튼은
          왼쪽 목록 패널의 「+ 업체」로 옮겼다(좌 패널 탭 줄). */}
      {view === 'list' && canExport && (
        <button type="button" onClick={onExport} disabled={exportOff} aria-label="엑셀 내보내기"
          title={exporting ? '내보내는 중...' : count > 0 ? `엑셀 내보내기 — 지금 목록 ${count}개` : '엑셀 내보내기 — 내보낼 고객사가 없습니다'}
          style={{ ...btn, width: 34, padding: 0, justifyContent: 'center', color: SUB, cursor: exportOff ? 'default' : 'pointer', opacity: exportOff ? 0.5 : 1 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </button>
      )}
      {/* 등록 길은 하나다 — 폼 안에서 회사명을 찾고, 없으면 그 자리에서 새 회사로 만든다
          (components/customer/ParentPicker.tsx 의 「새 회사로 등록」 + 분류). 버튼을 둘로
          가르면 「회사부터 만들어야 하나」를 매번 고민하게 된다. */}
      {view === 'list' && (
        <button type="button" onClick={onAdd} style={primary}>+ 업체 등록</button>
      )}
    </div>
  )
}
