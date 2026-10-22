'use client'

// 개인 대시보드의 작은 카드들 — 포캐스트 · 알림 · 결재 대기.
// 「내 견적」과 「할 일」은 파일이 따로 있다(각각 모달과 규칙이 붙어 있어 길다).
//
// 카드는 **자기 자료만** 본다. 숫자 규칙은 lib/homeCards.ts, 조회는 useDashboardCards 가 맡고
// 여기서는 그리기만 한다 — 그래야 한 카드가 실패해도 다른 카드가 멀쩡히 뜬다.

import DashCard from './DashCard'
import { buildTodos, stageBars, type CardOpportunity, type TodoInput, type TodoItem } from '@/lib/homeCards'
import type { ApprovalRow, NotificationRow, Slot } from '@/hooks/dashboard/useDashboardCards'

const TEXT = '#111827'
const GRAY = '#6b7280'
const MUTED = '#9ca3af'
const FADE = '#d1d5db'
const BLUE = '#234ea2'

const numKR = (n: number) => Math.round(n).toLocaleString('ko-KR')
/** 금액을 줄여 쓴다 — 카드 한 줄에 들어가야 한다. */
const compact = (n: number): string => {
  if (!n) return '-'
  if (n >= 1e8) return `${(Math.round((n / 1e8) * 10) / 10)}억`
  if (n >= 1e7) return `${Math.round(n / 1e7)}천만`
  if (n >= 1e4) return `${numKR(Math.round(n / 1e4))}만`
  return numKR(n)
}

const empty = (text: string) => (
  <div style={{ fontSize: 12, color: MUTED, paddingTop: 8 }}>{text}</div>
)

// ── 포캐스트 ────────────────────────────────────────────────────────────────

/** 내 포캐스트를 단계별 가로막대 다섯 줄로. 카드를 누르면 포캐스트 화면으로 간다. */
export function ForecastCard({ slot, onOpen }: { slot: Slot<CardOpportunity[]>; onOpen: () => void }) {
  const bars = stageBars(slot.data)
  const max = Math.max(1, ...bars.map(b => b.amount))
  const total = bars.reduce((s, b) => s + b.count, 0)
  return (
    <DashCard title="포캐스트" onMore={onOpen} onClick={onOpen} loading={slot.loading} error={slot.error}>
      {total === 0 ? empty('진행 중인 포캐스트가 없습니다') : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {bars.map(b => (
            <div key={b.stage} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span style={{ width: 52, flexShrink: 0, fontSize: 11, fontWeight: 600, color: b.count ? TEXT : FADE }}>{b.stage}</span>
              {/* 막대는 금액 비율이다. 0 원이어도 건수가 있으면 가느다란 자국을 남긴다. */}
              <span style={{ flex: 1, minWidth: 0, height: 8, background: '#f3f4f6', borderRadius: 4, overflow: 'hidden' }}>
                <span style={{ display: 'block', height: '100%', width: `${b.amount > 0 ? Math.max(4, (b.amount / max) * 100) : (b.count ? 2 : 0)}%`, background: BLUE, borderRadius: 4 }} />
              </span>
              <span className="num" style={{ width: 34, flexShrink: 0, textAlign: 'right', fontSize: 11, fontWeight: 700, color: b.count ? TEXT : FADE }}>{b.count}건</span>
              <span className="num" style={{ width: 54, flexShrink: 0, textAlign: 'right', fontSize: 11, color: b.amount ? GRAY : FADE }}>{compact(b.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </DashCard>
  )
}

// ── 알림 ────────────────────────────────────────────────────────────────────

/** 안 읽은 알림 최근 다섯. 누르면 알림이 가리키는 곳으로 간다(기존 링크 규칙 그대로). */
export function NotificationCard({ slot, onMore, onOpen }: {
  slot: Slot<NotificationRow[]>
  onMore: () => void
  onOpen: (n: NotificationRow) => void
}) {
  return (
    <DashCard title="알림" onMore={onMore} loading={slot.loading} error={slot.error}>
      {slot.data.length === 0 ? empty('읽지 않은 알림이 없습니다') : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {slot.data.map(n => (
            <button key={n.id} type="button" onClick={() => onOpen(n)}
              style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '7px 0', background: 'none', border: 'none', borderBottom: '1px solid #ebebeb', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {n.title || n.message || '알림'}
              </span>
              <span style={{ flexShrink: 0, fontSize: 11, color: MUTED }}>{(n.created_at ?? '').slice(5, 10).replace('-', '.')}</span>
            </button>
          ))}
        </div>
      )}
    </DashCard>
  )
}

// ── 할 일 ───────────────────────────────────────────────────────────────────

/**
 * 손이 가야 하는 것만 모아 보여 준다. **규칙은 lib/homeCards.ts 가 정하고 여기서는 그린다.**
 * 0건인 줄은 애초에 오지 않는다(buildTodos 가 걸러 낸다) — 「0건」이 네 줄 늘어서 있으면
 * 할 일이 없다는 사실이 오히려 안 읽힌다.
 *
 * 네 재료(포캐스트·견적·활동·리드)를 다 못 읽었으면 **숫자를 만들지 않는다** — 한 가지만
 * 읽히고 나머지가 비면 「할 일이 없습니다」로 보이는데, 그것은 사실이 아니다.
 */
export function TodoCard({ input, ready, error, onOpen }: {
  input: TodoInput
  ready: boolean
  error: boolean
  onOpen: (t: TodoItem) => void
}) {
  const todos = ready ? buildTodos(input) : []
  return (
    <DashCard title="할 일" loading={!ready && !error} error={error}>
      {todos.length === 0 ? empty('할 일이 없습니다') : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {todos.map(t => (
            <button key={t.key} type="button" onClick={() => onOpen(t)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', background: 'none', border: 'none', borderBottom: '1px solid #ebebeb', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
              {/* 숫자가 먼저 읽혀야 한다 — 몇 건인지로 무엇부터 할지 정한다. */}
              <span className="num" style={{ flexShrink: 0, minWidth: 22, fontSize: 15, fontWeight: 800, color: BLUE, textAlign: 'right' }}>{t.count}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.label.replace(` ${t.count}건`, '')}
              </span>
              <span style={{ flexShrink: 0, fontSize: 11, color: MUTED }}>→</span>
            </button>
          ))}
        </div>
      )}
    </DashCard>
  )
}

// ── 결재 대기 ───────────────────────────────────────────────────────────────

/** 내가 결재할 문서. **한 건도 없으면 카드를 내지 않는다**(부르는 쪽이 자리를 비운다). */
export function ApprovalCard({ slot, onMore, onOpen }: {
  slot: Slot<ApprovalRow[]>
  onMore: () => void
  onOpen: (d: ApprovalRow) => void
}) {
  return (
    <DashCard title="결재 대기" onMore={onMore} loading={slot.loading} error={slot.error}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 8 }}>
        <span className="num" style={{ fontSize: 24, fontWeight: 800, color: slot.data.length ? BLUE : FADE, letterSpacing: '-0.5px' }}>
          {slot.data.length}
        </span>
        <span style={{ fontSize: 12, color: GRAY }}>건이 내 차례입니다</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {slot.data.slice(0, 3).map(d => (
          <button key={d.document_id} type="button" onClick={() => onOpen(d)}
            style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '6px 0', background: 'none', border: 'none', borderBottom: '1px solid #ebebeb', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
            <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: MUTED }}>{d.doc_type ?? '문서'}</span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {d.title || d.doc_no || `#${d.document_id}`}
            </span>
          </button>
        ))}
      </div>
    </DashCard>
  )
}
