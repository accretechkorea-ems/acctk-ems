'use client'

import { type ReactNode } from 'react'
import { CountList, CountTotal, type CountRow } from '@/components/common/CountList'
import { ACTIVITY_TYPE_COLORS, getCategoryColor } from '@/lib/categoryColors'

// 서비스 유형(단일 소스). 영업 4종까지 합친 전체 목록은 lib/activity.ts 의 ACTIVITY_TYPES.
// (여기 두는 이유: 상세 모달의 유형 필터가 서비스 유형만 쓴다)
// 순서는 성격순이다 — 계획된 현장 작업(설치·교정) → 고장 대응(A/S·B/S) → 그 밖(교육·원격).
export const SERVICE_TYPES = ['신규설치', '이전설치', '장비교정', 'A/S', 'B/S', '교육', '유선기술지원']

// 목록과 합계의 모양은 components/common/CountList.tsx 에 있다(홈 카드 다섯이 같이 쓴다).
// 6줄 고정·줄 높이 20·간격 7·점 9px 전부 그 파일로 옮겼다 — 여기서 쓰는 값과 같다.

const CARD_BG = '#ffffff'
const BORDER = '#ebebeb'
const TEXT = '#111827'
const MUTED = '#9ca3af'

type Props = {
  engineer: { name: string | null; position: string | null; teams: string | null }
  counts: Record<string, number>
  total: number
  onClick?: () => void       // 있으면 클릭 가능 카드(hover). 클릭 시 상세 모달 오픈은 부모가 처리.
  headerRight?: ReactNode    // 헤더 우측 슬롯. 주면 팀 뱃지 대신 렌더(대시보드 월 스테퍼용).
  types?: string[]           // 표시 후보 유형과 그 순서. 미지정 시 서비스 6종.
  /**
   * 주어진 칸 높이에 맞춘다(홈 격자). 유형 목록이 남는 높이를 갖고 **합계는 바닥에 남는다** —
   * 고정 높이(6줄)를 그대로 쓰면 260px 칸에서 합계가 잘려 나간다.
   * 활동 현황 화면은 이 값을 주지 않아 종전 그대로 6줄 고정이다.
   */
  fitHeight?: boolean
}

export default function ActivityCard({ engineer, counts, total, onClick, headerRight, types = SERVICE_TYPES, fitHeight = false }: Props) {
  const clickable = !!onClick
  // 0건 유형은 숨긴다. 순서는 넘겨받은 목록(서비스 6종 → 영업 4종) 그대로.
  const rows: CountRow[] = types
    .filter(t => (counts[t] ?? 0) > 0)
    .map(t => {
      const sc = getCategoryColor(ACTIVITY_TYPE_COLORS, t)
      return { key: t, label: t, count: counts[t] ?? 0, color: sc.dot ?? sc.text }
    })
  return (
    <div
      onClick={onClick}
      style={{
        background: CARD_BG, borderRadius: 8, padding: '14px 16px',
        border: `1px solid ${BORDER}`, cursor: clickable ? 'pointer' : 'default',
        transition: 'transform 0.15s ease, border-color 0.15s ease',
        // 칸 높이에 맞출 때만 세로 flex — 목록이 남는 높이를 갖고 합계가 바닥에 남는다.
        ...(fitHeight ? { height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' as const } : null),
      }}
      onMouseEnter={clickable ? (e => { const el = e.currentTarget as HTMLDivElement; el.style.transform = 'translateY(-2px)'; el.style.borderColor = '#c7d7f8' }) : undefined}
      onMouseLeave={clickable ? (e => { const el = e.currentTarget as HTMLDivElement; el.style.transform = ''; el.style.borderColor = BORDER }) : undefined}
    >
      {/* 이름 + 팀 뱃지 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, paddingBottom: 12, borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
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

      {/* 유형별 건수 — 6줄 높이 고정(홈에서는 칸에 맞춤), 넘치면 이 안에서 스크롤 */}
      <CountList rows={rows} emptyText="활동 기록 없음" fitHeight={fitHeight} />
      <CountTotal total={total} />
    </div>
  )
}
