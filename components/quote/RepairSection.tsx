'use client'

// 견적 작성 화면의 **「수리 건」 섹션** — 연결 + 수리 정보 입력.
//
// ── 언제 펼치나 ─────────────────────────────────────────────────────────────
//   수리 목록에서 넘어온 견적(?repair_id)이나 이미 고른 건이 있으면 **펼쳐 둔다** —
//   그 견적은 수리 정보를 적는 것이 일의 절반이다. 일반 견적에서는 접어 두고 단추 하나만
//   둔다(열에 아홉은 수리와 무관한 견적이라, 펼쳐 두면 빈 칸 셋이 화면을 먹는다).
//
// ── 연결은 확정할 때 적힌다 ─────────────────────────────────────────────────
//   「이 견적이 어느 수리 건인가」는 repairs.quote_id 한 곳에만 있다. 그 칸은 견적이
//   저장돼 quote_id 가 생긴 뒤에야 쓸 수 있으므로, 여기서 고른 값은 화면이 들고 있다가
//   (page.tsx 의 repairLinkId — 임시저장에도 담긴다) 확정할 때 함께 적는다.

import { useEffect, useState } from 'react'
import RepairInfoPanel from '@/components/quote/RepairInfoPanel'
import {
  repairDate, searchRepairs, shippedLabel,
  type RepairBrief, type RepairInfoFields,
} from '@/lib/quoteRepairInfo'
import { Z } from '@/lib/zIndex'

const BORDER = '#ebebeb'
const MUTED = '#9ca3af'
const BLUE = '#234ea2'

export type RepairSectionProps = {
  repairId: number | null
  setRepairId: (v: number | null) => void
  repair: RepairBrief | null
  info: RepairInfoFields
  setInfo: (v: RepairInfoFields) => void
  /** 지금 고른 고객사 이름 — 같은 회사 수리 건을 목록 앞으로 올리는 데 쓴다. */
  customerName: string
  /** 주소(?repair_id)로 들어왔는가 — 그러면 연결을 바꾸는 단추를 내지 않는다. */
  fromUrl: boolean
}

