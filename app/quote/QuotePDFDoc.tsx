'use client'

import React from 'react'
import { Document, Page, Text, View, StyleSheet, Image, Font } from '@react-pdf/renderer'
import type { QuoteRow } from './types'
import { numKR, amountToKorean } from './format'
import { withModelSuffix } from '@/lib/priceItemText'
import { managerNoteLine, noteBodyLines } from '@/lib/quoteRemarks'
import { DEFAULT_TERMS, TERM_LABELS, termKeysFor, type Terms } from '@/lib/quoteTerms'
import {
  GENERAL20_SUBTITLE, GROUP_KINDS, GROUP_PDF_LABELS,
  formKindOf, isEquipForm, isGeneral20Form, type FormKind, type GroupKind,
} from '@/lib/quoteForms'

// ════════════════════════════════════════════════════════════════════════════
// 견적서 PDF — 세 양식이 **한 뼈대**를 공유한다.
//
//   general20 (20 견적서) : 「모델」 열이 하나 더 있고 표 첫 줄에 부제가 붙는다.
//   parts80   (80 파츠)   : 가장 단순한 뼈대.
//   equip80   (80 장비)   : 그룹 행 + 계층 번호, 조건에 「보증」, 특별 할인이 합계 블록 위로.
//
// 수치의 정본은 레퍼런스 v13(gen4_레퍼런스_생성코드.py 의 CSS)이다. 그 파일이 mm·pt 로
// 적어 둔 값을 그대로 옮겼다 — 아래 상수의 주석에 원래 CSS 값을 같이 적어 둔다.
// 인쇄용 색(#b9cdee·#9aa·#c00000 …)은 레퍼런스 값을 쓴다. 화면 토큰으로 바꾸지 않는다
// (.claude/rules/design-system.md 의 react-pdf 예외).
//
// 양식을 모르는 견적(form_kind 가 null — 개편 전 견적, 옛 초안)은 파츠 뼈대로 떨어진다.
// 저장된 PDF 는 다시 만들지 않으므로 옛 견적의 문서 자체는 영향이 없다.
// ════════════════════════════════════════════════════════════════════════════

// 한글 폰트 — 예전에는 구글(fonts.gstatic.com)에서 매번 받았다. 외부가 느리거나 막히면 PDF 렌더가
// 예외로 끝나는데, 그 예외는 견적이 이미 저장된 뒤에 나므로 같은 파일을 public 에 두고 같은 출처에서 받는다.
// 이 문서는 브라우저에서 렌더되므로 파일시스템 경로가 아니라 public 경로를 쓴다
// (서버에서 만드는 쇼룸 승인서는 같은 이유로 반대로 path.join(process.cwd(), …) 을 쓴다).
Font.register({
  family: 'NotoSansCJK',
  src: '/fonts/NotoSansKR-Regular.ttf',
})

/** 1mm 를 pt 로. 레퍼런스 CSS 가 mm 로 적혀 있어 그대로 옮기려고 둔다. */
const MM = 72 / 25.4

// ── 용지 · 여백 (CSS: .page{padding:11mm 12mm 10mm}) ──────────────────────
const PAGE_W = 595.28           // A4 210mm
const PAD_TOP = 11 * MM
const PAD_X = 12 * MM
const PAD_BOTTOM = 10 * MM
/** 표·헤더가 쓸 수 있는 가로 폭. 열 폭 계산의 기준이다. */
const CONTENT_W = PAGE_W - PAD_X * 2

// ── 색 (레퍼런스 CSS 그대로) ───────────────────────────────────────────────
const C_BLACK = '#000'
const C_TH_BG = '#b9cdee'        // th 배경
const C_TH_LINE = '#7a8fb5'      // th 세로선
const C_CELL_LINE = '#9aa'       // td 세로선 · 표 바깥선
const C_ROW_LINE = '#e2e2e2'     // td 가로선
const C_GROUP_TOP = '#666'       // 그룹 행 위선
const C_GROUP_BOTTOM = '#bbb'    // 그룹 행 아래선
const C_INCLUDE = '#444'         // 포함사항 글자
const C_DISCOUNT = '#c00000'     // 할인 글자
const C_SUM_LINE = '#ddd'        // 합계 행 사이선
const C_SUM_LABEL = '#222'       // 합계 라벨 글자
const C_LEGEND = '#777'

// ── 선 두께 (레퍼런스 CSS 그대로) ──────────────────────────────────────────
const W_HD_BOTTOM = 1.6          // .hd{border-bottom:1.6px}
const W_TABLE_TOP = 1.5          // table.t{border-top:1.5px solid #000}
const W_TH_BOTTOM = 1.2          // .t th{border-bottom:1.2px solid #000}
const W_SUM_TOP = 1.2            // .t tr.sum.first td{border-top:1.2px solid #000}
const W_CELL = 0.6               // .t td{border-left/right:.6px solid #9aa}
const W_ROW = 0.5                // .t td{border-bottom:.5px solid #e2e2e2}
const W_GROUP_TOP = 0.8          // .t tr.g td{border-top:.8px solid #666}

// ── 글자 크기 (레퍼런스 CSS 그대로) ────────────────────────────────────────
const S_TITLE = 22               // .top h1{font-size:22pt}
const S_NO = 8.5                 // .top .no{font-size:8.5pt}
const S_COMPANY = 12             // .l .co{font-size:12pt}
const S_LEFT = 9.5               // .l{font-size:9.5pt}
const S_COND = 9                 // .l ol{font-size:9pt}
const S_RIGHT = 8.5              // .r{font-size:8.5pt}
const S_KOR = 10                 // .kor{font-size:10pt}
const S_TH = 8.5                 // .t th{font-size:8.5pt}
const S_SUM = 9.5                // .t tr.sum td{font-size:9.5pt}
const S_TOTAL = 11               // .t tr.tot td{font-size:11pt}
const S_NOTE = 8                 // .note{font-size:8pt}

