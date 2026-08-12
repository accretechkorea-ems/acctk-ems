'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import SegmentedControl from '@/components/common/SegmentedControl'
import {
  ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList,
} from 'recharts'
import { usePageGuard } from '@/hooks/usePageGuard'
import AccessGate from '@/components/common/AccessGate'
import { canAccess20 } from '@/lib/permissions'
import { useRepairs, type Repair } from '@/hooks/useRepairs'
import { useCountUp } from '@/hooks/useCountUp'
import { CHART_COLORS, REPAIR_STATUS_COLORS, REPAIR_MEANING_COLORS } from '@/lib/categoryColors'
import {
  avgLeadTime, monthlyCountsRecent,
  leadTimeBuckets, monthlyBacklogRecent,
  customerRanking, productRanking, weeklyByType,
  getAgingDays, getRepeatSerials,
  avgRepairDuration, countRepairDurationSamples,
  excludeSpecial, isAtHq, hqAvgTurnaround, hqMonthCounts,
} from '@/lib/repairStats'

// ── 색상: EMS 팔레트(lib/categoryColors.ts 기존 값)만 사용 ──
// 차트 그래픽 전용 팔레트 (활동 현황 dot 색)
const C_BLUE = CHART_COLORS.blue   // 접수·입고·단일 계열
const C_GREEN = CHART_COLORS.green // 출고·완료
const C_AMBER = CHART_COLORS.amber // 도넛 수리중
const C_ROSE = CHART_COLORS.rose   // 히스토 15일+
const BORDER = '#ebebeb'
const TEXT = '#111827'
const MUTED = '#9ca3af'  // 회색: 축·라벨 등 중립 텍스트
const PAGE_BG = '#fafafa'
const CARD_BG = '#ffffff'
const SKELETON = '#e5e7eb'
const NEUTRAL_BG = '#f3f4f6'
const SUB = '#6b7280'    // 표 헤더 · 경과일<14
const WARN2 = '#b45309'  // 앰버: 경과일 14+ · 도넛 수리중 · 히스토 8-14일
const WARN = '#be123c'   // 로즈: 경과일 30+ · 재입고 경고 · 히스토 15일+ · 추이 악화
// 소요일 분포 구간별 색 (0-3 / 4-7 / 8-14 / 15+ — 오래 걸릴수록 경고)
const BUCKET_COLORS = [C_GREEN, C_BLUE, C_AMBER, C_ROSE] as const
// 랭킹 막대(고객·모델 Top5) 항목별 다색 — 항목 구분용
const RANK_COLORS = [CHART_COLORS.blue, CHART_COLORS.violet, CHART_COLORS.amber, CHART_COLORS.rose, CHART_COLORS.green, CHART_COLORS.teal] as const

// recharts 공통
const AXIS_TICK = { fontSize: 11, fill: MUTED } as const // 축 글자(폰트 규칙상 최소 11px 유지)
const CHART_MARGIN = { top: 24, right: 8, bottom: 0, left: 0 } as const       // Legend 있는 차트 (상단 값 라벨 여유)
const TOOLTIP_STYLE: React.CSSProperties = { fontSize: 12, borderRadius: 8, border: `1px solid ${BORDER}` }
const ANIM_MS = 800 // 진입 애니메이션 기본 길이
const CHART_H = 220 // 빈 상태 최소 높이
const CARD_H = 300 // 모든 시각화 카드 고정 높이 (적체 Top5 표가 들어가는 기준)

const listTh: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 12, fontWeight: 600, color: SUB, whiteSpace: 'nowrap', borderBottom: `1px solid ${BORDER}` }
const listThSticky: React.CSSProperties = { ...listTh, position: 'sticky', top: 0, background: CARD_BG }
const listTd: React.CSSProperties = { padding: '9px 10px', fontSize: 13, color: TEXT, whiteSpace: 'nowrap', borderBottom: `1px solid ${BORDER}` }
const listEmpty: React.CSSProperties = { fontSize: 13, color: MUTED, textAlign: 'center', padding: '24px 0' }

const cardStyle: React.CSSProperties = {
  background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '12px 14px', boxSizing: 'border-box',
  display: 'flex', flexDirection: 'column', height: '100%',
}
// 시각화 카드(차트·표·도넛): 고정 높이로 통일
const chartCardStyle: React.CSSProperties = { ...cardStyle, height: CARD_H }
const sectionTitle: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: TEXT }
// 차트/빈상태 영역: 카드 안에서 flex:1 로 채워 카드 아래쪽 정렬
const chartArea: React.CSSProperties = { flex: 1, minHeight: CHART_H }
const emptyBox: React.CSSProperties = { flex: 1, minHeight: CHART_H, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: MUTED, textAlign: 'center', padding: '0 12px' }

