// 견적서 PDF 양식 시험 — 세 양식 × 네 가지 줄 수(1 / 10 / 30 / 60)를 실제로 뽑는다.
//
// 왜 필요한가
//   PDF 는 눈으로 봐야 안다. 줄이 넘치는지, 글자가 잘리는지, 칸이 겹치는지는 타입 검사로
//   알 수 없다. 이 스크립트는 **가짜 데이터**로 12장을 만들어 저장소 밖에 떨어뜨린다.
//
// 쓰는 법
//   node scripts/render-quote-samples.mjs [출력폴더]
//   기본 출력폴더: C:/Users/admin/quote-ref/out
//
// ⚠ 실제 고객명·사람 이름·금액을 넣지 마라. 아래 데이터는 전부 지어낸 것이다.
// ⚠ 결과 PDF 는 저장소에 넣지 마라(기본 출력폴더가 저장소 밖이다).
//
// 어떻게 도는가
//   화면 코드(QuotePDFDoc.tsx)를 그대로 쓴다. TypeScript·JSX 라 typescript 로 그 자리에서
//   옮겨 컴파일하고(require 훅), @/ 별칭을 레포 경로로 바꿔 준다. 폰트·로고는 public/ 의
//   파일을 파일시스템 경로로 바꿔 끼운다 — 브라우저가 아니라 node 에서 그리기 때문이다.

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = process.argv[2] ?? 'C:/Users/admin/quote-ref/out'

// ── 폰트·로고를 파일시스템 경로로 — 브라우저가 아니라 node 에서 그린다 ─────
// 화면 코드는 public 경로('/fonts/…', '/pdflogo.png')로 부르는데, node 에는 그 주소를 받아
// 줄 서버가 없다(그대로 두면 fetch 가 실패하고 로고·폰트 없이 그려진다).
// 그래서 **옮긴 소스에서 그 두 글자만** 절대 경로로 바꿔 끼운다.
const FONT = path.join(ROOT, 'public/fonts/NotoSansKR-Regular.ttf')
const LOGO = path.join(ROOT, 'public/pdflogo.png')
for (const [label, p] of [['폰트', FONT], ['로고', LOGO]]) {
  if (!fs.existsSync(p)) { console.error(`${label} 파일이 없다: ${p}`); process.exit(1) }
}
const asJs = (p) => JSON.stringify(p.split(path.sep).join('/'))

// ── TypeScript·JSX 를 그 자리에서 옮긴다 ───────────────────────────────────
const ts = require(path.join(ROOT, 'node_modules/typescript'))
const Module = require('module')
const compile = (m, f) => {
  let out = ts.transpileModule(fs.readFileSync(f, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
    fileName: f,
  }).outputText
  // 폰트는 **경로 글자**를 받는다(fontkit.open). 그림은 경로를 주면 fetch 로 가 버려서
  // (윈도에서 「fetch failed」) **읽어 둔 바이트**를 넘긴다.
  const fontSrc = asJs(FONT)
  const logoSrc = `{ data: require(${asJs('fs')}).readFileSync(${asJs(LOGO)}), format: ${asJs('png')} }`
  out = out.split('"/fonts/NotoSansKR-Regular.ttf"').join(fontSrc)
  out = out.split("'/fonts/NotoSansKR-Regular.ttf'").join(fontSrc)
  out = out.split('"/pdflogo.png"').join(logoSrc)
  out = out.split("'/pdflogo.png'").join(logoSrc)
  return m._compile(out, f)
}
Module._extensions['.ts'] = compile
Module._extensions['.tsx'] = compile
const origResolve = Module._resolveFilename
Module._resolveFilename = function (req, ...rest) {
  if (req.startsWith('@/')) req = path.join(ROOT, req.slice(2))
  return origResolve.call(this, req, ...rest)
}

const reactPdf = require(path.join(ROOT, 'node_modules/@react-pdf/renderer'))
const React = require(path.join(ROOT, 'node_modules/react'))

const { QuotePDFDoc } = require(path.join(ROOT, 'app/quote/QuotePDFDoc.tsx'))
const { createRow } = require(path.join(ROOT, 'app/quote/calc.ts'))
const { DEFAULT_TERMS } = require(path.join(ROOT, 'lib/quoteTerms.ts'))
const { GROUP_KINDS } = require(path.join(ROOT, 'lib/quoteForms.ts'))

