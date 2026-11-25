// 포캐스트 ↔ 견적 — **앞으로만 움직이는** 맞추기 (2026-11-26).
//
//   node scripts/forecast-link-check.js
//
// 지키는 약속
//   ① 견적 작성 화면의 포캐스트 칸은 **공용 콤보박스**다 — 「연결 안 함」·「새로 만들기」.
//   ② 기본값은 **가장 최근 진행 건**이다(연결을 잊는 일을 줄인다).
//   ③ 단계는 **올리는 쪽으로만** 간다 — 사람이 올려 둔 단계를 자동이 내리지 않는다.
//   ④ 실패·취소는 **자동 실주가 아니다**(사유는 사람이 적는다).
//   ⑤ 금액은 연결 견적의 공급가 합계다. 연결이 없으면 손으로 넣은 값을 둔다.
//   ⑥ 쓰기는 라우트가 한다(service role) — 포캐스트는 남의 것일 수 있다.

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

const F = load(path.join(ROOT, 'lib/forecastSync.ts'))

let fails = 0
const eq = (name, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want)
  if (!good) fails++
  console.log(`${good ? 'OK  ' : 'FAIL'} ${name}`)
  if (!good) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}
const ok = (name, cond, hint) => {
  if (!cond) fails++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond || !hint ? '' : `  — ${hint}`}`)
}
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')

const NOW = { stage: '상담', expected_amount: 0, closed_at: null }
const q = (o) => ({ quote_id: 1, status: '견적중', total_supply: 0, purchase_order_at: null, ...o })

console.log('── ① 단계 — 연결이 있으면 최소 견적제출 ──')
eq('연결 없음 — 바꿀 것 없다', F.forecastPatch(NOW, []), {})
eq('견적중 1건 → 견적제출', F.forecastPatch(NOW, [q({ total_supply: 100 })]),
  { stage: '견적제출', expected_amount: 100 })
eq('발주면 수주 + 수주일',
  F.forecastPatch(NOW, [q({ status: '발주(주문 대기)', total_supply: 500, purchase_order_at: '2026-11-26T01:02:03Z' })]),
  { stage: '수주', closed_at: '2026-11-26', expected_amount: 500 })
eq('매출완료도 수주다',
  F.forecastPatch(NOW, [q({ status: '매출완료', total_supply: 7, purchase_order_at: '2026-10-01T00:00:00Z' })]),
  { stage: '수주', closed_at: '2026-10-01', expected_amount: 7 })

console.log('\n── ② 내리지 않는다 ──')
eq('협상에 견적 하나 — 단계는 그대로',
  F.forecastPatch({ stage: '협상', expected_amount: 100, closed_at: null }, [q({ total_supply: 100 })]), {})
eq('수주인데 견적중뿐 — 그대로',
  F.forecastPatch({ stage: '수주', expected_amount: 100, closed_at: null }, [q({ total_supply: 100 })]), {})
eq('이미 종료일이 있으면 두 번 쓰지 않는다',
  F.forecastPatch({ stage: '수주', expected_amount: 500, closed_at: '2026-01-01' },
    [q({ status: '주문완료', total_supply: 500, purchase_order_at: '2026-11-26T00:00:00Z' })]), {})

console.log('\n── ③ 실패·취소 ──')
eq('실패뿐이면 아무것도 하지 않는다(자동 실주 없음)',
  F.forecastPatch(NOW, [q({ status: '실패', total_supply: 100 })]), {})
ok('전부 죽었는지 알려 주는 함수가 있다',
  F.allDead([q({ status: '실패' }), q({ status: '취소요청' })]) === true
  && F.allDead([q({ status: '실패' }), q({ status: '견적중' })]) === false
  && F.allDead([]) === false)
eq('죽은 건은 합계에서 뺀다',
  F.forecastPatch(NOW, [q({ quote_id: 1, status: '실패', total_supply: 900 }), q({ quote_id: 2, total_supply: 10 })]),
  { stage: '견적제출', expected_amount: 10 })

console.log('\n── ④ 금액 ──')
eq('두 건이면 합계', F.forecastPatch({ stage: '견적제출', expected_amount: 0, closed_at: null },
  [q({ quote_id: 1, total_supply: 100 }), q({ quote_id: 2, total_supply: 250 })]), { expected_amount: 350 })
eq('같은 값이면 쓰지 않는다', F.forecastPatch({ stage: '견적제출', expected_amount: 100, closed_at: null },
  [q({ total_supply: 100 })]), {})
eq('연결이 없으면 손 값을 그대로 둔다',
  F.forecastPatch({ stage: '상담', expected_amount: 9999, closed_at: null }, []), {})

console.log('\n── ⑤ 부르는 자리 ──')
const CHANGE = read('app/api/customer-change/route.ts')
const MUT = read('lib/quoteMutations.ts')
const PO = read('app/api/purchase-order/route.ts')
ok('라우트에 forecast-sync 가 있다', /action === 'forecast-sync'/.test(CHANGE))
ok('상태를 바꾸면 맞춘다', /action: 'forecast-sync', quoteId: params\.quoteId/.test(MUT))
ok('발주서 등록 뒤에도 맞춘다', /await syncForecastOf\(supabaseAdmin, Number\(quoteId\)\)/.test(PO))
ok('규칙은 한 곳이다', /forecastPatch\(/.test(CHANGE) && /forecastPatch\(/.test(read('lib/forecastSync.ts')))
ok('맞추기가 실패해도 본 일을 막지 않는다',
  /forecast sync failed/.test(MUT) && !/throw/.test(MUT.split('forecast sync failed')[1].slice(0, 120)))

console.log('\n── ⑥ 견적 화면의 칸 ──')
const CARD = read('components/quote/CustomerCard.tsx')
const HOOK = read('hooks/quote/useQuoteCustomer.ts')
ok('공용 콤보박스', /<SearchSelect<SalesOpportunity>/.test(CARD))
ok('「연결 안 함」이 맨 위', /key: 'none', where: 'top'/.test(CARD))
ok('「새 포캐스트 만들기」가 맨 아래', /＋ 새 포캐스트 만들기/.test(CARD))
ok('만들기 창은 제목·예상월만 받는다',
  /새 포캐스트/.test(CARD) && /type="month"/.test(CARD) && /예상 월/.test(CARD))
ok('기본은 가장 최근 진행 건', /const recent = list\.find\(o => !isClosed\(o\)\)/.test(HOOK))
ok('만들면 바로 연결한다', /setOpportunityId\(made\.opportunity_id\)/.test(HOOK))
ok('후보도 없고 업체도 없으면 칸을 내지 않는다',
  /selectableOpportunities\.length > 0 \|\| \(onCreate && customerPicked\)/.test(CARD))

console.log(String.fromCharCode(10) + '── ⑦ 목록에서 걸고 풀기(C2) ──')
const LINK = read('components/quote/ForecastLink.tsx')
const PANEL = read('components/dashboard/MyQuotesPanel.tsx')
ok('라우트에 걸고 푸는 길이 있다', /action === 'quote-forecast-link'/.test(CHANGE))
ok('다른 업체의 포캐스트에는 못 건다', /다른 업체의 포캐스트입니다/.test(CHANGE))
ok('바꾸면 옛 쪽·새 쪽을 모두 다시 셈한다', CHANGE.includes('for (const id of [before, next])'))
ok('사건으로 남는다', CHANGE.includes("'quote_forecast_linked'"))
ok('부품은 공용 콤보박스·공용 카드', /<SearchSelect<SalesOpportunity>/.test(LINK) && /<ModalCard/.test(LINK))
ok('진행 중인 것만 고른다', LINK.includes('!isClosed(o) || o.opportunity_id === opportunityId'))
ok('내 견적 목록에 그 단추가 있다', /<ForecastLink/.test(PANEL) && /opportunity_id/.test(PANEL))

console.log(fails === 0 ? String.fromCharCode(10) + '전부 통과' : String.fromCharCode(10) + fails + '건 실패')
