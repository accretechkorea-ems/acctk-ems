'use client'

// 공휴일 관리 (superadmin) — 가동률 탭 하단의 접힘 카드.
// 법정공휴일은 자동으로 채워지고, 여기서는 임시공휴일·선거일을 더하거나
// 회사가 정상 근무하는 날을 목록에서 뺀다. 바뀌면 onChanged 로 가동률을 다시 계산하게 한다.

import { useEffect, useRef, useState } from 'react'
import { weekdayOfDate } from '@/lib/showroom'
import {
  BLUE, BORDER, TEXT, MUTED, SUB, DANGER, FAINT, NEUTRAL_BG,
  cardStyle, countBadge, rowStyle, btnPrimary, inputStyle, skeletonBlock,
} from '@/components/common/ui'

const DOW = ['일', '월', '화', '수', '목', '금', '토']
/** 삭제는 두 번 눌러야 실행된다(요청함·사용 기록과 같은 방식). */
const CONFIRM_MS = 3000

type HolidayRow = { holiday_date: string; name: string; is_manual: boolean }

export default function HolidayManager({ year, onChanged }: { year: number; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<HolidayRow[]>([])
  const [reload, setReload] = useState(0)
  // 어느 요청의 목록을 들고 있는지. '불러오는 중'은 이것과 지금 키를 비교해 파생시킨다
  // (effect 안에서 곧바로 setState 하지 않기 위해서다).
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [date, setDate] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [rowError, setRowError] = useState<Record<string, string>>({})
  const [confirmDate, setConfirmDate] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const key = `${year}:${reload}`
  const loading = open && loadedKey !== key

  useEffect(() => {
    if (!open || loadedKey === key) return
    let cancelled = false
    fetch(`/api/showroom/holidays?year=${year}`)
      .then(async res => {
        const body = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) { setRows([]); setLoadError(body?.error || '공휴일 목록을 불러오지 못했습니다.') }
        else { setRows((body?.holidays ?? []) as HolidayRow[]); setLoadError(null) }
        setLoadedKey(key)
      })
      .catch(e => {
        if (cancelled) return
        console.error('[showroom] holiday list failed', e)
        setRows([])
        setLoadError('공휴일 목록을 불러오지 못했습니다.')
        setLoadedKey(key)
      })
    return () => { cancelled = true }
  }, [open, key, loadedKey, year])

  // 다른 곳을 클릭하면 삭제 확정 대기를 푼다. 버튼 자신의 클릭은 다음 틱부터 듣는다.
  useEffect(() => {
    if (confirmDate == null) return
    const off = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } setConfirmDate(null) }
    const id = setTimeout(() => document.addEventListener('click', off), 0)
    return () => { clearTimeout(id); document.removeEventListener('click', off) }
  }, [confirmDate])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const call = async (method: 'POST' | 'DELETE', body: unknown): Promise<string | null> => {
    try {
      const res = await fetch('/api/showroom/holidays', {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      return res.ok ? null : (data?.error || '처리에 실패했습니다.')
    } catch (e) {
      console.error('[showroom] holiday request failed', { method, error: e })
      return '처리 중 오류가 발생했습니다.'
    }
  }

  const add = async () => {
    if (!date || !name.trim()) return
    if (!date.startsWith(`${year}-`)) { setFormError(`${year}년 날짜만 추가할 수 있습니다.`); return }
    setBusy(true)
    setFormError(null)
    const message = await call('POST', { holiday_date: date, name: name.trim() })
    setBusy(false)
    if (message) { setFormError(message); return }
    setDate('')
    setName('')
    setReload(r => r + 1)
    onChanged()
  }

  const remove = async (d: string) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    setConfirmDate(null)
    setBusy(true)
    setRowError(prev => ({ ...prev, [d]: '' }))
    const message = await call('DELETE', { holiday_date: d })
    setBusy(false)
    if (message) { setRowError(prev => ({ ...prev, [d]: message })); return }
    setReload(r => r + 1)
    onChanged()
  }

  const arm = (d: string) => {
    if (timer.current) clearTimeout(timer.current)
    setConfirmDate(d)
    timer.current = setTimeout(() => { timer.current = null; setConfirmDate(null) }, CONFIRM_MS)
  }

  return (
    <div style={{ ...cardStyle, marginTop: 12 }}>
      {/* 접힘 헤더 */}
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: 0,
          background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
        }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>공휴일 관리</span>
        <span style={countBadge}>{year}년{open && !loading ? ` · ${rows.length}일` : ''}</span>
        <div style={{ flex: 1 }} />
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${BORDER}` }}>
          {/* 수동 추가 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input type="date" value={date} min={`${year}-01-01`} max={`${year}-12-31`}
              onChange={e => { setDate(e.target.value); setFormError(null) }} style={inputStyle} />
            <input value={name} onChange={e => { setName(e.target.value); setFormError(null) }}
              placeholder="이름 (예: 임시공휴일)" maxLength={50}
              onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) add() }}
              style={{ ...inputStyle, flex: '1 1 180px', minWidth: 0 }} />
            <button onClick={add} disabled={busy || !date || !name.trim()} style={btnPrimary(busy || !date || !name.trim())}>
              추가
            </button>
          </div>
          {formError && <div style={{ marginTop: 6, fontSize: 12, fontWeight: 600, color: DANGER }}>{formError}</div>}
          <div style={{ marginTop: 8, fontSize: 11, color: MUTED }}>
            법정공휴일은 자동 계산됩니다. 임시공휴일만 직접 추가하세요.
            회사가 정상 근무하는 날은 목록에서 지우면 평일로 계산됩니다.
          </div>

          {/* 목록 */}
          <div style={{ marginTop: 12 }}>
            {loading ? (
              [0, 1, 2].map(i => (
                <div key={i} style={{ ...rowStyle(i === 0), display: 'flex', gap: 10 }}>
                  <div style={skeletonBlock(90, 13)} /><div style={skeletonBlock(140, 13)} />
                </div>
              ))
            ) : loadError ? (
              <div style={{ padding: '16px 0', textAlign: 'center', fontSize: 13, fontWeight: 600, color: DANGER }}>{loadError}</div>
            ) : rows.length === 0 ? (
              <div style={{ padding: '16px 0', textAlign: 'center', fontSize: 13, color: SUB }}>
                등록된 공휴일이 없습니다. 가동률을 한 번 조회하면 법정공휴일이 채워집니다.
              </div>
            ) : (
              rows.map((h, i) => {
                const armed = confirmDate === h.holiday_date
                const dow = weekdayOfDate(h.holiday_date)
                return (
                  <div key={h.holiday_date} style={{ ...rowStyle(i === 0), padding: '9px 4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span className="num" style={{ fontSize: 13, color: TEXT, width: 96, flexShrink: 0 }}>{h.holiday_date}</span>
                      <span style={{ fontSize: 12, color: dow === 0 || dow === 6 ? FAINT : MUTED, width: 16, flexShrink: 0 }}>{DOW[dow]}</span>
                      <span style={{ fontSize: 13, color: TEXT, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.name}</span>
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 99, flexShrink: 0,
                        background: NEUTRAL_BG, color: h.is_manual ? BLUE : SUB,
                      }}>
                        {h.is_manual ? '수동' : '자동'}
                      </span>
                      {armed ? (
                        <button disabled={busy} onClick={() => remove(h.holiday_date)}
                          style={{ padding: '3px 9px', borderRadius: 6, border: 'none', background: DANGER, color: '#fff', fontSize: 11, fontWeight: 700, cursor: busy ? 'default' : 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                          삭제 확정
                        </button>
                      ) : (
                        <button title="삭제" disabled={busy} onClick={() => arm(h.holiday_date)}
                          onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                          onMouseLeave={e => (e.currentTarget.style.color = MUTED)}
                          style={{ background: 'none', border: 'none', padding: 2, cursor: 'pointer', color: MUTED, display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      )}
                    </div>
                    {rowError[h.holiday_date] && (
                      <div style={{ marginTop: 4, fontSize: 12, fontWeight: 600, color: DANGER }}>{rowError[h.holiday_date]}</div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
