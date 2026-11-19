'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { colsWithNameEn, withNameEnFallback } from '@/lib/nameEn'
import { createClient } from '@/lib/supabase/client'
import Popover from '@/components/common/Popover'
import { INDUSTRIES } from '@/lib/leadOptions'

/**
 * 소속회사(부모) 선택 칸.
 *
 * 같은 회사가 측정실·공장 단위로 여러 행에 나뉘어 있어, 그것을 묶는 껍데기 행을 부모로 둔다.
 * 부모는 주소·좌표·장비가 없고 `is_parent = true` 로만 구분한다.
 *
 * 후보를 `is_parent = true` 로만 한정하는 것이 곧 순환 방지다 —
 * 자식은 후보에 뜨지 않으므로 자기 자신이나 자손을 부모로 고를 수 없다.
 *
 * 업체 추가·수정 두 모달이 같은 규칙을 쓰도록 한곳에 둔다.
 */

export type ParentOption = {
  customer_id: number
  company_name: string
  industry: string | null
  /** 회사 영문명 — 검색이 한글 이름과 함께 본다(db/customer_name_en_20261119.sql). */
  name_en: string | null
}

// 부모는 몇 백 행뿐이라 한 번 읽어 캐시하고 화면에서 걸러 쓴다(사무실 목록과 같은 방식).
let cache: Promise<ParentOption[]> | null = null

export function loadParents(): Promise<ParentOption[]> {
  if (cache) return cache
  cache = (async () => {
    const supabase = createClient()
    const COLS = 'customer_id, company_name, industry'
    const load = (cols: string) => supabase
      .from('customers')
      .select(cols)
      .eq('is_parent', true)
      .is('deleted_at', null)
      .order('company_name')

    // **영문명 칸이 아직 없는 DB** 에서도 목록은 떠야 한다 — lib/nameEn.ts 가 그 되돌이길이다.
    const { data, error } = await withNameEnFallback(useEn => load(colsWithNameEn(COLS, useEn)))
    if (error) {
      // 실패하면 캐시를 비워 다음 호출에서 다시 시도한다.
      console.error('[parents] load failed', error)
      cache = null
      return []
    }
    // select 문자열이 변수라 supabase 가 줄 모양을 추론하지 못한다 — 읽는 칸만 적어 둔 타입으로 받는다.
    type Row = { customer_id: number; company_name: string | null; industry: string | null; name_en?: string | null }
    return ((data ?? []) as unknown as Row[]).map(r => ({
      customer_id: r.customer_id, company_name: r.company_name ?? '', industry: r.industry ?? null,
      name_en: r.name_en ?? null,
    }))
  })()
  return cache
}

/**
 * 이 업체를 묶고 있는 회사(부모)의 이름. 부모가 없으면 null.
 * 견적서의 수신처처럼 "개별 업체가 아니라 회사 이름" 이어야 하는 자리에 쓴다.
 * 캐시(loadParents)는 활성 부모만 담으므로 여기서는 id 로 곧장 읽는다.
 */
export async function parentCompanyName(customerId: number): Promise<string | null> {
  const supabase = createClient()
  const { data: self } = await supabase
    .from('customers').select('parent_customer_id').eq('customer_id', customerId).maybeSingle()
  const parentId = self?.parent_customer_id ?? null
  if (parentId == null) return null
  const { data: parent } = await supabase
    .from('customers').select('company_name').eq('customer_id', parentId).maybeSingle()
  return parent?.company_name?.trim() || null
}

/** 소속회사를 새로 만들거나 지운 뒤 부른다. 다음 호출에서 다시 읽는다. */
export function invalidateParents(): void {
  cache = null
}

/**
 * 회사 행을 새로 만든다. 이름·분류만 있는 껍데기라 주소·좌표를 받지 않는다
 * (업체 등록 경로는 주소 지오코딩이 필수라 그대로 쓸 수 없다).
 *
 * **분류는 필수다** — 리드 등록의 산업군과 같은 목록이다(lib/leadOptions.ts). 회사를
 * 만드는 자리가 여기 하나뿐이라, 여기서 받지 않으면 분류 없는 회사가 계속 생긴다.
 */
