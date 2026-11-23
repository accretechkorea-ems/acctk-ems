// **빌드가 되는가** (2026-11-23).
//
//   node scripts/build-check.js
//
// ── 왜 생겼나 ───────────────────────────────────────────────────────────
// 2026-11-23, /cards 를 올렸더니 Vercel 빌드가 멈췄다 —
//   「useSearchParams() should be wrapped in a suspense boundary」
// tsc·eslint·하네스는 **전부 통과했다.** 그 셋 중 아무도 next build 의 prerender 를
// 돌리지 않기 때문이다. 배포에서만 드러나는 자리가 남아 있었다.
//
// 그래서 둘을 지킨다.
//   ① 글자 검사 — useSearchParams 를 쓰는 **페이지**는 Suspense 경계나
//      force-dynamic 중 하나를 갖는다. 빌드보다 백 배 빠르니 늘 돈다.
//   ② 진짜 빌드 — `npm run build` 를 돌려 본다. 느려서(1~2분) **기본은 끈다**.
//      켜려면 BUILD_CHECK=1 을 주거나 `node scripts/build-check.js --build`.
//      CI·배포 전에는 그 길로 돌린다.
//
// ※ 이 파일은 열쇠 없이 돈다(하네스 규칙) — ①은 글자만 읽고, ②는 빌드를 부를 뿐이다.

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
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

// ── ① 글자 검사 ────────────────────────────────────────────────────────
console.log('\n── ① useSearchParams 를 쓰는 페이지는 Suspense 를 갖는다 ──')

const SKIP_DIR = new Set(['node_modules', '.next', '.next-perf', '.git'])
const files = []
const walk = (d) => {
  for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
    const rel = `${d}/${e.name}`
    if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) walk(rel); continue }
    if (/\.(ts|tsx)$/.test(e.name)) files.push(rel)
  }
}
for (const d of ['app', 'components', 'hooks']) walk(d)

/** 라우트가 되는 파일인가 — page·layout 만 prerender 된다. */
const isRoute = (f) => /\/(page|layout)\.tsx$/.test(f)

const users = []
const naked = []
for (const f of files) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8')
  if (!/useSearchParams\s*\(/.test(src)) continue
  users.push(f)
  if (!isRoute(f)) continue
  const guarded = /<Suspense[\s>]/.test(src) || /export const dynamic = ['"]force-dynamic['"]/.test(src)
  if (!guarded) naked.push(f)
}
console.log(`     useSearchParams 를 쓰는 파일 ${users.length}개 · 그중 라우트 ${users.filter(isRoute).length}개`)
eq('Suspense 도 force-dynamic 도 없는 라우트', naked, [])

// 페이지가 아닌 곳(components·hooks)에서 쓰면 **부르는 라우트**가 감싸야 한다.
// 그 사슬을 글자로 따라가기는 어려워, 지금 그런 자리가 없다는 것만 지킨다.
eq('라우트 밖에서 쓰는 자리', users.filter(f => !isRoute(f)), [])

console.log('\n── ② 빌드 ──')
const wantBuild = process.env.BUILD_CHECK === '1' || process.argv.includes('--build')
if (!wantBuild) {
  console.log('     건너뜀 — 느리다(1~2분). 돌리려면 BUILD_CHECK=1 또는 --build.')
  console.log('     배포 전에는 반드시 한 번 돌린다: node scripts/build-check.js --build')
} else {
  const started = Date.now()
  try {
    execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'pipe', shell: true, maxBuffer: 64 * 1024 * 1024 })
    ok(`npm run build 통과 (${Math.round((Date.now() - started) / 1000)}초)`, true)
  } catch (e) {
    const out = `${e.stdout ?? ''}${e.stderr ?? ''}`
    ok('npm run build 통과', false)
    console.log(out.split(/\r?\n/).slice(-40).join('\n'))
  }
}

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
