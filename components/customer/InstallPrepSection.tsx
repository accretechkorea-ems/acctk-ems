'use client'

// 신규 설치 준비 체크리스트 — 서비스 수정 모달 안 구역.
//
// 신규설치이면서 방문일이 아직 오지 않은 건에만 나온다(방문일이 지나면 읽기 전용으로 남는다 —
// 당일 현장에서 「화물 누가 확인했더라」를 보는 것이 이 기록의 쓸모라 감추면 손해다).
//
// 저장은 모달의 [저장] 과 무관하게 즉시 반영된다 — 첨부파일(ServiceAttachmentEditor)과 같은 방식이다.
// 쓰기는 /api/install-prep(service role)만 한다. 「협의완료로 바꾼 사람」은 서버가 세션에서 박으므로
// 이 화면에는 사람을 고르는 칸이 없다 — 누른 사람이 곧 담당자다(대리 입력 없음, 책임 소재).
//
// 색·모양은 옆의 「방문 엔지니어」 박스와 같은 값을 쓴다. 색은 dot 에만 준다(디자인 규칙).

import { useEffect, useState, type CSSProperties } from 'react'
import { useToast } from '@/components/common/Toast'
import {
  PREP_DONE, PREP_ITEMS, PREP_PENDING, prepSummary, type PrepItem,
} from '@/lib/installPrep'
import type { InstallPrep } from './types'

const BORDER = '#ebebeb'
const TEXT = '#111827'
const SUB = '#6b7280'
const MUTED = '#9ca3af'
const FAINT = '#d1d5db'
const BOX_BG = '#f8f9fb'
/** 상태 dot — 완료는 활성 초록, 미확인은 가장 흐린 회색. 글자는 중립으로 둔다. */
const DONE_DOT = '#16a34a'

const boxStyle: CSSProperties = {
  border: `1px solid ${BORDER}`, borderRadius: 8, padding: 14, background: BOX_BG,
}
/** 모바일에서 iOS 자동 확대가 걸리지 않게 입력 글자는 16 으로 둔다(이 모달의 다른 칸과 같다). */
const inputStyle: CSSProperties = {
  width: '100%', height: 40, padding: '0 10px', border: `1px solid ${BORDER}`, borderRadius: 6,
  boxSizing: 'border-box', color: TEXT, background: '#fff', outline: 'none', fontSize: 16,
}
const cellStyle: CSSProperties = {
  border: `1px solid ${BORDER}`, borderRadius: 6, background: '#fff', padding: 10,
  display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0,
}
const btnStyle = (busy: boolean): CSSProperties => ({
  padding: '7px 12px', borderRadius: 6, border: 'none', background: '#f3f4f6',
  color: busy ? MUTED : SUB, fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
  cursor: busy ? 'not-allowed' : 'pointer', alignSelf: 'flex-start',
})

const CSS = `
  .ip-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  @media (max-width: 560px) { .ip-grid { grid-template-columns: minmax(0, 1fr); } }
`

/** 'HH:MM:SS' 로 오는 값을 입력칸이 받는 'HH:MM' 으로 자른다. */
const hhmm = (v: string | null): string => (v ? v.slice(0, 5) : '')

