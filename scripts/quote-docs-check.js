// 거래명세서·수리내역서 규칙 시험 — 문서번호 · 품명 줄 · 합계 · 한 장 유지.
//
//   node scripts/quote-docs-check.js
//
// 왜 따로 두는가 — 둘 다 **고객에게 나가는 문서**다. 문서번호가 어긋나면 같은 견적의
// 서류가 둘로 갈리고, 줄 높이 규칙이 깨지면 A4 한 장이 두 장이 된다. 그리지 않고
// 규칙 함수만 돌린다(lib/quoteDocs.ts 는 순수 모듈이다).

// eslint 의 no-require-imports 는 맨 require() 를 센다. 이 파일은 node 로 직접 돌리는
// CJS 스크립트라 모듈을 그렇게 불러올 수밖에 없다 — 한 번만 묶어 두고 그것만 쓴다.
const load = module.require.bind(module)
const path = load('path')
const Module = load('module')
const ROOT = path.join(__dirname, '..')
const ts = load(path.join(ROOT, 'node_modules/typescript'))

for (const ext of ['.ts', '.tsx']) {
  Module._extensions[ext] = (mod, filename) => {
    mod._compile(ts.transpileModule(load('fs').readFileSync(filename, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
        esModuleInterop: true, jsx: ts.JsxEmit.React,
      }, fileName: filename,
    }).outputText, filename)
  }
}
const origResolve = Module._resolveFilename
Module._resolveFilename = function (req, ...rest) {
  if (req.startsWith('@/')) req = path.join(ROOT, req.slice(2))
  return origResolve.call(this, req, ...rest)
}

const D = load(path.join(ROOT, 'lib/quoteDocs.ts'))

let fails = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
}

const QNO = 'No.AKM20261116-B'

console.log('── 문서번호 ──')
eq('견적번호에서 No. 를 뗀다', D.bareQuoteNumber(QNO), 'AKM20261116-B')
eq('이미 떼어져 있으면 그대로', D.bareQuoteNumber('AKM20261116-B'), 'AKM20261116-B')
eq('거래명세서는 T', D.docNumber(QNO, 'transaction'), 'AKM20261116-BT')
eq('수리내역서는 R', D.docNumber(QNO, 'repair'), 'AKM20261116-BR')
eq('파일 이름', [D.docFileName(QNO, 'transaction'), D.docFileName(QNO, 'repair')],
  ['AKM20261116-BT.pdf', 'AKM20261116-BR.pdf'])

console.log('\n── 거래명세서 품명 줄 ──')
const repair = { serial_number: '000000', product_type: 'E-TS-0000B-P0' }
const gauge = { row_kind: 'price_list', product_name: 'GAUGE HEAD', model_name: 'E-TS-0000B-P0', quantity: 1, supply_amount: 565000 }
eq('수리 건 — 견적번호_모델 (S/N) 수리 건',
  D.transactionItemName(QNO, gauge, repair), 'AKM20261116-B_E-TS-0000B-P0 (S/N 000000) 수리 건')
// 수리 건이 아닌 견적에는 S/N 도 「수리 건」도 붙지 않는다.
eq('일반 견적 — 견적번호_모델', D.transactionItemName(QNO, gauge, null), 'AKM20261116-B_E-TS-0000B-P0')
eq('시리얼이 없으면 S/N 칸을 비운다',
  D.transactionItemName(QNO, gauge, { serial_number: '  ' }), 'AKM20261116-B_E-TS-0000B-P0 수리 건')
eq('모델이 없으면 품명을 쓴다',
  D.transactionItemName(QNO, { row_kind: 'manual_jpy', product_name: '전원부 기판' }, null), 'AKM20261116-B_전원부 기판')
eq('할인 줄은 적힌 글자 그대로',
  D.transactionItemName(QNO, { row_kind: 'discount', product_name: 'SPECIAL DISCOUNT' }, repair), 'SPECIAL DISCOUNT')

console.log('\n── 보조 줄(품명 · 처리 결과 첫 줄) ──')
eq('둘 다 있으면 가운뎃점으로',
  D.transactionItemSub(gauge, '부품 교환 및 출하 조정.\nF.T : G1 −230'), 'GAUGE HEAD · 부품 교환 및 출하 조정.')
eq('처리 결과가 없으면 품명만', D.transactionItemSub(gauge, null), 'GAUGE HEAD')
eq('처리 결과 앞의 빈 줄은 건너뛴다', D.transactionItemSub(gauge, '\n\n  두 번째 줄'), 'GAUGE HEAD · 두 번째 줄')

console.log('\n── 세액·합계 ──')
eq('10% 원 단위 반올림', [D.vatOf(565000), D.vatOf(12345), D.vatOf(0)], [56500, 1235, 0])
eq('할인 줄은 음수 세액', D.vatOf(-430000), -43000)
const items = [
  { row_kind: 'title', product_name: '예비품 견적서', supply_amount: 0 },
  gauge,
  { row_kind: 'manual_jpy', product_name: '케이블', model_name: 'CA-100', quantity: 2, supply_amount: 120000 },
  { row_kind: 'discount', product_name: 'DISCOUNT', quantity: 0, supply_amount: -50000 },
]
const lines = D.transactionLines(QNO, items, repair, '부품 교환')
eq('제목줄은 빠지고 번호가 다시 매겨진다', lines.map(l => l.no), [1, 2, 3])
eq('금액 0 인 줄도 빠진다', D.transactionLines(QNO, [{ row_kind: 'service', supply_amount: 0 }], null, null).length, 0)
eq('합계 = 줄의 합', lines.reduce((s, l) => s + l.supply, 0), 565000 + 120000 - 50000)
eq('세액 합계', lines.reduce((s, l) => s + l.tax, 0), 56500 + 12000 - 5000)

