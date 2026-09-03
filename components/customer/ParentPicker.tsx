'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createClient } from '@/lib/supabase/client'
import Popover from '@/components/common/Popover'

/**
 * 상위 업체(부모) 선택 칸.
 *
 * 같은 회사가 사업장·라인 단위로 여러 행에 나뉘어 있어, 그것을 묶는 껍데기 행을 부모로 둔다.
 * 부모는 주소·좌표·장비가 없고 `is_parent = true` 로만 구분한다.
 *
 * 후보를 `is_parent = true` 로만 한정하는 것이 곧 순환 방지다 —
 * 자식은 후보에 뜨지 않으므로 자기 자신이나 자손을 부모로 고를 수 없다.
 *
 * 업체 추가·수정 두 모달이 같은 규칙을 쓰도록 한곳에 둔다.
 */

export type ParentOption = { customer_id: number; company_name: string }

// 부모는 몇 백 행뿐이라 한 번 읽어 캐시하고 화면에서 걸러 쓴다(사무실 목록과 같은 방식).
let cache: Promise<ParentOption[]> | null = null

export function loadParents(): Promise<ParentOption[]> {
  if (cache) return cache
  cache = (async () => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('customers')
      .select('customer_id, company_name')
      .eq('is_parent', true)
      .is('deleted_at', null)
      .order('company_name')
    if (error) {
      // 실패하면 캐시를 비워 다음 호출에서 다시 시도한다.
      console.error('[parents] load failed', error)
      cache = null
      return []
    }
    return (data ?? []).map(r => ({ customer_id: r.customer_id, company_name: r.company_name ?? '' }))
  })()
  return cache
}

/** 부모를 새로 만들거나 지운 뒤 부른다. 다음 호출에서 다시 읽는다. */
export function invalidateParents(): void {
  cache = null
}

/**
 * 부모 행을 새로 만든다. 이름과 표시만 있는 껍데기라 주소·좌표를 받지 않는다
 * (업체 등록 경로는 주소 지오코딩이 필수라 그대로 쓸 수 없다).
 */
export async function createParent(companyName: string): Promise<ParentOption> {
  const supabase = createClient()
  const name = companyName.trim()
  if (!name) throw new Error('상위 업체명을 입력해주세요')
  const { data, error } = await supabase
    .from('customers')
    .insert([{ company_name: name, is_parent: true }])
    .select('customer_id, company_name')
    .single()
  if (error || !data) throw error || new Error('상위 업체를 만들지 못했습니다')
  invalidateParents()
  return { customer_id: data.customer_id, company_name: data.company_name ?? name }
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
  onError?: (message: string) => void
}

export default function ParentPicker({ value, onChange, allowCreate, disabled, onError }: Props) {
  const [parents, setParents] = useState<ParentOption[]>([])
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
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

  const create = useCallback(async () => {
    setCreating(true)
    try {
      const made = await createParent(query)
      setParents(await loadParents())
      onChange(made.customer_id)
      setQuery(''); setOpen(false)
    } catch (e) {
      onError?.((e as Error).message || '상위 업체를 만들지 못했습니다')
    } finally {
      setCreating(false)
    }
  }, [query, onChange, onError])

  // 이미 고른 상태 — 이름과 해제 버튼만 보여준다.
  if (value != null) {
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ ...fieldStyle, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: '#f9fafb' }}>
          {picked ? picked.company_name : `상위 업체 #${value}`}
        </div>
        <button type="button" disabled={disabled} onClick={() => { onChange(null); setQuery('') }} style={ghostBtn}>해제</button>
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
        placeholder="상위 업체 검색 (선택)"
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
          </div>
        ))}
        {canCreate && (
          <div
            onMouseDown={e => { e.preventDefault(); create() }}
            style={{ padding: '8px 11px', cursor: 'pointer', fontSize: 13, color: '#234ea2', fontWeight: 700, borderTop: matches.length ? '1px solid #ebebeb' : undefined }}
            onMouseEnter={e => { e.currentTarget.style.background = '#f5f5f5' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            {creating ? '만드는 중...' : `「${query.trim()}」 새 상위 업체로 만들기`}
          </div>
        )}
      </Popover>
    </div>
  )
}
