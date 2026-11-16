// 거래명세서 **쪽수** 시험 — 규칙 함수가 아니라 **그려서** 센다.
//
//   node scripts/transaction-page-check.js
//
// 왜 그려 보는가 — 「A4 한 장」은 숫자 규칙(남은 높이 ÷ 줄 수)으로 정하지만, 그 규칙이
// 맞는지는 실제 레이아웃만 안다. 글줄 간격 하나, 안여백 하나가 바뀌어도 열여덟 줄짜리
// 명세서가 조용히 두 장이 된다(실제로 그런 적이 있다 — 보조 줄 때문에 열 줄에서 두 장).
// 그래서 이 하네스는 PDF 를 만들어 /Type /Page 를 센다.
//
// 긴 품명·두 줄짜리 주소처럼 **가장 불리한 자료**로 그린다. 짧은 글로만 재면 한 장
// 약속이 거짓이 된다.

// eslint 의 no-require-imports 는 맨 require() 를 센다. node 로 직접 돌리는 CJS 라
// 그렇게 부를 수밖에 없다 — 한 번만 묶어 두고 그것만 쓴다.
const load = module.require.bind(module)
const path = load('path')
const fs = load('fs')
const Module = load('module')
const ROOT = path.join(__dirname, '..')
const ts = load(path.join(ROOT, 'node_modules/typescript'))

for (const ext of ['.ts', '.tsx']) {
  Module._extensions[ext] = (mod, filename) => {
    mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
        // 화면 컴포넌트를 node 에서 그린다 — 자동 런타임이라야 React 를 따로 안 넣는다.
        esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX,
      }, fileName: filename,
    }).outputText, filename)
  }
}
const origResolve = Module._resolveFilename
Module._resolveFilename = function (req, ...rest) {
  if (req.startsWith('@/')) req = path.join(ROOT, req.slice(2))
  return origResolve.call(this, req, ...rest)
}

const React = load(path.join(ROOT, 'node_modules/react'))
const pdf = load(path.join(ROOT, 'node_modules/@react-pdf/renderer'))
// 글꼴·로고는 화면에서 **공개 경로**('/fonts/…')로 받는다 — node 에는 그 서버가 없다.
// 같은 family 는 **먼저 등록한 것이 남으므로**, docBase 를 읽기 전에 파일 경로로 등록한다.
pdf.Font.register({ family: 'NotoSansCJK', src: path.join(ROOT, 'public/fonts/NotoSansKR-Regular.ttf') })

const docBase = load(path.join(ROOT, 'components/pdf/docBase.ts'))
const D = load(path.join(ROOT, 'lib/quoteDocs.ts'))
const { TransactionPDFDoc } = load(path.join(ROOT, 'components/pdf/TransactionPDFDoc.ts' + 'x'))

// 로고도 공개 경로라 node 에서는 받아 오지 못한다 — 파일을 그대로 data URL 로 넣는다.
docBase.LOGO_SRC = 'data:image/png;base64,'
  + fs.readFileSync(path.join(ROOT, 'public/pdflogo.png')).toString('base64')

const QNO = 'No.ABC20261116-D'
/** 수리 견적의 품명은 「견적번호_모델 (S/N …) 수리 건」이라 길다 — 그대로 흉내 낸다. */
const item = i => ({
  row_kind: 'manual_jpy',
  product_name: `리프 스프링 교체 세트 ${i + 1} — 게이지 헤드 내부 부품 일체 교환`,
  model_name: 'E-TS-0000B-P0-LONGMODEL-240530',
  quantity: 1,
  supply_amount: 565000 + i * 1000,
})
const doc = n => React.createElement(TransactionPDFDoc, {
  quoteNumber: QNO,
  issuedDate: '2026-11-16',
  customerName: '(주)테스트정밀 제2공장 — 충청남도 천안시',
  // 두 줄로 접히는 긴 주소 — 품목 표 몫을 가장 많이 깎는 경우다.
  customerAddress: '충청남도 천안시 서북구 테스트대로 2, 3층 302호 (테스트동, 테스트빌딩)',
  contact: '강동우 과장 / 010-0000-0000',
  lines: D.transactionLines(QNO, Array.from({ length: n }, (_, i) => item(i)),
    { serial_number: '240530' }, '부품 교환 및 출하 조정. F.T : G1 −230 [um]'),
})
const pageCount = buf => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length

let fails = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
}

;(async () => {
  console.log('── 거래명세서 쪽수(그려서 센다) ──')
  const pages = {}
  for (const n of [5, 10, D.TRANSACTION_MAX_ROWS, D.TRANSACTION_MAX_ROWS + 1]) {
    pages[n] = pageCount(await pdf.renderToBuffer(doc(n)))
  }
  const max = D.TRANSACTION_MAX_ROWS
  eq('다섯 줄 — 한 장', pages[5], 1)
  eq('열 줄(보조 줄까지) — 한 장', pages[10], 1)
  eq(`최대 줄 수(${max}줄) — 한 장`, pages[max], 1)
  eq(`한 줄 더(${max + 1}줄) — 두 장`, pages[max + 1], 2)
  eq('규칙이 말한 것과 같다',
    [D.transactionFitsOnePage(max), D.transactionFitsOnePage(max + 1)],
    [pages[max] === 1, pages[max + 1] === 1])

  console.log(fails === 0 ? '\n모두 통과' : `\n실패 ${fails}건`)
  process.exit(fails === 0 ? 0 : 1)
})().catch(e => { console.error('ERR', e.stack); process.exit(1) })
