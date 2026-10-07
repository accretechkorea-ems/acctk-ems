'use client'

// 견적품의서의 **본문** — 옛 그룹웨어 품의서 본문 표를 그대로 옮긴 모양.
//
//   매출처명 / 품　　명 / 견 적 가 / 예상매출원가 / 예상매출이익(율) / 납품기한 / 조건 변경 / 첨부
//   그 아래에 품목별 작은 표(품목·수량·단가·원가·이익률).
//
// 데이터는 **기존 검토표 응답을 그대로 쓴다**(/api/quote-approval 의 'review').
// 새로 조회하지도, 금액을 다시 계산하지도 않는다 — 검토표(QuoteReviewPanel)와 같은 캐시
// (lib/quoteReviewCache.ts)를 거치므로 같은 문서를 두 화면에서 열어도 요청은 한 번이다.
//
// 비고(note)는 그리지 않는다 — 검토표와 같은 규칙이다(응답에는 담겨 있다).

import { useCallback, useEffect, useState } from 'react'
import { BORDER, CARD_BG, DANGER, FAINT, MUTED, SKELETON, btnGhost } from '@/components/common/ui'
import { useToast } from '@/components/common/Toast'
import { comma, rateText, type QuoteReview } from '@/lib/approval/quoteReview'
import { reviewCache } from '@/lib/quoteReviewCache'
import { openGeneratedQuotePdf } from '@/lib/openQuotePdf'
import type { DocFormBodyProps } from './panels'
import { FormRow, SCROLL_CLASS, formTable, formTd, formTh, scrollBox } from './formStyles'

/** 금액 한 줄 — 「12,345,678원」. 값이 없으면 '-'(comma 가 '-' 를 낸다). */
const won = (v: number | null): string => (v === null ? '-' : `${comma(v)}원`)

/** 「금액원 (12.3%)」 — 이익과 이익률을 한 칸에. 둘 다 없으면 '-'. */
function profitText(profit: number | null, rate: number | null): string {
  if (profit === null && rate === null) return '-'
  const amount = profit === null ? '-' : `${comma(profit)}원`
  return rate === null ? amount : `${amount} (${rateText(rate)})`
}

/** 품명 칸 — 「첫 품목 외 N건」. 품목이 하나면 그 이름만. */
function itemsLabel(review: QuoteReview): string {
  const names = review.items.map(i => i.name?.trim()).filter((n): n is string => !!n)
  if (names.length === 0) return '-'
  if (names.length === 1) return names[0]
  return `${names[0]} 외 ${names.length - 1}건`
}

/**
 * 매출처명 — 대리점 건은 「대리점(E.U)」, 직판은 「고객사 (직판)」.
 * 이름은 검토표가 쓰는 값을 그대로 쓴다(회사명 우선 표기는 서버가 이미 적용했다).
 */
function sellerText(review: QuoteReview): string {
  const ch = review.channel
  if (ch.kind === 'dealer') return `${ch.dealer ?? '-'}(${ch.customer || '-'})`
  return `${ch.customer || '-'} (${ch.label})`
}

/** 못 읽었을 때 그 자리에 두는 줄 — 검토표와 같은 모양이다. */
function LoadFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="ad-noprint" style={{
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      border: `1px solid ${BORDER}`, borderRadius: 8, padding: '10px 12px',
    }}>
      <span style={{ fontSize: 12, color: DANGER, fontWeight: 600 }}>{message}</span>
      <button type="button" onClick={onRetry} style={{ ...btnGhost(), padding: '4px 10px', fontSize: 12 }}>
        다시 시도
      </button>
    </div>
  )
}

