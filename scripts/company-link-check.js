/**
 * 회사로 가는 길 · 회사 카드의 견적 타일 (2026-11-20).
 *
 * 지키는 약속
 *   ① 한 부품이 두 경우를 맡는다 — 분할 보기 안은 pane 전환(onOpen), 밖은 주소 이동.
 *   ② 상세 페이지에서 쓰는 주소는 `/?view=list&company=<id>` 한 가지다.
 *   ③ 회사에 묶이지 않은 단독 업체는 **글자만**(갈 곳이 없다).
 *   ④ 목록 보기가 그 주소를 읽어 **그 회사를 고른 채** 선다. 고른 회사는 주소에 남는다
 *     (새로고침해도 그대로다 — `site`·`focus` 처럼 털지 않는다).
 *   ⑤ 회사 카드의 「진행 견적」 타일 — 큰 숫자는 진행, 아래 회색 줄은 회사 전체 건수.
 *     진행이 0 이면 큰 숫자는 회색이다.
 *   ⑥ 견적 이력 창 제목에 두 수치가 함께 적힌다(진행 판정은 회사 카드와 같은 PENDING_STATUS).
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
for (const ext of ['.ts', '.tsx']) {
  Module._extensions[ext] = (mod, filename) => {
    mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
        esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX,
      }, fileName: filename,
    }).outputText, filename)
  }
}

const { companyListHref } = load(path.join(ROOT, 'components', 'customer', 'CompanyLink.ts' + 'x'))
const { PENDING_STATUS } = load(path.join(ROOT, 'lib', 'quoteStatus.ts'))

const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')
const LINK = read(path.join('components', 'customer', 'CompanyLink.tsx'))
const BAND = read(path.join('components', 'customer', 'SiteHeaderBand.tsx'))
const HOME = read(path.join('app', 'page.tsx'))
const PANE = read(path.join('components', 'home', 'list', 'CompanyPane.tsx'))
const MODAL = read(path.join('components', 'customer', 'modals', 'QuoteHistoryModal.tsx'))
const BODY = read(path.join('components', 'customer', 'CustomerDetailBody.tsx'))

let fail = 0
const eq = (name, got, want) => {
  const okk = JSON.stringify(got) === JSON.stringify(want)
  if (okk) console.log(`OK   ${name}  got=${JSON.stringify(got)}`)
  else { fail++; console.error(`FAIL ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`) }
}
const ok = (name, cond, hint) => {
  if (cond) console.log(`OK   ${name}`)
  else { fail++; console.error(`FAIL ${name}${hint ? `  — ${hint}` : ''}`) }
}

console.log('── ② 주소는 한 가지다 ──')
eq('목록 보기 + 그 회사', companyListHref(1485), '/?view=list&company=1485')
eq('id 가 달라도 모양은 같다', companyListHref(7), '/?view=list&company=7')

console.log('\n── ① 한 부품이 두 경우를 맡는다 ──')
ok('onOpen 이 있으면 그것을 쓴다(주소를 바꾸지 않는다)', /if \(onOpen\) \{[\s\S]{0,200}<button type="button" onClick=\{onOpen\}/.test(LINK))
ok('없으면 companyId 로 Link 로 간다', /if \(companyId != null\) \{[\s\S]{0,200}<Link href=\{companyListHref\(companyId\)\}/.test(LINK))
ok('③ 둘 다 없으면 글자만', /return <span style=\{text\}>\{name\}<\/span>/.test(LINK))
ok('사업장 카드가 이 부품을 쓴다', /<CompanyLink name=\{title\} companyId=\{companyId\} onOpen=\{onOpenCompany\} \/>/.test(BAND))
ok('회사 id 는 부모 id 다', /const companyId = customer\?\.parent_customer_id \?\? null/.test(BAND))
ok('분할 보기 안에서만 onOpenCompany 가 온다', /onOpenCompany=\{embedded \? onBack : undefined\}/.test(BODY),
  '이 줄이 사라지면 분할 보기에서 pane 전환이 아니라 화면 이동이 된다')

console.log('\n── ④ 목록 보기가 그 주소를 읽는다 ──')
ok('company 를 읽는다', /const company = Number\(q\.get\('company'\)\)/.test(HOME))
ok('목록 보기 · 회사 탭으로 선다', /setView\('list'\)\s*\n\s*setListTab\('company'\)/.test(HOME))
ok('그 회사를 고르고 펼친다',
  /setSelectedCompanyId\(company\)[\s\S]{0,120}setExpanded\(prev => new Set\(prev\)\.add\(company\)\)/.test(HOME))
ok('고른 회사를 주소에 남긴다',
  /url\.searchParams\.set\('company', String\(selectedCompanyId\)\)/.test(HOME))
ok('company 는 한 번 쓰고 털어 내는 값이 아니다',
  !/delete\('site'\); url\.searchParams\.delete\('focus'\); url\.searchParams\.delete\('company'\)/.test(HOME),
  "site·focus 와 함께 지우면 새로고침에 회사가 풀린다")
ok('주소를 갈아 끼울 때 뒤로가기 기록을 늘리지 않는다(replaceState)',
  /window\.history\.replaceState\(null, '', url\.toString\(\)\)/.test(HOME))
ok('효과가 고른 회사·대리점을 함께 본다',
  /\}, \[view, timelineFocusKey, selectedCompanyId, selectedAgencyId\]\)/.test(HOME))

console.log('\n── ⑤ 회사 카드의 견적 타일 ──')
ok('진행 0 이면 큰 숫자는 회색', /color=\{group\.openQuotes > 0 \? BLUE : MUTED\}/.test(PANE))
ok('아래 줄은 회사 전체 건수', /note=\{`전체 \$\{timeline\.quotes\.length\}건`\}/.test(PANE))
ok('타일을 누르면 견적 이력 창', /onClick=\{\(\) => setQuoteHistoryOpen\(true\)\}/.test(PANE))
ok('창에는 끝난 건까지 들어간다', /quotes=\{timeline\.quotes\}/.test(PANE))

console.log('\n── ⑥ 견적 이력 창 제목 ──')
eq('진행 판정은 「견적중」', PENDING_STATUS, '견적중')
ok('제목에 두 수치', /견적 이력 \$\{quotes\.length\}건 · 진행 \$\{pendingCount\}/.test(MODAL))
ok('진행 수는 PENDING_STATUS 로 센다',
  /const pendingCount = quotes\.filter\(q => q\.status === PENDING_STATUS\)\.length/.test(MODAL))

console.log(fail === 0 ? '\n전부 통과' : `\n${fail}건 실패`)
process.exit(fail === 0 ? 0 : 1)
