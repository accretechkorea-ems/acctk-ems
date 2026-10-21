'use client'

// 포캐스트 — 회계연도 열두 달의 목표·예상·확정을 한 화면에서 본다.
//
// 예전에는 영업기회 칸반(단계별 열)이었다. 본사 보고가 「담당자 × 월 × 상태 금액」이라
// 단계 보드로는 그 숫자가 나오지 않아 표로 바꿨다. 주소(/pipeline)와 메뉴 키·권한은 그대로다.
//
// ── 줄은 어디서 오는가 ──────────────────────────────────────────────────────
//   lib/forecast.ts 가 견적과 영업기회를 **한 줄 모양**으로 바꾼다(판정 규칙은 전부 거기 있다).
//   이 화면은 거르고·더하고·그리기만 한다 — 여기서 상태를 다시 판정하지 않는다.
//
// ── 영업기회 입력은 남는다 ──────────────────────────────────────────────────
//   견적 전 안건을 넣는 입구는 영업기회 모달 하나뿐이다. 그래서 등록·수정 모달은 그대로 두고,
//   자주 고치는 두 값(예상월·금액)만 줄에서 바로 고치게 했다.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { usePageGuard } from '@/hooks/usePageGuard'
import AccessGate from '@/components/common/AccessGate'
import { isSuperAdmin } from '@/lib/permissions'
import { todayKST } from '@/lib/date'
import { FORM_LABELS, isFormKind } from '@/lib/quoteForms'
import { useQuoteCategories } from '@/lib/quoteCategories'
import {
  FORECAST_STATUSES, bucketOf, emptyBucket, fiscalMonths, fiscalYearOfMonth,
  type Bucket, type ForecastRow, type ForecastStatus,
} from '@/lib/forecast'
import { exportForecastXlsx } from '@/lib/forecastExcel'
import { useForecast } from '@/hooks/forecast/useForecast'
import { usePipelineData } from '@/hooks/pipeline/usePipelineData'
import { useOpportunityCrud } from '@/hooks/customer/useOpportunityCrud'
import { useQuotePdf } from '@/hooks/customer/useQuotePdf'
import OpportunityModal from '@/components/customer/modals/OpportunityModal'
import ForecastMonthTable from '@/components/forecast/ForecastMonthTable'
import ForecastRowList from '@/components/forecast/ForecastRowList'
import type { SalesOpportunity } from '@/components/customer/types'

const PAGE_BG = '#fafafa'
const BORDER = '#ebebeb'
const TEXT = '#111827'
const GRAY = '#6b7280'
const MUTED = '#9ca3af'
const BLUE = '#234ea2'

type SourceFilter = 'all' | 'quote' | 'opportunity'

const sel: React.CSSProperties = {
  padding: '7px 10px', border: `1px solid ${BORDER}`, borderRadius: 6,
  background: '#fff', color: TEXT, fontSize: 12, fontWeight: 600,
  fontFamily: 'inherit', cursor: 'pointer', outline: 'none',
}

