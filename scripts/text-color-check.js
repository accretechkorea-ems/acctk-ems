// 글자색 — **읽어야 하는 글자는 읽힌다** (2026-11-23).
//
//   node scripts/text-color-check.js
//
// 지키는 약속
//   ① 역할마다 값이 하나다(lib/textTokens.ts). 읽어야 하는 글자는 흰 바탕 대비 4.5:1 이상.
//   ② `#9ca3af` 보다 연한 글자는 **비활성(disabled)** 자리에만 둔다.
//   ③ placeholder·option·optgroup 은 CSS 가 아니면 닿지 않는다 — globals.css 가 칠한다.
//   ④ 공용 토큰(MUTED·SUB·FAINT)은 역할 토큰을 가리킨다 — 값을 따로 적지 않는다.

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

const T = load(path.join(ROOT, 'lib/textTokens.ts'))
const U = load(path.join(ROOT, 'components/common/ui.ts'))

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

// ── 대비 재기 (WCAG 2.x) ───────────────────────────────────────────────────
const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
/** 흰 바탕과의 대비. 소수 둘째 자리까지. */
const onWhite = (hex) => Math.round(((1.05) / (lum(hex) + 0.05)) * 100) / 100

console.log('\n── ① 역할과 대비 ──')
const READABLE = [
  ['입력값·항목 본문', T.TEXT_VALUE],
  ['라벨', T.TEXT_LABEL],
  ['표 머리줄', T.TEXT_TABLE_HEAD],
  ['묶음 머리', T.TEXT_OPTGROUP],
  ['안내문·보조', T.TEXT_NOTE],
  ['placeholder', T.TEXT_PLACEHOLDER],
]
for (const [name, hex] of READABLE) {
  const c = onWhite(hex)
  ok(`${name} ${hex} — 대비 ${c}:1 ≥ ${T.MIN_CONTRAST}`, c >= T.MIN_CONTRAST, '흰 바탕에서 읽히지 않는다')
}
ok(`비활성 ${T.TEXT_DISABLED} 은 기준 미달(${onWhite(T.TEXT_DISABLED)}:1) — 그래서 비활성 전용이다`,
  onWhite(T.TEXT_DISABLED) < T.MIN_CONTRAST)
eq('라벨 굵기', T.LABEL_WEIGHT, 600)
eq('라벨 묶음도 같은 값을 쓴다', [T.LABEL.color, T.LABEL.fontWeight], [T.TEXT_LABEL, T.LABEL_WEIGHT])
eq('보조 묶음도 같은 값을 쓴다', T.SUB.color, T.TEXT_NOTE)

console.log('\n── ② 공용 토큰은 역할을 가리킨다 ──')
eq('MUTED = placeholder 급', U.MUTED, T.TEXT_PLACEHOLDER)
eq('SUB = 안내문·보조', U.SUB, T.TEXT_NOTE)
eq('FAINT = 비활성 급', U.FAINT, T.TEXT_DISABLED)
const UI = fs.readFileSync(path.join(ROOT, 'components/common/ui.ts'), 'utf8')
ok('값을 따로 적지 않는다', /export const MUTED = TEXT_PLACEHOLDER/.test(UI) && /export const SUB = TEXT_NOTE/.test(UI))

console.log('\n── ③ 연한 글자는 비활성 자리에만 ──')
// 흰 바탕 대비가 기준에 못 미치는 값들. 글자 자리(color:)에서만 본다.
const TOO_LIGHT = ['#9ca3af', '#a1a1aa', '#94a3b8', '#d1d5db', '#e5e7eb']
/**
 * 그 조각이 「쓸 수 없는 상태」를 말하는가.
 * 조건 이름이 제각각이라 말로 적는다 — 새 이름이 생기면 여기에 더한다.
 *   · disabled·busy·loading   — 버튼·칸이 잠긴 동안
 *   · Error·notAllowed·Off    — 누를 수 없는 상태
 *   · FAINT·TEXT_DISABLED     — 토큰으로 쓴 자리(값이 아니라 이름을 썼다)
 *   · length === 0 · ATTACH_MAX · i === 0 · photos.length - 1
 *                             — 「더 없다·더 담을 수 없다·끝이라 더 못 간다」
 */
