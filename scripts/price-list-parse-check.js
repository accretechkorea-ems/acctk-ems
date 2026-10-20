// 가격표 파서 시험 — **가짜 워크시트**로 돌린다(실데이터 없이).
//
//   node scripts/price-list-parse-check.js
//   node scripts/price-list-parse-check.js "C:/path/실제파일.xlsx" [종류]   ← 머리글 탐색만(선택)
//
// 왜 가짜 파일인가 — 본사 가격표는 실제 품번·가격이라 저장소에 둘 수 없다. 그래서 시트 모양만
// 흉내 낸다. 아래 4번 묶음은 **실제 Calibration (JPY) 시트에서 확인한 사실**을 그대로
// 재현한 것이다(머리글 7번 반복, 묶음 제목 둘, A열만 있는 줄, 都度見積·TBC, 같은 품번 11쌍).
// 품번·가격·품명은 모두 꾸민 값이고, 실제 파일의 글자는 묶음 제목 이름만 따왔다.
//
// 읽는 길은 화면과 **같다**: 워크시트를 만들어 parseSheet 에 넘긴다.

// eslint 의 no-require-imports 는 맨 require() 를 센다. 이 파일은 node 로 직접 돌리는
// CJS 스크립트라 모듈을 그렇게 불러올 수밖에 없다 — 한 번만 묶어 두고 그것만 쓴다.
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

const {
  parseSheet, parseWorkbook, pickSheetName, cleanNumber, cleanLeadTime, sheetToRows,
  HEADER_NAMES, REQUIRED_HEADERS,
} = load(path.join(ROOT, 'lib/priceListParse.ts'))
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

/** 2차원 배열 → 워크시트(화면이 xlsx 에서 받는 것과 같은 모양). */
const sheet = aoa => XLSX.utils.aoa_to_sheet(aoa)
/** 그 워크시트를 파서에 넘긴다. */
const parse = (aoa, line, name) => parseSheet(sheet(aoa), line, name)

// 한글 머리글 일곱 개 + 읽지 않아야 하는 여덟째 열(Profit Center).
const HEAD = ['품번', '품명', '모델', '정가', '구입가', '납기', '비고', 'Profit Center']

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 1. 머리글 찾기 ──')
const basic = [
  ['Valid date : From 1 April 2026 to 30 September 2026.'],
  [],
  HEAD,
  ['TEST-A001', 'TESTSURF 10', 'E-TS10', 200000, 120000, '1.0 month', '시험', '831M'],
  ['TEST-A002', 'TESTSURF 20', 'E-TS20', '1,500,000', '¥ 900,000', '2.5 month', null, '831M'],
]
const r1 = parse(basic, '80', 'SFG Main')
eq('머리글 행(엑셀 번호)', r1.headerRow, 3)
eq('오류 없음', r1.errors, [])
eq('일곱 열을 찾았다', r1.columns.map(c => c.name), ['품번', '품명', '모델', '정가', '구입가', '납기', '비고'])
eq('여덟째 열(Profit Center)은 읽지 않는다', r1.columns.some(c => c.index === 7), false)
eq('Valid date 문구', r1.validText, 'Valid date : From 1 April 2026 to 30 September 2026.')
eq('등록 대상', r1.counts.registered, 2)
eq('품명 → item_name_jp', r1.rows[0].item_name_jp, 'TESTSURF 10')
eq('모델 → model_jp', r1.rows[0].model_jp, 'E-TS10')
eq('비고 → note1_jp', r1.rows[0].note1_jp, '시험')
eq('정가·구입가', [r1.rows[0].price_jpy, r1.rows[0].cost_jpy], [200000, 120000])
eq('쉼표·¥ 섞인 숫자', [r1.rows[1].price_jpy, r1.rows[1].cost_jpy], [1500000, 900000])
eq('sheet_name·line 을 행에 담는다', [r1.rows[0].sheet_name, r1.rows[0].line], ['SFG Main', '80'])
eq('묶음 제목이 없으면 grp 는 null', r1.rows[0].grp, null)
eq('기본 구분은 빈 글자', r1.rows[0].variant, '')
eq('납기 환산(1.0 month → 4주)', r1.rows[0].delivery_time, '4')
eq('납기 환산 건수', r1.counts.deliveryConverted, 2)

