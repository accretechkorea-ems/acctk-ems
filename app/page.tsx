//app/page.tsx

'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Sidebar from '@/components/home/Sidebar'
import MapView from '@/components/home/MapView'
import AddCustomerModal from '@/components/home/AddCustomerModal'
import { useHomeData } from '@/hooks/useHomeData'
import { addCustomer } from '@/lib/addCustomer'
import { CATEGORY_OPTIONS } from '@/lib/constants'
import { useToast } from '@/components/common/Toast'
import { usePageGuard } from '@/hooks/usePageGuard'
import AccessGate from '@/components/common/AccessGate'
import { canAccess80 } from '@/lib/permissions'


import {
  HOME_STATE_KEY,
  PAGE_BG,
  PANEL_BG,
  TEXT_MUTED,
  TEXT_PRIMARY,
  getDeviceLine,
  createEmptyDeviceForm,
  type Contact,
  type Customer,
  type Device,
  type NewDeviceForm,
  type ServiceHistory,
  toTimeValue,
} from '@/lib/home'






export default function HomePage() {
  const supabase = createClient()
  const { loading: guardLoading, authorized } = usePageGuard(canAccess80)
  const toast = useToast()

  const listScrollRef = useRef<HTMLDivElement | null>(null)
  const restoredHomeStateRef = useRef(false)
  const pendingListScrollTopRef = useRef<number | null>(null)

  const [customers, setCustomers] = useState<Customer[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [deviceMap, setDeviceMap] = useState<Map<number, Device[]>>(new Map())
  const [focusedCustomerId, setFocusedCustomerId] = useState<number | null>(null)
  const [latestServiceDateMap, setLatestServiceDateMap] = useState<Map<number, number>>(new Map())
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(null)
  const [mapLevel, setMapLevel] = useState<number | null>(null)
  const [openOverlayCustomerId, setOpenOverlayCustomerId] = useState<number | null>(null)
  const [mobileTab, setMobileTab] = useState<'list' | 'map'>('list')

useEffect(() => {
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      setMobileTab('list')
    }
  }
  document.addEventListener('visibilitychange', handleVisibilityChange)
  return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
}, [])
  const [query, setQuery] = useState('')
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(['활성', '잠재'])
const [selectedCategories, setSelectedCategories] = useState<string[]>([...CATEGORY_OPTIONS])

