'use client'

// 대리점 — **customers 안의 한 줄**(`is_agency = true`)이다. 이름은 그 줄의 company_name.
//
// ── 왜 줄인가 ──────────────────────────────────────────────────────────────
//   전에는 `customers.agency` 가 자유 입력 텍스트였다. 같은 대리점이 「ACCT-K」/「ACCTK」
//   처럼 갈리고, 「직판」·「일본 직수입」·사람 이름까지 들어와 있었다. 한편 견적은
//   `quotes.dealer_id` 로 **업체 줄**을 가리키고, 리드는 또 `leads.partner_company` 텍스트라
//   「젠트가 올린 견적 전체」를 셀 길이 없었다. 그래서 대리점도 업체 한 줄로 모았다
//   (2026-11-19 적용 · db/crm_cleanup_20261118.sql).
//
//   사업장 → 대리점은 `customers.agency_customer_id` FK 다. 비어 있으면 **직판**이다.
//
// ── 텍스트 칸(agency)은 ────────────────────────────────────────────────────
//   남아 있지만 **아무도 읽지 않는다**. 이 파일의 어느 함수도 그 칸을 보지 않는다 —
//   거기로 되돌아가는 길을 막아 두는 것이 이 주석의 일이다.
//
// ── 대리점 줄이 고객사 목록에 섞이는 문제 ──────────────────────────────────
//   대리점 45줄 중 15줄은 **사업장이기도 하다**(이룸지텍·하나무역처럼 우리 장비를 쓰는
//   대리점). 그 줄은 목록에 나와야 한다. 나오면 안 되는 것은 **대리점 전용 줄**
//   (`is_agency` 이고 회사도 아니고 부모도 없는 30줄)이다 — NOT_AGENCY_ONLY 가 그것이다.

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

/** 「직판」 — 대리점이 없는 건의 표시 글자. 한 곳에서 정한다. */
export const DIRECT_SALE_LABEL = '직판'

// ── 조회에서 대리점 이름을 읽는 법 ─────────────────────────────────────────
//   이름은 **대리점 줄**에 있으므로 함께 읽어야 한다. customers 는 자기 자신을 두 번
//   참조하므로(parent_customer_id · agency_customer_id) 임베딩에 **칸 이름을 적는다** —
//   그냥 `customers(...)` 로 쓰면 PGRST201 로 조회 전체가 실패한다.
//
//       .select(`customer_id, ${CUSTOMER_NAME_SELECT}, ${CUSTOMER_AGENCY_SELECT}`)

/** 대리점 이름에 필요한 칸들 — select 문자열에 그대로 붙인다. */
export const CUSTOMER_AGENCY_SELECT = 'agency_customer_id, agency_ref:agency_customer_id(company_name)'

/** 내장 조인으로 함께 읽은 대리점(한 줄이지만 배열로 올 때도 있어 둘 다 받는다). */
export type AgencyJoin = { company_name?: string | null } | { company_name?: string | null }[] | null

export type CustomerAgencyRow = {
  agency_customer_id?: number | null
  agency_ref?: AgencyJoin
}

/** 조인해 온 대리점에서 이름만. 없으면 null. */
export function agencyNameOf(row: CustomerAgencyRow | null | undefined): string | null {
  const one = Array.isArray(row?.agency_ref) ? row?.agency_ref[0] : row?.agency_ref
  const name = (one?.company_name ?? '').trim()
  return name || null
}

/** 화면·문서에 찍는 글자 — 대리점이 없으면 「직판」. */
export function agencyLabelOf(row: CustomerAgencyRow | null | undefined): string {
  return agencyNameOf(row) ?? DIRECT_SALE_LABEL
}

/**
 * **대리점 전용 줄을 뺀다** — `.eq('is_parent', false)` 로 이미 거른 조회에 함께 붙인다.
 *
 *     .eq('is_parent', false).or(NOT_AGENCY_ONLY)
 *
 * 뜻은 「대리점이 아니거나, 대리점이어도 어느 회사에 묶여 있는 줄」이다. 뒤쪽을 살리는
 * 이유는 위 머리글의 15줄 — 대리점이면서 우리 고객인 사업장이다.
 */
export const NOT_AGENCY_ONLY = 'is_agency.eq.false,parent_customer_id.not.is.null'

// ── 대리점 목록(드롭다운) ──────────────────────────────────────────────────
//   45줄뿐이라 한 번 읽어 캐시하고 화면에서 걸러 쓴다(ParentPicker·offices 와 같은 방식).

export type AgencyOption = {
  customer_id: number
  company_name: string
  address: string | null
}

const COLUMNS = 'customer_id, company_name, address'

let cache: Promise<AgencyOption[]> | null = null

/** 대리점 전체. 정렬은 이름순. */
export function loadAgencies(): Promise<AgencyOption[]> {
  if (cache) return cache
  cache = (async () => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('customers')
      .select(COLUMNS)
      .eq('is_agency', true)
      .is('deleted_at', null)
      .order('company_name')
    if (error) {
      // 실패하면 캐시를 비워 다음 호출에서 다시 시도한다.
      console.error('[agencies] load failed', error)
      cache = null
      return []
    }
    return (data ?? []).map(r => ({
      customer_id: Number(r.customer_id),
      company_name: (r.company_name ?? '').trim(),
      address: r.address ?? null,
    }))
  })()
  return cache
}

/** 대리점을 새로 만들거나 고친 뒤 부른다. 다음 호출에서 다시 읽는다. */
export function invalidateAgencies(): void {
  cache = null
}

/** 화면에서 쓰는 훅 — 처음 그릴 때 한 번 읽는다. */
export function useAgencies(): AgencyOption[] {
  const [list, setList] = useState<AgencyOption[]>([])
  useEffect(() => {
    let cancelled = false
    loadAgencies().then(rows => { if (!cancelled) setList(rows) })
    return () => { cancelled = true }
  }, [])
  return list
}

/** id 로 이름 — 목록을 이미 들고 있을 때. 못 찾으면 null. */
export function agencyNameById(list: AgencyOption[], id: number | null | undefined): string | null {
  if (id == null) return null
  return list.find(a => a.customer_id === id)?.company_name ?? null
}
