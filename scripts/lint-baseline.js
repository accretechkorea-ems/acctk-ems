// eslint 를 돌려 경고 수를 기준선과 견준다 — `npm run lint:ci` 가 부른다.
//
//   node scripts/lint-baseline.js
//
// 왜 `npm run lint` 로 끝내지 않는가 — 이 저장소의 경고는 141건이고, 그것을 0 으로 만드는
// 일과 **더 늘지 않게 막는 일**은 다르다. eslint 는 경고만으로는 실패하지 않으므로
// (`--max-warnings` 를 쓰면 수를 명령에 적게 되고, 그러면 기준선이 두 곳에 생긴다)
// 기준선을 파일 한 곳(lint-baseline.json)에 두고 여기서 비교한다.
//
// 기준선을 **내릴** 때는 lint-baseline.json 의 maxWarnings 를 같이 내린다. 올리는 일은
// 없어야 한다 — 올리고 싶으면 그 경고를 먼저 보라.

// eslint 의 no-require-imports 는 맨 require() 를 센다. 이 파일은 node 로 직접 돌리는
// CJS 스크립트라 모듈을 그렇게 불러올 수밖에 없다 — 하네스(scripts/*-check.js)와 같이
// 한 번만 묶어 두고 그것만 쓴다.
const load = module.require.bind(module)
const { spawnSync } = load('child_process')
const { readFileSync } = load('fs')
const { join } = load('path')

const ROOT = join(__dirname, '..')
const baseline = JSON.parse(readFileSync(join(ROOT, 'lint-baseline.json'), 'utf8'))
const maxWarnings = Number(baseline.maxWarnings)
const maxErrors = Number(baseline.maxErrors ?? 0)
if (!Number.isFinite(maxWarnings) || !Number.isFinite(maxErrors)) {
  console.error('lint-baseline.json 의 maxWarnings·maxErrors 가 숫자가 아니다')
  process.exit(1)
}

// npm run lint 와 **같은 eslint** 를 돈다(node_modules 의 그 파일을 그대로 부른다).
// npx 를 거치지 않는 이유 — 윈도에서는 shell 을 켜야 하고, shell 과 인자를 함께 넘기는 것은
// node 가 경고하는 방식이다. 세기 위해 형식만 json 으로 바꾼다.
const ESLINT_BIN = join(ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js')
const r = spawnSync(process.execPath, [ESLINT_BIN, '--format', 'json'], {
  cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
})

if (!r.stdout || !r.stdout.trim().startsWith('[')) {
  console.error('eslint 를 돌리지 못했다.')
  if (r.stdout) console.error(r.stdout.slice(0, 2000))
  if (r.stderr) console.error(r.stderr.slice(0, 2000))
  process.exit(1)
}

let report
try {
  report = JSON.parse(r.stdout)
} catch (e) {
  console.error('eslint 결과를 읽지 못했다:', String(e).slice(0, 200))
  process.exit(1)
}

const errors = report.reduce((s, f) => s + f.errorCount, 0)
const warnings = report.reduce((s, f) => s + f.warningCount, 0)

// 규칙별로 묶어 보여 준다 — 늘었을 때 어느 규칙이 늘었는지 바로 보이게.
const byRule = new Map()
for (const f of report) {
  for (const m of f.messages) {
    const key = m.ruleId ?? '(규칙 없음)'
    byRule.set(key, (byRule.get(key) ?? 0) + 1)
  }
}

console.log(`eslint — 오류 ${errors} · 경고 ${warnings} (기준선 ${maxWarnings})`)
for (const [rule, n] of [...byRule].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${rule}`)
}

if (errors > maxErrors) {
  console.error(`\n오류가 ${errors}건이다(허용 ${maxErrors}). 고쳐야 한다.`)
  // 오류는 어디인지 바로 보여 준다.
  for (const f of report) {
    for (const m of f.messages) {
      if (m.severity === 2) console.error(`  ${f.filePath}:${m.line}:${m.column}  ${m.ruleId ?? ''}  ${m.message}`)
    }
  }
  process.exit(1)
}

if (warnings > maxWarnings) {
  console.error(`\n경고가 기준선을 ${warnings - maxWarnings}건 넘었다(${warnings} > ${maxWarnings}).`)
  console.error('새로 생긴 경고를 고치거나, 줄인 뒤라면 lint-baseline.json 의 maxWarnings 를 같이 내려라.')
  process.exit(1)
}

if (warnings < maxWarnings) {
  console.log(`\n경고가 기준선보다 ${maxWarnings - warnings}건 적다. lint-baseline.json 의 maxWarnings 를 ${warnings} 로 내려 두면 되돌아가는 것을 막는다.`)
}
