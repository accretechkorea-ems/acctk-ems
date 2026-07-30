'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, ComposedChart, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList,
} from 'recharts'
import { useRepairAuth } from '@/hooks/useRepairAuth'
import { useRepairs, type Repair } from '@/hooks/useRepairs'
import { useCountUp } from '@/hooks/useCountUp'
import { CHART_COLORS, REPAIR_STATUS_COLORS } from '@/lib/categoryColors'
import {
  avgLeadTime, medianLeadTime, monthlyCounts, getLeadTime,
  leadTimeBuckets, monthlyLeadTime, monthlyBacklog,
  customerRanking, productRanking, weeklyByType,
  getAgingDays, getRepeatSerials,
} from '@/lib/repairStats'

// ── 색상: EMS 팔레트(lib/categoryColors.ts 기존 값)만 사용 ──
const ACCENT = '#234ea2' // 브랜드 액센트: 링크·버튼 등 UI 전용 (차트 아님)
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
const CHART_MARGIN_NOLEG = { top: 8, right: 8, bottom: 20, left: 0 } as const // Legend 없는 차트: 하단 20 확보
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
function Kpi({ label, value, unit, sub, valueColor }: { label: string; value: number | null; unit: string; sub?: string; valueColor?: string }) {
  const isNull = value === null
  const dec = !isNull && !Number.isInteger(value) ? 1 : 0 // 소수 있는 값(평균 소요일)만 1자리 유지
  const animated = useCountUp(value ?? 0)
  return (
    <div style={{ ...cardStyle, justifyContent: 'center' }}>
      <div style={{ fontSize: 11, color: MUTED }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: valueColor ?? TEXT, marginTop: 4, lineHeight: 1.1 }}>
        {isNull ? '—' : animated.toFixed(dec)}
        {!isNull && <span style={{ fontSize: 13, fontWeight: 400, color: MUTED, marginLeft: 3 }}>{unit}</span>}
      </div>
      <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{isNull ? '데이터 없음' : (sub || ' ')}</div>
    </div>
  )
}

