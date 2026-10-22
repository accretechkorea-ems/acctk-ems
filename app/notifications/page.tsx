'use client'

// 알림 전용 화면. 사이드바의 「알림」과 모바일 상단 바의 종이 여기로 온다.
// 목록 렌더는 대시보드 카드와 같은 NotificationList 를 그대로 쓰고,
// 이 화면은 필터·날짜 묶음·[더 보기] 만 얹는다.
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { usePageGuard } from '@/hooks/usePageGuard'
import AccessGate from '@/components/common/AccessGate'
import SegmentedControl from '@/components/common/SegmentedControl'
import NotificationList from '@/components/common/NotificationList'
import { type Notification } from '@/hooks/useNotifications'
import { useNotificationStore } from '@/lib/appData/notifications'
import { NOTI_GROUPS, notiGroupOf } from '@/lib/notificationGroups'
import {
  PAGE_BG, CARD_BG, BORDER, TEXT, MUTED, SUB, BLUE, NEUTRAL_BG, inputStyle,
} from '@/components/common/ui'

// 유형 묶음 규칙은 lib/notificationGroups.ts 에 있다 — 홈의 알림 카드가 같은 규칙으로 센다.
const TYPE_TABS = ['전체', ...NOTI_GROUPS]

/** 날짜 묶음 — 오늘 / 어제 / 이번 주 / 그 이전. */
function dateBucket(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const t = d.getTime()
  if (t >= startOfToday) return '오늘'
  if (t >= startOfToday - 86400000) return '어제'
  if (t >= startOfToday - 6 * 86400000) return '이번 주'
  return '그 이전'
}
const BUCKET_ORDER = ['오늘', '어제', '이번 주', '그 이전']

export default function NotificationsPage() {
  const router = useRouter()
  const { engineer, loading: guardLoading, authorized } = usePageGuard()

  const [readTab, setReadTab] = useState('전체')
  const [typeTab, setTypeTab] = useState('전체')

  // 조회는 **앱 당 한 벌인 스토어**가 한다(사이드바 배지·홈 카드와 같은 자료).
  const { notifications, unreadCount, loading, hasMore, loadMore, markAsRead, markAllAsRead } =
    useNotificationStore(engineer?.engineer_id ?? null)

  // 읽음·유형 둘 다 **받아 온 목록에서** 거른다(예전에는 읽음이 조회 조건이었다 —
  // 조회를 한 벌로 모으면서 표시 필터로 옮겼다. 모자라면 [더 보기]로 더 받는다).
  const filtered = useMemo(() => notifications
    .filter(n => (readTab === '안 읽음' ? !n.is_read : true))
    .filter(n => (typeTab === '전체' ? true : notiGroupOf(n.type) === typeTab)),
  [notifications, readTab, typeTab])

  // 날짜 묶음으로 나눈다. 목록은 이미 최신순이라 순서를 다시 잡지 않는다.
  const buckets = useMemo(() => {
    const map = new Map<string, Notification[]>()
    for (const n of filtered) {
      const k = dateBucket(n.created_at)
      const arr = map.get(k)
      if (arr) arr.push(n)
      else map.set(k, [n])
    }
    return BUCKET_ORDER.filter(k => map.has(k)).map(k => ({ label: k, items: map.get(k)! }))
  }, [filtered])

  const handleClick = (n: Notification) => {
    markAsRead(n.id)
    if (n.link) router.push(n.link)
  }

  if (!authorized) return <AccessGate loading={guardLoading} />

  return (
    <main style={{ padding: '24px 28px', background: PAGE_BG, minHeight: '100vh' }}>
      <div style={{ maxWidth: 840, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: TEXT, margin: 0, letterSpacing: '-0.3px' }}>알림</h1>
            <p style={{ fontSize: 13, color: SUB, marginTop: 6 }}>
              {unreadCount > 0 ? `읽지 않은 알림 ${unreadCount}건` : '읽지 않은 알림이 없습니다'}
            </p>
          </div>
          <button
            type="button"
            onClick={markAllAsRead}
            disabled={unreadCount === 0}
            style={{
              padding: '8px 14px', borderRadius: 6, border: `1px solid ${BORDER}`, background: CARD_BG,
              color: unreadCount === 0 ? MUTED : BLUE, fontWeight: 700, fontSize: 13,
              cursor: unreadCount === 0 ? 'default' : 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit',
            }}
          >
            모두 읽음
          </button>
        </div>

        {/* 필터 — 읽음 여부는 조회 조건, 유형은 표시 필터다 */}
        <div style={{
          background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '14px 16px',
          marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        }}>
          <SegmentedControl options={['전체', '안 읽음']} value={readTab} onChange={setReadTab} />
          <select
            value={typeTab}
            onChange={e => setTypeTab(e.target.value)}
            aria-label="유형"
            style={{ ...inputStyle, width: 'auto', minWidth: 130, marginLeft: 'auto' }}
          >
            {TYPE_TABS.map(t => <option key={t} value={t}>{t === '전체' ? '유형 전체' : t}</option>)}
          </select>
        </div>

        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: MUTED, fontSize: 13 }}>불러오는 중...</div>
          ) : buckets.length === 0 ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: MUTED, fontSize: 13 }}>알림이 없습니다</div>
          ) : (
            buckets.map(b => (
              <div key={b.label}>
                <div style={{
                  padding: '8px 16px', background: NEUTRAL_BG, borderBottom: `1px solid ${BORDER}`,
                  fontSize: 11, fontWeight: 700, color: SUB,
                }}>
                  {b.label}
                </div>
                <NotificationList notifications={b.items} onItemClick={handleClick} />
              </div>
            ))
          )}
        </div>

        {/* 받아 온 것이 꽉 찼을 때만 더 받을 수 있다 */}
        {!loading && hasMore && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
            <button
              type="button"
              onClick={loadMore}
              style={{
                padding: '9px 18px', borderRadius: 6, border: `1px solid ${BORDER}`, background: CARD_BG,
                color: TEXT, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              더 보기
            </button>
          </div>
        )}
      </div>
    </main>
  )
}
