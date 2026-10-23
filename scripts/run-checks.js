// 하네스 전부 돌리기 — `npm test` 가 부르는 러너.
//
//   node scripts/run-checks.js            전부
//   node scripts/run-checks.js quote      이름에 'quote' 가 든 것만
//
// 목록을 손으로 적지 않는다 — `scripts/*-check.js` 를 찾아서 **이름순**으로 돌린다.
// 하네스를 새로 더하면 파일만 두면 되고, 여기를 고칠 일은 없다.
//
// 왜 이름이 `-check.js` 로 끝나는 것만인가 — scripts/ 에는 한 번 쓰는 도구
// (reset-passwords·gen-service-report-template)와 **키가 필요한 측정 도구**(perf/*)도 있다.
// 그것들은 CI 에서 돌려서는 안 된다(운영 DB·Auth 에 붙는다). 하네스는 순수 함수만
// 시험하므로 Supabase 키 없이 어디서나 돈다 — 그 선을 파일 이름으로 지킨다.
//
// 그러므로 **이름이 곧 약속이다.** 하네스가 아닌 도구에는 `-check.js` 를 붙이지 마라
// (경고 기준선 검사를 lint-baseline.js 라 부르는 이유다 — 처음에 lint-check.js 로 두었더니
//  여기에 끌려 들어와 npm test 가 eslint 를 30초 더 돌렸다).
//
// 하나라도 실패하면 **끝까지 돌린 뒤** 종료 코드 1 로 끝낸다(한 번에 다 보이게).

// eslint 의 no-require-imports 는 맨 require() 를 센다. 이 파일은 node 로 직접 돌리는
// CJS 스크립트라 모듈을 그렇게 불러올 수밖에 없다 — 하네스(scripts/*-check.js)와 같이
// 한 번만 묶어 두고 그것만 쓴다.
const load = module.require.bind(module)
const { spawnSync } = load('child_process')
const { readdirSync } = load('fs')
const { join } = load('path')

const DIR = join(__dirname)
const filter = (process.argv[2] ?? '').toLowerCase()

const files = readdirSync(DIR)
  .filter(f => f.endsWith('-check.js'))
  .filter(f => !filter || f.toLowerCase().includes(filter))
  .sort()

if (files.length === 0) {
  console.error(filter ? `scripts/*-check.js 중 '${filter}' 에 맞는 것이 없다` : 'scripts/*-check.js 가 하나도 없다')
  process.exit(1)
}

const pad = (s, n) => String(s).padEnd(n)
const results = []
const t0 = Date.now()

for (const f of files) {
  const started = Date.now()
  // stdio 를 물려 준다 — 하네스가 찍는 OK/FAIL 줄이 그대로 보여야 어디가 틀렸는지 안다.
  const r = spawnSync(process.execPath, [join(DIR, f)], { stdio: 'inherit' })
  results.push({ f, ok: r.status === 0, ms: Date.now() - started, status: r.status })
  console.log('')
}

console.log('─'.repeat(52))
for (const r of results) {
  console.log(`${r.ok ? '통과' : '실패'}  ${pad(r.f, 32)} ${String(r.ms).padStart(5)}ms${r.ok ? '' : `  (종료 코드 ${r.status})`}`)
}
const bad = results.filter(r => !r.ok)
console.log('─'.repeat(52))
console.log(`하네스 ${results.length}개 · 통과 ${results.length - bad.length} · 실패 ${bad.length} · ${Date.now() - t0}ms`)
if (bad.length) {
  console.error(`\n실패: ${bad.map(r => r.f).join(', ')}`)
  process.exit(1)
}
