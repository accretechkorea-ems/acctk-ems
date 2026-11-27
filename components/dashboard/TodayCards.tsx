'use client'

/**
 * 홈 「내 오늘」 — **할 일 카드 하나**다 (2026-11-26 묶음2 A).
 *
 * 그리기만 한다. 무엇을 세우고 무슨 글자로 세우는지는 lib/tasks.ts 가, 읽는 일은
 * hooks/dashboard/useToday.ts 가 맡는다 — 숫자를 화면에서 만들면 제목의 수와 목록이
 * 조용히 어긋난다(둘이 같은 줄을 세기 때문에 한 곳에서 만들어야 한다).
 *
 * 목록의 줄은 두 가지다.
 *   · 표의 줄   — 체크로 완료한다(/api/task).
 *   · 합성 줄   — 체크가 없다. 원본을 처리해야 사라진다(발주가 나면 그 줄도 사라진다).
 *     누르면 그 원본으로 간다.
 *
 * ⚠ **타일 줄과 작은 카드 둘은 2026-11-26(묶음2 A1)에 뺐다.**
 *   타일 다섯(지난 할 일·오늘 할 일·멈춘 딜·미배정 리드·결재 대기)은 아래 목록이 이미
 *   같은 줄을 세고 있어 같은 말을 두 번 했다. 지남·오늘은 **카드 제목 옆 한 줄**로 옮겼고,
 *   미배정 리드·결재 대기는 **목록의 줄**로 이미 서 있다(lib/tasks.ts 의 leadItems·
 *   approvalItems). 멈춘 딜·교정 예정 카드는 판정 규칙이 정해지지 않아 함께 걷었다.
 *   되살릴 때는 lib/tasks.ts 에 세는 함수를 먼저 두고 여기서 그리는 순서다.
 */

import { useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { BLUE_TINT, BLUE, BORDER, CARD_BG, NEUTRAL_BG, TEXT } from '@/components/common/ui'
import { TEXT_DISABLED, TEXT_LABEL, TEXT_NOTE } from '@/lib/textTokens'
import { KIND_LABEL, bucketOf, dueLabel, type TaskItem } from '@/lib/tasks'
import { R } from '@/lib/radius'
import { siteListHref } from '@/lib/mapPopup'

const CARD: CSSProperties = {
  background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: R.card, padding: '14px 16px',
  display: 'flex', flexDirection: 'column', minWidth: 0,
}
const CARD_TITLE: CSSProperties = { fontSize: 14, fontWeight: 700, color: TEXT }
/** 지남·지연을 알리는 자리 — 디자인 표의 위험색을 글자에만 쓴다(틴트 배경은 뱃지에만). */
const LATE = '#b91c1c'
const LATE_BG = '#fee2e2'

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
  // 고객사는 **분할 보기**로 간다(2026-11-28, 야간4 7-1) — 단독 상세는 없앴다.
  if (it.refType === 'customer') return siteListHref(it.refId)
  if (it.refType === 'device') return null
  return null
}

export function TaskListCard({ items, today, late, now, loading, note, onAdd, onToggle }: {
  items: readonly TaskItem[]
  today: string
  /** 제목 옆 「지남 N」. 세는 일은 lib/tasks.ts 의 dueCounts 가 한다. */
  late: number
  /** 제목 옆 「오늘 N」. */
  now: number
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
        {/* 「지남 N · 오늘 N」 — 타일 줄을 대신한다(A2). 0 이면 흐리게 두되 자리는 지킨다. */}
        <span style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
          <span style={{ color: late === 0 ? TEXT_DISABLED : LATE }}>지남 {late}</span>
          <span style={{ color: TEXT_DISABLED, fontWeight: 400 }}> · </span>
          <span style={{ color: now === 0 ? TEXT_DISABLED : TEXT }}>오늘 {now}</span>
        </span>
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
                ) : it.pin ? (
                  // 늘 맨 위에 서는 줄(실주 사유 미입력) — **빨간 점**으로 알린다(A2).
                  // 체크 자리에 점을 둬, 줄마다 글자가 시작하는 자리가 어긋나지 않는다.
                  <span aria-label="사유 미입력" title="실주 사유를 아직 적지 않았습니다"
                    style={{ width: 13, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: LATE }} />
                  </span>
                ) : (
                  // 합성 줄은 체크가 없다 — 자리는 남겨 둔다(줄마다 글자가 어긋나지 않게).
                  <span style={{ width: 13, flexShrink: 0 }} />
                )}
                <span style={tagStyle(it.pin ? 'late' : b === 'late' ? 'late' : b === 'today' ? 'today' : undefined)}>
                  {it.pin ? '사유 없음' : dueLabel(it.due, today)}
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

// 「교정·점검 예정」 카드는 2026-11-26 지시로 뺐다(교정 주기·유형이 정해지지 않았다).
// 「멈춘 딜」·「미배정 리드」 카드와 그 틀(MiniCard)도 같은 날 묶음2 A1 로 걷었다 —
// 멈춘 딜은 판의 카드 흐림(C3)과 정렬이 대신하고, 미배정 리드는 목록의 줄로 선다.