function KpiSkeleton() {
  return (
    <div style={{ ...cardStyle, justifyContent: 'center' }}>
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
              <LabelList dataKey="received" position="top" fill={MUTED} fontSize={11} />
            </Bar>
            <Bar dataKey="shipped" name="출고" fill={C_BLUE} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={animate} animationDuration={ANIM_MS} animationEasing="ease-out" animationBegin={150}>
              <LabelList dataKey="shipped" position="top" fill={MUTED} fontSize={11} />
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
      <CardTitle title="소요일 분포" sub={`출고 완료 건 기준, 총 ${total}건`} />
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

// ── 평균 소요일 월별 추이 (선, 결측 달은 끊김, 단일 계열) ──
function LeadTrendCard({ data, animate }: { data: { month: string; avg: number | null }[]; animate: boolean }) {
  const points = data.filter(d => d.avg !== null).length
  return (
    <div style={chartCardStyle}>
      <CardTitle title="평균 소요일 월별 추이" />
      {points < 3 ? (
        <div style={emptyBox}>추세를 보려면 최소 3개월 데이터가 필요합니다</div>
      ) : (
        <div style={chartArea}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={CHART_MARGIN_NOLEG}>
            <CartesianGrid vertical={false} stroke={BORDER} />
            <XAxis dataKey="month" tickFormatter={(m: string) => m.slice(2).replace('-', '.')} tick={AXIS_TICK} axisLine={{ stroke: BORDER }} tickLine={false} />
            <YAxis allowDecimals={false} width={40} tickFormatter={(v: number) => `${v}일`} tick={AXIS_TICK} axisLine={{ stroke: BORDER }} tickLine={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Line type="monotone" dataKey="avg" name="평균 소요일" stroke={C_BLUE} strokeWidth={2} dot connectNulls={false} isAnimationActive={animate} animationDuration={ANIM_MS} animationEasing="ease-out" animationBegin={0} />
          </LineChart>
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
            <Bar dataKey="gauge" stackId="a" fill={CHART_COLORS.blue} name="게이지" maxBarSize={28} isAnimationActive={animate} animationDuration={ANIM_MS} animationEasing="ease-out" animationBegin={0}>
              <LabelList dataKey="total" position="top" fill={MUTED} fontSize={11} />
            </Bar>
            <Bar dataKey="amp" stackId="a" fill={CHART_COLORS.violet} name="앰프" maxBarSize={28} radius={[4, 4, 0, 0]} isAnimationActive={animate} animationDuration={ANIM_MS} animationEasing="ease-out" animationBegin={150} />
          </BarChart>
        </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

// ── 미출고 잔량 추이 (막대: 월 순증감 / 선: 월말 잔량) ──
function BacklogCard({ data, animate }: { data: { month: string; backlog: number; received: number; shipped: number; net: number }[]; animate: boolean }) {
  return (
    <div style={chartCardStyle}>
      <CardTitle title="미출고 잔량 추이" sub="월말 기준 사내 보유 건수" />
      {data.length === 0 ? (
        <div style={emptyBox}>데이터가 없습니다</div>
      ) : (
        <div style={chartArea}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={CHART_MARGIN}>
            <CartesianGrid vertical={false} stroke={BORDER} />
            <XAxis dataKey="month" tickFormatter={(m: string) => m.slice(2).replace('-', '.')} tick={AXIS_TICK} axisLine={{ stroke: BORDER }} tickLine={false} />
            <YAxis yAxisId="left" allowDecimals={false} width={32} tick={AXIS_TICK} axisLine={{ stroke: BORDER }} tickLine={false} />
            <YAxis yAxisId="right" orientation="right" allowDecimals={false} width={32} tick={AXIS_TICK} axisLine={{ stroke: BORDER }} tickLine={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar yAxisId="left" dataKey="net" name="순증감" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={animate} animationDuration={ANIM_MS} animationEasing="ease-out" animationBegin={0}>
              {data.map((d, i) => <Cell key={i} fill={d.net >= 0 ? C_ROSE : C_BLUE} />)}
            </Bar>
            <Line yAxisId="right" type="monotone" dataKey="backlog" name="월말 잔량" stroke={C_ROSE} strokeWidth={2} dot isAnimationActive={animate} animationDuration={ANIM_MS} animationEasing="ease-out" animationBegin={150} />
          </ComposedChart>
        </ResponsiveContainer>
        </div>
      )}
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
                <td style={listTd}>{r.status}</td>
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

// 전체 폭을 차지하는 그리드 아이템 래퍼
const FULL: React.CSSProperties = { gridColumn: '1 / -1' }

export default function RepairDashboardPage() {
  const router = useRouter()
  const { authorized } = useRepairAuth()
  const { repairs, loading } = useRepairs()

  // 접근성: reduced-motion 이면 recharts 애니메이션도 끔
  const [reduceMotion, setReduceMotion] = useState(false)
  useEffect(() => {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      setReduceMotion(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    }
  }, [])
  const animate = !reduceMotion

  if (authorized === null) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh', fontSize: 16, color: MUTED }}>확인 중...</div>
  }
  if (authorized === false) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, justifyContent: 'center', alignItems: 'center', height: '60vh', color: MUTED }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: TEXT }}>접근 권한이 없습니다</div>
        <div style={{ fontSize: 14 }}>이 페이지는 20팀 담당자와 관리자만 열람할 수 있습니다.</div>
        <button onClick={() => router.push('/')} style={{ marginTop: 8, padding: '8px 18px', border: 'none', borderRadius: 8, background: ACCENT, color: '#fff', fontWeight: 700, cursor: 'pointer' }}>홈으로</button>
      </div>
    )
  }

  // ── KPI 계산 ──
  const held = repairs.filter(r => r.status !== '출고완료').length
  const repairing = repairs.filter(r => r.status === '수리중').length
  const waiting = repairs.filter(r => r.status === '출고대기').length

  const avgAll = avgLeadTime(repairs)
  const medAll = medianLeadTime(repairs)

  const gaugeRows = repairs.filter(r => r.item_type === '게이지')
  const ampRows = repairs.filter(r => r.item_type === '앰프')
  const avgGauge = avgLeadTime(gaugeRows)
  const avgAmp = avgLeadTime(ampRows)
  const gaugeSample = gaugeRows.filter(r => getLeadTime(r) !== null).length
  const ampSample = ampRows.filter(r => getLeadTime(r) !== null).length

  // ── 월별 접수/출고 (최근 6개월, 전체·게이지·앰프) ──
  const monthlyAll = monthlyCounts(repairs).slice(-6)
  const monthlyGauge = monthlyCounts(gaugeRows).slice(-6)
  const monthlyAmp = monthlyCounts(ampRows).slice(-6)

  // ── 추가 차트 데이터 ──
  const leadBuckets = leadTimeBuckets(repairs)
  const leadTotal = leadBuckets.reduce((s, b) => s + b.count, 0)
  const leadTrend = monthlyLeadTime(repairs)
  const backlog = monthlyBacklog(repairs)

  // 평균 소요일: 최근 달이 그 전 달보다 길면(악화) KPI 값만 로즈. 비교 데이터 없으면 기본색.
  const leadMonthsWithAvg = leadTrend.filter((d): d is { month: string; avg: number } => d.avg !== null)
  const leadWorse = leadMonthsWithAvg.length >= 2 &&
    leadMonthsWithAvg[leadMonthsWithAvg.length - 1].avg > leadMonthsWithAvg[leadMonthsWithAvg.length - 2].avg

  const custTop = customerRanking(repairs, 5)
  const prodTop = productRanking(repairs, 5)
  const weeklyType = weeklyByType(repairs, 8)
  const holdData = [
    { name: '입고', value: repairs.filter(r => r.status === '입고').length, color: REPAIR_STATUS_COLORS['입고'] },
    { name: '수리중', value: repairs.filter(r => r.status === '수리중').length, color: REPAIR_STATUS_COLORS['수리중'] },
    { name: '출고대기', value: repairs.filter(r => r.status === '출고대기').length, color: REPAIR_STATUS_COLORS['출고대기'] },
  ]

  // ── 적체 Top 5 (미출고, 경과일 내림차순) ──
  const stuck = repairs
    .filter(r => r.status !== '출고완료')
    .map(r => ({ r, aging: getAgingDays(r) }))
    .sort((a, b) => b.aging - a.aging)
    .slice(0, 5)

  // ── 재입고 목록 (2회 이상 접수 시리얼, 횟수 내림차순) ──
  const repeatMap = getRepeatSerials(repairs)
  const repeatRows = [...repeatMap.entries()]
    .map(([serial, rs]) => {
      const sorted = [...rs].sort((a, b) => (b.received_date || '').localeCompare(a.received_date || ''))
      return { serial, count: rs.length, customer: sorted[0]?.customer_name || '-', product: sorted[0]?.product_type || '-', latest: sorted[0]?.received_date || '-' }
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
  // 재입고 건수 = 각 시리얼의 2번째 이후 접수 건 합계
  const reintakeCount = [...repeatMap.values()].reduce((s, rs) => s + (rs.length - 1), 0)
  const totalCount = repairs.length
  const reintakePct = totalCount > 0 ? Math.round((reintakeCount / totalCount) * 100) : 0

  return (
    <div style={{ background: PAGE_BG, minHeight: 'calc(100vh - 44px)', padding: 16, boxSizing: 'border-box' }}>
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <style>{`
          /* KPI: 3열 × 2줄 고정, 좁아지면 2열 → 1열 */
          .repair-kpi-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
          @media (max-width: 900px) { .repair-kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
          @media (max-width: 560px) { .repair-kpi-grid { grid-template-columns: 1fr; } }
        `}</style>

        {/* 헤더 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: TEXT, letterSpacing: '-0.3px' }}>수리 대시보드</h1>
          <Link href="/repair" style={{ fontSize: 13, fontWeight: 700, color: ACCENT, textDecoration: 'none' }}>← 목록으로</Link>
        </div>

        {/* 상단 개요: 보유 구성 + 월별 전체(왼쪽) · KPI(오른쪽), 높이 통일 */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'stretch' }}>
          <div style={{ flex: '1 1 280px', minWidth: 0 }}>
            {loading ? <ChartSkeleton title="현재 입고 구성" height={190} /> : <HoldDonutCard data={holdData} total={held} animate={animate} />}
          </div>
          <div style={{ flex: '1.4 1 340px', minWidth: 0 }}>
            {loading ? <ChartSkeleton title="전체 입출고" height={200} /> : <MonthBarCard title="전체 입출고" data={monthlyAll} animate={animate} />}
          </div>
          <div style={{ flex: '2 1 400px', minWidth: 0 }}>
            <div className="repair-kpi-grid" style={{ display: 'grid', gap: 8, height: '100%', gridAutoRows: '1fr' }}>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => <KpiSkeleton key={i} />)
              ) : (
                <>
                  <Kpi label="보유 수리품" value={held} unit="건" sub="출고완료 제외" />
                  <Kpi label="수리중" value={repairing} unit="건" />
                  <Kpi label="출고 대기" value={waiting} unit="건" />
                  <Kpi label="평균 소요일" value={avgAll} unit="일" sub={avgAll !== null ? `중앙값 ${medAll}일` : undefined} valueColor={leadWorse ? WARN : undefined} />
                  <Kpi label="게이지 평균" value={avgGauge} unit="일" sub={avgGauge !== null ? `표본 ${gaugeSample}건` : undefined} />
                  <Kpi label="앰프 평균" value={avgAmp} unit="일" sub={avgAmp !== null ? `표본 ${ampSample}건` : undefined} />
                </>
              )}
            </div>
          </div>
        </div>

        {/* 차트 그리드 (auto-fit, 전체폭 항목은 gridColumn 1/-1) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 8, alignItems: 'stretch' }}>
          {loading ? <ChartSkeleton title="게이지" height={200} /> : <MonthBarCard title="게이지" data={monthlyGauge} animate={animate} />}
          {loading ? <ChartSkeleton title="앰프" height={200} /> : <MonthBarCard title="앰프" data={monthlyAmp} animate={animate} />}
          {loading ? <ChartSkeleton title="소요일 분포" height={190} /> : <LeadDistCard buckets={leadBuckets} total={leadTotal} animate={animate} />}
          {loading ? <ChartSkeleton title="평균 소요일 월별 추이" height={190} /> : <LeadTrendCard data={leadTrend} animate={animate} />}
          {loading ? <ChartSkeleton title="최근 8주 입고" height={190} /> : <WeeklyTypeCard data={weeklyType} animate={animate} />}

          {/* 전체 폭 */}
          <div style={FULL}>{loading ? <ChartSkeleton title="미출고 잔량 추이" height={190} /> : <BacklogCard data={backlog} animate={animate} />}</div>

          {/* 전체 폭: 주요 고객 · 모델별 · 적체 · 재입고 4분할 */}
          <div style={{ ...FULL, display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, alignItems: 'stretch' }}>
            {loading ? <ChartSkeleton title="주요 고객 Top 5" height={190} /> : <HBarCard title="주요 고객 Top 5" data={custTop} catKey="name" height={190} animate={animate} />}
            {loading ? <ChartSkeleton title="모델별 Top 5" height={190} /> : <HBarCard title="모델별 Top 5" data={prodTop} catKey="type" height={190} animate={animate} />}
            {loading ? <ChartSkeleton title="적체 Top 5" height={190} /> : <StuckCard rows={stuck} />}
            {loading ? <ChartSkeleton title="재입고 목록" height={190} /> : <RepeatCard rows={repeatRows} reintake={reintakeCount} total={totalCount} pct={reintakePct} />}
          </div>
        </div>

      </div>
    </div>
  )
}