const toggleCategory = (category: string) => {
  setSelectedCategories((prev) =>
    prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category]
  )
}
  const [isAddCustomerModalOpen, setIsAddCustomerModalOpen] = useState(false)
  const [isSavingCustomer, setIsSavingCustomer] = useState(false)

  const [customerForm, setCustomerForm] = useState({
    company_name: '',
    address: '',
    agency: '',
    status: '활성',
  })

  const { fetchData } = useHomeData({
  setCustomers,
  setDeviceMap,
  setLatestServiceDateMap,
})

  useEffect(() => {
    if (customers.length > 0) setIsLoading(false)
  }, [customers])

  useEffect(() => {
    const t = setTimeout(() => setIsLoading(false), 6000)
    return () => clearTimeout(t)
  }, [])

  const [contactForm, setContactForm] = useState<Contact>({
    name: '',
    department: '',
    position: '',
    phone: '',
  })

  const [deviceForms, setDeviceForms] = useState<NewDeviceForm[]>([createEmptyDeviceForm()])

  const saveHomeState = () => {
    if (typeof window === 'undefined') return

   const payload = {
  query,
  selectedStatuses,
  selectedCategories,
  listScrollTop: listScrollRef.current?.scrollTop ?? 0,
  mapCenter,
  mapLevel,
  openOverlayCustomerId,
}

    sessionStorage.setItem(HOME_STATE_KEY, JSON.stringify(payload))
  }

  useEffect(() => {
    if (typeof window === 'undefined') return

    const navType = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming

if (navType.type !== 'back_forward') {
  sessionStorage.removeItem(HOME_STATE_KEY)
  restoredHomeStateRef.current = true
  return
}

    const raw = sessionStorage.getItem(HOME_STATE_KEY)
    if (!raw) {
      restoredHomeStateRef.current = true
      return
    }

    try {
      const parsed = JSON.parse(raw)

      if (typeof parsed.query === 'string') {
        setQuery(parsed.query)
      }

      if (
        Array.isArray(parsed.selectedStatuses) &&
        parsed.selectedStatuses.every((item: unknown) => typeof item === 'string')
      ) {
        setSelectedStatuses(parsed.selectedStatuses)
      }

     if (
  Array.isArray(parsed.selectedCategories) &&
  parsed.selectedCategories.every((item: unknown) => typeof item === 'string')
) {
  setSelectedCategories(parsed.selectedCategories)
}

      if (typeof parsed.listScrollTop === 'number') {
        pendingListScrollTopRef.current = parsed.listScrollTop
      }
      if (
  parsed.mapCenter &&
  typeof parsed.mapCenter.lat === 'number' &&
  typeof parsed.mapCenter.lng === 'number'
) {
  setMapCenter({
    lat: parsed.mapCenter.lat,
    lng: parsed.mapCenter.lng,
  })
}

if (typeof parsed.mapLevel === 'number') {
  setMapLevel(parsed.mapLevel)
}

if (typeof parsed.openOverlayCustomerId === 'number') {
  setOpenOverlayCustomerId(parsed.openOverlayCustomerId)
}
      
    } catch (error) {
      console.warn('홈 상태 복원 실패:', error)
    } finally {
      restoredHomeStateRef.current = true
    }
  }, [])

  useEffect(() => {
  if (!restoredHomeStateRef.current) return
  saveHomeState()
}, [query, selectedStatuses, selectedCategories, mapCenter, mapLevel, openOverlayCustomerId])

  const resetForms = () => {
    setCustomerForm({
      company_name: '',
      address: '',
      agency: '',
      status: '활성',
    })

    setContactForm({
      name: '',
      department: '',
      position: '',
      phone: '',
    })

    setDeviceForms([createEmptyDeviceForm()])
  }

  const toggleStatus = (status: string) => {
    setFocusedCustomerId(null)
    setSelectedStatuses((prev) => {
      if (prev.includes(status)) {
        return prev.filter((s) => s !== status)
      }
      return [...prev, status]
    })
  }

  const updateDeviceForm = (
    index: number,
    field: keyof NewDeviceForm,
    value: string | File | null
  ) => {
    setDeviceForms((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item
        return {
          ...item,
          [field]: value,
        }
      })
    )
  }

  const addDeviceFormCard = () => {
    setDeviceForms((prev) => [...prev, createEmptyDeviceForm()])
  }

  const removeDeviceFormCard = (index: number) => {
    setDeviceForms((prev) => {
      if (prev.length === 1) return prev
      return prev.filter((_, i) => i !== index)
    })
  }





  const filteredCustomers = useMemo(() => {
    const q = query.trim().toLowerCase()

    const filtered = customers.filter((c) => {
      const statusMatched =
        selectedStatuses.length === 0 ? false : selectedStatuses.includes(c.status ?? '')

      if (!statusMatched) return false
      const devices = deviceMap.get(Number(c.customer_id)) || []
      const cats = devices.map((d) => d.category).filter((cat): cat is string => Boolean(cat))
      const hasFilterable = cats.some((cat) =>
        (CATEGORY_OPTIONS as readonly string[]).includes(cat)
      )

      const categoryMatched =
        selectedCategories.length === 0 ? false :
        !hasFilterable ? true :
        cats.some((cat) => selectedCategories.includes(cat))

      if (!categoryMatched) return false

      const deviceLine = getDeviceLine(devices).toLowerCase()

      if (!q) return true

      return (
        (c.company_name || '').toLowerCase().includes(q) ||
        (c.address || '').toLowerCase().includes(q) ||
        (c.status || '').toLowerCase().includes(q) ||
        (c.agency || '').toLowerCase().includes(q) ||
        deviceLine.includes(q)
      )
    })

    return [...filtered].sort((a, b) => {
      const aDevices = deviceMap.get(a.customer_id) || []
      const bDevices = deviceMap.get(b.customer_id) || []

      const aLatestDevice = Math.max(0, ...aDevices.map((d) => toTimeValue(d.install_date)))
      const bLatestDevice = Math.max(0, ...bDevices.map((d) => toTimeValue(d.install_date)))

      const aLatestService = latestServiceDateMap.get(a.customer_id) ?? 0
      const bLatestService = latestServiceDateMap.get(b.customer_id) ?? 0

      const aLatest = Math.max(aLatestDevice, aLatestService, a.customer_id)
      const bLatest = Math.max(bLatestDevice, bLatestService, b.customer_id)

      return bLatest - aLatest
    })
  }, [customers, query, selectedStatuses, selectedCategories, deviceMap, latestServiceDateMap])

