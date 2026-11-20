'use client'

/**
 * 업체 등록 — **회사 한 줄 + 사업장 여러 줄 + 담당자 한 명**을 한 번에 만든다.
 *
 * ── 왜 이렇게 바뀌었나 ───────────────────────────────────────────────────
 *   전에는 폼이 사업장 한 줄만 만들었고, 회사는 「회사명」 칸 안의 작은 링크로 따로
 *   만들었다. 그래서 회사·사업장·대리점이 서로 다른 길로 들어왔고 영문명·분류가 빈
 *   회사가 계속 생겼다. 이제 등록은 한 길이다 —
 *     ① 종류(고객사·대리점) → ② 업체 정보(한글명·영문명·분류) → ③ 사업장 ④ 담당자
 *
 * ── 실패하면 되돌린다 ────────────────────────────────────────────────────
 *   사업장 둘째 줄에서 실패했는데 회사와 첫 줄만 남으면 그게 더 나쁜 상태다.
 *   이 함수가 **이번에 만든 줄만** 적어 두었다가 거꾸로 지운다.
 *
 * ⚠ 영문명(name_en)은 db/customer_name_en_20261119.sql 로 더하는 칸이다. 칸이 아직
 *   없으면 lib/nameEn.ts 의 되돌이길로 **그 칸 없이** 저장한다(이름·분류는 그대로 들어간다).
 */

import { createClient } from '@/lib/supabase/client'
import { customerLabel } from '@/lib/customerLabel'
import { normalizeRegion } from '@/lib/region'
import { withNameEnFallback } from '@/lib/nameEn'
import { invalidateParents } from '@/components/customer/ParentPicker'
import { invalidateAgencies } from '@/lib/customerAgency'

/** 고객 담당자 한 사람 — **그 사업장 줄에 붙는다**(어느 사업장인지 따로 고르지 않는다). */
export type NewContactInput = {
  name: string
  position: string
  department: string
  phone: string
  email: string
}

export type NewSiteInput = {
  siteName: string
  address: string
  /** 대리점 줄(customers.is_agency). null 이면 직판. */
  agencyId: number | null
  status: string
  /** 이 사업장의 고객 담당자들. 비어 있을 수 있다. */
  contacts: NewContactInput[]
}

export type AddCustomerInput = {
  kind: 'customer' | 'agency'
  /** 업체명(한글). 기존 회사에 붙일 때도 그 회사 이름이 들어온다. */
  companyName: string
  nameEn: string
  /** 고객사만. 대리점은 빈 문자열. */
  industry: string
  /** 기존 회사에 사업장만 더하는 경우 그 회사 id. 새로 만들면 null. */
  existingCompanyId: number | null
  sites: NewSiteInput[]
}

export type AddCustomerResult = {
  companyId: number
  siteIds: number[]
  /** 토스트에 쓸 한 줄. */
  message: string
}