console.log('\n── 1b. 열 순서가 달라도 이름으로 찾는다 ──')
const shuffled = [
  ['구입가', '품번', '비고', '품명'],
  [50000, 'TEST-B001', '메모', 'TESTVICE'],
]
const r1b = parse(shuffled, '80', 'SFG Accessory')
eq('오류 없음', r1b.errors, [])
eq('구입가', r1b.rows[0].cost_jpy, 50000)
eq('품번', r1b.rows[0].item_code, 'TEST-B001')
eq('없는 열은 null', [r1b.rows[0].model_jp, r1b.rows[0].price_jpy, r1b.rows[0].delivery_time], [null, null, null])

console.log('\n── 1c. 필수 열이 없으면 오류 ──')
const noCost = parse([['품번', '품명', '모델', '정가'], ['TEST-C001', 'X', 'Y', 1000]], '80', 'SFG Main')
has('구입가 열 없음', noCost.errors.join(' '), '「구입가」 열을 찾지 못했습니다')
has('일곱 이름을 모두 적는다', noCost.errors.join(' '), HEADER_NAMES.join(' / '))
has('필수 열을 적는다', noCost.errors.join(' '), REQUIRED_HEADERS.join(' · '))
eq('등록 대상 0', noCost.counts.registered, 0)
has('품번 열 없음', parse([['품명', '구입가'], ['X', 1000]], '80', 'SFG Main').errors.join(' '),
  '「품번」 열을 찾지 못했습니다')
has('영문 머리글은 읽지 않는다',
  parse([['Item code', 'Model', 'Net price'], ['TEST-D001', 'X', 1000]], '80', 'SFG Main').errors.join(' '),
  '열을 찾지 못했습니다')

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 2. 줄 분류 ──')
const mixed = [
  HEAD,
  ['■첫 묶음', null, null, null, null, null, null, '831M'],
  ['TEST-E001', '품목 하나', 'E-1', 1000, 500, null, null, '831M'],
  ['TEST series', null, null, null, null, null, null, '831M'],   // 품번만 → 품목 아닌 줄
  ['품번', '품명', '모델', '정가', '구입가', '납기', '비고', 'Profit Center'], // 머리글 반복
  ['■둘째 묶음', null, null, null, null, null, null, null],
  ['TEST-E002', '품목 둘', 'E-2', 2000, 1000, null, null, '832A'],
  [null, null, null, null, null, null, null, null],              // 빈 줄
  [null, '[대괄호 묶음]', null, null, null, null, null, null],    // 품번 없이 품명에 [이름]
  ['TEST-E003', '품목 셋', 'E-3', 3000, 1500, null, null, null],
]
const r2 = parse(mixed, '80', 'Calibration')
eq('오류 없음', r2.errors, [])
eq('묶음 제목 줄', r2.counts.sections, 3)
eq('머리글 반복(품목 아닌 줄로 세지 않는다)', r2.counts.headerRepeats, 1)
eq('품목 아닌 줄', r2.counts.nonItem, 1)
eq('품목 줄', r2.counts.itemRows, 3)
eq('묶음 제목이 grp 로 내려온다', r2.rows.map(x => x.grp), ['첫 묶음', '둘째 묶음', '대괄호 묶음'])
eq('grp 에 Profit Center 가 들어가지 않는다', r2.rows.some(x => x.grp === '831M'), false)

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 2b. 머리글 위에 있는 묶음 제목 ──')
// 실제 Calibration (JPY) 는 「■…」 제목이 7행, 머리글이 8행이다. 머리글 아래부터만 읽으면
// 첫 블록 품목의 묶음이 통째로 빈다. 머리글 위를 거꾸로 훑어 처음 만나는 제목을 시작 값으로 쓴다.
const titleAbove = [
  ['Calibration Price List 2026'],                                   // ■ 가 아니라 시트 제목 — 잡지 않는다
  [],
  ['SURFCOM & CONTOURECORD series'],                                 // 계열 이름 — 잡지 않는다
  ['■첫 묶음', 'Remarks : ○・・・Standard', null, null, null, null, null],  // 머리글 바로 위의 묶음 제목
  HEAD.slice(0, 7),                                                  // 머리글 (5행)
  ['TEST-K001', '첫 블록 하나', 'E-K1', 1000, 500, null, null],
  ['TEST-K002', '첫 블록 둘', 'E-K2', 2000, 1000, null, null],
  ['■둘째 묶음', null, null, null, null, null, null],
  ['TEST-K003', '둘째 블록 하나', 'E-K3', 3000, 1500, null, null],
]
const r2b = parse(titleAbove, '80', 'Calibration (JPY)')
eq('머리글 행', r2b.headerRow, 5)
eq('오류 없음', r2b.errors, [])
eq('첫 블록이 머리글 위 제목을 받는다', r2b.rows.slice(0, 2).map(x => x.grp), ['첫 묶음', '첫 묶음'])
eq('아래 제목부터 바뀐다', r2b.rows[2].grp, '둘째 묶음')
eq('■ 아닌 제목 줄은 잡지 않는다', r2b.rows.some(x => String(x.grp).includes('Price List')), false)
eq('계열 이름도 잡지 않는다', r2b.rows.some(x => String(x.grp).includes('series')), false)
// 머리글 위의 제목은 「머리글 아래에서 만난 제목 줄」 셈에 넣지 않는다.
eq('묶음 제목 줄 수는 머리글 아래만 센다', r2b.counts.sections, 1)

