// 포캐스트 집계가 쓸 **조회**만. 계산은 lib/forecast.ts(순수)가 한다.
//
// 둘을 나누는 이유 — 계산 쪽을 스크립트로 그대로 돌려 값으로 증명할 수 있게 하려고다
// (scripts/forecast-check.js). 이 파일은 supabase 클라이언트를 받아 쓰기만 하고 만들지 않는다
// (화면은 createClient() 로, 서버 라우트는 service role 로 각자 만들어 넘긴다).

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildForecast,
  type ForecastEngineer, type ForecastOpportunity, type ForecastQuote,
  type ForecastResult, type ForecastTarget,
} from './forecast'
import { inSalesStats } from './salesScope'

/** 읽는 칸을 글자로 못박는다 — select('*') 는 새 칸이 생길 때마다 화면으로 끌려 들어온다. */
const QUOTE_COLUMNS =
  'quote_id, quote_number, status, quote_date, purchase_order_at, fail_reason, total_supply, '
  + 'category, form_kind, engineer_id, customer_id, dealer_id, opportunity_id, created_at, pdf_url'

const OPP_COLUMNS =
  'opportunity_id, stage, expected_close, expected_amount, engineer_id, customer_id, '
  + 'closed_at, created_at, updated_at'

export type LoadForecastArgs = {
  /** 'YYYY-MM'. 집계에 남길 가장 이른 달. */
  from?: string
  /** 'YYYY-MM'. 집계에 남길 마지막 달. */
  to?: string
  /** 'YYYY-MM-DD'(한국). 지연 판정의 기준일. */
  today: string
}

/**
 * 포캐스트 집계에 필요한 네 표를 읽어 그대로 buildForecast 에 넘긴다.
 *
 * ⚠ **날짜로 거르지 않고 전부 읽는다.** 견적의 예상월은 발주일에서도 오는데(수주확정),
 *   발주는 견적일보다 한참 뒤일 수 있어 quote_date 로 자르면 그 줄이 조용히 사라진다.
 *   지금 규모가 작아서(견적 100건 미만·영업기회 수십 건) 전부 읽는 편이 틀리지 않는다.
 *   규모가 커지면 **발주일까지 함께 보는** 범위 조건을 넣어야 한다 — 그때 이 주석을 지워라.
 *
 * 조회가 실패하면 그 표만 빈 배열로 두고 계속한다 — 한 표를 못 읽었다고 화면 전체를
 * 비우지 않는다. 대신 어떤 표가 비었는지 errors 로 돌려준다.
 */
export async function loadForecast(
  sb: SupabaseClient, args: LoadForecastArgs,
): Promise<ForecastResult & { errors: string[] }> {
  const [qRes, oRes, tRes, eRes, teamRes] = await Promise.all([
    sb.from('quotes').select(QUOTE_COLUMNS),
    sb.from('sales_opportunities').select(OPP_COLUMNS),
    sb.from('sales_targets').select('engineer_id, year, quarter, order_target_amount'),
    // 집계 대상 판정에 개인 값(in_sales_stats)과 팀 이름이 필요하다 — 팀 값은 아래 teams 에서.
    sb.from('engineers').select('engineer_id, team_id, teams, in_sales_stats'),
    sb.from('teams').select('name, in_sales_stats'),
  ])

  const errors: string[] = []
  const take = <T>(res: { data: unknown; error: { message: string } | null }, name: string): T[] => {
    if (res.error) { errors.push(`${name}: ${res.error.message}`); return [] }
    return (res.data as T[]) ?? []
  }

  /**
   * **집계 대상자만 남긴다**(lib/salesScope.ts). 예전에는 전원의 견적·기회가 들어가,
   * 같은 자료를 보는 실적 현황(대상자만)과 모수가 달랐다.
   * 담당자가 비어 있는 줄은 남긴다 — 누구 것인지 모르는 금액을 조용히 지우지 않는다.
   */
  type EngRow = ForecastEngineer & { teams: string | null; in_sales_stats: boolean | null }
  const engRows = take<EngRow>(eRes, 'engineers')
  const teamFlag = new Map(
    take<{ name: string | null; in_sales_stats: boolean | null }>(teamRes, 'teams')
      .filter(t => !!t.name)
      .map(t => [t.name as string, { inSalesStats: t.in_sales_stats === true }]),
  )
  const scoped = new Set(
    engRows
      .filter(e => inSalesStats(e, e.teams ? teamFlag.get(e.teams) : null))
      .map(e => e.engineer_id),
  )
  const mine = (engineerId: number | null | undefined) => engineerId == null || scoped.has(engineerId)

  const built = buildForecast({
    quotes: take<ForecastQuote>(qRes, 'quotes').filter(q => mine(q.engineer_id)),
    opportunities: take<ForecastOpportunity>(oRes, 'sales_opportunities').filter(o => mine(o.engineer_id)),
    targets: take<ForecastTarget>(tRes, 'sales_targets').filter(t => mine(t.engineer_id)),
    engineers: engRows,
    today: args.today,
    from: args.from,
    to: args.to,
  })

  return { ...built, errors }
}