export async function createParent(companyName: string, industry: string, nameEn?: string): Promise<ParentOption> {
  const supabase = createClient()
  const name = companyName.trim()
  if (!name) throw new Error('회사명을 입력해주세요')
  if (!INDUSTRIES.includes(industry)) throw new Error('분류를 선택해주세요')
  const { data, error } = await supabase
    .from('customers')
    .insert([{ company_name: name, is_parent: true, industry, name_en: (nameEn ?? '').trim() || null }])
    .select('customer_id, company_name, industry, name_en')
    .single()
  if (error || !data) throw error || new Error('회사를 만들지 못했습니다')
  invalidateParents()
  return {
    customer_id: data.customer_id, company_name: data.company_name ?? name,
    industry: data.industry ?? industry, name_en: data.name_en ?? null,
  }
}

const fieldStyle: CSSProperties = {
  width: '100%', padding: '11px 12px', border: '1px solid #ebebeb', borderRadius: 6,
  boxSizing: 'border-box', color: '#111827', background: '#fff', outline: 'none', fontSize: 14,
}
const ghostBtn: CSSProperties = {
  padding: '9px 12px', background: '#f3f4f6', border: 'none', borderRadius: 6,
  cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#6b7280', flexShrink: 0, whiteSpace: 'nowrap',
}

type Props = {
  /** 지금 고른 부모. 없으면 null */
  value: number | null
  onChange: (parentId: number | null) => void
  /** 목록에 없는 이름을 새 부모로 만들 수 있게 할지(업체 추가에서만 쓴다) */
  allowCreate?: boolean
  /** 저장 중 등으로 잠글 때 */
  disabled?: boolean
  /**
   * **회사를 고정한다** — 회사 카드의 「+ 사업장 추가」처럼 어느 회사에 붙일지가
   * 이미 정해진 자리에서 쓴다. 이름은 보이되 [해제] 를 내지 않는다.
   */
  locked?: boolean
  onError?: (message: string) => void
  /**
   * **부모가 없는 줄을 고칠 때** 칸에 미리 채워 두는 이름(그 줄의 company_name).
   *
   * 이관 전에 들어온 사업장 591곳은 회사 줄이 없어 이 칸이 빈칸으로 떴다. 적혀 있던
   * 이름을 그대로 보여 주고, 고르지 않고 저장하면 그 이름으로 회사를 찾거나 만든다
   * (hooks/customer/useCustomerCrud.ts). 주면 칸이 **바깥에서 조종**된다.
   */
  nameValue?: string
  onNameChange?: (name: string) => void
}