console.log('\n── 2c. 머리글 위에 묶음 제목이 없으면 그대로 null ──')
const noTitleAbove = [
  ['Transaction Price list'],
  HEAD.slice(0, 7),
  ['TEST-L001', '묶음 없는 품목', 'E-L1', 1000, 500, null, null],
]
eq('grp 는 null', parse(noTitleAbove, '80', 'SFG Main').rows[0].grp, null)

console.log('\n── 2d. 20 형식의 [이름] 제목이 머리글 위에 있어도 잡는다 ──')
const bracketAbove = [
  [null, '[TEST GROUP]', null, null, null, null, null],
  HEAD.slice(0, 7),
  ['TEST-M001', '품목', 'E-M1', 1000, 500, '1.0 month', null],
]
eq('대괄호 제목도 시작 값이 된다', parse(bracketAbove, '20', 'W10').rows[0].grp, 'TEST GROUP')

console.log('\n── 3. 숫자·납기·오류 칸 ──')
eq('쉼표', cleanNumber('1,234,567'), 1234567)
eq('통화기호 ¥ ￥ 역슬래시', [cleanNumber('¥ 1,000'), cleanNumber('￥2,000'), cleanNumber('\\3,000')], [1000, 2000, 3000])
eq('소수 반올림', [cleanNumber(1000.5), cleanNumber('999.49')], [1001, 999])
eq('빈 값', [cleanNumber(''), cleanNumber(null), cleanNumber(undefined)], [null, null, null])
eq('글자가 섞인 값은 전부 null',
  ['都度見積', 'TBC', '-', '=====', '#REF!', 'Net Price', '문의'].map(cleanNumber),
  [null, null, null, null, null, null, null])
eq('개월 → 주', [cleanLeadTime('1.0 month'), cleanLeadTime('2.5 month'), cleanLeadTime('3 months')],
  [{ weeks: '4', converted: true }, { weeks: '10', converted: true }, { weeks: '12', converted: true }])
eq('ヶ月도 환산', cleanLeadTime('2ヶ月'), { weeks: '8', converted: true })
eq('개월이 아니면 글자 그대로', [cleanLeadTime('2 weeks'), cleanLeadTime('재고')],
  [{ weeks: '2 weeks', converted: false }, { weeks: '재고', converted: false }])
