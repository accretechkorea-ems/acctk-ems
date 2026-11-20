'use client'

// 업체 상세의 [활동 이력] 탭 — 서비스 기록과 견적을 한 줄기 시간순으로 보여준다.
// 상세가 이미 들고 있는 history / quotes 를 그대로 쓰므로 새 조회는 없다.
// (영업활동 sales_activities 는 다음 단계. 지금은 칩만 있고 항상 0건이다)
//
// visit_date 가 없는 서비스 기록이 1000건 넘게 남아 있어, 날짜순 사이에 끼워 넣지 않고
// 맨 아래 "날짜 미상"으로 접어둔다. 견적은 quote_date 가 항상 있어 여기 해당하지 않는다.

import { useEffect, useMemo, useRef, useState } from 'react'
import { EditIconButton } from '@/components/common/IconButton'
import TimelineFilterModal from '@/components/customer/TimelineFilterModal'
import { SERVICE_TYPE_COLORS, TIMELINE_KIND_COLORS, getCategoryColor, salesStatusLabel } from '@/lib/categoryColors'
import { numKR } from './constants'
import { isDealerQuote } from './utils'
import { deviceLabel, elapsedLabel } from './holding'
import { isDisposed } from '@/lib/deviceStatus'
import type { Device, Holding, Quote, SalesActivity, SalesOpportunity, ServiceHistory } from './types'
import {
  TIMELINE_KINDS, allSelected, applyFilter, countBySite, countByKind, dropChip, filterChips,
  type TimelineFilter, type TimelineKind,
} from '@/lib/timelineFilter'
import { whenLabel, ownerLabel } from '@/lib/companyForecast'
import { INQUIRY_TYPE_LABEL, inquiryTypeOf } from '@/lib/inquiries'
import type { InquiryRow } from '@/hooks/useCompanyTimeline'
import { isFutureVisit } from '@/lib/serviceVisit'
import { timelineKey } from '@/lib/activity'
import { eventLine, type CustomerEvent } from '@/lib/customerEventView'
import { R } from '@/lib/radius'
import { TITLE } from '@/lib/textTokens'

type Props = {
  history: ServiceHistory[]
  devices: Device[]
  quotes: Quote[]
  activities: SalesActivity[]
  holdings: Holding[]
  customerId: number
  onOpenQuotePdf: (q: Quote) => void
  onOpenHolding: (h: Holding) => void
  /** 「+ 기록」 — 영업 활동·포캐스트·홀딩을 한 창에서 고르는 모달을 연다. */
  onAddRecord: () => void
  onEditActivity: (a: SalesActivity) => void
  canEditActivity: (a: SalesActivity) => boolean
  /** 활동 요약에서 넘어온 행 id(lib/activity.ts timelineKey). 그 줄로 스크롤하고 잠깐 밝힌다. */
  focusKey?: string | null
  /** 찾아가기가 끝났을 때(없는 행이어도) 한 번 부른다 — 부르는 쪽이 주소를 정리한다. */
  onFocused?: () => void
  /**
   * **회사 전체 모드** — 이 값을 주면 줄마다 사업장을 보여 주고 위에 사업장 칩 필터가 선다.
   * 사업장 상세는 주지 않는다(지금과 똑같이 그려진다).
   */
  sites?: { id: number; name: string }[]
  /** 카드 제목 — 머리줄 맨 앞에 선다(회사 화면의 「활동 이력」). */
  title?: string
  /** 고객 사건 로그. 회사 전체 모드에서만 넘어온다. */
  events?: CustomerEvent[]
  /** 영업 기회 — 「포캐스트」 종류의 줄을 만든다(만든 날·마지막 고침·종료). */
  opportunities?: SalesOpportunity[]
  /** 이 사업장들에 걸린 의뢰서 — 「의뢰」 종류의 줄이 된다. 연결되지 않은 과거 건은 오지 않는다. */
  inquiries?: InquiryRow[]
  /**
   * 회사 카드의 「전체 보기」를 누른 횟수. 값이 바뀌면 필터를 **포캐스트만**으로 맞춘다
   * (파이프라인 화면으로 떠나지 않고 이 카드에서 바로 본다).
   */
  forecastOnlyAt?: number
  /**
   * 처음에 켜 둘 사업장 칩. 사업장 화면에서 ← 로 돌아왔을 때 **그 사업장이 켜진 채** 열린다
   * — 보던 자리를 잃지 않게. 사람이 칩을 끄면 그때부터는 사람이 고른 대로 둔다.
   */
  initialSiteIds?: number[]
}

// 종류는 lib/timelineFilter.ts 가 정본이다 — 필터 모달과 줄 만들기가 같은 목록을 본다.
// 「사건」은 사람이 적지 않는다 — 리드 등록·담당 배정처럼 **벌어진 일**이다(lib/customerEvents.ts).
// 「포캐스트」도 사람이 직접 적는 줄이 아니라 영업 기회가 생기고 바뀐 자국이다.
type Kind = TimelineKind

