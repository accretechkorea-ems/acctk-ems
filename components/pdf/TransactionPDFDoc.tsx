// **거래명세서** — 견적 한 건이 실제로 거래된 사실을 적는 한 장짜리 문서.
//
// 양식은 docs/pdf-templates/거래명세서_최종안.pdf(와 같은 폴더의 HTML/CSS)가 기준이고,
// 그리는 기술은 견적서와 같다(@react-pdf/renderer). 흑백·괘선표·A4 한 장이다.
//
// ── 한 장을 지키는 법 ───────────────────────────────────────────────────────
//   표가 열 줄이 되도록 빈 줄을 채우고(TRANSACTION_MIN_ROWS), 열 줄을 넘으면 **줄 높이를
//   줄인다**(transactionRowHeight). 그래서 품목이 몇이든 표의 높이가 같고, 아래 확인란과
//   마감선이 늘 같은 자리에 온다.
//
// ── 수리 건이 아니어도 낼 수 있다 ───────────────────────────────────────────
//   그때는 품명 줄에 S/N 과 「수리 건」이 붙지 않는다(lib/quoteDocs.ts 의 transactionItemName).

import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import QuoteDocHeader from './QuoteDocHeader'
import {
  C_BLACK, C_SUB, CONTENT_W, MM, PAGE_MARGIN_X, PAGE_MARGIN_Y, S_BODY, S_CELL, S_DOC,
  S_H2, S_SUB, S_TOTAL, SUPPLIER, W_BOX, W_HAIR,
} from './docBase'
import {
  TRANSACTION_MIN_ROWS, bareQuoteNumber, docNumber, longDate, transactionRowHeight,
  type TransactionLine,
} from '@/lib/quoteDocs'

const numKR = (n: number) => Math.round(n).toLocaleString('ko-KR')

/** 표 열 폭 — HTML 의 th width 를 그대로 옮기고 품명이 남는 폭을 먹는다. */
const COL = { no: 8 * MM, qty: 12 * MM, supply: 25 * MM, tax: 22 * MM }
const COL_NAME = CONTENT_W - COL.no - COL.qty - COL.supply - COL.tax - W_BOX * 2

const S = StyleSheet.create({
  page: {
    fontFamily: 'NotoSansCJK', fontSize: S_BODY, color: C_BLACK, backgroundColor: '#ffffff',
    paddingTop: PAGE_MARGIN_Y, paddingBottom: PAGE_MARGIN_Y,
    paddingLeft: PAGE_MARGIN_X, paddingRight: PAGE_MARGIN_X,
    display: 'flex', flexDirection: 'column',
  },
  // .party{display:grid;grid-template-columns:1fr 1fr;gap:18px}
  party: { flexDirection: 'row', marginTop: 1 * MM, marginBottom: 3 * MM },
  // .pt{border-bottom:1.5px solid #000;letter-spacing:2px;padding-bottom:3px;margin-bottom:6px}
  partyTitle: {
    fontSize: S_H2, letterSpacing: 2, paddingBottom: 1 * MM, marginBottom: 1.6 * MM,
    borderBottomWidth: W_BOX, borderBottomColor: C_BLACK,
  },
  // .kv{display:grid;grid-template-columns:52px 1fr;row-gap:4px;column-gap:8px;font-size:9.8pt}
  kvRow: { flexDirection: 'row', marginBottom: 1.1 * MM },
  kvKey: { width: 14 * MM, fontSize: S_CELL },
  kvVal: { flex: 1, fontSize: S_CELL },
  h2: { fontSize: S_H2, marginTop: 2 * MM, marginBottom: 1 * MM },
  // table.i{border:1.5px solid #000}
  table: { width: CONTENT_W, borderWidth: W_BOX, borderColor: C_BLACK },
  // table.i th{border-bottom:1.5px solid #000}
  thRow: { flexDirection: 'row', borderBottomWidth: W_BOX, borderBottomColor: C_BLACK },
  row: { flexDirection: 'row', borderBottomWidth: W_HAIR, borderBottomColor: C_BLACK },
  cell: {
    borderRightWidth: W_HAIR, borderRightColor: C_BLACK,
    paddingVertical: 1 * MM, paddingHorizontal: 1.6 * MM, justifyContent: 'center',
  },
  th: { fontSize: S_CELL, textAlign: 'center' },
  td: { fontSize: S_CELL },
  sub: { fontSize: S_SUB, color: C_SUB, marginTop: 0.4 * MM },
  // .confirm{border:1.5px solid #000;padding:20px;text-align:center}
  confirm: {
    borderWidth: W_BOX, borderColor: C_BLACK, paddingVertical: 5 * MM, paddingHorizontal: 5 * MM,
    alignItems: 'center', marginTop: 1.6 * MM,
  },
})