const dayText = (iso: string | null): string => {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}.${p(d.getDate())}`
}

/** 협의완료 칸에 접어서 보여줄 한 줄 — 항목이 받은 값만 모은다. */
function valueLine(item: PrepItem, row: InstallPrep | undefined): string {
  if (!row) return ''
  const parts = item.fields === 'vendor'
    ? [row.vendor, row.contact, hhmm(row.planned_at) && `${hhmm(row.planned_at)} ${item.timeLabel?.replace(' 예정시각', '') ?? ''}`.trim()]
    : [row.counterpart]
  return [...parts, row.note].filter(Boolean).join(' · ')
}

type Draft = { vendor: string; contact: string; plannedAt: string; counterpart: string; note: string }

const draftOf = (row: InstallPrep | undefined): Draft => ({
  vendor: row?.vendor ?? '',
  contact: row?.contact ?? '',
  plannedAt: hhmm(row?.planned_at ?? null),
  counterpart: row?.counterpart ?? '',
  note: row?.note ?? '',
})

export default function InstallPrepSection({
  serviceId, readOnly = false,
}: {
  serviceId: number
  /** 방문일이 지난 건 — 값만 보여주고 바꾸지 못하게 한다. */
  readOnly?: boolean
}) {
  const toast = useToast()
  const [rows, setRows] = useState<InstallPrep[] | null>(null)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [busyKey, setBusyKey] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const res = await fetch(`/api/install-prep?serviceId=${serviceId}`)
        const json = await res.json().catch(() => null)
        if (cancelled) return
        if (!res.ok) { console.error('[install-prep] load failed', json); setRows([]); return }
        const items = (json?.items ?? []) as InstallPrep[]
        setRows(items)
        setDrafts(Object.fromEntries(PREP_ITEMS.map(i => [i.key, draftOf(items.find(r => r.item_key === i.key))])))
      } catch (e) {
        if (cancelled) return
        console.error('[install-prep] load failed', e)
        setRows([])
      }
    }
    run()
    return () => { cancelled = true }
  }, [serviceId])

  const save = async (item: PrepItem, status: string) => {
    const d = drafts[item.key] ?? draftOf(undefined)
    setBusyKey(item.key)
    try {
      const res = await fetch('/api/install-prep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId, itemKey: item.key, status,
          vendor: d.vendor, contact: d.contact, plannedAt: d.plannedAt,
          counterpart: d.counterpart, note: d.note,
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) { toast.error(json?.error ?? '저장하지 못했습니다'); return }
      const saved = json.item as InstallPrep
      setRows(prev => [...(prev ?? []).filter(r => r.item_key !== item.key), saved])
      setDrafts(prev => ({ ...prev, [item.key]: draftOf(saved) }))
      toast.success(status === PREP_DONE ? `${item.label} 협의완료로 표시했습니다` : `${item.label}을(를) 미확인으로 되돌렸습니다`)
    } catch (e) {
      console.error('[install-prep] save failed', e)
      toast.error('저장하지 못했습니다')
    } finally {
      setBusyKey(null)
    }
  }

  const byKey = new Map((rows ?? []).map(r => [r.item_key, r]))
  const summary = prepSummary(rows)

  const field = (item: PrepItem, key: keyof Draft, placeholder: string, type = 'text') => (
    <input
      type={type}
      value={drafts[item.key]?.[key] ?? ''}
      onChange={e => setDrafts(prev => ({ ...prev, [item.key]: { ...(prev[item.key] ?? draftOf(undefined)), [key]: e.target.value } }))}
      placeholder={placeholder}
      style={type === 'time' ? { ...inputStyle, colorScheme: 'light' } : inputStyle}
    />
  )

  return (
    <div style={boxStyle}>
      <style>{CSS}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: SUB }}>설치 준비</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: SUB, background: '#f3f4f6', borderRadius: 99, padding: '2px 8px' }}>
          {rows === null ? '...' : `${summary.done}/${summary.total}`}
        </span>
        {readOnly && <span style={{ fontSize: 11, color: MUTED }}>방문일이 지나 기록만 남습니다</span>}
      </div>

      {rows === null ? (
        <div style={{ fontSize: 12, color: MUTED }}>불러오는 중...</div>
      ) : (
        <div className="ip-grid">
          {PREP_ITEMS.map(item => {
            const row = byKey.get(item.key)
            const done = row?.status === PREP_DONE
            const busy = busyKey === item.key
            const who = row?.engineers ? `${row.engineers.name} ${row.engineers.position ?? ''}`.trim() : ''
            return (
              <div key={item.key} style={cellStyle}>
                {/* 머리 — dot 으로만 상태를 낸다 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: done ? DONE_DOT : FAINT }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.label}
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: SUB, flexShrink: 0 }}>
                    {done ? PREP_DONE : PREP_PENDING}
                  </span>
                </div>

                {done ? (
                  // 협의완료 — 접어서 결과만 보여준다
                  <>
                    {valueLine(item, row) && (
                      <div style={{ fontSize: 12, color: TEXT, wordBreak: 'break-word' }}>{valueLine(item, row)}</div>
                    )}
                    <div style={{ fontSize: 11, color: MUTED }}>
                      {[who, dayText(row?.done_at ?? null)].filter(Boolean).join(' · ') || '기록 없음'}
                    </div>
                    {!readOnly && (
                      <button type="button" onClick={() => save(item, PREP_PENDING)} disabled={busy} style={btnStyle(busy)}>
                        {busy ? '처리 중...' : '되돌리기'}
                      </button>
                    )}
                  </>
                ) : readOnly ? (
                  <div style={{ fontSize: 12, color: MUTED }}>확인되지 않은 채 방문일이 지났습니다</div>
                ) : (
                  // 미확인 — 펼쳐서 입력칸을 보여준다
                  <>
                    {item.fields === 'vendor' ? (
                      <>
                        {field(item, 'vendor', '업체명')}
                        {field(item, 'contact', '기사 연락처')}
                        {field(item, 'plannedAt', item.timeLabel ?? '예정시각', 'time')}
                      </>
                    ) : (
                      field(item, 'counterpart', '협의 상대')
                    )}
                    {field(item, 'note', '메모 (선택)')}
                    <button type="button" onClick={() => save(item, PREP_DONE)} disabled={busy} style={btnStyle(busy)}>
                      {busy ? '처리 중...' : '협의완료로 표시'}
                    </button>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
