'use client'

// 전체기록 탭 — 사용 기록 목록·필터·수정·삭제·복사·추가. 예전 /showroom/usage 화면을 탭으로 옮긴 것이다.
//
// 필터는 주소가 원본이다(usageQuery.ts). 받은 query 로 그리고, 바꿀 때는 onQueryChange 로 새 query 를 올린다.
//   [기간] [장비 선택] [목적] [검색창] ........ [엑셀] [기록 추가]
// 필터를 바꾸면 1쪽으로 돌아간다. [엑셀]은 걸러진 전체(쪽 나눔 무시)를 내보낸다(ShowroomExcelButton).
//
// 조회는 기간 단위로 한 번(loadPeriodUsages) 하고, 장비·목적·검색·쪽 나눔은 받은 행에서 화면이 거른다.
//   · 검색 대상에 대상 고객사명(customers 조인)이 들어가는데, PostgREST 는 본 테이블 칸과 조인한 칸을 한 or() 로
//     묶어 거를 수 없다. 서버에서 하려면 요청을 둘로 나눠 합치거나 DB 함수가 있어야 한다(DB 는 건드리지 않는다).
//   · 기간이 최대 1년이고 쇼룸 기록은 한 달 수십 건이라 한 번에 받아도 가볍다. 거르기·쪽 넘기기가 다시 요청하지 않아 즉시 바뀐다.
//   · 건수 배지·합계 시간은 걸러진 전체 기준이고, 표에는 그중 한 쪽(30건)만 그린다.
// 검색은 입력 뒤 300ms 가 지나면 주소에 반영한다(엔터는 즉시). 비우면 검색이 풀린다.
// 조회는 effect 에서 외부 응답을 받은 콜백으로만 반영한다 — '불러오는 중'은 요청 키로 파생시킨다.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { createClient } from '@/lib/supabase/client'
import {
  USAGE_PURPOSES, deviceTitle, periodFromRange, periodRange, round1,
  type DemoRequestRow, type ShowroomDevice, type ShowroomSite, type ShowroomUsageRow,
} from '@/lib/showroom'
import {
  BLUE, BORDER, CARD_BG, MUTED, SUB, DANGER, NEUTRAL_BG,
  cardStyle, cardHeader, cardTitle, countBadge, btnPrimary, inputStyle,
} from '@/components/common/ui'
import UsageList from './UsageList'
import UsageModal, { type UsageInitial, type UsageSubmission } from './UsageModal'
import MyRequests from './MyRequests'
import PeriodNav from './PeriodNav'
import DeviceMultiSelect from './DeviceMultiSelect'
import ShowroomExcelButton from './ShowroomExcelButton'
import type { UsageSheetContext } from '@/lib/showroomExcel'
import type { PickerEngineer } from './EngineerPicker'
import { loadPeriodUsages, callShowroomApi, saveSubmission, editInitial, copyInitial } from './showroomData'
import { SEARCH_MAX, type UsageQuery } from './usageQuery'

const PAGE_SIZE = 30
const SEARCH_DEBOUNCE_MS = 300
/** 쪽을 넘기면 표 머리가 전역 헤더(44) 아래 조금 띄운 자리에 오도록 스크롤한다. */
const SCROLL_OFFSET = 56

type Browser = ReturnType<typeof createClient>

type Props = {
  supabase: Browser
  query: UsageQuery
  onQueryChange: (next: UsageQuery) => void
  /** 쇼룸 장비 전체(사용여부 N 포함) — 필터 선택지·장비명에 쓴다 */
  devices: ShowroomDevice[]
  sites: ShowroomSite[]
  engineers: PickerEngineer[]
  isAdmin: boolean
  myId: number | null
  devicesLoading: boolean
  /** 기록을 쓰거나 지웠을 때 — 장비 카드 요약·가동률도 다시 계산하게 한다 */
  onChanged: () => void
}

/** 검색 대상 — 대상 고객사명 · 프로젝트명 · 상세 내용 · 사용결과 · 비고. */
const haystack = (r: ShowroomUsageRow): string =>
  [r.customers?.company_name, r.project_name, r.content, r.result, r.note].filter(Boolean).join('\n').toLowerCase()

