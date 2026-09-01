'use client'

import React from 'react'
import { Document, Page, Text, View, StyleSheet, Image, Font } from '@react-pdf/renderer'
import type { QuoteRow } from './types'
import { numKR, amountToKorean } from './format'

Font.register({
  family: 'NotoSansCJK',
  src: 'https://fonts.gstatic.com/s/notosanskr/v36/PbyxFmXiEBPT4ITbgNA5Cgms3VYcOA-vvnIzzuoyeLTq8H4hfeE.ttf',
})

// 할인 표기 색 — 앱 전역에서 쓰는 위험/차감 색과 같은 값.
const DANGER = '#dc2626'

const THICK = 1.3
const THIN = 0.5
// 열 너비 — 금액이 억 단위(₩ 999,999,999)가 되어도 한 줄에 들어가도록 잡은 값이다.
// 표 안에서 가장 좁았던 부가세 칸이 넘쳐 줄바꿈되던 것을 품명·수량·단가·공급가액에서 조금씩 덜어 채웠다.
// 폭을 줄일 때는 각 칸이 실제로 담는 가장 긴 글자를 먼저 재 볼 것(품명 183pt, 품번 53pt, 억 단위 금액 59pt).
const COL = { seq: '5%', code: '12%', name: '36.4%', qty: '5.4%', unit: '13.4%', supply: '13.8%', tax: '14%' }
const COL_LABEL_SPAN = '53.4%'  // 요약행 라벨 셀 = seq(5)+code(12)+name(36.4) 합, 합계값이 계속 맨 오른쪽 정렬
// 선두 수동 번호(1. / 2) / 3.) 제거 — 자동 순번과 중복 방지. 데이터는 안 바꾸고 표시 직전에만 적용.
const stripLeadNo = (s: string) => (s || '').replace(/^\s*\d+[.)]\s*/, '')

const S = StyleSheet.create({
  page: {
    fontFamily: 'NotoSansCJK', fontSize: 9,
    paddingTop: 38, paddingBottom: 25, paddingLeft: 30, paddingRight: 30,
    backgroundColor: '#ffffff',
  },
  titleText: { fontSize: 22, fontFamily: 'NotoSansCJK', letterSpacing: 8, textAlign: 'center', paddingBottom: 1 },
  dateRow: { textAlign: 'center', fontSize: 10, marginBottom: 10 },
  headerRow: { flexDirection: 'row', marginBottom: 4 },
  headerLeft: { flex: 1 },
  companyName: { fontSize: 12, fontFamily: 'NotoSansCJK', textDecoration: 'underline', marginBottom: 4 },
  headerSubText: { fontSize: 10, marginBottom: 5 },
  conditionRow: { flexDirection: 'row', marginBottom: 3 },
  conditionLabel: { fontSize: 10, width: 85, paddingLeft: 8 },
  conditionValue: { fontSize: 10 },
  headerRight: { width: 195, alignItems: 'flex-start' },
  // 로고 원본(pdflogo.png)의 가로세로 비가 6.4:1 이라 높이를 폭 ÷ 6.4 로 맞춘다. 어긋나면 눌리거나 늘어난다.
  logo: { width: 125, height: 19.53, marginBottom: 4 },
  headerRightText: { fontSize: 9.5, textAlign: 'left', marginBottom: 2 },
  dividerBox: {
    borderTopWidth: THICK, borderColor: '#000',
    paddingVertical: 4, marginTop: 5, marginBottom: 0,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
  },
  dividerText: { fontSize: 11, fontFamily: 'NotoSansCJK', textAlign: 'center' },
  // flexGrow: 품목이 적어도 표가 페이지 세로를 채우고 합계 블록이 하단에 놓이도록 한다.
  // 남는 공간이 없으면(품목이 많아 2페이지로 넘어가면) 아무 것도 더하지 않아 기존 동작 그대로다.
  table: { width: '100%', borderWidth: THICK, borderColor: '#000', flexGrow: 1 },
  tableHeader: { flexDirection: 'row', backgroundColor: '#FFCC99', borderBottomWidth: THICK, borderBottomColor: '#000' },
  th: { borderRightWidth: THICK, borderRightColor: '#000', paddingVertical: 1, paddingHorizontal: 3, fontFamily: 'NotoSansCJK', fontSize: 9, textAlign: 'center' },
  thLast: { paddingVertical: 1, paddingHorizontal: 3, fontFamily: 'NotoSansCJK', fontSize: 9, textAlign: 'center' },
  itemRow: { flexDirection: 'row', borderTopWidth: THIN, borderTopColor: '#999', minHeight: 16 },
  td: { borderRightWidth: THICK, borderRightColor: '#000', paddingVertical: 3, paddingHorizontal: 4, fontSize: 9 },
  tdLast: { paddingVertical: 3, paddingHorizontal: 4, fontSize: 9 },
  remarkRow: { flexDirection: 'row', minHeight: 80 },
  remarkContent: { flex: 1, borderRightWidth: THICK, borderRightColor: '#000', padding: 6 },
  remarkLine: { fontSize: 8.5, marginBottom: 2 },
  summaryRow: { flexDirection: 'row', borderTopWidth: THICK, borderTopColor: '#000', height: 22, alignItems: 'center' },
  // 고객사 서명란 — 표 바깥, 표 아래에 한 줄. 표가 flexGrow 로 남는 높이를 먹으므로
  // 이 줄의 높이만큼 표의 빈 영역이 줄어들 뿐 품목·비고·합계의 순서와 간격은 그대로다.
  signRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 },
  signText: { fontSize: 9, fontFamily: 'NotoSansCJK' },
})