export type TransactionPDFDocProps = {
  quoteNumber: string
  /** 거래일 — 문서를 만든 날('YYYY-MM-DD'). */
  issuedDate: string
  customerName: string
  customerAddress: string
  /** 「홍길동 책임 / 010-0000-0000」 */
  contact: string
  lines: TransactionLine[]
}

export function TransactionPDFDoc({
  quoteNumber, issuedDate, customerName, customerAddress, contact, lines,
}: TransactionPDFDocProps) {
  const rowCount = Math.max(TRANSACTION_MIN_ROWS, lines.length)
  const rowH = transactionRowHeight(rowCount) * MM
  const blanks = Math.max(0, TRANSACTION_MIN_ROWS - lines.length)
  /**
   * 보조 줄(품명 · 처리 결과)은 **열 줄까지만** 낸다.
   *
   * 줄 높이를 줄여도 칸 안의 글자는 줄지 않는다 — 두 줄짜리 칸은 9mm 밑으로 내려가지
   * 않아서, 열한 줄째부터는 표가 계속 길어져 한 장을 넘겼다(실측: 14줄에서 2쪽).
   * 품명 줄이 본문이고 보조 줄은 덧붙임이라, 넘칠 때는 덧붙임을 먼저 접는다.
   */
  const showSub = lines.length <= TRANSACTION_MIN_ROWS
  const supplySum = lines.reduce((s, l) => s + l.supply, 0)
  const taxSum = lines.reduce((s, l) => s + l.tax, 0)

  const kv = (k: string, v: string) => (
    <View style={S.kvRow} key={k}>
      <Text style={S.kvKey}>{k}</Text>
      <Text style={S.kvVal}>{v}</Text>
    </View>
  )

  return (
    <Document>
      <Page size="A4" style={S.page}>
        <QuoteDocHeader
          title="거래명세서"
          left={`견적번호 : ${bareQuoteNumber(quoteNumber)}`}
          right={`거래일 : ${longDate(issuedDate)}`}
        />

        {/* 공급자 / 공급받는자 — 박스 없이 제목 밑줄 + 항목 나열, 좌우 반반. */}
        <View style={S.party}>
          <View style={{ flex: 1, marginRight: 5 * MM }}>
            <Text style={S.partyTitle}>공 급 자</Text>
            {kv('상 호', SUPPLIER.name)}
            {kv('주 소', SUPPLIER.address)}
            {kv('연락처', SUPPLIER.tel)}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={S.partyTitle}>공급받는자</Text>
            {kv('회사명', customerName || '-')}
            {kv('주 소', customerAddress || '-')}
            {kv('담당자', contact || '-')}
          </View>
        </View>

        <Text style={S.h2}>공급 물품 내역</Text>
        <View style={S.table}>
          <View style={S.thRow}>
            <Text style={[S.cell, S.th, { width: COL.no }]}>No</Text>
            <Text style={[S.cell, S.th, { width: COL_NAME }]}>품 명</Text>
            <Text style={[S.cell, S.th, { width: COL.qty }]}>수량</Text>
            <Text style={[S.cell, S.th, { width: COL.supply }]}>공급가액</Text>
            <Text style={[S.cell, S.th, { width: COL.tax, borderRightWidth: 0 }]}>세 액</Text>
          </View>

          {lines.map(l => (
            <View key={l.no} style={[S.row, { minHeight: rowH }]} wrap={false}>
              <View style={[S.cell, { width: COL.no, alignItems: 'center' }]}>
                <Text style={S.td}>{l.no}</Text>
              </View>
              <View style={[S.cell, { width: COL_NAME }]}>
                <Text style={S.td}>{l.name}</Text>
                {showSub && l.sub ? <Text style={S.sub}>{l.sub}</Text> : null}
              </View>
              <View style={[S.cell, { width: COL.qty, alignItems: 'center' }]}>
                <Text style={S.td}>{l.quantity > 0 ? l.quantity : ''}</Text>
              </View>
              <View style={[S.cell, { width: COL.supply, alignItems: 'flex-end' }]}>
                <Text style={S.td}>{numKR(l.supply)}</Text>
              </View>
              <View style={[S.cell, { width: COL.tax, alignItems: 'flex-end', borderRightWidth: 0 }]}>
                <Text style={S.td}>{numKR(l.tax)}</Text>
              </View>
            </View>
          ))}

          {/* 빈 줄 — 번호만 적어 표가 열 줄이 되게 한다(양식 최종안 그대로). */}
          {Array.from({ length: blanks }, (_, i) => (
            <View key={`blank-${i}`} style={[S.row, { minHeight: rowH }]} wrap={false}>
              <View style={[S.cell, { width: COL.no, alignItems: 'center' }]}>
                <Text style={S.td}>{lines.length + i + 1}</Text>
              </View>
              <View style={[S.cell, { width: COL_NAME }]} />
              <View style={[S.cell, { width: COL.qty }]} />
              <View style={[S.cell, { width: COL.supply }]} />
              <View style={[S.cell, { width: COL.tax, borderRightWidth: 0 }]} />
            </View>
          ))}

          {/* .sumrow — 합 계 */}
          <View style={S.row}>
            <View style={[S.cell, { width: COL.no + COL_NAME + COL.qty, alignItems: 'center' }]}>
              <Text style={S.td}>합 계</Text>
            </View>
            <View style={[S.cell, { width: COL.supply, alignItems: 'flex-end' }]}>
              <Text style={S.td}>{numKR(supplySum)}</Text>
            </View>
            <View style={[S.cell, { width: COL.tax, alignItems: 'flex-end', borderRightWidth: 0 }]}>
              <Text style={S.td}>{numKR(taxSum)}</Text>
            </View>
          </View>
          {/* .totrow{border-top:1.5px solid #000;font-size:10.5pt} */}
          <View style={{ flexDirection: 'row', borderTopWidth: W_BOX, borderTopColor: C_BLACK }}>
            <View style={[S.cell, { width: COL.no + COL_NAME + COL.qty, alignItems: 'center' }]}>
              <Text style={{ fontSize: S_TOTAL }}>총 합계 (부가세 포함)</Text>
            </View>
            <View style={[S.cell, { width: COL.supply + COL.tax, alignItems: 'flex-end', borderRightWidth: 0 }]}>
              <Text style={{ fontSize: S_TOTAL }}>₩ {numKR(supplySum + taxSum)}</Text>
            </View>
          </View>
        </View>

        {/* 남는 세로 공간을 먹어 확인란·마감선을 바닥에 붙인다(.grow). */}
        <View style={{ flexGrow: 1 }} />

        <View style={S.confirm}>
          <Text style={{ fontSize: S_H2 }}>상기 물품의 거래를 실행하였음을 확인합니다.</Text>
          <Text style={{ fontSize: S_BODY, marginTop: 3.5 * MM }}>{longDate(issuedDate)}</Text>
          <Text style={{ fontSize: 11.5, marginTop: 3.5 * MM }}>
            Accretech Korea Co., Ltd.  <Text style={{ fontSize: S_BODY }}>(인)</Text>
          </Text>
        </View>

        {/* 마감선 + 문서번호. 쪽 번호도 하단 연락처도 두지 않는다(양식 최종안). */}
        <View style={{ borderBottomWidth: 2, borderBottomColor: C_BLACK, marginTop: 5 * MM }} />
        <Text style={{ fontSize: S_DOC, paddingTop: 1 * MM }}>
          문서번호 : {docNumber(quoteNumber, 'transaction')}
        </Text>
      </Page>
    </Document>
  )
}

export default TransactionPDFDoc
