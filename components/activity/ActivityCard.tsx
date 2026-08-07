'use client'

import { type ReactNode } from 'react'
import { SERVICE_TYPE_COLORS, getCategoryColor } from '@/lib/categoryColors'

// 활동 카드에 표시하는 서비스 유형(단일 소스). 활동 현황 페이지·대시보드가 공유한다.
export const SERVICE_TYPES = ['신규설치', '이전설치', 'A/S', 'B/S', '교육', '유선기술지원']

const CARD_BG = '#ffffff'
const BORDER = '#ebebeb'
const TEXT = '#111827'
const MUTED = '#9ca3af'
const BLUE = '#234ea2'

type Props = {
  engineer: { name: string | null; position: string | null; teams: string | null }
  counts: Record<string, number>
  total: number
  onClick?: () => void       // 있으면 클릭 가능 카드(hover). 클릭 시 상세 모달 오픈은 부모가 처리.
  headerRight?: ReactNode    // 헤더 우측 슬롯. 주면 팀 뱃지 대신 렌더(대시보드 월 스테퍼용).
}

export default function ActivityCard({ engineer, counts, total, onClick, headerRight }: Props) {
  const clickable = !!onClick
  return (
    <div
      onClick={onClick}
      style={{
        background: CARD_BG, borderRadius: 8, padding: '14px 16px',
        border: `1px solid ${BORDER}`, cursor: clickable ? 'pointer' : 'default',
        transition: 'transform 0.15s ease, border-color 0.15s ease',
      }}
      onMouseEnter={clickable ? (e => { const el = e.currentTarget as HTMLDivElement; el.style.transform = 'translateY(-2px)'; el.style.borderColor = '#c7d7f8' }) : undefined}
      onMouseLeave={clickable ? (e => { const el = e.currentTarget as HTMLDivElement; el.style.transform = ''; el.style.borderColor = BORDER }) : undefined}
    >
      {/* 이름 + 팀 뱃지 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, paddingBottom: 12, borderBottom: `1px solid ${BORDER}` }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, color: TEXT, letterSpacing: '-0.3px', lineHeight: 1.2, marginBottom: 3 }}>
            {engineer.name}
          </div>
          <div style={{ fontSize: 11, color: MUTED, fontWeight: 500 }}>
            {engineer.position ?? ''}
          </div>
        </div>
        {headerRight ?? (engineer.teams && (
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 99, flexShrink: 0,
            background: '#f3f4f6',
            color: '#6b7280',
          }}>
            {engineer.teams}
          </span>
        ))}
      </div>

      {/* 서비스 타입별 건수 */}
      <div style={{ display: 'grid', gap: 7, marginBottom: 12 }}>
        {SERVICE_TYPES.map((type) => {
          const sc = getCategoryColor(SERVICE_TYPE_COLORS, type)
          const cnt = counts[type] ?? 0
          return (
            <div key={type} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 9, height: 9, borderRadius: '50%', background: cnt > 0 ? (sc.dot ?? sc.text) : '#d1d5db', flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: cnt > 0 ? '#111827' : '#d1d5db', fontWeight: cnt > 0 ? 500 : 400 }}>{type}</span>
              </div>
              <span style={{
                fontSize: 12, fontWeight: 600,
                color: cnt > 0 ? (sc.dot ?? sc.text) : '#d1d5db',
                background: cnt > 0 ? '#f3f4f6' : 'transparent',
                borderRadius: cnt > 0 ? 6 : 0,
                padding: cnt > 0 ? '2px 8px' : '2px 0',
              }}>
                {cnt}<span style={{ color: cnt > 0 ? '#9ca3af' : '#d1d5db' }}>건</span>
              </span>
            </div>
          )
        })}
      </div>

      {/* 합계 */}
      <div style={{
        padding: '5px 0', borderTop: `1px solid ${BORDER}`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: MUTED }}>합계</span>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
          <span style={{ fontSize: 20, fontWeight: 600, color: BLUE, letterSpacing: '-0.5px' }}>
            {total}
          </span>
          <span style={{ fontSize: 11, fontWeight: 600, color: MUTED }}>건</span>
        </div>
      </div>
    </div>
  )
}