useEffect(() => {
  if (pendingListScrollTopRef.current == null) return
  if (!listScrollRef.current) return
  if (filteredCustomers.length === 0) return  // 데이터 아직 없으면 대기

  const targetScrollTop = pendingListScrollTopRef.current
  pendingListScrollTopRef.current = null  // 중복 실행 방지를 위해 즉시 초기화

  let retry = 0

  const interval = setInterval(() => {
    if (!listScrollRef.current) {
      clearInterval(interval)
      return
    }

    listScrollRef.current.scrollTop = targetScrollTop

    // 실제로 적용됐는지 확인
    if (
      Math.abs(listScrollRef.current.scrollTop - targetScrollTop) < 5 ||
      retry > 15
    ) {
      clearInterval(interval)
    }

    retry++
  }, 50)

  return () => clearInterval(interval)
}, [filteredCustomers])

  const geocodeAddress = async (address: string) => {
    const { geocodeAddress: geocode } = await import('@/lib/geocode')
    return geocode(address)
  }

  const uploadPackingList = async (file: File, customerId: number, index: number) => {
    const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']
    if (!ALLOWED_TYPES.includes(file.type)) {
      throw new Error('JPG, PNG, WEBP, GIF, PDF 형식만 업로드 가능합니다.')
    }
    if (file.size > 20 * 1024 * 1024) {
      throw new Error('파일 크기는 20MB 이하여야 합니다.')
    }
    const fileExt = file.name.split('.').pop()
    const fileName = `customer-${customerId}-device-${index + 1}-${Date.now()}.${fileExt}`

    const { error: uploadError } = await supabase.storage
      .from('packing-lists')
      .upload(fileName, file, {
        upsert: true,
      })

    if (uploadError) throw uploadError

    return fileName
  }

  if (!authorized) return <AccessGate loading={guardLoading} />

  return (
    <>

      <style jsx global>{`
        input[type="date"].white-date::-webkit-calendar-picker-indicator {
          filter: invert(1);
          cursor: pointer;
        }

        input::placeholder,
        textarea::placeholder {
          color: ${TEXT_MUTED};
          opacity: 1;
        }

        select {
          appearance: none;
          -webkit-appearance: none;
          -moz-appearance: none;
        }

        * {
          scrollbar-color: #5b606b ${PANEL_BG};
        }
      `}</style>

      <div
        style={{
          padding: 20,
          height: 'calc(100vh - 36px)',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          background: PAGE_BG,
          overflow: 'hidden',
        }}
        className="home-wrapper"
      >

       <style>{`
        @media (max-width: 768px) {
  .home-grid { grid-template-columns: 1fr !important; grid-template-rows: 1fr !important; }
  .mobile-tab-bar { display: flex !important; }
  .mobile-hide { display: none !important; }
  .home-wrapper { height: calc(100dvh - 44px) !important; padding: 12px !important; overflow: hidden !important; }
  .home-grid { height: 100% !important; overflow: hidden !important; }
  .home-grid > div { height: 100% !important; min-height: 0 !important; min-width: 0 !important; overflow: hidden !important; }
  .home-grid > div > div { height: 100% !important; }
  body { overflow-x: hidden !important; }
}
      `}</style>

      {/* 모바일 탭 */}
      <div
        className="mobile-tab-bar"
        style={{
          display: 'none',
          marginBottom: 12,
          border: `1px solid #e5e7eb`,
          borderRadius: 12,
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => {
            setMobileTab('list')
          }}
          style={{
            flex: 1,
            padding: '10px 0',
            fontWeight: 700,
            fontSize: 14,
            border: 'none',
            cursor: 'pointer',
            background: mobileTab === 'list' ? '#234ea2' : '#ffffff',
            color: mobileTab === 'list' ? '#ffffff' : '#111111',
          }}
        >
          업체 목록
        </button>
        <button
          onClick={() => {
            setMobileTab('map')
            setTimeout(() => {
              const kakao = (window as any).kakao
              if (kakao?.maps) {
                const container = document.querySelector('.kakao-map-container')
                if (container) {
                  kakao.maps.event.trigger(container, 'resize')
                }
              }
              // relayout 직접 호출
              const mapInstance = (window as any).__kakaoMapInstance
              if (mapInstance) mapInstance.relayout()
            }, 200)
          }}
          style={{
            flex: 1,
            padding: '10px 0',
            fontWeight: 700,
            fontSize: 14,
            border: 'none',
            cursor: 'pointer',
            background: mobileTab === 'map' ? '#234ea2' : '#ffffff',
            color: mobileTab === 'map' ? '#ffffff' : '#111111',
          }}
        >
          지도
        </button>
      </div>

      <div
        className="home-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: '360px 1fr',
          gap: 12,
          alignItems: 'stretch',
          flex: 1,
          minHeight: 0,
        }}
      >
