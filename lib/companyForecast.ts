// 회사 카드의 **포캐스트 블록** — 진행 중인 영업 기회를 몇 줄로 요약한다.
//
// 왜 따로 두는가: 같은 자료를 두 곳이 쓴다 — 회사 카드의 요약 블록과 활동 이력의
// 「포캐스트」 종류. 둘이 어긋나면(한쪽은 실주를 세고 한쪽은 안 세는 식) 사람이
// 어느 쪽을 믿어야 할지 모른다. 그래서 「무엇이 진행 중인가」를 여기 한 번만 적는다.
//
// 진행 중의 뜻은 components/customer/opportunity.ts 의 `isClosed` 가 정본이다
// (실주이거나 closed_at 이 찍힌 건이 끝난 건. 수주는 납품 전까지 진행 중으로 본다).

import { isClosed } from '@/components/customer/opportunity'
import type { SalesOpportunity } from '@/components/customer/types'

export type ForecastLine = {
  id: number
  title: string
  /** 어느 사업장의 건인가. 회사 화면에서만 채워진다. */
  siteName: string
  stage: string
  /** 예정 시기 — 'YYYY M월'. 비어 있으면 ''. */
  when: string
  amount: number | null
  owner: string
}

export type ForecastBlock = {
  /** 진행 중인 건수 — 보여 주는 줄 수와 다를 수 있다(줄은 몇 개만 보인다). */
  count: number
  /** 진행 중 건의 예상 금액 합계. 금액이 빈 건은 0으로 센다. */
  total: number
  lines: ForecastLine[]
}

/**
 * 예정 시기 라벨 — `expected_close` 는 date 칸이지만 **월 단위로만** 입력받는다
 * (components/customer/opportunity.ts 의 `monthToDate` 가 그 달 말일로 저장한다).
 * 그러므로 분기가 아니라 달로 적는다. 분기를 담는 칸은 어디에도 없다.
 */
export const whenLabel = (expectedClose: string | null | undefined): string => {
  const v = (expectedClose ?? '').trim()
  if (v.length < 7) return ''
  const y = v.slice(0, 4)
  const m = Number(v.slice(5, 7))
  if (!/^\d{4}$/.test(y) || !Number.isInteger(m) || m < 1 || m > 12) return ''
  return `${y} ${m}월`
}

/** 담당자 표시 — 「이름 직급」. 직급이 비면 이름만. */
export const ownerLabel = (e: { name: string; position: string | null } | null | undefined): string => {
  const name = (e?.name ?? '').trim()
  if (!name) return ''
  const pos = (e?.position ?? '').trim()
  return pos ? `${name} ${pos}` : name
}

/**
 * 진행 중인 건을 **금액 큰 순**으로 모은다. 금액이 같으면 예정 시기가 이른 순,
 * 그마저 같으면 최근에 만든 순이다(어느 줄이 위에 올지 매번 흔들리지 않게).
 */
export function companyForecast(input: {
  opportunities: SalesOpportunity[]
  /** 사업장 id → 이름. 사업장 화면에서는 주지 않는다(줄에 사업장을 적지 않는다). */
  siteName?: (id: number | null | undefined) => string
  /** 보여 줄 줄 수. 넘치는 건은 세기만 한다. */
  limit?: number
}): ForecastBlock {
  const { opportunities, siteName, limit = 3 } = input
  const open = opportunities.filter(o => !isClosed(o))
  const total = open.reduce((sum, o) => sum + (o.expected_amount ?? 0), 0)

  const sorted = [...open].sort((a, b) => {
    const av = a.expected_amount ?? 0
    const bv = b.expected_amount ?? 0
    if (av !== bv) return bv - av
    const ac = a.expected_close ?? '9999-99-99'
    const bc = b.expected_close ?? '9999-99-99'
    if (ac !== bc) return ac < bc ? -1 : 1
    return b.opportunity_id - a.opportunity_id
  })

  return {
    count: open.length,
    total,
    lines: sorted.slice(0, limit).map(o => ({
      id: o.opportunity_id,
      title: (o.title ?? '').trim(),
      siteName: siteName ? siteName(o.customer_id) : '',
      stage: o.stage,
      when: whenLabel(o.expected_close),
      amount: o.expected_amount,
      owner: ownerLabel(o.engineers),
    })),
  }
}