eq('빈칸·하이픈은 납기 없음', [cleanLeadTime(''), cleanLeadTime('-'), cleanLeadTime(null)],
  [{ weeks: null, converted: false }, { weeks: null, converted: false }, { weeks: null, converted: false }])

console.log('\n── 3b. 오류 칸(#REF!)은 숫자로 읽지 않는다 ──')
// 엑셀 오류 칸은 t:'e' 이고 v 가 오류 **번호**다(23 등). 그 번호를 읽으면 가격이 된다.
const errSheet = {
  '!ref': 'A1:C2',
  A1: { t: 's', v: '품번' }, B1: { t: 's', v: '품명' }, C1: { t: 's', v: '구입가' },
  A2: { t: 's', v: 'TEST-F001' }, B2: { t: 's', v: '오류 칸' }, C2: { t: 'e', v: 23, w: '#REF!' },
}
eq('오류 칸은 값이 없는 것으로 본다', sheetToRows(errSheet)[1], ['TEST-F001', '오류 칸', null])
const r3b = parseSheet(errSheet, '80', 'Calibration')
eq('오류 칸 줄은 구입가 없어 제외', r3b.counts.noCost, 1)
eq('오류 번호가 가격으로 들어가지 않는다', r3b.counts.registered, 0)

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 4. Calibration (JPY) 실측 사실 재현 ──')
// 실제 시트에서 확인한 일곱 가지를 한 장에 모았다. 값은 꾸민 것이고 묶음 제목만 실제 글자다.
const JCSS = 'Calibration Price (JCSS calibration)'
const ACCT = 'Calibration Price (ACCRETECH original calibration)'
const ADD_J = 'Additional calibration documents (JCSS calibration)'
const ADD_A = 'Additional calibration documents (ACCRETECH original calibration)'
const headRow = () => [...HEAD]
const item = (code, name, price, cost, grpCol = '831M') =>
  [code, name, 'E-' + code, price, cost, '1.0 month', null, grpCol]
