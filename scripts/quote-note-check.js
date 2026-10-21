// 견적서 **하단 블록**(조건 네 줄 · 비고) 규칙 시험.
//
//   node scripts/quote-note-check.js
//
// 왜 따로 두는가 — 이 블록의 글자는 **고객에게 그대로 나간다.** 규칙이 조용히 틀어지면
// 엉뚱한 문구가 찍힌 견적서가 나간 뒤에 알게 된다. 화면을 그리지 않고 순수 함수만 돌린다.
//   promoteLegacyDelivery — 없앤 「납기」 칸의 옛 값을 납품일정으로 올리는 규칙

// eslint 의 no-require-imports 는 맨 require() 를 센다. 이 파일은 node 로 직접 돌리는
// CJS 스크립트라 모듈을 그렇게 불러올 수밖에 없다 — 한 번만 묶어 두고 그것만 쓴다.
const load = module.require.bind(module)
const path = load('path')
const Module = load('module')
const ROOT = path.join(__dirname, '..')
const ts = load(path.join(ROOT, 'node_modules/typescript'))

for (const ext of ['.ts', '.tsx']) {
  Module._extensions[ext] = (mod, filename) => {
    const src = load('fs').readFileSync(filename, 'utf8')
    const out = ts.transpileModule(src, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
        esModuleInterop: true, jsx: ts.JsxEmit.React,
      },
      fileName: filename,
    }).outputText
    mod._compile(out, filename)
  }
}
const origResolve = Module._resolveFilename
Module._resolveFilename = function (req, ...rest) {
  if (req.startsWith('@/')) req = path.join(ROOT, req.slice(2))
  return origResolve.call(this, req, ...rest)
}

const {
  DEFAULT_TERMS, TERM_MAX_LEN, promoteLegacyDelivery,
} = load(path.join(ROOT, 'lib/quoteTerms.ts'))

let fails = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
}

// ── 옛 납기 값 올리기 ──────────────────────────────────────────────────────
console.log('── 없앤 납기 칸의 값을 납품일정으로 올린다 ──')
const base = { ...DEFAULT_TERMS }
const schedule = t => t.delivery_schedule

eq('납기만 있으면 올린다', schedule(promoteLegacyDelivery(base, '10주')), '10주')
eq('다른 칸은 건드리지 않는다',
  promoteLegacyDelivery(base, '10주').payment_terms, DEFAULT_TERMS.payment_terms)
eq('앞뒤 공백·연속 공백은 접는다',
  schedule(promoteLegacyDelivery(base, '  발주 후   10주 ')), '발주 후 10주')
eq('빈 값이면 기본값 그대로', schedule(promoteLegacyDelivery(base, '')), DEFAULT_TERMS.delivery_schedule)
eq('null 이어도 기본값 그대로', schedule(promoteLegacyDelivery(base, null)), DEFAULT_TERMS.delivery_schedule)

// 납품일정을 이미 적어 둔 견적 — 조건 쪽이 정본이다.
const written = { ...DEFAULT_TERMS, delivery_schedule: '12월 3주' }
eq('납품일정이 이미 있으면 덮지 않는다', schedule(promoteLegacyDelivery(written, '10주')), '12월 3주')

// 발주 요청이 같은 칸(delivery_info)을 배송 주소로 덮어쓴다 — 그 주소가 올라가면 안 된다.
eq('줄바꿈이 있는 값(발주 배송 정보)은 올리지 않는다',
  schedule(promoteLegacyDelivery(base, '수령인: 홍길동\n주소: 경기도 …')), DEFAULT_TERMS.delivery_schedule)
eq(`${TERM_MAX_LEN}자를 넘는 값은 올리지 않는다(그 줄은 PDF 에서 한 행이다)`,
  schedule(promoteLegacyDelivery(base, '가'.repeat(TERM_MAX_LEN + 1))), DEFAULT_TERMS.delivery_schedule)
eq(`${TERM_MAX_LEN}자까지는 올린다`,
  schedule(promoteLegacyDelivery(base, '가'.repeat(TERM_MAX_LEN))), '가'.repeat(TERM_MAX_LEN))

console.log(fails === 0 ? '\n모두 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
