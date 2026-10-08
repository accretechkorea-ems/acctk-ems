'use client'

import React from 'react'
import { Document, Page, Text, View, StyleSheet, Image, Font } from '@react-pdf/renderer'
import type { QuoteRow } from './types'
import { numKR, amountToKorean } from './format'
import { DEFAULT_TERMS, TERM_KEYS, TERM_PDF_LABELS, type Terms } from '@/lib/quoteTerms'

// 한글 폰트 — 예전에는 구글(fonts.gstatic.com)에서 매번 받았다. 외부가 느리거나 막히면 PDF 렌더가
// 예외로 끝나는데, 그 예외는 견적이 이미 저장된 뒤에 나므로 같은 파일을 public 에 두고 같은 출처에서 받는다.
// 이 문서는 브라우저에서 렌더되므로 파일시스템 경로가 아니라 public 경로를 쓴다
// (서버에서 만드는 쇼룸 승인서는 같은 이유로 반대로 path.join(process.cwd(), …) 을 쓴다).
Font.register({
  family: 'NotoSansCJK',
  src: '/fonts/NotoSansKR-Regular.ttf',
})

// 할인 표기 색 — 앱 전역에서 쓰는 위험/차감 색과 같은 값.
const DANGER = '#dc2626'

// 표 머리글 배경 — 회사 컬러(#234ea2)의 연한 톤.
//
// 세 단계를 재 보고 고른 값이다. 되돌릴 때는 이 상수만 바꾸면 된다.
//
//   V1   '#c7d7f8'  카드 hover 테두리 토큰. 옛 주황(#FFCC99)과 명도가 거의 같다(흑백 214 vs 213).
//   V1.5 '#b8cbf1'  ← 현재. V1 과 V2 의 중간. 흑백 202 · 검은 글자 12.9:1 · 흰 바탕 1.63.
//   V2   '#a9bee9'  V1 을 회사색 쪽으로 옮긴 값. 흑백 189 · 검은 글자 11.2:1 · 흰 바탕 1.87.
//   V3   '#6583be'  흰색과 회사색을 30:70 으로 섞어 로고색에 가장 가깝다. 흑백 129 · 검은 글자 5.54:1.
//                   검은 글자를 유지하는 한 이보다 진하게는 못 간다(80% 면 4.36:1 로 AA 미달,
//                   로고색 그대로는 2.68:1 이라 글자가 묻힌다).
const HEADER_BG = '#b8cbf1'

const THICK = 1.3
const THIN = 0.5
// 열 너비 — 금액이 억 단위(₩ 999,999,999)가 되어도 한 줄에 들어가도록 잡은 값이다.
// 표 안에서 가장 좁았던 부가세 칸이 넘쳐 줄바꿈되던 것을 품명·수량·단가·공급가액에서 조금씩 덜어 채웠다.
// 폭을 줄일 때는 각 칸이 실제로 담는 가장 긴 글자를 먼저 재 볼 것(품명 183pt, 품번 53pt, 억 단위 금액 59pt).
const COL = { seq: '5%', code: '12%', name: '36.4%', qty: '5.4%', unit: '13.4%', supply: '13.8%', tax: '14%' }
const COL_LABEL_SPAN = '53.4%'  // 요약행 라벨 셀 = seq(5)+code(12)+name(36.4) 합, 합계값이 계속 맨 오른쪽 정렬
// 선두 수동 번호(1. / 2) / 3.) 제거 — 자동 순번과 중복 방지. 데이터는 안 바꾸고 표시 직전에만 적용.
const stripLeadNo = (s: string) => (s || '').replace(/^\s*\d+[.)]\s*/, '')

