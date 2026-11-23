'use client'

// 대상 고객사 검색 — 등록된 업체를 골라 customer_id 를 돌려준다.
//
// 조작(↑↓·Enter·Esc·Tab·마우스 혼용)은 **공용 콤보박스**가 맡는다
// (components/common/SearchSelect.tsx, 2026-11-23). 전에는 이 파일이 목록과 키보드를
// 직접 그렸고, 자리마다 조금씩 달랐다.
// 찾는 칸도 공용이다 — 회사명·영문명·사업장명·주소(lib/companySearch.ts).
// 조회: customers 에서 deleted_at is null, is_parent=false, 대리점 전용 줄 제외, 최대 10건.

import { useState } from 'react'
import { colsWithNameEn, withNameEnFallback } from '@/lib/nameEn'
import { companySearchOr, COMPANY_SEARCH_PLACEHOLDER } from '@/lib/companySearch'
import { createClient } from '@/lib/supabase/client'
import SearchSelect, { CompanyOption } from '@/components/common/SearchSelect'
import { NOT_AGENCY_ONLY } from '@/lib/customerAgency'
import { BORDER, CARD_BG, TEXT, MUTED } from '@/components/common/ui'
import { R } from '@/lib/radius'

export type CustomerHit = {
  customer_id: number
  company_name: string
  address: string | null
  status: string | null
  /** 영문 회사명 — 결과 줄에 회색으로 나란히 둔다. 칸이 없는 DB 면 비어 온다. */
  name_en?: string | null
}

type Props = {
  value: CustomerHit | null
  onChange: (c: CustomerHit | null) => void
  placeholder?: string
  invalid?: boolean
  /** 입력칸 높이. 모달 안에서는 다른 입력과 맞춰 44 를 쓴다. */
  height?: number
}

export default function CustomerSearch({ value, onChange, placeholder = COMPANY_SEARCH_PLACEHOLDER, invalid, height = 44 }: Props) {
  const supabase = createClient()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CustomerHit[]>([])

  const select = (c: CustomerHit) => {
    onChange(c)
    setQuery('')
    setResults([])
  }

  const search = async (q: string) => {
    setQuery(q)
    if (!q.trim()) { setResults([]); return }
    // 부모 행(회사 묶음)은 사용 대상이 아니다 — 견적 화면과 같은 조건.
    // 회사명·사업장명·영문명 — 「현대자동차」로도, 「감마세타」로도, 「HYUNDAI」로도 걸려야 한다.
    // 영문명 칸이 없는 DB 면 그 칸만 빼고 다시 읽는다(lib/nameEn.ts).
    const { data, error } = await withNameEnFallback(useEn => supabase
      .from('customers')
      .select(colsWithNameEn('customer_id, company_name, address, status', useEn))
      .is('deleted_at', null)
      .eq('is_parent', false)
      .or(NOT_AGENCY_ONLY)   // 대리점 전용 줄은 쇼룸 사용 대상이 아니다
      .or(companySearchOr(q, useEn))
      .limit(10))
    if (error) { console.error('[showroom] customer search failed', error); return }
    setResults((data ?? []) as unknown as CustomerHit[])
  }

  const fieldStyle = {
    width: '100%', height, padding: '0 12px',
    border: invalid ? '1px solid #dc2626' : `1px solid ${BORDER}`,
    borderRadius: R.icon, boxSizing: 'border-box' as const,
    color: TEXT, background: CARD_BG, outline: 'none', fontSize: 16, fontFamily: 'inherit',
  }

  // 고르고 나면 이름을 글자로 보여주고, 다시 찾을 때는 × 로 비운다(견적 화면과 같은 방식).
  if (value) {
    return (
      <div style={{ ...fieldStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14 }}>
          {value.company_name}
        </span>
        <button type="button" onClick={() => onChange(null)} title="지우기"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED, padding: 0, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    )
  }

  return (
    <SearchSelect<CustomerHit>
      items={results}
      itemKey={c => c.customer_id}
      renderItem={c => (
        <CompanyOption
          name={c.company_name}
          nameEn={c.name_en}
          sub={`${c.address ?? ''}${c.status ? ` · ${c.status}` : ''}`}
        />
      )}
      onSelect={select}
      query={query}
      onQueryChange={q => void search(q)}
      placeholder={placeholder}
      inputStyle={fieldStyle}
      maxHeight={220}
      emptyText="맞는 업체가 없습니다"
    />
  )
}
