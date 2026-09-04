'use client'

import React from 'react'
// Image 를 그대로 쓰면 a11y 규칙(alt 필요)이 걸린다. PDF 그림은 HTML img 가 아니고
// react-pdf 의 Image 는 alt 를 받지 않으므로 이름을 바꿔 쓴다.
import { Document, Page, Text, View, StyleSheet, Image as PdfImage, Font } from '@react-pdf/renderer'

// 리드 상세 출력물. 관리자가 배정된 담당자에게 메일로 보내는 용도라
// 화면 상세에 있는 항목만 담는다(담당자·상태·메모·미진행 사유 같은 관리 정보는 넣지 않는다).
//
// 폰트·로고·용지 여백은 견적서(QuotePDFDoc)와 같은 값을 쓴다. 한글이 나오는 문서라
// 폰트를 등록하지 않으면 글자가 통째로 비어 나온다.
Font.register({
  family: 'NotoSansCJK',
  src: 'https://fonts.gstatic.com/s/notosanskr/v36/PbyxFmXiEBPT4ITbgNA5Cgms3VYcOA-vvnIzzuoyeLTq8H4hfeE.ttf',
})

const TEXT = '#111827'
const MUTED = '#6b7280'
const FAINT = '#9ca3af'
// 인쇄물이라 화면용 연한 선(#ebebeb)은 종이에서 거의 보이지 않는다.
// 디자인 토큰의 진한 테두리(--color-border-strong)를 쓴다.
const BORDER = '#d1d5db'
const BLUE = '#234ea2'