// ── 긴 품번을 칸 안에서 끊기 ────────────────────────────────────────
//
// 왜 손으로 끊는가. react-pdf(@react-pdf/textkit)는 줄을 끊을 자리를 **공백에서만** 찾는다.
// 공백 없는 품번은 통째로 한 낱말이 되어, 칸보다 넓어도 줄이 바뀌지 않고 **옆 품명 칸 위로
// 삐져나간다**(「EE60573G622ZK4」가 품명 글자에 겹친 것이 그것이다).
//
// 공식 수단인 하이픈 콜백(Font.registerHyphenationCallback 또는 <Text hyphenationCallback>)은
// 쓸 수 없다 — **끊은 자리에 하이픈을 찍는다.** textkit 의 breakLines 가 끊는 자리가 penalty
// 노드이면 insertGlyph(…, 0x002d, …) 로 '-' 를 **글자로 넣는다**(끄는 설정이 없다).
// 실측 확인: 좁은 칸에서 콜백으로 끊으면 「EE60573G6-22ZK4」로 뽑히고, 같은 자리를 손으로
// 끊으면 「EE60573G6 / 22ZK4」로 뽑힌다. 품번에 없는 '-' 가 들어가면 고객이 다른 품번으로 읽는다.
// (전역 콜백은 비고·인사말·품명의 줄바꿈까지 바꾸므로 애초에 범위가 너무 넓다.)
//
// 그래서 **폭을 재서 직접 끊고 줄 사이에 '\n' 을 넣는다.** 한 Text 안의 줄바꿈이라
// 줄 간격·가운데 정렬이 그대로고, 줄이 늘어나면 행 높이도 같이 늘어난다
// (품목 행에는 고정 높이가 없고 minHeight(16) 만 있다).

/**
 * 그 글자의 가로폭 **상한** (1em = 1000). NotoSansKR-Regular 를 fontkit 으로 실측한 값이다.
 *
 * 한 글자씩 표를 두지 않고 몇 갈래로 묶되 **각 갈래의 최대값**을 쓴다 — 실제보다 작게 잡으면
 * 계산이 「들어간다」고 보고 칸을 넘기므로, 틀릴 때 넘치지 않는 쪽으로 틀리게 한다.
 *
 * 실측값(1em=1000): 숫자 0~9 는 전부 555 로 같다. 대문자는 J(535)~W(878) 인데 M(812)·W(878)만
 * 유별나게 넓고 나머지는 O·Q(742) 가 최대다. 소문자는 m(926)·w(802) 를 빼면 d·p·q(620) 가 최대,
 * 그 밖 ASCII 기호는 &(680) 가 최대다. 한글은 **전부 920 으로 같고**(전각 고정폭) 한자·가나는 1000.
 */
function charWidth1000(ch: string): number {
  if (ch >= '0' && ch <= '9') return 555
  if (ch === 'M' || ch === 'W') return 878
  if (ch >= 'A' && ch <= 'Z') return 742
  if (ch === 'm' || ch === 'w') return 926
  if (ch >= 'a' && ch <= 'z') return 620
  // 그 밖의 ASCII·라틴 기호. 가장 넓은 것이 &(680) 라 742 로 넉넉히 잡는다.
  if (ch.charCodeAt(0) < 0x1100) return 742
  // 한글 음절 — **전부 920 으로 같다**(실측). 한자(1000)와 묶으면 품명이 한두 자 일찍 끊긴다.
  if (ch >= '\uAC00' && ch <= '\uD7A3') return 920
  // 그 밖의 전각(한자·가나 1000).
  return 1000
}

/** 그 글자열의 가로폭(pt) 상한. 위 표를 더한 값이다. */
function widthPt(text: string, sizePt: number): number {
  let sum = 0
  for (const ch of text) sum += charWidth1000(ch)
  return (sum / 1000) * sizePt
}

/**
 * 주어진 폭 안에 들어가도록 **글자 단위로** 끊는다. 하이픈을 넣지 않는다.
 *
 * 한 글자가 칸보다 넓으면 그 글자만 한 줄에 둔다 — 더 할 수 있는 것이 없다.
 * 빈 글자열은 한 조각으로 돌려준다(그려지는 모양이 지금과 같아야 한다).
 */
