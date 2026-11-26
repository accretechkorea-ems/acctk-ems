'use client'

import type { Customer, Quote } from '../types'
import { CARD_BG, INPUT_BORDER, TEXT_MUTED, TEXT_PRIMARY, TEXT_SECONDARY, WHITE_BUTTON_BG, numKR } from '../constants'
import { isDealerQuote } from '../utils'
import ModalOverlay from '@/components/common/ModalOverlay'
import ModalCard, { keepPads } from '@/components/common/ModalCard'
import { SALES_STATUS_COLORS, getCategoryColor, salesStatusLabel } from '@/lib/categoryColors'
import { isOrdered, PENDING_STATUS, REVENUE_STATUS } from '@/lib/quoteStatus'
import BackdatedMark from '@/components/quote/BackdatedMark'
import { R } from '@/lib/radius'

type Props = {
  isOpen: boolean
  customer: Customer | null
  quotes: Quote[]
  onClose: () => void
  /**
   * 회사(부모) 기준으로 열렸을 때만 채워진다.
   * 제목을 회사명으로 바꾸고 '구분' 열을 뺀다 — 직판·대리점은 '이 업체 기준' 이라야 뜻이 있는데,
   * 같은 회사의 다른 업체 건까지 섞이면 기준이 없어져 표시가 틀리게 된다.
   */
  family?: { name: string; siteCount: number } | null
  /**
   * 견적번호를 눌러 PDF 를 연다. 주지 않으면 번호는 그냥 글자다
   * (전에는 이 창에서 PDF 를 열 길이 없어 번호를 보고 견적 화면에서 다시 찾아야 했다).
   */
  onOpenPdf?: (q: Quote) => void
}

