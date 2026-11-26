// 보안 머리글(CSP) — **넓어지는 것을 눈에 띄게** 한다 (2026-11-26).
//
//   node scripts/csp-check.js
//
// ── 왜 ──────────────────────────────────────────────────────────────────────
//   CSP 는 한 낱말만 더해도 막던 것이 열린다. 그런데 그 한 낱말은 긴 한 줄 안에 묻혀
//   리뷰에서 잘 보이지 않는다. 그래서 **지시어마다 무엇이 들어 있어야 하는지**를 여기에
//   적어 둔다 — 늘리거나 줄이려면 이 파일도 함께 고쳐야 하고, 그 diff 는 눈에 띈다.
//
//   값을 하나하나 다 적지는 않는다(카카오 호스트는 그쪽 사정으로 늘어난다).
//   **위험한 낱말**(unsafe-*, data:, blob:, 와일드카드 *)이 **어느 지시어에 있는가**만 못 박는다.

const load = module.require.bind(module)
const path = load('path')
const fs = load('fs')
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

const SRC = fs.readFileSync(path.join(ROOT, 'next.config.ts'), 'utf8')

// 지시어를 모은다 — 주석이 아니라 **따옴표 안의 문자열**만 본다.
const directives = new Map()
for (const m of SRC.matchAll(/"([a-z-]+(?:-src|-ancestors|-uri|-action)?) ([^"]+)"/g)) {
  const [, name, rest] = m
  if (!/-src$|-ancestors$|-action$/.test(name)) continue
  directives.set(name, rest.split(/\s+/).filter(Boolean))
}

console.log('── ① 지시어가 다 있다 ──')
for (const d of ['default-src', 'connect-src', 'script-src', 'style-src', 'font-src', 'img-src', 'frame-src', 'worker-src']) {
  ok(`${d}`, directives.has(d), '없으면 default-src 로 떨어진다')
}

console.log('\n── ② 위험한 낱말은 **정해진 자리에만** ──')
/** 그 낱말을 가질 수 있는 지시어. 여기에 없는 곳에서 나오면 실패다. */
const ALLOWED = {
  "'unsafe-inline'": ['script-src', 'style-src'],
  "'unsafe-eval'": ['script-src'],
  // data: — 글꼴(내장)·이미지(미리보기)·wasm(react-pdf 의 yoga-layout, 2026-11-26).
  'data:': ['font-src', 'img-src', 'connect-src'],
  // blob: — react-pdf 의 PDFViewer 가 blob URL iframe 으로 그리고, PDF 를 짜는 Web Worker 도
  //   blob 으로 뜬다. 셋 다 우리가 만든 blob 이다(밖에서 오지 않는다).
  'blob:': ['img-src', 'frame-src', 'worker-src'],
}
for (const [word, where] of Object.entries(ALLOWED)) {
  const found = [...directives.entries()].filter(([, v]) => v.includes(word)).map(([k]) => k).sort()
  eq(`${word} 는 ${where.join(' · ')} 에만`, found, [...where].sort())
}
// 온 세상을 여는 와일드카드는 없다.
for (const [name, vals] of directives) {
  ok(`${name} 에 맨 '*' 가 없다`, !vals.includes('*'))
  ok(`${name} 에 https: 통짜가 없다`, !vals.includes('https:'))
}

console.log('\n── ③ 왜 data: 를 넣었는지 적어 두었다 ──')
ok('연결(connect-src) 쪽 data: 의 까닭이 주석에 있다',
  /yoga-layout/.test(SRC) && /react-pdf/.test(SRC))
ok('되돌리는 법도 적어 두었다', /`data:` 한 낱말만 지운다/.test(SRC))

console.log('\n── ④ 나머지 보안 머리글 ──')
for (const [key, val] of [
  ['X-Content-Type-Options', 'nosniff'],
  ['X-Frame-Options', 'DENY'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
]) {
  ok(`${key}: ${val}`, new RegExp(`key: '${key}', value: '${val}'`).test(SRC))
}
ok('HSTS 가 있다', /Strict-Transport-Security/.test(SRC) && /max-age=63072000/.test(SRC))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