type Item = {
  key: string
  kind: Kind
  date: string | null
  label: string          // 종류 라벨 (신규설치 / A/S / 견적 …)
  dot: string
  labelSuffix?: string   // 종류 뒤에 붙는 값 (서비스의 유상/무상)
  title: string          // 장비 모델명 또는 견적번호
  body: string           // 내용 또는 금액·상태
  bodySuffix?: string    // 내용 뒤에 괄호로 붙는 값 (영업 활동에서 만난 고객사 담당자)
  note?: string          // 내용 뒤에 덧붙는 부가정보 (홀딩 경과 등)
  owner: string          // 오른쪽 열 둘째 줄 — 방문 엔지니어 / 작성자
  badge?: string         // 대리점 견적 표시 등
  /** 제목(장비명) 바로 옆 뱃지 — 폐기된 장비를 가리키는 지난 기록에 붙는다. */
  titleBadge?: string
  onClick?: () => void
  onEdit?: () => void    // 영업 활동에만 있다 (호버 시 나타나는 연필)
  sortAt: number         // 정렬 키 — 등록 시각(epoch ms). 종류와 무관하게 이 값만으로 순서가 정해진다
  sortId: number         // 등록 시각까지 같을 때만 쓰는 보조 키 (id 큰 것이 위)
  siteId?: number | null // 어느 사업장의 기록인가 — 회사 전체 모드에서만 쓴다
}

/**
 * 정렬 키. 실제 등록 시각(created_at, timestamptz)을 epoch ms 로 바꾼다.
 *
 * service_history 에는 created_at 컬럼이 아예 없다(스키마는 건드리지 않는다).
 * 그런 소스는 표시 날짜의 KST 자정으로 대신한다 — 같은 날에 다른 종류와 섞이면
 * 서비스가 그날의 맨 아래로 내려간다. 종전에도 서비스는 맨 아래였으므로 보이는 결과는 같다.
 *
 * ⚠ 서비스 기록만 떼어 보면 **lib/serviceSort.ts 와 같은 순서**다 — 날짜 내림차순이
 *   먼저고, 같은 날 안에서는 sortId(= service_id) 가 큰 것이 위다. 규칙의 출처는
 *   그 파일이고, 여기서는 종류를 섞어 늘어놓느라 제 비교자를 쓸 뿐이다.
 */
const sortKey = (createdAt: string | null | undefined, fallbackDate: string | null): number => {
  if (createdAt) {
    const t = Date.parse(createdAt)
    if (!Number.isNaN(t)) return t
  }
  if (fallbackDate) {
    const d = Date.parse(`${fallbackDate}T00:00:00+09:00`)
    if (!Number.isNaN(d)) return d
  }
  return 0
}

// 'YYYY-MM-DD' → '2026년 8월'
const monthLabel = (d: string) => `${d.slice(0, 4)}년 ${Number(d.slice(5, 7))}월`

// 오른쪽 열(날짜·담당자) 최대 폭. '이름 직급' 3명(약 20자)까지 들어가고,
// 그보다 많으면 말줄임 → 마우스를 올리면 전체가 보인다.
const RIGHT_COL_MAX = 210

// 글자색 — 라벨·값·흐림 셋만 쓴다(디자인 토큰). 전에는 한 줄 안에서 #6b7280 과
// #9ca3af 가 섞여 종류·내용·날짜가 모두 비슷하게 옅었다(2026-11-20).
const TEXT_PRIMARY = '#111827'
const TEXT_LABEL = '#374151'
const TEXT_DIM = '#6b7280'

// 왼쪽 첫 줄의 종류·유무상 칸은 px 로 못 박지 않고, 가장 긴 값을 보이지 않게 깔아
// 그 폭에 맞춘다(SizedCell). 폰트나 값이 바뀌어도 잘리지 않고 뒤 요소의 x 도 흔들리지 않으며,
// 짐작한 px 값 때문에 생기던 불필요한 여백도 없다.
// service_type 은 공백 없이 최대 6자('유선기술지원'), 영업 활동 유형은 4자다.
const LONGEST_LABEL = '유선기술지원'
const LONGEST_PAID = '· 유상'

// contacts.name 은 자유 입력이라 개행·중복 공백이 섞여 있다(줄바꿈 3개짜리 값도 있다).
// 한 줄 표시가 깨지지 않게 공백을 하나로 눌러 둔다.
const oneLine = (v?: string | null) => (v ?? '').replace(/\s+/g, ' ').trim()

// 고객사 담당자 — "(고객사 담당자 : 이름 직급)". 이름이 비어 있는 행이 3할이라 그때는 통째로 생략한다.
// 괄호 안이 sales_activities.contact_id 로 연결된 '고객사' 담당자임을 밝힌다 —
// 라벨이 없으면 우리 쪽 방문자로 오해할 수 있다(오른쪽 열의 작성자와 헷갈린다).
// contact_id 가 없는 활동(전화상담 등)은 빈 문자열이라 괄호 자체가 그려지지 않는다.
const contactLabel = (c?: { name: string | null; position: string | null } | null) => {
  const t = oneLine(`${c?.name ?? ''} ${c?.position ?? ''}`)
  return t ? `(고객사 담당자 : ${t})` : ''
}

