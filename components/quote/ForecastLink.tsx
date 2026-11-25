'use client'

/**
 * 견적 한 줄의 **포캐스트 연결/해제** (2026-11-26).
 *
 * 견적을 쓸 때 거는 것이 먼저지만(견적 작성 화면의 포캐스트 칸), 쓴 뒤에 생각나는 일이
 * 더 많다 — 「이 건, 그 딜이었지」. 그래서 **목록에서도** 걸고 풀 수 있게 한다.
 *
 * 고르는 후보는 **그 견적의 업체에 걸린 진행 중 포캐스트**다(종료된 건은 지금 걸려
 * 있을 때만 남긴다 — 고른 것을 화면에서 잃지 않게).
 *
 * 쓰기는 라우트가 한다(service role) — 포캐스트는 남의 것일 수 있어 브라우저로는
 * 못 고치고, 바꾼 뒤 **단계·금액 다시 셈**(lib/forecastSync.ts)까지 거기서 한다.
 */

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { customerChange } from '@/lib/customerChange'
import { useToast } from '@/components/common/Toast'
import ModalOverlay from '@/components/common/ModalOverlay'
import ModalCard from '@/components/common/ModalCard'
import SearchSelect from '@/components/common/SearchSelect'
import { isClosed } from '@/components/customer/opportunity'
import type { SalesOpportunity } from '@/components/customer/types'
import { BLUE, BORDER, CARD_BG, MUTED, SUB } from '@/components/common/ui'
import { R } from '@/lib/radius'

export type ForecastLinkProps = {
  quoteId: number
  /** 그 견적의 업체 — 후보를 읽는 열쇠. 없으면 단추를 내지 않는다. */
  customerId: number | null
  /** 지금 걸린 포캐스트 id(없으면 null). */
  opportunityId: number | null
  /** 머리에 적을 한 줄 — 「번호 · 회사」. */
  title: string
  /** 바꾼 뒤 목록을 다시 읽는다. */
  onChanged: () => void | Promise<unknown>
  /** 작게(목록 한 줄 안) 그릴까. */
  compact?: boolean
}

export default function ForecastLink({
  quoteId, customerId, opportunityId, title, onChanged, compact = true,
}: ForecastLinkProps) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<SalesOpportunity[]>([])
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)

  // 창을 열 때만 읽는다 — 목록 한 줄마다 미리 읽으면 조회가 줄 수만큼 늘어난다.
  useEffect(() => {
    if (!open || customerId == null) return
    const supabase = createClient()
    void supabase.from('sales_opportunities').select('*')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .then(({ data }) => setItems((data as SalesOpportunity[]) ?? []))
  }, [open, customerId])

  if (customerId == null) return null

  const picked = items.find(o => o.opportunity_id === opportunityId) ?? null
  const choices = items.filter(o => !isClosed(o) || o.opportunity_id === opportunityId)
    .filter(o => !query.trim() || `${o.stage} ${o.title}`.toLowerCase().includes(query.trim().toLowerCase()))

  const save = async (next: number | null) => {
    setBusy(true)
    const r = await customerChange({ action: 'quote-forecast-link', quoteId, opportunityId: next })
    setBusy(false)
    if (!r.ok) { toast.error(r.error); return }
    toast.success(next == null ? '포캐스트 연결을 풀었습니다' : '포캐스트에 연결했습니다')
    setOpen(false)
    setQuery('')
    await onChanged()
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title="포캐스트 연결/해제"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          height: compact ? 20 : 28, padding: compact ? '0 6px' : '0 10px',
          border: `1px solid ${BORDER}`, borderRadius: R.pill, background: CARD_BG,
          color: opportunityId == null ? MUTED : BLUE,
          fontSize: compact ? 10 : 12, fontWeight: 700, cursor: 'pointer',
          fontFamily: 'inherit', whiteSpace: 'nowrap', maxWidth: 180,
          overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
        {opportunityId == null ? '포캐스트 연결' : `포캐스트 · ${picked?.title ?? '연결됨'}`}
      </button>

      {open && (
        <ModalOverlay onClose={() => { if (!busy) { setOpen(false); setQuery('') } }} closeOn={busy ? 'none' : 'both'}>
          <ModalCard
            width={420}
            closeX
            title={<span style={{ fontSize: 15, fontWeight: 700 }}>포캐스트 연결</span>}
            footer={<>
              <span style={{ fontSize: 12, color: MUTED, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
              <span style={{ flex: 1 }} />
              {opportunityId != null && (
                <button type="button" disabled={busy} onClick={() => void save(null)}
                  style={{ height: 34, padding: '0 12px', borderRadius: R.control, border: `1px solid ${BORDER}`, background: CARD_BG, color: SUB, fontSize: 13, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
                  연결 해제
                </button>
              )}
            </>}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 12, color: SUB, lineHeight: 1.6 }}>
                이 업체의 **진행 중** 포캐스트에 겁니다. 걸면 그 포캐스트의 단계·금액이 연결 견적에 맞춰
                다시 셈해집니다(사람이 올려 둔 단계는 내려가지 않습니다).
              </div>
              <SearchSelect<SalesOpportunity>
                items={choices}
                itemKey={o => o.opportunity_id}
                renderItem={o => <span style={{ fontSize: 13 }}>{`${o.stage} · ${o.title}`}</span>}
                onSelect={o => void save(o.opportunity_id)}
                query={query}
                onQueryChange={setQuery}
                placeholder={picked ? `${picked.stage} · ${picked.title}` : '포캐스트 고르기'}
                openWhenEmpty
                autoFocus
                emptyText="이 업체에 진행 중인 포캐스트가 없습니다"
              />
            </div>
          </ModalCard>
        </ModalOverlay>
      )}
    </>
  )
}