export default function ParentPicker({ value, onChange, allowCreate, disabled, locked, onError, nameValue, onNameChange }: Props) {
  const [parents, setParents] = useState<ParentOption[]>([])
  const [ownQuery, setOwnQuery] = useState('')
  // 바깥에서 이름을 주면 그 값이 칸의 내용이다(부모 없는 줄을 고치는 경우).
  const controlled = nameValue !== undefined
  const query = controlled ? nameValue : ownQuery
  const setQuery = useCallback(
    (v: string) => { if (controlled) onNameChange?.(v); else setOwnQuery(v) },
    [controlled, onNameChange],
  )
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  /** 「새 회사로 등록」을 누른 뒤의 칸 — 분류를 고르기 전에는 만들지 않는다. */
  const [newName, setNewName] = useState<string | null>(null)
  const [newIndustry, setNewIndustry] = useState('')
  /** 영문 회사명 — 선택 입력이다(없으면 비워 둔다). */
  const [newNameEn, setNewNameEn] = useState('')
  const anchorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    loadParents().then(list => { if (!cancelled) setParents(list) })
    return () => { cancelled = true }
  }, [])

  const picked = useMemo(() => parents.find(p => p.customer_id === value) ?? null, [parents, value])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return parents.slice(0, 8)
    return parents.filter(p => p.company_name.toLowerCase().includes(q)).slice(0, 8)
  }, [parents, query])

  // 이름이 똑같은 부모가 이미 있으면 "새로 만들기" 를 내지 않는다(중복 생성 방지).
  const exact = useMemo(
    () => parents.some(p => p.company_name.trim() === query.trim()),
    [parents, query],
  )
  const canCreate = !!allowCreate && !!query.trim() && !exact

  const create = useCallback(async (name: string, industry: string, nameEn: string) => {
    setCreating(true)
    try {
      const made = await createParent(name, industry, nameEn)
      setParents(await loadParents())
      onChange(made.customer_id)
      setQuery(''); setOpen(false); setNewName(null); setNewIndustry(''); setNewNameEn('')
    } catch (e) {
      onError?.((e as Error).message || '회사를 만들지 못했습니다')
    } finally {
      setCreating(false)
    }
  }, [onChange, onError, setQuery])

  // 이미 고른 상태 — 이름(과 분류)과 해제 버튼만 보여준다.
  if (value != null) {
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ ...fieldStyle, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: '#f9fafb' }}>
          {picked ? picked.company_name : `회사 #${value}`}
          {picked?.industry ? <span style={{ fontSize: 12, color: '#9ca3af' }}>{`  ${picked.industry}`}</span> : null}
        </div>
        {!locked && (
          <button type="button" disabled={disabled} onClick={() => { onChange(null); setQuery('') }} style={ghostBtn}>해제</button>
        )}
      </div>
    )
  }

  // 「새 회사로 등록」을 누른 뒤 — 분류를 고르기 전에는 만들지 않는다.
  if (newName != null) {
    return (
      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ ...fieldStyle, background: '#f9fafb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {newName}
        </div>
        {/* 영문 회사명 — 선택 입력. 「HYUNDAI TRANSYS」처럼 고객이 영문으로 부르는 이름을
            적어 두면 검색에서 함께 찾힌다. */}
        <input
          value={newNameEn}
          disabled={creating}
          onChange={e => setNewNameEn(e.target.value)}
          placeholder="영문 회사명 (선택)"
          style={fieldStyle}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={newIndustry}
            disabled={creating}
            onChange={e => setNewIndustry(e.target.value)}
            style={{ ...fieldStyle, flex: 1, minWidth: 0, cursor: 'pointer' }}
          >
            <option value="">분류 선택 (필수)</option>
            {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
          <button type="button" disabled={creating || !newIndustry}
            onClick={() => void create(newName, newIndustry, newNameEn)}
            style={{ ...ghostBtn, background: newIndustry ? '#234ea2' : '#f3f4f6', color: newIndustry ? '#fff' : '#9ca3af', cursor: newIndustry ? 'pointer' : 'not-allowed' }}>
            {creating ? '등록 중...' : '등록'}
          </button>
          <button type="button" disabled={creating}
            onClick={() => { setNewName(null); setNewIndustry(''); setNewNameEn('') }} style={ghostBtn}>취소</button>
        </div>
      </div>
    )
  }

  return (
    <div ref={anchorRef}>
      <input
        value={query}
        disabled={disabled || creating}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder="ex) (주)현대자동차"
        style={fieldStyle}
      />
      {/* 모달 안에서 열려도 잘리지 않도록 포털로 띄운다 */}
      <Popover
        anchorRef={anchorRef}
        open={open && (matches.length > 0 || canCreate)}
        onClose={() => setOpen(false)}
        matchAnchorWidth
        maxHeight={240}
        style={{ background: '#fff', border: '1px solid #ebebeb', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
      >
        {matches.map(p => (
          <div key={p.customer_id}
            onMouseDown={e => { e.preventDefault(); onChange(p.customer_id); setQuery(''); setOpen(false) }}
            style={{ padding: '8px 11px', cursor: 'pointer', fontSize: 13, color: '#111827' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#f5f5f5' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            {p.company_name}
            {/* 회사 줄에는 주소가 없다(껍데기 행이다) — 같은 이름을 가려 주는 것은 분류다. */}
            {p.industry ? <span style={{ fontSize: 12, color: '#9ca3af' }}>{`  — ${p.industry}`}</span> : null}
          </div>
        ))}
        {canCreate && (
          <div
            onMouseDown={e => { e.preventDefault(); setNewName(query.trim()); setOpen(false) }}
            style={{ padding: '8px 11px', cursor: 'pointer', fontSize: 13, color: '#234ea2', fontWeight: 700, borderTop: matches.length ? '1px solid #ebebeb' : undefined }}
            onMouseEnter={e => { e.currentTarget.style.background = '#f5f5f5' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            {`「${query.trim()}」 새 회사로 등록`}
          </div>
        )}
      </Popover>
    </div>
  )
}
