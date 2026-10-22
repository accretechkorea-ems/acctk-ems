'use client'

// 개인 대시보드의 작은 카드들 — 포캐스트 · 알림 · 결재 대기.
// 「내 견적」은 파일이 따로 있다(큰 모달이 붙어 있어 길다).
//
// 카드는 **자기 자료만** 본다. 숫자 규칙은 lib/homeCards.ts, 조회는 useDashboardCards 가 맡고
// 여기서는 그리기만 한다 — 그래야 한 카드가 실패해도 다른 카드가 멀쩡히 뜬다.

import { useState } from 'react'
import DashCard from './DashCard'
import { CountList, CountTotal, type CountRow } from '@/components/common/CountList'
import EngineerStatCard, { type StatCardEngineer } from '@/components/sales/EngineerStatCard'
import EngineerChartModal from '@/components/sales/EngineerChartModal'
import { engineerStat, type StatQuote, type StatTarget } from '@/lib/salesStats'
import { countByKey, stageBars, type CardOpportunity } from '@/lib/homeCards'
import { DOC_TYPE_DOT_COLORS, NOTI_GROUP_DOT_COLORS, STAGE_DOT_COLORS, dotColorOf } from '@/lib/categoryColors'
import { DOC_TYPE_KEYS, docTypeOf } from '@/lib/approval/docTypes'
import { NOTI_GROUPS, notiGroupOf } from '@/lib/notificationGroups'
import type { ApprovalRow, NotificationRow, Slot } from '@/hooks/dashboard/useDashboardCards'

const TEXT = '#111827'

// ── 내 실적 ─────────────────────────────────────────────────────────────────

/**
 * 본인 한 명분 실적 — **실적 현황의 개인 카드 그대로**다(부품을 함께 쓴다).
 *
 * 카드 껍데기(DashCard)를 두르지 않는다. 두르면 테두리 안에 테두리, 제목 아래 또 제목이
 * 들어가 카드가 두 겹이 됐다. 이 부품이 곧 격자 카드다 — 머리줄만 title 로 갈아 끼운다
 * (실적 현황은 이름·직급·팀, 홈은 「내 실적 · FY2026」). 껍데기는 **못 읽었을 때만** 쓴다.
 *
 * 다른 것은 누를 때뿐이다: 실적 현황은 견적 목록으로 가지만, 홈은 카드 어디를 눌러도
 * **월별 매출 그래프**가 바로 열린다(견적 목록은 옆의 「내 견적」 카드가 맡는다).
 *
 * 회계연도 전체(mode: 'year')를 본다 — 홈에서 먼저 보고 싶은 것은 올해 성적이다.
 * 기간 선택은 실적 현황에서 한다.
 */
export function MyStatCard({ engineer, quotes, targets, fy, loading, error }: {
  engineer: StatCardEngineer
  quotes: StatQuote[]
  targets: StatTarget[]
  fy: number
  loading: boolean
  error: boolean
}) {
  const [chartOpen, setChartOpen] = useState(false)
  const stat = engineerStat(quotes, targets, { engineerId: engineer.engineer_id, fy, mode: 'year', month: 1 })
  // 숫자를 못 읽었을 때만 껍데기를 쓴다 — 0 원과 「못 읽었다」는 전혀 다른 일이다.
  if (loading || error) return <DashCard title={`내 실적 · FY${fy}`} loading={loading} error={error}>{null}</DashCard>
  return (
    <>
      <EngineerStatCard
        engineer={engineer}
        stat={stat}
        // 내 카드라 이름은 군더더기다. 자리에 카드 제목을 넣는다(오른쪽 달성률 % 는 그대로).
        title={<span style={{ fontSize: 14, fontWeight: 700, color: TEXT }}>내 실적 · FY{fy}</span>}
        compact
        delay={80}
        onClick={() => setChartOpen(true)}
      />
      {chartOpen && (
        <EngineerChartModal
          engineer={engineer}
          quotes={quotes}
          targets={targets}
          fy={fy}
          onClose={() => setChartOpen(false)}
        />
      )}
    </>
  )
}

// ── 포캐스트 ────────────────────────────────────────────────────────────────

