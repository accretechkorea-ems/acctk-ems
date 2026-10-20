// 가격표 파서 시험 — **가짜 통합문서**로 돌린다(실데이터 없이).
//
//   node scripts/price-list-parse-check.js
//   node scripts/price-list-parse-check.js "C:/path/실제파일.xlsx"   ← 머리글 탐색만 확인(선택)
//
// 왜 가짜 파일인가 — 본사 가격표는 실제 품번·가격이라 저장소에 둘 수 없다. 그래서 시트 모양만
// 흉내 낸다. 머리글 이름 변형(한글로 고쳐 쓴 파일), CMM Main 의 구입가 두 열, Calibration 의
// 섹션·머리글 반복·충돌 품번, 쉼표·¥ 가 섞인 문자열 숫자, 소수까지 한 번에 본다.
// 품번·가격은 모두 꾸민 값이다(TEST- 로 시작한다).
//
// 읽는 길은 화면과 **같다**: xlsx 로 시트를 2차원 배열로 만들고 parsePriceSheet 에 넘긴다.

// eslint 의 no-require-imports 는 **맨 require()** 를 센다. 이 파일은 node 로 직접 돌리는
// CJS 스크립트라 모듈을 그렇게 불러올 수밖에 없다 — 한 번만 묶어 두고 그것만 쓴다
// (경고 수를 늘리지 않으려는 것이고, 동작은 require 와 같다).
const load = module.require.bind(module)
const path = load('path')
const Module = load('module')
const ROOT = path.join(__dirname, '..')
const XLSX = load(path.join(ROOT, 'node_modules/xlsx'))
const ts = load(path.join(ROOT, 'node_modules/typescript'))

// .ts 를 그대로 require 한다(파서가 TypeScript 라서).
for (const ext of ['.ts', '.tsx']) {
  Module._extensions[ext] = (mod, filename) => {
    const src = load('fs').readFileSync(filename, 'utf8')
    const out = ts.transpileModule(src, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
      fileName: filename,
    }).outputText
    mod._compile(out, filename)
  }
}
const origResolve = Module._resolveFilename
Module._resolveFilename = function (req, ...rest) {
  if (req.startsWith('@/')) req = path.join(ROOT, req.slice(2))
  return origResolve.call(this, req, ...rest)
}

const { parsePriceSheet, pickSheetName, cleanNumber, cleanLeadTime } = load(path.join(ROOT, 'lib/priceListParse.ts'))
const { kindOf, isTwentySheet } = load(path.join(ROOT, 'lib/priceListKinds.ts'))
const { itemTextOnSelect } = load(path.join(ROOT, 'lib/priceItemText.ts'))