export function wrapByWidth(text: string, boxPt: number, sizePt: number): string[] {
  if (text === '' || sizePt <= 0) return [text]
  // 폭 비교를 1em=1000 단위로 한다 — 글자 폭 표가 그 단위다.
  const limit = (boxPt / sizePt) * 1000
  const out: string[] = []
  let line = ''
  let used = 0
  for (const ch of text) {
    const w = charWidth1000(ch)
    if (line !== '' && used + w > limit) {
      out.push(line)
      line = ch
      used = w
    } else {
      line += ch
      used += w
    }
  }
  out.push(line)
  return out
}

/** 한글·한자·가나 등 — 영어 하이픈 사전이 끊을 수 없는 글자. */
const CJK_RE = /[\u1100-\u11FF\u3000-\u303F\u3130-\u318F\u4E00-\u9FFF\uAC00-\uD7A3]/
/** 라틴 소문자 — 하이픈 사전의 패턴이 걸리는 조건이다. */
const LOWER_RE = /[a-z]/

/**
 * 그 낱말을 **엔진이 스스로 끊을 수 있는가.**
 *
 * react-pdf 는 영어 하이픈 사전(hyphen/patterns/en-us)으로만 낱말 안을 끊는다. 그 패턴은
 * 라틴 알파벳에 걸리므로, 한글·한자가 섞였거나 라틴 소문자가 없는 덩어리(대문자+숫자로 된
 * 품번 같은 것)는 **끊지 못해 칸을 넘친다.** 끊을 수 있는 낱말은 지금처럼 엔진에 맡긴다 —
 * 그 품명의 줄바꿈이 한 글자도 달라지지 않게.
 */
const engineCanBreak = (word: string): boolean => !CJK_RE.test(word) && LOWER_RE.test(word)

/**
 * **엔진이 끊을 수 없고 칸보다 넓은 낱말만** 미리 끊는다(그 자리에 '\n' 을 넣는다).
 * 그 밖의 낱말은 한 글자도 건드리지 않으므로 지금 품명의 줄바꿈은 그대로다.
 *
 * 왜 필요한가: 품명도 공백 없는 덩어리가 길면 칸을 넘친다. 실측으로 공백 없는 한글 23자부터
 * 수량 칸을, 30자가 넘으면 단가 칸까지 침범한다(금액 글자와 뒤섞인다).
 * 하이픈 콜백을 쓸 수 없는 이유는 위 품번 설명과 같다 — 품명에 없는 '-' 가 찍힌다.
 */
export function wrapLongWords(text: string, boxPt: number, sizePt: number): string {
  if (text === '') return text
  return text
    .split('\n')
    .map(para => para
      .split(' ')
      .map(word => (word === '' || engineCanBreak(word) || widthPt(word, sizePt) <= boxPt
        ? word
        : wrapByWidth(word, boxPt, sizePt).join('\n')))
      .join(' '))
    .join('\n')
}

// ── 품번 칸의 기준값 ───────────────────────────────────────────────

/** 품번 열의 폭 비율. 아래 COL.code 와 **같은 값이어야 한다**(한쪽만 바꾸면 계산이 어긋난다). */
const CODE_PCT = 0.12

/**
 * 품번 칸에서 글자가 쓸 수 있는 폭(pt).
 *   A4 폭(595.28) − 페이지 좌우 여백(30×2) − 표 테두리(THICK×2) = 표 안쪽 폭
 *   × 열 비율 − 칸 오른쪽 테두리(THICK) − 칸 좌우 안쪽 여백(4×2)
 * 값은 54.62pt 다. 9pt 에서 숫자 10자·대문자 6자가 한 줄이다(실측).
 */
const CODE_BOX_PT = (595.28 - 30 * 2 - THICK * 2) * CODE_PCT - THICK - 4 * 2

/**
 * 품번 글자를 한 단계 줄이는 길이.
 *
 * 품번 칸은 9pt 에서 한 줄에 숫자 10자(대문자 6자)다. 보고된 실제 사례(14자)는 두 줄에 들어가지만
 * 그보다 길어지면 세 줄로 넘어가 행이 높아진다. 8pt 에서는 숫자 12자·대문자 7자가 한 줄이라
 * 두 줄에 24자까지 담긴다 — 흔한 길이(15~24자)를 두 줄 안에 머물게 하려고 15자부터 줄인다.
 */
