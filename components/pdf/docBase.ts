// 거래명세서·수리내역서가 **함께 쓰는 치수와 글꼴**.
//
// 양식은 docs/pdf-templates/ 의 HTML/CSS(mono.css)가 기준이고, 그리는 기술은 견적서와
// 같다(@react-pdf/renderer — app/quote/QuotePDFDoc.tsx). 그래서 CSS 의 pt·mm 값을
// 그대로 옮겨 적고, 옮긴 자리마다 원본 선언을 주석으로 남긴다.
//
// ⚠ **굵은 글씨가 없다.** public/fonts 에 든 한글 글꼴은 NotoSansKR **Regular 한 벌**뿐이라
//   fontWeight 를 주면 그릴 수가 없다(견적서 PDF 도 fontWeight 를 한 번도 쓰지 않는다).
//   양식의 bold 는 **글자 크기·괘선 굵기·밑줄**로 대신한다.

import { Font } from '@react-pdf/renderer'

// 견적서 PDF 와 **같은 글꼴**이다. 모듈이 따로 불려도 한 번은 등록되게 여기서도 부른다
// (같은 family 를 다시 등록해도 덮어쓸 뿐 탈이 없다).
Font.register({ family: 'NotoSansCJK', src: '/fonts/NotoSansKR-Regular.ttf' })

/** 1mm 를 pt 로. CSS 가 mm 로 적혀 있어 그대로 옮기려고 둔다. */
export const MM = 72 / 25.4
/** 1pt 는 1pt 다 — CSS 의 pt 값을 눈에 띄게 적으려고 둔다. */
export const PT = 1

// @page { size: A4; margin: 11mm 14mm; }
export const PAGE_MARGIN_Y = 11 * MM
export const PAGE_MARGIN_X = 14 * MM
export const PAGE_W = 210 * MM
export const CONTENT_W = PAGE_W - PAGE_MARGIN_X * 2

/** 검정 한 가지다(흑백 문서). 보조 글자만 한 단 연하다 — .sub{color:#333} */
export const C_BLACK = '#000000'
export const C_SUB = '#333333'

// mono.css 의 선 굵기
export const W_HAIR = 1        // table .. td{border:1px solid #000}
export const W_BOX = 1.5       // table.f/.i{border:1.5px solid #000}
export const W_RULE = 2        // .under{border-bottom:2px solid #000}

// 글자 크기(pt)
export const S_BODY = 10 * PT      // body{font-size:10pt}
export const S_CORP = 8.5 * PT     // .corp{font-size:8.5pt}
export const S_TITLE = 24 * PT     // h1{font-size:24pt}
export const S_DOC = 9.5 * PT      // .doc{font-size:9.5pt}
export const S_CELL = 9.8 * PT     // table.f/.i td{font-size:9.8pt}
export const S_H2 = 10.5 * PT      // h2{font-size:10.5pt}
export const S_SUB = 9 * PT        // .sub{font-size:9pt}
export const S_TOTAL = 10.5 * PT   // .totrow td{font-size:10.5pt}

/** 로고 — 견적서 PDF 와 **같은 자산**이다(public/pdflogo.png, 가로세로 6.4:1). */
export const LOGO_SRC = '/pdflogo.png'
/** .top img{height:38px} — px 를 그대로 pt 로 보면 커서, 높이 10mm 로 맞춘다(비율 유지). */
export const LOGO_H = 10 * MM
export const LOGO_W = LOGO_H * 6.4

/** 머리글 오른쪽 세 줄 — 고정 문구다. */
export const CORP_LINES = [
  'Accretech Korea Co., Ltd.',
  '경기도 화성시 동탄대로24길 31-8, IMS빌딩 205호',
  'TEL 031-786-4093',
] as const

/** 공급자 — 고정값. */
export const SUPPLIER = {
  name: '㈜아크레텍 코리아 (Accretech Korea Co., Ltd.)',
  address: '경기도 화성시 동탄대로24길 31-8, IMS빌딩 205호',
  tel: '031-786-4093',
} as const