type MonthDatum = { month: string; received: number; shipped: number }

// ── KPI 카드 (값 카운트업) ──
const kpiCardStyle: React.CSSProperties = { ...cardStyle, justifyContent: 'center', padding: '10px 12px' }
function Kpi({ label, value, unit, sub, valueColor, noData, noDataSub, noSub }: { label: string; value: number | null; unit: string; sub?: string; valueColor?: string; noData?: boolean; noDataSub?: string; noSub?: boolean }) {
  const isNull = value === null
  const dec = !isNull && !Number.isInteger(value) ? 1 : 0 // 소수 있는 값(소요일·수리기간)만 1자리 유지
  const animated = useCountUp(value ?? 0)
  // 표본 0 등 데이터 미축적: 카운트업 없이 안내 문구만 (큰 숫자 자리에 숫자보다 작은 글씨로 표시)
  if (noData) {
    return (
      <div style={kpiCardStyle}>
        <div style={{ fontSize: 11, color: MUTED }}>{label}</div>
        <div style={{ fontSize: 13, fontWeight: 500, color: MUTED, marginTop: 4, lineHeight: 1.1 }}>데이터 축적 중</div>
        {!noSub && <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{noDataSub || ' '}</div>}
      </div>
    )
  }
  return (
    <div style={kpiCardStyle}>
      <div style={{ fontSize: 11, color: MUTED }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: valueColor ?? TEXT, marginTop: 4, lineHeight: 1.1 }}>
        {isNull ? '—' : animated.toFixed(dec)}
        {!isNull && <span style={{ fontSize: 13, fontWeight: 400, color: MUTED, marginLeft: 3 }}>{unit}</span>}
      </div>
      {!noSub && <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{isNull ? '데이터 없음' : (sub || ' ')}</div>}
    </div>
  )
}

function KpiSkeleton() {
  return (
    <div style={kpiCardStyle}>
      <div style={{ height: 11, width: '48%', background: SKELETON, borderRadius: 6 }} />
      <div style={{ height: 22, width: '34%', background: SKELETON, borderRadius: 6, marginTop: 8 }} />
      <div style={{ height: 11, width: '40%', background: SKELETON, borderRadius: 6, marginTop: 8 }} />
    </div>
  )
}

// 섹션 제목 + 옆 보조 텍스트
function CardTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 8, marginBottom: 8, minHeight: 20, flexWrap: 'wrap' }}>
      <span style={sectionTitle}>{title}</span>
      {sub && <span style={{ fontSize: 11, color: MUTED }}>{sub}</span>}
    </div>
  )
}

function ChartSkeleton({ title }: { title: string; height?: number }) {
  return (
    <div style={chartCardStyle}>
      <div style={{ ...sectionTitle, marginBottom: 8, minHeight: 20, textAlign: 'center' }}>{title}</div>
      <div style={{ ...chartArea, background: SKELETON, borderRadius: 8 }} />
    </div>
  )
}