/** 같은 품번 11개를 한 묶음에 넣는다. KA00202C 만 묶음에 따라 값이 다르다. */
const pairBlock = cost202 => {
  const rows = [item('KA00201C', '교정 성적서 추가', 1700, 1700)]
  rows.push(item('KA00202C', '교정 성적서 추가(영문)', 2550, cost202))
  for (let i = 3; i <= 11; i++) {
    const code = 'KA002' + String(i).padStart(2, '0') + 'C'
    rows.push(item(code, '추가 서류 ' + i, 1000 + i, 500 + i))
  }
  return rows
}
const calibration = [
  ['Valid date : From 1 April 2026 to 30 September 2026.'],
  [],
  headRow(),                                    // 머리글 (본체)
  ['■' + JCSS, null, null, null, null, null, null, '831M'],
  ['RONDCOM series', null, null, null, null, null, null, '831M'],      // 품목 아닌 줄 1
  item('TEST-G001', '원통도 교정', 300000, 200000),
  item('TEST-G002', '원통도 교정(간이)', 100000, '都度見積'),             // 구입가 없음 1
  ['SURFCOM series', null, null, null, null, null, null, '831M'],      // 품목 아닌 줄 2
  item('TEST-G003', '표면조도 교정', 150000, 'TBC'),                    // 구입가 없음 2
  item('TEST-G004', '표면조도 교정(현장)', 160000, null),               // 구입가 없음 3
  headRow(),                                    // 머리글 반복 1
  ['ACCTee series', null, null, null, null, null, null, '831M'],       // 품목 아닌 줄 3
  item('TEST-G005', '소프트웨어 교정', 90000, 45000),
  item('TEST-G006', '소프트웨어 교정(출장)', 95000, '都度見積'),           // 구입가 없음 4
  headRow(),                                    // 머리글 반복 2
  ['■' + ACCT, null, null, null, null, null, null, '831M'],
  ['CONTRACER series', null, null, null, null, null, null, '831M'],    // 품목 아닌 줄 4
  item('TEST-H001', '윤곽 교정', 280000, 190000),
  item('TEST-H002', '윤곽 교정(간이)', 120000, 'TBC'),                  // 구입가 없음 5
  headRow(),                                    // 머리글 반복 3
  ['HANDYSURF series', null, null, null, null, null, null, '831M'],    // 품목 아닌 줄 5
  item('TEST-H003', '휴대형 교정', 70000, 35000),
  item('TEST-H004', '휴대형 교정(출장)', 75000, null),                  // 구입가 없음 6
  headRow(),                                    // 머리글 반복 4
  ['ZEISS series', null, null, null, null, null, null, '831M'],        // 품목 아닌 줄 6
  item('TEST-H005', '3차원 교정', 450000, 300000),
  item('TEST-H006', '3차원 교정(간이)', 200000, '都度見積'),              // 구입가 없음 7
  headRow(),                                    // 머리글 반복 5
  ['MarSurf series', null, null, null, null, null, null, '831M'],      // 품목 아닌 줄 7
  item('TEST-H007', '타사 장비 교정', 320000, 'TBC'),                   // 구입가 없음 8
  item('TEST-H008', '타사 장비 교정(간이)', 130000, null),              // 구입가 없음 9
  headRow(),                                    // 머리글 반복 6
  // 머리글을 한글로 바꾸지 않은 영문 섹션 줄 — 구입가 칸이 'Net Price' 라 그 규칙으로 걸린다.
  ['Product code', 'Product name', 'Specification', 'List Price', 'Net Price', null, null, null],
  ['■' + ADD_J, null, null, null, null, null, null, '831M'],
  ...pairBlock(2240),
  headRow(),                                    // 머리글 반복 7
  ['■' + ADD_A, null, null, null, null, null, null, '831M'],
  ...pairBlock(2550),
]
const r4 = parseSheet(sheet(calibration), '80', 'Calibration (JPY)')

console.log('  (1) 머리글 반복')
eq('머리글 반복 7건', r4.counts.headerRepeats, 7)
eq('머리글 반복은 품목 아닌 줄로 세지 않는다', r4.counts.nonItem, 7)
eq('머리글 반복 줄이 품목으로 들어가지 않는다', r4.rows.some(x => x.item_code === '품번'), false)
eq('오류 없음', r4.errors, [])

console.log('  (2) 묶음 제목이 품목에 붙는다')
eq('JCSS 묶음의 품목', r4.rows.find(x => x.item_code === 'TEST-G001').grp, JCSS)
eq('같은 묶음의 뒤쪽 품목도 같은 grp', r4.rows.find(x => x.item_code === 'TEST-G005').grp, JCSS)
eq('다음 묶음부터 바뀐다', r4.rows.find(x => x.item_code === 'TEST-H001').grp, ACCT)
eq('묶음 제목 줄 수', r4.counts.sections, 4)

console.log('  (3) A열에만 글자 있는 줄')
eq('품목 아닌 줄 7건', r4.counts.nonItem, 7)
eq('계열 제목이 품목으로 들어가지 않는다', r4.rows.some(x => x.item_code === 'RONDCOM series'), false)

console.log('  (4)(5) 구입가가 숫자가 아닌 줄')
// 都度見積 3 · TBC 3 · 빈칸 3 = 9, 그리고 영문 섹션 줄('Net Price') 1 = 10.
eq('구입가 없어 제외 10건(9 + 영문 섹션 줄)', r4.counts.noCost, 10)
eq('都度見積·TBC·빈칸 9건', r4.skippedNoCost.filter(x => x.item_code.startsWith('TEST-')).length, 9)
eq('영문 섹션 줄도 같은 규칙으로 걸린다',
  r4.skippedNoCost.some(x => x.item_code === 'Product code'), true)
