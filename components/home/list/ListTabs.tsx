'use client'

/**
 * 목록 보기의 **탭 줄** — 회사 / 대리점 / 정리 필요, 그리고 오른쪽 끝에 엑셀·＋.
 *
 * 왜 상단 카드 안으로 들어왔나(2026-11-20)
 *   탭은 트리 카드의 머리였고, 엑셀·「+ 업체 등록」은 **우측 pane 우상단**에 있었다.
 *   그래서 목록을 고르는 일(왼쪽)과 목록을 내보내는 일(오른쪽)이 화면 양 끝으로
 *   갈려 있었다. 둘 다 왼쪽 패널의 같은 줄에 둔다 — 쓰는 맥락이 같다.
 *   글자 버튼이던 둘은 아이콘으로 줄였다(탭 셋과 한 줄에 서야 한다).
 */

import { R } from '@/lib/radius'
import type { ListTab } from './CustomerListPanel'

const BORDER = '#ebebeb'
const TEXT = '#111827'
const SUB = '#4b5563'
const MUTED = '#6b7280'
const BLUE = '#234ea2'
const NEUTRAL = '#f3f4f6'
const DANGER = '#b91c1c'

type Props = {
  tab: ListTab
  setTab: (t: ListTab) => void
  counts: { company: number; agency: number; cleanup: number }
  onExport: () => void
  canExport: boolean
  exporting: boolean
  onAdd: () => void
}

/**
 * 탭 하나. **줄바꿈을 막는다** — 340px 안에 탭 셋과 아이콘 둘이 함께 서야 해서,
 * 글자가 접히면 「회사」가 두 줄로 쪼개진다(처음 그렸을 때 그랬다).
 */
const tabStyle = (on: boolean) => ({
  height: 38, padding: '0 7px', border: 'none', background: 'transparent',
  fontSize: 12, fontWeight: 500, color: on ? TEXT : SUB,
  borderBottom: `2px solid ${on ? BLUE : 'transparent'}`,
  display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontFamily: 'inherit',
  whiteSpace: 'nowrap' as const, flexShrink: 0,
})

const countStyle = (tone?: 'danger') => ({
  fontSize: 11, padding: '1px 5px', borderRadius: R.pill,
  background: tone === 'danger' ? '#fee2e2' : NEUTRAL,
  color: tone === 'danger' ? DANGER : SUB,
})

export default function ListTabs({ tab, setTab, counts, onExport, canExport, exporting, onAdd }: Props) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', borderTop: `1px solid ${BORDER}`, padding: '0 6px 0 6px', minWidth: 0 }}>
      <button type="button" onClick={() => setTab('company')} style={tabStyle(tab === 'company')}>
        회사 <span style={countStyle()}>{counts.company}</span>
      </button>
      <button type="button" onClick={() => setTab('agency')} style={tabStyle(tab === 'agency')}>
        대리점 <span style={countStyle()}>{counts.agency}</span>
      </button>
      <button type="button" onClick={() => setTab('cleanup')} style={tabStyle(tab === 'cleanup')}>
        정리 필요 <span style={countStyle(counts.cleanup > 0 ? 'danger' : undefined)}>{counts.cleanup}</span>
      </button>
      <span style={{ flex: 1, minWidth: 4 }} />

      {/* 엑셀 — 지금 보이는 목록 그대로 내보낸다(기능은 그대로, 생김새만 아이콘이다). */}
      <button type="button" onClick={onExport} disabled={!canExport || exporting}
        title={exporting ? '내보내는 중…' : '엑셀 내보내기'} aria-label="엑셀 내보내기"
        style={{
          width: 28, height: 28, borderRadius: R.icon, border: `1px solid ${BORDER}`, background: '#ffffff',
          color: canExport && !exporting ? SUB : MUTED, cursor: canExport && !exporting ? 'pointer' : 'not-allowed',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v3h16v-3" />
        </svg>
      </button>

      {/* 업체 등록 — 주색. 이 패널에서 가장 자주 누르는 하나다. */}
      <button type="button" onClick={onAdd} title="업체 등록" aria-label="업체 등록"
        style={{
          width: 28, height: 28, marginLeft: 4, borderRadius: R.icon, border: 'none', background: BLUE,
          color: '#ffffff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </div>
  )
}
