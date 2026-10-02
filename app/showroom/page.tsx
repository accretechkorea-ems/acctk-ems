'use client'

// 쇼룸 — 장비 | 가동률 | 전체기록 (기본은 장비).
//   매일 쓰는 화면은 장비이고, 가동률·전체기록은 확인용이다.
//   사용 신청과 사용 기록 수정은 같은 모달(UsageModal)로 들어온다 — 새로 쓰면 신청, 기존 기록을 고치면 수정이다.
//   헤더 한 줄(ShowroomHeader)을 세 탭이 함께 쓴다 — 탭은 늘 우측 끝이고, 장비 탭이면 좌측에 첫 사무실 제목,
//   가동률 탭이면 사무실 선택이 나타난다. 가운데 기간(◀ ▶ + 기간 선택 모달)은 **장비·가동률 두 탭이 함께** 쓴다
//   — 상태가 아래 utilNav.period 한 곳이라 탭을 옮겨도 고른 기간이 남는다. 전체기록 탭은 자기 기간을
//   주소에 들고 있어(usageQuery) 이 기간과 섞이지 않는다.
//
// 탭과 전체기록 필터는 주소(쿼리스트링)가 원본이다(components/showroom/usageQuery.ts).
//   /showroom?tab=usage&devices=3,7&purpose=측정대행&q=기아&from=2026-09-01&to=2026-09-30&page=2
//   새로고침·뒤로 가기·링크 공유에도 같은 화면이 열린다. 탭을 바꾸거나 장비 카드·가동률 장비 행에서
//   전체기록으로 갈 때는 주소를 쌓고(push — 뒤로 가기로 돌아온다), 필터를 바꿀 때는 갈아 끼운다(replace).
//   예전 주소 /showroom/usage 는 app/showroom/usage/route.ts 가 전체기록 탭으로 보낸다.
//
// 쇼룸 장비는 따로 등록하지 않는다 — showroom_sites 에 지정된 사무실의 devices 가 곧 쇼룸 장비고,
// showroom_devices 는 그 장비의 설정만 담는다(행이 없으면 기본값).
//
// 읽기는 화면에서 직접 한다(새 테이블에 읽기 정책이 있다). 가동률 숫자만은 서버(/api/showroom/stats)가
// 계산해 준다. 쓰기는 전부 /api/showroom/* 라우트가 service role 로 한다(쓰기 정책이 없다).
// 조회는 effect 에서 외부 응답을 받은 콜백으로만 반영한다 — '불러오는 중'은 요청 키로 파생시킨다.

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { usePageGuard } from '@/hooks/usePageGuard'
import AccessGate from '@/components/common/AccessGate'
import { isSuperAdmin } from '@/lib/permissions'
import { nowKSTParts } from '@/lib/date'
import { USAGE_PURPOSES, periodRange, round1, type Period, type ShowroomDevice, type ShowroomSite, type ShowroomStats } from '@/lib/showroom'
import { PAGE_BG, DANGER, BLUE, MUTED, PULSE_KEYFRAMES } from '@/components/common/ui'
import DeviceGrid, { groupDevices, type DevicePeriodBreakdown } from '@/components/showroom/DeviceGrid'
import ShowroomHeader from '@/components/showroom/ShowroomHeader'
import UsageModal, { type UsageSubmission } from '@/components/showroom/UsageModal'
import DeviceSettingsModal, { type DevicePatch } from '@/components/showroom/DeviceSettingsModal'
import UtilizationTab, { type UtilNav } from '@/components/showroom/UtilizationTab'
import UsageTab from '@/components/showroom/UsageTab'
import type { PickerEngineer } from '@/components/showroom/EngineerPicker'
import {
  loadShowroomDevices, loadEngineers, callShowroomApi, saveSubmission, requestNotice,
} from '@/components/showroom/showroomData'
import {
  SHOWROOM_PATH, parseTab, parseUsageQuery, usageHref, type ShowroomTab, type UsageQuery,
} from '@/components/showroom/usageQuery'

// 탭 정의. 탭을 늘릴 때는 이 배열과 usageQuery.ts 의 ShowroomTab 에 함께 넣는다.
const TABS: { label: string; value: ShowroomTab }[] = [
  { label: '장비', value: 'devices' },
  { label: '가동률', value: 'util' },
  { label: '전체기록', value: 'usage' },
]

