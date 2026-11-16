// **수리내역서** — 접수 사항 · 처리 사항 · 수리 사진 · 교환 부품, A4 한 장.
//
// 양식은 docs/pdf-templates/수리내역서_최종안.pdf(와 같은 폴더의 HTML/CSS)가 기준이고,
// 그리는 기술은 견적서와 같다(@react-pdf/renderer).
//
// ── 한 장을 지키는 세 가지 ──────────────────────────────────────────────────
//   ① 사진 영역 높이를 **고정**한다(PHOTO_AREA_MM) — 넉 장이든 한 장이든 같은 자리를 쓴다.
//   ② 교환 부품은 아홉 줄까지 그대로, 열 줄부터 **줄 높이를 줄인다**(partRowHeight).
//   ③ 사진이 0장이면 그 절을 아예 내지 않는다(제목까지).

import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import QuoteDocHeader from './QuoteDocHeader'
import {
  C_BLACK, CONTENT_W, MM, PAGE_MARGIN_X, PAGE_MARGIN_Y,
  S_BODY, S_CELL, S_DOC, S_H2, S_SUB, W_BOX, W_HAIR,
} from './docBase'
import {
  PART_MIN_ROWS, PHOTO_AREA_MM, bareQuoteNumber, docNumber, partRowHeight, photoLayout,
  type PartRow,
} from '@/lib/quoteDocs'

/** table.f th{width:80px} — 왼쪽 제목 칸. */
const TH_W = 22 * MM
/** 2열 표의 값 칸(제목·값·제목·값). */
const TD_W = (CONTENT_W - W_BOX * 2 - TH_W * 2) / 2
/** 교환 부품 표의 열 폭. */
const PCOL = { no: 8 * MM, code: 42 * MM, qty: 13 * MM }
const PCOL_NAME = CONTENT_W - PCOL.no - PCOL.code - PCOL.qty - W_BOX * 2
/** 사진 칸 사이 여백 — .photos{gap:6px} */
const PH_GAP = 1.6 * MM

const S = StyleSheet.create({
  page: {
    fontFamily: 'NotoSansCJK', fontSize: S_BODY, color: C_BLACK, backgroundColor: '#ffffff',
    paddingTop: PAGE_MARGIN_Y, paddingBottom: PAGE_MARGIN_Y,
    paddingLeft: PAGE_MARGIN_X, paddingRight: PAGE_MARGIN_X,
    display: 'flex', flexDirection: 'column',
  },
  h2: { fontSize: S_H2, marginTop: 1.4 * MM, marginBottom: 0.6 * MM },
  table: { width: CONTENT_W, borderWidth: W_BOX, borderColor: C_BLACK, marginBottom: 1.6 * MM },
  row: { flexDirection: 'row', borderBottomWidth: W_HAIR, borderBottomColor: C_BLACK },
  lastRow: { flexDirection: 'row' },
  cell: {
    borderRightWidth: W_HAIR, borderRightColor: C_BLACK,
    paddingVertical: 0.8 * MM, paddingHorizontal: 1.8 * MM, justifyContent: 'center',
  },
  th: { fontSize: S_CELL, textAlign: 'center' },
  td: { fontSize: S_CELL },
  // .pre{white-space:pre-line;line-height:1.5}
  pre: { fontSize: S_CELL, lineHeight: 1.5 },
  ph: { borderWidth: W_HAIR, borderColor: C_BLACK },
  phCap: { fontSize: S_SUB, paddingVertical: 0.7 * MM, paddingHorizontal: 1.6 * MM, borderTopWidth: W_HAIR, borderTopColor: C_BLACK },
})

export type RepairReportPhoto = { src: string; caption: string | null }

export type RepairReportPDFDocProps = {
  quoteNumber: string
  customerName: string
  /** 「홍길동 책임 / 010-0000-0000」 */
  contact: string
  receivedDate: string
  shippedDate: string
  itemType: string
  serialNumber: string
  /** 「GAUGE HEAD E-TS-0000B-P0」 — 품명과 모델. */
  nameModel: string
  partCode: string
  symptom: string
  cause: string
  workPeriod: string
  result: string
  photos: RepairReportPhoto[]
  parts: PartRow[]
  /** 「홍길동 사원」 */
  engineer: string
  /** 사무실 전화. */
  engineerTel: string
}