const CODE_SHRINK_LEN = 14

/** 줄인 크기. 9 → 8 은 88.9% 로 가독성 하한(85%)보다 높다. 이 문서에 이미 8.5 가 쓰이고 있다. */
const CODE_SMALL_SIZE = 8

/** 품목 표의 기본 글자 크기(S.td 의 fontSize 와 같아야 한다). */
const CODE_BASE_SIZE = 9

/** 품명 열의 폭 비율. 아래 COL.name 과 **같은 값이어야 한다**. */
const NAME_PCT = 0.364

/**
 * 품명 칸에서 글자가 쓸 수 있는 폭(pt) — 185.90pt.
 * 이 칸은 오른쪽 테두리를 그리지 않으므로(borderRightWidth: 0) 테두리를 빼지 않는다.
 * 9pt 에서 공백 없는 한글 22자·영문 소문자 36자가 한 줄이다(실측).
 */
const NAME_BOX_PT = (595.28 - 30 * 2 - THICK * 2) * NAME_PCT - 4 * 2

/** 설명 줄(subLines)의 글자 크기. 아래 JSX 의 값과 같아야 한다. */
const SUBLINE_SIZE = 8.5

/** 그 품번을 그릴 글자 크기와, 칸 안에서 끊은 줄들. */
export function codeLayout(code: string): { size: number; text: string } {
  const size = [...code].length > CODE_SHRINK_LEN ? CODE_SMALL_SIZE : CODE_BASE_SIZE
  // 한 Text 안의 '\n' 으로 넘긴다 — 줄 간격·가운데 정렬이 그대로고 하이픈이 붙지 않는다.
  return { size, text: wrapByWidth(code, CODE_BOX_PT, size).join('\n') }
}

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
  tableHeader: { flexDirection: 'row', backgroundColor: HEADER_BG, borderBottomWidth: THICK, borderBottomColor: '#000' },
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
  /**
   * 조건 네 줄(납품일정·지불조건·인도조건·견적유효).
   * **주지 않으면 기본값으로 그린다** — 지금까지와 한 글자도 다르지 않다(lib/quoteTerms.ts 의 DEFAULT_TERMS).
   * 미리보기·확정 때 PDF·저장값으로 다시 만드는 PDF 가 모두 이 prop 하나로 같은 줄을 그린다.
   */
  terms?: Terms
}