type Browser = ReturnType<typeof createClient>

/**
 * 장비 카드의 기간 요약 — 합계·건수에 사용목적별 건수·시간(도넛·범례)을 더한다.
 * 헤더에서 고른 기간(from~to, 양 끝 포함)을 그대로 받는다 — 예전에는 이번 달 고정이었다.
 * 카드용 조회는 여전히 이 한 번이다. 목적은 USAGE_PURPOSES 5종을 모두 담는다(0건 포함).
 */
async function loadPeriodBreakdown(sb: Browser, from: string, to: string): Promise<Record<number, DevicePeriodBreakdown>> {
  const { data, error } = await sb
    .from('showroom_usage').select('device_id, work_hours, purpose')
    .is('deleted_at', null)
    .gte('usage_date', from).lte('usage_date', to)
  if (error) throw new Error(`summary: ${error.message}`)
  const map: Record<number, DevicePeriodBreakdown> = {}
  for (const r of (data ?? []) as { device_id: number; work_hours: number; purpose: string }[]) {
    const s = (map[r.device_id] ??= {
      hours: 0, count: 0, byPurpose: USAGE_PURPOSES.map(p => ({ purpose: p, count: 0, hours: 0 })),
    })
    const h = Number(r.work_hours) || 0
    s.hours += h
    s.count += 1
    const slot = s.byPurpose.find(p => p.purpose === r.purpose)
    if (slot) { slot.count += 1; slot.hours += h }
  }
  // 소수 합계라 부동소수 오차가 보일 수 있어 소수 첫째 자리에서 끊는다.
  for (const s of Object.values(map)) {
    s.hours = round1(s.hours)
    for (const p of s.byPurpose) p.hours = round1(p.hours)
  }
  return map
}