/**
 * 제목의 글자 사이 간격과 그 보정.
 * CSS: .top h1{letter-spacing:16px; text-indent:21px}
 * letterSpacing 은 **마지막 글자 뒤에도** 붙어 가운데 정렬이 왼쪽으로 치우친다.
 * 레퍼런스는 text-indent 로 밀어 보정했는데 react-pdf 에는 text-indent 가 없어,
 * 같은 효과를 내려고 패딩을 왼쪽에만 준다(21px ≈ letterSpacing × 1.3).
 */
const TITLE_SPACING = 16
const TITLE_INDENT = 21

// ── 표 글자 크기 사다리 (C. 줄 수에 따라 줄인다) ───────────────────────────
/**
 * 기본 크기 — 파츠·20 은 9.5pt, 장비는 8pt(레퍼런스의 fs 값 그대로).
 * 줄이 많아지면 아래 FONT_LADDER 를 따라 7pt 까지 단계적으로 내린다.
 */
const BASE_SIZE: Record<FormKind, number> = {
  general20: 9.5,
  parts80: 9.5,
  equip80: 8,
}
/** 내려갈 수 있는 크기. 기본값보다 큰 값은 쓰지 않는다(아래 pickSize 가 걸러낸다). */
const FONT_LADDER = [9.5, 9, 8.5, 8, 7.5, 7] as const
/** 가장 작은 크기. 이보다 줄이지 않고 다음 쪽으로 넘긴다. */
const MIN_SIZE = 7

/**
 * 한 줄의 높이. CSS 는 6.2mm(≈17.6pt) 고정인데, 글자를 줄이면 줄도 같이 낮춰야
 * 더 많이 들어간다. 9.5pt 에서 6.2mm 가 되도록 비율을 잡았다(17.57 / 9.5 ≈ 1.85).
 */
const rowHeight = (size: number) => size * 1.85

/**
 * 품목 표가 쓸 수 있는 세로 높이(pt).
 * 전체 높이에서 **고정 블록**을 뺀 값이다 — 제목줄(17mm) · 머리블록 · 일금줄 ·
 * 표 머리 · 합계 블록(비고와 같은 높이) · 아래 여백.
 * 비고가 길면 합계 블록이 커져 표가 줄어드는데, 그 보정은 availableRows 가 한다.
 */
const PAGE_H = 841.89            // A4 297mm
const TOP_H = 17 * MM            // .top{height:17mm}
const HD_H = 33 * MM             // .hd — 조건 다섯 줄 + 로고 상자를 담는 실측 높이
const KOR_H = 10 * MM            // .kor{padding:2mm 0} + 10pt 한 줄
const TH_H = 6.5 * MM            // .t th{height:6.5mm}

/** 합계 블록 높이 — 합계·부가세·총계(+장비는 소계·특별 할인). */
const sumBlockHeight = (sumRows: number) =>
  (sumRows - 1) * (6.6 * MM) + 8 * MM   // 마지막 「총 계」만 8mm

/** 비고 블록 높이 — 합계 블록과 같은 칸을 쓰므로 둘 중 큰 쪽이 실제 높이다. */
const noteBlockHeight = (lines: number) =>
  4 * MM + Math.max(1, lines) * S_NOTE * 1.5   // padding 2mm×2 + 줄 수 × 줄간격

/** 그 글자 크기로 한 쪽에 담을 수 있는 품목 줄 수. */
function availableRows(size: number, sumRows: number, noteLines: number): number {
  const fixed = TOP_H + HD_H + KOR_H + TH_H
    + Math.max(sumBlockHeight(sumRows), noteBlockHeight(noteLines))
  const avail = PAGE_H - PAD_TOP - PAD_BOTTOM - fixed
  return Math.max(1, Math.floor(avail / rowHeight(size)))
}

/**
 * 그 글자 크기에서 **실제로 차지하는 줄 수**.
 * 한 품목이 한 줄이라고 보면 안 된다 — 품명이 칸보다 길면 접히고, 설명 줄(subLines)이
 * 붙으면 그만큼 더 늘어난다. 폭 표(widthPt)로 미리 세어 둔다.
 */
function estimateLines(drawRows: DrawRow[], nameBox: number, size: number): number {
  let lines = 0
  for (const dr of drawRows) {
    if (dr.kind !== 'item') { lines += 1; continue }   // 그룹 제목·부제는 한 줄
    const name = stripLeadNo(dr.row.itemText)
    lines += Math.max(1, Math.ceil(widthPt(name, size) / Math.max(1, nameBox)))
    lines += dr.row.subLines.filter(Boolean).length
  }
  return lines
}

/**
 * 줄 수에 맞는 글자 크기를 고른다.
 * 기본 크기에서 시작해 들어갈 때까지 한 단계씩 내리고, 7pt 로도 안 들어가면 7pt 로 둔다
 * (그때는 다음 쪽으로 이어진다 — react-pdf 가 표를 쪼갠다).
 */
export function pickSize(
  formKind: FormKind, drawRows: DrawRow[], nameBox: number, sumRows: number, noteLines: number,
): number {
  const base = BASE_SIZE[formKind]
  for (const size of FONT_LADDER) {
    if (size > base) continue
    if (estimateLines(drawRows, nameBox, size) <= availableRows(size, sumRows, noteLines)) return size
  }
  return MIN_SIZE
}

// ── 열 정의 ────────────────────────────────────────────────────────────────

type ColKey = 'seq' | 'code' | 'name' | 'model' | 'qty' | 'unit' | 'supply'
type Align = 'left' | 'center' | 'right'
type Col = { key: ColKey; title: string; width: number; align: Align }

/**
 * 양식별 열. 폭은 레퍼런스 CSS 의 mm 값 그대로이고, 「품명」만 남는 폭을 모두 먹는다.
 * **부가세 열은 세 양식 모두 없다**(레퍼런스에서 빠졌다).
 */