/** 날짜 내림차순, 같은 날은 시작시간 내림차순(같으면 나중에 쓴 기록이 위). */
const byNewest = (a: ShowroomUsageRow, b: ShowroomUsageRow): number =>
  b.usage_date.localeCompare(a.usage_date) || b.start_time.localeCompare(a.start_time) || b.usage_id - a.usage_id

/** 쪽 번호 — 처음·끝·지금 앞뒤 2쪽을 보이고 사이는 … 로 줄인다. */
function pageItems(page: number, total: number): (number | '…')[] {
  const keep = new Set([1, total, page - 2, page - 1, page, page + 1, page + 2].filter(p => p >= 1 && p <= total))
  const sorted = [...keep].sort((a, b) => a - b)
  const out: (number | '…')[] = []
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push('…')
    out.push(p)
  })
  return out
}

const pageBtn = (active: boolean, disabled = false): CSSProperties => ({
  minWidth: 30, height: 30, padding: '0 8px', borderRadius: 6, fontFamily: 'inherit',
  border: active ? `1px solid ${BLUE}` : `1px solid ${BORDER}`,
  background: active ? BLUE : CARD_BG, color: active ? CARD_BG : disabled ? MUTED : SUB,
  fontSize: 12, fontWeight: 700, cursor: active || disabled ? 'default' : 'pointer',
})

function Pagination({ page, total, onChange }: { page: number; total: number; onChange: (page: number) => void }) {
  return (
    <nav aria-label="쪽 이동" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 4, marginTop: 14 }}>
      <button onClick={() => onChange(page - 1)} disabled={page <= 1} aria-label="이전 쪽" style={pageBtn(false, page <= 1)}>◀</button>
      {pageItems(page, total).map((p, i) => p === '…' ? (
        <span key={`gap-${i}`} style={{ fontSize: 12, color: MUTED, padding: '0 4px' }}>…</span>
      ) : (
        <button key={p} onClick={() => { if (p !== page) onChange(p) }} aria-current={p === page ? 'page' : undefined}
          className="num" style={pageBtn(p === page)}>
          {p}
        </button>
      ))}
      <button onClick={() => onChange(page + 1)} disabled={page >= total} aria-label="다음 쪽" style={pageBtn(false, page >= total)}>▶</button>
    </nav>
  )
}