function ShowroomPageInner() {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const params = useSearchParams()
  const { engineer: me, loading: guardLoading, authorized } = usePageGuard()
  const admin = isSuperAdmin(me)
  const myId = me?.engineer_id ?? null

  // ── 주소가 원본 — 탭과 전체기록 필터 ──
  const tab = parseTab(params.get('tab'))
  const usageQuery = tab === 'usage' ? parseUsageQuery(params) : null

  /** 탭 바꾸기 — 다른 파라미터(전체기록 필터)는 그대로 둬서, 돌아오면 보던 조건이 남아 있다. */
  const switchTab = (next: ShowroomTab) => {
    if (next === tab) return
    const q = new URLSearchParams(params.toString())
    if (next === 'devices') q.delete('tab')
    else q.set('tab', next)
    const s = q.toString()
    router.push(s ? `${SHOWROOM_PATH}?${s}` : SHOWROOM_PATH, { scroll: false })
  }
  /** 장비 카드 하단 박스·가동률 장비 행 → 전체기록 탭에서 그 장비만. 기간을 주지 않으면 이번 달. */
  const openUsage = (deviceId: number, range?: { from: string; to: string }) => {
    const q = new URLSearchParams({ tab: 'usage', devices: String(deviceId) })
    if (range) { q.set('from', range.from); q.set('to', range.to) }
    router.push(`${SHOWROOM_PATH}?${q.toString()}`, { scroll: false })
  }
  const setUsageQuery = useCallback((next: UsageQuery) => {
    router.replace(usageHref(next), { scroll: false })
  }, [router])

  const now = nowKSTParts()
  /**
   * 헤더의 기간·사무실.
   *   period — **장비 탭과 가동률 탭이 함께 쓴다.** 기본은 이번 달(KST). 주소가 아니라 부모 상태에 두었다
   *            — 사무실 구분(site)과 같은 자리·같은 방식이고, 탭을 오가도 고른 기간이 남는다.
   *            전체기록 탭은 자기 기간을 주소에 들고 있어(usageQuery) 여기에 끼지 않는다.
   *   site   — 가동률 탭 전용. 고르기 전까지 첫 사무실.
   */
  const [utilNav, setUtilNav] = useState<UtilNav>({ period: { mode: 'month', year: now.y, month: now.m }, site: null })
  const period: Period = utilNav.period
  // 장비 탭의 두 조회(카드 요약·카드 가동률)가 같은 기간을 본다. 가동률 탭과 같은 periodRange 를 쓴다.
  const { from: periodFrom, to: periodTo } = periodRange(period)

  // ── 장비·사무실 ── 쓰기 뒤에는 devicesKey 를 올려 다시 읽는다.
  const [devicesKey, setDevicesKey] = useState(0)
  const [devicesLoadedKey, setDevicesLoadedKey] = useState<number | null>(null)
  const [sites, setSites] = useState<ShowroomSite[]>([])
  const [devices, setDevices] = useState<ShowroomDevice[]>([])
  // ── 엔지니어(기록 추가 모달·전체기록 표) ──
  const [engineers, setEngineers] = useState<PickerEngineer[]>([])
  const [engineersLoaded, setEngineersLoaded] = useState(false)
  // ── 장비 카드의 기간 요약 ──
  // 다시 읽을 방아쇠(쓰기 뒤에 올린다)와 「어느 요청의 결과를 들고 있는가」를 나눠 둔다 —
  // 기간이 바뀌어도 같은 길로 다시 읽히게 하려고 키에 기간을 섞는다(가동률 탭 UtilizationTab 과 같은 방식).
  const [summaryRefresh, setSummaryRefresh] = useState(0)
  const [summaryLoadedKey, setSummaryLoadedKey] = useState<string | null>(null)
  const [periodSummary, setPeriodSummary] = useState<Record<number, DevicePeriodBreakdown>>({})
  // 가동률은 사용 기록·장비 설정·공휴일이 바뀌면 달라진다. 그때마다 이 값을 올려 다시 계산하게 한다.
  const [statsRefresh, setStatsRefresh] = useState(0)
  // 장비 카드의 기간 가동률(device_id → 가동률). 장비 탭에 들어올 때·기간이 바뀔 때 stats 를 부른다.
  const [deviceUtil, setDeviceUtil] = useState<Record<number, number | null> | undefined>(undefined)
  const [deviceUtilKey, setDeviceUtilKey] = useState<string | null>(null)

  const [pageError, setPageError] = useState<string | null>(null)
  // 장비·가동률 탭에서 사용 신청을 보낸 뒤 안내(이 탭에는 「내 사용 신청」 카드가 없다).
  const [notice, setNotice] = useState<string | null>(null)
  const [addModal, setAddModal] = useState<{ open: boolean; preset: number | null }>({ open: false, preset: null })
  const [settingsDevice, setSettingsDevice] = useState<ShowroomDevice | null>(null)

  const devicesLoading = devicesLoadedKey !== devicesKey
  // 요청 키 — 기간과 방아쇠를 함께 담는다. 「불러오는 중」은 들고 있는 키와 비교해 파생시킨다.
  const summaryKey = `${periodFrom}~${periodTo}-${summaryRefresh}`
  const summaryLoading = summaryLoadedKey !== summaryKey
  const utilKey = `${periodFrom}~${periodTo}-${statsRefresh}`
  const utilLoading = tab === 'devices' && deviceUtilKey !== utilKey
  /**
   * 스켈레톤은 **처음 한 번만** 보인다. 기간을 옮기는 동안에는 직전 카드를 흐리게 그대로 둔다 —
   * 가동률 탭과 같은 규칙이다(스켈레톤으로 바꾸면 ◀ ▶ 를 누를 때마다 화면이 튄다).
   */
  const firstLoad = devicesLoading || summaryLoadedKey === null
  const refreshing = summaryLoading || utilLoading

  // 장비 카드 묶음 — 첫 사무실 제목은 헤더가, 나머지는 그리드가 그린다.
  const deviceGroups = useMemo(() => groupDevices(devices, admin), [devices, admin])
  const firstGroup = deviceGroups[0] ?? null
  // 가동률 사무실 — 고르지 않았으면 첫 사무실. 상태로 따로 두지 않고 파생시킨다(사무실 목록이 늦게 와도 맞게).
  const utilSite: number | 'all' | null = utilNav.site ?? sites[0]?.customer_id ?? null

  // ── 조회 ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!authorized || devicesLoadedKey === devicesKey) return
    let cancelled = false
    loadShowroomDevices(supabase)
      .then(r => { if (cancelled) return; setSites(r.sites); setDevices(r.devices); setPageError(null); setDevicesLoadedKey(devicesKey) })
      .catch(e => { if (cancelled) return; console.error('[showroom] device load failed', e); setPageError('장비 목록을 불러오지 못했습니다.'); setDevicesLoadedKey(devicesKey) })
    return () => { cancelled = true }
  }, [authorized, supabase, devicesKey, devicesLoadedKey])

  useEffect(() => {
    if (!authorized || engineersLoaded) return
    let cancelled = false
    loadEngineers(supabase)
      .then(list => { if (cancelled) return; setEngineers(list); setEngineersLoaded(true) })
      .catch(e => { if (cancelled) return; console.error('[showroom] engineer load failed', e); setEngineersLoaded(true) })
    return () => { cancelled = true }
  }, [authorized, supabase, engineersLoaded])

  useEffect(() => {
    if (!authorized || summaryLoadedKey === summaryKey) return
    let cancelled = false
    // 헤더에서 고른 기간. 실패해도 직전 값을 지우지 않는다 — 빈 카드로 깜빡이지 않게.
    loadPeriodBreakdown(supabase, periodFrom, periodTo)
      .then(map => { if (cancelled) return; setPeriodSummary(map); setSummaryLoadedKey(summaryKey) })
      .catch(e => { if (cancelled) return; console.error('[showroom] period summary load failed', e); setSummaryLoadedKey(summaryKey) })
    return () => { cancelled = true }
  }, [authorized, supabase, summaryKey, summaryLoadedKey, periodFrom, periodTo])

  // 장비 탭의 카드 가동률 — 탭에 들어왔을 때, 기간을 옮겼을 때, 데이터가 바뀌었을 때 부른다.
  // 모든 사무실의 장비가 카드로 나오므로 site=all. 기간은 헤더에서 고른 것이다(서버가 오늘까지만 센다).
  useEffect(() => {
    if (!authorized || tab !== 'devices' || deviceUtilKey === utilKey) return
    let cancelled = false
    fetch(`/api/showroom/stats?from=${periodFrom}&to=${periodTo}&site=all`)
      .then(async res => {
        const body = await res.json().catch(() => null)
        if (cancelled) return
        if (!res.ok || !body) {
          console.error('[showroom] device utilization load failed', body)
          setDeviceUtil({})   // 모르면 그리지 않는다(0% 로 두지 않는다)
        } else {
          setDeviceUtil(Object.fromEntries((body as ShowroomStats).devices.map(d => [d.device_id, d.utilization])))
        }
        setDeviceUtilKey(utilKey)
      })
      .catch(e => {
        if (cancelled) return
        console.error('[showroom] device utilization load failed', e)
        setDeviceUtil({})
        setDeviceUtilKey(utilKey)
      })
    return () => { cancelled = true }
  }, [authorized, tab, utilKey, deviceUtilKey, periodFrom, periodTo])

  const bumpStats = useCallback(() => setStatsRefresh(n => n + 1), [])
  /** 전체기록 탭에서 기록을 쓰거나 지웠을 때 — 장비 카드 요약·가동률도 맞춘다. */
  const onUsageChanged = useCallback(() => {
    setDevicesKey(k => k + 1)
    setSummaryRefresh(n => n + 1)
    bumpStats()
  }, [bumpStats])

  // ── 쓰기 ──────────────────────────────────────────────────────────
  /** 장비 카드·가동률에서 여는 사용 신청 — 목적과 무관하게 승인을 거친다(saveSubmission 이 보낸다). */
  const submitUsage = async (sub: UsageSubmission): Promise<string | null> => {
    const r = await saveSubmission(sub)
    if (!r.ok) return r.error
    setAddModal({ open: false, preset: null })
    // 설정 행이 없던 장비는 저장하면서 기본값으로 만들어진다 — 장비 목록도 맞춰 다시 읽는다.
    onUsageChanged()
    setNotice(r.request ? requestNotice(r.request) : null)
    return null
  }

  const patchDevice = async (patch: DevicePatch): Promise<string | null> => {
    const message = await callShowroomApi('/api/showroom/devices', 'PATCH', patch)
    if (message) return message
    setSettingsDevice(null)
    setDevicesKey(k => k + 1)
    bumpStats()   // 일 가용시간·사용여부가 바뀌면 가동률도 바뀐다
    return null
  }

  if (!authorized) return <AccessGate loading={guardLoading} />

  // 기록을 남길 수 있는 장비 — 사용여부가 꺼진 장비는 고를 수 없다.
  const usableDevices = devices.filter(d => d.is_active)

  return (
    <main style={{ padding: '24px 28px', background: PAGE_BG, minHeight: '100vh' }}>
      <style>{PULSE_KEYFRAMES}</style>

      {/* 폭 상한을 두지 않는다 — 장비 카드가 300px 고정이라, 남는 폭만큼 열이 늘어난다.
          (상한 1280 이면 사이드바를 뺀 1440 창에서 4열이 아니라 3열로 떨어졌다) */}
      <div style={{ width: '100%' }}>
        <ShowroomHeader
          tabs={TABS}
          active={tab}
          onTabChange={switchTab}
          siteTitle={firstGroup ? { name: firstGroup.site, count: firstGroup.devices.length } : null}
          siteTitleLoading={devicesLoading}
          sites={sites}
          site={utilSite}
          period={period}
          onSiteChange={s => setUtilNav(n => ({ ...n, site: s }))}
          onPeriodChange={p => setUtilNav(n => ({ ...n, period: p }))}
        />

        {pageError && (
          <div style={{ marginBottom: 12, fontSize: 13, fontWeight: 600, color: DANGER }}>{pageError}</div>
        )}
        {notice && tab !== 'usage' && (
          <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: BLUE }}>
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label="안내 닫기"
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: MUTED, fontSize: 13, fontWeight: 700, fontFamily: 'inherit' }}>
              닫기
            </button>
          </div>
        )}

        {tab === 'devices' && (
          // 기간을 옮기는 동안에는 직전 카드를 흐리게 그대로 둔다(가동률 탭과 같은 규칙).
          <div style={{ opacity: !firstLoad && refreshing ? 0.55 : 1, transition: 'opacity 0.15s ease' }} aria-busy={refreshing}>
          <DeviceGrid
            groups={deviceGroups}
            period={period}
            summary={periodSummary}
            utilization={deviceUtil}
            loading={firstLoad}
            isAdmin={admin}
            onAddUsage={d => setAddModal({ open: true, preset: d.device_id })}
            onConfigure={d => setSettingsDevice(d)}
            onOpenUsages={d => openUsage(d.device_id, { from: periodFrom, to: periodTo })}
          />
          </div>
        )}
        {tab === 'util' && (
          <UtilizationTab
            period={period}
            site={utilSite}
            sitesLoading={devicesLoading}
            isAdmin={admin}
            refreshKey={statsRefresh}
            onOpenDevice={(d, from, to) => openUsage(d.device_id, { from, to })}
            onPickMonth={(y, m) => setUtilNav(n => ({ ...n, period: { mode: 'month', year: y, month: m } }))}
            onAddUsage={() => setAddModal({ open: true, preset: null })}
            onHolidaysChanged={bumpStats}
          />
        )}
        {tab === 'usage' && usageQuery && (
          <UsageTab
            supabase={supabase}
            query={usageQuery}
            onQueryChange={setUsageQuery}
            devices={devices}
            sites={sites}
            engineers={engineers}
            isAdmin={admin}
            myId={myId}
            devicesLoading={devicesLoading}
            onChanged={onUsageChanged}
          />
        )}
      </div>

      {addModal.open && (
        <UsageModal
          initial={null}
          presetDeviceId={addModal.preset}
          devices={usableDevices}
          engineers={engineers}
          currentUserEngineerId={myId}
          onClose={() => setAddModal({ open: false, preset: null })}
          onSubmit={submitUsage}
        />
      )}

      {settingsDevice && admin && (
        <DeviceSettingsModal
          device={settingsDevice}
          onClose={() => setSettingsDevice(null)}
          onSubmit={patchDevice}
        />
      )}
    </main>
  )
}

// useSearchParams 는 Suspense 경계가 필요하다(견적 화면과 같은 방식).
export default function ShowroomPage() {
  return (
    <Suspense fallback={null}>
      <ShowroomPageInner />
    </Suspense>
  )
}