function columnsFor(formKind: FormKind): Col[] {
  if (formKind === 'general20') {
    // c20=[("순번","11mm"),("품번(상품코드)","28mm"),("품명",None),("모델","32mm"),
    //      ("수량","12mm"),("단가","24mm"),("공급가액","26mm")] / a20=["c","c","l","l","c","r","r"]
    const fixed: Col[] = [
      { key: 'seq', title: '순번', width: 11 * MM, align: 'center' },
      { key: 'code', title: '품번(상품코드)', width: 28 * MM, align: 'center' },
      { key: 'name', title: '품명', width: 0, align: 'left' },
      { key: 'model', title: '모델', width: 32 * MM, align: 'left' },
      { key: 'qty', title: '수량', width: 12 * MM, align: 'center' },
      { key: 'unit', title: '단가', width: 24 * MM, align: 'right' },
      { key: 'supply', title: '공급가액', width: 26 * MM, align: 'right' },
    ]
    return withNameWidth(fixed)
  }
  if (formKind === 'equip80') {
    // ecols=[("순번","11mm"),("품번","31mm"),("품명",None),("수량","13mm"),
    //        ("단가","27mm"),("공급가액","30mm")] / al=["c","l","l","c","r","r"]
    return withNameWidth([
      { key: 'seq', title: '순번', width: 11 * MM, align: 'center' },
      { key: 'code', title: '품번', width: 31 * MM, align: 'left' },
      { key: 'name', title: '품명', width: 0, align: 'left' },
      { key: 'qty', title: '수량', width: 13 * MM, align: 'center' },
      { key: 'unit', title: '단가', width: 27 * MM, align: 'right' },
      { key: 'supply', title: '공급가액', width: 30 * MM, align: 'right' },
    ])
  }
  // pcols=[("순번","11mm"),("품번","26mm"),("품 명",None),("수량","13mm"),
  //        ("단가","24mm"),("공급가액","30mm")] / pa=["c","c","l","c","r","r"]
  return withNameWidth([
    { key: 'seq', title: '순번', width: 11 * MM, align: 'center' },
    { key: 'code', title: '품번', width: 26 * MM, align: 'center' },
    { key: 'name', title: '품 명', width: 0, align: 'left' },
    { key: 'qty', title: '수량', width: 13 * MM, align: 'center' },
    { key: 'unit', title: '단가', width: 24 * MM, align: 'right' },
    { key: 'supply', title: '공급가액', width: 30 * MM, align: 'right' },
  ])
}

/** 「품명」 열에 남는 폭을 모두 준다. 폭을 숫자로 못박아 합계 블록의 칸 합과 정확히 맞춘다. */
function withNameWidth(cols: Col[]): Col[] {
  const fixed = cols.reduce((s, c) => s + c.width, 0)
  const name = CONTENT_W - fixed - W_CELL * 2   // 표 좌우 바깥선을 뺀다
  return cols.map(c => (c.key === 'name' ? { ...c, width: Math.max(40, name) } : c))
}

// ════════════════════════════════════════════════════════════════════════════
// 긴 글자를 칸 안에서 끊기
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
// 그래서 **폭을 재서 직접 끊고 줄 사이에 '\n' 을 넣는다.** 폭 표는 1em=1000 단위라
// 글자 크기가 바뀌어도 그대로 쓸 수 있다(widthPt 가 sizePt 를 곱한다).
// ════════════════════════════════════════════════════════════════════════════

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
  if (ch >= '가' && ch <= '힣') return 920
  // 그 밖의 전각(한자·가나 1000).
  return 1000
}

/** 그 글자열의 가로폭(pt). 위 표를 더한 값이다. */
export function widthPt(text: string, sizePt: number): number {
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
const CJK_RE = /[ᄀ-ᇿ　-〿㄰-㆏一-鿿가-힣]/
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

/** 칸 안쪽에서 글자가 쓸 수 있는 폭 — 좌우 패딩(5px ≈ 3.75pt)과 세로선을 뺀다. */
const CELL_PAD = 3.75            // .t td{padding:1.5px 5px}
const innerWidth = (col: Col) => Math.max(8, col.width - CELL_PAD * 2 - W_CELL)

/**
 * 그 품번을 그릴 글자 크기와, 칸 안에서 끊은 줄들.
 * 아주 긴 품번은 한 단계(0.5pt) 더 줄여 두 줄에 머물게 한다.
 */
export function codeLayout(code: string, col: Col, size: number): { size: number; text: string } {
  const box = innerWidth(col)
  // 두 줄에 안 들어가면 한 단계 줄인다. 그 아래로는 더 내리지 않는다(읽히지 않는다).
  const small = widthPt(code, size) > box * 2 ? Math.max(MIN_SIZE, size - 0.5) : size
  return { size: small, text: wrapByWidth(code, box, small).join('\n') }
}

// 선두 수동 번호(1. / 2) / 3.) 제거 — 자동 순번과 중복 방지. 데이터는 안 바꾸고 표시 직전에만 적용.
const stripLeadNo = (s: string) => (s || '').replace(/^\s*\d+[.)]\s*/, '')

/**
 * 20 견적서에서 품명 끝의 「(모델)」을 떼어낸다.
 *
 * 품목을 고를 때 화면이 품명 뒤에 모델명을 괄호로 붙인다(app/quote/page.tsx 의 handleSelect).
 * 20 양식은 **모델 열이 따로 있어** 그대로 두면 같은 글자가 두 번 나온다.
 * 그래서 **끝에 붙은 괄호가 모델값과 정확히 같을 때만** 뗀다 — 다른 괄호 설명은 건드리지 않는다.
 */
export function stripModelSuffix(name: string, model: string): string {
  const m = model.trim()
  if (m === '') return name
  const tail = `(${m})`
  const t = name.trimEnd()
  return t.endsWith(tail) ? t.slice(0, -tail.length).trimEnd() : name
}

/** 금액 표기 — 음수는 빼는 금액이라는 뜻이므로 부호를 붙인다. */
export const won = (v: number) => (v < 0 ? `− ₩ ${numKR(Math.abs(v))}` : `₩ ${numKR(v)}`)