export type PDFDocProps = {
  company: string; receiver: string; quoteNo: string; dateDisplay: string
  rows: QuoteRow[]; remarks: string; engineerName: string; engineerTel: string
  totalSupply: number; totalTax: number; totalAmount: number
  showWatermark?: boolean
  // 화면에서 체크했을 때만 표 아래 서명란을 낸다. DB 에 저장하지 않는 표시 전용 값.
  showSignature?: boolean
}

export const QuotePDFDoc = React.memo(function QuotePDFDoc({ company, receiver, quoteNo, dateDisplay, rows, remarks, engineerName, engineerTel, totalSupply, totalTax, totalAmount, showWatermark, showSignature }: PDFDocProps) {
  const EMPTY_ROWS = Math.max(0, 10 - rows.length)
  // 할인은 품목 목록의 맨 끝(합계 바로 위)에 고정한다 — 입력 순서와 무관하게.
  const orderedRows = [...rows.filter(r => r.row_kind !== 'discount'), ...rows.filter(r => r.row_kind === 'discount')]
  // 금액 표기 — 음수는 빼는 금액이라는 뜻이므로 부호를 붙인다.
  const won = (v: number) => (v < 0 ? `−₩  ${numKR(Math.abs(v))}` : `₩  ${numKR(v)}`)
  return (
    <Document>
      <Page size="A4" style={S.page}>
        {showWatermark && (
          <View style={{ position: 'absolute', top: 180, left: 20, right: 20, alignItems: 'center', transform: 'rotate(-35deg)', zIndex: 999, opacity: 0.10 }}>
            <Text style={{ fontSize: 72, fontFamily: 'NotoSansCJK', color: '#000000', textAlign: 'center' }}>미리보기</Text>
            <Text style={{ fontSize: 36, fontFamily: 'NotoSansCJK', color: '#000000', textAlign: 'center', marginTop: 12 }}>{engineerName}</Text>
          </View>
        )}
        <View style={{ position: 'relative', marginBottom: 3 }}>
          <View style={{ alignItems: 'center', marginBottom: 0 }}>
            <Text style={S.titleText}>견　적　서</Text>
            <View style={{ height: 1, backgroundColor: '#000', width: 150, marginBottom: 1 }} />
            <View style={{ height: 1, backgroundColor: '#000', width: 150 }} />
          </View>
          <View style={{ position: 'absolute', right: 0, top: 8 }}>
            <Text style={{ fontSize: 9, textAlign: 'right', marginBottom: 3 }}>{quoteNo}</Text>
            {receiver ? <Text style={{ fontSize: 9, textAlign: 'right' }}>수신인 : {receiver}</Text> : null}
          </View>
        </View>
        <Text style={S.dateRow}>{dateDisplay}</Text>
        <View style={S.headerRow}>
          <View style={S.headerLeft}>
            <Text style={S.companyName}>{company || '　'} 귀하</Text>
            <Text style={S.headerSubText}>아래와 같이 견적합니다</Text>
            {[['1.납품일정 :', '담당자와 협의'], ['2.지불조건 :', '익월말 현금 결제'], ['3.인도조건 :', '지정장소'], ['4.견적유효 :', '작성일로부터 1개월']].map(([label, val]) => (
              <View key={label} style={S.conditionRow}>
                <Text style={S.conditionLabel}>{label}</Text>
                <Text style={S.conditionValue}>{val}</Text>
              </View>
            ))}
          </View>
          <View style={S.headerRight}>
            <Image src="/pdflogo.png" style={S.logo} />
            <Text style={S.headerRightText}>화성시 동탄대로 24길 31-8</Text>
            <Text style={S.headerRightText}>Accretech Korea Co., Ltd.</Text>
            <Text style={S.headerRightText}>대표이사 이상철</Text>
            <Text style={S.headerRightText}>대표전화 031)786-4093</Text>
          </View>
        </View>
        <View style={S.dividerBox}>
          {/* 할인이 품목 합계보다 커서 총액이 음수가 되면 amountToKorean 이 빈 문자열을 내므로 부호를 앞에 붙여 읽히게 한다 */}
          <Text style={S.dividerText}>
            일금　　{totalSupply < 0 ? `마이너스 ${amountToKorean(-totalSupply)}` : amountToKorean(totalSupply)}　　({totalSupply !== 0 ? won(totalSupply).replace('  ', '') : '₩0'} -)　　부가세 별도
          </Text>
        </View>
        <View style={S.table}>
          <View style={S.tableHeader}>
            <Text style={[S.th, { width: COL.seq }]}>순번</Text>
            <Text style={[S.th, { width: COL.code }]}>품번</Text>
            <Text style={[S.th, { width: COL.name, borderRightWidth: 0 }]}>품　　명</Text>
            <Text style={[S.th, { width: COL.qty, borderLeftWidth: THICK, borderLeftColor: '#000' }]}>수량</Text>
            <Text style={[S.th, { width: COL.unit }]}>단가</Text>
            <Text style={[S.th, { width: COL.supply }]}>공급가액</Text>
            <Text style={[S.thLast, { width: COL.tax }]}>부가세</Text>
          </View>
          {orderedRows.map((row, ri) => {
            // 국내조달품 — 포함사항으로만 나가고 금액은 고객에게 공개하지 않는다(합계에도 미포함).
            const hideAmount = row.row_kind === 'domestic'
            // 할인 — 라벨·금액을 빨간색으로 내고 수량·단가·부가세 칸은 비운다(부가세는 합계에만 반영).
            // 순번·품번도 붙이지 않고 행 안의 세로선을 전부 지워, 라벨과 금액만 놓인 한 줄로 보이게 한다.
            const isDiscount = row.row_kind === 'discount'
            const noRule = isDiscount ? { borderRightWidth: 0 } : {}
            return (
            <View key={row.id} style={[S.itemRow, { borderBottomWidth: THICK, borderBottomColor: '#000' }]}>
              <View style={[S.td, { width: COL.seq, justifyContent: 'center', alignItems: 'center' }, noRule]}>
                <Text style={{ textAlign: 'center' }}>{isDiscount ? '' : ri + 1}</Text>
              </View>
              <View style={[S.td, { width: COL.code, justifyContent: 'center', alignItems: 'center' }, noRule]}>
                {/* 품번 — 가격표 선택값이든 직접 입력값이든 행의 partCode 를 쓴다.
                    내용이 있는 행인데 품번이 없으면(서비스비 등) '-' 로 채운다. 할인은 품번 자체가 없어 비운다. */}
                <Text style={{ textAlign: 'center' }}>
                  {isDiscount ? '' : (row.partCode.trim() || ((row.itemText.trim() || row.supply_price > 0) ? '-' : ''))}
                </Text>
              </View>
              <View style={[S.td, { width: COL.name, borderRightWidth: 0, alignItems: isDiscount ? 'flex-end' : undefined, justifyContent: 'center' }]}>
                <Text style={isDiscount ? { color: DANGER, textAlign: 'right' } : undefined}>{stripLeadNo(row.itemText)}</Text>
                {row.subLines.map((line, i) => line ? <Text key={i} style={{ fontSize: 8.5, marginTop: 1 }}>{line}</Text> : null)}
              </View>
              <View style={[S.td, { width: COL.qty, borderLeftWidth: isDiscount ? 0 : THICK, borderLeftColor: '#000', justifyContent: 'center', alignItems: 'center' }, noRule]}>
                <Text style={{ textAlign: 'center' }}>{row.quantity > 0 ? String(row.quantity) : ''}</Text>
              </View>
              <View style={[S.td, { width: COL.unit, justifyContent: 'center', alignItems: hideAmount ? 'center' : 'flex-end' }, noRule]}>
                <Text>{hideAmount ? '-' : (row.unit_price > 0 ? `₩  ${numKR(row.unit_price)}` : '')}</Text>
              </View>
              <View style={[S.td, { width: COL.supply, justifyContent: 'center', alignItems: hideAmount ? 'center' : 'flex-end' }, noRule]}>
                <Text style={isDiscount ? { color: DANGER } : undefined}>
                  {hideAmount ? '-' : (row.supply_price !== 0 ? won(row.supply_price) : '')}
                </Text>
              </View>
              <View style={[S.tdLast, { width: COL.tax, justifyContent: 'center', alignItems: hideAmount ? 'center' : 'flex-end' }]}>
                <Text style={{ paddingRight: hideAmount ? 0 : 4 }}>{hideAmount ? '-' : (row.tax > 0 ? `₩  ${numKR(row.tax)}` : '')}</Text>
              </View>
            </View>
            )
          })}
          {/* 표의 남는 세로 공간을 흡수하는 빈 영역. 최소 높이는 기존과 동일(부족한 행 × 18pt). */}
          <View style={{ flexDirection: 'row', flexGrow: 1, minHeight: EMPTY_ROWS * 18 }}>
            {/* 순번·품번·품명: 빈 행에선 세로 구분선을 그리지 않음(비고 영역처럼 열어둠) */}
            <View style={{ width: COL.seq }} />
            <View style={{ width: COL.code }} />
            <View style={{ width: COL.name }} />
            {/* 금액 칸(수량~부가세)은 구분선 유지. 수량 좌측선(=금액영역 시작, 55%)은 아래 비고 셀 우측선과 이어짐 */}
            <View style={{ width: COL.qty, borderLeftWidth: THICK, borderLeftColor: '#000', borderRightWidth: THICK, borderRightColor: '#000' }} />
            <View style={{ width: COL.unit, borderRightWidth: THICK, borderRightColor: '#000' }} />
            <View style={{ width: COL.supply, borderRightWidth: THICK, borderRightColor: '#000' }} />
            <View style={{ width: COL.tax }} />
          </View>
          <View style={S.remarkRow}>
            <View style={[S.remarkContent, { borderRightWidth: 0, justifyContent: 'flex-end' }]}>
              <Text style={[S.remarkLine, { fontFamily: 'NotoSansCJK' }]}>　비고</Text>
              {remarks.split('\n').map((line, i) => <Text key={i} style={S.remarkLine}>{line}</Text>)}
              <Text style={[S.remarkLine, { marginTop: 2 }]}>* 담당자 : {engineerName}{engineerTel ? ` (TEL : ${engineerTel})` : ''}</Text>
            </View>
            <View style={{ width: COL.qty, borderLeftWidth: THICK, borderLeftColor: '#000', borderRightWidth: THICK, borderRightColor: '#000' }} />
            <View style={{ width: COL.unit, borderRightWidth: THICK, borderRightColor: '#000' }} />
            <View style={{ width: COL.supply, borderRightWidth: THICK, borderRightColor: '#000' }} />
            <View style={{ width: COL.tax }} />
          </View>
          {[{ label: '합　　계', value: totalSupply }, { label: '부 가 세', value: totalTax }, { label: '총　　계', value: totalAmount }].map(({ label, value }) => (
            <View key={label} style={S.summaryRow}>
              <View style={[S.td, { width: COL_LABEL_SPAN, height: 22, justifyContent: 'center', alignItems: 'center', borderRightWidth: 0 }]}>
                <Text style={{ fontSize: 9, fontFamily: 'NotoSansCJK' }}>{label}</Text>
              </View>
              <View style={[S.td, { width: COL.qty, height: 22, borderLeftWidth: THICK, borderLeftColor: '#000' }]} />
              <View style={[S.td, { width: COL.unit, height: 22 }]} />
              <View style={[S.td, { width: COL.supply, height: 22 }]} />
              <View style={[S.tdLast, { width: COL.tax, height: 22, justifyContent: 'center' }]}>
                <Text style={{ fontSize: 9, textAlign: 'right', paddingRight: 4, color: value < 0 ? DANGER : undefined }}>
                  {value !== 0 ? won(value).replace('  ', '') : ''}
                </Text>
              </View>
            </View>
          ))}
        </View>
        {showSignature && (
          <View style={S.signRow}>
            <Text style={S.signText}>발주 확인 및 서명 :   ____________(서명)</Text>
          </View>
        )}
      </Page>
    </Document>
  )
}, (prev, next) => JSON.stringify(prev) === JSON.stringify(next))
