// 쇼룸 화면 주소(쿼리스트링) ↔ 상태. 주소가 원본이다 — 새로고침·뒤로 가기·링크 공유에도 같은 화면이 열린다.
//   /showroom                                   장비 탭(기본)
//   /showroom?tab=util                          가동률 탭
//   /showroom?tab=usage&devices=3,7&purpose=측정대행&q=기아&from=2026-09-01&to=2026-09-30&page=2
//                                               전체기록 탭
// 잘못된 값은 조용히 기본값으로 둔다(주소를 손으로 고쳐도 화면이 깨지지 않게). JSX 없음.

import { daysBetween, nowKSTParts } from '@/lib/date'
import { isUsagePurpose, isValidYmd, periodRange, MAX_PERIOD_DAYS } from '@/lib/showroom'

export const SHOWROOM_PATH = '/showroom'

export type ShowroomTab = 'devices' | 'util' | 'usage'
export const parseTab = (v: string | null): ShowroomTab => (v === 'util' || v === 'usage' ? v : 'devices')

/** 전체기록 탭의 필터. devices 가 비면 전체 장비, purpose 가 null 이면 전체 목적. */
export type UsageQuery = {
  from: string
  to: string
  devices: number[]
  purpose: string | null
  /** 검색어 — 입력한 그대로 둔다(앞뒤 공백은 거를 때만 뗀다). */
  q: string
  page: number
}

/** 검색어 최대 길이(주소가 한없이 길어지지 않게). */
export const SEARCH_MAX = 100

/** 기본 기간 — 이번 달(KST) 1일~말일. */
export function defaultUsageRange(): { from: string; to: string } {
  const { y, m } = nowKSTParts()
  return periodRange({ mode: 'month', year: y, month: m })
}

type Params = { get(name: string): string | null }

export function parseUsageQuery(p: Params): UsageQuery {
  let from = p.get('from') ?? ''
  let to = p.get('to') ?? ''
  if (!isValidYmd(from) || !isValidYmd(to) || from > to || daysBetween(from, to) + 1 > MAX_PERIOD_DAYS) {
    ({ from, to } = defaultUsageRange())
  }
  const devices = [...new Set((p.get('devices') ?? '').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0))]
  const purposeRaw = p.get('purpose')
  const pageNum = Number(p.get('page'))
  return {
    from,
    to,
    devices,
    purpose: isUsagePurpose(purposeRaw) ? purposeRaw : null,
    q: (p.get('q') ?? '').slice(0, SEARCH_MAX),
    page: Number.isInteger(pageNum) && pageNum >= 1 ? pageNum : 1,
  }
}

/**
 * 전체기록 탭 주소. 기본값(전체 장비·전체 목적·빈 검색·1쪽)은 적지 않는다.
 * 기간은 늘 적는다 — 적지 않으면 '이번 달'이라 달이 바뀐 뒤 새로고침하면 다른 목록이 열린다.
 */
export function usageHref(u: UsageQuery): string {
  const q = new URLSearchParams({ tab: 'usage' })
  if (u.devices.length > 0) q.set('devices', u.devices.join(','))
  if (u.purpose) q.set('purpose', u.purpose)
  if (u.q.trim()) q.set('q', u.q)
  q.set('from', u.from)
  q.set('to', u.to)
  if (u.page > 1) q.set('page', String(u.page))
  return `${SHOWROOM_PATH}?${q.toString()}`
}