<div className={mobileTab === 'map' ? 'mobile-hide' : ''} style={{ minHeight: 0, minWidth: 0, height: '100%', overflow: 'hidden' }}>
          <Sidebar
            query={query}
            setQuery={setQuery}
            selectedStatuses={selectedStatuses}
            toggleStatus={toggleStatus}
            onAddClick={() => setIsAddCustomerModalOpen(true)}
            customers={filteredCustomers}
            deviceMap={deviceMap}
            onMove={(customer) => setFocusedCustomerId(Number(customer.customer_id))}
            onDetailClick={saveHomeState}
            listScrollRef={listScrollRef}
            onScrollSave={saveHomeState}
            isLoading={isLoading}
          />
          </div>

         <div style={{
  minHeight: 0,
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
}}>
         <MapView
  customers={filteredCustomers}
  deviceMap={deviceMap}
  focusedCustomerId={focusedCustomerId}
  selectedStatuses={selectedStatuses}
toggleStatus={toggleStatus}
selectedCategories={selectedCategories}
toggleCategory={toggleCategory}
onAddClick={() => setIsAddCustomerModalOpen(true)}
  restoredMapCenter={mapCenter}
  restoredMapLevel={mapLevel}
  restoredOpenOverlayCustomerId={openOverlayCustomerId}
  onMapStateChange={(center, level) => {
    setMapCenter(center)
    setMapLevel(level)
  }}
  onOpenOverlayChange={setOpenOverlayCustomerId}
/>
</div>
        </div>

        <AddCustomerModal
          isOpen={isAddCustomerModalOpen}
          isSavingCustomer={isSavingCustomer}
          customerForm={customerForm}
          setCustomerForm={setCustomerForm}
          contactForm={contactForm}
          setContactForm={setContactForm}
          deviceForms={deviceForms}
          updateDeviceForm={updateDeviceForm}
          addDeviceFormCard={addDeviceFormCard}
          removeDeviceFormCard={removeDeviceFormCard}
          onClose={() => setIsAddCustomerModalOpen(false)}
         onSave={async () => {
  try {
    const ok = await addCustomer({
      customerForm,
      contactForm,
      deviceForms,
      fetchData,
      resetForms,
      setIsSavingCustomer,
      setIsAddCustomerModalOpen,
      setQuery,
    })
    if (ok) toast.success('업체가 추가되었습니다')
  } catch (e: any) {
    toast.error(e?.message || '에러 발생')
  }
}}
        />
      </div>
    </>
  )
}