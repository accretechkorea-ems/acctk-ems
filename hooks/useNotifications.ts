'use client'


export type Notification = {
  id: number
  engineer_id: number
  title: string
  message: string
  type: string
  link: string | null
  is_read: boolean
  created_at: string
}

// 알림 **조회**는 이 파일에 없다 — lib/appData/notifications.ts 의 스토어 하나뿐이다
// (사이드바 배지·홈 카드·알림 화면이 같은 한 벌을 본다. 60초 폴링, 탭이 숨으면 멈춤).
// 여기에는 **모양과 글자**만 남긴다 — 알림 한 줄의 타입과 상대 시간 라벨이다.

// 상대 시간 라벨 ('방금' / 'N분 전' / …). 알림 목록에서 공용으로 쓴다.
export function formatTime(ts: string): string {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (diff < 60) return '방금'
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`
  return `${Math.floor(diff / 86400)}일 전`
}
