// 포캐스트 집계 규칙 시험 — 합성 데이터로 판정·합계를 확인한다.
//
//   node scripts/forecast-check.js
//
// 왜 따로 두는가 — 이 집계는 **본사 보고 숫자**가 된다. 규칙이 한 칸만 어긋나도
// 합계가 조용히 두 배가 되거나(이중 집계) 한 달씩 밀린다(월 판정). 화면을 띄우지 않고
// 순수 함수(lib/forecast.ts)만 돌린다.
//   ① 견적 상태별 판정과 월      ② 영업기회 지연 판정
//   ③ 연결된 영업기회 제외        ④ 목표 ÷12
//   ⑤ 월 합계 = 줄 합계           ⑥ 회계연도 경계(4월 시작)

// eslint 의 no-require-imports 는 맨 require() 를 센다. 이 파일은 node 로 직접 돌리는
// CJS 스크립트라 모듈을 그렇게 불러올 수밖에 없다 — 한 번만 묶어 두고 그것만 쓴다.
const load = module.require.bind(module)
const path = load('path')
const Module = load('module')
const ROOT = path.join(__dirname, '..')
const ts = load(path.join(ROOT, 'node_modules/typescript'))

for (const ext of ['.ts', '.tsx']) {
  Module._extensions[ext] = (mod, filename) => {
    const src = load('fs').readFileSync(filename, 'utf8')
    mod._compile(ts.transpileModule(src, {
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
  toForecastRow, buildForecast, fiscalYearOfMonth, fiscalMonths,
  bucketTotal, emptyBucket, isCancelReason, isExcludedFromForecast, UNCATEGORIZED,
} = load(path.join(ROOT, 'lib/forecast.ts'))

let fails = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
}

const TODAY = '2026-10-21'

// 합성 견적 — 실제 고객·금액이 아니다.
const quote = (over) => ({
  quote_id: 1, quote_number: 'No.TST20261001-A', status: '견적중',
  quote_date: '2026-10-01', purchase_order_at: null, fail_reason: null,
  total_supply: 1000, category: 'SURFACE', form_kind: 'parts80',
  engineer_id: 7, customer_id: 100, dealer_id: null, opportunity_id: null,
  created_at: '2026-10-01T00:00:00Z', ...over,
})
const opp = (over) => ({
  opportunity_id: 1, stage: '상담', expected_close: '2026-11-30', expected_amount: 500,
  engineer_id: 7, customer_id: 100, closed_at: null,
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...over,
})

// ── ① 견적 ────────────────────────────────────────────────────────────────
console.log('── ① 견적 상태별 판정과 월 ──')
{
  const r = toForecastRow(quote(), TODAY)
  eq('견적중 → 포캐스트', r.status, '포캐스트')
  // 10/01 작성 → 유효기간 끝 10/31 → 그 달이 예상월이다.
  eq('예상월 = 유효기간이 끝나는 달', r.month, '2026-10')
  eq('금액은 공급가', r.amount, 1000)
  eq('저장값을 함께 싣는다', r.rawStatus, '견적중')
  eq('견적 줄의 마지막 수정일은 null(quotes 에 칸이 없다)', r.updatedAt, null)
}
eq('월말 작성이면 다음 달이 예상월',
  toForecastRow(quote({ quote_date: '2026-10-31' }), TODAY).month, '2026-11')
{
  const r = toForecastRow(quote({ status: '발주(주문 대기)', purchase_order_at: '2026-11-03T05:00:00Z' }), TODAY)
  eq('발주 → 수주확정', r.status, '수주확정')
  eq('월은 발주일', r.month, '2026-11')
}
eq('주문완료도 수주확정',
  toForecastRow(quote({ status: '주문완료', purchase_order_at: '2026-09-30T01:00:00Z' }), TODAY).status, '수주확정')
eq('매출완료도 수주확정',
  toForecastRow(quote({ status: '매출완료', purchase_order_at: '2026-09-30T01:00:00Z' }), TODAY).status, '수주확정')
eq('발주일이 없으면 견적일의 달로 떨어진다',
  toForecastRow(quote({ status: '주문완료', purchase_order_at: null }), TODAY).month, '2026-10')
// 한국 새벽에 찍힌 발주 시각이 전달로 밀리지 않는다(UTC 10/31 16:00 = 한국 11/01 01:00).
eq('발주 시각은 한국 기준으로 읽는다',
  toForecastRow(quote({ status: '주문완료', purchase_order_at: '2026-10-31T16:00:00Z' }), TODAY).month, '2026-11')
eq('실패 → 실주',
  toForecastRow(quote({ status: '실패', fail_reason: '유효기간 만료' }), TODAY).status, '실주')
eq('실패 + 사유에 「취소」 → 구매취소',
  toForecastRow(quote({ status: '실패', fail_reason: '고객 내부 사정으로 구매 취소' }), TODAY).status, '구매취소')
eq('사유가 없으면 실주', toForecastRow(quote({ status: '실패', fail_reason: null }), TODAY).status, '실주')
eq('취소 판정은 글자로 본다', [isCancelReason('발주 취소'), isCancelReason('유효기간 만료'), isCancelReason(null)], [true, false, false])
// 그 밖의 상태 — 아직 살아 있는 건으로 보고 포캐스트에 넣는다.
for (const s of ['수리중', '결재중', '취소요청', '보류']) {
  eq(`${s} → 포캐스트`, toForecastRow(quote({ status: s }), TODAY).status, '포캐스트')
}
// 반려는 **줄 자체를 만들지 않는다** — 다시 올리는 길이 없고 새 견적서를 쓰므로,
// 남겨 두면 같은 건이 두 줄이 되어 합계가 부풀어 오른다.
eq('반려는 빼는 줄', isExcludedFromForecast(quote({ status: '반려' })), true)
eq('견적중은 빼지 않는다', isExcludedFromForecast(quote({ status: '견적중' })), false)
eq('보류·취소요청·수리중도 빼지 않는다',
  ['보류', '취소요청', '수리중'].map(s => isExcludedFromForecast(quote({ status: s }))), [false, false, false])
eq('영업기회는 빼지 않는다', isExcludedFromForecast(opp()), false)
{
  const built = buildForecast({
    quotes: [quote({ quote_id: 1, status: '견적중', total_supply: 100 }), quote({ quote_id: 2, status: '반려', total_supply: 900 })],
    opportunities: [], targets: [], today: TODAY,
  })
  eq('반려 견적은 줄에 없다', built.rows.map(r => r.id), [1])
  eq('합계에도 들어가지 않는다', built.byPersonMonth['7']['2026-10'].포캐스트, 100)
}

// ── ② 영업기회 ────────────────────────────────────────────────────────────
console.log('\n── ② 영업기회 판정 ──')
eq('상담 + 앞으로의 달 → 포캐스트', toForecastRow(opp(), TODAY).status, '포캐스트')
eq('예상월 = expected_close 의 달', toForecastRow(opp(), TODAY).month, '2026-11')
eq('이번 달이면 아직 지연이 아니다',
  toForecastRow(opp({ expected_close: '2026-10-31' }), TODAY).status, '포캐스트')
eq('지난 달인데 아직 진행 단계 → 지연',
  toForecastRow(opp({ expected_close: '2026-09-30' }), TODAY).status, '지연')
eq('지연이어도 달은 그대로(옮기지 않는다)',
  toForecastRow(opp({ expected_close: '2026-09-30' }), TODAY).month, '2026-09')
for (const s of ['사양검토', '견적제출', '협상']) {
  eq(`${s} + 지난 달 → 지연`, toForecastRow(opp({ stage: s, expected_close: '2026-08-31' }), TODAY).status, '지연')
}
eq('수주 → 수주확정(지난 달이어도)',
  toForecastRow(opp({ stage: '수주', expected_close: '2026-08-31' }), TODAY).status, '수주확정')
eq('실주 → 실주', toForecastRow(opp({ stage: '실주', expected_close: '2026-08-31' }), TODAY).status, '실주')
eq('영업기회 줄에는 분류·양식·견적번호가 없다',
  [toForecastRow(opp(), TODAY).category, toForecastRow(opp(), TODAY).formKind, toForecastRow(opp(), TODAY).no],
  [null, null, null])

// ── ③ 이중 집계 방지 ──────────────────────────────────────────────────────
console.log('\n── ③ 견적이 가리키는 영업기회는 빼고 센다 ──')
{
  const built = buildForecast({
    quotes: [quote({ quote_id: 11, opportunity_id: 1, total_supply: 1000 })],
    opportunities: [opp({ opportunity_id: 1, expected_amount: 500 }), opp({ opportunity_id: 2, expected_amount: 700 })],
    targets: [], today: TODAY,
  })
  eq('줄 수 — 견적 1 + 연결 안 된 기회 1', built.rows.length, 2)
  eq('연결된 기회(1)는 빠졌다', built.rows.filter(r => r.source === 'opportunity').map(r => r.id), [2])
  eq('합계가 두 배가 되지 않는다',
    built.rows.reduce((s, r) => s + r.amount, 0), 1700)
}

// ── ④ 목표 ÷ 12 ───────────────────────────────────────────────────────────
console.log('\n── ④ 목표는 연간 수주 목표 ÷ 12 ──')
{
  const built = buildForecast({
    quotes: [], opportunities: [],
    targets: [{ engineer_id: 7, year: 2026, quarter: null, order_target_amount: 1200 }],
    today: TODAY,
  })
  const m = built.byPersonMonth['7']
  eq('열두 달에 들어간다', Object.keys(m).length, 12)
  eq('4월부터 다음해 3월까지', [Object.keys(m).sort()[0], Object.keys(m).sort().slice(-1)[0]], ['2026-04', '2027-03'])
  eq('한 달 목표', m['2026-04'].목표, 100)
  eq('1~3월은 **다음 해**에 붙는다(회계연도 4월 시작)', m['2027-03'].목표, 100)
  eq('목표 말고는 0', m['2026-04'].포캐스트, 0)
}
eq('분기 목표 행은 보지 않는다',
  Object.keys(buildForecast({
    quotes: [], opportunities: [],
    targets: [{ engineer_id: 7, year: 2026, quarter: 1, order_target_amount: 1200 }], today: TODAY,
  }).byPersonMonth).length, 0)

// ── ⑤ 월 합계 = 줄 합계 ───────────────────────────────────────────────────
console.log('\n── ⑤ 합계가 줄과 맞는가 ──')
{
  const built = buildForecast({
    quotes: [
      quote({ quote_id: 1, total_supply: 1000 }),                                              // 포캐스트 2026-10
      quote({ quote_id: 2, status: '주문완료', purchase_order_at: '2026-10-05T01:00:00Z', total_supply: 2000 }), // 수주확정 2026-10
      quote({ quote_id: 3, status: '실패', fail_reason: '유효기간 만료', total_supply: 300 }),   // 실주 2026-10
      quote({ quote_id: 4, status: '실패', fail_reason: '구매 취소', total_supply: 400, category: null }), // 구매취소 2026-10 · 미분류
    ],
    opportunities: [opp({ opportunity_id: 9, expected_close: '2026-09-30', expected_amount: 500 })], // 지연 2026-09
    targets: [{ engineer_id: 7, year: 2026, quarter: null, order_target_amount: 1200 }],
    engineers: [{ engineer_id: 7, team_id: 14 }],
    today: TODAY,
  })
  const rowSum = built.rows.reduce((s, r) => s + r.amount, 0)
  const personSum = Object.values(built.byPersonMonth)
    .flatMap(byM => Object.values(byM))
    .reduce((s, b) => s + bucketTotal(b) - b.목표, 0)
  eq('담당자별 합계(목표 제외) = 줄 합계', personSum, rowSum)
  const catSum = Object.values(built.byCategoryMonth)
    .flatMap(byM => Object.values(byM))
    .reduce((s, b) => s + bucketTotal(b), 0)
  eq('분류별 합계 = 줄 합계(분류별에는 목표가 없다)', catSum, rowSum)
  eq('10월 칸', built.byPersonMonth['7']['2026-10'],
    { 목표: 100, 포캐스트: 1000, 지연: 0, 수주확정: 2000, 실주: 300, 구매취소: 400 })
  eq('9월 칸은 지연만(+목표)', built.byPersonMonth['7']['2026-09'],
    { 목표: 100, 포캐스트: 0, 지연: 500, 수주확정: 0, 실주: 0, 구매취소: 0 })
  eq('분류 없는 줄은 미분류로 모인다', built.byCategoryMonth[UNCATEGORIZED]['2026-10'].구매취소, 400)
  eq('팀이 붙는다', built.rows[0].teamId, 14)
  eq('기간을 주면 그 달만 남는다',
    buildForecast({
      quotes: [quote({ quote_id: 1 })], opportunities: [],
      targets: [{ engineer_id: 7, year: 2026, quarter: null, order_target_amount: 1200 }],
      today: TODAY, from: '2026-11', to: '2026-12',
    }).rows.length, 0)
}

// ── ⑥ 회계연도 경계 ───────────────────────────────────────────────────────
console.log('\n── ⑥ 회계연도는 4월 시작 ──')
eq('4월은 그 해', fiscalYearOfMonth('2026-04'), 2026)
eq('3월은 전년도', fiscalYearOfMonth('2026-03'), 2025)
eq('12월은 그 해', fiscalYearOfMonth('2026-12'), 2026)
eq('1월은 전년도', fiscalYearOfMonth('2027-01'), 2026)
eq('열두 달 목록', fiscalMonths(2026).slice(0, 3).concat(fiscalMonths(2026).slice(-1)),
  ['2026-04', '2026-05', '2026-06', '2027-03'])
eq('빈 칸의 모양', emptyBucket(), { 목표: 0, 포캐스트: 0, 지연: 0, 수주확정: 0, 실주: 0, 구매취소: 0 })

console.log(fails === 0 ? '\n모두 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