export function RepairReportPDFDoc(p: RepairReportPDFDocProps) {
  const rowCount = Math.max(PART_MIN_ROWS, p.parts.length)
  const partH = partRowHeight(rowCount) * MM
  const blanks = Math.max(0, PART_MIN_ROWS - p.parts.length)
  const lay = photoLayout(p.photos.length)
  const phW = lay.cols > 0 ? (CONTENT_W - PH_GAP * (lay.cols - 1)) / lay.cols : 0

  /** 2열 표의 한 줄 — 제목·값·제목·값. */
  const row2 = (k1: string, v1: string, k2: string, v2: string, last = false) => (
    <View style={last ? S.lastRow : S.row} key={k1 + k2}>
      <View style={[S.cell, { width: TH_W }]}><Text style={S.th}>{k1}</Text></View>
      <View style={[S.cell, { width: TD_W }]}><Text style={S.td}>{v1 || '-'}</Text></View>
      <View style={[S.cell, { width: TH_W }]}><Text style={S.th}>{k2}</Text></View>
      <View style={[S.cell, { width: TD_W, borderRightWidth: 0 }]}><Text style={S.td}>{v2 || '-'}</Text></View>
    </View>
  )

  /** 한 줄 전체를 쓰는 줄 — 제목 + 긴 글. */
  const rowWide = (k: string, v: string, last = false) => (
    <View style={last ? S.lastRow : S.row} key={k}>
      <View style={[S.cell, { width: TH_W }]}><Text style={S.th}>{k}</Text></View>
      <View style={[S.cell, { width: CONTENT_W - W_BOX * 2 - TH_W, borderRightWidth: 0 }]}>
        <Text style={S.pre}>{v || '-'}</Text>
      </View>
    </View>
  )

  return (
    <Document>
      <Page size="A4" style={S.page}>
        <QuoteDocHeader title="수리내역서" left={`견적번호 : ${bareQuoteNumber(p.quoteNumber)}`} />

        <Text style={S.h2}>1. 접수 사항</Text>
        <View style={S.table}>
          {row2('회사명', p.customerName, '담당자', p.contact)}
          {row2('입고일', p.receivedDate, '출고일', p.shippedDate)}
          {row2('구 분', p.itemType, '시리얼번호', p.serialNumber)}
          {row2('품명·모델', p.nameModel, '품 번', p.partCode, true)}
        </View>

        <Text style={S.h2}>2. 처리 사항</Text>
        <View style={S.table}>
          {rowWide('고장 증상', p.symptom)}
          {rowWide('고장 원인', p.cause)}
          {rowWide('처리 일시', p.workPeriod)}
          {rowWide('처리 결과', p.result, true)}
        </View>

        {/* 사진이 없으면 절을 통째로 비운다(제목도 내지 않는다). */}
        {p.photos.length > 0 && (
          <>
            <Text style={S.h2}>3. 수리 사진</Text>
            <View style={{ height: PHOTO_AREA_MM * MM, marginBottom: 1.6 * MM }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {p.photos.map((ph, i) => (
                  <View
                    key={i}
                    style={[S.ph, {
                      width: phW,
                      marginRight: (i + 1) % lay.cols === 0 ? 0 : PH_GAP,
                      marginBottom: PH_GAP,
                    }]}
                  >
                    {/* react-pdf 의 Image 는 HTML img 가 아니라 alt 를 받지 않는다 — 규칙이 오인한다. */}
                    {/* eslint-disable-next-line jsx-a11y/alt-text */}
                    <Image src={ph.src} style={{ width: '100%', height: lay.imgMM * MM, objectFit: 'cover' }} />
                    {ph.caption ? <Text style={S.phCap}>{ph.caption}</Text> : null}
                  </View>
                ))}
              </View>
            </View>
          </>
        )}

        <Text style={S.h2}>4. 교환 부품</Text>
        <View style={[S.table, { marginBottom: 0 }]}>
          <View style={[S.row, { borderBottomWidth: W_BOX }]}>
            <Text style={[S.cell, S.th, { width: PCOL.no }]}>No</Text>
            <Text style={[S.cell, S.th, { width: PCOL_NAME }]}>부품명</Text>
            <Text style={[S.cell, S.th, { width: PCOL.code }]}>품번 · 규격</Text>
            <Text style={[S.cell, S.th, { width: PCOL.qty, borderRightWidth: 0 }]}>수량</Text>
          </View>
          {p.parts.map(r => (
            <View key={r.no} style={[S.row, { minHeight: partH }]} wrap={false}>
              <View style={[S.cell, { width: PCOL.no, alignItems: 'center' }]}><Text style={S.td}>{r.no}</Text></View>
              <View style={[S.cell, { width: PCOL_NAME }]}><Text style={S.td}>{r.name}</Text></View>
              <View style={[S.cell, { width: PCOL.code }]}><Text style={S.td}>{r.code}</Text></View>
              <View style={[S.cell, { width: PCOL.qty, alignItems: 'center', borderRightWidth: 0 }]}><Text style={S.td}>{r.quantity || ''}</Text></View>
            </View>
          ))}
          {Array.from({ length: blanks }, (_, i) => (
            <View key={`b-${i}`} style={[S.row, { minHeight: partH }]} wrap={false}>
              <View style={[S.cell, { width: PCOL.no, alignItems: 'center' }]}><Text style={S.td}>{p.parts.length + i + 1}</Text></View>
              <View style={[S.cell, { width: PCOL_NAME }]} />
              <View style={[S.cell, { width: PCOL.code }]} />
              <View style={[S.cell, { width: PCOL.qty, borderRightWidth: 0 }]} />
            </View>
          ))}
        </View>

        <View style={{ flexGrow: 1 }} />
        <View style={{ borderBottomWidth: 2, borderBottomColor: C_BLACK, marginTop: 3 * MM }} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 1 * MM }}>
          <Text style={{ fontSize: S_DOC }}>문서번호 : {docNumber(p.quoteNumber, 'repair')}</Text>
          <Text style={{ fontSize: S_DOC }}>수리담당 : {p.engineer} (TEL : {p.engineerTel})</Text>
        </View>
      </Page>
    </Document>
  )
}

export default RepairReportPDFDoc