eq('영문 섹션 줄이 오류를 내지 않는다', r4.errors, [])

console.log('  (6) Profit Center')
eq('grp 에 831M 이 없다', r4.rows.some(x => x.grp === '831M'), false)
eq('grp 는 묶음 제목뿐이다', [...new Set(r4.rows.map(x => x.grp))].sort(), [ADD_A, ADD_J, ACCT, JCSS].sort())

console.log('  (7) 같은 품번 11쌍')
const ka01 = r4.rows.filter(x => x.item_code === 'KA00201C')
const ka02 = r4.rows.filter(x => x.item_code === 'KA00202C')
eq('KA00201C 두 줄 다 나온다', ka01.length, 2)
eq('값이 같으면 구분 없음', ka01.map(x => x.variant), ['', ''])
eq('KA00202C 두 줄 다 나온다', ka02.length, 2)
eq('값이 다르면 묶음 제목이 구분이 된다', ka02.map(x => x.variant), [ADD_J, ADD_A])
eq('KA00202C 구입가', ka02.map(x => x.cost_jpy), [2240, 2550])
eq('구분을 붙인 줄 수', r4.counts.variantTagged, 2)
eq('11쌍이 전부 내보내진다', r4.rows.filter(x => x.item_code.startsWith('KA002')).length, 22)
// 값이 **다른** 쌍만 (품번, 구분)이 갈린다. 값이 같은 쌍은 키가 겹친 채로 나가고
// DB 함수가 하나로 합친다 — 파서는 줄을 지우지 않는다(그게 이 설계의 핵심이다).
const keyOf = x => x.item_code + String.fromCharCode(0) + x.variant
eq('값이 다른 쌍은 (품번, 구분) 이 갈린다', new Set(ka02.map(keyOf)).size, 2)
eq('값이 같은 쌍은 키가 겹친 채로 나간다(DB 가 합친다)', new Set(ka01.map(keyOf)).size, 1)

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 5. 20 가격표도 같은 규칙으로 읽는다 ──')
const twenty = [
  ['Transaction Price list', null, null, null, null, null, null, 46000],
  [],
  [],
  HEAD.slice(0, 7),
  [null, '[TEST BOX]', null, null, null, null, null],
  ['TEST-W001', 'W10 시험 박스', 'E-PW1001', 500000, 250000, '2.5 month', null],
  ['TEST-W002', 'W10 시험 박스 2', 'E-PW1002', 700000, 350000, '-', null],
  [null, '[TEST UNIT]', null, null, null, null, null],
  ['TEST-W003', '시험 유닛', 'E-PW1003', 300000, 150000, '1.0 month', null],
]
const r5 = parse(twenty, '20', 'W10')
eq('머리글 행', r5.headerRow, 4)
eq('오류 없음', r5.errors, [])
eq('등록 대상', r5.counts.registered, 3)
eq('line 을 행에 담는다', [...new Set(r5.rows.map(x => x.line))], ['20'])
eq('대괄호 묶음 제목이 grp 로', r5.rows.map(x => x.grp), ['TEST BOX', 'TEST BOX', 'TEST UNIT'])
eq('납기 환산·글자', r5.rows.map(x => x.delivery_time), ['10', null, '4'])
eq('Valid date 문구가 없다', r5.validText, null)
eq('맨 위 날짜를 참고로 읽는다', r5.topDate, '2025-12-09')

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 6. 통파일 읽기(parseWorkbook) ──')
const wb = { SheetNames: ['Revision history', 'SFG Main', 'W10'], Sheets: {} }
wb.Sheets['Revision history'] = sheet([['날짜', '내용'], ['2026-04-01', '개정']])
wb.Sheets['SFG Main'] = sheet(basic)
wb.Sheets['W10'] = sheet(twenty)
const all = parseWorkbook(wb, '80')
eq('시트마다 결과 하나', all.map(x => x.sheetName), ['Revision history', 'SFG Main', 'W10'])
eq('머리글이 없는 시트는 오류로 남는다', all[0].counts.registered, 0)
has('그 오류 문구', all[0].errors.join(' '), '열을 찾지 못했습니다')
eq('나머지 시트는 읽힌다', [all[1].counts.registered, all[2].counts.registered], [2, 3])
eq('인자로 받은 line 이 모든 시트에 붙는다',
  [...new Set(all.flatMap(x => x.rows.map(r => r.line)))], ['80'])

