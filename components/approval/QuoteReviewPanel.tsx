'use client'

// 견적 검토표 — 견적서 문서의 상세에 붙는 유형별 패널.
//
// 결재자가 금액만 보고 판단하지 않도록 품목·원가·이익·이익률·거래 구분을 한 화면에 모은다.
// 이 문서를 볼 수 있는 사람이면 **전부** 본다(원가·이익을 가리지 않는다 — 설계 결정).
//
// 데이터는 /api/quote-approval 의 'review' 가 service role 로 읽어 준다. 브라우저가 quotes 를
// 직접 읽지 않는 이유 — 결재선에 들어온 다른 팀 사람은 그 견적의 RLS(quotes_select)를 통과하지
// 못할 수 있고, 그러면 결재할 문서의 내용을 못 본다.
//
// **비고(note)는 그리지 않는다.** 응답에는 담겨 있지만(다음 작업인 결재 완료 PDF 가 같은 응답을
// 쓴다) 검토표에는 내지 않는다. 납기(delivery)는 거래 정보에 낸다.
//
// 실패해도 결재 승인·반려 버튼은 그대로 동작해야 한다 — 이 패널은 자기 영역에서만 오류를 알린다.

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { BORDER, CARD_BG, DANGER, FAINT, MUTED, NEUTRAL_BG, SKELETON, SUB, TEXT, btnGhost } from '@/components/common/ui'
import { comma, rateText, type QuoteReview } from '@/lib/approval/quoteReview'
import { useToast } from '@/components/common/Toast'
import { openGeneratedQuotePdf } from '@/lib/openQuotePdf'
import { reviewCache } from '@/lib/quoteReviewCache'

/** 표가 좁은 화면에서 **자기 상자 안에서만** 가로로 스크롤되게 한다(페이지가 옆으로 밀리지 않게). */
const scrollBox: CSSProperties = {
  border: `1px solid ${BORDER}`, borderRadius: 8, overflowX: 'auto', maxWidth: '100%',
}

const table: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 560 }
const th: CSSProperties = {
  padding: '7px 9px', textAlign: 'left', color: SUB, fontWeight: 700,
  whiteSpace: 'nowrap', borderBottom: `1px solid ${BORDER}`, background: NEUTRAL_BG,
}
const thNum: CSSProperties = { ...th, textAlign: 'right' }
const td: CSSProperties = { padding: '7px 9px', color: TEXT, borderBottom: `1px solid ${BORDER}`, verticalAlign: 'top' }
/** 금액 칸 — 오른쪽 정렬 + 숫자 폭 고정(.num 은 globals.css 의 tabular-nums). */
const tdNum: CSSProperties = { ...td, textAlign: 'right', whiteSpace: 'nowrap' }

const sectionTitle: CSSProperties = { fontSize: 11, fontWeight: 700, color: MUTED, marginBottom: 5 }

/** 요약 카드 — 그림자 없이 테두리로만 구분한다(디자인 규칙). */
function StatCard({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div style={{
      flex: '1 1 110px', minWidth: 104, background: CARD_BG,
      border: `1px solid ${BORDER}`, borderRadius: 8, padding: '9px 11px',
    }}>
      <div style={{ fontSize: 11, color: MUTED, fontWeight: 600, marginBottom: 3 }}>{label}</div>
      <div className="num" style={{ fontSize: 14, fontWeight: 800, color: muted ? MUTED : TEXT, whiteSpace: 'nowrap' }}>
        {value}
      </div>
    </div>
  )
}

/**
 * 못 읽었을 때 그 자리에 두는 줄 — 사유와 「다시 시도」.
 * 패널 전체·품목 표·부대비용 표가 **같은 모양**을 쓴다(세 자리에 따로 짜면 모양이 갈린다).
 */
function LoadFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div style={{
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

/** 「이름 값」 한 줄. 문서 상세의 요약 줄과 같은 꼴이다. */
function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'contents' }}>
      <span style={{ fontSize: 12, color: MUTED }}>{label}</span>
      <span style={{ fontSize: 13, color: TEXT, wordBreak: 'break-word' }}>{children}</span>
    </div>
  )
}

