'use client'

// 업체 상세의 [활동 이력] 탭 — 서비스 기록과 견적을 한 줄기 시간순으로 보여준다.
// 상세가 이미 들고 있는 history / quotes 를 그대로 쓰므로 새 조회는 없다.
// (영업활동 sales_activities 는 다음 단계. 지금은 칩만 있고 항상 0건이다)
//
// visit_date 가 없는 서비스 기록이 1000건 넘게 남아 있어, 날짜순 사이에 끼워 넣지 않고
// 맨 아래 "날짜 미상"으로 접어둔다. 견적은 quote_date 가 항상 있어 여기 해당하지 않는다.

import { useMemo, useState } from 'react'
import SegmentedControl from '@/components/common/SegmentedControl'
import { SERVICE_TYPE_COLORS, TIMELINE_KIND_COLORS, getCategoryColor } from '@/lib/categoryColors'
import { numKR } from './constants'
import { isDealerQuote } from './utils'
import { deviceLabel, elapsedLabel } from './holding'
import type { Device, Holding, Quote, SalesActivity, ServiceHistory } from './types'

type Props = {
  history: ServiceHistory[]
  devices: Device[]
  quotes: Quote[]
  activities: SalesActivity[]
  holdings: Holding[]
  customerId: number
  onOpenQuotePdf: (q: Quote) => void
  onOpenHolding: (h: Holding) => void
  onAddActivity: () => void
  onEditActivity: (a: SalesActivity) => void
  canEditActivity: (a: SalesActivity) => boolean
}

type Kind = '서비스' | '견적' | '영업' | '홀딩'
const FILTERS = ['전체', '영업', '서비스', '견적', '홀딩'] as const
type Filter = typeof FILTERS[number]

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
  onClick?: () => void
  onEdit?: () => void    // 영업 활동에만 있다 (호버 시 나타나는 연필)
  sortId: number         // 같은 날짜일 때 최신 것을 위로 올리기 위한 보조 키
}

// 'YYYY-MM-DD' → '2026년 8월'
const monthLabel = (d: string) => `${d.slice(0, 4)}년 ${Number(d.slice(5, 7))}월`

// 오른쪽 열(날짜·담당자) 최대 폭. '이름 직급' 3명(약 20자)까지 들어가고,
// 그보다 많으면 말줄임 → 마우스를 올리면 전체가 보인다.
const RIGHT_COL_MAX = 210

// 왼쪽 첫 줄의 종류·유무상 칸은 px 로 못 박지 않고, 가장 긴 값을 보이지 않게 깔아
// 그 폭에 맞춘다(SizedCell). 폰트나 값이 바뀌어도 잘리지 않고 뒤 요소의 x 도 흔들리지 않으며,
// 짐작한 px 값 때문에 생기던 불필요한 여백도 없다.
// service_type 은 공백 없이 최대 6자('유선기술지원'), 영업 활동 유형은 4자다.
const LONGEST_LABEL = '유선기술지원'
const LONGEST_PAID = '· 유상'

// contacts.name 은 자유 입력이라 개행·중복 공백이 섞여 있다(줄바꿈 3개짜리 값도 있다).
// 한 줄 표시가 깨지지 않게 공백을 하나로 눌러 둔다.
const oneLine = (v?: string | null) => (v ?? '').replace(/\s+/g, ' ').trim()