console.log('\n── 한 장 유지(거래명세서) ──')
// 줄 높이 = 남은 높이 ÷ 줄 수. 상한은 양식의 높이, 하한은 9pt 한 줄이다.
eq('남은 높이 = 쪽 − 여백 − 늘 있는 덩어리',
  Math.round((D.TRANSACTION_PAGE_MM - D.TRANSACTION_MARGIN_MM * 2 - D.TRANSACTION_FIXED_MM) * 10) / 10,
  D.TRANSACTION_BODY_MM)
eq('열 줄까지는 상한 그대로', [D.transactionRowHeight(1), D.transactionRowHeight(10)], [11.2, 11.2])
eq('열한 줄이면 남은 높이를 나눈다',
  Math.round(D.transactionRowHeight(11) * 100) / 100, Math.round((121.5 / 11) * 100) / 100)
eq('열여덟 줄도 하한 위', D.transactionRowHeight(18) > D.TRANSACTION_ROW_MIN_MM, true)
eq('하한이 있다(9pt 한 줄)', D.transactionRowHeight(100), 6.5)
eq('한 장에 드는 최대 줄 수', D.TRANSACTION_MAX_ROWS, 18)
eq('열여덟까지 한 장 · 열아홉부터 두 장',
  [D.transactionFitsOnePage(18), D.transactionFitsOnePage(19)], [true, false])

console.log('\n── 수리내역서 — 교환 부품 ──')
eq('파트 성격 줄만 담는다', D.partRows(items).map(r => r.name), ['GAUGE HEAD', '케이블'])
eq('서비스비·할인·제목줄은 빠진다',
  D.partRows([{ row_kind: 'service', product_name: '설치비' }, { row_kind: 'discount' }, { row_kind: 'title' }]).length, 0)
eq('국내 구매는 부품이다', D.partRows([{ row_kind: 'domestic', product_name: 'PC세트', part_code: 'PC-1', quantity: 1 }])[0].code, 'PC-1')
eq('품번이 없으면 -', D.partRows([{ row_kind: 'price_list', product_name: 'X' }])[0].code, '-')
eq('아홉 줄까지는 높이 그대로', [D.partRowHeight(1), D.partRowHeight(9)], [5.9, 5.9])
eq('열 줄이면 줄어든다', Math.round(D.partRowHeight(10) * 100) / 100, 5.31)
// 열넷까지는 전체 높이를 지킨다. 열다섯부터는 **바닥(3.6mm)**에 닿아 표가 길어진다 —
// 그때부터 한 장을 넘길 수 있다(요구는 「아홉 줄까지 1장 보장」이다).
eq('열넷까지는 전체 높이 그대로',
  Math.round(D.partRowHeight(14) * 14 * 10) / 10, Math.round(5.9 * 9 * 10) / 10)
eq('열다섯부터 바닥에 닿는다', D.partRowHeight(15), 3.6)
eq('스무 줄이면 표가 길어진다', Math.round(D.partRowHeight(20) * 20 * 10) / 10, 72)

console.log('\n── 수리 사진 배치 ──')
eq('0장이면 절을 내지 않는다', D.photoLayout(0), { cols: 0, rows: 0, imgMM: 0 })
eq('1장 — 한 칸', D.photoLayout(1), { cols: 1, rows: 1, imgMM: 44 })
eq('2장 — 1×2', D.photoLayout(2), { cols: 2, rows: 1, imgMM: 44 })
eq('3장 — 1×3', D.photoLayout(3), { cols: 3, rows: 1, imgMM: 44 })
eq('4장 — 2×2', D.photoLayout(4), { cols: 2, rows: 2, imgMM: 20 })
// 50mm 는 실측으로 정했다 — 60mm 면 사진이 한 장만 있어도 A4 한 장을 넘겼다.
eq('영역 높이는 고정', D.PHOTO_AREA_MM, 50)

console.log('\n── 접수·처리 칸 ──')
eq('입고 ~ 수리완료', D.workPeriod({ received_date: '2026-11-02', repair_done_at: '2026-11-10T00:00:00+00:00' }), '2026-11-02 ~ 2026-11-10')
eq('완료일이 없으면 입고일만', D.workPeriod({ received_date: '2026-11-02', repair_done_at: null }), '2026-11-02')
eq('둘 다 없으면 -', D.workPeriod(null), '-')
eq('사무실 전화 — 구미', D.officeTel('구미'), '054-971-5512')
eq('사무실 전화 — 그 밖은 동탄', [D.officeTel('동탄'), D.officeTel(null), D.officeTel('')], ['031-786-4093', '031-786-4093', '031-786-4093'])
eq('수리담당 표기', D.personLabel('홍길동', '사원'), '홍길동 사원')
eq('담당자 줄', D.contactLine('홍길동', '책임', '010-0000-0000'), '홍길동 책임 / 010-0000-0000')
eq('전화가 없으면 이름·직위만', D.contactLine('홍길동', '책임', ' '), '홍길동 책임')
eq('직위의 존칭은 뗀다', D.contactLine('홍길동', '팀장님', null), '홍길동 팀장')
eq('긴 날짜', D.longDate('2026-11-16'), '2026년 11월 16일')
eq('날짜가 없으면 -', D.longDate(null), '-')

console.log(fails === 0 ? '\n모두 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
