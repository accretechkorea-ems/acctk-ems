import { useEffect } from 'react'
import { IN_USE_FILTER } from '@/lib/deviceStatus'
import { createClient } from '@/lib/supabase/client'
import { type Customer, type Device } from '@/lib/home'
import { loadLastTouchMap, touchValue } from '@/lib/customerLastTouch'
import { CUSTOMER_NAME_SELECT, customerDisplayName, parentNameOf } from '@/lib/customerLabel'
import { CUSTOMER_AGENCY_SELECT, NOT_AGENCY_ONLY, agencyNameOf } from '@/lib/customerAgency'

type Params = {
  setCustomers: React.Dispatch<React.SetStateAction<Customer[]>>
  setDeviceMap: React.Dispatch<React.SetStateAction<Map<number, Device[]>>>
  /** 업체 → 마지막 접점 시각(영업활동·서비스·견적·수리 중 최신). 목록 정렬이 쓴다. */
  setLatestServiceDateMap: React.Dispatch<React.SetStateAction<Map<number, number>>>
}

export function useHomeData({
  setCustomers,
  setDeviceMap,
  setLatestServiceDateMap,
}: Params) {
  const supabase = createClient()

  const fetchData = async () => {
    const [customerRes, deviceRes, lastTouch] = await Promise.all([
      supabase
  .from('customers')
  .select(`customer_id, ${CUSTOMER_NAME_SELECT}, ${CUSTOMER_AGENCY_SELECT}, address, latitude, longitude, status, category`)
        .is('deleted_at', null)
        // 부모 행(회사 묶음)은 지도 마커·업체 목록에 나오면 안 된다
        .eq('is_parent', false)
        // 대리점 **전용** 줄도 고객사가 아니다(lib/customerAgency.ts). 대리점이면서
        // 우리 장비를 쓰는 사업장 15곳은 부모가 있으므로 그대로 남는다.
        .or(NOT_AGENCY_ONLY)
        .order('customer_id', { ascending: false })
        .range(0, 5000),

      supabase
        .from('devices')
        .select(
          'device_id, customer_id, device_name, device_name2, option, serial_number, program, install_date, category, packing_list_url'
        )
        .is('deleted_at', null)
        // 폐기한 장비는 업체 카드·목록·지도의 장비 줄에 나오지 않는다(lib/deviceStatus.ts).
        .or(IN_USE_FILTER)
        .range(0, 5000),

      // 마지막 접점은 네 표를 함께 본다(lib/customerLastTouch.ts).
      loadLastTouchMap(supabase),
    ])

    if (customerRes.error) {
      console.warn('customers 조회 오류:', customerRes.error)
    } else {
      const normalizedCustomers: Customer[] = (customerRes.data || []).map((c: any) => ({
        customer_id: Number(c.customer_id),
        // 이름은 여기서 한 번 만든다 — 화면 조각마다 회사·사업장을 다시 잇지 않게.
        company_name: customerDisplayName(c),
        site_name: c.site_name ?? null,
        company_only: parentNameOf(c.parent) ?? (c.company_name ?? null),
        address: c.address ?? null,
        latitude: c.latitude == null ? null : Number(c.latitude),
        longitude: c.longitude == null ? null : Number(c.longitude),
   status: c.status ?? null,
// 대리점 이름도 여기서 한 번 꺼낸다 — 카드·지도·검색은 이 칸만 읽는다.
agency_name: agencyNameOf(c),
category: c.category ?? null,
      }))
      setCustomers(normalizedCustomers)
    }

    if (deviceRes.error) {
      console.warn('devices 조회 오류:', deviceRes.error)
    } else {
      const map = new Map<number, Device[]>()

      ;(deviceRes.data || []).forEach((d: any) => {
        const customerId = Number(d.customer_id)
        if (Number.isNaN(customerId)) return

        const normalizedDevice: Device = {
          device_id: d.device_id ? Number(d.device_id) : undefined,
          customer_id: customerId,
          device_name: d.device_name ?? null,
          device_name2: d.device_name2 ?? null,
          option: d.option ?? null,
          serial_number: d.serial_number ?? null,
          program: d.program ?? null,
          install_date: d.install_date ?? null,
          category: d.category ?? null,
          packing_list_url: d.packing_list_url ?? null,
        }

        const existing = map.get(customerId) || []
        existing.push(normalizedDevice)
        map.set(customerId, existing)
      })

      setDeviceMap(map)
    }

    // 마지막 접점 — 네 갈래(영업활동·서비스·견적·수리) 중 최신 날짜를 시각으로 바꿔 둔다.
    const touchMap = new Map<number, number>()
    for (const [customerId, touch] of lastTouch) touchMap.set(customerId, touchValue(touch))
    setLatestServiceDateMap(touchMap)
  }

  useEffect(() => {
    fetchData()
  }, [])

  return { fetchData }
}