export default function QuoteHistoryModal({ isOpen, customer, quotes, onClose, family, onOpenPdf }: Props) {
  if (!isOpen) return null

  /** 진행 중 = 「견적중」. 회사 카드의 「진행 견적」 타일과 **같은 판정**이다(hooks/useOpenQuotes.ts). */
  const pendingCount = quotes.filter(q => q.status === PENDING_STATUS).length
  const totalQuoteAmt = quotes.reduce((s, q) => s + (q.total_supply || 0), 0)
  const totalOrderAmt = quotes.filter(q => isOrdered(q.status)).reduce((s, q) => s + (q.total_supply || 0), 0)
  const totalRevenueAmt = quotes.filter(q => q.status === REVENUE_STATUS).reduce((s, q) => s + (q.total_supply || 0), 0)
  const revenueQuotes = quotes.filter(q => q.status === REVENUE_STATUS)
  const totalProfitAmt = revenueQuotes.reduce((s, q) => s + (q.total_profit || 0), 0)
  const totalProfitRate = totalRevenueAmt > 0 ? (totalProfitAmt / totalRevenueAmt * 100) : null

  const summaryCards = [
    { label: '총 견적 발행액', value: `₩${numKR(totalQuoteAmt)}`, sub: `${quotes.length}건`, color: TEXT_PRIMARY },
    { label: '총 수주액', value: `₩${numKR(totalOrderAmt)}`, sub: `${quotes.filter(q => isOrdered(q.status)).length}건`, color: '#3b82f6' },
    { label: '누적 매출액', value: `₩${numKR(totalRevenueAmt)}`, sub: `${revenueQuotes.length}건`, color: WHITE_BUTTON_BG },
    { label: '누적 순이익', value: totalProfitAmt > 0 ? `₩${numKR(totalProfitAmt)}` : '-', sub: '매출완료 기준', color: '#16a34a' },
    { label: '평균 이익률', value: totalProfitRate !== null && totalProfitAmt > 0 ? `${totalProfitRate.toFixed(1)}%` : '-', sub: '매출완료 기준', color: totalProfitRate !== null && totalProfitRate >= 40 ? '#16a34a' : '#f59e0b' },
  ]

  return (
    <ModalOverlay onClose={onClose}>
      {/* 공용 카드로 옮겼다(2026-11-26, 지시 P) — 열림 모션 150ms · Esc·바깥 클릭·✕ 가
          한 함수를 지난다. 겉모양은 그대로다: 폭 1100 · 최대 높이 90vh · 여백 24 ·
          머리줄 아래 16 · 제목 20/800. 요약 타일 다섯은 머리줄에 함께 둔다 — 본문만
          구르게 하면서 그 다섯이 늘 보이는 것이 옛 모습과 같다. */}
      <ModalCard
        width={1100}
        {...keepPads({ x: 24, top: 24, bottom: 24 }, 16, 0)}
        style={{ maxHeight: '90vh', boxShadow: '0 12px 40px rgba(0,0,0,0.35)', border: `1px solid ${INPUT_BORDER}` }}
        title={<>
          <div>
            {/* 이모지는 UI 아이콘으로 쓰지 않는다(.claude/rules/design-system.md).
                제목에 **건수와 진행 수**를 적는다(2026-11-20) — 이 창은 「진행 견적」 타일에서
                열리는데 안에는 끝난 건까지 들어 있어, 진행 2건으로 들어와 11줄을 보면
                무엇을 보고 있는지 어긋났다. 회사 카드의 타일과 같은 두 수치다. */}
            <div style={{ fontSize: 20, fontWeight: 800, color: TEXT_PRIMARY, marginBottom: 4 }}>
              {`견적 이력 ${quotes.length}건 · 진행 ${pendingCount}`}
            </div>
            <div style={{ fontSize: 13, color: TEXT_SECONDARY }}>
              {family ? `${family.name} (사업장 ${family.siteCount}곳)` : customer?.company_name}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginTop: 16 }}>
            {summaryCards.map(({ label, value, sub, color }) => (
              <div key={label} style={{ background: '#fff', borderRadius: R.tile, padding: '12px 14px', border: `1px solid ${INPUT_BORDER}`, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: TEXT_MUTED, marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 15, fontWeight: 800, color }}>{value}</div>
                <div style={{ fontSize: 11, color: TEXT_MUTED, marginTop: 2 }}>{sub}</div>
              </div>
            ))}
          </div>
        </>}
      >
        <div style={{ overflowX: 'auto' }}>
          {quotes.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: TEXT_MUTED, fontSize: 14 }}>견적 이력이 없습니다</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 900 }}>
              <thead style={{ position: 'sticky', top: 0, background: CARD_BG }}>
                <tr style={{ borderBottom: `2px solid ${INPUT_BORDER}` }}>
                  {['견적번호', ...(family ? [] : ['구분']), '날짜', '담당자', '품목', '금액', '순이익', '이익률', '상태'].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: TEXT_SECONDARY, fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {quotes.map(q => {
                  // 품목명은 **저장된 값(product_name)이 먼저**다. 가격표(price_list)는 비었을 때만 쓴다 —
                  // 가격표를 다시 등록하면 설명이 덮어쓰이는데, 그 글자를 먼저 쓰면 지난 견적의 품목명이
                  // 따라 바뀌어 버린다(가격표 2단계에서 뒤집었다).
                  const itemNames = q.quote_items && q.quote_items.length > 0
                    ? q.quote_items.map(i => i.product_name || i.price_list?.model_jp).filter(Boolean).join(', ')
                    : '-'
                  return (
                    // 모달 안 목록도 **같은 링**이다(2026-11-26 묶음2 D).
                    <tr key={q.quote_id} className="ems-pick" style={{ borderBottom: `1px solid ${INPUT_BORDER}` }}>
                      {/* 번호 옆 작은 표 — 지난 날짜로 넣은 건이다(홈 목록·실적 현황과 같은 부품). */}
                      <td style={{ padding: '10px 12px', fontWeight: 700, color: WHITE_BUTTON_BG, whiteSpace: 'nowrap' }}>
                        {onOpenPdf ? (
                          <button type="button" onClick={() => onOpenPdf(q)} title="견적서 PDF 열기"
                            style={{ padding: 0, background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', color: 'inherit', textDecoration: 'underline', textUnderlineOffset: 3 }}>
                            {q.quote_number}
                          </button>
                        ) : q.quote_number}
                        <BackdatedMark quoteDate={q.quote_date} createdAt={q.created_at} color={TEXT_SECONDARY} />
                      </td>
                      {!family && (
                        <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                          <span style={{ padding: '3px 10px', borderRadius: R.modal, fontSize: 12, fontWeight: 700, background: '#f3f4f6', color: TEXT_SECONDARY }}>
                            {isDealerQuote(q, customer?.customer_id ?? -1) ? '대리점' : '직판'}
                          </span>
                        </td>
                      )}
                      <td style={{ padding: '10px 12px', color: TEXT_SECONDARY, whiteSpace: 'nowrap' }}>{q.quote_date}</td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{q.engineers?.name ?? '-'}</td>
                      <td style={{ padding: '10px 12px', color: TEXT_SECONDARY, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{itemNames}</td>
                      <td style={{ padding: '10px 12px', fontWeight: 700, whiteSpace: 'nowrap' }}>₩{numKR(q.total_supply)}</td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        {q.status === '매출완료' && q.total_profit
                          ? <span style={{ fontWeight: 700, color: '#16a34a' }}>₩{numKR(q.total_profit)}</span>
                          : <span style={{ color: '#6b7280' }}>-</span>}
                      </td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        {q.status === '매출완료' && q.profit_rate
                          ? <span style={{ fontWeight: 700, color: q.profit_rate >= 40 ? '#16a34a' : '#f59e0b' }}>{q.profit_rate.toFixed(1)}%</span>
                          : <span style={{ color: '#6b7280' }}>-</span>}
                      </td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        <span style={{ padding: '3px 10px', borderRadius: R.modal, fontSize: 12, fontWeight: 700, background: getCategoryColor(SALES_STATUS_COLORS, q.status).bg, color: getCategoryColor(SALES_STATUS_COLORS, q.status).text }}>
                          {salesStatusLabel(q.status)}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </ModalCard>
    </ModalOverlay>
  )
}
