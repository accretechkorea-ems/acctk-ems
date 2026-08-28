'use client'

import type { CSSProperties } from 'react'
import { formatTime, type Notification } from '@/hooks/useNotifications'

// 한 줄로 자르기(말줄임). compact 에서만 쓴다.
const ONE_LINE: CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }

// 알림 목록 렌더 전용 컴포넌트. 각 행은 Header 드롭다운과 시각적으로 동일하다.
// 스크롤/패널 chrome 은 호출부(헤더 드롭다운·대시보드 카드)가 감싼다.
type Props = {
  notifications: Notification[]
  onItemClick: (n: Notification) => void
  emptyText?: string
  // 좁은 카드용. 제목·내용을 각각 한 줄로 잘라 한 건이 2줄을 넘지 않게 한다.
  // 헤더 드롭다운은 기본값(줄바꿈 허용) 그대로다.
  compact?: boolean
}

export default function NotificationList({ notifications, onItemClick, emptyText = '알림이 없습니다', compact = false }: Props) {
  if (notifications.length === 0) {
    return <div style={{ padding: '32px 0', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>{emptyText}</div>
  }
  return (
    <>
      {notifications.map(notif => (
        <div key={notif.id}
          onClick={() => onItemClick(notif)}
          style={{
            padding: '11px 16px', cursor: 'pointer',
            background: notif.is_read ? '#fff' : '#eff6ff',
            borderBottom: '1px solid #f5f5f5',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = '#f0f4ff')}
          onMouseLeave={e => (e.currentTarget.style.background = notif.is_read ? '#fff' : '#eff6ff')}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: notif.is_read ? 600 : 800, fontSize: 13, color: '#111', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                {!notif.is_read && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#234ea2', flexShrink: 0, display: 'inline-block' }} />}
                <span style={compact ? ONE_LINE : undefined}>{notif.title}</span>
              </div>
              <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.4, ...(compact ? ONE_LINE : null) }}>
                {notif.message}
              </div>
            </div>
            <div style={{ fontSize: 11, color: '#9ca3af', whiteSpace: 'nowrap', flexShrink: 0, marginTop: 1 }}>
              {formatTime(notif.created_at)}
            </div>
          </div>
        </div>
      ))}
    </>
  )
}
