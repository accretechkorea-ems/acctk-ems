'use client'

// 파이프라인 칸반 카드 — **다섯 줄**이다 (2026-11-26 묶음2 C3, 캔버스 Kanban 시안).
//
//   1행  회사 » 사업장 ────────────────────────────  굵게. 어느 집 건인지가 먼저다
//   2행  제목(품명)                                  한 줄 말줄임, 회색
//   3행  금액                                        굵게·액센트. 「4억 9,040만」(호버=전액)
//   4행  예정 2026 12월 ····· (아바타) 마지막 활동 N일 전
//   5행  띠 — 이번 달 마감(노랑) · 다음 할 일(늦으면 빨강)
//   그 아래  ＋ 할 일 · 견적 쓰기 · 단계 ▾ · 종료    (호버 때만 — 종전 그대로)
//
// 왜 늘렸나 — 2026-10-28 에 세 줄로 줄였을 때 「언제까지·누가·다음에 무엇을」이 카드에서
// 빠졌다. 그래서 판을 보고도 다음 손이 정해지지 않아, 사람마다 모달을 한 장씩 열어 봤다.
//
// ── 흐림을 걷었다 (2026-11-27 야간3 0-1, 캔버스 KanbanDue A안) ───────────────
//   11-26 에는 14일 넘게 멎은 카드를 **흐리게**(opacity .55) 뒀다. 한 열에 열 장이 넘게
//   쌓이는 화면에서 그 흐림이 **대부분의 카드**에 걸려(실측 30장 중 22장) 판 전체가
//   뿌옇게 보였다 — 눈에 띄게 하려던 것이 오히려 다 같이 묻혔다. 지금은 **카드 전부
//   선명**하고, 멎었다는 사실은 4행의 「N일 전」 **글자만 빨갛게** 말한다.
//   대신 **지금 손이 가야 하는 것**을 띠로 올린다 — 이번 달 마감(노랑)이 그것이다.
//
// 단계 select·견적 쓰기·종료는 평소 감춰두고 호버 때만 띄운다(.pl-card-action, 페이지 전역
// 스타일). **display 로 감춘다** — visibility 로 자리를 남기면 그 줄의 글자가 늘 그만큼
// 좁아진다. 대신 그 줄에 minHeight 를 줘, 호버로 단추가 나타나도 카드가 들썩이지 않는다.

import TaskAddButton from '@/components/task/TaskAddButton'
import { BLUE, BORDER, CARD_BG, NEUTRAL_BG, TEXT } from '@/components/common/ui'
import { TEXT_LABEL, TEXT_NOTE } from '@/lib/textTokens'
import { STAGES } from '@/components/customer/opportunity'
import {
  dueLabelOf, idleLabel, initialsOf, isDueThisMonth, isIdle, isTaskLate, krwFull, krwShort, nextTaskLabel,
  type NextTask,
} from '@/lib/forecastBoard'
import type { SalesOpportunity } from '@/components/customer/types'
import { R } from '@/lib/radius'

const MUTED = '#6b7280'
/** 늦은 할 일 · 멎은 활동 — 홈 할 일 카드의 「지남」과 같은 값이다. */
const LATE = '#b91c1c'
const LATE_BG = '#fee2e2'
/** 이번 달 마감 — 홈 할 일 카드의 「경고」와 같은 값이다(TodayCards 의 WARN). */
const DUE = '#92400e'
const DUE_BG = '#fef3c7'

type Props = {
  opp: SalesOpportunity
  canEdit: boolean
  onOpen: () => void
  onChangeStage: (next: string) => void
  onPickLost: () => void
  onClose?: () => void      // 수주 단계에서만 — 매출 없이 끝난 건을 직접 종료
  /** 이 기회로 견적서를 쓰러 간다(/quote?opportunity=). 주지 않으면 링크를 내지 않는다. */
  onWriteQuote?: () => void
  /** 1행에 적을 회사명(부모 줄의 이름). 비면 사업장명만 선다. */
  company: string
  /** 1행의 꼬리 — 사업장명. 비면 회사명만 선다. */
  site: string
  /** 마지막 활동으로부터 지난 날(lib/forecastBoard.ts 의 idleDaysOf). 모르면 null. */
  idleDays: number | null
  /** 5행에 적을 다음 할 일. 없으면 null — 「다음 할 일 없음」이 선다. */
  nextTask: NextTask | null
  /** 오늘('YYYY-MM-DD') — 할 일이 늦었는지 가린다. */
  today: string
}