/**
 * 한 줄의 **금액 칸** — 단가와 공급가액에 무엇을 찍는가.
 *
 * 세 가지가 섞여 있어 규칙을 한곳에 모았다(세 양식이 이 함수를 함께 쓴다).
 *   할인 줄        — **음수 금액**을 찍는다(「− ₩ 30,000」). 단가 칸은 비운다.
 *                    ⚠ 할인은 calcRow 에서 단가가 0 이다. 그래서 「단가 0 이면 금액 없음」
 *                      규칙에 같이 걸려 **공급가액이 「-」로만 찍히던 버그**가 있었다
 *                      (합계에는 빠지는데 줄에는 금액이 안 보였다. 6단계 5e3549f 부터).
 *   포함사항·원가 줄 — 금액 칸이 「-」다. 가격 없는 구성품이고, 원화 원가 줄은 고객에게
 *                    청구하지 않는다(단가가 0 이 아니어도 묶음이 포함사항이면 「-」다).
 *   그 밖          — 단가와 공급가액을 그대로 찍는다(공급가 0 이면 빈 칸).
 */
export function rowAmountCells(row: QuoteRow, include: boolean): { unit: string; supply: string } {
  if (row.row_kind === 'discount') return { unit: '', supply: won(row.supply_price) }
  if (include || row.unit_price === 0) return { unit: '', supply: '-' }
  return { unit: won(row.unit_price), supply: row.supply_price !== 0 ? won(row.supply_price) : '' }
}

// ════════════════════════════════════════════════════════════════════════════
// 줄 묶기 — 장비 양식의 그룹·계층 번호
// ════════════════════════════════════════════════════════════════════════════

/** 표에 그릴 한 줄. 그룹 제목 줄과 품목 줄을 같은 목록에 섞어 둔다. */
type DrawRow =
  | { kind: 'group'; no: string; label: string }
  | { kind: 'item'; no: string; row: QuoteRow; include: boolean }
  | { kind: 'subtitle'; label: string }

/**
 * 장비 양식의 줄 순서와 번호를 **그릴 때 계산한다**(저장하지 않는다).
 *   그룹 1 → 1-1, 1-2 … / 그룹 2 → 2-1 … / 포함사항 → 포함1, 포함2 …
 * 비어 있는 그룹은 건너뛰고 번호는 이어서 매긴다. 묶음이 없는(null) 줄은 **맨 뒤에 그룹 없이** 붙고
 * 그때는 번호가 이어지는 통번호다.
 */
export function buildEquipRows(rows: QuoteRow[]): DrawRow[] {
  const out: DrawRow[] = []
  let groupNo = 0
  for (const kind of GROUP_KINDS) {
    const list = rows.filter(r => r.group_kind === kind)
    if (list.length === 0) continue        // 비어 있는 그룹은 건너뛴다
    groupNo += 1                           // 번호는 이어서 매긴다
    out.push({ kind: 'group', no: String(groupNo), label: GROUP_PDF_LABELS[kind as GroupKind] })
    list.forEach((row, i) => out.push({
      kind: 'item',
      // 포함사항은 「포함1」 「포함2」, 나머지는 「그룹-순번」.
      no: kind === 'include' ? `포함${i + 1}` : `${groupNo}-${i + 1}`,
      row,
      include: kind === 'include',
    }))
  }
  // 묶음을 고르지 않은 줄 — 그룹 없이 맨 뒤에 붙인다(통번호).
  const loose = rows.filter(r => r.group_kind == null || !GROUP_KINDS.includes(r.group_kind as GroupKind))
  loose.forEach((row, i) => out.push({ kind: 'item', no: String(i + 1), row, include: false }))
  return out
}

/** 파츠·20 — 그룹이 없다. 통번호만 매긴다(20 은 맨 앞에 부제 줄). */
export function buildFlatRows(rows: QuoteRow[], subtitle: string | null): DrawRow[] {
  const out: DrawRow[] = []
  if (subtitle) out.push({ kind: 'subtitle', label: subtitle })
  rows.forEach((row, i) => out.push({ kind: 'item', no: String(i + 1), row, include: false }))
  return out
}

// ════════════════════════════════════════════════════════════════════════════

