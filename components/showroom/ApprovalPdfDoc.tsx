// 장비 사용 신청·승인서 PDF (A4 세로 1쪽) — 엑셀 「장비 사용승인서」 양식을 따른다.
//   1. 신청 기본정보 / 2. 장비 및 사용계획 / 3. 고객 / 보안 / 기대효과 / 4. 승인(도장 + 의견)
//
// 서버 라우트가 renderToBuffer 로 만든다(app/api/showroom/requests/shared.ts). 브라우저에서 쓰지 않으므로
// 'use client' 를 붙이지 않는다. 한글 폰트는 서버에 들어 있는 파일을 쓴다(아래 Font.register 설명).
// 도장은 이미지 없이 그린다: 빨간 원(Svg Circle, 지름 60) 안에 승인자 이름, 원 아래 승인일.
// 승인 전(대기중·반려)에는 도장 자리를 비워 둔다. 인쇄물이라 색은 화면 토큰이 아니라 인쇄용 값을 쓴다.

import path from 'path'
import { Document, Page, Text, View, StyleSheet, Font, Svg, Circle } from '@react-pdf/renderer'

// 한글 폰트 — public/fonts/NanumGothic.ttf(TTF, SIL OFL)를 파일 경로로 등록한다.
// 예전에는 견적서(app/quote/QuotePDFDoc.tsx)처럼 Google Fonts 주소를 넣었는데, 승인서는 서버에서 만들어서
// 만들 때마다 외부로 요청이 나가고 외부가 느리거나 막히면 생성이 실패했다. 서버 코드라 URL 이 아니라
// 파일시스템 경로를 쓴다. (public/fonts/NotoSansCJK.ttf 는 이름과 달리 일본어판이라 한글이 없어 쓰지 않는다.)
// 굵기는 Regular 하나뿐이다 — Bold 파일이 없고, 이 문서는 fontWeight 를 쓰지 않는다.
// 모듈 최상단에서 한 번만 등록한다(렌더마다 다시 등록하지 않는다).
const FONT_FAMILY = 'NanumGothic'
Font.register({
  family: FONT_FAMILY,
  src: path.join(process.cwd(), 'public', 'fonts', 'NanumGothic.ttf'),
})

const INK = '#000000'
const GREY = '#6b7280'
const LABEL_BG = '#f3f4f6'
/** 도장 빨강 — 앱의 위험 색과 같은 값. */
const STAMP = '#dc2626'
const LINE = 0.7
const STAMP_D = 60

export type ApprovalPdfData = {
  requestNo: string
  /** 신청일 YYYY-MM-DD */
  requestDate: string
  requesterTeam: string
  requesterName: string
  /** 대기중 / 승인 / 반려 / 확인(사후 신청의 승인) */
  statusLabel: string
  isRetroactive: boolean
  /**
   * 신청 사유 — 승인서에는 찍지 않는다. 사유가 상세 내용과 같은 값이라(2. 「사용내용」) 두 번 찍히게 되어 줄을 뺐다.
   * 넘겨주는 쪽(app/api/showroom/requests/shared.ts)이 그대로 채우므로 칸은 남겨 둔다.
   */
  reason: string
  deviceName: string
  siteName: string
  projectName: string
  /** 'YYYY-MM-DD HH:MM' */
  start: string
  end: string
  hours: string
  content: string
  sampleMaterial: string
  carriedOut: string
  expectedCost: string
  customerName: string
  customerDept: string
  nda: string
  expectedResult: string
  /** 승인(확인)된 뒤에만. 승인 전에는 null — 도장 자리를 비운다 */
  stamp: { name: string; date: string } | null
  /** 승인 의견 또는 반려 사유 */
  opinion: string
}

const S = StyleSheet.create({
  page: { fontFamily: FONT_FAMILY, fontSize: 9, color: INK, paddingTop: 40, paddingBottom: 40, paddingHorizontal: 40 },
  title: { fontSize: 18, textAlign: 'center', letterSpacing: 3, marginBottom: 4 },
  subtitle: { fontSize: 9, textAlign: 'center', color: GREY, marginBottom: 18 },
  section: { marginBottom: 14 },
  sectionTitle: { fontSize: 11, marginBottom: 5 },
  table: { borderTopWidth: LINE, borderLeftWidth: LINE, borderColor: INK },
  row: { flexDirection: 'row' },
  label: {
    width: 76, backgroundColor: LABEL_BG, paddingVertical: 5, paddingHorizontal: 6,
    borderRightWidth: LINE, borderBottomWidth: LINE, borderColor: INK,
  },
  value: {
    flex: 1, paddingVertical: 5, paddingHorizontal: 6,
    borderRightWidth: LINE, borderBottomWidth: LINE, borderColor: INK,
  },
  stampCell: {
    width: 130, height: 104, alignItems: 'center', justifyContent: 'center',
    borderRightWidth: LINE, borderBottomWidth: LINE, borderColor: INK,
  },
  footer: { position: 'absolute', bottom: 20, left: 40, right: 40, fontSize: 7, color: GREY, textAlign: 'center' },
})

