'use client'

// 목록 보기의 **오른쪽 — 회사를 골랐을 때**. 회사 카드 + 사업장 표 + 일괄 작업 바.
//
// ── 표에서 바로 고치는 칸 ─────────────────────────────────────────────────
//   이번 회차는 **대리점·상태 둘**뿐이다. 두 칸 모두 기존 저장 경로를 그대로 쓴다
//   (customers 의 agency_customer_id·status 를 한 줄씩 update). 이름·주소처럼 다른 것을
//   함께 건드려야 하는 칸은 여기서 고치지 않는다 — 그것은 수정 폼의 일이다.
//
// ── 회사 분류 ─────────────────────────────────────────────────────────────
//   정리 SQL 이 만든 회사 561곳에는 분류가 비어 있다(2026-11-19 실측: 763곳 중 거의 전부).
//   그래서 카드에서 **바로 고르고 저장**한다 — 관리 화면까지 가지 않게.

import { useEffect, useState, type CSSProperties } from 'react'
import { createClient } from '@/lib/supabase/client'
import { INDUSTRIES } from '@/lib/leadOptions'
import { invalidateParents } from '@/components/customer/ParentPicker'
import { DIRECT_SALE_LABEL, useAgencies } from '@/lib/customerAgency'
import { daysLabel, isStale, regionOf, type CompanyGroup, type SiteRow } from '@/lib/customerList'

const BORDER = '#ebebeb'
const TEXT = '#111827'
const SUB = '#6b7280'
const MUTED = '#9ca3af'
const FAINT = '#d1d5db'
const BLUE = '#234ea2'
const NEUTRAL = '#f3f4f6'
const DANGER = '#ef4444'

const STATUS_DOT: Record<string, string> = { '활성': '#16a34a', '잠재': '#f59e0b', '이탈': '#ef4444' }
const STATUSES = ['활성', '잠재', '이탈']

const card: CSSProperties = { background: '#ffffff', border: `1px solid ${BORDER}`, borderRadius: 8 }
const btn: CSSProperties = {
  height: 30, padding: '0 11px', borderRadius: 6, border: `1px solid ${BORDER}`,
  background: '#ffffff', color: TEXT, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
}
const th: CSSProperties = {
  fontSize: 11, fontWeight: 700, color: SUB, textAlign: 'left', height: 36, padding: '0 10px',
  borderBottom: `1px solid ${BORDER}`, background: '#fafafa', whiteSpace: 'nowrap',
}
const td: CSSProperties = { height: 42, padding: '0 10px', borderBottom: `1px solid ${BORDER}`, whiteSpace: 'nowrap', fontSize: 12, color: TEXT }

export type CompanyPaneProps = {
  group: CompanyGroup
  /** 작성자 id → 이름. 「최근 활동 · 작성자」 칸이 쓴다. */
  engineerName: (id: number | null | undefined) => string
  /** 저장이 끝나면 부른다 — 화면이 목록을 다시 읽는다. */
  onSaved: () => void
  onError: (message: string) => void
  onToast: (message: string) => void
  /** 사업장 줄을 눌렀을 때(상세로). */
  onOpenSite: (siteId: number) => void
  /** 「+ 사업장 추가」 — 이 회사로 고정된 등록 폼을 연다. */
  onAddSite: () => void
}