const S = StyleSheet.create({
  page: {
    fontFamily: 'NotoSansCJK',
    paddingTop: PAD_TOP, paddingBottom: PAD_BOTTOM, paddingLeft: PAD_X, paddingRight: PAD_X,
    backgroundColor: '#ffffff',
    display: 'flex', flexDirection: 'column',
  },
  // .top{position:relative;height:17mm}
  top: { height: TOP_H, position: 'relative' },
  // .top h1 — 글자 사이 간격 때문에 치우치는 것을 왼쪽 패딩으로 보정한다.
  title: {
    fontSize: S_TITLE, fontFamily: 'NotoSansCJK', textAlign: 'center',
    letterSpacing: TITLE_SPACING, paddingLeft: TITLE_INDENT, paddingTop: 1 * MM,
  },
  // .top .no{position:absolute;right:0;top:3mm;text-align:right;line-height:1.6}
  noBox: { position: 'absolute', right: 0, top: 3 * MM },
  noText: { fontSize: S_NO, textAlign: 'right', lineHeight: 1.6 },
  // .hd{display:flex;justify-content:space-between;align-items:stretch;
  //     margin-top:1mm;padding-bottom:3mm;border-bottom:1.6px solid #000}
  hd: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'stretch',
    marginTop: 1 * MM, paddingBottom: 3 * MM,
    borderBottomWidth: W_HD_BOTTOM, borderBottomColor: C_BLACK,
  },
  hdLeft: { flexGrow: 1, flexShrink: 1 },
  // .l .co{font-size:12pt;text-decoration:underline}
  company: { fontSize: S_COMPANY, fontFamily: 'NotoSansCJK', textDecoration: 'underline', lineHeight: 1.55 },
  leftText: { fontSize: S_LEFT, lineHeight: 1.55 },
  // .l ol{margin:2mm 0 0 4mm}
  condList: { marginTop: 2 * MM, marginLeft: 4 * MM },
  condRow: { flexDirection: 'row' },
  // .l ol li .n{width:4mm}
  condNo: { width: 4 * MM, fontSize: S_COND },
  // .l ol li .k{width:4em;display:inline-flex;justify-content:space-between}
  //   → 항목명을 4글자 폭에 고르게 펴 「보  증」의 증이 「효」 밑에 오게 한다.
  condKey: { width: S_COND * 4, flexDirection: 'row', justifyContent: 'space-between' },
  // .l ol li .k i{width:1em;text-align:center}
  condKeyChar: { width: S_COND, fontSize: S_COND, textAlign: 'center' },
  // .l ol li .cn{padding:0 1.6mm} — 콜론 좌우 간격을 같게
  condColon: { paddingLeft: 1.6 * MM, paddingRight: 1.6 * MM, fontSize: S_COND },
  condValue: { fontSize: S_COND, flexGrow: 1, flexShrink: 1 },
  // .r{align-self:flex-end;text-align:left;width:62mm}
  hdRight: { width: 62 * MM, flexShrink: 0, alignSelf: 'flex-end', alignItems: 'flex-start' },
  // .r img{width:56mm;margin-bottom:1.5mm} — 로고 원본(pdflogo.png)의 가로세로 비가 6.4:1
  logo: { width: 56 * MM, height: (56 * MM) / 6.4, marginBottom: 1.5 * MM },
  rightText: { fontSize: S_RIGHT, textAlign: 'left', lineHeight: 1.55 },
  // .kor{text-align:center;padding:2mm 0;display:flex;justify-content:center;gap:6mm}
  kor: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    paddingTop: 2 * MM, paddingBottom: 2 * MM,
  },
  korText: { fontSize: S_KOR, fontFamily: 'NotoSansCJK' },
  // table.t{border:.6px solid #9aa;border-top:1.5px solid #000}
  table: {
    width: CONTENT_W,
    borderWidth: W_CELL, borderColor: C_CELL_LINE,
    borderTopWidth: W_TABLE_TOP, borderTopColor: C_BLACK,
    flexGrow: 1,
  },
  // .t th{height:6.5mm;background:#b9cdee;border-bottom:1.2px solid #000}
  thRow: {
    flexDirection: 'row', backgroundColor: C_TH_BG,
    borderBottomWidth: W_TH_BOTTOM, borderBottomColor: C_BLACK,
    minHeight: TH_H, alignItems: 'center',
  },
  th: {
    borderRightWidth: W_CELL, borderRightColor: C_TH_LINE,
    paddingVertical: 2, paddingHorizontal: 3,
    fontSize: S_TH, fontFamily: 'NotoSansCJK', textAlign: 'center',
  },
  // .t td{border-left/right:.6px solid #9aa;border-bottom:.5px solid #e2e2e2;padding:1.5px 5px}
  itemRow: { flexDirection: 'row', borderBottomWidth: W_ROW, borderBottomColor: C_ROW_LINE },
  td: {
    borderRightWidth: W_CELL, borderRightColor: C_CELL_LINE,
    paddingVertical: 1.5, paddingHorizontal: CELL_PAD,
    justifyContent: 'center',
  },
  // .t tr.g td{font-weight:700;border-top:.8px solid #666;border-bottom:.5px solid #bbb;letter-spacing:.3px}
  //   → 굵게만. 음영 없음.
  groupRow: {
    flexDirection: 'row',
    borderTopWidth: W_GROUP_TOP, borderTopColor: C_GROUP_TOP,
    borderBottomWidth: W_ROW, borderBottomColor: C_GROUP_BOTTOM,
  },
  // .t tr.fill td{vertical-align:bottom;border-bottom:none} — 남는 세로 공간을 먹는다
  filler: { flexGrow: 1 },
  // 쪽이 갈리는 문서에서는 늘리지 않는다(위 fitsOnePage 설명).
  fillerOff: { flexGrow: 0 },
  // .t tr.sum td{height:6.6mm;border-left:none;border-right:none;border-bottom:.5px solid #ddd}
  sumBlock: { flexDirection: 'row', borderTopWidth: W_SUM_TOP, borderTopColor: C_BLACK },
  // .t td.notecell{vertical-align:top;border-right:.6px solid #9aa;padding:2mm 5mm}
  noteCell: {
    borderRightWidth: W_CELL, borderRightColor: C_CELL_LINE,
    paddingTop: 2 * MM, paddingBottom: 2 * MM, paddingLeft: 5 * MM, paddingRight: 5 * MM,
    justifyContent: 'flex-start',
  },
  noteLine: { fontSize: S_NOTE, lineHeight: 1.5 },
  // 문구 묶음 — 남는 높이를 가져가고(flexGrow) 내용을 **바닥에 붙인다**.
  noteBody: { flexGrow: 1, justifyContent: 'flex-end' },
  sumRow: {
    flexDirection: 'row', minHeight: 6.6 * MM, alignItems: 'center',
    borderBottomWidth: W_ROW, borderBottomColor: C_SUM_LINE,
  },
  // .t tr.sum td.lbl{text-align:right;letter-spacing:5px;padding-right:6mm;color:#222}
  sumLabel: {
    fontSize: S_SUM, textAlign: 'right', letterSpacing: 5,
    paddingRight: 6 * MM, color: C_SUM_LABEL,
  },
  sumValue: {
    fontSize: S_SUM, textAlign: 'right', paddingRight: CELL_PAD,
    borderLeftWidth: W_CELL, borderLeftColor: C_CELL_LINE,
  },
  // .t tr.tot td{font-size:11pt;font-weight:700;border-top:.6px solid #9aa;height:8mm}
  totRow: {
    flexDirection: 'row', minHeight: 8 * MM, alignItems: 'center',
    borderTopWidth: W_CELL, borderTopColor: C_CELL_LINE,
  },
  totLabel: {
    fontSize: S_TOTAL, fontFamily: 'NotoSansCJK', textAlign: 'right', letterSpacing: 5,
    paddingRight: 6 * MM, color: C_SUM_LABEL,
  },
  totValue: {
    fontSize: S_TOTAL, fontFamily: 'NotoSansCJK', textAlign: 'right', paddingRight: CELL_PAD,
    borderLeftWidth: W_CELL, borderLeftColor: C_CELL_LINE,
  },
  // 고객사 서명란 — 표 바깥, 표 아래에 한 줄.
  signRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 },
  signText: { fontSize: 9, fontFamily: 'NotoSansCJK' },
  legend: { fontSize: 7, color: C_LEGEND, marginTop: 1.5 * MM },
})