export default function ForecastPage() {
  const { loading: guardLoading, authorized } = usePageGuard()
  const router = useRouter()
  const today = todayKST()

  // 영업기회 쪽(모달·권한)은 종전 조회를 그대로 쓴다. 집계는 별도 훅이 읽는다 —
  // 둘 다 영업기회를 읽지만(22건 안팎) 고친 뒤에는 **양쪽 다** 다시 읽어야 숫자가 맞는다.
  const pipeline = usePipelineData()
  const { opportunities, activities, engineers, customers, me, reload } = pipeline
  const fc = useForecast(today)
  const { categories } = useQuoteCategories()

  const reloadAll = async () => {
    const ok = await reload()
    await fc.reload()
    return ok
  }
  const opp = useOpportunityCrud({ customerId: null, engineerId: me.engineer_id, role: me.role, fetchDetail: reloadAll })
  const quotePdf = useQuotePdf({ customer: null, engineerId: me.engineer_id })

  // ── 필터 ──
  const thisFY = fiscalYearOfMonth(today.slice(0, 7))
  const [fy, setFy] = useState(thisFY)
  const [team, setTeam] = useState<string>('')
  const [engineerId, setEngineerId] = useState<number | null>(null)
  const [category, setCategory] = useState<string>('')
  const [source, setSource] = useState<SourceFilter>('all')
  const [statuses, setStatuses] = useState<Set<ForecastStatus>>(() => new Set(FORECAST_STATUSES))
  const [picked, setPicked] = useState<string | null>(null)

  // 볼 수 있는 사람 — /sales 와 같은 규칙이다(superadmin 은 전체, 그 밖은 본인만).
  const scopeAll = isSuperAdmin({ permission_level: me.role })
  const visibleEngineers = useMemo(() => {
    const list = scopeAll ? engineers : engineers.filter(e => e.engineer_id === me.engineer_id)
    return team ? list.filter(e => (e.teams ?? '') === team) : list
  }, [engineers, scopeAll, me.engineer_id, team])

  const pickedEngineerIds = useMemo(() => {
    const ids = visibleEngineers.map(e => e.engineer_id)
    return engineerId == null ? ids : ids.filter(id => id === engineerId)
  }, [visibleEngineers, engineerId])

  const teamNames = useMemo(
    () => [...new Set(engineers.map(e => e.teams).filter((t): t is string => !!t))].sort(),
    [engineers],
  )

  const months = useMemo(() => fiscalMonths(fy), [fy])
  const monthSet = useMemo(() => new Set(months), [months])
  const idSet = useMemo(() => new Set(pickedEngineerIds), [pickedEngineerIds])

  /** 요약에 쓰는 줄 — 달(회계연도)·사람·분류·출처·상태까지 걸러 낸다. */
  const scopedRows = useMemo(() => fc.result.rows.filter(r => {
    if (!monthSet.has(r.month)) return false
    if (r.engineerId == null || !idSet.has(r.engineerId)) return false
    if (category && (r.category ?? '') !== category) return false
    if (source !== 'all' && r.source !== source) return false
    if (!statuses.has(r.status)) return false
    return true
  }), [fc.result.rows, monthSet, idSet, category, source, statuses])

  /** 월별 요약. 목표는 **줄이 아니라 sales_targets** 에서 오므로 상태·분류 필터와 무관하다. */
  const summary = useMemo(() => {
    const byMonth = new Map<string, Bucket>(months.map(m => [m, emptyBucket()]))
    for (const r of scopedRows) {
      const b = byMonth.get(r.month)
      if (b) b[bucketOf(r.status)] += r.amount
    }
    for (const m of months) {
      const b = byMonth.get(m)
      if (b) b.목표 = fc.targetOf(m, pickedEngineerIds)
    }
    return months.map(m => ({ month: m, bucket: byMonth.get(m) ?? emptyBucket() }))
  }, [months, scopedRows, fc, pickedEngineerIds])

  /** 목록에 그릴 줄 — 달을 골랐으면 그 달만. */
  const listRows = useMemo(() => {
    const rows = picked ? scopedRows.filter(r => r.month === picked) : scopedRows
    return [...rows].sort((a, b) => (a.month === b.month
      ? b.amount - a.amount
      : (a.month < b.month ? -1 : 1)))
  }, [scopedRows, picked])

  // ── 이름 ──
  const engineerName = useMemo(() => {
    const m = new Map(engineers.map(e => [e.engineer_id, `${e.name} ${e.position ?? ''}`.trim()]))
    return (id: number | null) => (id == null ? '' : m.get(id) ?? `#${id}`)
  }, [engineers])
  const customerName = (id: number | null) => (id == null ? '' : fc.customerNames.get(id) ?? `#${id}`)
  const categoryLabel = (code: string | null) =>
    (code ? categories.find(c => c.code === code)?.label ?? code : '-')
  const formLabel = (code: string | null) => (isFormKind(code) ? FORM_LABELS[code] : '-')
  const oppById = useMemo(() => new Map(opportunities.map(o => [o.opportunity_id, o])), [opportunities])

  const toggleStatus = (s: ForecastStatus) => setStatuses(prev => {
    const next = new Set(prev)
    if (next.has(s)) next.delete(s); else next.add(s)
    // 전부 끄면 아무것도 안 보이므로 마지막 하나는 끄지 않는다.
    return next.size === 0 ? prev : next
  })

  const openQuote = (row: ForecastRow) =>
    quotePdf.openQuotePdfByUrl(row.pdfUrl, row.no ?? '')

  // 안건에서 견적으로 — opportunity_id 를 주소에 실어 보낸다(견적 화면이 그 값을 읽어 고객·기회를 채운다).
  const writeQuote = (o: SalesOpportunity) => router.push(`/quote?opportunity=${o.opportunity_id}`)

  const exportXlsx = () => void exportForecastXlsx({
    months: summary, rows: listRows,
    engineerName, customerName, categoryLabel, formLabel,
    titleOf: r => (r.source === 'quote' ? (r.no ?? `#${r.id}`) : (oppById.get(r.id)?.title ?? `#${r.id}`)),
    label: `FY${fy}${team ? `_${team}` : ''}${picked ? `_${picked}` : ''}`,
  })

  if (!authorized) return <AccessGate loading={guardLoading} />

  const loading = pipeline.loading || fc.loading

  return (
    <main style={{ padding: '24px 28px', background: PAGE_BG, minHeight: '100vh', boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 1600, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* ── 필터 ── */}
        <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <select value={fy} onChange={e => setFy(Number(e.target.value))} style={sel} aria-label="회계연도">
              {[thisFY + 1, thisFY, thisFY - 1, thisFY - 2].map(y => (
                <option key={y} value={y}>FY{y} ({y}.04 ~ {y + 1}.03)</option>
              ))}
            </select>

            <select value={team} onChange={e => { setTeam(e.target.value); setEngineerId(null) }} style={sel} aria-label="팀" disabled={!scopeAll}>
              <option value="">전체 팀</option>
              {teamNames.map(t => <option key={t} value={t}>{t}</option>)}
            </select>

            <select
              value={engineerId ?? ''}
              onChange={e => setEngineerId(e.target.value ? Number(e.target.value) : null)}
              style={sel} aria-label="담당자" disabled={!scopeAll}
            >
              <option value="">{scopeAll ? '전체 담당자' : engineerName(me.engineer_id)}</option>
              {visibleEngineers.map(e => (
                <option key={e.engineer_id} value={e.engineer_id}>{`${e.name} ${e.position ?? ''}`.trim()}</option>
              ))}
            </select>

            <select value={category} onChange={e => setCategory(e.target.value)} style={sel} aria-label="분류">
              <option value="">전체 분류</option>
              {categories.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>

            <select value={source} onChange={e => setSource(e.target.value as SourceFilter)} style={sel} aria-label="출처">
              <option value="all">견적 + 영업기회</option>
              <option value="quote">견적만</option>
              <option value="opportunity">영업기회만</option>
            </select>

            {/* 상태 — 여러 개를 켜고 끈다. 전부 끄지는 못한다(빈 화면이 된다). */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              {FORECAST_STATUSES.filter(s => s === '포캐스트' || !s.startsWith('포캐스트')).map(s => {
                const on = statuses.has(s)
                return (
                  <button key={s} type="button" onClick={() => toggleStatus(s)}
                    style={{
                      padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
                      border: `1px solid ${on ? '#c7d7f8' : BORDER}`,
                      background: on ? '#f3f4f6' : '#fff',
                      color: on ? TEXT : MUTED, fontSize: 12, fontWeight: 700,
                      transition: 'background 0.15s ease',
                    }}>
                    {s}
                  </button>
                )
              })}
            </div>

            <span style={{ flex: 1 }} />

            <button type="button" onClick={opp.openNewOpp}
              style={{ padding: '7px 14px', background: BLUE, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', transition: 'background 0.15s ease' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#1c3e87')}
              onMouseLeave={e => (e.currentTarget.style.background = BLUE)}>
              + 영업기회
            </button>
            <button type="button" onClick={exportXlsx}
              style={{ padding: '7px 14px', background: '#fff', color: BLUE, border: `1px solid ${BORDER}`, borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', transition: 'background 0.15s ease' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#f3f4f6')}
              onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
              엑셀 내보내기
            </button>
          </div>
          {!scopeAll && (
            <div style={{ marginTop: 8, fontSize: 11, color: MUTED }}>
              본인 담당 안건만 보입니다.
            </div>
          )}
        </div>

        {loading ? (
          <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 8, padding: 40, textAlign: 'center', color: MUTED, fontSize: 13 }}>
            불러오는 중...
          </div>
        ) : (
          <>
            <ForecastMonthTable months={summary} picked={picked} onPick={setPicked} />

            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '0 2px' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>안건</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: GRAY, background: '#f3f4f6', borderRadius: 99, padding: '2px 8px' }}>
                {listRows.length}건
              </span>
              {picked && (
                <button type="button" onClick={() => setPicked(null)}
                  style={{ padding: 0, background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: BLUE }}>
                  {picked} 만 보는 중 · 전체 보기
                </button>
              )}
            </div>

            <ForecastRowList
              rows={listRows}
              engineerName={engineerName}
              customerName={customerName}
              categoryLabel={categoryLabel}
              formLabel={formLabel}
              oppById={oppById}
              canEditOpp={opp.canEditOpp}
              onSaveOpp={opp.updateOppFields}
              onOpenOpp={opp.openEditOpp}
              onOpenQuote={openQuote}
              onWriteQuote={writeQuote}
            />
          </>
        )}
      </div>

      <OpportunityModal
        isOpen={opp.isOppModalOpen}
        opportunity={opp.editingOpp}
        activities={activities}
        customers={customers}
        lockedCustomerName={null}
        engineers={engineers}
        isSaving={opp.isSavingOpp}
        canEdit={!opp.editingOpp || opp.canEditOpp(opp.editingOpp)}
        currentUserEngineerId={me.engineer_id}
        canPickEngineer={isSuperAdmin({ permission_level: me.role })}
        onClose={opp.closeOppModal}
        onSave={opp.handleSaveOpp}
        onDelete={opp.handleDeleteOpp}
        onOpenQuotePdf={quotePdf.openQuotePdfByUrl}
        onSetClosed={opp.setClosed}
      />
    </main>
  )
}
