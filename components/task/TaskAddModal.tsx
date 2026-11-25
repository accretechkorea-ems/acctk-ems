'use client'

/**
 * 「＋ 할 일」 — **한 벌만 있는 창**이다 (2026-11-26).
 *
 * 들어오는 자리가 다섯이다: 홈 · 포캐스트 카드 · 견적 상세 · 리드 행 · 사업장 화면(장비 카드).
 * 자리마다 창을 따로 만들면 칸이 조용히 갈린다 — 한 자리에서 메모를 받고 다른 자리에서는
 * 안 받는 식이다. 그래서 **창은 하나**고, 자리가 다른 것은 「무엇에 딸린 일인지」
 * (preset)뿐이다. 그 값이 오면 연결 대상 칸은 고르는 칸이 아니라 **적힌 이름**이 된다.
 *
 * 저장은 /api/task(service role)가 한다 — 만든 사람은 세션에서 박는다.
 */

import { useState, type CSSProperties } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import ModalCard from '@/components/common/ModalCard'
import TaskRefPicker, { type TaskRefPick } from './TaskRefPicker'
import { BLUE_TINT, BLUE, BORDER, CARD_BG, DANGER, NEUTRAL_BG, TEXT, btnGhost, btnPrimary } from '@/components/common/ui'
import { LABEL_WEIGHT, TEXT_LABEL, TEXT_NOTE } from '@/lib/textTokens'
import { REF_LABEL, type TaskKind, type TaskRefType } from '@/lib/tasks'
import { addDays, todayKST } from '@/lib/date'
import { R } from '@/lib/radius'

/** 부르는 자리가 이미 아는 대상 — 그 칸은 고르지 않고 이름만 보여 준다. */
export type TaskRefPreset = { type: TaskRefType; id: number; label: string }

const field: CSSProperties = {
  width: '100%', padding: '9px 10px', border: `1px solid ${BORDER}`, borderRadius: R.control,
  fontSize: 13, color: TEXT, background: CARD_BG, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
}
const labelStyle: CSSProperties = {
  fontSize: 11, fontWeight: LABEL_WEIGHT, color: TEXT_LABEL, marginBottom: 5, display: 'block',
}
/** 기한을 한 번에 넣는 작은 칩 — 날짜 칸을 직접 고르는 길도 그대로 둔다. */
const dueChip = (on: boolean): CSSProperties => ({
  height: 26, padding: '0 10px', borderRadius: R.pill, fontSize: 12, fontWeight: 700,
  border: `1px solid ${on ? BLUE : BORDER}`, background: on ? BLUE_TINT : CARD_BG,
  color: on ? BLUE : TEXT_NOTE, cursor: 'pointer', fontFamily: 'inherit',
})

export default function TaskAddModal({ preset, kind = 'manual', onClose, onSaved }: {
  preset?: TaskRefPreset | null
  /** 태그로 쓸 종류. 대상이 정해진 자리는 그 종류를 넣는다(포캐스트 카드 → 'forecast'). */
  kind?: TaskKind
  onClose: () => void
  /** 담은 뒤 — 부르는 쪽이 목록을 다시 읽는다. */
  onSaved?: (taskId: number) => void
}) {
  const today = todayKST()
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [memo, setMemo] = useState('')
  const [pick, setPick] = useState<TaskRefPick | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirty = !!title.trim() || !!memo.trim() || !!due || !!pick
  const refType = preset?.type ?? pick?.type ?? null
  const refId = preset?.id ?? pick?.id ?? null

  const save = async () => {
    const name = title.trim()
    if (!name) { setError('할 일을 한 줄로 적어주세요'); return }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          title: name,
          due_date: due || null,
          memo: memo.trim() || null,
          // 대상이 있으면 그 종류를 태그로 쓴다 — 목록에서 어디서 온 일인지 한눈에 보인다.
          kind: refType === 'forecast' ? 'forecast'
            : refType === 'quote' ? 'quote_expiry'
            : refType === 'lead' ? 'lead'
            : refType === 'device' ? 'service'
            : kind,
          ref_type: refType,
          ref_id: refId,
        }),
      })
      const json = await res.json().catch(() => null) as { ok?: boolean; task_id?: number; error?: string } | null
      if (!res.ok || !json?.ok) { setError(json?.error ?? '할 일을 담지 못했습니다'); return }
      onSaved?.(Number(json.task_id))
      onClose()
    } catch (e) {
      console.error('[task] create threw', e)
      setError('할 일을 담지 못했습니다')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalOverlay onClose={onClose} confirmClose dirty={dirty}>
      <ModalCard
        title="＋ 할 일"
        width={520}
        footer={
          <>
            <button type="button" onClick={onClose} style={btnGhost()}>취소</button>
            <button type="button" onClick={() => { void save() }} disabled={saving || !title.trim()} style={btnPrimary(saving || !title.trim())}>
              {saving ? '담는 중…' : '담기'}
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelStyle} htmlFor="task-title">할 일<span style={{ color: DANGER, marginLeft: 3 }}>*</span></label>
            <input
              id="task-title" value={title} onChange={e => setTitle(e.target.value)} autoFocus
              placeholder="ex. 구매팀 가격 협의 · 발주서 수령 확인"
              style={field}
              onKeyDown={e => { if (e.key === 'Enter' && title.trim() && !saving) { e.preventDefault(); void save() } }}
            />
          </div>

          <div>
            <label style={labelStyle} htmlFor="task-due">기한</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <input id="task-due" type="date" value={due} onChange={e => setDue(e.target.value)} style={{ ...field, width: 160 }} />
              <button type="button" onClick={() => setDue(today)} style={dueChip(due === today)}>오늘</button>
              <button type="button" onClick={() => setDue(addDays(today, 1))} style={dueChip(due === addDays(today, 1))}>내일</button>
              <button type="button" onClick={() => setDue(addDays(today, 7))} style={dueChip(due === addDays(today, 7))}>다음 주</button>
              {due && <button type="button" onClick={() => setDue('')} style={dueChip(false)}>비우기</button>}
            </div>
            <div style={{ fontSize: 11, color: TEXT_NOTE, marginTop: 5 }}>비워 두면 「언젠가」로 목록 아래에 선다</div>
          </div>

          <div>
            <label style={labelStyle}>연결 대상</label>
            {preset ? (
              <div style={{ ...field, display: 'flex', alignItems: 'center', gap: 8, background: NEUTRAL_BG }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: BLUE }}>{REF_LABEL[preset.type]}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>
                  {preset.label}
                </span>
              </div>
            ) : (
              <TaskRefPicker pick={pick} onPick={setPick} fieldStyle={field} />
            )}
          </div>

          <div>
            <label style={labelStyle} htmlFor="task-memo">메모</label>
            <textarea
              id="task-memo" value={memo} onChange={e => setMemo(e.target.value)} rows={3}
              placeholder="필요하면 한두 줄"
              style={{ ...field, resize: 'vertical', lineHeight: 1.5 }}
            />
          </div>

          {error && <div style={{ fontSize: 12, color: DANGER }}>{error}</div>}
        </div>
      </ModalCard>
    </ModalOverlay>
  )
}
