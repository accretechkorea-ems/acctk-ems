// 내 견적 요약 여섯 칸 — **셈의 정의**를 못 박는다 (2026-11-28, 야간4 2-1).
//
//   node scripts/my-quotes-summary-check.js
//
// 2-1 은 칸의 **생김새**만 바꾼다(라벨+금액 묶음 여섯 → 같은 폭 회색 타일 한 줄).
// 숫자는 한 자리도 달라지지 않아야 하는데, 눈으로는 가릴 수 없다. 그래서 셈을
// lib/myQuotesSummary.ts 로 내놓고 **고정된 보기**로 여기서 돌린다.
//
// 지키는 약속
//   ① 모수는 engineer_id 가 나인 건이다 — 대필(created_by 가 다른 건)은 원래 담당자 몫.
//   ② 기간을 재는 날짜가 지표마다 다르다(견적 quote_date · 수주 purchase_order_at ·
//      매출 tax_invoice_completed_at). 처리 시각이 비면 그 지표에 잡히지 않는다.
//   ③ 「견적중」은 견적 제출의 **부분집합**이다 — 모수를 따로 쓰지 않는다.
//   ④ 목표가 0 이면 달성률은 null 이다(화면은 「미설정」으로 적는다. 칸은 사라지지 않는다).
//   ⑤ 화면은 그 함수만 쓴다 — 셈을 다시 적은 줄이 패널에 남아 있지 않다.
//
// 키도 서버도 없이 돈다.

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

const { myQuotesSummary } = load(path.join(ROOT, 'lib/myQuotesSummary.ts'))
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')
const code = s => s.split(/\r?\n/).filter(l => {
  const t = l.trim()
  return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
}).join('\n')

