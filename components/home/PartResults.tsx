'use client'

// 검색창 아래 '이 부품이 나간 업체' 결과 블록.
// 업체 목록·지도와 별개다 — 한 업체가 여러 번 나올 수 있고(살 때마다 한 줄),
// 지도에 찍을 것도 아니라서 CustomerList 에 섞지 않는다.
// 결과가 0건이면 블록 자체를 감춰, 평소(업체명 검색)에는 지금까지와 똑같이 보인다.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { SALES_STATUS_COLORS, getCategoryColor, salesStatusLabel } from '@/lib/categoryColors'
import type { PartHit } from '@/lib/partSearch'

const BORDER = '#ebebeb'

const numKR = (n: number) => Math.round(n).toLocaleString('ko-KR')

type Props = {
  rows: PartHit[]
  loading: boolean
  error: string | null
  searched: boolean
  deliveredOnly: boolean
  onToggleDelivered: (v: boolean) => void
  onOpenPdf: (pdfUrl: string | null, quoteNumber: string) => void
}

export default function PartResults({
  rows, loading, error, searched, deliveredOnly, onToggleDelivered, onOpenPdf,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(true)

  // 아직 검색 전이고 조회 중도 아니면 아무것도 그리지 않는다.
  if (!loading && !error && !searched) return null

  return (
    <div style={{ background: '#ffffff', border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px' }}>
        <button
          onClick={() => setOpen(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 0, background: 'none', border: 'none', cursor: 'pointer', minWidth: 0 }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease', flexShrink: 0 }}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#111827', whiteSpace: 'nowrap' }}>이 부품이 나간 업체</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', background: '#f3f4f6', borderRadius: 99, padding: '2px 8px' }}>
            {loading ? '...' : `${rows.length}건`}
          </span>
        </button>
        <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', flexShrink: 0 }}>
          <input type="checkbox" checked={deliveredOnly} onChange={e => onToggleDelivered(e.target.checked)}
            style={{ width: 13, height: 13, accentColor: '#234ea2', cursor: 'pointer' }} />
          <span style={{ fontSize: 11, color: '#6b7280', whiteSpace: 'nowrap' }}>납품된 것만</span>
        </label>
      </div>

      {open && (
        <div style={{ maxHeight: 260, overflowY: 'auto', borderTop: `1px solid ${BORDER}` }}>
          {loading ? (
            <div style={{ padding: '18px 0', textAlign: 'center', fontSize: 12, color: '#9ca3af' }}>찾는 중...</div>
          ) : error ? (
            <div style={{ padding: '18px 12px', textAlign: 'center', fontSize: 12, color: '#9ca3af' }}>
              부품 이력을 불러오지 못했습니다 ({error})
            </div>
          ) : rows.length === 0 ? (
            <div style={{ padding: '18px 12px', textAlign: 'center', fontSize: 12, color: '#9ca3af' }}>
              {deliveredOnly ? '납품된 이력이 없습니다 (체크를 풀면 견적만 낸 건도 봅니다)' : '이 품번으로 나간 견적이 없습니다'}
            </div>
          ) : (
            rows.map((r, i) => (
              <div
                key={r.itemId}
                onClick={() => { if (r.customerId != null) router.push(`/customer/${r.customerId}`) }}
                style={{
                  padding: '9px 12px',
                  borderTop: i === 0 ? 'none' : `1px solid ${BORDER}`,
                  cursor: r.customerId != null ? 'pointer' : 'default',
                  transition: 'background 0.15s ease',
                }}
                onMouseEnter={e => { if (r.customerId != null) e.currentTarget.style.background = '#fafafa' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 120, flexShrink: 0 }}>
                    {r.companyName}
                  </span>
                  {r.viaDealer && (
                    <span title={r.dealerName ?? undefined}
                      style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', background: '#f3f4f6', borderRadius: 99, padding: '2px 7px', flexShrink: 0 }}>
                      대리점
                    </span>
                  )}
                  <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    {(() => {
                      const sc = getCategoryColor(SALES_STATUS_COLORS, r.status)
                      return (
                        <span style={{ fontSize: 11, fontWeight: 700, color: sc.text, background: sc.bg, borderRadius: 99, padding: '2px 8px', whiteSpace: 'nowrap' }}>
                          {salesStatusLabel(r.status)}
                        </span>
                      )
                    })()}
                    {r.pdfUrl && (
                      <button
                        onClick={e => { e.stopPropagation(); onOpenPdf(r.pdfUrl, r.quoteNumber) }}
                        title={`${r.quoteNumber} 견적서 열기`}
                        aria-label="견적서 PDF 열기"
                        onMouseEnter={e => { e.currentTarget.style.color = '#234ea2' }}
                        onMouseLeave={e => { e.currentTarget.style.color = '#9ca3af' }}
                        style={{ padding: 0, background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', display: 'inline-flex', transition: 'color 0.15s ease' }}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                      </button>
                    )}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 3, minWidth: 0 }}>
                  <span style={{ fontSize: 12, color: '#234ea2', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                    {[r.partCode, r.productName].filter(Boolean).join(' ') || '-'}
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: '#6b7280', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {r.supplyAmount != null ? `₩${numKR(r.supplyAmount)}` : '-'}
                  </span>
                  <span style={{ fontSize: 12, color: '#9ca3af', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {r.quoteDate ?? '-'}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