export default function OpportunityCard({
  opp, canEdit, onOpen, onChangeStage, onPickLost, onClose, onWriteQuote,
  company, site, idleDays, nextTask, today,
}: Props) {
  const quoteCount = opp.quotes?.length ?? 0
  const owner = (opp.engineers?.name ?? '').trim()
  /** 14일 넘게 멎었나 — **카드를 흐리게 하지 않고** 4행 글자만 빨갛게 한다(0-1). */
  const stalled = isIdle(idleDays)
  const late = isTaskLate(nextTask, today)
  /** 예정 월이 **이번 달**인가 — 5행 위에 노란 띠가 선다(0-2). */
  const dueSoon = isDueThisMonth(opp.expected_close, today)
  const name = [company, site].map(v => v.trim()).filter(Boolean)
  const fullName = name.join(' » ')

  return (
    /* 호버·키보드 포커스는 **공용 링**이다(2026-11-26 묶음2 D).
       ⚠ **흐림(opacity)은 2026-11-27 에 걷었다**(야간3 0-1) — 카드는 전부 선명하다. */
    <div
      className="pl-card ems-pick"
      style={{
        background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: R.control,
        padding: '10px 12px',
      }}
    >
      {/* 1~3행 — 누르면 상세가 열린다(카드에서 가장 넓은 과녁). */}
      <button
        onClick={onOpen}
        style={{
          display: 'block', width: '100%', minWidth: 0, textAlign: 'left',
          padding: 0, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        {/* 1행 — 회사 » 사업장. 잘린 뒷부분은 title 로 본다. */}
        <div
          title={fullName || '-'}
          style={{
            fontSize: 13, fontWeight: 700, color: TEXT, lineHeight: '18px',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}
        >
          {name.length === 0 ? '-' : (
            <>
              {name[0]}
              {name[1] && <span style={{ color: TEXT_LABEL, fontWeight: 600 }}>{' » '}{name[1]}</span>}
            </>
          )}
        </div>

        {/* 2행 — 품명·제목 */}
        <div
          title={opp.title}
          style={{
            fontSize: 12, color: TEXT_NOTE, lineHeight: '16px', marginTop: 1,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}
        >
          {opp.title}
        </div>

        {/* 3행 — 금액. 「1억 2,600만」까지만 적고 **전체 자릿수는 호버**로 본다(K2).
            전에는 compactKRW 의 「1.3억」이었는데, 1억 3천만과 1억 2천 5백만이 같게 보였다. */}
        <div
          title={krwFull(opp.expected_amount)}
          style={{ fontSize: 15, fontWeight: 700, color: BLUE, lineHeight: '20px', marginTop: 2 }}
        >
          {krwShort(opp.expected_amount)}
        </div>
      </button>

      {/* 4행 — 예정월 ····· 담당 이니셜 + 마지막 활동 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, minWidth: 0 }}>
        <span style={{ fontSize: 11, color: MUTED, whiteSpace: 'nowrap', flexShrink: 0 }}>
          {dueLabelOf(opp.expected_close)}
        </span>
        {quoteCount > 0 && (
          <span
            title={`연결된 견적 ${quoteCount}건`}
            style={{
              flexShrink: 0, fontSize: 10, fontWeight: 700, color: BLUE,
              background: NEUTRAL_BG, borderRadius: R.pill, padding: '1px 7px', lineHeight: '16px',
            }}
          >
            견적 {quoteCount}
          </span>
        )}
        <span style={{ flex: 1, minWidth: 0 }} />
        {/* 담당 이니셜 — 색을 쓰지 않는다(중립 배경 + 진한 글자). 이름은 title 로 본다. */}
        <span
          title={`${owner}${opp.engineers?.position ? ` ${opp.engineers.position}` : ''}`.trim() || '담당 없음'}
          style={{
            flexShrink: 0, width: 18, height: 18, borderRadius: '50%', background: NEUTRAL_BG,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 9, fontWeight: 700, color: TEXT_LABEL, letterSpacing: 0,
          }}
        >
          {initialsOf(owner)}
        </span>
        {/* 멎었으면 **이 글자만** 빨갛다(0-1) — 카드를 흐리게 하는 대신이다. */}
        <span
          title={stalled ? `${idleLabel(idleDays)} — 14일 넘게 활동이 없습니다` : undefined}
          style={{
            fontSize: 11, whiteSpace: 'nowrap', flexShrink: 0,
            color: stalled ? LATE : MUTED, fontWeight: stalled ? 600 : 400,
          }}
        >
          {idleLabel(idleDays)}
        </span>
      </div>

      {/* 5행 위 — **이번 달 마감** 띠(0-2). 다음 할 일 띠와 **같은 자리·같은 모양**이고
          바탕만 노랗다. 지난 할 일 빨간 띠가 있으면 **둘 다 쌓인다** — 「이번 달에 닫혀야
          하는데 할 일도 밀렸다」가 한눈에 보여야 한다.
          ⏰ 는 이모지가 아니라 인라인 SVG 다(디자인 규칙: 이모지를 UI 아이콘으로 쓰지 않는다). */}
      {dueSoon && (
        <div
          title={`${dueLabelOf(opp.expected_close)} — 이번 달에 닫히기로 한 건입니다`}
          style={{
            display: 'flex', alignItems: 'center', gap: 4, marginTop: 5,
            padding: '3px 7px', borderRadius: R.tag, minWidth: 0,
            background: DUE_BG, color: DUE, fontSize: 11, fontWeight: 600,
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden>
            <circle cx="12" cy="13" r="8" />
            <path d="M12 9v4l2.5 2.5" />
            <path d="M5 3L2.5 5.5M19 3l2.5 2.5" />
          </svg>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            이번 달 마감
          </span>
        </div>
      )}

      {/* 5행 — 다음 할 일 띠. 늦었으면 빨간 바탕 + ⚠(이모지가 아니라 인라인 SVG). */}
      <div
        title={nextTask ? `${nextTask.due ? `${nextTask.due} · ` : ''}${nextTask.title}` : '이 건에 담아 둔 할 일이 없습니다'}
        style={{
          display: 'flex', alignItems: 'center', gap: 4, marginTop: 5,
          padding: '3px 7px', borderRadius: R.tag, minWidth: 0,
          background: late ? LATE_BG : NEUTRAL_BG,
          color: late ? LATE : nextTask ? TEXT_LABEL : MUTED,
          fontSize: 11, fontWeight: late ? 700 : 500,
        }}
      >
        {late && (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden>
            <path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        )}
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {nextTaskLabel(nextTask)}
        </span>
      </div>

      {/* 그 아래 한 줄 — 종전 동작 그대로(＋ 할 일 · 견적 쓰기 · 단계 ▾ · 종료).
          minHeight 22 는 단계 select 의 높이다 — 호버 때 줄이 커지지 않게 미리 잡아 둔다. */}
      <div className="pl-card-action" style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4, minHeight: 22, justifyContent: 'flex-end' }}>
        {/* 「＋ 할 일」 (2026-11-26, F1·K4) — 「목요일에 전화」 같은 약속을 이 카드에서 바로
            담는다. 창은 홈과 **같은 창**이고 이 건이 박혀 열린다. 끌기 센서가 조작을
            끌기로 오해하지 않게 pointerdown 을 여기서 끊는다(단계 select 와 같은 이유). */}
        <span onPointerDown={e => e.stopPropagation()} style={{ display: 'inline-flex' }}>
          <TaskAddButton
            preset={{ type: 'forecast', id: opp.opportunity_id, label: `${fullName} » ${opp.title}` }}
            kind="forecast"
            label="＋ 할 일"
            style={{ height: 'auto', padding: '1px 6px', border: 'none', background: 'none' }}
          />
        </span>

        {onWriteQuote && (
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={onWriteQuote}
            title="이 포캐스트로 견적서를 작성합니다"
            style={{ padding: '1px 6px', background: 'none', color: BLUE, border: 'none', borderRadius: R.icon, cursor: 'pointer', fontSize: 11, fontWeight: 700, fontFamily: 'inherit', whiteSpace: 'nowrap' }}
          >
            견적 쓰기
          </button>
        )}

        {/* 단계 변경 — 실주를 고르면 사유를 받아야 하므로 모달을 연다 */}
        <select
          value={opp.stage}
          disabled={!canEdit}
          // 드래그 센서가 select 조작을 끌기로 오인하지 않도록 여기서 이벤트를 끊는다
          onPointerDown={e => e.stopPropagation()}
          onChange={e => {
            const next = e.target.value
            if (next === opp.stage) return
            if (next === '실주') onPickLost()
            else onChangeStage(next)
          }}
          title={canEdit ? '단계 변경' : '담당자만 바꿀 수 있습니다'}
          style={{
            maxWidth: 76, padding: '2px 4px', borderRadius: R.icon,
            border: `1px solid ${BORDER}`, background: canEdit ? CARD_BG : '#f9fafb',
            color: canEdit ? TEXT_NOTE : MUTED,
            fontSize: 11, fontWeight: 700, outline: 'none',
            cursor: canEdit ? 'pointer' : 'not-allowed',
          }}
        >
          {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        {/* 수주까지 갔지만 매출로 이어지지 않은(또는 견적을 안 붙인) 건을 직접 끝낼 수 있게. */}
        {onClose && canEdit && (
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={onClose}
            title="이 포캐스트를 종료합니다"
            style={{ padding: '1px 6px', background: NEUTRAL_BG, color: TEXT_NOTE, border: 'none', borderRadius: R.icon, cursor: 'pointer', fontSize: 11, fontWeight: 700, fontFamily: 'inherit' }}
          >
            종료
          </button>
        )}
      </div>
    </div>
  )
}