let fails = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
}
const has = (name, hay, needle) => {
  const ok = String(hay).includes(needle)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}  「${needle}」 ${ok ? '있음' : '없음 — 실제: ' + hay}`)
}

/** 2차원 배열 → 시트 → 다시 2차원 배열(화면이 지나는 길과 같게). */
const toRows = aoa => XLSX.utils.sheet_to_json(XLSX.utils.aoa_to_sheet(aoa), {
  header: 1, defval: null, blankrows: true,
})
const parse = (aoa, sheet) => parsePriceSheet(toRows(aoa), kindOf(sheet), sheet)

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 1. SFG Main · 영문 원본 머리글 ──')
// 머리글이 2행이고 1행에 Valid date 문구가 있는 모양.
const sfgMain = [
  ['Valid date : From 1 April 2026 to 30 September 2026.\nTEST FILE', null, null, null, null, null, null, null, null],
  ['Plnt', 'Group', 'Item code', 'Model', 'Description', 'Model (EN)', 'Description (EN)', 'List Price', 'Net price'],
  ['3000', '831M', 'TEST-A001', 'TESTSURF 10', '1um,TEST', 'TESTSURF 10', '1um,TEST', 200000, 120000],
  ['3000', '831M', 'TEST-A002', 'TESTSURF 20', '2um,TEST', 'TESTSURF 20', '2um,TEST', '1,500,000', '¥ 900,000'],
  ['3000', '831M', 'TEST-A003', 'TESTSURF 30', '3um,TEST', null, null, null, null],
  [null, null, null, null, null, null, null, null, null],
]
const r1 = parse(sfgMain, 'SFG Main')
eq('머리글 행(엑셀 번호)', r1.headerRow, 2)
eq('오류 없음', r1.errors, [])
eq('읽은 줄', r1.readRows, 3)
eq('등록 대상', r1.rows.length, 2)
eq('구입가 없어 제외', r1.skippedNoCost.map(s => s.item_code), ['TEST-A003'])
eq('Valid date 문구', r1.validText, 'Valid date : From 1 April 2026 to 30 September 2026. TEST FILE')
eq('모델 → item_name_jp', r1.rows[0].item_name_jp, 'TESTSURF 10')
eq('설명 → model_jp', r1.rows[0].model_jp, '1um,TEST')
eq('Model (EN) → note1_jp', r1.rows[0].note1_jp, 'TESTSURF 10')
eq('Description (EN) → note2_jp', r1.rows[0].note2_jp, '1um,TEST')
eq('note3_jp 는 읽지 않는다', r1.rows[0].note3_jp, null)
eq('plnt / grp', [r1.rows[0].plnt, r1.rows[0].grp], ['3000', '831M'])
eq('쉼표·¥ 섞인 문자열 숫자', [r1.rows[1].price_jpy, r1.rows[1].cost_jpy], [1500000, 900000])
eq('variant 는 빈 문자열', r1.rows[0].variant, '')

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 2. SFG Accessory · 한글로 고쳐 쓴 머리글 + 소수 ──')
const korean = [
  ['Valid date : From 1 April 2026 to 30 September 2026.'],
  ['플랜트', '그룹', '아이템코드', '모델', '디스크립션', '리스트프라이스', '넷프라이스'],
  ['3000', '832A', 'TEST-B001', 'TESTVICE', '양측개방', 50000.4, 30000.6],
  ['3000', '832A', 'TEST-B002', 'TESTSTAND', '경사대', ' 60,000 ', '35,000'],
]
const r2 = parse(korean, 'SFG Accessory')
eq('머리글 행', r2.headerRow, 2)
eq('오류 없음', r2.errors, [])
eq('등록 대상', r2.rows.length, 2)
eq('소수 반올림(정가·구입가)', [r2.rows[0].price_jpy, r2.rows[0].cost_jpy], [50000, 30001])
eq('공백 섞인 숫자', [r2.rows[1].price_jpy, r2.rows[1].cost_jpy], [60000, 35000])
eq('한글 머리글도 모델 → item_name_jp', r2.rows[0].item_name_jp, 'TESTVICE')

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 3. CMM Main body · 구입가 두 열(Jig 포함/제외) ──')
const cmmMain = [
  ['Valid date : From 1 April 2026 to 30 September 2026.'],
  ['Plnt', 'Group', 'Item code', 'Model', 'Description', 'List Price', 'Net price with Jig', 'Net price without Jig'],
  ['3000', '841C', 'TEST-C001', 'TESTZAX 1', '400x400', 9000000, 5000000, 4500000],
  ['3000', '841C', 'TEST-C002', 'TESTZAX 2', '600x600', 9500000, null, 4800000],
  ['3000', '841C', 'TEST-C003', 'TESTZAX 3', '800x800', 9900000, null, null],
]
const r3 = parse(cmmMain, 'CMM Main body')
eq('오류 없음', r3.errors, [])
eq('읽은 줄', r3.readRows, 3)
eq('두 줄로 갈라진 결과 수', r3.rows.length, 3)
eq('품번은 그대로', r3.rows.map(x => x.item_code), ['TEST-C001', 'TEST-C001', 'TEST-C002'])
eq('variant', r3.rows.map(x => x.variant), ['jig_in', 'jig_out', 'jig_out'])
eq('설명 끝 표기', r3.rows.map(x => x.model_jp),
  ['400x400 (Jig 포함)', '400x400 (Jig 제외)', '600x600 (Jig 제외)'])
eq('구입가', r3.rows.map(x => x.cost_jpy), [5000000, 4500000, 4800000])
eq('양쪽 다 빈 줄은 제외', r3.skippedNoCost.map(s => s.item_code), ['TEST-C003'])

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 4. Calibration · 섹션·머리글 반복·충돌 품번 ──')
const calibration = [
  ['Valid date : From 1 April 2026 to 30 September 2026.'],
  ['■ TEST SECTION 1'],
  ['Product code', 'Product name', 'Specification', 'Calibration items', 'List Price', 'Net Price', '仕切価格'],
  ['TEST-D001', 'TEST 교정 A', '0.1급', '길이·직각도', 300000, 200000, '#REF!'],
  ['TEST-D002', 'TEST 교정 B', '1급', '길이', 100000, '80,000', '#REF!'],
  [null, null, null, null, null, null, null],
  ['■ TEST SECTION 2'],
  ['Product code', 'Product name', 'Specification', 'Calibration items', 'List Price', 'Net Price', '仕切価格'],
  ['TEST-D002', 'TEST 교정 B', '1급', '길이', 100000, '80,000', '#REF!'],
  ['TEST-D003', 'TEST 교정 C', '2급', '평면도', 150000, null, '#REF!'],
]
const r4 = parse(calibration, 'Calibration')
eq('머리글 행(섹션 아래 3행)', r4.headerRow, 3)
eq('오류 없음', r4.errors, [])
// 머리글 아래의 「■ SECTION 2」와 반복 머리글 둘. 완전히 빈 줄은 세지 않는다(셀 틈새라서).
eq('품목 아닌 줄(섹션·반복 머리글)', r4.skippedNonItem, 2)
eq('등록 대상', r4.rows.length, 2)
eq('값이 같은 중복은 합침', r4.merged, 1)
eq('구입가 없는 줄 제외', r4.skippedNoCost.map(s => s.item_code), ['TEST-D003'])
eq('Product name → item_name_jp', r4.rows[0].item_name_jp, 'TEST 교정 A')
eq('Specification → model_jp', r4.rows[0].model_jp, '0.1급')
eq('Calibration items → note1_jp', r4.rows[0].note1_jp, '길이·직각도')
eq('仕切価格(#REF!) 열은 읽지 않는다', r4.rows[0].cost_jpy, 200000)

console.log('\n── 4b. 같은 품번이 값이 다르면 막는다 ──')
const conflictSheet = [
  ['Product code', 'Product name', 'Specification', 'Net Price'],
  ['TEST-D009', 'TEST 교정 X', '1급', 80000],
  ['TEST-D009', 'TEST 교정 X', '1급', 95000],
]
const r4b = parse(conflictSheet, 'Calibration')
eq('충돌 품번', r4b.conflicts, ['TEST-D009'])
has('충돌 오류 문구', r4b.errors.join(' '), '같은 품번이 서로 다른 값으로')
has('충돌 오류에 품번', r4b.errors.join(' '), 'TEST-D009')

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 5. 필수 열이 없을 때 ──')
const noCostCol = [
  ['Item code', 'Model', 'Description', 'List Price'],
  ['TEST-E001', 'TESTX', '설명', 1000],
]
const r5 = parse(noCostCol, 'SFG Main')
has('구입가 열 없음 문구', r5.errors.join(' '), '「구입가」 열을 찾지 못했습니다')
has('후보 안내', r5.errors.join(' '), 'Net price')
eq('등록 대상 0', r5.rows.length, 0)

const noCodeCol = [
  ['Model', 'Description', 'Net price'],
  ['TESTX', '설명', 1000],
]
has('품번 열 없음 문구', parse(noCodeCol, 'SFG Main').errors.join(' '), '「품번」 열을 찾지 못했습니다')

console.log('\n── 5b. 구입가가 있는 줄이 하나도 없을 때 ──')
const allEmpty = [
  ['Item code', 'Model', 'Description', 'List Price', 'Net price'],
  ['TEST-F001', 'TESTX', '설명', 1000, null],
  ['TEST-F002', 'TESTY', '설명', 2000, ''],
]
const r5b = parse(allEmpty, 'SFG Main')
has('등록 대상 0건 오류', r5b.errors.join(' '), '등록할 수 있는 줄이 없습니다')
eq('제외 건수', r5b.skippedNoCost.length, 2)

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 6. 시트 고르기 ──')
const kMain = kindOf('SFG Main')
eq('이름이 같은 시트', pickSheetName(['Revision history', 'SFG Main', 'CMM Main body'], kMain).name, 'SFG Main')
eq('시트가 하나뿐이면 이름이 달라도', pickSheetName(['내가 고친 이름'], kMain).name, '내가 고친 이름')
has('하나뿐일 때 안내', pickSheetName(['내가 고친 이름'], kMain).note, '시트가 하나뿐이라')
eq('공백·대소문자만 다른 시트', pickSheetName(['sfg  main', 'HS+ promo'], kMain).name, 'sfg  main')
const miss = pickSheetName(['Revision history', 'CMM Spare'], kMain)
eq('못 찾으면 고르지 않는다', miss.name, null)
has('못 찾았을 때 안내', miss.error, '「SFG Main」 시트를 찾지 못했습니다')

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 7. 숫자 다듬기 ──')
eq('쉼표', cleanNumber('1,234,567'), 1234567)
eq('통화기호', cleanNumber('¥ 1,000'), 1000)
eq('소수 반올림', cleanNumber(1000.5), 1001)
eq('문자열 소수', cleanNumber('999.49'), 999)
eq('빈 값', [cleanNumber(''), cleanNumber(null), cleanNumber(undefined)], [null, null, null])
eq('엑셀 오류값', [cleanNumber('#REF!'), cleanNumber('#N/A')], [null, null])
eq('하이픈', cleanNumber('-'), null)
eq('글자', cleanNumber('문의'), null)

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 9. 20 가격표 · 머리글 행 6 · 묶음 제목 · 개월 납기 ──')
// 20 파일은 머리글 위 줄 수가 시트마다 다르다(실측 3~5행). 자동 탐색이 잡아야 한다.
// 묶음 제목은 품번 칸이 비고 품명 칸에 「[이름]」만 있는 줄이다.
const twentyW10 = [
  [null, 'Transaction Price list', null, null, null, null, null, 46000],
  [null, null, null, null, null, null, null, null],
  [null, 'Effective from the purchase order', null, null, null, null, null, null],
  [null, 'The manager has overall responsibility', null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null],
  [null, 'PRODUCT CODE', 'PRODUCT NAME', 'SPEC', 'LIST PRICE (JPY)', 'TRANSACTION PRICE (JPY)', 'Standard lead time', 'Comments'],
  [null, null, '[TEST BOX]', null, null, '', null, null],
  [null, 'TEST-G001', 'TEST BOX LE', 'E-TEST001', 500000, 250000, '2.5 month', '시험'],
  [null, 'TEST-G002', 'TEST BOX', 'E-TEST002', 700000, 350000, '1.0 month', null],
  [null, null, '[TEST UNIT]', null, null, null, null, null],
  [null, 'TEST-G003', 'TEST UNIT', 'E-TEST003', 300000, 150000, '-', null],
  [null, 'TEST-G004', 'TEST UNIT 2', 'E-TEST004', 300000, null, '1.0 month', null],
]
const r9 = parse(twentyW10, 'W10')
eq('머리글 행 6', r9.headerRow, 6)
eq('오류 없음', r9.errors, [])
eq('등록 대상', r9.rows.length, 3)
eq('묶음 제목 줄', r9.sectionRows, 2)
eq('품목 아닌 줄에 묶음 제목이 들어간다', r9.skippedNonItem >= 2, true)
eq('구입가 없는 줄 제외', r9.skippedNoCost.map(x => x.item_code), ['TEST-G004'])
eq('PRODUCT NAME → item_name_jp', r9.rows[0].item_name_jp, 'TEST BOX LE')
eq('SPEC → model_jp', r9.rows[0].model_jp, 'E-TEST001')
eq('TRANSACTION PRICE → cost_jpy', r9.rows[0].cost_jpy, 250000)
eq('LIST PRICE → price_jpy', r9.rows[0].price_jpy, 500000)
eq('Comments → note1_jp', r9.rows[0].note1_jp, '시험')
eq('Plnt 없음', r9.rows[0].plnt, null)
eq('묶음 제목이 grp 로 내려온다', r9.rows.map(x => x.grp), ['TEST BOX', 'TEST BOX', 'TEST UNIT'])
eq('개월 → 주 (2.5 → 10)', r9.rows[0].delivery_time, '10')
eq('개월 → 주 (1.0 → 4)', r9.rows[1].delivery_time, '4')
eq('「-」 는 납기 없음', r9.rows[2].delivery_time, null)
eq('납기 환산 건수', r9.deliveryConverted, 2)
eq('Valid date 문구 없음', r9.validText, null)
eq('맨 위 날짜를 참고로 읽는다', r9.topDate, '2025-12-09')

console.log('\n── 9b. 20 가격표 · 머리글 행 4 · 다른 시트의 같은 품번 ──')
const twentyGauge = [
  [null, null, null, null, null, null, null, null],
  [null, 'Transaction Price list', null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null],
  [null, 'PRODUCT CODE', 'PRODUCT NAME', 'SPEC', 'LIST PRICE (JPY)', 'TRANSACTION PRICE (JPY)', 'Standard lead time', 'Comments'],
  [null, null, '[Gauge system]', null, null, null, null, null],
  // W10 시트에도 있는 품번이다 — **시트가 다르면 따로 저장되므로 막지 않는다.**
  [null, 'TEST-G001', 'TEST GAUGE', 'E-TEST900', 120000, 60000, '1.5 month', null],
  [null, 'TEST-G900', 'TEST GAUGE 2', 'E-TEST901', '240,000', '¥ 120,000', '3.0 month', null],
]
const r9b = parse(twentyGauge, 'Gauge')
eq('머리글 행 4', r9b.headerRow, 4)
eq('오류 없음', r9b.errors, [])
eq('등록 대상', r9b.rows.length, 2)
eq('다른 시트의 같은 품번은 그대로 등록', r9b.rows[0].item_code, 'TEST-G001')
eq('묶음 제목', r9b.rows[0].grp, 'Gauge system')
eq('1.5 month → 6주', r9b.rows[0].delivery_time, '6')
eq('쉼표·¥ 섞인 숫자', [r9b.rows[1].price_jpy, r9b.rows[1].cost_jpy], [240000, 120000])

console.log('\n── 9c. 같은 시트 안에서 값이 다른 중복은 20 에서도 막는다 ──')
const twentyDup = [
  ['PRODUCT CODE', 'PRODUCT NAME', 'SPEC', 'LIST PRICE (JPY)', 'TRANSACTION PRICE (JPY)'],
  ['TEST-G800', 'TEST AMP', 'E-TEST800', 100000, 50000],
  ['TEST-G800', 'TEST AMP', 'E-TEST800', 100000, 55000],
]
has('20 충돌 차단', parse(twentyDup, 'Amp').errors.join(' '), '같은 품번이 서로 다른 값으로')

console.log('\n── 9d. 80 종류는 납기를 보내지 않는다 ──')
// 80 가격표의 delivery_time 은 사람이 손으로 채운 값이라 엑셀로 덮지 않는다.
const eighty = parse(sfgMain, 'SFG Main')
eq('80 줄에 delivery_time 키가 없다', 'delivery_time' in eighty.rows[0], false)
eq('80 납기 환산 0', eighty.deliveryConverted, 0)
eq('20 줄에는 delivery_time 키가 있다', 'delivery_time' in r9.rows[0], true)

console.log('\n── 9e. 납기 글자 다루기 ──')
eq('2.5 month', cleanLeadTime('2.5 month'), { weeks: '10', converted: true })
eq('1.0 month', cleanLeadTime('1.0 month'), { weeks: '4', converted: true })
eq('3 months', cleanLeadTime('3 months'), { weeks: '12', converted: true })
eq('2 weeks 는 그대로', cleanLeadTime('2 weeks'), { weeks: '2', converted: false })
eq('하이픈', cleanLeadTime('-'), { weeks: null, converted: false })
eq('빈 값', cleanLeadTime(null), { weeks: null, converted: false })
eq('단위 없는 숫자는 부풀리지 않는다', cleanLeadTime('3'), { weeks: '3', converted: false })
eq('글자만', cleanLeadTime('문의'), { weeks: null, converted: false })

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 10. 품목을 고를 때 품명 칸에 채우는 글자 ──')
// 80 은 「(설명)」을 붙이고, 20 은 PRODUCT NAME 을 넣는다. 판별은 sheet_name 으로 한다.
const pick80 = { sheet_name: 'SFG Main', item_code: 'TEST-A001', item_name_jp: 'TESTSURF 10', model_jp: '1um,TEST' }
const pick20 = { sheet_name: 'W10', item_code: 'TEST-G001', item_name_jp: 'TEST BOX LE', model_jp: 'E-TEST001' }

eq('80 · 빈 품명 → (설명)', itemTextOnSelect('', false, pick80), '(1um,TEST)')
eq('80 · 적어 둔 품명 뒤에 덧붙인다', itemTextOnSelect('스타일러스', false, pick80), '스타일러스 (1um,TEST)')
eq('80 · 품목 교체 → 새 (설명)만', itemTextOnSelect('예전 글자', true, pick80), '(1um,TEST)')
eq('80 · 설명이 없으면 손대지 않는다',
  itemTextOnSelect('내가 쓴 품명', false, { ...pick80, model_jp: null }), '내가 쓴 품명')

eq('20 · 빈 품명 → PRODUCT NAME', itemTextOnSelect('', false, pick20), 'TEST BOX LE')
eq('20 · 품목 교체 → 새 PRODUCT NAME', itemTextOnSelect('예전 글자', true, pick20), 'TEST BOX LE')
eq('20 · 규격(SPEC)은 품명에 붙지 않는다',
  itemTextOnSelect('', false, pick20).includes('E-TEST001'), false)
eq('20 · PRODUCT NAME 이 비면 손대지 않는다',
  itemTextOnSelect('내가 쓴 품명', false, { ...pick20, item_name_jp: null }), '내가 쓴 품명')

eq('묶음 판별은 sheet_name 으로', [isTwentySheet('W10'), isTwentySheet('SFG Main'), isTwentySheet(null)],
  [true, false, false])
eq('모르는 sheet_name 은 80 으로 다룬다', itemTextOnSelect('', false, { ...pick80, sheet_name: 'ZZ Test' }), '(1um,TEST)')

// ════════════════════════════════════════════════════════════════════════════
// 선택: 실제 구조 파일로 **머리글 탐색만** 확인한다. 내용·가격은 찍지 않는다.
const realPath = process.argv[2]
if (realPath) {
  console.log('\n── 8. 실제 구조 파일 (머리글 탐색만) ──')
  const wb = XLSX.readFile(realPath)
  const kind = kindOf(pickSheetName(wb.SheetNames, kMain).name === null ? 'SFG Main' : 'SFG Main')
  const picked = pickSheetName(wb.SheetNames, kind)
  console.log('  시트 수:', wb.SheetNames.length, '· 고른 시트:', picked.name, picked.note || picked.error)
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[picked.name], { header: 1, defval: null, blankrows: true })
  const res = parsePriceSheet(rows, kind, picked.name)
  console.log('  머리글 행:', res.headerRow)
  console.log('  찾은 열:', res.columns.map(c => `${c.label}=${c.header}(${c.index})`).join(' · '))
  console.log('  읽은 줄:', res.readRows, '· 등록 대상:', res.rows.length,
    '· 구입가 없어 제외:', res.skippedNoCost.length, '· 합친 중복:', res.merged)
  console.log('  오류:', res.errors.length === 0 ? '없음' : res.errors.join(' | '))
  console.log('  경고:', res.warnings.length === 0 ? '없음' : res.warnings.join(' | '))
}

console.log(fails === 0 ? '\n모두 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