const S = StyleSheet.create({
  page: {
    fontFamily: 'NotoSansCJK', fontSize: 9, color: TEXT,
    paddingTop: 38, paddingBottom: 30, paddingLeft: 30, paddingRight: 30,
    backgroundColor: '#ffffff',
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  headerLeft: { flex: 1 },
  title: { fontSize: 16, color: TEXT, marginBottom: 5 },
  headerMeta: { flexDirection: 'row' },
  metaLabel: { fontSize: 9, color: FAINT, marginRight: 4 },
  metaValue: { fontSize: 9, color: TEXT, marginRight: 12 },
  // 로고 원본(pdflogo.png)의 가로세로 비가 6.4:1 이라 높이를 폭 ÷ 6.4 로 맞춘다.
  logo: { width: 110, height: 17.19 },
  rule: { borderBottomWidth: 1, borderBottomColor: TEXT, marginBottom: 10 },

  // 좌우 폭을 둘 다 %로 못 박는다. 한쪽을 flex: 1 로 두면 긴 노트가 들어왔을 때
  // 오른쪽 칸이 제 폭보다 넓어져 글자가 용지 경계를 넘어 잘렸다.
  body: { flexDirection: 'row', alignItems: 'stretch' },
  // 좌우 반반. 값 칸은 535 × 50% − 10(열 간격) − 14(카드 안쪽) − 46(라벨) ≈ 198pt 로,
  // 실제 데이터의 이메일·주소는 한 줄에 들어간다(40자를 넘는 이메일은 두 줄이 된다).
  left: { width: '50%', paddingRight: 10 },
  right: { width: '50%' },
  // 카드 사이 간격. 마지막 카드는 아래 여백을 빼서 노트 칸과 바닥이 맞는다.
  cardGap: { marginBottom: 8 },

  card: { borderWidth: 0.5, borderColor: BORDER, borderRadius: 4, padding: 7 },
  // 노트 칸은 왼쪽 네 장을 합한 높이만큼 늘어난다(짧아도 그 높이를 지킨다).
  noteCard: { borderWidth: 0.5, borderColor: BORDER, borderRadius: 4, padding: 7, flexGrow: 1 },
  cardTitle: { fontSize: 10, color: BLUE, marginBottom: 5, paddingBottom: 4, borderBottomWidth: 0.5, borderBottomColor: BORDER },
  row: { flexDirection: 'row', marginBottom: 3 },
  key: { width: 46, color: FAINT, fontSize: 8 },
  val: { flex: 1, color: TEXT, fontSize: 9, lineHeight: 1.4 },

  noteBody: { fontSize: 9, color: TEXT, lineHeight: 1.6 },

  // 명함 이미지. 높이를 고정하고 objectFit 으로 비율을 지킨다 —
  // 세로 사진이든 가로 명함이든 이 상자 안에 들어가고, 늘어나거나 눌리지 않는다.
  // 왼쪽 네 장(약 455pt)에 이 상자를 더해도 본문 높이(약 709pt) 안에 남는다.
  cardImage: { width: '100%', height: 120, objectFit: 'contain' },

  footer: {
    position: 'absolute', bottom: 16, left: 30, right: 30,
    borderTopWidth: 0.5, borderTopColor: BORDER, paddingTop: 5,
    flexDirection: 'row', justifyContent: 'space-between',
  },
  footerText: { fontSize: 7.5, color: MUTED },
})

// 공백 없이 길게 이어진 한글·한자 덩어리(예: "회의록회의록회의록…")는 줄을 끊을 자리가 없어
// 상자를 뚫고 나간다. 보이지 않는 줄바꿈 문자(U+200B)를 끼워 보니 줄은 바뀌지만 끊긴 자리마다
// 하이픈이 붙었다 — react-pdf 가 그 자리를 하이프네이션으로 처리한다. 한글에 하이픈은 틀린
// 표기라, 상자 폭에 맞는 글자 수마다 줄바꿈을 직접 넣는 쪽으로 바꿨다.
//
// 한 줄 글자 수 = (상자 안쪽 폭) ÷ 한글 한 글자 폭. 한글은 글자 크기(9pt)와 폭이 같다.
//   노트  : (535 × 50% − 14) ÷ 9 ≈ 28  → 27
//   값 칸 : (535 × 50% − 14 − 46) ÷ 9 ≈ 23 → 21
// 15자가 넘는 연속 덩어리에만 적용하므로 보통 문장과 라틴 문자(자체 하이프네이션이 처리)는 그대로다.
// 글자를 더하거나 지우지 않고, 화면·DB 의 값도 건드리지 않는다(출력 직전 표시용).
const CJK_RUN = /[\uAC00-\uD7A3\u3130-\u318F\u4E00-\u9FFF\u3040-\u30FF]{15,}/g
const NOTE_CHARS = 27
const VALUE_CHARS = 21
const breakable = (v: string, per: number) =>
  v.replace(CJK_RUN, run => (run.match(new RegExp('.{1,' + per + '}', 'g')) ?? [run]).join('\n'))

/** 라벨-값 한 줄. 화면과 같이 값이 비면 '-' 로 자리를 지킨다. */
function Row({ k, v }: { k: string; v: string | null | undefined }) {
  return (
    <View style={S.row}>
      <Text style={S.key}>{k}</Text>
      <Text style={S.val}>{breakable(v?.trim() || '-', VALUE_CHARS)}</Text>
    </View>
  )
}

function Card({ title, last, children }: { title: string; last?: boolean; children: React.ReactNode }) {
  // wrap={false} — 카드가 페이지 경계에서 반으로 갈리지 않게 한다.
  return (
    <View style={last ? undefined : S.cardGap} wrap={false}>
      <View style={S.card}>
        <Text style={S.cardTitle}>{title}</Text>
        {children}
      </View>
    </View>
  )
}

export type LeadPDFProps = {
  leadNo: string | null
  createdAt: string
  partnerCompany: string; partnerName: string; partnerContact: string | null
  customerCompany: string; industry: string; products: string
  address: string | null; city: string; country: string
  interestProduct: string; budgetStatus: string
  purchasePeriod: string | null; expectedPurchase: string | null
  competitor: string; requestNote: string | null
  contactName: string | null; contactDeptTitle: string
  contactEmail: string; contactOfficeTel: string | null; contactMobile: string
  meetingNote: string
  /** 명함 이미지(data URL). 없으면 null — 그 자리는 비워 둔다. */
  businessCard?: string | null
}

export const LeadPDFDoc = React.memo(function LeadPDFDoc(p: LeadPDFProps) {
  return (
    <Document>
      <Page size="A4" style={S.page}>
        <View style={S.header}>
          <View style={S.headerLeft}>
            <Text style={S.title}>리드 정보</Text>
            <View style={S.headerMeta}>
              <Text style={S.metaLabel}>리드 번호</Text>
              <Text style={S.metaValue}>{p.leadNo || '-'}</Text>
              <Text style={S.metaLabel}>등록일</Text>
              <Text style={S.metaValue}>{p.createdAt}</Text>
            </View>
          </View>
          <PdfImage src="/pdflogo.png" style={S.logo} />
        </View>
        <View style={S.rule} />

        <View style={S.body}>
          {/* 왼쪽 — 위에서 아래로 한 줄씩. 한 장을 한 열 폭으로 쓰므로 긴 이메일·주소가 접히지 않는다. */}
          <View style={S.left}>
            <Card title="파트너사">
              <Row k="회사명" v={p.partnerCompany} />
              <Row k="등록자" v={p.partnerName} />
              <Row k="연락처" v={p.partnerContact} />
            </Card>
            <Card title="관심 제품">
              <Row k="관심 제품" v={p.interestProduct} />
              <Row k="예산" v={p.budgetStatus} />
              <Row k="구매 기간" v={p.purchasePeriod} />
              <Row k="구매 시기" v={p.expectedPurchase} />
              <Row k="경쟁사" v={p.competitor} />
              <Row k="요청사항" v={p.requestNote} />
            </Card>
            <Card title="고객사">
              <Row k="회사명" v={p.customerCompany} />
              <Row k="산업군" v={p.industry} />
              <Row k="생산품" v={p.products} />
              <Row k="주소" v={p.address} />
              <Row k="시 / 국가" v={`${p.city} / ${p.country}`} />
            </Card>
            <Card title="고객 정보" last={!p.businessCard}>
              <Row k="이름" v={p.contactName} />
              <Row k="부서 / 직위" v={p.contactDeptTitle} />
              <Row k="이메일" v={p.contactEmail} />
              <Row k="회사번호" v={p.contactOfficeTel} />
              <Row k="휴대폰" v={p.contactMobile} />
            </Card>
            {/* 명함 — 고객 정보 카드 아래. 없으면 이 자리 자체가 없다. */}
            {p.businessCard && (
              <View wrap={false}>
                <View style={S.card}>
                  <Text style={S.cardTitle}>명함</Text>
                  {/* 높이를 못 박고 objectFit: contain 으로 비율을 지킨다.
                      이 높이(CARD_IMG_H)는 왼쪽 카드가 다 늘어나도 한 장 안에 남는 여백에서 잡았다. */}
                  <PdfImage src={p.businessCard} style={S.cardImage} />
                </View>
              </View>
            )}
          </View>

          {/* 미팅 노트 — 왼쪽 네 장을 합한 높이를 채우고, 넘치면 잘라내지 않고 다음 장으로 흐른다.
              (2쪽에는 왼쪽 카드 없이 노트만 이어진다) */}
          <View style={S.right}>
            <View style={S.noteCard}>
              <Text style={S.cardTitle}>미팅 노트</Text>
              <Text style={S.noteBody}>{breakable(p.meetingNote?.trim() || '-', NOTE_CHARS)}</Text>
            </View>
          </View>
        </View>

        <View style={S.footer} fixed>
          <Text style={S.footerText}>Accretech Korea Co., Ltd.  ·  화성시 동탄대로 24길 31-8  ·  대표전화 031)786-4093</Text>
          <Text style={S.footerText} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
})

export default LeadPDFDoc
