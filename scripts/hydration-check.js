// **수화(hydration) 오류**가 다시 생기지 않게 막는다 (2026-11-26).
//
//   node scripts/hydration-check.js
//
// ── 무엇을 보았나 ───────────────────────────────────────────────────────────
//   2026-11-26 실측에서 **모든 화면에 React #418 한 건**이 떴다
//   (「Hydration failed because the server rendered text didn't match the client」).
//   dev 서버의 원문이 범인을 그대로 가리켰다 — HeaderWrapper 의 style 태그 안이다.
//
//     + {"...이 <style> 은 **본문 안에서** 그려진다..."}      ← 브라우저가 넣은 글자
//     - {"...이 <\73 tyle> 은 **본문 안에서** 그려진다..."}   ← 서버가 적은 글자
//
//   style 태그의 내용에 여는 꺾쇠가 있으면 서버(react-dom/server)는 **CSS 이스케이프**로
//   피해 적는다(`\73` = 's'). 태그가 일찍 닫히는 것을 막으려는 처리다. 브라우저는 수화할
//   때 그 노드의 글자를 **그대로** 쓰므로 두 글자가 달라진다 → 트리가 버려지고 다시 그려진다.
//   한 글자가 앱 전체의 첫 그림을 두 번 그리게 만들었다.
//
// ── 두 번째 — 키 중복 ───────────────────────────────────────────────────────
//   같은 실측에서 활동 현황이 「Encountered two children with the same key, A/S」를
//   열두 번(카드 수만큼) 냈다. activity_types 에 'A/S' 를 더했는데 SERVICE_TYPES 에도
//   'A/S' 가 있어, 합친 순서 목록에 이름이 두 번 들어갔다. 집계는 이름을 열쇠로 쓰므로
//   한 줄이 맞다 — activityTypeOrder 가 겹치는 이름을 지운다.
//
// ── 지키는 약속 ─────────────────────────────────────────────────────────────
//   ① 코드 안의 style 태그 내용(템플릿 문자열)에 **여는 꺾쇠가 없다**.
//   ② 유형 순서 목록에 **같은 이름이 두 번 들어오지 않는다**.

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

// ── ① style 태그 안의 꺾쇠 ────────────────────────────────────────────────
//
// 훑는 자리: app · components. 템플릿 문자열로 쓴 style 태그 내용만 본다
// (여는 태그 뒤 `{` 백틱 … 백틱 `}` 닫는 태그). 꺾쇠는 **코드 글자**로 찾는다 —
// 이 하네스 자신의 글에 그 글자를 적으면 자기가 자기를 잡는다.
const LT = String.fromCharCode(60)            // 여는 꺾쇠
const OPEN = LT + 'style>{`'
const CLOSE = '`}' + LT + '/style>'

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); continue }
    if (/\.(ts|tsx)$/.test(e.name)) out.push(p)
  }
  return out
}

const files = [...walk(path.join(ROOT, 'app')), ...walk(path.join(ROOT, 'components'))]
const bad = []
let blocks = 0
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8')
  let from = 0
  for (;;) {
    const i = src.indexOf(OPEN, from)
    if (i < 0) break
    const j = src.indexOf(CLOSE, i)
    if (j < 0) break
    blocks++
    const body = src.slice(i + OPEN.length, j)
    if (body.includes(LT)) {
      const line = src.slice(0, i).split('\n').length
      bad.push(`${path.relative(ROOT, file).replace(/\\/g, '/')}:${line}`)
    }
    from = j + CLOSE.length
  }
}

console.log('── ① style 태그 안의 꺾쇠 ──')
ok(`style 블록을 찾았다 (${blocks}개)`, blocks > 0, '찾는 모양이 바뀌었다 — OPEN·CLOSE 를 고쳐라')
ok('어느 블록에도 여는 꺾쇠가 없다', bad.length === 0,
  `있으면 전 화면에 수화 오류가 난다: ${bad.join(' · ')}`)

// ── ② 유형 순서에 같은 이름이 두 번 들어오지 않는다 ───────────────────────
const A = load(path.join(ROOT, 'lib/activity.ts'))
const CARD = load(path.join(ROOT, 'components/activity/ActivityCard.tsx'))

console.log('\n── ② 유형 순서 — 이름이 겹치지 않는다 ──')
const sales = [
  { code: 'AS', label: 'A/S', sort_order: 10, is_active: true, is_system: false, is_remote: false },
  { code: 'VISIT', label: '방문', sort_order: 20, is_active: true, is_system: false, is_remote: false },
]
const order = A.activityTypeOrder(sales)
eq('겹치는 이름은 한 번만', order.filter(t => t === 'A/S').length, 1)
eq('이름이 전부 유일하다', order.length, new Set(order).size)
ok("서비스 유형의 차례가 먼저다('A/S' 가 원래 자리에 남는다)",
  order.indexOf('A/S') === CARD.SERVICE_TYPES.indexOf('A/S'))
ok('영업 종류는 뒤에 붙는다', order.indexOf('방문') > order.indexOf('A/S'))
eq('표를 못 읽었으면 서비스 유형만', A.activityTypeOrder([]), [...CARD.SERVICE_TYPES])
// 겹칠 수 있다는 것 자체를 못 박는다 — 이 줄이 깨지면 위 중복 제거가 왜 있는지가 사라진다.
ok("SERVICE_TYPES 에 'A/S' 가 있다(그래서 표의 'A/S' 와 겹친다)", CARD.SERVICE_TYPES.includes('A/S'))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
