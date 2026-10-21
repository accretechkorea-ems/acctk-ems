// 견적 **작성 날짜** 규칙 시험 — 지난 날짜로 쓰는 길.
//
//   node scripts/quote-date-check.js
//
// 왜 따로 두는가 — 이 날짜는 **견적번호에 박히고 실적 달을 정한다.** 한 번 확정하면 고칠 수
// 없고, 시간대를 한 칸 잘못 읽으면 한국 시간 자정 전후에 하루가 밀린다(우리 서버는 UTC 다).
// 화면을 띄우지 않고 순수 함수만 돌린다.
//   compactYmd/displayYmd  — DB 로 보내는 p_date 와 견적서에 찍히는 작성일
//   safeQuoteDate          — 미래·망가진 값을 오늘로 떨어뜨린다(미래 차단)
//   differsInMonth/monthOf — 실적 달 경고
//   isBackdatedQuote       — 목록 표시(견적 날짜 ≠ 실제 넣은 날, 한국 기준)

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
    mod._compile(ts.transpileModule(src, {
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

const {
  isYmd, compactYmd, displayYmd, isWritableQuoteDate, safeQuoteDate,
  isBackdated, differsInMonth, monthOf, isBackdatedQuote, backdatedTitle,
} = load(path.join(ROOT, 'lib/quoteDate.ts'))

let fails = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
}

const TODAY = '2026-10-21'

// ── ⑴ DB 로 보내는 날짜 ───────────────────────────────────────────────────
console.log('── p_date 와 작성일 글자 ──')
eq('어제 → p_date', compactYmd('2026-10-20'), '20261020')
eq('오늘 → p_date', compactYmd(TODAY), '20261021')
eq('해가 바뀌는 자리', compactYmd('2025-12-31'), '20251231')
eq('모양이 아니면 빈 글자(저장이 막힌다)', compactYmd('2026-13-01'), '')
eq('2월 30일은 날짜가 아니다', isYmd('2026-02-30'), false)
eq('2024년 2월 29일은 날짜다(윤년)', isYmd('2024-02-29'), true)
eq('견적서 작성일 표기', displayYmd('2026-10-05'), '2026년　10월　05일')
eq('표기의 사이 공백은 전각(U+3000)이다',
  [...displayYmd('2026-10-05')].filter(c => c === '　').length, 2)

// ── ⑵ 미래 차단 ───────────────────────────────────────────────────────────
console.log('\n── 미래 날짜는 고를 수 없다 ──')
eq('오늘은 된다', isWritableQuoteDate(TODAY, TODAY), true)
eq('어제도 된다', isWritableQuoteDate('2026-10-20', TODAY), true)
eq('내일은 안 된다', isWritableQuoteDate('2026-10-22', TODAY), false)
eq('내일을 넣으면 오늘로 떨어진다', safeQuoteDate('2026-10-22', TODAY), TODAY)
eq('빈 값도 오늘로', safeQuoteDate('', TODAY), TODAY)
eq('옛 초안에 키가 없으면(undefined) 오늘로', safeQuoteDate(undefined, TODAY), TODAY)
eq('망가진 값도 오늘로', safeQuoteDate('20261020', TODAY), TODAY)
eq('지난 날짜는 그대로 받는다', safeQuoteDate('2026-09-30', TODAY), '2026-09-30')

// ── ⑶ 실적 달 경고 ────────────────────────────────────────────────────────
console.log('\n── 달이 다를 때만 실적 경고 ──')
eq('같은 달 지난 날 — 「지난 날짜로 작성」만', [isBackdated('2026-10-05', TODAY), differsInMonth('2026-10-05', TODAY)], [true, false])
eq('지난 달 — 경고 한 줄 더', [isBackdated('2026-09-30', TODAY), differsInMonth('2026-09-30', TODAY)], [true, true])
eq('그 달은 9월', monthOf('2026-09-30'), 9)
eq('오늘이면 아무 경고도 없다', [isBackdated(TODAY, TODAY), differsInMonth(TODAY, TODAY)], [false, false])
eq('해가 다르면 달도 다르다(2025-10 vs 2026-10)', differsInMonth('2025-10-21', TODAY), true)

// ── ⑷ 목록 표시 — 한국 기준으로 가른다 ────────────────────────────────────
console.log('\n── 견적 날짜 ≠ 실제 넣은 날 (한국 기준) ──')
// 한국은 UTC+9 다. 같은 시각이라도 UTC 날짜와 한국 날짜가 다를 수 있다.
eq('UTC 10/20 15:30 = 한국 10/21 00:30 → 10/21 에 넣은 것',
  isBackdatedQuote('2026-10-21', '2026-10-20T15:30:00Z'), false)
eq('같은 시각을 10/20 견적으로 넣었다면 지난 날짜다',
  isBackdatedQuote('2026-10-20', '2026-10-20T15:30:00Z'), true)
eq('UTC 10/20 14:30 = 한국 10/20 23:30 → 10/20 에 넣은 것',
  isBackdatedQuote('2026-10-20', '2026-10-20T14:30:00Z'), false)
eq('UTC 로 읽었다면 10/21 로 보여 표시가 반대로 났을 자리다',
  '2026-10-20T15:30:00Z'.slice(0, 10) !== '2026-10-21', true)
eq('created_at 을 모르면 표시하지 않는다', isBackdatedQuote('2026-10-20', null), false)
eq('견적 날짜가 없으면 표시하지 않는다', isBackdatedQuote(null, '2026-10-20T15:30:00Z'), false)
eq('마우스를 올렸을 때 글자', backdatedTitle('2026-10-20T15:30:00Z'), '실제 작성 2026-10-21')
eq('모르면 빈 글자', backdatedTitle(null), '')

console.log(fails === 0 ? '\n모두 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
