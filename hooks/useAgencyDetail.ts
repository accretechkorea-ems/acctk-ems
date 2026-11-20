'use client'

// 대리점 화면이 **따로 읽는 것** — 담당자와 그 대리점을 거친 견적 (2026-11-21).
//
// 거래 사업장 표는 조회를 **하나도 더 하지 않는다** — 목록 보기가 이미 들고 있는
// 사업장·장비·최근 접점·진행 견적을 그대로 쓴다(lib/agencyPane.ts). 여기서 읽는 것은
// 그 두 가지뿐이고, **대리점을 고른 순간에만** 읽는다(45곳을 미리 읽어 둘 이유가 없다).
//
//   담당자  contacts.customer_id 가 대리점 줄을 가리키는 줄(2026-11-21 실측 13줄 있다).
//   견적    quotes.dealer_id = 그 대리점. 제목 줄의 배지와 견적 이력 창이 함께 쓴다
//           (전체 43건 중 그 대리점 몫 — 젠트가 33건이다).
//
// 담은 자료에 **주인(id)을 함께 적어 둔다**. 대리점을 바꾼 순간 화면이 그것을 보고
// 빈 것으로 여기므로, 새 자료가 오기까지 앞 대리점의 담당자가 보이는 틈이 없다
// (효과 안에서 비우면 그 비우기 자체가 한 번 더 그리게 만든다).

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { QUOTE_SELECT } from '@/hooks/customer/useCustomerDetail'
import type { Contact, Quote } from '@/components/customer/types'

export type AgencyDetail = {
  contacts: Contact[]
  quotes: Quote[]
  loading: boolean
  /** 담당자를 더하거나 고친 뒤 부른다. */
  reload: () => void
}

const CONTACT_SELECT = 'contact_id, customer_id, name, department, position, phone, email'

type Loaded = { id: number | null; contacts: Contact[]; quotes: Quote[] }
const EMPTY: Contact[] = []
const NO_QUOTES: Quote[] = []

export function useAgencyDetail(agencyId: number | null): AgencyDetail {
  const [loaded, setLoaded] = useState<Loaded>({ id: null, contacts: [], quotes: [] })
  const [nonce, setNonce] = useState(0)

  const reload = useCallback(() => setNonce(n => n + 1), [])

  useEffect(() => {
    if (agencyId == null) return
    const supabase = createClient()
    let cancelled = false
    const run = async () => {
      const [c, q] = await Promise.all([
        supabase.from('contacts').select(CONTACT_SELECT)
          .eq('customer_id', agencyId).is('deleted_at', null)
          .order('contact_id', { ascending: true }),
        supabase.from('quotes').select(QUOTE_SELECT)
          .eq('dealer_id', agencyId)
          .order('quote_date', { ascending: false }),
      ])
      if (cancelled) return
      if (c.error) console.warn('[agency] 담당자 조회 오류:', c.error)
      if (q.error) console.warn('[agency] 견적 조회 오류:', q.error)
      setLoaded({
        id: agencyId,
        contacts: (c.data as unknown as Contact[]) ?? [],
        quotes: (q.data as unknown as Quote[]) ?? [],
      })
    }
    void run()
    return () => { cancelled = true }
  }, [agencyId, nonce])

  // 담긴 자료의 주인이 지금 고른 대리점인가 — 아니면 아직 읽는 중이다.
  const fresh = agencyId != null && loaded.id === agencyId
  return {
    contacts: fresh ? loaded.contacts : EMPTY,
    quotes: fresh ? loaded.quotes : NO_QUOTES,
    loading: agencyId != null && !fresh,
    reload,
  }
}
