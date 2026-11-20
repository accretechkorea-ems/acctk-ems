/**
 * 서비스 기록 **정렬** — lib/serviceSort.ts.
 *
 * 지키는 약속
 *   ① 방문일 내림차순이 먼저다 — id 가 커도 날짜가 이르면 아래로 간다.
 *     (운영에서 11-19 → 11-06 → 11-18 로 나오던 바로 그 자리다. id 로만 정렬했었다)
 *   ② 같은 날이면 id 내림차순 — 나중에 적은 것이 위다.
 *     ⚠ `service_history` 에는 `created_at` 칸이 **없다**(2026-11-20 확인).
 *   ③ 날짜 없는 줄은 맨 아래로 모인다.
 *   ④ 받은 배열을 바꾸지 않는다.
 *   ⑤ 회사 활동 이력도 같은 규칙으로 늘어선다(같은 날은 나중에 적은 것이 위).
 */
const load = module.require.bind(module)
const path = load('path')
const fs = load('fs')
const Module = load('module')
const ts = load('typescript')
const ROOT = path.resolve(__dirname, '..')

const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith('@/')) request = path.join(ROOT, request.slice(2))
  return origResolve.call(this, request, ...rest)
}
require.extensions['.ts'] = (mod, filename) => {
  const out = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  }).outputText
  mod._compile(out, filename)
}

const { sortServiceHistory, compareServiceHistory } = load(path.join(ROOT, 'lib', 'serviceSort.ts'))

let fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) console.log(`OK   ${name}  got=${JSON.stringify(got)}`)
  else { fail++; console.error(`FAIL ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`) }
}

// 운영에서 나오던 그 모양 — id 로만 정렬하면 11-19 → 11-06 → 11-18 이 된다.
const 운영꼴 = [
  { service_id: 903, visit_date: '2026-11-19' },
  { service_id: 902, visit_date: '2026-11-06' },
  { service_id: 901, visit_date: '2026-11-18' },
]
console.log('── 날짜가 먼저다 ──')
eq('11-19 → 11-18 → 11-06', sortServiceHistory(운영꼴).map(r => r.visit_date),
  ['2026-11-19', '2026-11-18', '2026-11-06'])

console.log('\n── 같은 날이면 나중에 적은 것이 위 ──')
eq('id 큰 것이 먼저', sortServiceHistory([
  { service_id: 10, visit_date: '2026-05-01' },
  { service_id: 30, visit_date: '2026-05-01' },
  { service_id: 20, visit_date: '2026-05-01' },
]).map(r => r.service_id), [30, 20, 10])

console.log('\n── 날짜 없는 줄 ──')
eq('맨 아래로', sortServiceHistory([
  { service_id: 1, visit_date: null },
  { service_id: 2, visit_date: '2020-01-01' },
  { service_id: 3, visit_date: null },
  { service_id: 4, visit_date: '2026-01-01' },
]).map(r => r.service_id), [4, 2, 3, 1])
eq('전부 날짜가 없으면 id 순', sortServiceHistory([
  { service_id: 1, visit_date: null },
  { service_id: 9, visit_date: null },
]).map(r => r.service_id), [9, 1])

console.log('\n── 받은 배열은 그대로 ──')
const 원본 = [{ service_id: 1, visit_date: '2020-01-01' }, { service_id: 2, visit_date: '2026-01-01' }]
sortServiceHistory(원본)
eq('원본 순서 그대로', 원본.map(r => r.service_id), [1, 2])
eq('비교 함수 단독', Math.sign(compareServiceHistory(
  { service_id: 1, visit_date: '2026-01-02' }, { service_id: 9, visit_date: '2026-01-01' })), -1)

console.log('\n── 쓰는 자리 ──')
// 정렬이 한 곳에서만 정해지는지 — 기록을 늘어놓는 파일이 이 함수를 부르는가.
for (const rel of ['hooks/customer/useCustomerDetail.ts']) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
  const ok = /sortServiceHistory|compareServiceHistory/.test(src)
  if (ok) console.log(`OK   ${rel} 가 공용 정렬을 쓴다`)
  else { fail++; console.error(`FAIL ${rel} 이 제 나름대로 정렬한다`) }
}
// 회사 활동 이력은 종류를 섞어 늘어놓으므로 제 비교자를 쓴다 — 같은 규칙인지 글로 확인한다.
{
  const src = fs.readFileSync(path.join(ROOT, 'components/customer/ActivityTimeline.tsx'), 'utf8')
  const ok = /lib\/serviceSort/.test(src)
  if (ok) console.log('OK   활동 이력이 같은 규칙을 가리킨다')
  else { fail++; console.error('FAIL 활동 이력에 정렬 규칙의 출처가 적혀 있지 않다') }
}

if (fail > 0) { console.error(`\n실패 ${fail}건`); process.exit(1) }
console.log('\n모두 통과')