const DISABLED_WORDS = new RegExp([
  'disabled', 'busy', 'Busy', 'loading', 'Error', 'notAllowed', 'Off\\b', 'noStops',
  'FAINT', 'TEXT_DISABLED', 'SKELETON',
  'length === 0', 'ATTACH_MAX', 'i === 0', 'photos\\.length - 1',
].join('|'))
const SKIP_DIR = new Set(['node_modules', '.next', '.next-perf', '.git'])
const files = []
const walk = (d) => {
  for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
    const rel = `${d}/${e.name}`
    if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) walk(rel); continue }
    if (/\.(ts|tsx)$/.test(e.name)) files.push(rel)
  }
}
for (const d of ['app', 'components', 'lib', 'hooks']) walk(d)

// `color:` 만 — `background-color`·`border-color`·`scrollbar-color` 는 글자가 아니다.
const SEG = /(?<![-\w])color:\s*[^,}\n]*/g
const offenders = []
for (const f of files) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8')
  if (/@react-pdf\/renderer/.test(src)) continue      // 인쇄용 색은 화면 규칙이 아니다
  for (const m of src.matchAll(SEG)) {
    const seg = m[0]
    if (!TOO_LIGHT.some(h => seg.toLowerCase().includes(h))) continue
    if (DISABLED_WORDS.test(seg)) continue            // 비활성 자리 — 규칙대로다
    offenders.push(`${f} :: ${seg.trim().slice(0, 90)}`)
  }
}
eq('남은 자리', offenders, [])

console.log('\n── ③-ⓑ 라벨 뭉치는 토큰을 쓴다 ──')
// 화면마다 `const labelStyle = { … color: MUTED }` 를 따로 적어 두어, 전역 규칙이 닿지 않았다.
const LABEL_DECL = /\bconst\s+(?:label|labelStyle|labelCell|label12|lbl)[A-Za-z0-9_]*\s*(?::[^=\n]*)?=\s*\{([^}\n]*)\}/g
const handLabels = []
for (const f of files) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8')
  if (/@react-pdf\/renderer/.test(src)) continue
  for (const m of src.matchAll(LABEL_DECL)) {
    const body = m[1]
    if (!/color:/.test(body)) continue
    if (/color:\s*TEXT_LABEL/.test(body)) continue
    handLabels.push(`${f} :: ${m[0].trim().slice(0, 80)}`)
  }
}
eq('손으로 적은 라벨 색', handLabels, [])

console.log('\n── ④ CSS 가 아니면 닿지 않는 자리 ──')
const CSS = fs.readFileSync(path.join(ROOT, 'app/globals.css'), 'utf8')
ok('placeholder 를 칠한다', /input::placeholder,[\s\S]{0,80}color: var\(--color-text-muted\)/.test(CSS))
ok('파이어폭스의 기본 흐림을 끈다', /::placeholder \{[\s\S]{0,120}opacity: 1/.test(CSS))
ok('비활성 칸의 placeholder 는 더 연하다', /:disabled::placeholder,[\s\S]{0,120}--color-text-disabled/.test(CSS))
ok('option 본문은 진한 글자', /select option \{[\s\S]{0,60}var\(--color-ink\)/.test(CSS) || /select,\s*\n\s*select option \{[\s\S]{0,60}var\(--color-ink\)/.test(CSS))
ok('optgroup 머리는 라벨 급 600', /select optgroup \{[\s\S]{0,120}--color-text-label[\s\S]{0,60}font-weight: 600/.test(CSS))
ok('「골라 주세요」는 placeholder 급', /select option\[value=""\] \{[\s\S]{0,80}--color-text-muted/.test(CSS))

console.log('\n── ⑤ 토큰 값이 표와 같다 ──')
const RULES = fs.readFileSync(path.join(ROOT, '.claude/rules/design-system.md'), 'utf8')
const table = {}
for (const line of RULES.split(/\r?\n/)) {
  const m = line.match(/^\|\s*([^|]+?)\s*\|\s*`(#[0-9a-fA-F]{3,6})`\s*\|/)
  if (m) table[m[1].trim()] = m[2].toLowerCase()
}
eq('표의 라벨', table['텍스트 - 라벨'], T.TEXT_LABEL)
eq('표의 보조', table['텍스트 - 보조'], T.TEXT_NOTE)
eq('표의 흐림', table['텍스트 - 흐림'], T.TEXT_PLACEHOLDER)
eq('표의 가장 흐림', table['텍스트 - 가장 흐림'], T.TEXT_DISABLED)

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
