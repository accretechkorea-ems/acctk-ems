// 장비 사용 신청·승인서 PDF (A4 세로 1쪽) — 엑셀 「장비 사용승인서」 양식을 따른다.
//   1. 신청 기본정보 / 2. 장비 및 사용계획 / 3. 고객 / 보안 / 기대효과 / 4. 승인(도장 + 의견)
//
// 서버 라우트가 renderToBuffer 로 만든다(app/api/showroom/requests/shared.ts). 브라우저에서 쓰지 않으므로
// 'use client' 를 붙이지 않는다. 한글 폰트는 서버에 들어 있는 파일을 쓴다(아래 Font.register 설명).
// 결재란은 아마란스 결재표와 같은 모양이다 — 직급을 가로 헤더로 두고, 그 아래 도장, 그 아래 처리일과 이름.
// 맨 앞 칸은 기안자(신청자)다 — 아마란스처럼 상신한 순간 자기 칸에 도장이 찍혀 있다.
// 화면(components/approval/ApprovalTable.tsx)과 같은 배치라 종이와 화면이 따로 놀지 않는다.
// 도장은 이미지 없이 그린다: 빨간 원(Svg Circle) 안에 이름.
// 기안자 칸까지 합쳐 4칸까지는 지름 60, 그 위로는 48 로 줄이고, 결재자가 7명 이상이면 앞 6명만
// 칸으로 찍고 나머지는 결재란 아래 한 줄로 적어 한 쪽을 넘기지 않는다(기안자 + 결재자 6 = 7칸이 최대).
// 처리 전인 칸은 비워 두고 상태말(전결·대결·생략)만 작게 남긴다.
// 인쇄물이라 색은 화면 토큰이 아니라 인쇄용 값을 쓴다.

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
  /** 사용목적 5종 — 2026-09-21 부터 데모 외 목적도 신청·승인을 거친다. */
  purpose: string
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
  /** 결재란 — 결재선 순서대로. 처리 전인 칸은 date 를 비워 둔다(도장 자리가 빈다). */
  stamps: ApprovalStamp[]
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
  footer: { position: 'absolute', bottom: 20, left: 40, right: 40, fontSize: 7, color: GREY, textAlign: 'center' },
})

/** 한 줄 — 라벨/값 쌍을 가로로 나란히. 목적에 따라 비는 칸이 있어, 빈 값은 「해당없음」으로 채운다. */
function Row({ cells, minHeight }: { cells: [string, string][]; minHeight?: number }) {
  return (
    <View style={S.row} wrap={false}>
      {cells.map(([label, value]) => (
        <View key={label} style={{ flexDirection: 'row', flex: 1 }}>
          <Text style={[S.label, minHeight ? { minHeight } : {}]}>{label}</Text>
          <Text style={[S.value, minHeight ? { minHeight } : {}]}>{value.trim() || '해당없음'}</Text>
        </View>
      ))}
    </View>
  )
}

/**
 * 결재란 한 칸. 결재선 순서대로 왼쪽부터 놓인다.
 *   label — 승인 · 전결 · 대결 · 생략 · 반려. '승인' 이면 적지 않는다(기본값이라 칸이 좁아진다).
 *   date  — 처리한 날. 아직 처리 전이면 빈 문자열 → 도장 자리를 비운다.
 */
export type ApprovalStamp = {
  name: string
  position: string
  date: string
  label: string
}

/**
 * 칸 수에 맞춘 도장 지름. 기안자 칸까지 함께 센다 — 칸이 좁아지면 원도 줄인다.
 * 최대인 7칸(기안자 + 결재자 6)에서도 칸 폭이 약 68pt 라 지름 48 + 여백이 들어간다.
 */
const stampD = (cells: number): number => (cells <= 4 ? 60 : 48)
/** 한 쪽에 칸으로 찍는 최대 결재자 수. 이보다 많으면 나머지는 결재란 아래 한 줄로 적는다. */
const STAMP_MAX = 6