const fails = []
let total = 0
const ok = (name, got, want) => {
  total += 1
  const same = JSON.stringify(got) === JSON.stringify(want)
  console.log(`${same ? 'OK  ' : 'FAIL'} ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
  if (!same) fails.push(name)
}

// ── 고정된 보기 ───────────────────────────────────────────────────────────
//   ME(7) 가 나다. 8 은 남이다. 날짜는 FY2026(2026-04-01 ~ 2027-03-31) 안·밖을 섞었다.
const ME = 7
const q = (o) => ({
  engineer_id: ME, status: '견적중', quote_date: '2026-05-01',
  total_supply: 0, total_profit: 0, purchase_order_at: null, tax_invoice_completed_at: null, ...o,
})
const QUOTES = [
  // 내 건 · 기간 안 · 견적중 — 견적 제출에도 견적중에도 든다.
  q({ total_supply: 1_000_000 }),
  q({ total_supply: 2_000_000, quote_date: '2026-06-10' }),
  // 내 건 · 기간 안 · 수주(발주 시각 기간 안) — 견적 제출에도 들지만 견적중은 아니다.
  q({ status: '주문완료', total_supply: 5_000_000, quote_date: '2026-07-01', purchase_order_at: '2026-08-02T01:00:00Z' }),
  // 내 건 · 매출완료(세금계산서 완료 시각 기간 안).
  q({ status: '매출완료', total_supply: 4_000_000, total_profit: 1_000_000, quote_date: '2026-07-20', purchase_order_at: '2026-08-05T01:00:00Z', tax_invoice_completed_at: '2026-09-01T01:00:00Z' }),
  // 내 건 · 수주 시각이 **비어 있다** — 수주로 세지 않는다(상태가 주문완료라도).
  q({ status: '주문완료', total_supply: 9_000_000, quote_date: '2026-08-01' }),
  // 내 건 · 견적일이 **기간 밖**(지난 회계연도) — 견적 제출에 들지 않는다.
  q({ total_supply: 7_000_000, quote_date: '2026-03-31' }),
  // **남의 건** — 어느 칸에도 들지 않는다.
  q({ engineer_id: 8, status: '매출완료', total_supply: 8_000_000, total_profit: 3_000_000, quote_date: '2026-05-05', purchase_order_at: '2026-06-01T01:00:00Z', tax_invoice_completed_at: '2026-06-20T01:00:00Z' }),
]
const BASE = {
  quotes: QUOTES, engineerId: ME,
  rangeStart: '2026-04-01', rangeEnd: '2027-03-31',
  isOrdered: s => s === '주문완료' || s === '세금계산서요청' || s === '매출완료',
  revenueStatus: '매출완료', pendingStatus: '견적중',
  divisor: 1, target: { target: 100_000_000, orderTarget: 50_000_000 },
}
const S = myQuotesSummary(BASE)

console.log('── ① 견적 제출 — quote_date 기준 · 내 건만 ──')
ok('견적 제출 금액', S.quotedAmt, 1_000_000 + 2_000_000 + 5_000_000 + 4_000_000 + 9_000_000)
ok('견적 제출 건수', S.quotedCnt, 5)

console.log('── ② 견적중 — 견적 제출의 부분집합 ──')
ok('견적중 금액', S.pendingAmt, 3_000_000)
ok('견적중 건수', S.pendingCnt, 2)
ok('견적중은 견적 제출을 넘지 않는다', S.pendingAmt <= S.quotedAmt && S.pendingCnt <= S.quotedCnt, true)

console.log('── ③ 수주 — purchase_order_at 기준. 시각이 비면 안 센다 ──')
ok('수주 금액', S.orderedAmt, 5_000_000 + 4_000_000)
ok('수주 건수', S.orderedCnt, 2)
ok('전환율 = 수주 건수 ÷ 견적 제출 건수', Math.round((S.convRate ?? 0) * 10) / 10, 40)

console.log('── ④ 매출 — tax_invoice_completed_at 기준 ──')
ok('매출 금액', S.revenueAmt, 4_000_000)
ok('매출 건수', S.revenueCnt, 1)
ok('순이익', S.profitAmt, 1_000_000)
ok('이익률', S.profitRate, 25)

console.log('── ⑤ 달성률 — 목표를 나눔수로 가른다 ──')
ok('수주 목표(연간, divisor 1)', S.orderTarget, 50_000_000)
ok('수주 달성률', S.orderAchieve, 18)
ok('매출 달성률', S.achieve, 4)
const M = myQuotesSummary({ ...BASE, divisor: 12 })
ok('월(÷12) 이면 목표도 ÷12', [M.orderTarget, M.salesTarget], [4_166_667, 8_333_333])
const NO = myQuotesSummary({ ...BASE, target: null })
ok('목표가 없으면 달성률은 null(칸이 사라지지 않는다)', [NO.orderAchieve, NO.achieve, NO.orderTarget], [null, null, 0])
const EMPTY = myQuotesSummary({ ...BASE, quotes: [] })
ok('견적이 없으면 전환율·이익률도 null(0 으로 나누지 않는다)', [EMPTY.convRate, EMPTY.profitRate, EMPTY.quotedAmt], [null, null, 0])

console.log('── ⑥ 화면은 그 함수만 쓴다 ──')
const PANEL = code(read('components/dashboard/MyQuotesPanel.tsx'))
ok('패널이 myQuotesSummary 를 부른다', /myQuotesSummary\(\{/.test(PANEL), true)
ok('패널에 셈을 다시 적은 줄이 없다(creditedQuotes)', /creditedQuotes/.test(PANEL), false)
ok('패널에 옛 달성률 셈이 없다', /orderTarget > 0 \? \(orderedAmt/.test(PANEL), false)

console.log('── ⑦ 여섯 칸의 생김새 ──')
const RAW = read('components/dashboard/MyQuotesPanel.tsx')
ok('공용 타일을 쓴다', /import StatTile from '@\/components\/sales\/StatTile'/.test(RAW), true)
ok('타일이 여섯이다', (RAW.match(/<StatTile /g) || []).length, 6)
for (const label of ['견적 제출', '견적중', '수주액', '매출 완료액', '수주 달성률', '매출 달성률']) {
  ok(`「${label}」 칸이 있다`, RAW.includes(`label="${label}"`), true)
}
ok('금액은 칸반 축약 함수를 쓴다(제 포맷을 만들지 않는다)',
  /krwShort\(S\.quotedAmt\)/.test(RAW) && /krwFull\(S\.quotedAmt\)/.test(RAW), true)
ok('모달 안 중복 제목 「내 견적」을 걷었다', />내 견적<\/div>/.test(RAW), false)
ok('한 줄 격자는 globals.css 한 곳이다', /\.myq-tiles \{/.test(read('app/globals.css')), true)
ok('폰(≤768)에서는 3칸으로 접는다',
  /@media \(max-width: 768px\) \{\s*\r?\n\s*\.myq-tiles \{\s*\r?\n\s*grid-template-columns: repeat\(3/.test(read('app/globals.css')), true)

console.log('── ⑧ 실적 현황도 같은 타일을 쓴다 ──')
const SALES = read('app/sales/page.tsx')
ok('실적 현황이 공용 타일을 가져온다', /import StatTile from '@\/components\/sales\/StatTile'/.test(SALES), true)
ok('실적 현황에 타일 정의가 남아 있지 않다', /function StatTile\(/.test(SALES), false)

if (fails.length > 0) {
  console.error('\n실패:')
  for (const f of fails) console.error('  · ' + f)
  process.exit(1)
}
console.log(`\n통과 — 내 견적 요약 여섯 칸(검사 ${total}개 · 실패 0)`)