export default function UsageTab({
  supabase, query, onQueryChange, devices, sites, engineers, isAdmin, myId, devicesLoading, onChanged,
}: Props) {
  // ── 조회 (기간 단위) ──
  const [reload, setReload] = useState(0)
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [rows, setRows] = useState<ShowroomUsageRow[]>([])
  const [usageEngineers, setUsageEngineers] = useState<Record<number, number[]>>({})
  const [error, setError] = useState<string | null>(null)
  // 사용 기록·신청 모달 하나 — 추가(initial null)·수정·복사(initial)·반려 건 재작성(rewrite).
  const [modal, setModal] = useState<{
    open: boolean; initial: UsageInitial | null; preset: number | null; rewrite?: DemoRequestRow | null
  }>({ open: false, initial: null, preset: null })
  const cardRef = useRef<HTMLDivElement | null>(null)
  // 신청·재작성 뒤 「내 데모 신청」을 다시 읽는다.
  const [myRequestsKey, setMyRequestsKey] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)

  const key = `${query.from}~${query.to}-${reload}`
  const loading = loadedKey !== key

  useEffect(() => {
    if (loadedKey === key) return
    let cancelled = false
    loadPeriodUsages(supabase, query.from, query.to)
      .then(r => { if (cancelled) return; setRows(r.rows); setUsageEngineers(r.usageEngineers); setError(null); setLoadedKey(key) })
      .catch(e => {
        if (cancelled) return
        console.error('[showroom] usage load failed', e)
        setRows([])
        setUsageEngineers({})
        setError('사용 기록을 불러오지 못했습니다.')
        setLoadedKey(key)
      })
    return () => { cancelled = true }
  }, [supabase, key, loadedKey, query.from, query.to])

  // ── 필터 바꾸기 — 1쪽으로 돌아간다 ──
  // 검색 디바운스가 늦게 불려도 그사이 바뀐 다른 필터를 덮지 않도록 최신 query 를 ref 로 본다.
  const queryRef = useRef(query)
  useEffect(() => { queryRef.current = query })
  const setFilter = useCallback((patch: Partial<UsageQuery>) => {
    onQueryChange({ ...queryRef.current, ...patch, page: 1 })
  }, [onQueryChange])

  // ── 검색 — 입력 중인 글자는 따로 들고, 주소의 q 가 바깥에서 바뀌면(탭 이동·뒤로 가기) 그 값을 따른다 ──
  const [draft, setDraft] = useState({ base: query.q, text: query.q })
  const searchText = draft.base === query.q ? draft.text : query.q
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current) }, [])
  const commitSearch = (text: string) => {
    if (searchTimer.current) { clearTimeout(searchTimer.current); searchTimer.current = null }
    if (text !== queryRef.current.q) setFilter({ q: text })
  }
  const typeSearch = (text: string) => {
    const v = text.slice(0, SEARCH_MAX)
    setDraft({ base: query.q, text: v })
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => commitSearch(v), SEARCH_DEBOUNCE_MS)
  }

  // ── 파생 ──
  const deviceById = useMemo(() => new Map(devices.map(d => [d.device_id, d])), [devices])
  const deviceName = useCallback((id: number) => {
    const d = deviceById.get(id)
    return d ? deviceTitle(d) : `장비 #${id}`
  }, [deviceById])
  const engineerName = useCallback(
    (id: number | null) => (id == null ? '' : engineers.find(e => e.engineer_id === id)?.name ?? ''),
    [engineers],
  )
  // 엑셀 사용기록 시트 — 기록 id 를 이름으로 바꾸는 함수들. 사무실은 짧은 이름, 목록에 없는 장비(삭제 등)는 빈 칸.
  const siteShort = useMemo(() => new Map(sites.map(s => [s.customer_id, s.short])), [sites])
  const excelCtx = useMemo<UsageSheetContext>(() => ({
    deviceName,
    siteName: id => {
      const d = deviceById.get(id)
      return d ? siteShort.get(d.customer_id) ?? d.site_name : ''
    },
    engineerName,
    usageEngineers,
  }), [deviceName, deviceById, siteShort, engineerName, usageEngineers])
  const canEdit = useCallback(
    (row: ShowroomUsageRow) => isAdmin || (myId != null && row.created_by === myId),
    [isAdmin, myId],
  )

  const deviceSet = new Set(query.devices)
  const needle = query.q.trim().toLowerCase()
  const filtered = rows
    .filter(r => (deviceSet.size === 0 || deviceSet.has(r.device_id))
      && (query.purpose == null || r.purpose === query.purpose)
      && (!needle || haystack(r).includes(needle)))
    .sort(byNewest)
  const totalHours = round1(filtered.reduce((sum, r) => sum + (Number(r.work_hours) || 0), 0))
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const page = Math.min(query.page, totalPages)   // 주소의 쪽이 넘치면 마지막 쪽
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const filtering = deviceSet.size > 0 || query.purpose != null || needle !== ''

  const goPage = (p: number) => {
    onQueryChange({ ...query, page: p })
    const el = cardRef.current
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - SCROLL_OFFSET })
  }

  // ── 쓰기 ──
  /**
   * 모달 저장 — 사용 기록은 /api/showroom/usage, 고객 데모 신청은 /api/showroom/requests(saveSubmission 이 가른다).
   * 사후 신청은 사용 기록이 바로 생기므로 목록도 다시 읽는다. 신청이었으면 「내 신청」도 다시 읽는다.
   */
  const submitUsage = async (sub: UsageSubmission): Promise<string | null> => {
    const r = await saveSubmission(sub)
    if (!r.ok) return r.error
    setModal({ open: false, initial: null, preset: null })
    setReload(n => n + 1)
    onChanged()
    if (r.request) {
      setMyRequestsKey(n => n + 1)
      setNotice(r.request.pdfOk ? null
        : `신청은 저장했지만 승인서 PDF 를 만들지 못했습니다(${r.request.requestNo}). 관리자에게 알려주세요.`)
    }
    return null
  }

  const deleteUsage = async (row: ShowroomUsageRow): Promise<string | null> => {
    const message = await callShowroomApi('/api/showroom/usage', 'DELETE', { usage_id: row.usage_id })
    if (message) return message
    setReload(n => n + 1)
    onChanged()
    return null
  }

  // 기록을 남길 수 있는 장비 — 사용여부가 꺼진 장비는 고를 수 없다.
  const usableDevices = devices.filter(d => d.is_active)

  return (
    <>
      {error && <div style={{ marginBottom: 12, fontSize: 13, fontWeight: 600, color: DANGER }}>{error}</div>}
      {notice && <div style={{ marginBottom: 12, fontSize: 13, fontWeight: 600, color: DANGER }}>{notice}</div>}

      {/* 내 데모 신청 — 대기중·반려가 있을 때만 보인다 */}
      <MyRequests
        supabase={supabase}
        myId={myId}
        reloadKey={myRequestsKey}
        onRewrite={row => setModal({ open: true, initial: null, preset: null, rewrite: row })}
      />

      {/* 필터 줄 — [기간] [장비] [목적] [검색] ...... [엑셀] [기록 추가] */}
      <div style={{ ...cardStyle, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <PeriodNav
            period={periodFromRange(query.from, query.to)}
            onChange={p => setFilter(periodRange(p))}
          />
          <DeviceMultiSelect devices={devices} sites={sites} selected={query.devices} onChange={ids => setFilter({ devices: ids })} />
          <select value={query.purpose ?? ''} aria-label="사용목적"
            onChange={e => setFilter({ purpose: e.target.value || null })}
            style={{ ...inputStyle, cursor: 'pointer' }}>
            <option value="">전체 목적</option>
            {USAGE_PURPOSES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <div style={{ position: 'relative', flex: '0 1 260px', minWidth: 180 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input value={searchText} aria-label="검색" placeholder="고객사, 프로젝트명, 내용 검색"
              onChange={e => typeSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) commitSearch(searchText) }}
              style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', paddingLeft: 30, paddingRight: searchText ? 32 : 11 }} />
            {searchText && (
              <button type="button" aria-label="검색어 지우기" title="검색어 지우기"
                onClick={() => { setDraft({ base: query.q, text: '' }); commitSearch('') }}
                style={{
                  position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)',
                  width: 20, height: 20, borderRadius: '50%', border: 'none', background: NEUTRAL_BG, color: SUB,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>

          <div style={{ flex: 1 }} />

          <ShowroomExcelButton from={query.from} to={query.to} rows={filtered} ctx={excelCtx} disabled={loading || devicesLoading} />
          <button onClick={() => setModal({ open: true, initial: null, preset: query.devices.length === 1 ? query.devices[0] : null })}
            style={btnPrimary()}>
            기록 추가
          </button>
        </div>
      </div>

      {/* 목록 */}
      <div ref={cardRef} style={cardStyle}>
        <div style={cardHeader}>
          <span style={cardTitle}>사용 기록</span>
          <span style={countBadge}>{filtered.length}건</span>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: BLUE }}>합계 {totalHours}h</span>
        </div>

        <UsageList
          rows={pageRows}
          deviceName={deviceName}
          usageEngineers={usageEngineers}
          engineerName={engineerName}
          loading={loading || devicesLoading}
          emptyText={filtering ? '조건에 맞는 사용 기록이 없습니다' : '이 기간의 사용 기록이 없습니다'}
          canEdit={canEdit}
          onEdit={row => setModal({ open: true, initial: editInitial(row, usageEngineers[row.usage_id] ?? []), preset: null })}
          onCopy={row => setModal({ open: true, initial: copyInitial(row, usageEngineers[row.usage_id] ?? []), preset: null })}
          onDelete={deleteUsage}
        />

        {totalPages > 1 && <Pagination page={page} total={totalPages} onChange={goPage} />}
      </div>

      <div style={{ marginTop: 12, fontSize: 12, color: MUTED }}>
        * 사용 기록은 작성자 본인과 관리자만 고치거나 지울 수 있습니다. 복사해서 새로 쓰는 것은 누구나 할 수 있습니다.
      </div>

      {modal.open && (
        <UsageModal
          initial={modal.initial}
          rewrite={modal.rewrite ?? null}
          presetDeviceId={modal.preset}
          devices={usableDevices}
          engineers={engineers}
          currentUserEngineerId={myId}
          onClose={() => setModal({ open: false, initial: null, preset: null })}
          onSubmit={submitUsage}
        />
      )}
    </>
  )
}