export default function CompanyPane({
  group, engineerName, onSaved, onError, onToast, onOpenSite, onAddSite,
}: CompanyPaneProps) {
  const supabase = createClient()
  const agencies = useAgencies()
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  /** 지금 고치고 있는 칸 — `${customerId}:${열}`. 한 번에 한 칸만 연다. */
  const [editing, setEditing] = useState<string | null>(null)
  const [industry, setIndustry] = useState(group.industry ?? '')
  const [savingIndustry, setSavingIndustry] = useState(false)

  // 회사를 바꿔 고르면 선택·편집 상태를 턴다(앞 회사의 선택이 남으면 엉뚱한 줄을 고친다).
  useEffect(() => {
    setChecked(new Set())
    setEditing(null)
    setIndustry(group.industry ?? '')
  }, [group.companyId, group.industry])

  const toggle = (id: number) => {
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** 사업장 한 줄(또는 고른 여러 줄)의 칸 하나를 고친다. */
  const saveCell = async (ids: number[], patch: Record<string, unknown>, done: string) => {
    if (busy || ids.length === 0) return
    setBusy(true)
    const { error } = await supabase.from('customers').update(patch).in('customer_id', ids)
    setBusy(false)
    setEditing(null)
    if (error) { onError(error.message || '저장하지 못했습니다'); return }
    onToast(done)
    onSaved()
  }

  const saveIndustry = async (next: string) => {
    if (!next || next === group.industry) return
    setSavingIndustry(true)
    const { error } = await supabase.from('customers').update({ industry: next }).eq('customer_id', group.companyId)
    setSavingIndustry(false)
    if (error) { onError(error.message || '분류를 저장하지 못했습니다'); return }
    invalidateParents()   // 회사 목록 캐시가 옛 분류를 들고 있다
    onToast(`${group.companyName} 분류를 「${next}」로 바꿨습니다`)
    onSaved()
  }

  const selected = [...checked]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>

      {/* ── 회사 카드 ── */}
      <section style={{ ...card, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 200 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: TEXT, letterSpacing: '-0.5px' }}>{group.companyName}</h1>
            {/* 분류 — 비어 있는 회사가 많아 여기서 바로 고른다. */}
            <select
              value={industry}
              disabled={savingIndustry}
              onChange={e => { setIndustry(e.target.value); void saveIndustry(e.target.value) }}
              aria-label="회사 분류"
              style={{
                height: 26, padding: '0 6px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                border: `1px solid ${group.industry ? BORDER : '#fcd34d'}`,
                background: group.industry ? NEUTRAL : '#fffbeb',
                color: group.industry ? SUB : '#b45309',
                outline: 'none',
              }}
            >
              <option value="">분류 없음</option>
              {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>
          <div style={{ fontSize: 11, color: MUTED }}>
            담당자는 업체가 아니라 건(리드·견적·수리)에 붙습니다
          </div>
        </div>

        <div style={{ display: 'flex', gap: 22 }}>
          {([
            ['사업장', String(group.sites.length), TEXT],
            ['장비', String(group.deviceCount), TEXT],
            ['진행 견적', String(group.openQuotes), group.openQuotes > 0 ? BLUE : TEXT],
            ['최근 활동', group.touch ? group.touch.date : '-', TEXT],
          ] as const).map(([label, value, color]) => (
            <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <b style={{ fontSize: 17, fontWeight: 700, color, letterSpacing: '-0.3px' }}>{value}</b>
              <span style={{ fontSize: 11, color: MUTED }}>
                {label}
                {label === '최근 활동' && group.touch
                  ? ` (${group.touch.source}${engineerName(group.touch.actorId) ? ` · ${engineerName(group.touch.actorId)}` : ''})`
                  : ''}
              </span>
            </div>
          ))}
        </div>

        <span style={{ flex: 1 }} />
        <button type="button" onClick={onAddSite} style={btn}>+ 사업장 추가</button>
      </section>

      {/* ── 사업장 표 ── */}
      <section style={{ ...card, overflow: 'hidden', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderBottom: `1px solid ${BORDER}` }}>
          <b style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>사업장 {group.sites.length}곳</b>
          <span style={{ fontSize: 11, color: MUTED }}>대리점·상태는 칸을 눌러 바로 고칩니다</span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 760 }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 34 }}>
                  <input type="checkbox" aria-label="전체 선택"
                    checked={checked.size > 0 && checked.size === group.sites.length}
                    onChange={e => setChecked(e.target.checked ? new Set(group.sites.map(s => s.customer.customer_id)) : new Set())} />
                </th>
                <th style={th}>사업장명</th>
                <th style={th}>지역</th>
                <th style={th}>대리점</th>
                <th style={th}>상태</th>
                <th style={{ ...th, textAlign: 'right' }}>장비</th>
                <th style={th}>최근 활동 · 작성자</th>
                <th style={{ ...th, textAlign: 'right' }}>진행 견적</th>
                <th style={{ ...th, width: 52 }} />
              </tr>
            </thead>
            <tbody>
              {group.sites.map((s: SiteRow) => {
                const id = s.customer.customer_id
                const late = isStale(s.days)
                const on = checked.has(id)
                return (
                  <tr key={id} style={{ background: on ? '#f8fafc' : undefined }}>
                    <td style={td}>
                      <input type="checkbox" checked={on} onChange={() => toggle(id)} aria-label={`${s.siteName} 선택`} />
                    </td>
                    <td style={{ ...td, fontWeight: 600 }}>{s.siteName}</td>
                    <td style={{ ...td, color: SUB }}>{regionOf(s.customer) || '-'}</td>

                    {/* 대리점 — 눌러서 고른다 */}
                    <td style={td}>
                      {editing === `${id}:agency` ? (
                        <select autoFocus defaultValue={s.customer.agency_customer_id ?? ''}
                          disabled={busy}
                          onChange={e => void saveCell([id], { agency_customer_id: e.target.value ? Number(e.target.value) : null }, '대리점을 바꿨습니다')}
                          onBlur={() => setEditing(null)}
                          style={{ height: 26, borderRadius: 6, border: `1px solid ${BLUE}`, fontSize: 12, padding: '0 4px', outline: 'none' }}>
                          <option value="">{DIRECT_SALE_LABEL}</option>
                          {agencies.map(a => <option key={a.customer_id} value={a.customer_id}>{a.company_name}</option>)}
                        </select>
                      ) : (
                        <button type="button" onClick={() => setEditing(`${id}:agency`)}
                          style={{ border: '1px solid transparent', background: 'none', cursor: 'pointer', fontSize: 12, color: s.customer.agency_name ? TEXT : MUTED, padding: '3px 6px', borderRadius: 6, fontFamily: 'inherit' }}
                          onMouseEnter={e => { e.currentTarget.style.borderColor = BORDER; e.currentTarget.style.background = '#fff' }}
                          onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'none' }}>
                          {s.customer.agency_name ?? DIRECT_SALE_LABEL}
                        </button>
                      )}
                    </td>

                    {/* 상태 — 눌러서 고른다 */}
                    <td style={td}>
                      {editing === `${id}:status` ? (
                        <select autoFocus defaultValue={s.customer.status ?? ''}
                          disabled={busy}
                          onChange={e => void saveCell([id], { status: e.target.value }, '상태를 바꿨습니다')}
                          onBlur={() => setEditing(null)}
                          style={{ height: 26, borderRadius: 6, border: `1px solid ${BLUE}`, fontSize: 12, padding: '0 4px', outline: 'none' }}>
                          {STATUSES.map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                      ) : (
                        <button type="button" onClick={() => setEditing(`${id}:status`)}
                          style={{ border: '1px solid transparent', background: 'none', cursor: 'pointer', fontSize: 12, color: TEXT, padding: '3px 6px', borderRadius: 6, display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'inherit' }}
                          onMouseEnter={e => { e.currentTarget.style.borderColor = BORDER; e.currentTarget.style.background = '#fff' }}
                          onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'none' }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_DOT[s.customer.status ?? ''] ?? MUTED }} />
                          {s.customer.status ?? '-'}
                        </button>
                      )}
                    </td>

                    <td style={{ ...td, textAlign: 'right' }}>{s.deviceCount}</td>
                    <td style={{ ...td, color: late ? DANGER : SUB }}>
                      {s.touch ? (
                        <>
                          {s.touch.date}
                          <span style={{ color: late ? DANGER : MUTED }}>
                            {` (${daysLabel(s.days)} · ${s.touch.source}${engineerName(s.touch.actorId) ? ` · ${engineerName(s.touch.actorId)}` : ''})`}
                          </span>
                        </>
                      ) : <span style={{ color: FAINT }}>-</span>}
                    </td>
                    <td style={{ ...td, textAlign: 'right', color: s.openQuotes > 0 ? BLUE : TEXT, fontWeight: s.openQuotes > 0 ? 700 : 400 }}>{s.openQuotes}</td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <button type="button" onClick={() => onOpenSite(id)}
                        style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: BLUE, fontFamily: 'inherit', padding: 0 }}>
                        상세
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* ── 일괄 작업 바 — 고른 줄이 있을 때만 ── */}
        {selected.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', background: '#111827', color: '#fff', fontSize: 12, flexWrap: 'wrap' }}>
            <b style={{ fontWeight: 700 }}>{selected.length}곳 선택</b>
            <span style={{ width: 1, height: 16, background: '#374151', margin: '0 4px' }} />

            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: '#d1d5db' }}>대리점 변경</span>
              <select defaultValue="" disabled={busy}
                onChange={e => {
                  if (e.target.value === '') return
                  const v = e.target.value === 'none' ? null : Number(e.target.value)
                  void saveCell(selected, { agency_customer_id: v }, `${selected.length}곳의 대리점을 바꿨습니다`)
                  e.target.value = ''
                }}
                style={{ height: 26, borderRadius: 6, border: 'none', fontSize: 12, padding: '0 6px' }}>
                <option value="">고르기</option>
                <option value="none">{DIRECT_SALE_LABEL}</option>
                {agencies.map(a => <option key={a.customer_id} value={a.customer_id}>{a.company_name}</option>)}
              </select>
            </label>

            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: '#d1d5db' }}>상태 변경</span>
              <select defaultValue="" disabled={busy}
                onChange={e => {
                  if (e.target.value === '') return
                  void saveCell(selected, { status: e.target.value }, `${selected.length}곳의 상태를 바꿨습니다`)
                  e.target.value = ''
                }}
                style={{ height: 26, borderRadius: 6, border: 'none', fontSize: 12, padding: '0 6px' }}>
                <option value="">고르기</option>
                {STATUSES.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>

            {/* 「다른 회사로 이동」은 다음 회차다 — 옮기면 이름·회사 줄이 함께 바뀌어야 한다. */}
            <span style={{ flex: 1 }} />
            <button type="button" onClick={() => setChecked(new Set())}
              style={{ border: 'none', background: 'none', color: MUTED, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              선택 해제
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
