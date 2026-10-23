// 분류별 수익 규칙 시험 — 판관비·영업이익·기본 이익률.
//
//   node scripts/quote-profit-check.js
//
// 왜 따로 두는가 — 화면(수익 분석)과 엑셀(이익률 분석표)이 **같은 함수**를 봐야 한다.
// 판관비는 매출 기준이고 저장값(total_profit)은 매출이익 그대로라서, 둘을 섞으면
// 실적 현황 숫자까지 흔들린다. 그 경계를 여기서 못 박는다.

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

const {
  CATEGORY_PROFIT_RULES, DEFAULT_MARGIN, defaultMarginOf, sgaRateOf, profitBreakdown,
} = load(path.join(ROOT, 'lib/quoteProfit.ts'))
const {
  inValidQuoteView, EXPIRY_TRACKED_STATUSES, quoteExpiry, isExpired,
} = load(path.join(ROOT, 'lib/quoteStatus.ts'))

let fails = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
}

console.log('── 분류별 기본값 ──')
eq('TSE 이익률 기본 60', defaultMarginOf('TSE'), 60)
eq('SBS 는 40(규칙 없음)', defaultMarginOf('SBS'), DEFAULT_MARGIN)
eq('분류 미선택도 40', defaultMarginOf(null), 40)
eq('모르는 분류도 40', defaultMarginOf('ZZZ'), 40)
eq('TSE 판관비율 0.30', sgaRateOf('TSE'), 0.30)
eq('그 밖은 판관비 없음', sgaRateOf('SBS'), 0)
eq('규칙 표에는 TSE 만 있다', Object.keys(CATEGORY_PROFIT_RULES), ['TSE'])

console.log('\n── TSE: 원가 100만 · 이익률 60% ──')
{
  // 이익률 60% 는 「매출의 60%가 이익」이라는 뜻이다 → 매출 = 원가 ÷ 0.4 = 250만.
  const cost = 1000000
  const revenue = 2500000
  const b = profitBreakdown(revenue, cost, 'TSE')
  eq('매출 250만', b.revenue, 2500000)
  eq('원가 100만', b.cost, 1000000)
  eq('매출이익 150만', b.grossProfit, 1500000)
  eq('매출이익률 60%', Math.round(b.grossRate * 10) / 10, 60)
  eq('판관비 75만(매출 30%)', b.sga, 750000)
  eq('영업이익 75만', b.operatingProfit, 750000)
  eq('영업이익률 30%', Math.round(b.operatingRate * 10) / 10, 30)
  eq('판관비 줄을 낸다', b.hasSga, true)
}

console.log('\n── 같은 숫자, 비TSE(SBS) ──')
{
  const b = profitBreakdown(2500000, 1000000, 'SBS')
  eq('매출이익 150만(같다)', b.grossProfit, 1500000)
  eq('판관비 0', b.sga, 0)
  eq('영업이익 = 매출이익', b.operatingProfit, b.grossProfit)
  eq('영업이익률 = 매출이익률', b.operatingRate, b.grossRate)
  eq('판관비 줄을 내지 않는다', b.hasSga, false)
}

console.log('\n── 경계 ──')
{
  const zero = profitBreakdown(0, 0, 'TSE')
  eq('매출 0 — 0으로 나누지 않는다', [zero.grossRate, zero.operatingRate, zero.sga], [0, 0, 0])
  const loss = profitBreakdown(1000000, 900000, 'TSE')
  eq('매출이익 10만 · 판관비 30만', [loss.grossProfit, loss.sga], [100000, 300000])
  eq('영업이익은 적자(−20만)', loss.operatingProfit, -200000)
  eq('적자율 −20%', Math.round(loss.operatingRate * 10) / 10, -20)
  const odd = profitBreakdown(1000001, 0, 'TSE')
  eq('판관비는 원 단위로 반올림', odd.sga, 300000)
}

console.log('\n── 유효 견적 목록 판정 ──')
{
  const today = '2026-10-23'
  // 만료일 = 작성일 + 1개월 − 1일. 9/1 작성 → 9/30 만료(오늘 10/23 에는 이미 지났다).
  eq('만료일 계산', quoteExpiry('2026-09-01'), '2026-09-30')
  eq('그 건은 오늘 만료 상태다', isExpired('2026-09-01', today), true)

  // 진행 중인 상태 — 기간 안이면 남고, 만료됐어도(미종결) 남는다.
  eq('견적중·기간 안', inValidQuoteView('견적중', '2026-10-20', today, true), true)
  eq('견적중·만료(미종결) — 남긴다', inValidQuoteView('견적중', '2026-09-01', today, false), true)
  eq('결재중·만료 — 남긴다', inValidQuoteView('결재중', '2026-09-01', today, false), true)
  eq('보류·만료 — 남긴다', inValidQuoteView('보류', '2026-09-01', today, false), true)
  eq('발주 대기·만료 — 남긴다', inValidQuoteView('발주(주문 대기)', '2026-09-01', today, false), true)

  // 결과가 난 상태 — 기간과 무관하게 늘 보인다(예전에는 기간 밖이면 사라졌다).
  for (const st of ['주문완료', '세금계산서 요청', '매출완료', '실패']) {
    eq(st + ' — 기간 밖·오래된 건도 보인다', inValidQuoteView(st, '2024-01-01', today, false), true)
  }
  eq('반려도 보인다', inValidQuoteView('반려', '2024-01-01', today, false), true)
  eq('추적 상태 목록은 넷', [...EXPIRY_TRACKED_STATUSES], ['견적중', '결재중', '보류', '발주(주문 대기)'])
  eq('상태가 비어도 막지 않는다', inValidQuoteView(null, '2024-01-01', today, false), true)
}

console.log(fails === 0 ? '\n모두 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
