// **쪽 나누기** — 셈과 글자, 그리고 발주 목록이 서버에서 끊어 오는가 (2026-11-26).
//
//   node scripts/pager-check.js
//
// 지키는 약속
//   ① 쪽은 1부터 센다. 0건이어도 1쪽이다.
//   ② 주소로 아무 수나 들어와도 1..마지막 안으로 들어온다.
//   ③ `.range(from, to)` 는 **그 쪽의 자리**다 — 서버가 끊는다(전부 받아 자르지 않는다).
//   ④ 「전체 N건 · a–b」 의 a·b 는 마지막 쪽에서도 넘지 않는다.
//   ⑤ 번호 줄은 첫·끝을 늘 보여 주고, **두 칸 이상** 건너뛸 때만 … 를 쓴다.
//   ⑥ 부품은 공용이다(components/common/Pager.tsx) — 화면 이름을 담지 않는다.
//   ⑦ 발주 목록: count: 'exact' + range + 조건이 바뀌면 1쪽 + 주소에 ?page=.

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

const P = load(path.join(ROOT, 'lib/pager.ts'))

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
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')

console.log('── ① 몇 쪽인가 ──')
eq('한 쪽 50줄', P.PAGE_SIZE, 50)
eq('0건도 1쪽', P.pageCount(0), 1)
eq('50건이면 1쪽', P.pageCount(50), 1)
eq('51건이면 2쪽', P.pageCount(51), 2)
eq('1234건이면 25쪽', P.pageCount(1234), 25)
eq('한 쪽 크기를 바꿀 수 있다', P.pageCount(1234, 100), 13)

console.log('\n── ② 주소로 들어온 수는 안으로 ──')
eq('0 은 1쪽', P.clampPage(0, 1234), 1)
eq('음수도 1쪽', P.clampPage(-3, 1234), 1)
eq('글자는 1쪽', P.clampPage('abc', 1234), 1)
eq('너무 큰 수는 마지막 쪽', P.clampPage(999, 1234), 25)
eq('그 안의 수는 그대로', P.clampPage(7, 1234), 7)

console.log('\n── ③ 받아 올 자리(range) ──')
eq('1쪽', P.pageRange(1), { from: 0, to: 49 })
eq('2쪽', P.pageRange(2), { from: 50, to: 99 })
eq('25쪽', P.pageRange(25), { from: 1200, to: 1249 })
eq('크기를 바꾸면 자리도 바뀐다', P.pageRange(3, 20), { from: 40, to: 59 })

console.log('\n── ④ 「전체 N건 · a–b」 ──')
eq('첫 쪽', P.pageLabel(1, 50, 1234), '전체 1,234건 · 1–50')
eq('가운데 쪽', P.pageLabel(3, 50, 1234), '전체 1,234건 · 101–150')
eq('마지막 쪽은 전체 수를 넘지 않는다', P.pageLabel(25, 50, 1234), '전체 1,234건 · 1,201–1,234')
eq('0건이면 건수만', P.pageLabel(1, 50, 0), '전체 0건')
eq('1건', P.pageLabel(1, 50, 1), '전체 1건 · 1–1')

console.log('\n── ⑤ 번호 줄 ──')
eq('쪽이 적으면 전부 보인다', P.pageItems(1, 5), [1, 2, 3, 4, 5])
eq('앞쪽', P.pageItems(1, 20), [1, 2, '…', 20])
eq('가운데', P.pageItems(10, 20), [1, '…', 9, 10, 11, '…', 20])
eq('끝쪽', P.pageItems(20, 20), [1, '…', 19, 20])
eq('7쪽까지는 전부', P.pageItems(4, 7), [1, 2, 3, 4, 5, 6, 7])
 eq('한 칸만 비면 … 대신 그 수', P.pageItems(5, 8), [1, '…', 4, 5, 6, 7, 8])
