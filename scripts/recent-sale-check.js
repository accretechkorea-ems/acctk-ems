// 「최근 판매」 판정 시험 — 열쇠 맞추기와 마지막 한 건 고르기.
//
//   node scripts/recent-sale-check.js
//
// 왜 따로 두는가 — 이 값은 사람이 단가를 정할 때 보는 기준이다. 틀린 값을 「지난번 판 값」
// 이라고 보여 주면 그대로 따라 적는다. 조회는 순수하지 않지만 **무엇을 고르는가**는
// 순수 함수라 여기서 못 박는다.

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

const { recentSaleKey, pickLatestSales } = load(path.join(ROOT, 'lib/recentSalePrice.ts'))
const { ORDERED_STATUSES, isOrdered } = load(path.join(ROOT, 'lib/quoteStatus.ts'))

let fails = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`)
  if (!ok) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}

console.log('── 열쇠 ──')
eq('가격표 id 가 먼저다', recentSaleKey({ priceListId: 77, partCode: 'KT35000' }), 'id:77')
eq('id 가 없으면 품번 글자', recentSaleKey({ priceListId: null, partCode: 'KT35000' }), 'code:KT35000')
eq('품번은 대문자·공백 정리', recentSaleKey({ partCode: '  kt35000 ' }), 'code:KT35000')
eq('둘 다 없으면 null', recentSaleKey({}), null)
eq('빈 품번도 null', recentSaleKey({ partCode: '   ' }), null)
eq('null·undefined', [recentSaleKey(null), recentSaleKey(undefined)], [null, null])
eq('id 가 0 이어도 id 로 본다', recentSaleKey({ priceListId: 0 }), 'id:0')

console.log('\n── 마지막 한 건 고르기 ──')
{
  const rows = [
    { price_list_id: 7, part_code: 'A1', unit_price_krw: 100000, quote_id: 1, quote_number: 'AKB20260101-A', quote_date: '2026-01-01' },
    { price_list_id: 7, part_code: 'A1', unit_price_krw: 120000, quote_id: 2, quote_number: 'AKB20260601-A', quote_date: '2026-06-01' },
    { price_list_id: 7, part_code: 'A1', unit_price_krw: 110000, quote_id: 3, quote_number: 'AKB20260301-A', quote_date: '2026-03-01' },
  ]
  const m = pickLatestSales(rows)
  eq('늦은 날짜가 이긴다', m.get('id:7'), { unitPrice: 120000, quoteDate: '2026-06-01', quoteNumber: 'AKB20260601-A' })
  eq('품번 글자로도 찾힌다', m.get('code:A1').unitPrice, 120000)
}
{
  // 날짜가 같으면 나중에 만든 건(quote_id 큰 쪽)
  const rows = [
    { price_list_id: 9, part_code: null, unit_price_krw: 50000, quote_id: 10, quote_number: 'X-A', quote_date: '2026-05-05' },
    { price_list_id: 9, part_code: null, unit_price_krw: 60000, quote_id: 11, quote_number: 'X-B', quote_date: '2026-05-05' },
  ]
  eq('같은 날짜면 뒤에 만든 건', pickLatestSales(rows).get('id:9').quoteNumber, 'X-B')
}
{
  // 한 견적에 같은 품번이 두 줄 — 한 건만 남는다
  const rows = [
    { price_list_id: 5, part_code: 'B', unit_price_krw: 30000, quote_id: 4, quote_number: 'Y-A', quote_date: '2026-02-02' },
    { price_list_id: 5, part_code: 'B', unit_price_krw: 30000, quote_id: 4, quote_number: 'Y-A', quote_date: '2026-02-02' },
  ]
  const m = pickLatestSales(rows)
  eq('열쇠는 둘(id·품번)', [...m.keys()].sort(), ['code:B', 'id:5'])
  eq('단가는 하나', m.get('id:5').unitPrice, 30000)
}

console.log('\n── 버리는 줄 ──')
{
  const rows = [
    { price_list_id: 1, part_code: 'Z', unit_price_krw: 0, quote_id: 1, quote_number: 'A', quote_date: '2026-01-01' },
    { price_list_id: 2, part_code: 'Y', unit_price_krw: -5000, quote_id: 2, quote_number: 'B', quote_date: '2026-01-01' },
    { price_list_id: 3, part_code: 'X', unit_price_krw: 10000, quote_id: 3, quote_number: 'C', quote_date: null },
    { price_list_id: 4, part_code: 'W', unit_price_krw: null, quote_id: 4, quote_number: 'D', quote_date: '2026-01-01' },
  ]
  eq('단가 0·음수·날짜 없음·단가 없음 — 전부 버린다', pickLatestSales(rows).size, 0)
}
eq('빈 목록', pickLatestSales([]).size, 0)
{
  // 날짜에 시각이 붙어 있어도 앞 10자만 본다
  const rows = [{ price_list_id: 6, part_code: null, unit_price_krw: 77000, quote_id: 1, quote_number: 'T', quote_date: '2026-04-04T09:00:00+09:00' }]
  eq('날짜는 앞 10자', pickLatestSales(rows).get('id:6').quoteDate, '2026-04-04')
}

console.log('\n── 「팔았다」로 세는 상태 ──')
eq('수주 이상만', [...ORDERED_STATUSES], ['수주', '발주(주문 대기)', '주문완료', '세금계산서 요청', '매출완료'])
eq('견적중은 아니다', isOrdered('견적중'), false)
eq('보류·실패도 아니다', [isOrdered('보류'), isOrdered('실패')], [false, false])
eq('매출완료는 그렇다', isOrdered('매출완료'), true)

console.log(fails === 0 ? '\n모두 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
