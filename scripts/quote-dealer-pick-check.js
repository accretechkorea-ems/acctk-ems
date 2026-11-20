/**
 * 견적 사명 칸 — **사업장·대리점 통합 검색**(2026-11-20).
 *
 * 지키는 약속
 *   ① 저장되는 두 칸의 규칙은 바뀌지 않는다 — 직판은 customer_id 만, 대리점 건은
 *     customer_id=E.U · dealer_id=대리점. 저장하는 자리(useQuoteSubmit)가 이 규칙을
 *     **직접 적지 않고** lib 함수를 쓴다(두 곳이 갈라지지 않게).
 *   ② 검색은 사업장 조회와 대리점 조회를 **함께** 보낸다(체크박스로 갈리지 않는다).
 *   ③ 고른 줄의 역할이 isDealer 를 정한다 — 대리점을 고르면 켜고 E.U 를 비우며,
 *     사업장을 고르면 끄고 E.U 를 비운다. 사명을 비우면 역할도 풀린다.
 *   ④ 같은 업체가 사업장·대리점 두 역할로 떠도 목록 key 가 겹치지 않는다(15곳).
 *   ⑤ 「대리점」 체크박스는 없다. E.U 칸은 isDealer 로만 나타난다.
 *   ⑥ 수신인 후보는 대리점 건일 때 **양쪽**(대리점·E.U)에서 나온다.
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
require.extensions['.ts'] = (mod, filename) => {
  const out = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  }).outputText
  mod._compile(out, filename)
}

const {
  quoteCustomerColumns, mergeCustomerPicks, pickKey, isAgencyPick,
  recipientCustomerIds, groupRecipients,
} = load(path.join(ROOT, 'lib', 'quoteCustomerPick.ts'))

const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')
const HOOK = read(path.join('hooks', 'quote', 'useQuoteCustomer.ts'))
const SUBMIT = read(path.join('hooks', 'quote', 'useQuoteSubmit.tsx'))
const CARD = read(path.join('components', 'quote', 'CustomerCard.tsx'))
const PAGE = read(path.join('app', 'quote', 'page.tsx'))

let fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) console.log(`OK   ${name}  got=${JSON.stringify(got)}`)
  else { fail++; console.error(`FAIL ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`) }
}
const ok = (name, cond, hint) => {
  if (cond) console.log(`OK   ${name}`)
  else { fail++; console.error(`FAIL ${name}${hint ? `  — ${hint}` : ''}`) }
}

console.log('── ① 저장 컬럼 — 규칙은 그대로다 ──')
eq('직판: customer_id 만',
  quoteCustomerColumns({ isDealer: false, customerId: 1411, euCustomerId: null }),
  { customer_id: 1411, dealer_id: null })
eq('직판: E.U 가 남아 있어도 쓰지 않는다',
  quoteCustomerColumns({ isDealer: false, customerId: 1411, euCustomerId: 99 }),
  { customer_id: 1411, dealer_id: null })
eq('대리점: customer_id=E.U · dealer_id=대리점',
  quoteCustomerColumns({ isDealer: true, customerId: 2001, euCustomerId: 1411 }),
  { customer_id: 1411, dealer_id: 2001 })
eq('대리점인데 E.U 미선택 — customer_id 는 빈 채로 간다(검증이 먼저 막는다)',
  quoteCustomerColumns({ isDealer: true, customerId: 2001, euCustomerId: null }),
  { customer_id: null, dealer_id: 2001 })

console.log('\n── ① 저장하는 자리가 그 규칙을 쓰는가 ──')
ok('useQuoteSubmit 가 quoteCustomerColumns 를 쓴다',
  /\.\.\.quoteCustomerColumns\(\{\s*isDealer,\s*customerId,\s*euCustomerId\s*\}\)/.test(SUBMIT),
  'create_quote 의 p_quote 안에서 불러야 한다')
ok('손으로 적은 매핑이 남아 있지 않다',
  !/customer_id:\s*isDealer\s*\?/.test(SUBMIT) && !/dealer_id:\s*isDealer\s*\?/.test(SUBMIT),
  '규칙이 두 곳에 있으면 한쪽만 고쳐지는 날이 온다')
ok('대리점 건의 E.U 필수 검증은 그대로다',
  /eu:\s*isDealer\s*&&\s*!euCustomerId/.test(PAGE))

console.log('\n── ② 검색은 양쪽을 함께 본다 ──')
ok('사업장 조회 조건(is_parent=false + NOT_AGENCY_ONLY)',
  /eq\('is_parent', false\)\.or\(NOT_AGENCY_ONLY\)/.test(HOOK))
ok('대리점 조회 조건(is_agency=true)', /eq\('is_agency', true\)/.test(HOOK))
ok('두 조회를 함께 보낸다', /Promise\.all\(\[run\('site'\), run\('agency'\)\]\)/.test(HOOK))
ok('결과를 한 목록으로 세운다', /mergeCustomerPicks\(sites\.data \?\? \[\], agencies\.data \?\? \[\]\)/.test(HOOK))
ok('검색이 isDealer 로 갈리지 않는다',
  !/query = isDealer/.test(HOOK) && !/isDealer\s*\n?\s*\?\s*query/.test(HOOK),
  '체크박스 시절의 분기가 남아 있다')

console.log('\n── ②-2 목록의 모양 ──')
const merged = mergeCustomerPicks(
  [{ customer_id: 1411, company_name: '이룸지텍' }, { customer_id: 1500, company_name: '일진글로벌' }],
  [{ customer_id: 1411, company_name: '이룸지텍' }, { customer_id: 2001, company_name: '젠트' }],
)
eq('사업장 먼저, 대리점 나중', merged.map(r => `${r.company_name}:${r.role}`),
  ['이룸지텍:site', '일진글로벌:site', '이룸지텍:agency', '젠트:agency'])
eq('양쪽에 다 있는 15곳은 두 줄로 남는다',
  merged.filter(r => r.customer_id === 1411).length, 2)
eq('④ key 가 겹치지 않는다', new Set(merged.map(pickKey)).size, merged.length)
eq('역할 판정', merged.map(isAgencyPick), [false, false, true, true])
eq('역할이 없는 줄(포캐스트·수리 prefill)은 사업장으로 본다', isAgencyPick({ customer_id: 7 }), false)
eq('역할 없는 줄의 key', pickKey({ customer_id: 7 }), '7:site')

console.log('\n── ③ 고른 줄이 역할을 정한다 ──')
ok('대리점을 고르면 isDealer 를 켠다', /const asAgency = isAgencyPick\(c\)\s*\n\s*setIsDealer\(asAgency\)/.test(HOOK))
ok('대리점을 고르면 E.U 를 비운다(앞 건의 E.U 가 남지 않게)',
  /if \(asAgency\) \{ clearEu\(\); loadOpportunities\(null\) \}/.test(HOOK))
ok('사업장을 고르면 그 업체의 포캐스트를 읽는다',
  /else loadOpportunities\(c\.customer_id\)/.test(HOOK))
ok('사명을 비우면 역할도 풀린다',
  /handleCustomerClear = \(\) => \{[\s\S]*?setIsDealer\(false\)[\s\S]*?clearEu\(\)/.test(HOOK))

console.log('\n── ⑤ 체크박스는 없다 · E.U 칸은 isDealer 로만 ──')
ok('카드에 대리점 체크박스가 없다',
  !/type="checkbox"[\s\S]{0,200}checked=\{isDealer\}/.test(CARD),
  '체크박스가 되살아났다')
ok('카드가 setIsDealer 를 받지 않는다', !/setIsDealer/.test(CARD))
ok('E.U 칸은 {isDealer && …} 로 나타난다', /\{isDealer && \(/.test(CARD))
ok('고른 뒤 「대리점」 뱃지를 보여 준다', /isDealer && \(\s*\n\s*<span[^>]*>\s*\n?\s*대리점/.test(CARD))
ok('후보 목록의 대리점 줄에 꼬리표', /isAgencyPick\(c\) && \(/.test(CARD))
ok('뱃지·꼬리표는 R.tag 를 쓴다', (CARD.match(/borderRadius: R\.tag/g) || []).length >= 2)

console.log('\n── ⑥ 수신인은 양쪽에서 고른다 ──')
eq('직판이면 한 곳', recipientCustomerIds({ isDealer: false, customerId: 1411, euCustomerId: 1500 }), [1411])
eq('대리점이면 두 곳(대리점 먼저)', recipientCustomerIds({ isDealer: true, customerId: 2001, euCustomerId: 1411 }), [2001, 1411])
eq('E.U 를 아직 안 골랐으면 대리점만', recipientCustomerIds({ isDealer: true, customerId: 2001, euCustomerId: null }), [2001])
const contacts = [
  { contact_id: 1, customer_id: 2001, name: '김소희' },
  { contact_id: 2, customer_id: 1411, name: '박강민' },
  { contact_id: 3, customer_id: 2001, name: '이한' },
]
const groups = groupRecipients(contacts, [
  { customerId: 2001, label: '대리점 · 젠트' },
  { customerId: 1411, label: 'E.U · 이룸지텍' },
])
eq('묶음 둘, 건네준 순서대로', groups.map(g => `${g.label}(${g.contacts.length})`),
  ['대리점 · 젠트(2)', 'E.U · 이룸지텍(1)'])
eq('담당자 없는 묶음은 빠진다',
  groupRecipients(contacts, [{ customerId: 9999, label: '아무도 없음' }]).length, 0)
ok('화면이 두 업체의 담당자를 함께 읽는다',
  /recipientCustomerIds\(\{ isDealer, customerId, euCustomerId \}\)/.test(PAGE)
  && /\.in\('customer_id', ids\)/.test(PAGE))
ok('묶음이 둘일 때만 제목을 그린다', /recipientGroups\.length > 1/.test(CARD))

console.log(fail === 0 ? '\n전부 통과' : `\n${fail}건 실패`)
process.exit(fail === 0 ? 0 : 1)