console.log('\n── 6b. 시트 고르기 ──')
const kMain = kindOf('SFG Main')
eq('이름이 같은 시트', pickSheetName(['Revision history', 'SFG Main', 'W10'], kMain).name, 'SFG Main')
eq('시트가 하나뿐이면 이름이 달라도', pickSheetName(['내가 고친 이름'], kMain).name, '내가 고친 이름')
eq('공백·대소문자만 다른 시트', pickSheetName(['sfg  main', 'HS+ promo'], kMain).name, 'sfg  main')
const miss = pickSheetName(['Revision history', 'CMM Spare'], kMain)
eq('못 찾으면 고르지 않는다', miss.name, null)
has('못 찾았을 때 안내', miss.error, '「SFG Main」 시트를 찾지 못했습니다')

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 7. 품목을 고를 때 품명 칸에 채우는 글자 ──')
// 80 은 「(설명)」을 붙이고, 20 은 품명을 넣는다. 판별은 sheet_name 으로 한다.
const pick80 = { sheet_name: 'SFG Main', item_code: 'TEST-A001', item_name_jp: 'TESTSURF 10', model_jp: '1um,TEST' }
const pick20 = { sheet_name: 'W10', item_code: 'TEST-W001', item_name_jp: 'W10 시험 박스', model_jp: 'E-PW1001' }
eq('80 · 빈 품명 → (설명)', itemTextOnSelect('', false, pick80), '(1um,TEST)')
eq('80 · 적어 둔 품명 뒤에 덧붙인다', itemTextOnSelect('스타일러스', false, pick80), '스타일러스 (1um,TEST)')
eq('80 · 품목 교체 → 새 (설명)만', itemTextOnSelect('예전 글자', true, pick80), '(1um,TEST)')
eq('20 · 빈 품명 → 품명', itemTextOnSelect('', false, pick20), 'W10 시험 박스')
eq('20 · 모델(SPEC)은 품명에 붙지 않는다', itemTextOnSelect('', false, pick20).includes('E-PW1001'), false)
eq('묶음 판별은 sheet_name 으로', [isTwentySheet('W10'), isTwentySheet('SFG Main'), isTwentySheet(null)],
  [true, false, false])

// ════════════════════════════════════════════════════════════════════════════
// 선택: 실제 구조 파일로 **머리글 탐색만** 확인한다. 내용·가격은 찍지 않는다.
const realPath = process.argv[2]
if (realPath) {
  const wantKind = kindOf(process.argv[3] ?? '') ?? kindOf('SFG Main')
  console.log('\n── 8. 실제 구조 파일 (머리글 탐색만) ──')
  const real = XLSX.readFile(realPath)
  for (const name of real.SheetNames) {
    const k = kindOf(name) ?? wantKind
    const res = parseSheet(real.Sheets[name], k.line, name)
    console.log(`  ${name} · 머리글=${res.headerRow} · 품목=${res.counts.itemRows}`
      + ` · 대상=${res.counts.registered} · 제외=${res.counts.noCost} · 묶음=${res.counts.sections}`
      + ` · 머리글반복=${res.counts.headerRepeats} · 품목아닌줄=${res.counts.nonItem}`
      + ` · 구분=${res.counts.variantTagged}`
      + ` · 오류=${res.errors.length === 0 ? '없음' : res.errors[0].slice(0, 40)}`)
    if (res.columns.length > 0) console.log('    열:', res.columns.map(c => `${c.name}=${c.index + 1}`).join(' · '))
  }
}

console.log(fails === 0 ? '\n모두 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