// ── 가짜 데이터 ────────────────────────────────────────────────────────────
// 전부 지어낸 값이다. 실제 고객·사람·금액이 아니다.
const FAKE_NAMES = [
  '표면 거칠기 측정기 본체', '하이브리드 검출기', '거칠기·형상 겸용 스타일러스',
  '형상 전용 스타일러스', '거칠기 표준시편', '마스터볼 유닛', '배율교정용 게이지 블록',
  '조정 스탠드', '양면 개방형 바이스', '틸팅 스탠드', '에어 드라이어', '에어 퓨리파이어 세트',
  '아주 긴 품명으로 줄바꿈이 제대로 일어나는지 보려고 일부러 길게 적은 시험용 품목 이름입니다',
  'NOSPACEPARTNUMBERLIKENAMEWITHOUTANYSPACESATALLTOTESTWRAPPING',
]
const FAKE_CODES = [
  'K3FF200', 'E-DT-CR20A', 'DM84071', 'DM48775', 'E-MC-S24D', 'E-MC-S65B',
  'EE60573G622ZK4VERYLONGCODE', 'KP66000', '0940914', 'GZ30001',
]
const FAKE_MODELS = ['E-TS-4182-P6', 'A061413', 'E-DT-95-6B-C30', '', 'A004838-0000', 'SURFCOM-NEX-200']

/** 품목 줄 n 개. 장비 양식이면 묶음을 골고루 섞는다. */
function makeRows(n, { grouped }) {
  const rows = []
  for (let i = 0; i < n; i++) {
    const unit = (i % 7 === 3) ? 0 : (100000 + i * 37000)   // 7개마다 금액 없는 줄
    const qty = 1 + (i % 4)
    const base = createRow()
    rows.push({
      ...base,
      id: `r${i}`,
      itemText: FAKE_NAMES[i % FAKE_NAMES.length],
      partCode: FAKE_CODES[i % FAKE_CODES.length],
      // 가격표에서 고른 품목처럼 보이게 — 20 양식의 「모델」 열이 이 값을 읽는다.
      selectedItem: { model_jp: FAKE_MODELS[i % FAKE_MODELS.length] },
      subLines: i % 11 === 5 ? ['S/N: TEST-0000', '설명 줄이 두 줄일 때'] : [],
      quantity: qty,
      unit_price: unit,
      supply_price: unit * qty,
      tax: Math.round(unit * qty * 0.1),
      group_kind: grouped ? GROUP_KINDS[i % 3] : null,
    })
  }
  return rows
}

/** 특별 할인 줄 하나 — 장비는 합계 블록으로, 나머지는 품목 마지막 줄로 간다. */
function discountRow(amount) {
  return {
    ...createRow(),
    id: 'disc',
    row_kind: 'discount',
    itemText: '특별 할인',
    quantity: 0,
    unit_price: 0,
    supply_price: -amount,
    tax: -Math.round(amount * 0.1),
  }
}

const REMARKS = [
  '* 발주 진행 시 팩스 또는 메일로 발주서 회신 요망',
  '   (FAX : 000-000-0000)',
  '* 발주 후 주문 취소 시 발주 금액의 30%의 위약금이 발생합니다.',
].join('\n')

const CASES = []
for (const formKind of ['parts80', 'general20', 'equip80']) {
  for (const count of [1, 10, 30, 60]) {
    CASES.push({ formKind, count })
  }
}

fs.mkdirSync(OUT, { recursive: true })
console.log('출력 폴더: ' + OUT)
console.log('')

const results = []
for (const { formKind, count } of CASES) {
  const grouped = formKind === 'equip80'
  const rows = makeRows(count, { grouped })
  // 줄이 둘 이상일 때만 할인을 넣는다(1줄 시험은 할인 없이 본다).
  const withDiscount = count > 1 ? [...rows, discountRow(1_500_000)] : rows

  const billable = withDiscount.filter(r => r.row_kind !== 'domestic')
  const totalSupply = billable.reduce((s, r) => s + r.supply_price, 0)
  const totalTax = billable.reduce((s, r) => s + r.tax, 0)

  const el = React.createElement(QuotePDFDoc, {
    company: '시험 거래처 주식회사',
    receiver: count === 1 ? '' : '담당자님',
    quoteNo: 'No.TEST20261019-A',
    dateDisplay: '2026년　10월　19일',
    rows: withDiscount,
    remarks: REMARKS,
    engineerName: '시험 담당 책임',
    engineerTel: '000-0000-0000',
    totalSupply,
    totalTax,
    totalAmount: totalSupply + totalTax,
    showSignature: false,
    terms: { ...DEFAULT_TERMS },
    formKind,
  })

  const name = `${formKind}_${String(count).padStart(2, '0')}rows.pdf`
  const file = path.join(OUT, name)
  await reactPdf.renderToFile(el, file)
  const size = fs.statSync(file).size
  results.push({ name, count, rows: withDiscount.length, size })
  console.log(`  ${name.padEnd(26)} 품목 ${String(withDiscount.length).padStart(2)}줄  ${(size / 1024).toFixed(0)}KB`)
}

console.log('')
console.log(`${results.length}개 만들었다.`)