export async function addCustomerEntry(input: AddCustomerInput): Promise<AddCustomerResult> {
  const supabase = createClient()
  const name = input.companyName.trim()
  const nameEn = input.nameEn.trim()
  if (!name) throw new Error(input.kind === 'agency' ? '대리점명을 입력해주세요' : '업체명을 입력해주세요')

  /** 이번에 만든 줄 — 실패하면 거꾸로 지운다. */
  const made: number[] = []
  const rollback = async () => {
    for (const id of [...made].reverse()) {
      await supabase.from('customers').delete().eq('customer_id', id)
    }
  }

  // ── 대리점 — 한 줄이면 끝난다 ───────────────────────────────────────────
  if (input.kind === 'agency') {
    const { data: dup } = await supabase.from('customers').select('customer_id')
      .eq('is_agency', true).is('deleted_at', null).eq('company_name', name).maybeSingle()
    if (dup) throw new Error('같은 이름의 대리점이 이미 있습니다')

    const site = input.sites[0] ?? { siteName: '', address: '', agencyId: null, status: '활성', contacts: [] }
    const { data, error } = await withNameEnFallback(useEn => supabase.from('customers')
      .insert({
        company_name: name,
        is_agency: true,
        is_parent: false,
        parent_customer_id: null,
        address: site.address.trim() || null,
        region1: normalizeRegion(null, site.address),
        status: site.status || '활성',
        ...(useEn && nameEn ? { name_en: nameEn } : null),
      })
      .select('customer_id').single())
    if (error || !data) throw new Error(error?.message || '대리점을 만들지 못했습니다')
    invalidateAgencies()
    return { companyId: data.customer_id, siteIds: [], message: `${name} 대리점을 등록했습니다` }
  }

  // ── 고객사 ──────────────────────────────────────────────────────────────
  if (input.sites.length === 0) throw new Error('사업장을 한 곳 이상 입력해주세요')

  try {
    // ① 회사 줄 — 고른 회사가 있으면 그 줄, 없으면 만든다.
    let companyId = input.existingCompanyId
    let companyName = name
    if (companyId != null) {
      const { data: row } = await supabase.from('customers').select('company_name')
        .eq('customer_id', companyId).maybeSingle()
      companyName = (row?.company_name ?? name).trim()
    } else {
      const { data: dup } = await supabase.from('customers').select('customer_id')
        .eq('is_parent', true).is('deleted_at', null).eq('company_name', name).maybeSingle()
      if (dup) {
        // 폼이 못 걸러낸 동명 회사 — 새로 만들지 않고 그 줄에 붙인다.
        companyId = dup.customer_id
      } else {
        const { data, error } = await withNameEnFallback(useEn => supabase.from('customers')
          .insert({
            company_name: name,
            is_parent: true,
            is_agency: false,
            parent_customer_id: null,
            industry: input.industry || null,
            ...(useEn && nameEn ? { name_en: nameEn } : null),
          })
          .select('customer_id').single())
        if (error || !data) throw new Error(error?.message || '회사를 만들지 못했습니다')
        companyId = data.customer_id
        made.push(data.customer_id)
        invalidateParents()
      }
    }

    // ② 사업장 줄들 — 주소에서 좌표와 지역을 뽑는다.
    const { geocodeAddress } = await import('@/lib/geocode')
    const siteIds: number[] = []
    for (const site of input.sites) {
      const address = site.address.trim()
      const coords = await geocodeAddress(address)
      const siteName = site.siteName.trim()
      const { data, error } = await supabase.from('customers').insert({
        // company_name 에는 **합친 이름**을 넣는다 — 화면·문서·엑셀이 아직 이 칸만 읽는다.
        company_name: customerLabel(companyName, siteName),
        site_name: siteName || null,
        address,
        region1: normalizeRegion(null, address),
        agency_customer_id: site.agencyId ?? null,
        status: site.status || '활성',
        parent_customer_id: companyId,
        is_parent: false,
        latitude: coords.latitude,
        longitude: coords.longitude,
      }).select('customer_id').single()
      if (error || !data) throw new Error(error?.message || '사업장을 만들지 못했습니다')
      siteIds.push(data.customer_id)
      made.push(data.customer_id)

      // ③ 이 사업장의 담당자들 — 사업장 블록에서 함께 적은 사람들이다.
      const people = (site.contacts ?? []).filter(c => c.name.trim())
      if (people.length > 0) {
        const { error: cErr } = await supabase.from('contacts').insert(people.map(c => ({
          customer_id: data.customer_id,
          name: c.name.trim(),
          position: c.position.trim() || null,
          department: c.department.trim() || null,
          phone: c.phone.trim() || null,
          email: c.email.trim() || null,
        })))
        // 담당자 때문에 회사·사업장을 되돌리지는 않는다 — 나중에 상세에서 더할 수 있다.
        if (cErr) console.error('[addCustomer] 담당자 저장 실패', cErr)
      }
    }

    const message = input.existingCompanyId != null
      ? `${companyName} 에 사업장 ${siteIds.length}곳을 더했습니다`
      : `${companyName} 와 사업장 ${siteIds.length}곳을 등록했습니다`
    return { companyId: companyId as number, siteIds, message }
  } catch (e) {
    await rollback()
    throw e
  }
}
