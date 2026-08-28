'use client'

import { type ReactNode } from 'react'
import { ACTIVITY_TYPE_COLORS, getCategoryColor } from '@/lib/categoryColors'

// 서비스 유형(단일 소스). 영업 4종까지 합친 전체 목록은 lib/activity.ts 의 ACTIVITY_TYPES.
// (여기 두는 이유: 상세 모달의 유형 필터가 서비스 6종만 쓴다)
export const SERVICE_TYPES = ['신규설치', '이전설치', 'A/S', 'B/S', '교육', '유선기술지원']

// 카드의 유형 목록은 6줄 높이로 고정한다 — 사람마다 유형 수가 달라도 카드 높이가 들쭉날쭉하지 않게.
// 유형이 6개를 넘으면(서비스+영업이 섞인 사람) 이 영역 안에서만 세로로 스크롤된다.
const ROW_H = 20
const ROW_GAP = 7
const LIST_H = ROW_H * 6 + ROW_GAP * 5

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
  types?: string[]           // 표시 후보 유형과 그 순서. 미지정 시 서비스 6종.
}

export default function ActivityCard({ engineer, counts, total, onClick, headerRight, types = SERVICE_TYPES }: Props) {
  const clickable = !!onClick
  // 0건 유형은 숨긴다. 순서는 넘겨받은 목록(서비스 6종 → 영업 4종) 그대로.
  const shownTypes = types.filter(t => (counts[t] ?? 0) > 0)
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

      {/* 유형별 건수 — 6줄 높이 고정, 넘치면 이 안에서 스크롤 */}
      <style>{`
        .ac-list { scrollbar-width: thin; scrollbar-color: #d1d5db transparent; }
        .ac-list::-webkit-scrollbar { width: 5px; }
        .ac-list::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 3px; }
        .ac-list::-webkit-scrollbar-track { background: transparent; }
      `}</style>
      <div className="ac-list" style={{ height: LIST_H, overflowY: 'auto', marginBottom: 12 }}>
        {shownTypes.length === 0 ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#d1d5db' }}>
            활동 기록 없음
          </div>
        ) : (
          <div style={{ display: 'grid', gap: ROW_GAP }}>
            {shownTypes.map((type) => {
              const sc = getCategoryColor(ACTIVITY_TYPE_COLORS, type)
              const cnt = counts[type] ?? 0
              return (
                <div key={type} style={{ height: ROW_H, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <div style={{ width: 9, height: 9, borderRadius: '50%', background: sc.dot ?? sc.text, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: '#111827', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{type}</span>
                  </div>
                  <span style={{
                    fontSize: 12, fontWeight: 600, flexShrink: 0,
                    color: sc.dot ?? sc.text,
                    background: '#f3f4f6', borderRadius: 6, padding: '2px 8px',
                  }}>
                    {cnt}<span style={{ color: '#9ca3af' }}>건</span>
                  </span>
                </div>
              )
            })}
          </div>
        )}
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