export default function QuoteReviewPanel({ documentId }: { documentId: number }) {
  const toast = useToast()
  // 이미 읽어 둔 것이 있으면 **첫 그림부터 내용을 그린다.** useState 의 초기값으로 꺼내는 이유 —
  // useEffect 는 한 번 그린 뒤에 돌아서, 거기서 채우면 자리표시가 한 번 번쩍인다.
  const cached = reviewCache.peek(documentId)
  const [data, setData] = useState<QuoteReview | null>(cached?.review ?? null)
  // PDF 를 만들 대상 견적. 검토 응답이 함께 준다(문서 → 견적 연결은 서버가 안다).
  const [quoteId, setQuoteId] = useState<number | null>(cached?.quoteId ?? null)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(cached == null)

  /** force 면 캐시를 건너뛰고 새로 부른다 — 「다시 시도」가 그렇게 부른다. */
  const load = useCallback(async (opts?: { force?: boolean }) => {
    if (!opts?.force) {
      const hit = reviewCache.peek(documentId)
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
    const res = await reviewCache.load(documentId, { force: opts?.force })
    if (!res) {
      setFailed(true)
      setLoading(false)
      return
    }
    setData(res.review)
    setQuoteId(res.quoteId)
    setLoading(false)
  }, [documentId])

  /** 「다시 시도」 — 버튼의 click 이벤트가 opts 로 들어가지 않게 감싼다. */
  const retry = useCallback(() => { void load({ force: true }) }, [load])

  useEffect(() => { load() }, [load])

  /**
   * 견적서 PDF 보기 — **저장값으로 그 자리에서 만든다.**
   * 결재 문서가 있는 견적은 결재 대상이므로(상신 라우트가 도입 전 견적을 막는다) 늘 생성 경로다.
   */
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
      <div style={{ marginTop: 12 }}>
        <div style={sectionTitle}>견적 검토</div>
        {/* 자리표시 — 높이를 미리 잡아 두어 내용이 들어올 때 아래 버튼이 튀지 않게 한다. */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} style={{ flex: '1 1 110px', minWidth: 104, height: 52, background: SKELETON, borderRadius: 8 }} />
          ))}
        </div>
        <div style={{ height: 80, background: SKELETON, borderRadius: 8 }} />
      </div>
    )
  }

  if (failed || !data) {
    return (
      <div style={{ marginTop: 12 }}>
        <div style={sectionTitle}>견적 검토</div>
        <LoadFailed message="검토 정보를 불러오지 못했습니다" onRetry={retry} />
      </div>
    )
  }

  const t = data.totals
  const ch = data.channel

  return (
    <div style={{ marginTop: 12 }}>
      {/* ① 머리줄 — 오른쪽 끝에 「견적서 PDF 보기」.
          결재 문서를 볼 수 있는 사람이면 결재 전에도 열 수 있다. 저장된 파일이 아니라
          저장값으로 그 자리에서 만들며, 완료 전이면 날짜 자리에 빨간 안내가 들어간다
          (lib/openQuotePdf.tsx). */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 7 }}>
        <span style={sectionTitle}>견적 검토</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>{data.quoteNumber ?? '-'}</span>
        <span style={{ color: FAINT }}>·</span>
        <span style={{ fontSize: 12, color: SUB }}>{data.quoteDate ?? '-'}</span>
        <button
          type="button"
          onClick={openPdf}
          disabled={pdfBusy}
          style={{ ...btnGhost(pdfBusy), marginLeft: 'auto', padding: '4px 10px', fontSize: 12 }}
        >
          {pdfBusy ? '만드는 중...' : '견적서 PDF 보기'}
        </button>
      </div>

      {/* ② 요약 카드 다섯 개 */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <StatCard label="공급가" value={comma(t.supply)} />
        <StatCard label="총액(VAT 포함)" value={comma(t.amount)} />
        <StatCard label="원가" value={comma(t.cost)} muted={t.cost === null} />
        <StatCard label="이익" value={comma(t.profit)} muted={t.profit === null} />
        <StatCard label="이익률" value={rateText(t.profitRate)} muted={t.profitRate === null} />
      </div>

      {/* ③ 거래 정보 — 비고(note)는 내지 않는다(이 파일 머리말). */}
      <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 12px', marginBottom: 12 }}>
        <InfoRow label="거래 구분">
          {ch.kind === 'direct' ? (
            <>
              <span style={{ fontWeight: 700 }}>{ch.label}</span>
              <span style={{ color: FAINT }}> · </span>
              <span>{ch.customer}</span>
              {ch.customerSite && (
                <span style={{ fontSize: 11, color: MUTED }}> (등록: {ch.customerSite})</span>
              )}
            </>
          ) : (
            <>
              <span style={{ fontWeight: 700 }}>{ch.label}</span>
              <span style={{ color: FAINT }}> </span>
              <span>{ch.dealer ?? '-'}</span>
              {ch.dealerSite && <span style={{ fontSize: 11, color: MUTED }}> (등록: {ch.dealerSite})</span>}
              <span style={{ color: FAINT }}> · </span>
              <span style={{ fontWeight: 700 }}>E.U</span>
              <span> {ch.customer}</span>
              {ch.customerSite && <span style={{ fontSize: 11, color: MUTED }}> (등록: {ch.customerSite})</span>}
            </>
          )}
        </InfoRow>
        <InfoRow label="수신">{data.recipient?.trim() || '-'}</InfoRow>
        <InfoRow label="실적 담당">{data.engineer?.trim() || '-'}</InfoRow>
        <InfoRow label="작성자">{data.createdBy?.trim() || '-'}</InfoRow>
        <InfoRow label="납기">{data.delivery?.trim() || '-'}</InfoRow>
      </div>

      {/* ③-1 조건 변경 — **기본과 다를 때만** 나온다. 모두 기본이면 이 줄 자체가 없다.
          결재자가 「평소와 다른 조건으로 나가는 건인가」를 한 줄로 알아야 하는 자리라,
          거래 정보보다 눈에 띄게 테두리를 두르고 바뀐 항목만 적는다(기본값은 적지 않는다). */}
      {data.termsChanged.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap',
          border: `1px solid ${BORDER}`, borderRadius: 8, padding: '8px 10px', marginBottom: 12,
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: DANGER, whiteSpace: 'nowrap' }}>조건 변경</span>
          <span style={{ fontSize: 12, color: TEXT, wordBreak: 'break-word' }}>
            {data.termsChanged.map((c, i) => (
              <span key={c.key}>
                {i > 0 && <span style={{ color: FAINT }}> · </span>}
                <span style={{ color: MUTED }}>{c.label}: </span>
                <span style={{ fontWeight: 700 }}>{c.value}</span>
              </span>
            ))}
          </span>
        </div>
      )}

      {/* ④ 품목 표 — 못 읽었으면 **빈 표를 그리지 않는다.**
          빈 표로 두면 「품목 없는 견적」으로 읽혀 결재자가 잘못 판단한다. */}
      {!data.itemsOk ? (
        <LoadFailed message="품목을 불러오지 못했습니다. 다시 시도해 주세요" onRetry={retry} />
      ) : (
      <div style={scrollBox}>
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>품목</th>
              <th style={thNum}>수량</th>
              <th style={thNum}>단가</th>
              <th style={thNum}>공급가</th>
              <th style={thNum}>원가</th>
              <th style={thNum}>이익</th>
              <th style={thNum}>이익률</th>
            </tr>
          </thead>
          <tbody>
            {data.items.length === 0 ? (
              <tr><td style={{ ...td, color: MUTED }} colSpan={7}>품목이 없습니다</td></tr>
            ) : data.items.map(it => (
              <tr key={it.itemId}>
                <td style={td}>
                  <div style={{ fontWeight: 600 }}>{it.name}</div>
                  {it.subParts.length > 0 && (
                    <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>
                      {it.subParts.map(p => `${p.label} ${p.value}`).join(' · ')}
                    </div>
                  )}
                  {/* 품명 아래 설명 줄 — 견적서 PDF 에 나가는 글자다. PDF 와 같이 **줄마다 한 행**으로 둔다. */}
                  {it.subLines.map((line, i) => (
                    <div key={i} style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{line}</div>
                  ))}
                </td>
                <td className="num" style={tdNum}>{comma(it.quantity)}</td>
                <td className="num" style={tdNum}>{comma(it.unitPrice)}</td>
                <td className="num" style={tdNum}>{comma(it.supply)}</td>
                <td className="num" style={tdNum}>{comma(it.cost)}</td>
                <td className="num" style={tdNum}>{comma(it.profit)}</td>
                <td className="num" style={tdNum}>{rateText(it.profitRate)}</td>
              </tr>
            ))}
            {/* 합계 — 품목을 더하지 않고 **저장된 합계**를 그대로 쓴다(lib/approval/quoteReview.ts).
                국내조달품은 공급가 합계에서 빠지므로 더하면 값이 달라진다. */}
            <tr style={{ background: NEUTRAL_BG }}>
              <td style={{ ...td, fontWeight: 700, borderBottom: 'none' }}>합계</td>
              <td style={{ ...tdNum, borderBottom: 'none' }} />
              <td style={{ ...tdNum, borderBottom: 'none' }} />
              <td className="num" style={{ ...tdNum, fontWeight: 700, borderBottom: 'none' }}>{comma(t.supply)}</td>
              <td className="num" style={{ ...tdNum, fontWeight: 700, borderBottom: 'none' }}>{comma(t.cost)}</td>
              <td className="num" style={{ ...tdNum, fontWeight: 700, borderBottom: 'none' }}>{comma(t.profit)}</td>
              <td className="num" style={{ ...tdNum, fontWeight: 700, borderBottom: 'none' }}>{rateText(t.profitRate)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      )}

      {/* ⑤ 부대비용 — **있을 때만**. 견적 합계·원가와 무관한 내부 기록이다(lib/quoteExcel.ts 와 같은 취급).
          못 읽었으면 「없다」고 말할 수 없으므로 그때도 자리를 내어 오류를 알린다. */}
      {!data.expensesOk ? (
        <div style={{ marginTop: 10 }}>
          <div style={sectionTitle}>부대비용</div>
          <LoadFailed message="부대비용을 불러오지 못했습니다. 다시 시도해 주세요" onRetry={retry} />
        </div>
      ) : data.expenses.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={sectionTitle}>부대비용</div>
          <div style={scrollBox}>
            <table style={{ ...table, minWidth: 360 }}>
              <thead>
                <tr>
                  <th style={th}>항목</th>
                  <th style={thNum}>단가</th>
                  <th style={thNum}>일수</th>
                  <th style={thNum}>금액</th>
                </tr>
              </thead>
              <tbody>
                {data.expenses.map(e => (
                  <tr key={e.expenseId}>
                    <td style={td}>{e.name}</td>
                    <td className="num" style={tdNum}>{comma(e.unitPrice)}</td>
                    <td className="num" style={tdNum}>{comma(e.days)}</td>
                    <td className="num" style={tdNum}>{comma(e.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