/** 한 줄 — 라벨/값 쌍을 가로로 나란히. 값이 비면 '-'. */
function Row({ cells, minHeight }: { cells: [string, string][]; minHeight?: number }) {
  return (
    <View style={S.row} wrap={false}>
      {cells.map(([label, value]) => (
        <View key={label} style={{ flexDirection: 'row', flex: 1 }}>
          <Text style={[S.label, minHeight ? { minHeight } : {}]}>{label}</Text>
          <Text style={[S.value, minHeight ? { minHeight } : {}]}>{value.trim() || '-'}</Text>
        </View>
      ))}
    </View>
  )
}

function Stamp({ name, date }: { name: string; date: string }) {
  // 이름이 길면(4자 이상) 글자를 줄여 원 안에 들어가게 한다.
  const size = name.length >= 4 ? 10 : 13
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width: STAMP_D + 4, height: STAMP_D + 4, position: 'relative' }}>
        <Svg width={STAMP_D + 4} height={STAMP_D + 4} viewBox={`0 0 ${STAMP_D + 4} ${STAMP_D + 4}`}>
          <Circle cx={(STAMP_D + 4) / 2} cy={(STAMP_D + 4) / 2} r={STAMP_D / 2} stroke={STAMP} strokeWidth={2} fill="none" />
        </Svg>
        <View style={{ position: 'absolute', top: 0, left: 0, width: STAMP_D + 4, height: STAMP_D + 4, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: STAMP, fontSize: size }}>{name}</Text>
        </View>
      </View>
      <Text style={{ color: STAMP, fontSize: 7, marginTop: 2 }}>{date}</Text>
    </View>
  )
}

function ApprovalPdfDoc({ data }: { data: ApprovalPdfData }) {
  const plan = data.isRetroactive ? '사용' : '계획'
  const decider = data.isRetroactive ? '확인' : '승인'
  return (
    <Document title={`장비 사용 신청·승인서 ${data.requestNo}`}>
      <Page size="A4" style={S.page}>
        <Text style={S.title}>장비 사용 신청·승인서</Text>
        <Text style={S.subtitle}>
          {data.requestNo}{data.isRetroactive ? ' · 사후 신청' : ''}
        </Text>

        {/* 1. 신청 기본정보 */}
        <View style={S.section}>
          <Text style={S.sectionTitle}>1. 신청 기본정보</Text>
          <View style={S.table}>
            <Row cells={[['신청번호', data.requestNo], ['신청일', data.requestDate]]} />
            <Row cells={[['사업부/팀', data.requesterTeam], ['신청자', data.requesterName]]} />
            <Row cells={[['승인상태', data.statusLabel], ['신청 유형', data.isRetroactive ? '사후 신청' : '사전 신청']]} />
          </View>
        </View>

        {/* 2. 장비 및 사용계획 */}
        <View style={S.section}>
          <Text style={S.sectionTitle}>2. 장비 및 사용계획</Text>
          <View style={S.table}>
            <Row cells={[['장비명', data.deviceName], ['설치위치', data.siteName]]} />
            <Row cells={[['사용목적', '고객 데모'], ['프로젝트명', data.projectName]]} />
            <Row cells={[[`${plan} 시작`, data.start], [`${plan} 종료`, data.end]]} />
            <Row cells={[[`${plan}시간`, data.hours], ['외부반출', data.carriedOut]]} />
            <Row cells={[['샘플/자재', data.sampleMaterial], ['예상비용', data.expectedCost]]} />
            <Row cells={[['사용내용', data.content]]} minHeight={48} />
          </View>
        </View>

        {/* 3. 고객 / 보안 / 기대효과 */}
        <View style={S.section}>
          <Text style={S.sectionTitle}>3. 고객 / 보안 / 기대효과</Text>
          <View style={S.table}>
            <Row cells={[['고객사', data.customerName], ['고객부서', data.customerDept]]} />
            <Row cells={[['NDA', data.nda]]} />
            <Row cells={[['기대결과', data.expectedResult]]} minHeight={40} />
          </View>
        </View>

        {/* 4. 승인 — 도장 + 의견 */}
        <View style={S.section} wrap={false}>
          <Text style={S.sectionTitle}>4. {decider}</Text>
          <View style={S.table}>
            <View style={S.row}>
              <Text style={[S.label, { width: 130, textAlign: 'center' }]}>{decider}자</Text>
              <Text style={[S.value, { backgroundColor: LABEL_BG }]}>의견</Text>
            </View>
            <View style={S.row}>
              <View style={S.stampCell}>
                {data.stamp && <Stamp name={data.stamp.name} date={data.stamp.date} />}
              </View>
              <Text style={[S.value, { minHeight: 104 }]}>{data.opinion.trim()}</Text>
            </View>
          </View>
        </View>

        <Text style={S.footer} fixed>{data.requestNo} · 아크레텍코리아 쇼룸 장비 사용 신청·승인서</Text>
      </Page>
    </Document>
  )
}

/** renderToBuffer 에 넘길 문서 요소. 함수 컴포넌트를 그대로 넘기면 Document 타입과 맞지 않아 여기서 펼친다. */
export const approvalPdfDocument = (data: ApprovalPdfData) => ApprovalPdfDoc({ data })