eq('한 쪽뿐이면 하나', P.pageItems(1, 1), [1])
eq('양옆을 넓힐 수 있다', P.pageItems(10, 20, 2), [1, '…', 8, 9, 10, 11, 12, '…', 20])

console.log('\n── ⑥ 부품은 공용 ──')
const PAGER = read('components/common/Pager.tsx')
ok('규칙은 lib 에서 가져온다', /from '@\/lib\/pager'/.test(PAGER))
ok('화면 이름을 담지 않는다', !/발주|견적|고객사/.test(PAGER.replace(/\/\*[\s\S]*?\*\//g, '')))
ok('한 쪽뿐이면 번호를 그리지 않는다', /\{pages > 1 && \(/.test(PAGER))
ok('모서리·색은 토큰만 쓴다',
  /from '@\/lib\/radius'/.test(PAGER) && !/#[0-9a-fA-F]{6}/.test(PAGER))
ok('지금 쪽을 보조기술에도 알린다', /aria-current=\{it === page \? 'page' : undefined\}/.test(PAGER))
ok('앞·뒤 단추에 이름이 있다', /aria-label="이전 쪽"/.test(PAGER) && /aria-label="다음 쪽"/.test(PAGER))

console.log('\n── ⑦ 발주 목록이 서버에서 끊는다 ──')
const PUR = read('app/purchase/page.tsx')
ok('전체 건수를 함께 센다', /\{ count: 'exact' \}\)/.test(PUR))
ok('그 쪽만 받아 온다', /\.range\(from, to\)/.test(PUR) && /pageRange\(opts\.page, PAGE_SIZE\)/.test(PUR))
ok('현황 숫자는 수만 센다(head)', /\{ count: 'exact', head: true \}/.test(PUR))
ok('조건이 바뀌면 1쪽', /setPage\(1\)\s*\n\s*\}, \[statusFilter, debounced\]\)/.test(PUR))
ok('검색은 한 박자 쉬고 보낸다', /setTimeout\(\(\) => setDebounced\(search\), 300\)/.test(PUR))
ok('주소에 쪽을 남긴다',
  /url\.searchParams\.set\('page', String\(page\)\)/.test(PUR)
  && /url\.searchParams\.delete\('page'\)/.test(PUR))
ok('첫 값은 주소에서 읽는다', /new URLSearchParams\(window\.location\.search\)\.get\('page'\)/.test(PUR))
ok('쪽 줄을 그린다', /<Pager page=\{page\} total=\{total\} size=\{PAGE_SIZE\} onChange=\{setPage\} \/>/.test(PUR))
ok('받아 온 줄을 다시 거르지 않는다(서버가 걸렀다)',
  /const filtered = quotes\b/.test(PUR) && !/quotes\.filter\(q => \{/.test(PUR))
ok('이름으로 검색하면 고객사 id 로 좁힌다', /customer_id\.in\.\(\$\{ids\.join\(','\)\}\)/.test(PUR))
// 이름으로 맞는 고객사는 **서버에 묻는다** — customers 를 통째로 받아 두면 PostgREST 의
// 기본 상한(1,000줄) 밖의 고객사가 검색에 걸리지 않는다(2026-11-26 실측: 「현대」 0건).
// 2026-11-26(H) — 회사는 **한 함수로** 찾는다: 회사명·영문명(lib/companySearch.ts ⓑ).
ok('이름은 customers 에 물어 좁힌다(회사명·영문명)',
  /\.or\(companyPickOr\(safe, useEn\)\)\.limit\(SEARCH_ID_MAX\)/.test(PUR)
  && /withNameEnFallback/.test(PUR))
ok('이름표는 그 쪽에 보이는 고객사만 받아 둔다', /void fetchNames\(/.test(PUR))
ok('주소로 들어온 쪽을 첫 효과가 1 로 돌려놓지 않는다',
  /if \(firstRun\.current\) \{ firstRun\.current = false; return \}/.test(PUR))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
