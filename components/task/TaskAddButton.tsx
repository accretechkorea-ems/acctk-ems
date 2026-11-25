'use client'

/**
 * 「＋ 할 일」 단추 — 창을 여는 자리마다 이것 하나를 둔다 (2026-11-26).
 *
 * 창은 한 벌이다(TaskAddModal). 이 단추가 하는 일은 **대상을 쥐여 주고 여는 것**뿐이다.
 * 목록·카드 안에 들어가는 자리가 많아 클릭 전파를 스스로 막는다 — 단추는 단추의 일만 한다.
 */

import { useState, type CSSProperties } from 'react'
import TaskAddModal, { type TaskRefPreset } from './TaskAddModal'
import { BLUE, BORDER, CARD_BG } from '@/components/common/ui'
import type { TaskKind } from '@/lib/tasks'
import { R } from '@/lib/radius'

export type { TaskRefPreset } from './TaskAddModal'

const base: CSSProperties = {
  borderRadius: R.control, border: `1px solid ${BORDER}`, background: CARD_BG,
  color: BLUE, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
  whiteSpace: 'nowrap', flexShrink: 0,
}

export default function TaskAddButton({ preset, kind, label = '＋ 할 일', size = 'sm', style, onSaved }: {
  /** 무엇에 딸린 일인가. 주면 창의 연결 대상 칸이 **적힌 이름**이 된다. */
  preset?: TaskRefPreset | null
  kind?: TaskKind
  label?: string
  /** sm — 목록·카드 안. md — 화면 머리줄. */
  size?: 'sm' | 'md'
  style?: CSSProperties
  onSaved?: () => void
}) {
  const [open, setOpen] = useState(false)
  const dims: CSSProperties = size === 'md'
    ? { height: 30, padding: '0 11px', fontSize: 12 }
    : { height: 24, padding: '0 8px', fontSize: 11 }

  return (
    <>
      <button
        type="button"
        onClick={e => { e.stopPropagation(); setOpen(true) }}
        title="할 일로 담기"
        style={{ ...base, ...dims, ...style }}
      >
        {label}
      </button>
      {open && (
        <div onClick={e => e.stopPropagation()}>
          <TaskAddModal
            preset={preset ?? null}
            kind={kind}
            onClose={() => setOpen(false)}
            onSaved={() => onSaved?.()}
          />
        </div>
      )}
    </>
  )
}
