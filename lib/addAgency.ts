'use client'

// 대리점 한 줄 등록 — 업체 등록 폼의 **대리점 모드**가 부른다.
//
// 대리점도 `customers` 의 한 줄이다(is_agency). 사업장 등록(lib/addCustomer.ts)과 다른 점:
//   · 회사에 묶이지 않는다 — parent_customer_id 는 null 이다.
//   · 장비·담당자를 받지 않는다.
//   · 좌표를 구하지 않는다 — 대리점은 지도에 찍지 않는다(목록에서도 빠진다).
//
// ⚠ 제약: `customers_parent_or_company` 는 「닫힌 줄이거나, 회사이거나, 대리점이거나,
//   부모가 있어야 한다」이다. is_agency = true 라 그 항으로 통과한다.

import { createClient } from '@/lib/supabase/client'
import { invalidateAgencies } from '@/lib/customerAgency'
import { normalizeRegion } from '@/lib/region'

export type AddAgencyInput = {
  name: string
  address: string
  status: string
}

export async function addAgency(input: AddAgencyInput): Promise<{ customer_id: number; company_name: string }> {
  const name = input.name.trim()
  if (!name) throw new Error('대리점명을 입력해주세요')

  const supabase = createClient()

  // 같은 이름의 대리점이 이미 있으면 만들지 않는다 — 대리점 표기가 갈리는 것이
  // 이번 정리의 원인이었다(ACCT-K / ACCTK).
  const { data: dup } = await supabase
    .from('customers')
    .select('customer_id')
    .eq('is_agency', true)
    .is('deleted_at', null)
    .eq('company_name', name)
    .maybeSingle()
  if (dup) throw new Error('같은 이름의 대리점이 이미 있습니다')

  const { data, error } = await supabase
    .from('customers')
    .insert({
      company_name: name,
      is_agency: true,
      is_parent: false,
      parent_customer_id: null,
      address: input.address.trim() || null,
      region1: normalizeRegion(null, input.address),
      status: input.status || '활성',
    })
    .select('customer_id, company_name')
    .single()
  if (error || !data) throw error || new Error('대리점을 만들지 못했습니다')

  invalidateAgencies()
  return { customer_id: data.customer_id, company_name: data.company_name ?? name }
}
