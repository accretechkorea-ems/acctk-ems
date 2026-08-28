// 홀딩 공용 유틸. 요약 패널·장비 카드·타임라인·모달이 함께 쓴다.

import type { Holding } from './types'

export const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 경과일수. 진행 중이면 오늘까지, 해제됐으면 해제일까지.
export function elapsedDays(h: Holding): number {
  const from = Date.parse(`${h.started_at}T00:00:00`)
  const to = h.resolved_at ? Date.parse(`${h.resolved_at}T00:00:00`) : Date.now()
  if (Number.isNaN(from) || Number.isNaN(to)) return 0
  return Math.max(0, Math.floor((to - from) / 86400000))
}

// 카드·목록에 쓰는 짧은 라벨
export const elapsedLabel = (h: Holding) =>
  h.resolved_at ? `${elapsedDays(h)}일 만에 해제` : `${elapsedDays(h)}일째`

export const deviceLabel = (h: Holding) =>
  [h.devices?.device_name, h.devices?.device_name2].filter(Boolean).join(' ') || '-'

// 홀딩 상세 타임라인에 끌어오는 서비스 레포트(읽기 전용).
// service_history 에서 그 장비의 홀딩 기간에 걸친 방문만 골라 담는다.
export type HoldingReport = {
  service_id: number
  visit_date: string | null
  service_type: string | null
  service_notes: string | null
  report_url: string | null
  engineerNames: string      // 방문 엔지니어 이름 (여러 명이면 쉼표)
}
