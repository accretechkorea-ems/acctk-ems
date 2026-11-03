// 홀딩 공용 유틸. 요약 패널·장비 카드·타임라인·모달이 함께 쓴다.

import type { Holding } from './types'
import { daysBetween, todayKST } from '@/lib/date'
import { isDisposed } from '@/lib/deviceStatus'


// 경과일수. 진행 중이면 오늘(한국 기준)까지, 해제됐으면 해제일까지.
export function elapsedDays(h: Holding): number {
  return Math.max(0, daysBetween(h.started_at, h.resolved_at ?? todayKST()))
}

// 카드·목록에 쓰는 짧은 라벨
export const elapsedLabel = (h: Holding) =>
  h.resolved_at ? `${elapsedDays(h)}일 만에 해제` : `${elapsedDays(h)}일째`

export const deviceLabel = (h: Holding) =>
  [h.devices?.device_name, h.devices?.device_name2].filter(Boolean).join(' ') || '-'

/**
 * 그 홀딩이 가리키는 장비가 **폐기**됐나 — 이름 옆 「폐기」 뱃지가 이것을 본다.
 *
 * 홀딩은 지난 기록이라 폐기된 장비를 그대로 가리킨다. 이름을 비우거나 줄을 숨기지 않는다
 * (숨기면 아직 안 풀린 홀딩이 조용히 사라진다) — 대신 지금은 쓰지 않는 장비임을 알린다.
 * 조회가 status 를 빼고 읽어 왔으면 거짓이다(lib/deviceStatus.ts 머리말 — 모르면 사용중).
 */
export const isHoldingDeviceDisposed = (h: Holding): boolean => isDisposed(h.devices)

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