/**
 * 내 포캐스트를 **단계별 건수**로. 줄·카드 모두 포캐스트 화면으로 간다.
 *
 * 금액 막대는 뺐다 — 다섯 카드가 같은 틀(점·이름·건수·합계)을 쓰기로 했고, 금액은
 * 포캐스트 화면과 엑셀이 제대로 보여 준다. 카드에서 알고 싶은 것은 「몇 건이 떠 있는가」다.
 */
export function ForecastCard({ slot, onOpen }: { slot: Slot<CardOpportunity[]>; onOpen: () => void }) {
  const bars = stageBars(slot.data)
  const rows: CountRow[] = bars
    .filter(b => b.count > 0)
    .map(b => ({ key: b.stage, label: b.stage, count: b.count, color: dotColorOf(STAGE_DOT_COLORS, b.stage), onClick: onOpen }))
  return (
    <DashCard title="포캐스트" onClick={onOpen} loading={slot.loading} error={slot.error} errorMessage={slot.message}>
      <CountList rows={rows} emptyText="진행 중인 포캐스트가 없습니다" fitHeight />
      <CountTotal total={bars.reduce((s, b) => s + b.count, 0)} />
    </DashCard>
  )
}

// ── 알림 ────────────────────────────────────────────────────────────────────

/**
 * 안 읽은 알림을 **종류별 건수**로. 묶음은 알림 화면과 같은 규칙이다(lib/notificationGroups.ts).
 *
 * 예전에는 최근 다섯 건의 제목을 늘어놓았다. 제목은 카드 폭에서 거의 잘리고, 어차피 눌러
 * 알림 화면으로 가야 읽을 수 있었다 — 카드에서 알고 싶은 것은 「어떤 알림이 몇 건 밀렸는가」다.
 * 줄·카드 모두 알림 화면으로 간다.
 */
export function NotificationCard({ slot, onOpenAll }: {
  slot: Slot<NotificationRow[]>
  onOpenAll: () => void
}) {
  const rows: CountRow[] = countByKey(slot.data, n => notiGroupOf(n.type ?? ''), NOTI_GROUPS)
    .map(c => ({ key: c.key, label: c.key, count: c.count, color: dotColorOf(NOTI_GROUP_DOT_COLORS, c.key), onClick: onOpenAll }))
  return (
    <DashCard title="알림" onClick={onOpenAll} loading={slot.loading} error={slot.error} errorMessage={slot.message}>
      <CountList rows={rows} emptyText="읽지 않은 알림이 없습니다" fitHeight />
      <CountTotal total={slot.data.length} />
    </DashCard>
  )
}

// ── 결재 대기 ───────────────────────────────────────────────────────────────

/**
 * 내가 결재할 문서를 **종류별 건수**로(견적서·쇼룸 사용 신청·견적 삭제 요청…).
 * 이름은 등록표의 label 을 그대로 쓴다(lib/approval/docTypes.ts) — 결재함과 같은 말이다.
 *
 * **0 건이어도 카드는 그대로 있는다.** 예전에는 부르는 쪽이 `data.length > 0` 일 때만 그려서,
 * 결재할 것이 없는 사람에게는 카드가 아예 없었다 — 그러면 「없다」와 「조회가 깨졌다」를
 * 구분할 수 없다. 못 읽었을 때는 그 이유(errorMessage)까지 카드에 적는다.
 *
 * 줄·카드 모두 결재함으로 간다(문서 하나로 바로 가는 길은 결재함이 더 잘 보여 준다).
 */
export function ApprovalCard({ slot, onOpenAll }: {
  slot: Slot<ApprovalRow[]>
  onOpenAll: () => void
}) {
  const rows: CountRow[] = countByKey(slot.data, d => d.doc_type ?? '기타', DOC_TYPE_KEYS)
    .map(c => ({
      key: c.key,
      label: docTypeOf(c.key)?.label ?? c.key,
      count: c.count,
      color: dotColorOf(DOC_TYPE_DOT_COLORS, c.key),
      onClick: onOpenAll,
    }))
  return (
    <DashCard title="결재 대기" onClick={onOpenAll} loading={slot.loading} error={slot.error} errorMessage={slot.message}>
      <CountList rows={rows} emptyText="대기 중인 문서가 없습니다" fitHeight />
      <CountTotal total={slot.data.length} />
    </DashCard>
  )
}