function Stamp({ name, d }: { name: string; d: number }) {
  // 이름이 길면(4자 이상) 글자를 줄여 원 안에 들어가게 한다.
  const size = name.length >= 4 ? (d >= 60 ? 10 : 8) : (d >= 60 ? 13 : 11)
  const box = d + 4
  return (
    <View style={{ width: box, height: box, position: 'relative' }}>
      <Svg width={box} height={box} viewBox={`0 0 ${box} ${box}`}>
        <Circle cx={box / 2} cy={box / 2} r={d / 2} stroke={STAMP} strokeWidth={2} fill="none" />
      </Svg>
      <View style={{ position: 'absolute', top: 0, left: 0, width: box, height: box, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: STAMP, fontSize: size }}>{name}</Text>
      </View>
    </View>
  )
}

/**
 * 결재란 — 아마란스 결재표. 직급을 가로 헤더로 두고, 그 아래 도장, 그 아래 처리일과 이름.
 * 맨 앞은 기안자 칸이다(결재선이 아니라 신청 정보에서 온다 — 판정에는 쓰이지 않는다).
 *
 * 기안자 직급은 승인서 데이터에 없어 헤더를 「기안」으로 둔다.
 */
function ApprovalBox({ stamps, decider, drafter }: { stamps: ApprovalStamp[]; decider: string; drafter: ApprovalStamp }) {
  const approvers = stamps.slice(0, STAMP_MAX)
  const rest = stamps.slice(STAMP_MAX)
  const shown = [drafter, ...approvers]
  const d = stampD(shown.length)
  return (
    <View>
      <View style={S.table}>
        {/* 직급 — 가로 헤더 */}
        <View style={S.row}>
          <Text style={[S.label, { width: 40, textAlign: 'center', justifyContent: 'center' }]}>{decider}</Text>
          {shown.map((s, i) => (
            <Text key={`h${i}`} style={[S.value, { backgroundColor: LABEL_BG, textAlign: 'center', fontSize: 8 }]}>
              {s.position || '-'}
            </Text>
          ))}
        </View>
        {/* 도장 — 처리 전이면 빈칸(상태말만) */}
        <View style={S.row}>
          <Text style={[S.label, { width: 40 }]}> </Text>
          {shown.map((s, i) => (
            <View key={`s${i}`} style={[S.value, { height: d + 14, alignItems: 'center', justifyContent: 'center' }]}>
              {s.date && s.label !== '생략'
                ? <Stamp name={s.name || '-'} d={d} />
                : <Text style={{ fontSize: 7, color: GREY }}>{s.label || ''}</Text>}
            </View>
          ))}
        </View>
        {/* 처리일 · 이름 */}
        <View style={S.row}>
          <Text style={[S.label, { width: 40 }]}> </Text>
          {shown.map((s, i) => (
            <View key={`f${i}`} style={[S.value, { alignItems: 'center', paddingVertical: 3 }]}>
              <Text style={{ fontSize: 7, color: GREY }}>{s.date || ' '}</Text>
              <Text style={{ fontSize: 8 }}>{s.name || '-'}</Text>
              {s.date && s.label && s.label !== '승인' && (
                <Text style={{ fontSize: 7, color: GREY }}>{s.label}</Text>
              )}
            </View>
          ))}
        </View>
      </View>
      {rest.length > 0 && (
        <Text style={{ fontSize: 7, color: GREY, marginTop: 3 }}>
          외 {rest.map(s => [s.position, s.name].filter(Boolean).join(' ')).join(' · ')} 결재
        </Text>
      )}
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
            <Row cells={[['사용목적', data.purpose], ['프로젝트명', data.projectName]]} />
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
          <ApprovalBox
            stamps={data.stamps}
            decider={decider}
            drafter={{ position: '기안', name: data.requesterName || '-', date: data.requestDate || '', label: '' }}
          />
          <View style={[S.table, { marginTop: 6 }]}>
            <View style={S.row}>
              <Text style={[S.label, { width: 40, textAlign: 'center' }]}>의견</Text>
              <Text style={[S.value, { minHeight: 44 }]}>{data.opinion.trim()}</Text>
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