export default function QuoteFormBody({ doc }: DocFormBodyProps) {
  const toast = useToast()
  const cached = reviewCache.peek(doc.document_id)
  const [data, setData] = useState<QuoteReview | null>(cached?.review ?? null)
  const [quoteId, setQuoteId] = useState<number | null>(cached?.quoteId ?? null)
  const [loading, setLoading] = useState(cached == null)
  const [failed, setFailed] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)

  /** force 면 캐시를 건너뛰고 새로 부른다 — 「다시 시도」가 그렇게 부른다. */
  const load = useCallback(async (opts?: { force?: boolean }) => {
    if (!opts?.force) {
      const hit = reviewCache.peek(doc.document_id)
      if (hit) {
        setData(hit.review)
        setQuoteId(hit.quoteId)
        setFailed(false)
        setLoading(false)
        return
      }
    }
    setLoading(true)
    setFailed(false)
    const res = await reviewCache.load(doc.document_id, { force: opts?.force })
    if (!res) {
      setFailed(true)
      setLoading(false)
      return
    }
    setData(res.review)
    setQuoteId(res.quoteId)
    setLoading(false)
  }, [doc.document_id])

  const retry = useCallback(() => { void load({ force: true }) }, [load])

  useEffect(() => { load() }, [load])

  /** 견적서 PDF — 저장값으로 그 자리에서 만든다(기존 헬퍼. 결재 상태별 동작도 그대로다). */
  const openPdf = async () => {
    if (pdfBusy || quoteId == null) return
    setPdfBusy(true)
    try {
      const res = await openGeneratedQuotePdf(quoteId)
      if (!res.ok) toast.error(res.error)
    } finally {
      setPdfBusy(false)
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ height: 160, background: SKELETON, borderRadius: 6 }} />
        <div style={{ height: 80, background: SKELETON, borderRadius: 6 }} />
      </div>
    )
  }
  if (failed || !data) {
    return <LoadFailed message="견적 내용을 불러오지 못했습니다" onRetry={retry} />
  }

  const t = data.totals

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* ── 본문 표 ── 라벨 칸 + 값 칸. 옛 품의서 본문과 같은 줄 구성이다. */}
      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 6, overflow: 'hidden', background: CARD_BG }}>
        <FormRow label="매출처명" first>{sellerText(data)}</FormRow>
        <FormRow label="품　　명">{itemsLabel(data)}</FormRow>
        <FormRow label="견 적 가">
          <span className="num" style={{ fontWeight: 700 }}>{won(t.supply)}</span>
        </FormRow>
        <FormRow label="예상매출원가">
          <span className="num">{won(t.cost)}</span>
        </FormRow>
        <FormRow label="예상매출이익(율)">
          <span className="num">{profitText(t.profit, t.profitRate)}</span>
        </FormRow>
        <FormRow label="납품기한">{data.delivery?.trim() || '-'}</FormRow>
        {/* 조건 변경 — **기본과 다를 때만** 나온다. 바뀐 항목만 적는다(기본값은 적지 않는다).
            규칙은 검토표와 같은 값(termsChanged)을 그대로 쓴다. */}
        {data.termsChanged.length > 0 && (
          <FormRow label="조건 변경">
            {data.termsChanged.map((c, i) => (
              <span key={c.key}>
                {i > 0 && <span style={{ color: FAINT }}> · </span>}
                <span style={{ color: MUTED }}>{c.label}: </span>
                <span style={{ fontWeight: 700 }}>{c.value}</span>
              </span>
            ))}
          </FormRow>
        )}
        <FormRow label="첨　　부">
          {/* 버튼은 인쇄에서 빠진다 — 종이에서 링크는 뜻이 없다. 견적번호·일자는 남는다. */}
          <span className="ad-noprint">
          <button
            type="button"
            onClick={openPdf}
            disabled={pdfBusy || quoteId == null}
            style={{ ...btnGhost(pdfBusy || quoteId == null), padding: '3px 9px', fontSize: 12 }}
          >
            {pdfBusy ? '만드는 중...' : '견적서 PDF 보기'}
          </button>
          </span>
          <span style={{ fontSize: 11, color: MUTED, marginLeft: 8 }}>
            {data.quoteNumber ?? '-'}
            <span style={{ color: FAINT }}> · </span>
            {data.quoteDate ?? '-'}
          </span>
        </FormRow>
      </div>

      {/* ── 품목별 작은 표 ── 못 읽었으면 **빈 표를 그리지 않는다**(검토표와 같은 규칙) */}
      {!data.itemsOk ? (
        <LoadFailed message="품목을 불러오지 못했습니다. 다시 시도해 주세요" onRetry={retry} />
      ) : (
        <div className={SCROLL_CLASS} style={scrollBox}>
          <table style={formTable}>
            <thead>
              <tr>
                <th style={formTh}>품목</th>
                <th style={{ ...formTh, textAlign: 'right', width: 60 }}>수량</th>
                <th style={{ ...formTh, textAlign: 'right', width: 110 }}>단가</th>
                <th style={{ ...formTh, textAlign: 'right', width: 110 }}>원가</th>
                <th style={{ ...formTh, textAlign: 'right', width: 76 }}>이익률</th>
              </tr>
            </thead>
            <tbody>
              {data.items.length === 0 ? (
                <tr>
                  <td style={{ ...formTd, color: MUTED }} colSpan={5}>품목이 없습니다</td>
                </tr>
              ) : data.items.map(it => (
                <tr key={it.itemId}>
                  <td style={formTd}>
                    <span>{it.name || '-'}</span>
                    {/* 품번·구입가·환율·관세 — **값이 있는 것만** 보조 줄로 붙는다(서버가 골라 준다). */}
                    {it.subParts.length > 0 && (
                      <span style={{ display: 'block', fontSize: 11, color: MUTED, marginTop: 2 }}>
                        {it.subParts.map((sp, i) => (
                          <span key={sp.label}>
                            {i > 0 && <span style={{ color: FAINT }}> · </span>}
                            {sp.label} {sp.value}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="num" style={{ ...formTd, textAlign: 'right' }}>{it.quantity ?? '-'}</td>
                  <td className="num" style={{ ...formTd, textAlign: 'right' }}>{comma(it.unitPrice)}</td>
                  <td className="num" style={{ ...formTd, textAlign: 'right' }}>{comma(it.cost)}</td>
                  <td className="num" style={{ ...formTd, textAlign: 'right' }}>{rateText(it.profitRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 부대비용 — 검토표와 같은 규칙. 못 읽었으면 그 자리에 오류를 그린다. */}
      {!data.expensesOk ? (
        <LoadFailed message="부대비용을 불러오지 못했습니다. 다시 시도해 주세요" onRetry={retry} />
      ) : data.expenses.length > 0 && (
        <div className={SCROLL_CLASS} style={scrollBox}>
          <table style={formTable}>
            <thead>
              <tr>
                <th style={formTh}>부대비용</th>
                <th style={{ ...formTh, textAlign: 'right', width: 110 }}>단가</th>
                <th style={{ ...formTh, textAlign: 'right', width: 60 }}>일수</th>
                <th style={{ ...formTh, textAlign: 'right', width: 110 }}>금액</th>
              </tr>
            </thead>
            <tbody>
              {data.expenses.map(e => (
                <tr key={e.expenseId}>
                  <td style={formTd}>{e.name || '-'}</td>
                  <td className="num" style={{ ...formTd, textAlign: 'right' }}>{comma(e.unitPrice)}</td>
                  <td className="num" style={{ ...formTd, textAlign: 'right' }}>{e.days ?? '-'}</td>
                  <td className="num" style={{ ...formTd, textAlign: 'right' }}>{comma(e.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