export const QuotePDFDoc = React.memo(function QuotePDFDoc({ company, receiver, quoteNo, dateDisplay, rows, remarks, engineerName, engineerTel, totalSupply, totalTax, totalAmount, showWatermark, showSignature, terms }: PDFDocProps) {
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
        {/* 날짜 줄 — **늘 확정 때의 날짜**다(미리보기는 그날 날짜). 결재 완료를 기다려 날짜를
            채워 넣던 체계는 걷어냈다 — 확정과 동시에 고객 발송용 문서가 나간다. */}
        <Text style={S.dateRow}>{dateDisplay}</Text>
        <View style={S.headerRow}>
          <View style={S.headerLeft}>
            <Text style={S.companyName}>{company || '　'} 귀하</Text>
            <Text style={S.headerSubText}>아래와 같이 견적합니다</Text>
            {/* 조건 네 줄 — 값은 prop 이 있으면 그것, 없으면 기본값이다(라벨·순서·서식은 늘 같다). */}
            {TERM_KEYS.map(key => (
              <View key={key} style={S.conditionRow}>
                <Text style={S.conditionLabel}>{TERM_PDF_LABELS[key]}</Text>
                <Text style={S.conditionValue}>{terms?.[key] || DEFAULT_TERMS[key]}</Text>
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
            // 품번 — 그리는 값과 글자 크기·줄바꿈 판정이 같아야 해서 한 번만 만든다.
            const code = isDiscount
              ? ''
              : (row.partCode.trim() || ((row.itemText.trim() || row.supply_price > 0) ? '-' : ''))
            const codeDraw = codeLayout(code)
            const noRule = isDiscount ? { borderRightWidth: 0 } : {}
            // 할인 줄 아래에는 선을 두지 않는다 — 할인은 늘 마지막 줄이고, 그 아래(빈 영역·비고)가
            // 칸 없는 한 덩어리라 여기서 선을 그으면 열린 공간이 도로 잘려 보인다.
            // 할인이 없으면 마지막 품목 아래에도 선을 그대로 둔다(품목 목록의 끝을 닫는 선).
            return (
            <View key={row.id} style={[S.itemRow, isDiscount ? {} : { borderBottomWidth: THICK, borderBottomColor: '#000' }]}>
              <View style={[S.td, { width: COL.seq, justifyContent: 'center', alignItems: 'center' }, noRule]}>
                <Text style={{ textAlign: 'center' }}>{isDiscount ? '' : ri + 1}</Text>
              </View>
              <View style={[S.td, { width: COL.code, justifyContent: 'center', alignItems: 'center' }, noRule]}>
                {/* 품번 — 가격표 선택값이든 직접 입력값이든 행의 partCode 를 쓴다.
                    내용이 있는 행인데 품번이 없으면(서비스비 등) '-' 로 채운다. 할인은 품번 자체가 없어 비운다.
                    긴 품번은 칸 폭을 재서 글자 단위로 끊고(codeLayout), 아주 길면 글자를 한 단계 줄인다.
                    가격표 품번(2글자 + 숫자 5자리)은 40.8pt 라 지금까지처럼 한 줄이다. */}
                <Text style={{ textAlign: 'center', fontSize: codeDraw.size }}>
                  {codeDraw.text}
                </Text>
              </View>
              <View style={[S.td, { width: COL.name, borderRightWidth: 0, alignItems: isDiscount ? 'flex-end' : undefined, justifyContent: 'center' }]}>
                {/* 품명·설명 줄 — 칸보다 넓은 낱말만 미리 끊는다(wrapLongWords).
                    칸에 들어가는 품명은 손대지 않으므로 줄바꿈이 지금과 같다. */}
                <Text style={isDiscount ? { color: DANGER, textAlign: 'right' } : undefined}>
                  {wrapLongWords(stripLeadNo(row.itemText), NAME_BOX_PT, CODE_BASE_SIZE)}
                </Text>
                {row.subLines.map((line, i) => line ? (
                  <Text key={i} style={{ fontSize: SUBLINE_SIZE, marginTop: 1 }}>
                    {wrapLongWords(line, NAME_BOX_PT, SUBLINE_SIZE)}
                  </Text>
                ) : null)}
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
          {/* 표의 남는 세로 공간을 흡수하는 빈 영역. 최소 높이는 기존과 동일(부족한 행 × 18pt).
              선은 하나도 긋지 않는다 — 칸을 나눠 봐야 채울 내용이 없어 어수선하기만 하다.
              높이는 flexGrow 와 minHeight 가 정하므로 안에 열을 두지 않아도 폭·높이는 그대로다.
              좌우 끝은 표 바깥 테두리(S.table)가 그린다. */}
          <View style={{ flexGrow: 1, minHeight: EMPTY_ROWS * 18 }} />
          <View style={S.remarkRow}>
            <View style={[S.remarkContent, { borderRightWidth: 0, justifyContent: 'flex-end' }]}>
              <Text style={[S.remarkLine, { fontFamily: 'NotoSansCJK' }]}>　비고</Text>
              {remarks.split('\n').map((line, i) => <Text key={i} style={S.remarkLine}>{line}</Text>)}
              <Text style={[S.remarkLine, { marginTop: 2 }]}>* 담당자 : {engineerName}{engineerTel ? ` (TEL : ${engineerTel})` : ''}</Text>
            </View>
            {/* 선 없는 자리 잡기용 칸 — 비고 글의 폭(=이 넷을 뺀 나머지)을 그대로 지킨다. */}
            <View style={{ width: COL.qty }} />
            <View style={{ width: COL.unit }} />
            <View style={{ width: COL.supply }} />
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