// 담당자 표기는 어디서나 "이름 직급". 직급이 없으면 이름만.
const withPosition = (e?: { name: string; position: string | null } | null) =>
  e ? `${e.name} ${e.position ?? ''}`.trim() : ''

function engineerNames(h: ServiceHistory): string {
  if (h.service_engineers && h.service_engineers.length > 0) {
    return h.service_engineers.map(se => withPosition(se.engineers)).join(', ')
  }
  return h.visitor ?? '-'
}

// 보이지 않는 sizer 를 같은 칸에 겹쳐 깔아 최소 폭을 만든다.
// grid 로 겹치므로 실제 값이 sizer 보다 길면 칸이 늘어난다(겹치거나 잘리지 않는다).
function SizedCell({ sizer, style, children }: { sizer: string; style: React.CSSProperties; children: React.ReactNode }) {
  return (
    <span style={{ display: 'grid', flexShrink: 0, whiteSpace: 'nowrap', ...style }}>
      <span aria-hidden style={{ gridArea: '1 / 1', visibility: 'hidden' }}>{sizer}</span>
      <span style={{ gridArea: '1 / 1' }}>{children}</span>
    </span>
  )
}

// 두 줄 × 두 열로 압축한다.
//   왼쪽 1줄: ● 종류 · 유무상   제목
//   왼쪽 2줄: 내용(1줄 말줄임) · 부가정보
//   오른쪽  : 날짜 / 담당자 — 둘 다 오른쪽 정렬이라 항목마다 끝선이 맞는다.
// 부가정보는 접힌 상태에서도 항상 보이도록 내용과 분리해 두고, 내용만 말줄임한다.
// 수정 아이콘은 자리를 따로 잡지 않고, 호버 때 행 오른쪽 위에 겹쳐 띄운다(날짜를 가려도 된다).
// first 는 그룹(월)의 첫 행. 위 구분선을 그리지 않는다 — 월 머리글 줄과 겹치기 때문.
/**
 * 활동 요약에서 넘어왔을 때 그 행을 잠깐 밝혀 둔다.
 * 색은 새로 만들지 않고 서비스 유형 색표의 연한 파랑(신규설치 bg)을 그대로 쓴다.
 * 1.5초 — 눈으로 찾기에는 넉넉하고, 계속 남아 「선택된 줄」로 오해되지는 않는 길이.
 */
const FOCUS_BG = SERVICE_TYPE_COLORS['신규설치'].bg
const FOCUS_MS = 1500

