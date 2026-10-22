// 개인 대시보드 카드의 숫자 규칙 시험.
//
//   node scripts/home-cards-check.js
//
// 왜 따로 두는가 — 카드의 숫자와 「내 견적」 표의 숫자가 **같아야** 한다. 기간을 재는 날짜가
// 지표마다 다르고(견적일·발주일·계산서 완료일) 시각은 한국 기준으로 읽어야 해서, 한 칸만
// 어긋나도 둘이 다른 값을 낸다. 화면을 띄우지 않고 규칙 함수만 돌린다.

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
  monthKpi, stageBars, CARD_STAGES, quoteStatusCounts, CARD_QUOTE_STATUSES, countByKey,
} = load(path.join(ROOT, 'lib/homeCards.ts'))
const { NOTI_GROUPS, notiGroupOf } = load(path.join(ROOT, 'lib/notificationGroups.ts'))

let fails = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
}

const ME = 7
const MONTH = '2026-10'
const q = over => ({
  status: '견적중', quote_date: '2026-10-05', purchase_order_at: null,
  tax_invoice_completed_at: null, total_supply: 1000, total_profit: 0, engineer_id: ME, ...over,
})

// ── 이번 달 숫자 ──────────────────────────────────────────────────────────
console.log('── 이번 달 실적 ──')
{
  const k = monthKpi([
    q({ total_supply: 1000 }),                                                   // 견적 제출
    q({ status: '주문완료', purchase_order_at: '2026-10-07T01:00:00Z', total_supply: 2000 }), // 수주(+제출)
    q({ status: '매출완료', purchase_order_at: '2026-09-20T01:00:00Z', tax_invoice_completed_at: '2026-10-15T02:00:00Z', total_supply: 3000, total_profit: 600 }),
    q({ engineer_id: 99, total_supply: 9999 }),                                  // 남의 건
  ], { month: MONTH, engineerId: ME, yearTarget: { sales: 12000, order: 24000 } })
  eq('견적 제출 — 그 달 견적일', k.quoted, 6000)
  eq('수주 — 발주일이 그 달', k.ordered, 2000)
  eq('매출 — 계산서 완료일이 그 달', k.revenue, 3000)
  eq('순이익은 매출 건에서만', k.profit, 600)
  eq('이익률', Math.round(k.profitRate), 20)
  eq('남의 실적은 세지 않는다', k.quoted < 9999, true)
  eq('목표는 연간 ÷ 12', [k.salesTarget, k.orderTarget], [1000, 2000])
  eq('달성률', [Math.round(k.salesAchieve), Math.round(k.orderAchieve)], [300, 100])
}
// 한국 새벽에 찍힌 시각이 전달로 밀리지 않는다(UTC 9/30 16:00 = 한국 10/01 01:00).
eq('발주 시각은 한국 기준으로 읽는다',
  monthKpi([q({ status: '주문완료', purchase_order_at: '2026-09-30T16:00:00Z', total_supply: 500 })],
    { month: MONTH, engineerId: ME, yearTarget: { sales: 0, order: 0 } }).ordered, 500)
eq('목표가 없으면 달성률은 null',
  monthKpi([], { month: MONTH, engineerId: ME, yearTarget: { sales: 0, order: 0 } }).salesAchieve, null)
eq('매출이 0이면 이익률도 null',
  monthKpi([], { month: MONTH, engineerId: ME, yearTarget: { sales: 1, order: 1 } }).profitRate, null)