export type PDFDocProps = {
  company: string; receiver: string; quoteNo: string; dateDisplay: string
  rows: QuoteRow[]; remarks: string; engineerName: string; engineerTel: string
  totalSupply: number; totalTax: number; totalAmount: number
  showWatermark?: boolean
  // 화면에서 체크했을 때만 표 아래 서명란을 낸다. DB 에 저장하지 않는 표시 전용 값.
  showSignature?: boolean
  /**
   * 조건 줄(납품일정·지불조건·인도조건·견적유효, 장비는 보증까지).
   * **주지 않으면 기본값으로 그린다**(lib/quoteTerms.ts 의 DEFAULT_TERMS).
   */
  terms?: Terms
  /**
   * 견적서 양식(quotes.form_kind). 열·그룹·조건·합계 모양을 모두 가른다.
   * **비어 있으면 파츠 뼈대로 떨어진다** — 개편 전 견적·옛 초안이 그 경우다.
   */
  formKind?: string | null
}

export const QuotePDFDoc = React.memo(function QuotePDFDoc({
  company, receiver, quoteNo, dateDisplay, rows, remarks, engineerName, engineerTel,
  totalSupply, totalTax, totalAmount, showWatermark, showSignature, terms, formKind,
}: PDFDocProps) {
  const form = formKindOf(formKind)
  const equip = isEquipForm(form)
  const cols = columnsFor(form)
  const colOf = (key: ColKey) => cols.find(c => c.key === key)

  // 국내조달품(원화 원가만 있는 줄)은 고객 견적서에 나오지 않는다 — 매출 제외 · 자사 부담.
  // 딱 하나 예외가 **포함사항 묶음**이다. 장비 구성의 포함사항은 곧 국내 구매품이고
  // (PC세트·측정 테이블 등) 고객에게는 「포함」으로 알려야 한다. 금액 칸은 「-」로 나간다
  // (아래 noAmount 가 포함사항이면 「-」로 그린다). 묶음이 없던 지난 줄은 종전처럼 빠진다.
  const visible = rows.filter(r => r.row_kind !== 'domestic' || r.group_kind === 'include')
  // 할인은 장비 양식에서 합계 블록으로 올라가고, 나머지 양식에서는 품목 마지막 줄로 간다.
  const discountRows = visible.filter(r => r.row_kind === 'discount')
  const itemRows = visible.filter(r => r.row_kind !== 'discount')
  const discountTotal = discountRows.reduce((s, r) => s + r.supply_price, 0)

  // 장비 양식의 할인은 「소 계 → 특별 할인 → 합 계」로 올라간다.
  const liftDiscount = equip && discountRows.length > 0
  const subtotal = totalSupply - discountTotal   // 할인 전 금액

  // 그릴 줄 — 장비는 그룹·계층 번호, 나머지는 통번호(20 은 부제 줄이 맨 앞).
  const drawRows: DrawRow[] = equip
    ? buildEquipRows(itemRows)
    : buildFlatRows(
        // 장비가 아니면 할인을 품목 맨 끝에 붙인다(입력 순서와 무관하게).
        [...itemRows, ...discountRows],
        isGeneral20Form(form) ? GENERAL20_SUBTITLE : null,
      )

  // 비고 — 담당자 줄이 **문구 맨 위**다. 문구는 칸 바닥에서부터 쌓이고(S.noteBody)
  // 제목 「비고」만 칸 맨 위에 남는다. 담당자 줄을 그릴 때 붙이는 이유는 lib/quoteRemarks.ts 참조.
  const noteBody = noteBodyLines(managerNoteLine(engineerName, engineerTel), remarks)
  // 글자 크기·쪽 나눔 계산은 **제목까지 센다**(종전과 같은 줄 수다).
  const noteLines = ['비고', ...noteBody]
  const sumRows = liftDiscount ? 5 : 3
  const nameBoxPt = innerWidth(colOf('name')!)
  const size = pickSize(form, drawRows, nameBoxPt, sumRows, noteLines.length)
  // 한 쪽에 다 들어가는가. **채움 칸은 이때만 늘린다** — 쪽이 갈리는 문서에서 flexGrow 를
  // 켜 두면 남는 높이를 계산할 기준이 없어 마지막 줄이 아래 여백을 넘는다(실측으로 확인).
  const fitsOnePage = estimateLines(drawRows, nameBoxPt, size) <= availableRows(size, sumRows, noteLines.length)
  const subSize = Math.max(MIN_SIZE, size - 1)   // 품명 아래 설명 줄은 한 단계 작게

  const nameCol = colOf('name')!
  const codeCol = colOf('code')!
  const modelCol = colOf('model')

  /** 비고 칸이 걸치는 폭 — 순번부터 품명(20 은 모델까지)까지. 합계 라벨이 그 오른쪽이다. */
  const noteSpan = cols
    .filter(c => c.key === 'seq' || c.key === 'code' || c.key === 'name' || c.key === 'model')
    .reduce((s, c) => s + c.width, 0)
  /** 합계 라벨이 걸치는 폭 — 수량 + 단가. 값은 공급가액 칸에 들어간다. */
  const labelSpan = (colOf('qty')!.width) + (colOf('unit')!.width)
  const valueSpan = colOf('supply')!.width

  /** 합계 블록의 한 줄. */
  const sumLine = (label: string, value: number, opts?: { red?: boolean; total?: boolean }) => {
    const red = opts?.red ? { color: C_DISCOUNT } : undefined
    const rowStyle = opts?.total ? S.totRow : S.sumRow
    const labelStyle = opts?.total ? S.totLabel : S.sumLabel
    const valueStyle = opts?.total ? S.totValue : S.sumValue
    return (
      <View key={label} style={rowStyle}>
        <View style={{ width: labelSpan, justifyContent: 'center' }}>
          <Text style={[labelStyle, ...(red ? [red] : [])]}>{label}</Text>
        </View>
        <View style={{ width: valueSpan, justifyContent: 'center' }}>
          <Text style={[valueStyle, ...(red ? [red] : [])]}>{value !== 0 ? won(value) : ''}</Text>
        </View>
      </View>
    )
  }

  return (
    <Document>
      <Page size="A4" style={S.page}>
        {showWatermark && (
          <View style={{ position: 'absolute', top: 180, left: 20, right: 20, alignItems: 'center', transform: 'rotate(-35deg)', zIndex: 999, opacity: 0.10 }}>
            <Text style={{ fontSize: 72, fontFamily: 'NotoSansCJK', color: '#000000', textAlign: 'center' }}>미리보기</Text>
            <Text style={{ fontSize: 36, fontFamily: 'NotoSansCJK', color: '#000000', textAlign: 'center', marginTop: 12 }}>{engineerName}</Text>
          </View>
        )}

        {/* 제목 + 우측 상단 견적번호·날짜 */}
        <View style={S.top}>
          <Text style={S.title}>견 적 서</Text>
          <View style={S.noBox}>
            <Text style={S.noText}>{quoteNo}</Text>
            <Text style={S.noText}>{dateDisplay}</Text>
          </View>
        </View>

        {/* 머리 블록 — 왼쪽 수신·조건, 오른쪽 아래 로고·주소 */}
        <View style={S.hd}>
          <View style={S.hdLeft}>
            <Text style={S.company}>{company || '　'} 귀하</Text>
            {receiver ? <Text style={S.leftText}>수신인 : {receiver}</Text> : null}
            <Text style={S.leftText}>아래와 같이 견적합니다</Text>
            <View style={S.condList}>
              {termKeysFor(form).map((key, i) => (
                <View key={key} style={S.condRow}>
                  <Text style={S.condNo}>{i + 1}.</Text>
                  {/* 항목명을 4글자 폭에 고르게 편다 — 「보  증」의 증이 「효」 밑에 온다. */}
                  <View style={S.condKey}>
                    {[...TERM_LABELS[key]].map((ch, j) => (
                      <Text key={j} style={S.condKeyChar}>{ch}</Text>
                    ))}
                  </View>
                  <Text style={S.condColon}>:</Text>
                  <Text style={S.condValue}>{terms?.[key] || DEFAULT_TERMS[key]}</Text>
                </View>
              ))}
            </View>
          </View>
          <View style={S.hdRight}>
            <Image src="/pdflogo.png" style={S.logo} />
            <Text style={S.rightText}>화성시 동탄대로 24길 31-8</Text>
            <Text style={S.rightText}>Accretech Korea Co., Ltd.</Text>
            <Text style={S.rightText}>대표이사 이상철</Text>
            <Text style={S.rightText}>대표전화 031)786-4093</Text>
          </View>
        </View>

        {/* 일금 줄 — 합계(공급가) 기준. 레퍼런스처럼 네 덩어리를 6mm 간격으로 둔다. */}
        <View style={S.kor}>
          <Text style={S.korText}>일금</Text>
          <Text style={[S.korText, { marginLeft: 6 * MM }]}>
            {totalSupply < 0 ? `마이너스 ${amountToKorean(-totalSupply)}` : amountToKorean(totalSupply)}
          </Text>
          <Text style={[S.korText, { marginLeft: 6 * MM }]}>
            ({totalSupply !== 0 ? won(totalSupply).replace(/\s+/g, '') : '₩0'} -)
          </Text>
          <Text style={[S.korText, { marginLeft: 6 * MM }]}>부가세 별도</Text>
        </View>

        {/* 품목 표 */}
        <View style={S.table}>
          {/* 표 머리 — 다음 쪽으로 이어질 때 반복한다(fixed). */}
          <View style={S.thRow} fixed>
            {cols.map((c, i) => (
              <Text
                key={c.key}
                style={[S.th, { width: c.width }, ...(i === cols.length - 1 ? [{ borderRightWidth: 0 }] : [])]}
              >
                {c.title}
              </Text>
            ))}
          </View>

          {drawRows.map((dr, idx) => {
            // 부제 줄 — 20 견적서의 표 첫 줄. 모든 열에 걸쳐 가운데 정렬, 굵게.
            if (dr.kind === 'subtitle') {
              return (
                <View key={`sub-${idx}`} style={S.groupRow} wrap={false}>
                  <View style={[S.td, { width: CONTENT_W - W_CELL * 2, borderRightWidth: 0, minHeight: rowHeight(size) }]}>
                    <Text style={{ fontSize: size, fontFamily: 'NotoSansCJK', textAlign: 'center', letterSpacing: 0.3 }}>
                      {dr.label}
                    </Text>
                  </View>
                </View>
              )
            }
            // 그룹 제목 줄 — 순번 칸에 번호, 나머지 칸에 걸쳐 제목. 굵게만(음영 없음).
            if (dr.kind === 'group') {
              const seqW = colOf('seq')!.width
              return (
                <View key={`grp-${idx}`} style={S.groupRow} wrap={false}>
                  <View style={[S.td, { width: seqW, alignItems: 'center', minHeight: rowHeight(size) }]}>
                    <Text style={{ fontSize: size, fontFamily: 'NotoSansCJK', textAlign: 'center' }}>{dr.no}</Text>
                  </View>
                  <View style={[S.td, { width: CONTENT_W - W_CELL * 2 - seqW, borderRightWidth: 0, minHeight: rowHeight(size) }]}>
                    <Text style={{ fontSize: size, fontFamily: 'NotoSansCJK', letterSpacing: 0.3 }}>{dr.label}</Text>
                  </View>
                </View>
              )
            }

            const row = dr.row
            const isDiscount = row.row_kind === 'discount'
            // 금액 칸은 규칙이 셋이라 함수에 모아 뒀다(위 rowAmountCells).
            const money = rowAmountCells(row, dr.include)
            // 「-」는 칸 가운데에 놓는다(금액은 오른쪽).
            const dash = money.supply === '-'
            const textColor = isDiscount ? C_DISCOUNT : (dr.include ? C_INCLUDE : undefined)

            // 품번 — 칸 폭을 재서 글자 단위로 끊고, 아주 길면 한 단계 줄인다.
            const codeRaw = isDiscount
              ? ''
              : (row.partCode.trim() || ((row.itemText.trim() || row.supply_price > 0) ? '-' : ''))
            const codeDraw = codeLayout(codeRaw, codeCol, size)

            // 모델 — 20 견적서만. 가격표 품목은 model_jp, 직접 적은 줄은 사람이 적은 모델이다.
            const modelText = modelCol ? (row.selectedItem?.model_jp || row.manual_model || '') : ''
            // 20 은 모델 열이 따로 있어 품명 끝의 「(모델)」을 뗀다(같은 글자가 두 번 나오지 않게).
            // 80 은 모델 열이 없으므로 **반대로** 품명 뒤에 붙인다 — 가격표 품목이 품명에
            // 「(model_jp)」를 담는 것과 같은 모양이다(직접 적은 줄만 해당. 그 밖은 빈 글자).
            const nameRaw = modelCol
              ? stripModelSuffix(stripLeadNo(row.itemText), modelText)
              : withModelSuffix(stripLeadNo(row.itemText), row.manual_model || '')

            return (
              <View key={row.id} style={S.itemRow} wrap={false}>
                {cols.map((c, ci) => {
                  const last = ci === cols.length - 1
                  const base = [S.td, { width: c.width, minHeight: rowHeight(size) }, ...(last ? [{ borderRightWidth: 0 }] : [])]
                  const align = (a: Align) => (a === 'center' ? 'center' : a === 'right' ? 'right' : 'left')
                  if (c.key === 'seq') {
                    return (
                      <View key={c.key} style={[...base, { alignItems: 'center' }]}>
                        <Text style={{ fontSize: size, textAlign: 'center', color: textColor }}>{isDiscount ? '' : dr.no}</Text>
                      </View>
                    )
                  }
                  if (c.key === 'code') {
                    return (
                      <View key={c.key} style={[...base, { alignItems: c.align === 'center' ? 'center' : 'flex-start' }]}>
                        <Text style={{ fontSize: codeDraw.size, textAlign: align(c.align), color: textColor }}>{codeDraw.text}</Text>
                      </View>
                    )
                  }
                  if (c.key === 'name') {
                    return (
                      <View key={c.key} style={base}>
                        <Text style={{ fontSize: size, color: textColor }}>
                          {wrapLongWords(nameRaw, innerWidth(nameCol), size)}
                        </Text>
                        {row.subLines.map((line, i) => line ? (
                          <Text key={i} style={{ fontSize: subSize, marginTop: 1, color: textColor }}>
                            {wrapLongWords(line, innerWidth(nameCol), subSize)}
                          </Text>
                        ) : null)}
                      </View>
                    )
                  }
                  if (c.key === 'model') {
                    return (
                      <View key={c.key} style={base}>
                        <Text style={{ fontSize: size, color: textColor }}>
                          {wrapLongWords(modelText, innerWidth(c), size)}
                        </Text>
                      </View>
                    )
                  }
                  if (c.key === 'qty') {
                    return (
                      <View key={c.key} style={[...base, { alignItems: 'center' }]}>
                        <Text style={{ fontSize: size, textAlign: 'center', color: textColor }}>
                          {row.quantity > 0 ? String(row.quantity) : ''}
                        </Text>
                      </View>
                    )
                  }
                  if (c.key === 'unit') {
                    // 금액이 없는 줄·할인 줄은 단가 칸을 **비운다**(「포함」 글자를 쓰지 않는다).
                    return (
                      <View key={c.key} style={[...base, { alignItems: 'flex-end' }]}>
                        <Text style={{ fontSize: size, textAlign: 'right', color: textColor }}>
                          {money.unit}
                        </Text>
                      </View>
                    )
                  }
                  // 공급가액 — 「-」는 칸 가운데에, 금액은 오른쪽에.
                  return (
                    <View key={c.key} style={[...base, { alignItems: dash ? 'center' : 'flex-end' }]}>
                      <Text style={{ fontSize: size, textAlign: dash ? 'center' : 'right', color: textColor }}>
                        {money.supply}
                      </Text>
                    </View>
                  )
                })}
              </View>
            )
          })}

          {/* 남는 세로 공간을 흡수한다 — 품목이 적어도 합계 블록이 아래에 놓인다. */}
          <View style={fitsOnePage ? S.filler : S.fillerOff} />

          {/* 하단 블록 — 비고(왼쪽)와 합계(오른쪽)가 같은 높이를 나눠 쓴다.
              한 덩어리로 묶어 쪽이 갈릴 때 쪼개지지 않게 한다(wrap={false}).
              비고 칸: 제목 「비고」는 맨 위에 두고 **문구는 바닥에서부터** 올린다 —
              합계 블록이 더 높을 때 생기는 빈 자리를 문구 위쪽에 둔다. 문구가 많아
              칸을 넘치면 빈 자리가 없어 지금처럼 위로 밀린다. */}
          <View style={S.sumBlock} wrap={false}>
            <View style={[S.noteCell, { width: noteSpan }]}>
              <Text style={S.noteLine}>비고</Text>
              <View style={S.noteBody}>
                {noteBody.map((line, i) => (
                  <Text key={i} style={S.noteLine}>{line}</Text>
                ))}
              </View>
            </View>
            <View style={{ width: labelSpan + valueSpan }}>
              {liftDiscount && sumLine('소 계', subtotal)}
              {liftDiscount && sumLine('특별 할인', discountTotal, { red: true })}
              {sumLine('합 계', totalSupply)}
              {sumLine('부 가 세', totalTax)}
              {sumLine('총 계', totalAmount, { total: true })}
            </View>
          </View>
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
