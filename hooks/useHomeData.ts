import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { type Customer, type Device, type ServiceHistory, toTimeValue } from '@/lib/home'

type Params = {
  setCustomers: React.Dispatch<React.SetStateAction<Customer[]>>
  setDeviceMap: React.Dispatch<React.SetStateAction<Map<number, Device[]>>>
  setLatestServiceDateMap: React.Dispatch<React.SetStateAction<Map<number, number>>>
}

export function useHomeData({
  setCustomers,
  setDeviceMap,
  setLatestServiceDateMap,
}: Params) {
  const supabase = createClient()

  const fetchData = async () => {
    const [customerRes, deviceRes, historyRes] = await Promise.all([
      supabase
  .from('customers')
  .select('customer_id, company_name, address, latitude, longitude, status, agency, category')
        .is('deleted_at', null)
        .order('customer_id', { ascending: false })
        .range(0, 5000),

      supabase
        .from('devices')
        .select(
          'device_id, customer_id, device_name, device_name2, option, serial_number, program, install_date, category, packing_list_url'
        )
        .is('deleted_at', null)
        .range(0, 5000),

      supabase.from('service_history').select('customer_id, visit_date').range(0, 5000),
    ])

    if (customerRes.error) {
      console.warn('customers 조회 오류:', customerRes.error)
    } else {
      const normalizedCustomers: Customer[] = (customerRes.data || []).map((c: any) => ({
        customer_id: Number(c.customer_id),
        company_name: c.company_name ?? '',
        address: c.address ?? null,
        latitude: c.latitude == null ? null : Number(c.latitude),
        longitude: c.longitude == null ? null : Number(c.longitude),
   status: c.status ?? null,
agency: c.agency ?? null,
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

    if (historyRes.error) {
      console.warn('service_history 조회 오류:', historyRes.error)
    } else {
      const map = new Map<number, number>()

      ;(historyRes.data as ServiceHistory[] | null)?.forEach((item) => {
        const customerId = Number(item.customer_id)
        if (Number.isNaN(customerId)) return

        const current = map.get(customerId) ?? 0
        const nextValue = toTimeValue(item.visit_date)

        if (nextValue > current) {
          map.set(customerId, nextValue)
        }
      })

      setLatestServiceDateMap(map)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  return { fetchData }
}