// ── 상태별 건수(카드 본문) ────────────────────────────────────────────────
console.log('\n── 내 견적 상태별 건수 ──')
{
  const rows = quoteStatusCounts([
    q({ status: '견적중' }), q({ status: '견적중', quote_date: '2024-01-01' }), // 기간을 보지 않는다
    q({ status: '발주(주문 대기)' }),
    q({ status: '주문완료' }), q({ status: '주문완료' }), q({ status: '주문완료' }),
    q({ status: '매출완료' }),                       // 세지 않는다
    q({ status: '실패' }), q({ status: '반려' }),     // 목록에 없는 상태
    q({ status: '견적중', engineer_id: 99 }),         // 남의 건
  ], ME)
  eq('네 줄이 늘 같은 순서로 나온다', rows.map(r => r.status), [...CARD_QUOTE_STATUSES])
  eq('견적중 2건 — 오래된 것도 센다', rows[0].count, 2)
  eq('발주 1건', rows[1].count, 1)
  eq('주문완료 3건', rows[2].count, 3)
  eq('세금계산서 요청 0건도 줄은 남는다', rows[3].count, 0)
  eq('매출완료는 어느 줄에도 없다', rows.some(r => r.status === '매출완료'), false)
  eq('남의 건·그 밖 상태는 세지 않는다', rows.reduce((s2, r) => s2 + r.count, 0), 6)
}

// ── 포캐스트 막대 ─────────────────────────────────────────────────────────
console.log('\n── 단계별 막대 ──')
{
  const o = over => ({ opportunity_id: 1, stage: '상담', expected_amount: 100, closed_at: null, created_at: '2026-09-01T00:00:00Z', engineer_id: ME, ...over })
  const bars = stageBars([
    o({ opportunity_id: 1 }), o({ opportunity_id: 2, expected_amount: 200 }),
    o({ opportunity_id: 3, stage: '협상', expected_amount: 500 }),
    o({ opportunity_id: 4, stage: '수주', expected_amount: 900, closed_at: '2026-10-01T00:00:00Z' }), // 종료 — 제외
  ])
  eq('다섯 단계가 늘 나온다', bars.map(b => b.stage), [...CARD_STAGES])
  eq('상담 2건 300', [bars[0].count, bars[0].amount], [2, 300])
  eq('협상 1건 500', [bars[3].count, bars[3].amount], [1, 500])
  eq('종료된 건은 빠진다', [bars[4].count, bars[4].amount], [0, 0])
}

// ── 열쇠별 건수 ───────────────────────────────────────────────────────────
console.log('\n── 열쇠별 건수(결재 종류·알림 묶음) ──')
{
  const docs = [
    { doc_type: 'quote' }, { doc_type: 'quote' },
    { doc_type: 'quote_delete' },
    { doc_type: 'showroom' },
    { doc_type: 'unknown_kind' },   // 등록표에 없는 종류
    { doc_type: null },             // 값이 없는 문서
  ]
  const rows = countByKey(docs, d => d.doc_type ?? '기타', ['quote', 'showroom', 'quote_delete'])
  eq('등록 순서대로 먼저 — quote·showroom·quote_delete', rows.slice(0, 3).map(r => r.key), ['quote', 'showroom', 'quote_delete'])
  eq('quote 2건', rows[0].count, 2)
  eq('모르는 종류도 사라지지 않고 뒤에 붙는다', rows.slice(3).map(r => r.key).sort(), ['unknown_kind', '기타'])
  eq('합계는 넘긴 건수와 같다', rows.reduce((a, r) => a + r.count, 0), docs.length)
  eq('0 건인 열쇠는 줄을 내지 않는다', countByKey([], d => d.doc_type, ['quote']).length, 0)
}
{
  const n = t => ({ type: t })
  const rows = countByKey([n('quote_new'), n('quote_won'), n('lead_assigned'), n('approval_turn'), n('tax_invoice_done')],
    x => notiGroupOf(x.type), NOTI_GROUPS)
  eq('알림 묶음 순서는 화면 탭과 같다', rows.map(r => r.key), ['견적', '리드', '요청/결재', '기타'])
  eq('견적 2건', rows[0].count, 2)
  eq('접두어에 안 걸리면 기타', notiGroupOf('tax_invoice_done'), '기타')
  eq('기타가 마지막 묶음이다', NOTI_GROUPS[NOTI_GROUPS.length - 1], '기타')
}

console.log(fails === 0 ? '\n모두 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
