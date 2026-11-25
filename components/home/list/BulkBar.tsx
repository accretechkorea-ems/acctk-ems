'use client'

// 일괄 작업 **선택 바** — 검은 바 + 버튼 (2026-11-23).
//
// ── 바뀐 것 ───────────────────────────────────────────────────────────────
//   드롭다운을 걷고 **버튼만** 남겼다. 바의 드롭다운은 두 가지가 나빴다.
//     (가) 바가 흰 글자색을 주는데 native select 가 자기 색을 정하지 않아 그 흰색을
//          물려받았다 — **흰 바탕에 흰 글자**였다(고른 값도, 펼친 목록도 안 보인다).
//     (나) 고르는 순간 바로 저장됐다. 몇 곳이 무엇으로 바뀌는지 보여 주지 않았다.
//   이제 버튼이 적용 모달(BulkApplyModal)을 연다. **이 바 안에는 select 가 없다** —
//   어두운 바탕 위의 native select 는 이 둘이 마지막이었다(전수 확인).
//
// ── 못 누르는 버튼도 남는다 ───────────────────────────────────────────────
//   조건이 맞지 않는 버튼은 **지우지 않고 잠근다**. 지우면 「그 기능이 없다」로 읽히고,
//   잠그면 왜 안 되는지 title 로 말할 수 있다(lib/bulkActions.ts 의 bulkDisabledReason).
//
// ── 폰 ───────────────────────────────────────────────────────────────────
//   ≤640 에서는 **화면 아래 고정 시트**다(.ems-bulk-bar — app/globals.css). 표를 스크롤하는
//   동안에도 바가 따라다녀야 고른 것을 잊지 않는다.

import type { ReactNode } from 'react'
import { R } from '@/lib/radius'
import { MUTED, TEXT as BAR_BG, CARD_BG } from '@/components/common/ui'
import { bulkActionsFor, bulkBarTitle, type BulkActionKey, type BulkContext } from '@/lib/bulkActions'

// 바탕은 **글자색 토큰(TEXT)** 을 그대로 쓴다 — 검은 바의 색이 그 값이다.
// 가름선만 이 바 전용 값이다(토큰 표에 없는 어두운 회색).
export const BAR_LINE = '#374151'

export type BulkBarProps = BulkContext & {
  /** 버튼을 눌렀을 때. 잠긴 버튼은 부르지 않는다. */
  onAction: (key: BulkActionKey) => void
  /** 저장 중 — 버튼을 모두 잠근다. */
  busy?: boolean
  onClear: () => void
  /** 바 왼쪽 글자 뒤에 덧붙일 것(없으면 비운다). */
  extra?: ReactNode
}

export default function BulkBar({ scope, count, sameCompany, canMergeSites, onAction, busy = false, onClear, extra }: BulkBarProps) {
  if (count === 0) return null
  const items = bulkActionsFor({ scope, count, sameCompany, canMergeSites })

  return (
    <div className="ems-bulk-bar"
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px',
        background: BAR_BG, color: CARD_BG, fontSize: 12, flexWrap: 'wrap', flexShrink: 0,
      }}>
      <b style={{ fontWeight: 700 }}>{bulkBarTitle(scope, count)}</b>
      {extra}
      <span style={{ width: 1, height: 16, background: BAR_LINE, margin: '0 4px' }} />

      {items.map(({ action, reason }) => {
        const off = !!reason || busy
        return (
          <button key={action.key} type="button" disabled={off}
            title={reason ?? action.label}
            onClick={() => onAction(action.key)}
            style={{
              height: 26, padding: '0 10px', borderRadius: R.icon,
              border: `1px solid ${BAR_LINE}`, background: 'transparent',
              // 색을 **직접 적는다** — 물려받으면 바탕과 같은 색이 되는 사고가 여기서 났다.
              color: off ? MUTED : CARD_BG,
              fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
              cursor: off ? 'not-allowed' : 'pointer',
            }}>
            {action.label}
          </button>
        )
      })}

      <span style={{ flex: 1 }} />
      <button type="button" onClick={onClear}
        style={{ border: 'none', background: 'none', color: MUTED, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
        선택 해제
      </button>
    </div>
  )
}
