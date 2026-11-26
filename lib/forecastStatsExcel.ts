// 통계용 엑셀 — **포캐스트 1건 + 포캐스트에 안 붙은 확정 견적 1장**이 한 줄이다
// (2026-11-27 야간3 3).
//
// ── 기존 「엑셀 내보내기」와 무엇이 다른가 ─────────────────────────────────
//   그쪽(lib/forecastExcel.ts)은 **본사 보고용**이다 — 월별 목표 대비 수주·실주를 버킷으로
//   묶어 두 시트로 낸다. 숫자가 화면과 한 원도 달라지면 안 되므로 화면이 만든 값을 받아 적는다.
//
//   이쪽은 **통계용**이다. 「우리가 올해 무엇을 얼마에 쫓았고 어떻게 끝났나」를 한 줄씩
//   늘어놓는다 — 피벗을 돌릴 자료다. 그래서 집계하지 않고 **낱건**을 적는다.
//
// ── 왜 미연결 견적도 한 줄인가 ─────────────────────────────────────────────
//   포캐스트를 안 만들고 견적부터 쓴 건이 적지 않다. 그 건을 빼면 「쫓은 일」의 절반이
//   표에서 사라진다. 그래서 **포캐스트에 안 붙은 확정 견적**(quotes.opportunity_id 가 빈
//   것)도 한 줄로 센다 — 구분 칸이 둘을 가른다.
//
// 순수 함수만 둔다(DB·화면을 모른다) — 하네스가 그대로 돌린다.

import { MAIN_GROUP_KIND } from './deliveryPending'

// ── 종류 판정 ───────────────────────────────────────────────────────────────
//
// 「장비 / 소모품 / 업그레이드 / 수리 / 기타」 다섯. 가르는 차례는 **위에서부터**다 —
// 한 건이 여러 조건에 걸릴 수 있어(수리 건에 본체 줄이 붙기도 한다) 차례가 곧 규칙이다.
//
//   ① 수리         — 견적이 수리 건에 묶여 있다(repair_id). 분류가 '수리'여도 같다.
//   ② 업그레이드   — 분류(quotes.category)가 업그레이드다.
//   ③ 장비         — 품목에 **본체 줄**(group_kind = 'base')이 하나라도 있다.
//   ④ 소모품       — 분류가 소모품·부품이거나, 본체 줄 없이 품목만 있다.
//   ⑤ 기타         — 위 어디에도 안 걸린다(품목을 못 읽은 건 포함).

export const STATS_KINDS = ['장비', '소모품', '업그레이드', '수리', '기타'] as const
export type StatsKind = (typeof STATS_KINDS)[number]

/** 분류 코드·이름에 그 낱말이 들었나(코드가 영문이어도 이름으로 걸린다). */
const has = (v: string | null | undefined, ...words: string[]): boolean => {
  const s = String(v ?? '').toLowerCase()
  return words.some(w => s.includes(w.toLowerCase()))
}

export type StatsItem = { group_kind?: string | null }

export type KindInput = {
  /** 견적 분류(quotes.category) — 코드 또는 이름. */
  category?: string | null
  /** 그 분류의 **이름**(관리 화면에서 고친 글자). 코드만 있으면 비워도 된다. */
  categoryLabel?: string | null
  /** 수리 건에 묶여 있나. */
  repairId?: number | null
  /** 견적 품목 — 본체 줄이 있는지만 본다. */
  items?: readonly StatsItem[] | null
}

/** 그 건의 **종류** 한 낱말. 규칙은 위 머리말의 차례 그대로다. */
export function statsKindOf(input: KindInput): StatsKind {
  const { category, categoryLabel, repairId, items } = input
  const name = `${category ?? ''} ${categoryLabel ?? ''}`
  if (repairId != null || has(name, '수리', 'repair')) return '수리'
  if (has(name, '업그레이드', 'upgrade')) return '업그레이드'
  const lines = items ?? []
  if (lines.some(it => String(it.group_kind ?? '').trim() === MAIN_GROUP_KIND)) return '장비'
  if (has(name, '소모품', '부품', 'part', 'consum')) return '소모품'
  if (lines.length > 0) return '소모품'
  return '기타'
}

// ── 한 줄 ───────────────────────────────────────────────────────────────────

/** 표의 열 — 순서가 곧 머리줄이다. */
export const STATS_HEAD = [
  '구분', '종류', '회사', '사업장', '대리점', '담당자', '팀', '품명', '금액',
  '생성일', '단계/상태', '종료 상태', '종료일', '실주 사유', '경쟁사', '연결 견적 번호',
] as const

export type StatsRow = {
  /** '포캐스트' 또는 '견적 단독'. */
  kindOfUnit: '포캐스트' | '견적 단독'
  kind: StatsKind
  company: string
  site: string
  dealer: string
  owner: string
  team: string
  /** 첫 품목의 이름. */
  product: string
  /** 원 단위 — **전체 자릿수**로 적는다(축약하지 않는다. 피벗을 돌릴 자료다). */
  amount: number
  createdAt: string
  /** 포캐스트면 단계, 견적이면 상태. */
  stage: string
  /** 수주 · 실주 · 취소 · 진행. */
  result: '수주' | '실주' | '취소' | '진행'
  closedAt: string
  lostReason: string
  competitor: string
  /** 연결된 견적 번호들(쉼표로 잇는다). */
  quoteNos: string
}

/** 한 줄을 표의 칸 차례대로. */
export const statsRowCells = (r: StatsRow): (string | number)[] => [
  r.kindOfUnit, r.kind, r.company, r.site, r.dealer, r.owner, r.team, r.product, r.amount,
  r.createdAt, r.stage, r.result, r.closedAt, r.lostReason, r.competitor, r.quoteNos,
]

/** 시트 전체 — 머리줄 + 줄들. 생성일 **내림차순**으로 세운다. */
export function statsAoA(rows: readonly StatsRow[]): (string | number)[][] {
  const sorted = [...rows].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1
    return a.company < b.company ? -1 : 1
  })
  return [[...STATS_HEAD], ...sorted.map(statsRowCells)]
}

/** 파일 이름 — 「포캐스트통계_{기간}_{yyyymmdd}.xlsx」. 쓸 수 없는 글자는 뗀다. */
export function statsFileName(periodLabel: string, today: string): string {
  const ymd = today.replace(/-/g, '')
  const safe = String(periodLabel).replace(/[\\/:*?"<>|\s]/g, '')
  return `포캐스트통계_${safe}_${ymd}.xlsx`
}

/** 내보낸다. xlsx 는 누를 때 비로소 불러온다(초기 번들에 넣지 않는다). */
export async function exportForecastStatsXlsx(rows: readonly StatsRow[], periodLabel: string, today: string): Promise<void> {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(statsAoA(rows)), '통계')
  XLSX.writeFile(wb, statsFileName(periodLabel, today))
}
