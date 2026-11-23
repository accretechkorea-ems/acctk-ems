/**
 * lib/customerEvents.ts — 리드 배정에서 **어떤 사건이 몇 줄 생기는가**.
 *
 * 재는 것:
 *   ① 처음 배정   → lead_registered(등록된 날) + lead_assigned(지금)  … 두 줄
 *   ② 담당 변경   → lead_reassigned 한 줄(전·후가 payload 에 들어간다)
 *   ③ 같은 리드 재배정에서 lead_registered 를 **다시 만들지 않는다**
 *   ④ 회수(담당 없음)도 변경으로 본다 / 같은 사람으로 다시 배정하면 사건 없음
 *   ⑤ 메모 줄이기(briefNote)
 */
const path = require('path')
const Module = require('module')
const ts = require('typescript')
const load = module.require.bind(module)
const ROOT = path.resolve(__dirname, '..')

const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith('@/')) request = path.join(ROOT, request.slice(2))
  return origResolve.call(this, request, ...rest)
}
require.extensions['.ts'] = (mod, filename) => {
  const src = require('fs').readFileSync(filename, 'utf8')
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  }).outputText
  mod._compile(out, filename)
}

const { leadAssignmentEvents, briefNote } = load(path.join(ROOT, 'lib/customerEvents.ts'))

let fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) { fail++; console.error(`  ✗ ${name}\n      얻음: ${JSON.stringify(got)}\n      기대: ${JSON.stringify(want)}`) }
  else console.log(`  ✓ ${name}`)
}

const LEAD = {
  lead_id: 77,
  lead_no: 'L-2026-077',
  industry: '2.자동차',
  created_at: '2026-10-02T01:23:45.000Z',
  meeting_note: '  첫 미팅에서 설비 교체를 검토 중이라고 했다.  ',
  request_note: null,
  assigned_to: null,
}
const NOW = '2026-11-20T05:00:00.000Z'
const run = (over = {}) => leadAssignmentEvents({
  lead: { ...LEAD, ...(over.lead ?? {}) },
  customerId: 500,
  assignedTo: 7,
  assigneeName: '김영기',
  previousName: null,
  actorId: 226,
  alreadyRegistered: false,
  now: NOW,
  ...over,
})

console.log('[customer-events] ① 처음 배정')
{
  const rows = run()
  eq('두 줄이 생긴다', rows.map(r => r.event_type), ['lead_registered', 'lead_assigned'])
  eq('최초 등록은 리드가 들어온 날', rows[0].occurred_at, LEAD.created_at)
  eq('최초 등록에는 실행자를 적지 않는다', rows[0].actor_engineer_id, null)
  // 2026-11-23: 요약 줄(관심 제품 · 파트너사)을 쓰려고 두 칸을 payload 에 더했다.
  // 본보기 리드에는 그 값이 없어 null 로 들어간다 — 옛 줄도 같은 모양이라 화면은 업종으로 떨어진다.
  eq('최초 등록 payload', rows[0].payload, {
    lead_id: 77, lead_no: 'L-2026-077', industry: '2.자동차',
    interest_product: null, partner_company: null,
    note: '첫 미팅에서 설비 교체를 검토 중이라고 했다.',
  })
  eq('배정은 지금 시각', rows[1].occurred_at, NOW)
  eq('배정 payload', rows[1].payload, { lead_id: 77, lead_no: 'L-2026-077', to_engineer_id: 7, to_name: '김영기' })
  eq('배정 실행자', rows[1].actor_engineer_id, 226)
  eq('사건은 고객사 줄에 달린다', rows[1].customer_id, 500)
}

console.log('[customer-events] ② 담당 변경')
{
  const rows = run({
    lead: { ...LEAD, assigned_to: 7 },
    assignedTo: 9, assigneeName: '조성연', previousName: '김영기',
    alreadyRegistered: true,
  })
  eq('한 줄만 생긴다', rows.map(r => r.event_type), ['lead_reassigned'])
  eq('전·후가 함께 들어간다', rows[0].payload, {
    lead_id: 77, lead_no: 'L-2026-077',
    to_engineer_id: 9, to_name: '조성연', from_engineer_id: 7, from_name: '김영기',
  })
}

console.log('[customer-events] ③ 최초 등록은 한 번만')
{
  const rows = run({ alreadyRegistered: true })
  eq('이미 적혀 있으면 다시 만들지 않는다', rows.map(r => r.event_type), ['lead_assigned'])
  const again = run({ lead: { ...LEAD, assigned_to: 7 }, assignedTo: 7, alreadyRegistered: true })
  eq('같은 사람으로 다시 배정하면 사건이 없다', again, [])
}

console.log('[customer-events] ④ 회수')
{
  const rows = run({
    lead: { ...LEAD, assigned_to: 7 },
    assignedTo: null, assigneeName: null, previousName: '김영기',
    alreadyRegistered: true,
  })
  eq('회수도 변경 한 줄', rows.map(r => r.event_type), ['lead_reassigned'])
  eq('받는 사람 칸이 빈다', [rows[0].payload.to_engineer_id, rows[0].payload.from_name], [null, '김영기'])
}

console.log('[customer-events] ⑤ 메모 줄이기')
eq('공백을 하나로 줄이고 앞뒤를 턴다', briefNote('  두 줄\n  짜리 메모  '), '두 줄 짜리 메모')
eq('길면 말줄임', briefNote('가'.repeat(130), 120), '가'.repeat(120) + '…')
eq('비면 null', briefNote('   '), null)

if (fail > 0) { console.error(`\n[customer-events] 실패 ${fail}건`); process.exit(1) }
console.log('\n[customer-events] 전부 통과')
