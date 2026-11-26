'use client'

/**
 * 홈 「내 오늘」 — 타일 여섯 · 할 일 목록 · 작은 카드 셋 (2026-11-26, 시안 Home2).
 *
 * 그리기만 한다. 무엇을 세우고 무슨 글자로 세우는지는 lib/tasks.ts 가, 읽는 일은
 * hooks/dashboard/useToday.ts 가 맡는다 — 숫자를 화면에서 만들면 타일과 목록이
 * 조용히 어긋난다(둘이 같은 줄을 세기 때문에 한 곳에서 만들어야 한다).
 *
 * 목록의 줄은 두 가지다.
 *   · 표의 줄   — 체크로 완료한다(/api/task).
 *   · 합성 줄   — 체크가 없다. 원본을 처리해야 사라진다(발주가 나면 그 줄도 사라진다).
 *     누르면 그 원본으로 간다.
 */

import { useState, type CSSProperties, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { BLUE_TINT, BLUE, BORDER, CARD_BG, NEUTRAL_BG, TEXT } from '@/components/common/ui'
import { TEXT_DISABLED, TEXT_LABEL, TEXT_NOTE } from '@/lib/textTokens'
import { KIND_LABEL, bucketOf, dueLabel, type TaskItem, type TileCounts } from '@/lib/tasks'
import { numKR } from '@/components/customer/constants'
import { R } from '@/lib/radius'

const CARD: CSSProperties = {
  background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: R.card, padding: '14px 16px',
  display: 'flex', flexDirection: 'column', minWidth: 0,
}
const CARD_TITLE: CSSProperties = { fontSize: 14, fontWeight: 700, color: TEXT }
const COUNT: CSSProperties = {
  fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: R.pill,
  background: NEUTRAL_BG, color: TEXT_NOTE,
}
/** 지남·지연을 알리는 자리 — 디자인 표의 위험색을 글자에만 쓴다(틴트 배경은 뱃지에만). */
const LATE = '#b91c1c'
const LATE_BG = '#fee2e2'
const WARN = '#92400e'
const WARN_BG = '#fef3c7'

// ── 타일 여섯 ───────────────────────────────────────────────────────────────

/** 숫자 하나를 크게 — 누르면 그 목록으로 간다. 0 이어도 자리를 지킨다. */
function Tile({ label, value, tone, onClick }: {
  label: string
  value: number
  tone?: 'late' | 'warn'
  onClick?: () => void
}) {
  const color = value === 0 ? TEXT_DISABLED : tone === 'late' ? LATE : tone === 'warn' ? WARN : TEXT
  return (
    <button
      type="button" onClick={onClick} disabled={!onClick}
      style={{
        ...CARD, alignItems: 'center', gap: 2, cursor: onClick ? 'pointer' : 'default',
        fontFamily: 'inherit', textAlign: 'center',
      }}
    >
      <span style={{ fontSize: 11, color: TEXT_DISABLED }}>{label}</span>
      <b className="num" style={{ fontSize: 24, fontWeight: 800, color, letterSpacing: '-0.5px' }}>{value}</b>
    </button>
  )
}

export function TodayTiles({ counts, go }: { counts: TileCounts; go: (where: string) => void }) {
  return (
    <div className="today-tiles">
      <Tile label="지난 할 일" value={counts.late} tone="late" />
      <Tile label="오늘 할 일" value={counts.today} />
      <Tile label="멈춘 딜 (14일+)" value={counts.stale} tone="warn" onClick={() => go('/pipeline')} />
      <Tile label="미배정 리드" value={counts.lead} onClick={() => go('/leads')} />
      <Tile label="결재 대기" value={counts.approval} onClick={() => go('/approval')} />
    </div>
  )
}

// ── 할 일 목록 ──────────────────────────────────────────────────────────────

const tagStyle = (tone?: 'late' | 'today'): CSSProperties => ({
  fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: R.tag, flexShrink: 0,
  background: tone === 'late' ? LATE_BG : tone === 'today' ? BLUE_TINT : NEUTRAL_BG,
  color: tone === 'late' ? LATE : tone === 'today' ? BLUE : TEXT_LABEL,
})

/** 합성 줄을 누르면 가는 곳. 대상이 지워졌으면 아무 데도 가지 않는다. */
function hrefOf(it: TaskItem): string | null {
  if (!it.refId) return null
  if (it.refType === 'quote') return '/quote'
  if (it.refType === 'lead') return '/leads'
  if (it.refType === 'forecast') return '/pipeline'
  if (it.refType === 'customer') return `/customer/${it.refId}`
  if (it.refType === 'device') return null
  return null
}

export function TaskListCard({ items, today, loading, note, onAdd, onToggle }: {
  items: readonly TaskItem[]
  today: string
  loading: boolean
  /** 표가 아직 없을 때의 한 줄(lib/tasks.ts 의 TASK_SCHEMA_MESSAGE). */
  note?: string | null
  onAdd: () => void
  onToggle: (it: TaskItem) => void
}) {
  const router = useRouter()
  // 체크한 줄은 **그 자리에서** 지워 보인다(라우트 왕복을 기다리지 않는다).
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const shown = items.filter(it => !checked.has(it.key))

  return (
    <div style={CARD}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={CARD_TITLE}>할 일</span>
        <span style={COUNT}>{shown.length}</span>
        <span style={{ flex: 1 }} />
        <button
          type="button" onClick={onAdd}
          style={{
            height: 26, padding: '0 10px', borderRadius: R.control, border: `1px solid ${BORDER}`,
            background: CARD_BG, fontSize: 12, fontWeight: 700, color: BLUE, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          ＋ 할 일
        </button>
      </div>
      {note ? (
        <div style={{ fontSize: 12, color: TEXT_NOTE, padding: '10px 0' }}>{note}</div>
      ) : loading ? (
        <div style={{ fontSize: 12, color: TEXT_DISABLED, padding: '10px 0' }}>불러오는 중…</div>
      ) : shown.length === 0 ? (
        <div style={{ fontSize: 12, color: TEXT_NOTE, padding: '10px 0' }}>오늘 할 일이 없습니다</div>
      ) : (
        <div style={{ overflowY: 'auto', minHeight: 0 }}>
          {shown.map((it, i) => {
            const b = bucketOf(it.due, today)
            const href = it.real ? null : hrefOf(it)
            return (
              <div
                key={it.key}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', fontSize: 13,
                  borderTop: i === 0 ? 'none' : `1px solid ${BORDER}`,
                }}
              >
                {it.real ? (
                  <input
                    type="checkbox" checked={false} aria-label="완료"
                    onChange={() => { setChecked(s => new Set(s).add(it.key)); onToggle(it) }}
                    style={{ flexShrink: 0, cursor: 'pointer' }}
                  />
                ) : (
                  // 합성 줄은 체크가 없다 — 자리는 남겨 둔다(줄마다 글자가 어긋나지 않게).
                  <span style={{ width: 13, flexShrink: 0 }} />
                )}
                <span style={tagStyle(b === 'late' ? 'late' : b === 'today' ? 'today' : undefined)}>
                  {dueLabel(it.due, today)}
                </span>
                <span
                  onClick={href ? () => router.push(href) : undefined}
                  style={{
                    flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    color: TEXT, cursor: href ? 'pointer' : 'default',
                  }}
                  title={it.title}
                >
                  {it.title}
                </span>
                <span style={tagStyle()}>{KIND_LABEL[it.kind]}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── 작은 카드 셋 ────────────────────────────────────────────────────────────

/** 제목 + 건수 + 줄 몇 개. 둘이 같은 틀을 쓴다(멈춘 딜·미배정 리드). */
function MiniCard({ title, count, tone, empty, children, onClick }: {
  title: string
  count: number
  tone?: 'warn'
  empty: string
  children: ReactNode
  onClick?: () => void
}) {
  return (
    <div
      style={{ ...CARD, cursor: onClick ? 'pointer' : 'default' }}
      onClick={onClick}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={CARD_TITLE}>{title}</span>
        <span style={{ ...COUNT, ...(tone === 'warn' && count > 0 ? { background: WARN_BG, color: WARN } : null) }}>{count}</span>
      </div>
      {count === 0
        ? <div style={{ fontSize: 12, color: TEXT_NOTE, padding: '10px 0' }}>{empty}</div>
        : <div style={{ overflowY: 'auto', minHeight: 0 }}>{children}</div>}
    </div>
  )
}

const miniRow = (first: boolean): CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', fontSize: 13,
  borderTop: first ? 'none' : `1px solid ${BORDER}`,
})
const miniName: CSSProperties = {
  flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: TEXT,
}

export function StaleDealsCard({ rows, onOpen }: {
  rows: readonly { opportunity_id: number; title: string | null; company?: string | null; expected_amount?: number | null; idleDays: number }[]
  onOpen: () => void
}) {
  return (
    <MiniCard title="멈춘 딜" count={rows.length} tone="warn" empty="14일 넘게 멈춘 건이 없습니다" onClick={onOpen}>
      {rows.slice(0, 6).map((d, i) => (
        <div key={d.opportunity_id} style={miniRow(i === 0)}>
          <span style={miniName} title={`${d.company ?? ''} ${d.title ?? ''}`}>
            {d.company ? `${d.company} » ` : ''}{d.title ?? `포캐스트 ${d.opportunity_id}`}
            {d.expected_amount ? <span style={{ color: TEXT_NOTE }}> · {numKR(d.expected_amount)}</span> : null}
          </span>
          <span style={{ ...tagStyle(), background: WARN_BG, color: WARN }}>
            {d.idleDays > 9000 ? '활동 없음' : `${d.idleDays}일`}
          </span>
        </div>
      ))}
    </MiniCard>
  )
}

// 「교정·점검 예정」 카드는 2026-11-26 지시로 **뺐다**(교정 주기·유형이 정해지지 않았다).
// 작은 카드의 틀(MiniCard)은 그대로다 — 멈춘 딜·미배정 리드가 쓴다.

export function UnassignedLeadsCard({ rows, onOpen }: {
  rows: readonly { lead_id: number; lead_no: string | null; company: string | null; created_at: string | null }[]
  onOpen: () => void
}) {
  return (
    <MiniCard title="미배정 리드" count={rows.length} empty="배정할 리드가 없습니다" onClick={onOpen}>
      {rows.slice(0, 6).map((l, i) => (
        <div key={l.lead_id} style={miniRow(i === 0)}>
          <span style={miniName} title={`${l.lead_no ?? ''} ${l.company ?? ''}`}>
            {l.lead_no ?? `리드 ${l.lead_id}`}{l.company ? ` · ${l.company}` : ''}
          </span>
          <span style={tagStyle()}>{(l.created_at ?? '').slice(5, 10)} 등록</span>
        </div>
      ))}
    </MiniCard>
  )
}