export default function RepairSection({
  repairId, setRepairId, repair, info, setInfo, customerName, fromUrl,
}: RepairSectionProps) {
  // 수리 건이 걸려 있으면 펼친 채로 시작한다.
  const [open, setOpen] = useState(repairId != null)
  const [picking, setPicking] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<RepairBrief[]>([])
  const [searching, setSearching] = useState(false)
  // 수리 건이 **새로 걸리면** 펼친다(주소로 들어온 경우가 그렇다).
  // ref 가 아니라 상태로 견준다 — 렌더 중에 ref 를 읽는 것은 react-hooks/refs 가 막는다
  // (그 규칙의 뜻 그대로, 렌더는 ref 를 몰라야 한다).
  const [prevId, setPrevId] = useState(repairId)
  if (prevId !== repairId) {
    setPrevId(repairId)
    if (repairId != null && !open) setOpen(true)
  }

  // 고르기 창을 열면 그 회사 건부터 보여 준다(글자를 치기 전에도).
  useEffect(() => {
    if (!picking) return
    let alive = true
    // 글자를 칠 때마다 묻지 않는다 — 150ms 쉬었다 한 번만 간다(effect 안에서 바로 상태를
    // 바꾸지 않는 꼴이기도 하다 — react-hooks/set-state-in-effect).
    const timer = setTimeout(() => {
      setSearching(true)
      searchRepairs(keyword, customerName.trim() || null).then(rows => {
        if (!alive) return
        setResults(rows)
        setSearching(false)
      })
    }, 150)
    return () => { alive = false; clearTimeout(timer) }
  }, [picking, keyword, customerName])

  return (
    <div style={{ background: '#fff', borderRadius: 8, padding: '14px 20px', border: `1px solid ${BORDER}`, marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 3, height: 16, background: BLUE, borderRadius: 6, flexShrink: 0 }} />
        <span style={{ fontWeight: 800, fontSize: 14, color: '#111827' }}>수리 건</span>
        {repair
          ? <span style={{ fontSize: 12, color: MUTED }}>
              #{repair.repair_id} · {(repair.customer_name ?? '').trim() || '-'} · {(repair.product_type ?? '').trim() || '-'}
            </span>
          : <span style={{ fontSize: 12, color: MUTED }}>연결된 수리 건이 없습니다</span>}
        <span style={{ flex: 1 }} />
        {/* 주소로 들어온 건은 연결을 바꾸지 않는다 — 그 수리 건의 견적서를 쓰러 온 길이다. */}
        {!fromUrl && (
          <button
            onClick={() => { setPicking(v => !v); setOpen(true) }}
            style={{ height: 28, padding: '0 10px', borderRadius: 6, border: `1px solid ${BORDER}`, background: '#fff', color: BLUE, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
          >
            {repairId == null ? '수리 건으로 연결' : '연결 바꾸기'}
          </button>
        )}
        {!fromUrl && repairId != null && (
          <button
            onClick={() => { setRepairId(null); setPicking(false) }}
            title="연결 해제"
            style={{ height: 28, padding: '0 8px', borderRadius: 6, border: `1px solid ${BORDER}`, background: '#fff', color: MUTED, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          >
            해제
          </button>
        )}
        <button
          onClick={() => setOpen(v => !v)}
          title={open ? '접기' : '펼치기'}
          style={{ width: 24, height: 24, padding: 0, background: 'none', border: 'none', cursor: 'pointer', color: MUTED, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>

      {/* 고르기 — 회사명·시리얼·제품 구분으로 찾는다. 같은 고객사 건이 앞에 선다. */}
      {picking && (
        <div style={{ marginTop: 10, border: `1px solid ${BORDER}`, borderRadius: 6, overflow: 'hidden' }}>
          <input
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            placeholder="회사명 · 시리얼번호 · 제품 구분으로 찾기"
            autoFocus
            style={{ width: '100%', boxSizing: 'border-box', border: 'none', borderBottom: `1px solid ${BORDER}`, padding: '8px 10px', fontSize: 12, outline: 'none', fontFamily: 'inherit' }}
          />
          <div style={{ maxHeight: 220, overflowY: 'auto', zIndex: Z.inPage }}>
            {searching && <div style={{ padding: '8px 10px', fontSize: 11, color: MUTED }}>찾는 중…</div>}
            {!searching && results.length === 0 && <div style={{ padding: '8px 10px', fontSize: 11, color: MUTED }}>맞는 수리 건이 없습니다</div>}
            {results.map(r => (
              <button
                key={r.repair_id}
                onClick={() => { setRepairId(r.repair_id); setPicking(false); setKeyword('') }}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px', border: 'none', borderBottom: `1px solid ${BORDER}`, background: r.repair_id === repairId ? '#f0f4ff' : '#fff', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                <div style={{ fontSize: 12, color: '#111827', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {(r.customer_name ?? '').trim() || '-'}
                  <span style={{ color: '#d1d5db' }}> · </span>
                  {(r.product_type ?? '').trim() || '-'}
                  {(r.serial_number ?? '').trim() && <span style={{ color: MUTED }}> ({r.serial_number})</span>}
                </div>
                <div style={{ fontSize: 11, color: MUTED, marginTop: 1 }}>
                  #{r.repair_id} · {(r.item_type ?? '').trim() || '-'} · 입고 {repairDate(r.received_date)} · 출고 {shippedLabel(r.shipped_date)}
                  {r.quote_id != null && <span style={{ color: '#d97706' }}> · 이미 다른 견적에 연결됨</span>}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {open && (
        <div style={{ marginTop: 12 }}>
          {repairId == null
            ? <div style={{ fontSize: 12, color: MUTED }}>수리 건을 연결하면 고장 증상·원인·처리 결과를 적을 수 있습니다.</div>
            : <RepairInfoPanel repair={repair} value={info} onChange={setInfo} mode="draft" />}
        </div>
      )}
    </div>
  )
}