// 고객사 담당자 — "(이름 직급)". 이름이 비어 있는 행이 3할이라 그때는 통째로 생략한다.
// ('고객사' 라벨은 붙이지 않는다 — 업체 상세라 고객사는 이미 화면에 고정돼 있다)
const contactLabel = (c?: { name: string | null; position: string | null } | null) => {
  const t = oneLine(`${c?.name ?? ''} ${c?.position ?? ''}`)
  return t ? `(${t})` : ''
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
function TimelineRow({ item, first }: { item: Item; first: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const [hovered, setHovered] = useState(false)
  const body = item.body.trim()
  const clampable = body.includes('\n') || body.length > 40
  const clickable = !!item.onClick

  return (
    <div
      onClick={item.onClick}
      style={{
        borderTop: first ? 'none' : '1px solid #ebebeb', padding: '9px 4px',
        position: 'relative',
        cursor: clickable ? 'pointer' : 'default', transition: 'background 0.15s ease',
      }}
      onMouseEnter={e => { setHovered(true); if (clickable) e.currentTarget.style.background = '#fafafa' }}
      onMouseLeave={e => { setHovered(false); if (clickable) e.currentTarget.style.background = 'transparent' }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>

        {/* 왼쪽 — 종류·제목 / 내용 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: item.dot, flexShrink: 0 }} />
            {/* 종류·유무상·제목의 간격은 이 줄의 gap(6) 하나로 같다.
                앞의 두 칸은 폭이 고정이라 종류가 무엇이든 제목이 늘 같은 x 에서 시작한다. */}
            <SizedCell sizer={LONGEST_LABEL} style={{ fontSize: 13, fontWeight: 500, color: '#111827' }}>
              {item.label}
            </SizedCell>
            <SizedCell sizer={LONGEST_PAID} style={{ fontSize: 12, color: '#6b7280' }}>
              {item.labelSuffix && (
                <>
                  <span style={{ color: '#d1d5db' }}>{'· '}</span>{item.labelSuffix}
                </>
              )}
            </SizedCell>
            <span style={{ fontSize: 12, color: '#234ea2', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{item.title}</span>
            {item.badge && (
              <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', background: '#f3f4f6', borderRadius: 99, padding: '2px 8px', flexShrink: 0, whiteSpace: 'nowrap' }}>
                {item.badge}
              </span>
            )}
          </div>

          {/* 펼친 상태에서는 내용이 여러 줄이 되므로, 접기 버튼이 마지막 줄 끝에 오도록 아래로 맞춘다 */}
          <div style={{ display: 'flex', alignItems: expanded ? 'flex-end' : 'baseline', gap: 5, marginTop: 3, minWidth: 0 }}>
            <span style={{
              fontSize: 12, color: '#6b7280', lineHeight: '18px', minWidth: 0,
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
          <div style={{ fontSize: 12, color: '#6b7280', whiteSpace: 'nowrap' }}>{item.date ?? '-'}</div>
          {/* 여러 명이면 쉼표로 이어 붙고, 넘치면 말줄임 — 전체 이름은 title 로 확인한다.
              날짜와 같은 층위의 메타데이터라 색도 같게 둔다(위계는 위아래 순서로 이미 잡힌다) */}
          <div
            title={item.owner || undefined}
            style={{
              fontSize: 12, color: '#6b7280', marginTop: 3,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {item.owner || '\u00a0'}
          </div>
        </div>
      </div>

      {/* 수정 — 영업 활동에만. 호버 때 오른쪽 위에 또렷하게 떠서 날짜를 가려도 된다 */}
      {item.onEdit && hovered && (
        <button
          onClick={e => { e.stopPropagation(); item.onEdit!() }}
          title="수정"
          aria-label="영업 기록 수정"
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#234ea2' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#ebebeb' }}
          style={{
            position: 'absolute', top: 6, right: 4, zIndex: 1,
            width: 24, height: 24, padding: 0,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: '#ffffff', border: '1px solid #ebebeb', borderRadius: 6,
            cursor: 'pointer', color: '#234ea2', transition: 'border-color 0.15s ease',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
      )}
    </div>
  )
}

export default function ActivityTimeline({ history, devices, quotes, activities, holdings, customerId, onOpenQuotePdf, onOpenHolding, onAddActivity, onEditActivity, canEditActivity }: Props) {
  const [filter, setFilter] = useState<Filter>('전체')
  const [showUndated, setShowUndated] = useState(false)

  // 장비 표시는 모델명 전체(device_name + device_name2). 뒤 항목이 비면 앞만 쓴다.
  const deviceNameOf = useMemo(() => {
    const map = new Map<number, string>()
    devices.forEach(d => map.set(d.device_id, [d.device_name, d.device_name2].map(v => v?.trim()).filter(Boolean).join(' ') || '-'))
    return (h: ServiceHistory) => (h.device_id == null ? '-' : map.get(Number(h.device_id)) ?? '-')
  }, [devices])

  const items = useMemo<Item[]>(() => {
    const serviceItems: Item[] = history.map(h => ({
      key: `s-${h.service_id}`,
      kind: '서비스' as const,
      date: h.visit_date,
      label: h.service_type ?? '-',
      dot: getCategoryColor(SERVICE_TYPE_COLORS, h.service_type).dot ?? '#9ca3af',
      title: deviceNameOf(h),
      body: h.service_notes ?? '',
      labelSuffix: h.is_paid !== null ? (h.is_paid ? '유상' : '무상') : undefined,
      owner: engineerNames(h),
      sortId: h.service_id,
    }))

    const quoteItems: Item[] = quotes.map(q => ({
      key: `q-${q.quote_id}`,
      kind: '견적' as const,
      date: q.quote_date,
      label: '견적',
      dot: TIMELINE_KIND_COLORS['견적'].dot,
      title: q.quote_number,
      body: `₩${numKR(q.total_supply || 0)} · ${q.status}`,
      owner: withPosition(q.engineers),
      badge: isDealerQuote(q, customerId) ? '대리점' : undefined,
      onClick: q.pdf_url ? () => onOpenQuotePdf(q) : undefined,
      sortId: q.quote_id,
    }))

    const salesItems: Item[] = activities.map(a => ({
      key: `a-${a.activity_id}`,
      kind: '영업' as const,
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
      sortId: a.activity_id,
    }))

    // 홀딩은 한 건을 한 항목으로 낸다(등록·해제를 두 줄로 내면 칩 건수가 실제 건수와 어긋난다).
    // 해제 정보는 같은 줄의 내용에 붙인다.
    const holdingItems: Item[] = holdings.map(h => ({
      key: `h-${h.holding_id}`,
      kind: '홀딩' as const,
      date: h.started_at,
      label: '홀딩',
      dot: TIMELINE_KIND_COLORS['홀딩'].dot,
      title: deviceLabel(h),
      body: h.resolved_at ? `${h.title} — 해제 ${h.resolved_at}` : h.title,
      note: elapsedLabel(h),
      owner: withPosition(h.engineers),
      badge: h.resolved_at ? '해제됨' : '진행 중',
      onClick: () => onOpenHolding(h),
      sortId: h.holding_id,
    }))

    return [...serviceItems, ...quoteItems, ...salesItems, ...holdingItems]
  }, [history, quotes, activities, holdings, customerId, deviceNameOf, onOpenQuotePdf, onOpenHolding, onEditActivity, canEditActivity])

  const counts = useMemo(() => ({
    '전체': items.length,
    '영업': items.filter(i => i.kind === '영업').length,
    '서비스': items.filter(i => i.kind === '서비스').length,
    '견적': items.filter(i => i.kind === '견적').length,
    '홀딩': items.filter(i => i.kind === '홀딩').length,
  }), [items])

  // 날짜 있는 것만 내림차순으로 월별 묶음, 날짜 없는 것은 따로 모은다.
  // 같은 날짜면 견적 → 서비스 순으로 두고, 같은 종류끼리는 나중에 등록된 것(id 큰 것)을 위로.
  const { months, undated } = useMemo(() => {
    const shown = filter === '전체' ? items : items.filter(i => i.kind === filter)
    const dated = shown.filter(i => i.date)
    const undated = shown.filter(i => !i.date)
    const rank = (k: Kind) => (k === '견적' ? 0 : k === '영업' ? 1 : k === '홀딩' ? 2 : 3)
    dated.sort((a, b) => {
      if (a.date! !== b.date!) return a.date! < b.date! ? 1 : -1
      if (a.kind !== b.kind) return rank(a.kind) - rank(b.kind)
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
  }, [items, filter])

  // 단일 선택 필터라 슬라이딩 인디케이터(SegmentedControl)로 둔다. 건수는 라벨 옆 suffix.
  const filterOptions = FILTERS.map(f => ({ label: f, value: f, suffix: String(counts[f]) }))

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        <SegmentedControl
          options={filterOptions}
          value={filter}
          onChange={v => setFilter(v as Filter)}
        />
        <button
          onClick={onAddActivity}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#234ea2' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#ebebeb' }}
          style={{
            marginLeft: 'auto', padding: '5px 12px', borderRadius: 6, border: '1px solid #ebebeb',
            background: '#ffffff', color: '#234ea2', cursor: 'pointer',
            fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
            transition: 'border-color 0.15s ease',
          }}
        >
          + 영업 기록
        </button>
      </div>

      {months.length === 0 && undated.length === 0 ? (
        <div style={{ padding: '28px 16px', textAlign: 'center', fontSize: 13, color: '#9ca3af' }}>
          {filter === '영업' ? '영업 활동 기록이 없습니다' : '기록이 없습니다'}
        </div>
      ) : (
        <>
          {months.map((m, mi) => (
            <div key={m.label} style={{ marginTop: mi === 0 ? 0 : 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', whiteSpace: 'nowrap' }}>{m.label}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', background: '#f3f4f6', borderRadius: 99, padding: '2px 8px' }}>{m.rows.length}건</span>
                <span style={{ flex: 1, height: 1, background: '#ebebeb' }} />
              </div>
              {m.rows.map((it, i) => <TimelineRow key={it.key} item={it} first={i === 0} />)}
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
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', background: '#f3f4f6', borderRadius: 99, padding: '2px 8px' }}>{undated.length}건</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#234ea2' }}>{showUndated ? '접기' : '펼치기'}</span>
                </button>
                <span style={{ flex: 1, height: 1, background: '#ebebeb' }} />
              </div>
              {showUndated && undated.map((it, i) => <TimelineRow key={it.key} item={it} first={i === 0} />)}
            </div>
          )}
        </>
      )}
    </div>
  )
}