function TimelineRow({ item, first, focused, siteName }: { item: Item; first: boolean; focused?: boolean; siteName?: string }) {
  const [expanded, setExpanded] = useState(false)
  const [hovered, setHovered] = useState(false)
  const body = item.body.trim()
  const clampable = body.includes('\n') || body.length > 40
  const clickable = !!item.onClick

  return (
    <div
      // 활동 요약에서 이 id 로 찾아온다(lib/activity.ts timelineKey — 보내는 쪽과 같은 규약).
      id={item.key}
      onClick={item.onClick}
      style={{
        borderTop: first ? 'none' : '1px solid #ebebeb', padding: '9px 4px',
        position: 'relative',
        background: focused ? FOCUS_BG : undefined,
        cursor: clickable ? 'pointer' : 'default', transition: 'background 0.15s ease',
      }}
      onMouseEnter={e => { setHovered(true); if (clickable) e.currentTarget.style.background = '#fafafa' }}
      // 빈 값으로 되돌린다 — 'transparent' 로 박아 두면 강조 배경까지 지워진다.
      onMouseLeave={e => { setHovered(false); if (clickable) e.currentTarget.style.background = '' }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>

        {/* 사업장 — 회사 전체 모드에서만. 한 칸 폭을 못 박아 아래위 줄의 종류가 같은 x 에서 시작한다. */}
        {siteName !== undefined && (
          <span title={siteName}
            style={{
              width: 96, flexShrink: 0, fontSize: 12, color: TEXT_LABEL, paddingTop: 1,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
            {siteName || '-'}
          </span>
        )}

        {/* 왼쪽 — 종류·제목 / 내용 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: item.dot, flexShrink: 0 }} />
            {/* 종류·유무상·제목의 간격은 이 줄의 gap(6) 하나로 같다.
                앞의 두 칸은 폭이 고정이라 종류가 무엇이든 제목이 늘 같은 x 에서 시작한다. */}
            <SizedCell sizer={LONGEST_LABEL} style={{ fontSize: 13, fontWeight: 500, color: TEXT_PRIMARY }}>
              {item.label}
            </SizedCell>
            <SizedCell sizer={LONGEST_PAID} style={{ fontSize: 12, color: TEXT_DIM }}>
              {item.labelSuffix && (
                <>
                  <span style={{ color: '#d1d5db' }}>{'· '}</span>{item.labelSuffix}
                </>
              )}
            </SizedCell>
            <span style={{ fontSize: 12, color: '#234ea2', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{item.title}</span>
            {item.titleBadge && (
              <span style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', background: '#f3f4f6', borderRadius: R.pill, padding: '2px 8px', flexShrink: 0, whiteSpace: 'nowrap' }}>
                {item.titleBadge}
              </span>
            )}
            {item.badge && (
              <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', background: '#f3f4f6', borderRadius: R.pill, padding: '2px 8px', flexShrink: 0, whiteSpace: 'nowrap' }}>
                {item.badge}
              </span>
            )}
          </div>

          {/* 펼친 상태에서는 내용이 여러 줄이 되므로, 접기 버튼이 마지막 줄 끝에 오도록 아래로 맞춘다 */}
          <div style={{ display: 'flex', alignItems: expanded ? 'flex-end' : 'baseline', gap: 5, marginTop: 3, minWidth: 0 }}>
            <span style={{
              fontSize: 12, color: TEXT_LABEL, lineHeight: '18px', minWidth: 0,
              ...(expanded
                ? { whiteSpace: 'pre-wrap', wordBreak: 'break-word' }
                : { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
            }}>
              {body || '-'}
            </span>
            {/* 만난 담당자 — 내용에 딸린 정보라 흐린 색. 길면 여기서 말줄임된다 */}
            {item.bodySuffix && (
              <span style={{
                fontSize: 12, color: '#9ca3af', flexShrink: 1, minWidth: 0, maxWidth: '45%',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {item.bodySuffix}
              </span>
            )}
            {item.note && (
              <span style={{ fontSize: 12, color: '#9ca3af', flexShrink: 0, whiteSpace: 'nowrap' }}>
                {' · '}{item.note}
              </span>
            )}
            {clampable && (
              <button
                onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}
                style={{ padding: 0, background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#234ea2', flexShrink: 0, whiteSpace: 'nowrap' }}
              >
                {expanded ? '접기' : '펼치기'}
              </button>
            )}
          </div>
        </div>

        {/* 오른쪽 — 날짜 / 담당자. 둘 다 오른쪽 정렬이라 항목마다 끝선이 맞는다.
            수정 아이콘은 자리를 따로 잡지 않고 호버 때 이 위에 겹쳐 뜬다. */}
        <div style={{ flexShrink: 0, maxWidth: RIGHT_COL_MAX, textAlign: 'right' }}>
          <div style={{ fontSize: 12, color: TEXT_LABEL, whiteSpace: 'nowrap' }}>{item.date ?? '-'}</div>
          {/* 여러 명이면 쉼표로 이어 붙고, 넘치면 말줄임 — 전체 이름은 title 로 확인한다.
              날짜와 같은 층위의 메타데이터라 색도 같게 둔다(위계는 위아래 순서로 이미 잡힌다) */}
          <div
            title={item.owner || undefined}
            style={{
              fontSize: 12, color: TEXT_DIM, marginTop: 3,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {item.owner || '\u00a0'}
          </div>
        </div>
      </div>

      {/* 수정 — 영업 활동에만. 호버 때 오른쪽 위에 또렷하게 떠서 날짜를 가려도 된다 */}
      {item.onEdit && hovered && (
        <EditIconButton size={24} label="영업 기록 수정" onClick={() => item.onEdit!()}
          style={{ position: 'absolute', top: 6, right: 4, zIndex: 1 }} />
      )}
    </div>
  )
}

export default function ActivityTimeline({ history, devices, quotes, activities, holdings, customerId, onOpenQuotePdf, onOpenHolding, onAddRecord, onEditActivity, canEditActivity, focusKey, onFocused, sites, events, opportunities, inquiries, forecastOnlyAt, initialSiteIds, title }: Props) {
  const [showUndated, setShowUndated] = useState(false)

  /** 고를 수 있는 것 전부 — 「좁히지 않음」의 기준이다(lib/timelineFilter.ts). */
  const available = useMemo(
    () => ({ kinds: TIMELINE_KINDS, siteIds: (sites ?? []).map(s => s.id) }),
    [sites],
  )
  /**
   * 필터는 **종류·사업장·기간 한 덩어리**다. 처음에는 전부 고른 상태 —
   * 사업장 화면에서 ← 로 돌아왔을 때만 그 사업장 하나로 좁혀 둔다(보던 자리를 잃지 않게).
   */
  const [filter, setFilter] = useState<TimelineFilter>(() => {
    const base = allSelected(TIMELINE_KINDS, (sites ?? []).map(s => s.id))
    return initialSiteIds && initialSiteIds.length > 0 ? { ...base, siteIds: [...initialSiteIds] } : base
  })
  const [filterOpen, setFilterOpen] = useState(false)

  const siteNameOf = useMemo(() => {
    const m = new Map((sites ?? []).map(s => [s.id, s.name]))
    return (id?: number | null) => (id == null ? '' : m.get(id) ?? '')
  }, [sites])
  // 활동 요약에서 넘어온 행. 한 번 찾아가고 나면 다시 하지 않는다(필터를 바꿔도 되풀이되지 않게).
  const [focusedKey, setFocusedKey] = useState<string | null>(null)
  const focusDoneRef = useRef<string | null>(null)

  // 장비 표시는 모델명 전체(device_name + device_name2). 뒤 항목이 비면 앞만 쓴다.
  const deviceNameOf = useMemo(() => {
    const map = new Map<number, string>()
    devices.forEach(d => map.set(d.device_id, [d.device_name, d.device_name2].map(v => v?.trim()).filter(Boolean).join(' ') || '-'))
    return (h: ServiceHistory) => (h.device_id == null ? '-' : map.get(Number(h.device_id)) ?? '-')
  }, [devices])

  // 폐기된 장비를 가리키는 지난 기록은 **그대로 보여 준다** — 대신 이름 옆에 「폐기」를 붙여
  // 지금은 쓰지 않는 장비임을 알린다(목록에서는 숨겨져 있어 찾아도 안 나온다).
  const disposedIds = useMemo(
    () => new Set(devices.filter(isDisposed).map(d => d.device_id)),
    [devices],
  )

  const items = useMemo<Item[]>(() => {
    const serviceItems: Item[] = history.map(h => ({
      key: timelineKey('service', h.service_id),
      kind: '서비스' as const,
      siteId: h.customer_id ?? null,
      date: h.visit_date,
      label: h.service_type ?? '-',
      dot: getCategoryColor(SERVICE_TYPE_COLORS, h.service_type).dot ?? '#9ca3af',
      title: deviceNameOf(h),
      titleBadge: h.device_id != null && disposedIds.has(Number(h.device_id)) ? '폐기' : undefined,
      body: h.service_notes ?? '',
      labelSuffix: h.is_paid !== null ? (h.is_paid ? '유상' : '무상') : undefined,
      // 아직 오지 않은 방문 — 다녀온 기록과 섞이지 않게 표시한다(예정 건을 미리 등록한다).
      badge: isFutureVisit(h.visit_date) ? '예정' : undefined,
      owner: engineerNames(h),
      sortAt: sortKey(null, h.visit_date),
      sortId: h.service_id,
    }))

    const quoteItems: Item[] = quotes.map(q => ({
      key: `q-${q.quote_id}`,
      kind: '견적' as const,
      // 수요처가 이 회사 밖(대리점으로 낀 건)이면 대리점 쪽 줄이 이 회사의 사업장이다.
      siteId: q.customer_id ?? q.dealer_id ?? null,
      date: q.quote_date,
      label: '견적',
      dot: TIMELINE_KIND_COLORS['견적'].dot,
      title: q.quote_number,
      body: `₩${numKR(q.total_supply || 0)} · ${salesStatusLabel(q.status)}`,
      owner: withPosition(q.engineers),
      badge: isDealerQuote(q, customerId) ? '대리점' : undefined,
      onClick: q.pdf_url ? () => onOpenQuotePdf(q) : undefined,
      sortAt: sortKey(q.created_at, q.quote_date),
      sortId: q.quote_id,
    }))

    const salesItems: Item[] = activities.map(a => ({
      key: timelineKey('sales', a.activity_id),
      kind: '영업' as const,
      siteId: a.customer_id ?? null,
      date: a.activity_date,
      label: a.activity_type,
      dot: TIMELINE_KIND_COLORS['영업'].dot,
      // 유형 뒤(장비명·견적번호와 같은 x)에는 연결된 영업기회를 둔다 — 이 활동이 무엇에 관한 것인지가 먼저다.
      // 배지로도 같이 내면 한 줄에 두 번 나오므로 배지는 두지 않는다.
      title: a.sales_opportunities?.title ?? '',
      body: a.content ?? '',
      // 만난 담당자는 내용 뒤 괄호. 안 고른 활동(전화상담 등)은 비워둔다.
      bodySuffix: contactLabel(a.contacts),
      owner: withPosition(a.engineers),
      onEdit: canEditActivity(a) ? () => onEditActivity(a) : undefined,
      sortAt: sortKey(a.created_at, a.activity_date),
      sortId: a.activity_id,
    }))

    // 홀딩은 한 건을 한 항목으로 낸다(등록·해제를 두 줄로 내면 칩 건수가 실제 건수와 어긋난다).
    // 해제 정보는 같은 줄의 내용에 붙인다.
    const holdingItems: Item[] = holdings.map(h => ({
      key: `h-${h.holding_id}`,
      kind: '홀딩' as const,
      siteId: h.customer_id ?? null,
      date: h.started_at,
      label: '홀딩',
      dot: TIMELINE_KIND_COLORS['홀딩'].dot,
      title: deviceLabel(h),
      titleBadge: h.device_id != null && disposedIds.has(Number(h.device_id)) ? '폐기' : undefined,
      body: h.resolved_at ? `${h.title} — 해제 ${h.resolved_at}` : h.title,
      note: elapsedLabel(h),
      owner: withPosition(h.engineers),
      badge: h.resolved_at ? '해제됨' : '진행 중',
      onClick: () => onOpenHolding(h),
      sortAt: sortKey(h.created_at, h.started_at),
      sortId: h.holding_id,
    }))

    /**
     * 포캐스트 — 영업 기회가 **생기고 바뀐 자국**을 날짜순으로 낸다.
     *
     * ⚠ 단계가 언제 어떻게 바뀌었는지는 **알 수 없다** — 단계 이력을 담는 표가 없고
     *   sales_opportunities 에 created_at·updated_at·closed_at 셋만 있다. 그래서
     *   「단계 변경」이라고 적지 않고 **「고침」**이라고 적는다(없는 것을 있는 척하지 않는다).
     *   줄 셋이 나올 수 있다: 만든 날 · 마지막 고침(날이 다를 때만) · 종료(closed_at).
     */
    const forecastItems: Item[] = (opportunities ?? []).flatMap(o => {
      const money = o.expected_amount ? `₩${numKR(o.expected_amount)}` : '금액 미정'
      const when = whenLabel(o.expected_close)
      const body = [money, when ? `${when} 예정` : ''].filter(Boolean).join(' · ')
      const owner = ownerLabel(o.engineers)
      const base = {
        kind: '포캐스트' as const,
        siteId: o.customer_id ?? null,
        dot: '#f59e0b',
        title: (o.title ?? '').trim() || '(제목 없음)',
        owner,
        sortId: o.opportunity_id,
      }
      const madeOn = (o.created_at ?? '').slice(0, 10) || null
      const rows: Item[] = [{
        ...base,
        key: `op-${o.opportunity_id}`,
        date: madeOn,
        label: '포캐스트',
        labelSuffix: o.stage,
        body,
        sortAt: sortKey(o.created_at, madeOn),
      }]
      const closedOn = (o.closed_at ?? '').slice(0, 10) || null
      const touchedOn = (o.updated_at ?? '').slice(0, 10) || null
      if (touchedOn && touchedOn !== madeOn && touchedOn !== closedOn) {
        rows.push({
          ...base,
          key: `op-${o.opportunity_id}-up`,
          date: touchedOn,
          label: '포캐스트',
          labelSuffix: '고침',
          body: `지금 단계 ${o.stage} · ${body}`,
          sortAt: sortKey(o.updated_at, touchedOn),
        })
      }
      if (closedOn) {
        rows.push({
          ...base,
          key: `op-${o.opportunity_id}-cl`,
          date: closedOn,
          label: '포캐스트',
          labelSuffix: o.stage === '실주' ? '실주' : '종료',
          body: o.lost_reason ? `${o.lost_reason}${o.lost_note ? ` — ${o.lost_note}` : ''}` : body,
          sortAt: sortKey(o.closed_at, closedOn),
        })
      }
      return rows
    })

    /**
     * 의뢰 — 의뢰서가 **그 사업장에 걸려 있을 때만** 나온다
     * (db/inquiry_customer_device_20261120.sql 로 더한 customer_id).
     * 과거에 쌓인 의뢰서는 그 값이 없어 여기 뜨지 않는다 — 맞춰 넣지 않는다(백필 금지).
     */
    const inquiryItems: Item[] = (inquiries ?? []).map(q => ({
      key: `iq-${q.id}`,
      kind: '의뢰' as const,
      siteId: q.customer_id ?? null,
      date: q.issued_date,
      label: '의뢰',
      labelSuffix: INQUIRY_TYPE_LABEL[inquiryTypeOf(q.inquiry_type) ?? 'req20'],
      dot: '#64748b',
      title: q.inquiry_no ?? '(번호 없음)',
      body: (q.title ?? '').trim(),
      badge: q.status === 'cancelled' ? '취소' : q.status === 'drafting' ? '작성 중' : undefined,
      owner: '',
      onClick: () => { window.location.href = `/inquiries/${q.id}` },
      sortAt: sortKey(q.created_at, q.issued_date),
      // 의뢰서 id 는 uuid 라 숫자 보조키가 없다 — 같은 시각이면 날짜만으로 가른다.
      sortId: 0,
    }))

    // 사건 — 회색 톤으로, 고칠 수 없는 줄이다(사람이 쓰지 않는다).
    const eventItems: Item[] = (events ?? []).map(e => {
      const line = eventLine(e)
      return {
        key: `ev-${e.id}`,
        kind: '사건' as const,
        siteId: e.customer_id ?? null,
        date: (e.occurred_at ?? '').slice(0, 10) || null,
        label: line.label,
        dot: '#d1d5db',
        title: line.title,
        body: line.body,
        owner: line.owner,
        sortAt: sortKey(e.occurred_at, (e.occurred_at ?? '').slice(0, 10) || null),
        sortId: e.id,
      }
    })

    return [...serviceItems, ...quoteItems, ...salesItems, ...holdingItems, ...forecastItems, ...inquiryItems, ...eventItems]
  }, [history, quotes, activities, holdings, events, opportunities, inquiries, customerId, deviceNameOf, disposedIds, onOpenQuotePdf, onOpenHolding, onEditActivity, canEditActivity])

  /** 필터를 모두 걸어 남은 줄. */
  const scoped = useMemo(() => applyFilter(items, filter, available), [items, filter, available])

  /**
   * 모달에 붙는 건수. 종류 건수는 **사업장·기간만 걸고** 세고, 사업장 건수는
   * **종류·기간만 걸고** 센다 — 자기 자신으로 걸러 센 건수는 고를 때 쓸모가 없다
   * (「서비스 6」만 켜 두면 다른 종류가 전부 0으로 보인다).
   */
  const kindCounts = useMemo(
    () => countByKind(applyFilter(items, { ...filter, kinds: [...TIMELINE_KINDS] }, available)),
    [items, filter, available],
  )
  const siteCounts = useMemo(
    () => countBySite(applyFilter(items, { ...filter, siteIds: available.siteIds }, available)),
    [items, filter, available],
  )
  const chips = useMemo(() => filterChips(filter, available, siteNameOf), [filter, available, siteNameOf])

  // 날짜 있는 것만 내림차순으로 월별 묶음, 날짜 없는 것은 따로 모은다.
  // 전 구간 내림차순 — 달도, 날도, 같은 날 안도 최신이 위다. 종류(견적/영업/홀딩/서비스)에 따른
  // 우선순위는 두지 않는다. 같은 날 안의 순서는 오로지 등록 시각(sortAt)이 정한다.
  //
  // 날짜를 먼저 비교하는 이유는 월 머리글 때문이다 — 아래 묶음 루프가 이어진 같은 라벨만 한 묶음으로
  // 만들므로, 표시 날짜 순서가 흐트러지면 '2026년 8월' 머리글이 중간에 또 생긴다.
  // (홀딩은 started_at 을 표시하는데 등록 시각이 그보다 한참 뒤일 수 있어 실제로 벌어진다)
  // 같은 날짜 안에서는 sortAt 만 보므로, 요청하신 '등록 시각 내림차순'과 결과가 같다.
  const { months, undated } = useMemo(() => {
    const dated = scoped.filter(i => i.date)
    const undated = scoped.filter(i => !i.date)
    dated.sort((a, b) => {
      if (a.date! !== b.date!) return a.date! < b.date! ? 1 : -1
      if (a.sortAt !== b.sortAt) return b.sortAt - a.sortAt
      return b.sortId - a.sortId
    })

    const months: { label: string; rows: Item[] }[] = []
    for (const it of dated) {
      const label = monthLabel(it.date!)
      const last = months[months.length - 1]
      if (last && last.label === label) last.rows.push(it)
      else months.push({ label, rows: [it] })
    }
    return { months, undated }
  }, [scoped])

  // 활동 요약에서 넘어온 행 찾아가기 — 자료가 다 그려진 뒤 한 번만.
  //   · 필터가 걸려 있으면 대상이 가려질 수 있어 먼저 전부 보이게 되돌린다(다음 렌더에서 이어서 한다).
  //   · 없는 행(지워진 기록 등)이면 아무 일도 하지 않는다 — 오류를 띄우지 않는다.
  //   · 모션을 줄이길 원하는 사용자에게는 부드러운 스크롤 없이 자리만 옮긴다.
  useEffect(() => {
    if (!focusKey || focusDoneRef.current === focusKey) return
    if (items.length === 0) return                       // 아직 불러오는 중
    const done = () => { focusDoneRef.current = focusKey; onFocused?.() }
    if (!items.some(i => i.key === focusKey)) { done(); return }
    if (scoped.length !== items.length) { setFilter(allSelected(available.kinds, available.siteIds)); return }
    const el = document.getElementById(focusKey)
    if (!el) return                                      // 접힌 묶음 등 — 다음 렌더에서 다시 본다
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
    setFocusedKey(focusKey)
    done()
    const t = setTimeout(() => setFocusedKey(null), FOCUS_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, items, filter])

  /**
   * 회사 카드의 「전체 보기」 — 포캐스트만 켠다. 누른 횟수가 바뀔 때만 움직이므로
   * 사람이 그 뒤에 필터를 다시 고치면 그대로 둔다.
   */
  const forecastClickRef = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (forecastOnlyAt === undefined) return
    if (forecastClickRef.current === forecastOnlyAt) return
    forecastClickRef.current = forecastOnlyAt
    if (forecastOnlyAt === 0) return                      // 처음 그릴 때는 아무것도 하지 않는다
    setFilter(f => ({ ...f, kinds: ['포캐스트'] }))
  }, [forecastOnlyAt])

  return (
    <div>
      {/**
       * 머리줄 — 제목·건수 / [필터] [+ 기록]. 그 아래에 **적용된 필터만** 칩으로 남는다.
       *
       * 전에는 종류 세그먼트와 사업장 칩이 머리줄에 함께 섰다. 사업장이 여섯 곳을 넘으면
       * 줄이 옆으로 밀렸고, 종류는 하나만 고를 수 있었다. 고르는 일은 모달로 옮기고
       * 머리줄에는 **지금 걸린 것**만 남긴다(모달: components/customer/TimelineFilterModal.tsx).
       */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: chips.length > 0 ? 6 : 10, minWidth: 0 }}>
        {title && (
          <b style={{ ...TITLE, flexShrink: 0 }}>{title}</b>
        )}
        <span style={{ fontSize: 11, fontWeight: 700, color: TEXT_DIM, background: '#f3f4f6', borderRadius: R.pill, padding: '2px 8px', flexShrink: 0 }}>{scoped.length}</span>
        <span style={{ flex: 1 }} />

        <button type="button" onClick={() => setFilterOpen(true)}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#234ea2' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#ebebeb' }}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0,
            height: 30, padding: '0 11px', borderRadius: R.control, border: '1px solid #ebebeb',
            background: '#ffffff', color: TEXT_LABEL, cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', transition: 'border-color 0.15s ease',
          }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 5h18l-7 8v6l-4-2v-4z" />
          </svg>
          필터
          {chips.length > 0 && (
            <span style={{ fontSize: 11, fontWeight: 700, color: '#234ea2', background: '#eff4ff', borderRadius: R.pill, padding: '1px 7px' }}>{chips.length}</span>
          )}
        </button>

        <button type="button" onClick={onAddRecord}
          onMouseEnter={e => { e.currentTarget.style.background = '#1c3e87' }}
          onMouseLeave={e => { e.currentTarget.style.background = '#234ea2' }}
          style={{
            flexShrink: 0, height: 30, padding: '0 12px', borderRadius: R.control, border: 'none',
            background: '#234ea2', color: '#ffffff', cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', transition: 'background 0.15s ease',
          }}>
          + 기록
        </button>
      </div>

      {/* 적용된 필터 — 칩 하나를 ✕ 로 바로 뗀다. 마지막 하나를 떼면 그 묶음은 전체로 돌아간다. */}
      {chips.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {chips.map(c => (
            <button key={c.key} type="button" onClick={() => setFilter(f => dropChip(f, c, available))}
              title={`${c.label} 필터 해제`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, height: 24, padding: '0 9px',
                borderRadius: R.pill, border: '1px solid #c7d7f8', background: '#eff4ff', color: '#234ea2',
                fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
              }}>
              {c.label}
              <span aria-hidden style={{ color: '#9ca3af' }}>✕</span>
            </button>
          ))}
          <button type="button" onClick={() => setFilter(allSelected(available.kinds, available.siteIds))}
            style={{ border: 'none', background: 'none', padding: 0, color: TEXT_DIM, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            전체 해제
          </button>
        </div>
      )}

      {filterOpen && (
        <TimelineFilterModal
          value={filter}
          available={{ kinds: [...available.kinds], siteIds: available.siteIds }}
          kindCounts={kindCounts}
          siteCounts={siteCounts}
          siteName={siteNameOf}
          matchCount={next => applyFilter(items, next, available).length}
          onApply={next => { setFilter(next); setFilterOpen(false) }}
          onClose={() => setFilterOpen(false)}
        />
      )}

      {months.length === 0 && undated.length === 0 ? (
        <div style={{ padding: '28px 16px', textAlign: 'center', fontSize: 13, color: '#9ca3af' }}>
          {chips.length > 0 ? '조건에 맞는 기록이 없습니다' : '기록이 없습니다'}
        </div>
      ) : (
        <>
          {months.map((m, mi) => (
            <div key={m.label} style={{ marginTop: mi === 0 ? 0 : 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', whiteSpace: 'nowrap' }}>{m.label}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', background: '#f3f4f6', borderRadius: R.pill, padding: '2px 8px' }}>{m.rows.length}건</span>
                <span style={{ flex: 1, height: 1, background: '#ebebeb' }} />
              </div>
              {m.rows.map((it, i) => <TimelineRow key={it.key} item={it} first={i === 0} focused={it.key === focusedKey} siteName={sites ? siteNameOf(it.siteId) : undefined} />)}
            </div>
          ))}

          {undated.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                <button
                  onClick={() => setShowUndated(v => !v)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 0, background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', whiteSpace: 'nowrap' }}>날짜 미상</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', background: '#f3f4f6', borderRadius: R.pill, padding: '2px 8px' }}>{undated.length}건</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#234ea2' }}>{showUndated ? '접기' : '펼치기'}</span>
                </button>
                <span style={{ flex: 1, height: 1, background: '#ebebeb' }} />
              </div>
              {showUndated && undated.map((it, i) => <TimelineRow key={it.key} item={it} first={i === 0} focused={it.key === focusedKey} siteName={sites ? siteNameOf(it.siteId) : undefined} />)}
            </div>
          )}
        </>
      )}
    </div>
  )
}
