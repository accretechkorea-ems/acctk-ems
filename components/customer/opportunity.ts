// 영업기회 공용 상수·유틸. 모달·요약 패널·훅이 함께 쓴다.
// 값은 sales_opportunities 의 CHECK 제약과 일치해야 한다.

import { numKR } from './constants'
import type { SalesOpportunity } from './types'

// '매상확정' 은 영업 단계가 아니라 회계 단계라 뺐다.
// 그 흐름은 quotes.status(견적중 → 발주 → 주문완료 → 매출완료)가 담당하고,
// 매출이 확정되면 이 기회는 closed_at 이 찍히며 종료된다.
export const STAGES = ['상담', '사양검토', '견적제출', '협상', '수주', '실주'] as const
export type Stage = typeof STAGES[number]

// 단계만으로 끝난 것이 되는 경우는 실주뿐이다.
// 수주는 납품 전까지 취소·연기가 있을 수 있어 여전히 '진행 중'으로 본다.
export const CLOSED_STAGES: readonly string[] = ['실주']
export const isClosedStage = (stage: string) => CLOSED_STAGES.includes(stage)

// 종료 판정의 정본. 실주이거나 closed_at 이 찍혀 있으면 끝난 건이다.
// (stage 에 '종료' 같은 값을 더하지 않고 closed_at 하나로 표현한다)
export const isClosed = (o: SalesOpportunity) => !!o.closed_at || isClosedStage(o.stage)

export const LOST_REASONS = [
  '가격', '사양·기술', '납기', '경쟁사 선정', '예산 보류·취소', '사내 결정 지연', '기타',
] as const

// 진행 순서대로 정렬하기 위한 순위 (목록에서 수주 → 상담 순으로 위에 오게)
const ORDER = new Map(STAGES.map((s, i) => [s as string, i]))
export const stageRank = (stage: string) => ORDER.get(stage) ?? 99

// 좁은 요약 패널에 들어가도록 금액을 줄여 쓴다. 1.5억 / 8천만 / 500만
export function compactKRW(n: number | null): string {
  if (!n) return '-'
  const trim = (v: number) => (v % 1 === 0 ? String(v) : v.toFixed(1))
  if (n >= 1e8) return `₩${trim(Math.round((n / 1e8) * 10) / 10)}억`
  if (n >= 1e7) return `₩${trim(Math.round((n / 1e7) * 10) / 10)}천만`
  if (n >= 1e4) return `₩${numKR(Math.round(n / 1e4))}만`
  return `₩${numKR(n)}`
}

// expected_close 는 date 컬럼이지만 월 단위로만 입력받는다.
//   저장: 'YYYY-MM' → 'YYYY-MM-01'   / 표시·입력: 'YYYY-MM-01' → 'YYYY-MM'
export const monthToDate = (ym: string) => (ym ? `${ym}-01` : null)
export const dateToMonth = (d: string | null) => (d ? d.slice(0, 7) : '')
