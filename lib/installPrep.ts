// 신규 설치 준비 체크리스트 — 항목 정의와 판정.
//
// 화면(components/customer/InstallPrepSection.tsx)·라우트(app/api/install-prep/route.ts)·
// 80 대시보드가 모두 이 파일을 본다. 항목이 늘면 여기 PREP_ITEMS 와
// service_install_prep.item_key 의 CHECK 를 함께 고친다(그 둘이 유일한 기준이다).
//
// 상태값은 저장값이 곧 화면 글자다 — 중간 번역표를 두지 않는다(결재 상태값과 같은 방식).

import type { InstallPrep } from '@/components/customer/types'
import { isFutureVisit } from '@/lib/serviceVisit'

/** 준비를 챙기는 서비스 유형. service_history.service_type 의 저장값 그대로다. */
export const INSTALL_SERVICE_TYPE = '신규설치'

/** service_install_prep.status 에 들어가는 값 전부. */
export const PREP_DONE = '협의완료'
export const PREP_PENDING = '미확인'
export const PREP_STATUSES = [PREP_DONE, PREP_PENDING] as const
export type PrepStatus = (typeof PREP_STATUSES)[number]

/** 항목이 받는 추가 정보의 모양. 두 가지뿐이라 칸 구성도 둘이다. */
export type PrepFieldSet =
  /** 업체명 · 기사 연락처 · 예정시각 */
  | 'vendor'
  /** 협의 상대 */
  | 'counterpart'

export type PrepItem = {
  key: string
  label: string
  fields: PrepFieldSet
  /** 예정시각 칸의 이름 — 화물은 하차, 지게차는 도착이다. */
  timeLabel?: string
}

/** 고정 4종. 화면에 나오는 순서이기도 하다. */
export const PREP_ITEMS: PrepItem[] = [
  { key: 'freight', label: '화물', fields: 'vendor', timeLabel: '하차 예정시각' },
  { key: 'site', label: '설치 장소 협의', fields: 'counterpart' },
  { key: 'waste', label: '폐기물 처리 협의', fields: 'counterpart' },
  { key: 'forklift', label: '지게차', fields: 'vendor', timeLabel: '도착 예정시각' },
]

export const PREP_ITEM_KEYS: string[] = PREP_ITEMS.map(i => i.key)

/** 등록되지 않은 항목은 null — 라우트가 400 으로 막는다. */
export const prepItemOf = (key: unknown): PrepItem | null =>
  (typeof key === 'string' ? PREP_ITEMS.find(i => i.key === key) ?? null : null)

export const isPrepStatus = (v: unknown): v is PrepStatus =>
  typeof v === 'string' && (PREP_STATUSES as readonly string[]).includes(v)

/** 설치 준비를 챙겨야 하는 방문인가 — 신규설치이고 아직 오지 않은 날. */
export const isInstallPrepTarget = (
  serviceType: string | null | undefined,
  visitDate: string | null | undefined,
  today?: string,
): boolean => serviceType === INSTALL_SERVICE_TYPE && isFutureVisit(visitDate, today)

/**
 * 방문일이 지난 신규설치 건 — 구역을 감추지 않고 읽기 전용으로 남긴다.
 * 당일 현장에서 「화물 누가 확인했더라」를 보는 것이 이 기록의 쓸모라, 지나자마자 감추면 손해다.
 */
export const isInstallPrepReadOnly = (
  serviceType: string | null | undefined,
  visitDate: string | null | undefined,
  today?: string,
): boolean => serviceType === INSTALL_SERVICE_TYPE && !!visitDate && !isFutureVisit(visitDate, today)

export type PrepSummary = {
  done: number
  total: number
  /** 아직 미확인인 첫 항목 이름. 전부 끝났으면 null. */
  firstPending: string | null
  allDone: boolean
}

/** 목록(없는 항목은 미확인으로 본다)에서 요약을 만든다. 대시보드 한 줄이 이 값을 쓴다. */
export function prepSummary(rows: InstallPrep[] | null | undefined): PrepSummary {
  const byKey = new Map((rows ?? []).map(r => [r.item_key, r]))
  const done = PREP_ITEMS.filter(i => byKey.get(i.key)?.status === PREP_DONE).length
  const firstPending = PREP_ITEMS.find(i => byKey.get(i.key)?.status !== PREP_DONE) ?? null
  return {
    done,
    total: PREP_ITEMS.length,
    firstPending: firstPending?.label ?? null,
    allDone: done === PREP_ITEMS.length,
  }
}

/** 대시보드 칸의 한 줄 — 「준비 2/4 · 지게차」, 전부 끝났으면 「준비 완료」. */
export function prepSummaryText(s: PrepSummary): string {
  if (s.allDone) return '준비 완료'
  return `준비 ${s.done}/${s.total}${s.firstPending ? ` · ${s.firstPending}` : ''}`
}

/** 칸이 좁아 위 문구가 넘칠 때 쓰는 짧은 꼴 — 항목 이름을 뺀다. */
export function prepSummaryShort(s: PrepSummary): string {
  return s.allDone ? '준비 완료' : `준비 ${s.done}/${s.total}`
}