// ── 차트 카드 (월별 접수/출고 그룹 막대, 2계열) ──
function MonthBarCard({ title, data, animate }: { title: string; data: MonthDatum[]; animate: boolean }) {
  return (
    <div style={chartCardStyle}>
      <CardTitle title={title} />
      {data.length === 0 ? (
        <div style={emptyBox}>데이터가 없습니다</div>
      ) : (
        <div style={chartArea}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={CHART_MARGIN}>
            <CartesianGrid vertical={false} stroke={BORDER} />
            <XAxis dataKey="month" tickFormatter={(m: string) => m.slice(2).replace('-', '.')} tick={AXIS_TICK} axisLine={{ stroke: BORDER }} tickLine={false} />
            <YAxis allowDecimals={false} width={32} tick={AXIS_TICK} axisLine={{ stroke: BORDER }} tickLine={false} />
            <Tooltip cursor={{ fill: NEUTRAL_BG }} contentStyle={TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="received" name="입고" fill={C_ROSE} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={animate} animationDuration={ANIM_MS} animationEasing="ease-out" animationBegin={0}>
              <LabelList dataKey="received" position="top" fill={MUTED} fontSize={9} />
            </Bar>
            <Bar dataKey="shipped" name="출고" fill={C_BLUE} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={animate} animationDuration={ANIM_MS} animationEasing="ease-out" animationBegin={150}>
              <LabelList dataKey="shipped" position="top" fill={MUTED} fontSize={9} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

// ── 소요일 분포 (세로 막대, 단일 계열, 구간별 색) ──
function LeadDistCard({ buckets, total, animate }: { buckets: { label: string; count: number }[]; total: number; animate: boolean }) {
  return (
    <div style={chartCardStyle}>
      <CardTitle title="입출고 소요기간 분포" />
      {total === 0 ? (
        <div style={emptyBox}>데이터가 없습니다</div>
      ) : (
        <div style={chartArea}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={buckets} margin={{ top: 16, right: 8, bottom: 20, left: 0 }}>
            <CartesianGrid vertical={false} stroke={BORDER} />
            <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: BORDER }} tickLine={false} />
            <YAxis allowDecimals={false} width={32} tick={AXIS_TICK} axisLine={{ stroke: BORDER }} tickLine={false} />
            <Tooltip cursor={{ fill: NEUTRAL_BG }} contentStyle={TOOLTIP_STYLE} />
            <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={48} isAnimationActive={animate} animationDuration={ANIM_MS} animationEasing="ease-out" animationBegin={0}>
              {buckets.map((_, i) => <Cell key={i} fill={BUCKET_COLORS[i] ?? C_BLUE} />)}
              <LabelList dataKey="count" position="top" fill={MUTED} fontSize={11} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

// ── 가로 막대 랭킹 (고객 Top5 / 모델 Top10 공용, 단일 계열) ──
function HBarCard({ title, sub, data, catKey, animate }: {
  title: string; sub?: string; data: Record<string, string | number | null>[]; catKey: string; height?: number; animate: boolean
}) {
  const ellipsis = (v: string) => (v.length > 12 ? v.slice(0, 12) + '…' : v)
  return (
    <div style={chartCardStyle}>
      <CardTitle title={title} sub={sub} />
      {data.length === 0 ? (
        <div style={emptyBox}>데이터가 없습니다</div>
      ) : (
        <div style={chartArea}>
        <ResponsiveContainer width="100%" height="100%">
          {/* 세로형 랭킹: 카테고리 라벨(회사명·모델명) 표시 위해 YAxis width·right margin은 예외적으로 넉넉히 */}
          <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, bottom: 20, left: 0 }}>
            <CartesianGrid horizontal={false} stroke={BORDER} />
            <XAxis type="number" allowDecimals={false} tick={AXIS_TICK} axisLine={{ stroke: BORDER }} tickLine={false} />
            <YAxis type="category" dataKey={catKey} width={96} tickFormatter={(v: string) => ellipsis(String(v))} tick={AXIS_TICK} axisLine={{ stroke: BORDER }} tickLine={false} />
            <Tooltip cursor={{ fill: NEUTRAL_BG }} contentStyle={TOOLTIP_STYLE} />
            <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={animate} animationDuration={ANIM_MS} animationEasing="ease-out" animationBegin={0}>
              {data.map((_, i) => <Cell key={i} fill={RANK_COLORS[i % RANK_COLORS.length]} />)}
              <LabelList dataKey="count" position="right" fill={MUTED} fontSize={11} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

// ── 현재 입고 구성 (도넛, 중앙 숫자 카운트업) ──
function HoldDonutCard({ data, total, animate }: { data: { name: string; value: number; color: string }[]; total: number; animate: boolean }) {
  const animatedTotal = useCountUp(total)
  return (
    <div style={chartCardStyle}>
      <CardTitle title="현재 입고 구성" />
      {total === 0 ? (
        <div style={emptyBox}>현재 보유 중인 수리품이 없습니다</div>
      ) : (
        <div style={{ ...chartArea, display: 'flex', flexDirection: 'column' }}>
          <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={82} stroke="#fff" strokeWidth={2}
                  isAnimationActive={animate} animationDuration={900} animationEasing="ease-out" animationBegin={100}
                  startAngle={90} endAngle={-270}
                >
                  {data.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: TEXT, lineHeight: 1 }}>{Math.round(animatedTotal)}</div>
              <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>보유</div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
            {data.map(d => (
              <span key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: MUTED }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: d.color }} />
                {d.name} {d.value}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── 최근 8주 입고 (구분별 누적 막대) ──
function WeeklyTypeCard({ data, animate }: { data: { week: string; gauge: number; amp: number }[]; animate: boolean }) {
  const withTotal = data.map(d => ({ ...d, total: d.gauge + d.amp }))
  return (
    <div style={chartCardStyle}>
      <CardTitle title="최근 8주 입고" />
      {data.length === 0 ? (
        <div style={emptyBox}>데이터가 없습니다</div>
      ) : (
        <div style={chartArea}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={withTotal} margin={CHART_MARGIN}>
            <CartesianGrid vertical={false} stroke={BORDER} />
            <XAxis dataKey="week" tick={AXIS_TICK} axisLine={{ stroke: BORDER }} tickLine={false} />
            <YAxis allowDecimals={false} width={32} tick={AXIS_TICK} axisLine={{ stroke: BORDER }} tickLine={false} />
            <Tooltip cursor={{ fill: NEUTRAL_BG }} contentStyle={TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {/* 입고 지표라 빨강 계열로 통일 — 게이지/앰프 구분은 유지하되 밝은/진한 로즈 2톤으로 구분(둘 다 '입고=빨강') */}
            <Bar dataKey="gauge" stackId="a" fill={C_ROSE} name="게이지" maxBarSize={28} isAnimationActive={animate} animationDuration={ANIM_MS} animationEasing="ease-out" animationBegin={0}>
              <LabelList dataKey="total" position="top" fill={MUTED} fontSize={11} />
            </Bar>
            <Bar dataKey="amp" stackId="a" fill={WARN} name="앰프" maxBarSize={28} radius={[4, 4, 0, 0]} isAnimationActive={animate} animationDuration={ANIM_MS} animationEasing="ease-out" animationBegin={150} />
          </BarChart>
        </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

// ── 미출고 잔량 추이 (막대: 월말 잔량 + 숫자 라벨) ──
function BacklogCard({ data, animate }: { data: { month: string; backlog: number }[]; animate: boolean }) {
  // 막대 위에 월말 잔량 숫자만 표시(전월 대비 증감 제거).
  const renderLabel = (props: { x?: number | string; y?: number | string; width?: number | string; index?: number }) => {
    const x = Number(props.x ?? 0), y = Number(props.y ?? 0), width = Number(props.width ?? 0), index = props.index ?? 0
    const d = data[index]
    if (!d) return null
    return <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={13} fontWeight={700} fill={TEXT}>{d.backlog}</text>
  }
  return (
    <div style={chartCardStyle}>
      <CardTitle title="월별 잔량" />
      <div style={chartArea}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 22, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={BORDER} />
            <XAxis dataKey="month" tickFormatter={(m: string) => m.slice(2).replace('-', '.')} tick={AXIS_TICK} axisLine={{ stroke: BORDER }} tickLine={false} />
            <YAxis allowDecimals={false} width={32} tick={AXIS_TICK} axisLine={{ stroke: BORDER }} tickLine={false} />
            <Tooltip cursor={{ fill: NEUTRAL_BG }} contentStyle={TOOLTIP_STYLE} />
            <Bar dataKey="backlog" name="월말 잔량" fill={REPAIR_MEANING_COLORS['잔량']} radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={animate} animationDuration={ANIM_MS} animationEasing="ease-out" animationBegin={0}>
              <LabelList content={renderLabel} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ── 적체 Top 5 (미출고 · 경과일 순) ──
function StuckCard({ rows }: { rows: { r: Repair; aging: number }[] }) {
  return (
    <div style={chartCardStyle}>
      <CardTitle title="적체 Top 5" sub="미출고 · 경과일 순" />
      {rows.length === 0 ? (
        <div style={listEmpty}>적체된 수리품이 없습니다</div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflowX: 'auto', overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={listTh}>경과일</th>
              <th style={listTh}>입고일</th>
              <th style={listTh}>회사명</th>
              <th style={listTh}>제품 구분</th>
              <th style={listTh}>시리얼</th>
              <th style={listTh}>상태</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ r, aging }) => (
              <tr key={r.repair_id}>
                <td style={{ ...listTd, color: aging >= 30 ? WARN : aging >= 14 ? WARN2 : SUB, fontWeight: aging >= 30 ? 600 : 400 }}>{aging}일</td>
                <td style={listTd}>{r.received_date}</td>
                <td style={listTd}>{r.customer_name || '-'}</td>
                <td style={listTd}>{r.product_type || '-'}</td>
                <td style={listTd}>{r.serial_number || '-'}</td>
                <td style={listTd}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: REPAIR_STATUS_COLORS[r.status], flexShrink: 0 }} />
                    {r.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  )
}

// ── 재입고 목록 (2회 이상 접수된 시리얼) ──
function RepeatCard({ rows, reintake, total, pct }: {
  rows: { serial: string; count: number; customer: string; product: string; latest: string }[]
  reintake: number; total: number; pct: number
}) {
  return (
    <div style={chartCardStyle}>
      <CardTitle title="재입고 목록" />
      <div style={{ fontSize: 13, color: SUB, marginBottom: 8 }}>
        재입고 {reintake}건 / 전체 {total}건 (<span style={{ color: WARN, fontWeight: 600 }}>{pct}%</span>)
      </div>
      {rows.length === 0 ? (
        <div style={listEmpty}>재입고 이력이 없습니다</div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'auto', scrollbarGutter: 'stable' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={listThSticky}>시리얼</th>
                <th style={listThSticky}>회사명</th>
                <th style={listThSticky}>제품 구분</th>
                <th style={listThSticky}>접수 횟수</th>
                <th style={listThSticky}>최근 접수일</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.serial}>
                  <td style={listTd}>{row.serial}</td>
                  <td style={listTd}>{row.customer}</td>
                  <td style={listTd}>{row.product}</td>
                  <td style={{ ...listTd, color: row.count >= 3 ? WARN : TEXT, fontWeight: row.count >= 3 ? 600 : 400 }}>{row.count}회</td>
                  <td style={listTd}>{row.latest}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// 금액 축약: 억/만원 (막대 라벨·축·툴팁 공용)
const fmtKRW = (won: number): string => {
  if (won >= 1e8) { const eok = won / 1e8; return `${eok % 1 === 0 ? eok.toFixed(0) : eok.toFixed(1)}억원` }
  if (won >= 1e4) return `${Math.round(won / 1e4).toLocaleString('ko-KR')}만원`
  return `${Math.round(won).toLocaleString('ko-KR')}원`
}

// ── 월별 매출 (출고일 기준, 최근 6개월. 막대 위 금액 축약 라벨. 이번 달 매출은 제목 옆에) ──
function RevenueCard({ data, unlinkedCount, animate }: { data: { month: string; amount: number }[]; unlinkedCount: number; animate: boolean }) {
  const thisMonth = data.length ? data[data.length - 1].amount : 0
  const renderAmount = (props: { x?: number | string; y?: number | string; width?: number | string; index?: number }) => {
    const x = Number(props.x ?? 0), y = Number(props.y ?? 0), width = Number(props.width ?? 0), index = props.index ?? 0
    const amt = data[index]?.amount ?? 0
    if (amt <= 0) return null
    return <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={11} fontWeight={700} fill={TEXT}>{fmtKRW(amt)}</text>
  }
  return (
    <div style={chartCardStyle}>
      <CardTitle title="월별 매출" sub={`출고일 기준 · 이번 달 ${fmtKRW(thisMonth)}`} />
      <div style={chartArea}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 24, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={BORDER} />
            <XAxis dataKey="month" tickFormatter={(m: string) => m.slice(2).replace('-', '.')} tick={AXIS_TICK} axisLine={{ stroke: BORDER }} tickLine={false} />
            <YAxis width={44} tick={AXIS_TICK} axisLine={{ stroke: BORDER }} tickLine={false}
              tickFormatter={(v: number) => v >= 1e8 ? `${Math.round(v / 1e8)}억` : v >= 1e4 ? `${Math.round(v / 1e4)}만` : String(v)} />
            <Tooltip cursor={{ fill: NEUTRAL_BG }} contentStyle={TOOLTIP_STYLE} formatter={(value) => [fmtKRW(Number(value)), '매출']} />
            <Bar dataKey="amount" name="매출" fill={C_GREEN} radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={animate} animationDuration={ANIM_MS} animationEasing="ease-out" animationBegin={0}>
              <LabelList content={renderAmount} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {unlinkedCount > 0 && (
        <div style={{ fontSize: 11, color: MUTED, textAlign: 'right', marginTop: 6 }}>
          견적 미연결 {unlinkedCount}건은 매출에서 제외됨
        </div>
      )}
    </div>
  )
}


export default function RepairDashboardPage() {
  const { loading: guardLoading, authorized } = usePageGuard(canAccess20)
  const { repairs, loading } = useRepairs()

  // 접근성: reduced-motion 이면 recharts 애니메이션도 끔
  const [reduceMotion, setReduceMotion] = useState(false)
  useEffect(() => {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      setReduceMotion(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    }
  }, [])
  const animate = !reduceMotion

  // 월별 매출(출고일 기준) — quotes RLS 우회를 위해 /api/repair-quotes 집계 사용. 연도 필터 무관(최근 6개월 고정).
  const [revenue, setRevenue] = useState<{ months: { month: string; amount: number }[]; unlinkedCount: number } | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch('/api/repair-quotes?revenue=monthly')
      .then(r => r.json()).then(j => { if (!cancelled && Array.isArray(j.months)) setRevenue({ months: j.months, unlinkedCount: j.unlinkedCount ?? 0 }) })
      .catch(() => { /* 못 불러오면 카드 스켈레톤 유지 */ })
    return () => { cancelled = true }
  }, [])

  // ── 기간(연도) 필터 — 입고일 연도 기준. 상태/현재재고 카드는 제외하고 흐름·분석 카드에만 적용 ──
  const years = useMemo(() => {
    const s = new Set<string>()
    for (const r of repairs) { const y = (r.received_date ?? '').slice(0, 4); if (y) s.add(y) }
    return [...s].sort((a, b) => b.localeCompare(a)) // 최신 연도 먼저
  }, [repairs])
  const [year, setYear] = useState<string | null>(null) // null = 미설정(로드 후 최신 연도로 초기화)
  useEffect(() => {
    if (year === null && years.length > 0) setYear(years[0])
  }, [years, year])
  const sel = year ?? '전체'
  const periodRepairs = useMemo(
    () => (sel === '전체' ? repairs : repairs.filter(r => (r.received_date ?? '').slice(0, 4) === sel)),
    [repairs, sel],
  )

  if (!authorized) return <AccessGate loading={guardLoading} />

  // 성과 통계(소요일·소요일 분포·작업 소요일·적체)만 특이사항 건(special_type: 본사수리·수리불가·수리진행안함)을 제외한다.
  // 사실 지표(입고·출고·잔량·매출)는 특이사항을 포함한다 — 본사수리도 실제 매출·물량이므로.
  const normalPeriod = excludeSpecial(periodRepairs)
  const excludedCount = periodRepairs.length - normalPeriod.length

  // ── KPI 계산 ──
  // 보유/도넛은 '미출고' 기준(status!=='출고완료'). 본사 발송 중(isAtHq)도 고객 출고 전이라 포함하되,
  // 도넛·'수리중' KPI 에서 '본사' 구간으로 분리한다. 네 구간(입고·국내수리중·출고대기·본사)의 합 = held.
  const held = repairs.filter(r => r.status !== '출고완료').length                 // 미출고 총량(본사 발송 중 포함)
  const hqHeld = repairs.filter(r => r.status !== '출고완료' && isAtHq(r)).length   // 본사 발송 중(보유)
  const intake = repairs.filter(r => r.status === '입고' && !isAtHq(r)).length
  const repairing = repairs.filter(r => r.status === '수리중' && !isAtHq(r)).length // 국내 수리중
  const waiting = repairs.filter(r => r.status === '출고대기' && !isAtHq(r)).length

  // 소요일 (입고→출고): 대표값=평균 — 특이사항 제외
  const avgAll = avgLeadTime(normalPeriod)

  const gaugeRows = normalPeriod.filter(r => r.item_type === '게이지')
  const ampRows = normalPeriod.filter(r => r.item_type === '앰프')
  const avgGauge = avgLeadTime(gaugeRows)
  const avgAmp = avgLeadTime(ampRows)

  // 실제 수리 기간 (수리 시작→완료): 대표값=평균 + 유효 표본 수 — 특이사항 제외
  const durAll = avgRepairDuration(normalPeriod)
  const durGauge = avgRepairDuration(gaugeRows)
  const durAmp = avgRepairDuration(ampRows)
  const durAllN = countRepairDurationSamples(normalPeriod)
  const durGaugeN = countRepairDurationSamples(gaugeRows)
  const durAmpN = countRepairDurationSamples(ampRows)

  // ── 최근 6개월 입출고 추이 (이번 달 포함 고정 6개월, 0인 달도 표시) — 전체·게이지·앰프 ──
  // '실제로 일어난 사실'(입고·출고)이라 특이사항 포함 전체 repairs 기준. 미출고 잔량(backlog)과 같은 모집단이라
  // '전월말 잔량 + 입고 − 출고 = 당월말 잔량' 이 성립한다. 연도 필터는 잔량과 동일하게 미적용(이번 달 기준 고정 6개월).
  const monthlyAll = monthlyCountsRecent(repairs, 6)
  const monthlyGauge = monthlyCountsRecent(repairs.filter(r => r.item_type === '게이지'), 6)
  const monthlyAmp = monthlyCountsRecent(repairs.filter(r => r.item_type === '앰프'), 6)

  // ── 소요일 분포(연도 기준, 특이사항 제외) ──
  const leadBuckets = leadTimeBuckets(normalPeriod)
  const leadTotal = leadBuckets.reduce((s, b) => s + b.count, 0)
  // 미출고 잔량 추이: '현재 보유' KPI(held)와 동일 기준(물리 보유·특이사항 포함·본사발송중 제외)이라 전체 repairs 를 넣는다.
  // (성과 통계가 아니므로 excludeSpecial 을 쓰지 않는다 — 넣으면 KPI 및 입출고 추이와 모집단이 어긋난다.)
  const backlog = monthlyBacklogRecent(repairs, 6)

  // ── 본사수리 KPI 데이터 (발송/복귀 날짜 기준이라 연도 필터와 무관하게 전체 repairs 사용) ──
  const thisMonth = (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}` })()
  const hqThisMonth = hqMonthCounts(repairs, thisMonth)   // 이번 달 본사 발송/복귀
  const hqAvg = hqAvgTurnaround(repairs)                  // 본사 평균 소요일(복귀 완료 건)
  const shippedThisMonth = repairs.filter(r => (r.shipped_date ?? '').slice(0, 7) === thisMonth).length // 이번 달 출고완료(스루풋)

  // 평균 소요일 KPI 구간별 색: ~10 파랑 / ~14 초록 / ~17.5 노랑 / 그 이상 빨강. 값 없으면 기본색.
  const leadColor = (v: number | null): string | undefined =>
    v == null ? undefined : v <= 10 ? C_BLUE : v <= 14 ? C_GREEN : v <= 17.5 ? C_AMBER : C_ROSE

  const custTop = customerRanking(periodRepairs, 5)
  const prodTop = productRanking(periodRepairs, 5)
  const weeklyType = weeklyByType(repairs, 8) // '최근 8주'는 항상 현재 기준
  // 도넛(현재 입고 구성): 미출고 전체를 네 구간으로. 합 = held(보유 수리품 KPI)와 일치.
  const holdData = [
    { name: '입고', value: intake, color: REPAIR_STATUS_COLORS['입고'] },
    { name: '수리중', value: repairing, color: REPAIR_STATUS_COLORS['수리중'] },
    { name: '출고대기', value: waiting, color: REPAIR_STATUS_COLORS['출고대기'] },
    { name: '본사', value: hqHeld, color: REPAIR_MEANING_COLORS['본사'] },
  ]

  // ── 적체 Top 5 (미출고, 경과일 내림차순) — 특이사항 제외(본사 발송 중 건이 적체로 잡히지 않게) ──
  const stuck = excludeSpecial(repairs)
    .filter(r => r.status !== '출고완료')
    .map(r => ({ r, aging: getAgingDays(r) }))
    .sort((a, b) => b.aging - a.aging)
    .slice(0, 5)

  // ── 재입고 목록 (2회 이상 접수 시리얼, 횟수 내림차순) ──
  const repeatMap = getRepeatSerials(periodRepairs)
  const repeatRows = [...repeatMap.entries()]
    .map(([serial, rs]) => {
      const sorted = [...rs].sort((a, b) => (b.received_date || '').localeCompare(a.received_date || ''))
      return { serial, count: rs.length, customer: sorted[0]?.customer_name || '-', product: sorted[0]?.product_type || '-', latest: sorted[0]?.received_date || '-' }
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
  // 재입고 건수 = 각 시리얼의 2번째 이후 접수 건 합계
  const reintakeCount = [...repeatMap.values()].reduce((s, rs) => s + (rs.length - 1), 0)
  const totalCount = periodRepairs.length
  const reintakePct = totalCount > 0 ? Math.round((reintakeCount / totalCount) * 100) : 0

  return (
    <div style={{ background: PAGE_BG, minHeight: 'calc(100vh - 44px)', padding: 16, boxSizing: 'border-box' }}>
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <style>{`
          /* KPI: 4열 × 3줄(12칸) 고정, 좁아지면 2열 → 1열 */
          .repair-kpi-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
          @media (max-width: 900px) { .repair-kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
          @media (max-width: 560px) { .repair-kpi-grid { grid-template-columns: 1fr; } }
        `}</style>

        {/* 헤더: 기간(연도) 필터 · 목록 이동 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: SUB }}>기간</span>
            {years.length > 0 && (
              <SegmentedControl
                options={['전체', ...years.map(y => ({ label: `${y}년`, value: y }))]}
                value={sel}
                onChange={setYear}
              />
            )}
          </div>
          <Link href="/repair"
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = MUTED; (e.currentTarget as HTMLElement).style.background = PAGE_BG }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = BORDER; (e.currentTarget as HTMLElement).style.background = CARD_BG }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', border: `1px solid ${BORDER}`, borderRadius: 8, background: CARD_BG, color: SUB, fontSize: 13, fontWeight: 700, textDecoration: 'none', transition: 'border-color 0.15s ease, background 0.15s ease' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
            </svg>
            목록으로
          </Link>
        </div>

        {/* 성과 통계 제외 안내 (특이사항 건) — 선택 기간 기준. 입출고·잔량·매출은 포함하고 소요일 성과에서만 제외한다. */}
        {excludedCount > 0 && (
          <div style={{ fontSize: 11, color: MUTED }}>
            특이사항 건(본사수리·수리불가·수리진행안함) {excludedCount}건은 소요일 등 성과 통계에서만 제외됨
          </div>
        )}

        {/* 1행: 현재 입고 구성(도넛) · 적체 Top5 · KPI 12칸, 높이 통일(카드 300px, 적체는 내부 스크롤) */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'stretch' }}>
          <div style={{ flex: '1 1 260px', minWidth: 0 }}>
            {loading ? <ChartSkeleton title="현재 입고 구성" height={190} /> : <HoldDonutCard data={holdData} total={held} animate={animate} />}
          </div>
          <div style={{ flex: '2 1 480px', minWidth: 0 }}>
            {loading ? <ChartSkeleton title="적체 Top 5" height={200} /> : <StuckCard rows={stuck} />}
          </div>
          <div style={{ flex: '2.2 1 440px', minWidth: 0 }}>
            <div className="repair-kpi-grid" style={{ display: 'grid', gap: 8, height: '100%', gridAutoRows: '1fr' }}>
              {loading ? (
                Array.from({ length: 12 }).map((_, i) => <KpiSkeleton key={i} />)
              ) : (
                <>
                  {/* 1줄: 재고 상태 + 이번 달 스루풋 */}
                  <Kpi label="보유 수리품" value={held} unit="건" sub="출고완료 제외" />
                  <Kpi label="수리중" value={repairing + hqHeld} unit="건" sub={`국내 ${repairing} · 본사 ${hqHeld}`} />
                  <Kpi label="출고 대기" value={waiting} unit="건" />
                  <Kpi label="이번 달 출고완료" value={shippedThisMonth} unit="건" valueColor={REPAIR_MEANING_COLORS['출고완료']} />
                  {/* 2줄: 입출고 소요일 (입고→출고, 평균) + 본사 평균 소요일 */}
                  <Kpi label="전체 입출고 평균 소요일" value={avgAll} unit="일" valueColor={leadColor(avgAll)} />
                  <Kpi label="게이지 입출고 평균 소요일" value={avgGauge} unit="일" />
                  <Kpi label="앰프 입출고 평균 소요일" value={avgAmp} unit="일" />
                  <Kpi label="본사 평균 소요일" value={hqAvg} unit="일" sub="복귀 완료 건" />
                  {/* 3줄: 작업 평균 소요일 (수리 시작→완료, 평균) + 이번 달 본사 발송/복귀 */}
                  <Kpi label="전체 작업 평균 소요일" value={durAll} unit="일" noData={durAllN === 0} noSub />
                  <Kpi label="게이지 작업 평균 소요일" value={durGauge} unit="일" noData={durGaugeN === 0} noSub />
                  <Kpi label="앰프 작업 평균 소요일" value={durAmp} unit="일" noData={durAmpN === 0} noSub />
                  <Kpi label="이번 달 본사 발송" value={hqThisMonth.requested} unit="건" sub={`복귀 ${hqThisMonth.returned}건`} valueColor={REPAIR_MEANING_COLORS['본사']} />
                </>
              )}
            </div>
          </div>
        </div>

        {/* 차트 영역: 행 단위 세로 스택 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* 2행: 전체 입출고 / 게이지 / 앰프 / 소요일 분포 / 최근 8주 입고 (5개 균등) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 8, alignItems: 'stretch' }}>
            {loading ? <ChartSkeleton title="전체 입출고" height={200} /> : <MonthBarCard title="전체 입출고" data={monthlyAll} animate={animate} />}
            {loading ? <ChartSkeleton title="게이지" height={200} /> : <MonthBarCard title="게이지" data={monthlyGauge} animate={animate} />}
            {loading ? <ChartSkeleton title="앰프" height={200} /> : <MonthBarCard title="앰프" data={monthlyAmp} animate={animate} />}
            {loading ? <ChartSkeleton title="입출고 소요기간 분포" height={190} /> : <LeadDistCard buckets={leadBuckets} total={leadTotal} animate={animate} />}
            {loading ? <ChartSkeleton title="최근 8주 입고" height={190} /> : <WeeklyTypeCard data={weeklyType} animate={animate} />}
          </div>

          {/* 3행: 월별 매출 | 월별 잔량 (좌우 반반) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, alignItems: 'stretch' }}>
            {!revenue ? <ChartSkeleton title="월별 매출" height={190} /> : <RevenueCard data={revenue.months} unlinkedCount={revenue.unlinkedCount} animate={animate} />}
            {loading ? <ChartSkeleton title="월별 잔량" height={190} /> : <BacklogCard data={backlog} animate={animate} />}
          </div>

          {/* 4행: 주요 고객 / 모델별 / 재입고 (3개 균등, 적체는 1행으로 이동) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, alignItems: 'stretch' }}>
            {loading ? <ChartSkeleton title="주요 고객 Top 5" height={190} /> : <HBarCard title="주요 고객 Top 5" data={custTop} catKey="name" height={190} animate={animate} />}
            {loading ? <ChartSkeleton title="모델별 Top 5" height={190} /> : <HBarCard title="모델별 Top 5" data={prodTop} catKey="type" height={190} animate={animate} />}
            {loading ? <ChartSkeleton title="재입고 목록" height={190} /> : <RepeatCard rows={repeatRows} reintake={reintakeCount} total={totalCount} pct={reintakePct} />}
          </div>
        </div>

      </div>
    </div>
  )
}
