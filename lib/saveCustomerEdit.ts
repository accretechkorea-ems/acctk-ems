'use client'

/**
 * 사업장 한 줄을 고쳐 저장하는 **한 길**.
 *
 * 전에는 이 규칙이 상세 화면의 훅(hooks/customer/useCustomerCrud.ts) 안에만 있었다.
 * 이제 목록 보기의 사업장 표에서도 같은 수정 모달을 열므로, 두 화면이 **같은 규칙**을
 * 지나도록 함수로 꺼냈다. 토스트·화면 이동은 부르는 쪽의 일이고, 여기서는
 * 「무엇을 어떻게 저장하는가」만 본다.
 *
 * 하는 일:
 *   ① 주소가 바뀌었을 때만 좌표를 다시 구한다(안 바뀌면 결과가 같다 — 외부 호출을 아낀다).
 *   ② 회사 줄을 정한다 — 골라 둔 회사가 있으면 그 줄, 없으면 적힌 이름으로 찾거나 만든다
 *      (새로 만들 때는 분류를 받는다. 이 길로만 분류 없는 회사가 생기던 것을 막았다).
 *   ③ company_name 에는 「회사명 사업장명」 합친 값을 넣는다(화면·문서·엑셀이 이 칸을 읽는다).
 *   ④ 지역1 은 늘 normalizeRegion 을 지난다(lib/region.ts).
 */

import { createClient } from '@/lib/supabase/client'
import { geocodeAddress } from '@/lib/geocode'
import { customerLabel } from '@/lib/customerLabel'
import { normalizeRegion } from '@/lib/region'
import { invalidateParents } from '@/components/customer/ParentPicker'
import type { Customer, CustomerEditFormData } from '@/components/customer/types'

export type SaveResult = { ok: true } | { ok: false; message: string }

export async function saveCustomerEdit(customer: Customer, form: CustomerEditFormData): Promise<SaveResult> {
  const supabase = createClient()
  try {
    const addressChanged = form.address.trim() !== (customer.address ?? '').trim()
    const coords = addressChanged ? await geocodeAddress(form.address.trim()) : null

    let parentId = form.parent_customer_id
    let companyName = ''
    if (parentId != null) {
      const { data: parentRow } = await supabase.from('customers').select('company_name')
        .eq('customer_id', parentId).maybeSingle()
      companyName = (parentRow?.company_name ?? '').trim()
    } else {
      companyName = form.company_name.trim()
      if (!companyName) return { ok: false, message: '회사명을 입력해주세요' }
      const { data: found } = await supabase.from('customers').select('customer_id')
        .eq('is_parent', true).is('deleted_at', null).eq('company_name', companyName).maybeSingle()
      if (found) {
        parentId = found.customer_id
      } else {
        const industry = (form.new_company_industry ?? '').trim()
        if (!industry) return { ok: false, message: '새 회사의 분류를 선택해주세요' }
        const { data: made, error: makeErr } = await supabase.from('customers')
          .insert({ company_name: companyName, is_parent: true, industry })
          .select('customer_id').single()
        if (makeErr || !made) return { ok: false, message: makeErr?.message || '회사를 만들지 못했습니다' }
        parentId = made.customer_id
        invalidateParents()   // 회사 목록 캐시가 새 회사를 모르고 있다
      }
    }

    const siteName = (form.site_name ?? '').trim()
    const combined = customerLabel(companyName, siteName) || form.company_name.trim()

    const { error } = await supabase.from('customers').update({
      company_name: combined,
      site_name: siteName || null,
      address: form.address.trim(),
      region1: normalizeRegion(customer.region1 ?? null, form.address),
      agency_customer_id: form.agency_customer_id ?? null,
      status: form.status,
      note: form.note.trim() || null,
      parent_customer_id: parentId,
      ...(coords ? { latitude: coords.latitude, longitude: coords.longitude } : null),
    }).eq('customer_id', customer.customer_id)
    if (error) return { ok: false, message: error.message || '사업장 정보 수정 중 오류가 발생했습니다' }
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error)?.message || '사업장 정보 수정 중 오류가 발생했습니다' }
  }
}
