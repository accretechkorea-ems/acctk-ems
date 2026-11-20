import { useEffect } from 'react'
import { IN_USE_FILTER } from '@/lib/deviceStatus'
import { createClient } from '@/lib/supabase/client'
import { type Customer, type Device } from '@/lib/home'
import { loadLastTouchMap, touchValue, type LastTouch } from '@/lib/customerLastTouch'
import { CUSTOMER_NAME_SELECT, customerDisplayName, parentNameOf, type ParentNameJoin } from '@/lib/customerLabel'
import { CUSTOMER_AGENCY_SELECT, NOT_AGENCY_ONLY, agencyNameOf, type AgencyJoin } from '@/lib/customerAgency'

type Params = {
  setCustomers: React.Dispatch<React.SetStateAction<Customer[]>>
  setDeviceMap: React.Dispatch<React.SetStateAction<Map<number, Device[]>>>
  /** 업체 → 마지막 접점 시각(영업활동·서비스·견적·수리 중 최신). 목록 정렬이 쓴다. */
  setLatestServiceDateMap: React.Dispatch<React.SetStateAction<Map<number, number>>>
  /**
   * 업체 → 마지막 접점 **그 자체**(날짜·갈래·작성자). 목록 보기가 「최근 활동 · 작성자」
   * 칸에 쓴다. 지도 보기는 시각만 있으면 되므로 선택이다.
   */
  setLastTouchMap?: React.Dispatch<React.SetStateAction<Map<number, LastTouch>>>
}

export function useHomeData({
  setCustomers,
  setDeviceMap,
  setLatestServiceDateMap,
  setLastTouchMap,
}: Params) {
  const supabase = createClient()

  const fetchData = async () => {
    const [customerRes, deviceRes, lastTouch] = await Promise.all([
      supabase
  .from('customers')
  .select(`customer_id, ${CUSTOMER_NAME_SELECT}, ${CUSTOMER_AGENCY_SELECT}, parent_customer_id, region1, address, latitude, longitude, status, category, note`)
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
      /**
       * 조회해 온 한 줄 — select 문에 적은 칸 그대로다. 이름(parent)·대리점(agency_ref)은
       * 임베드라 한 줄로도 배열로도 올 수 있어, 그 두 함수(customerLabel·customerAgency)가
       * 가려 읽는다. 그래서 그 둘만 느슨하게 둔다.
       */
      type CustomerQueryRow = {
        customer_id: number | string
        company_name?: string | null
        site_name?: string | null
        parent_customer_id?: number | string | null
        region1?: string | null
        address?: string | null
        latitude?: number | string | null
        longitude?: number | string | null
        status?: string | null
        category?: string | null
        note?: string | null
        // 숫자로만 온다(bigint) — agencyNameOf 가 그 모양을 요구한다.
        agency_customer_id?: number | null
        parent?: ParentNameJoin
        agency_ref?: AgencyJoin
      }
      const normalizedCustomers: Customer[] = (customerRes.data || []).map((c: CustomerQueryRow) => ({
        customer_id: Number(c.customer_id),
        // 이름은 여기서 한 번 만든다 — 화면 조각마다 회사·사업장을 다시 잇지 않게.
        company_name: customerDisplayName(c),
        site_name: c.site_name ?? null,
        company_only: parentNameOf(c.parent) ?? (c.company_name ?? null),
        // 목록 보기가 회사로 묶는 기준. 없으면 「미연결」이다.
        parent_customer_id: c.parent_customer_id == null ? null : Number(c.parent_customer_id),
        region1: c.region1 ?? null,
        address: c.address ?? null,
        latitude: c.latitude == null ? null : Number(c.latitude),
        longitude: c.longitude == null ? null : Number(c.longitude),
   status: c.status ?? null,
// 대리점 이름도 여기서 한 번 꺼낸다 — 카드·지도·검색은 이 칸만 읽는다.
agency_name: agencyNameOf(c),
agency_customer_id: c.agency_customer_id == null ? null : Number(c.agency_customer_id),
category: c.category ?? null,
// 메모 — 목록 보기의 사업장 수정 모달이 읽고 쓴다(없이 열면 저장할 때 비워진다).
note: c.note ?? null,
      }))
      setCustomers(normalizedCustomers)
    }

    if (deviceRes.error) {
      console.warn('devices 조회 오류:', deviceRes.error)
    } else {
      const map = new Map<number, Device[]>()

      /** 장비 한 줄 — select 문에 적은 칸 그대로. */
      type DeviceQueryRow = {
        device_id?: number | string
        customer_id: number | string
        device_name?: string | null
        device_name2?: string | null
        option?: string | null
        serial_number?: string | null
        program?: string | null
        install_date?: string | null
        category?: string | null
        packing_list_url?: string | null
      }
      ;(deviceRes.data || []).forEach((d: DeviceQueryRow) => {
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
    // 목록 보기는 날짜·갈래·작성자가 다 필요하다 — 받은 것을 그대로 넘긴다.
    setLastTouchMap?.(lastTouch)
  }

  useEffect(() => {
    fetchData()
  }, [])

  return { fetchData }
}