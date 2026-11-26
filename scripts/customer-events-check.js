// 고객 이력(customer_events) — **무엇이 사건이고 무엇이 아닌가** (2026-11-27 야간3 2).
//
//   node scripts/customer-events-check.js
//
// 이 표가 흔들리면 이력은 금세 못 쓰게 된다. 쌓이는 쪽으로만 흔들리기 때문이다 —
// 「이것도 남기자」가 몇 번 쌓이면, 정작 일(홀딩·포캐스트·수리·의뢰서)이 고친 자국 사이에
// 묻힌다. 그래서 **적는 것**과 **적지 않는 것**을 둘 다 못 박는다.

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

let fails = 0
const ok = (name, cond, hint) => {
  if (!cond) fails++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond || !hint ? '' : `  — ${hint}`}`)
}
const eq = (name, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want)
  if (!good) fails++
  console.log(`${good ? 'OK  ' : 'FAIL'} ${name}`)
  if (!good) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')

const E = load(path.join(ROOT, 'lib/customerEvents.ts'))
const V = load(path.join(ROOT, 'lib/customerEventView.ts'))
const CHANGE = read('app/api/customer-change/route.ts')

console.log('── ① 밖에서 벌어진 일 일곱 ──')
eq('묶음 그대로', [...E.WORK_EVENT_TYPES], [
  'holding_started', 'holding_resolved',
  'forecast_created', 'forecast_closed',
  'repair_received', 'repair_shipped',
  'inquiry_created',
])
for (const t of E.WORK_EVENT_TYPES) {
  ok(`${t} — 「일」로 센다`, E.isWorkEvent(t))
  ok(`${t} — 「고친 일」이 아니다(기본으로 켜져 보인다)`, !E.isChangeEvent(t))
  ok(`${t} — 「리드」도 아니다`, !E.isLeadEvent(t))
}

console.log('\n── ② 타임라인이 그 일곱을 읽는다 ──')
for (const [t, want] of [
  ['holding_started', '홀딩 시작'],
  ['holding_resolved', '홀딩 해제'],
  ['forecast_created', '포캐스트 생성'],
  ['repair_received', '수리 입고'],
  ['repair_shipped', '수리 출고'],
  ['inquiry_created', '의뢰서 작성'],
]) eq(`${t} 의 이름표`, V.eventLine({ event_type: t, payload: {} }).label, want)
eq('포캐스트 종료는 결과를 이름표에 넣는다',
  V.eventLine({ event_type: 'forecast_closed', payload: { result: '실주' } }).label, '포캐스트 실주')
eq('결과를 모르면 「종료」', V.eventLine({ event_type: 'forecast_closed', payload: {} }).label, '포캐스트 종료')

console.log('\n── ③ 적는 자리 ──')
ok('라우트는 **허용 목록**만 받는다',
  /action === 'log-event'/.test(CHANGE) && /WORK_EVENT_TYPES as readonly string\[\]\)\.includes\(type\)/.test(CHANGE))
ok('화면용 한 줄 도우미가 있다', fs.existsSync(path.join(ROOT, 'lib/customerEventLog.ts')))
ok('그 도우미는 **던지지 않는다**(본 일을 막지 않는다)',
  /못 적으면 콘솔에만 남기고/.test(read('lib/customerEventLog.ts')))
ok('고객사가 없으면 조용히 건너뛴다', /if \(!Number\.isInteger\(customerId\) \|\| customerId <= 0\) return false/.test(read('lib/customerEventLog.ts')))
for (const [what, file, pat] of [
  ['홀딩 시작', 'hooks/customer/useHoldingCrud.ts', /type: 'holding_started'/],
  ['홀딩 해제', 'hooks/customer/useHoldingCrud.ts', /type: 'holding_resolved'/],
  ['포캐스트 생성', 'hooks/customer/useOpportunityCrud.ts', /type: 'forecast_created'/],
  ['포캐스트 종료·실주', 'hooks/customer/useOpportunityCrud.ts', /type: 'forecast_closed'/],
  ['수리 입고', 'app/repair/page.tsx', /type: 'repair_received'/],
  ['수리 출고', 'app/repair/page.tsx', /type: 'repair_shipped'/],
  ['의뢰서 작성', 'app/api/inquiry/route.ts', /event_type: 'inquiry_created'/],
]) ok(`${what} 를 적는다`, pat.test(read(file)))
// 리드 — 배정하면 **두 줄**이 함께 선다(원래 등록 + 배정).
ok('리드 배정은 등록 줄과 배정 줄을 함께 적는다',
  /lead_registered/.test(read('lib/customerEvents.ts')) && /alreadyRegistered/.test(read('lib/customerEvents.ts')))
ok('등록 줄의 날짜는 **리드가 들어온 날**이다', /occurred_at: lead\.created_at/.test(read('lib/customerEvents.ts')))

console.log('\n── ④ 적지 않는 것 ──')
ok('포캐스트 **단계 고침**은 적지 않는다',
  !/forecast_stage|forecast_updated/.test(read('hooks/customer/useOpportunityCrud.ts'))
  && /새로 만든 때만/.test(read('hooks/customer/useOpportunityCrud.ts')))
ok('사업장 **정보 수정**은 적지 않는다', !/'site_edited'/.test(CHANGE))
ok('담당자 **수정**은 적지 않는다(추가는 남긴다)',
  !/mode: 'edit', contact_id: id/.test(CHANGE) && /mode: 'add', contact_id: made\.contact_id/.test(CHANGE))
ok('장비 **정보 수정**도 적지 않는다(등록·폐기·운용 전환은 남긴다)',
  !/mode: 'edit', device_id: id/.test(CHANGE)
  && /mode: 'add', device_id: made\.device_id/.test(CHANGE)
  && /mode: 'commission'/.test(CHANGE))
// 종류 자체는 지우지 않는다 — **옛 줄**이 그 종류로 쌓여 있어 지우면 이력에서 사라진다.
ok('옛 종류는 타입에 그대로 남겨 두었다',
  /'site_edited'/.test(read('lib/customerEvents.ts')) && /'contact_edited'/.test(read('lib/customerEvents.ts')))
ok('그 까닭을 적어 두었다', /옛 줄이 그 종류로 쌓여 있다|옛 줄\*\* 이 그 종류로/.test(CHANGE))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
