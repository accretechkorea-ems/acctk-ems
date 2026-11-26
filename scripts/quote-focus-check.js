// **견적 작성의 손이 가는 차례 + 확정 뒤 메일** (2026-11-25).
//
//   node scripts/quote-focus-check.js
//
// 지키는 약속
//   ① 고르면 다음 칸으로 — 사명 → (대리점이면) E.U → 수신인 → 품번 가격표 검색.
//   ② 품목 카드는 그 안에 커서가 있으면 테마 파랑 테두리다.
//   ③ 확정 → 번호 → PDF 뒤에 작은 창이 뜨고, 수신인 메일이 mailto 로 열린다.
//   ④ 이메일이 없으면 버튼 대신 **안내**가 뜬다.
//
// ※ 이 파일은 **열쇠 없이** 돈다(하네스 규칙) — 글자와 순수 함수만 본다.

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

const F = load(path.join(ROOT, 'lib/quoteFocus.ts'))
const M = load(path.join(ROOT, 'lib/quoteMail.ts'))

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
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const CARD = read('components/quote/CustomerCard.tsx')
const ROW = read('app/quote/QuoteItemRow.tsx')
const CSS = read('app/globals.css')
const PAGE = read('app/quote/page.tsx')
const SUBMIT = read('hooks/quote/useQuoteSubmit.tsx')
const CUST = read('hooks/quote/useQuoteCustomer.ts')
const SAVED = read('components/quote/QuoteSavedModal.tsx')

console.log('── ① 고르면 다음 칸으로 ──')
eq('대리점: 사명 다음은 E.U', F.nextFocusStep('company', { isDealer: true }), 'eu')
eq('직판: 사명 다음은 곧 수신인', F.nextFocusStep('company', { isDealer: false }), 'recipient')
eq('E.U 다음은 수신인', F.nextFocusStep('eu', { isDealer: true }), 'recipient')
eq('수신인 다음은 가격표 검색', F.nextFocusStep('recipient', { isDealer: true }), 'priceSearch')
eq('가격표 검색이 끝이다', F.nextFocusStep('priceSearch', { isDealer: true }), null)
eq('차례는 넷', F.QUOTE_FOCUS_ORDER.length, 4)

console.log('\n── 담당자가 한 사람뿐이면 ──')
eq('한 사람이면 그 사람', F.onlyContactId([{ contact_id: 7 }]), 7)
eq('둘이면 고르게 둔다', F.onlyContactId([{ contact_id: 7 }, { contact_id: 8 }]), null)
eq('없으면 없다', F.onlyContactId([]), null)

console.log('\n── 칸이 제 이름을 적어 둔다 ──')
ok('등록소에 적는 함수', typeof F.registerQuoteFocus === 'function')
ok('빈 칸을 주면 지운다', (() => {
  const fake = { focus() { this.hit = true } }
  F.registerQuoteFocus('eu', fake)
  const had = F.quoteFocusTarget('eu') === fake
  F.registerQuoteFocus('eu', null)
  return had && F.quoteFocusTarget('eu') === null
})())
ok('서버에서는 아무 일도 하지 않는다', /typeof window === 'undefined'/.test(read('lib/quoteFocus.ts')))
ok('다음 프레임에 옮긴다 — 아직 그려지지 않은 칸이 있다',
  /requestAnimationFrame\(\(\) => window\.requestAnimationFrame/.test(read('lib/quoteFocus.ts')))

console.log('\n── 화면이 그 차례를 부른다 ──')
ok('사명을 고르면 다음으로', CARD.includes("advanceQuoteFocus('company'"))
ok('대리점인지까지 넘긴다', /advanceQuoteFocus\('company', \{ isDealer: isAgencyPick\(c\) \}\)/.test(CARD))
ok('E.U 를 고르면 수신인', CARD.includes("advanceQuoteFocus('eu'"))
ok('E.U 칸이 등록한다', CARD.includes("registerQuoteFocus('eu'"))
ok('수신인 칸이 등록한다', CARD.includes("registerQuoteFocus('recipient'"))
ok('수신인을 고르면 가격표 검색', CARD.includes("focusQuoteStep('priceSearch')"))
ok('담당자가 한 사람이면 자동으로 고른다', CARD.includes('onlyContactId('))
// 2026-11-25 실측 — 줄의 onClick 에만 달려 있어 화살표·Enter 로 고르면 커서가 남았다.
ok('키보드로 고른 때도 옮긴다 — 업체',
  /useListKeyboard\(customerResults[\s\S]{0,200}advanceQuoteFocus\('company'/.test(CUST))
ok('키보드로 고른 때도 옮긴다 — E.U',
  /useListKeyboard\(euResults[\s\S]{0,200}advanceQuoteFocus\('eu'/.test(CUST))
ok('prefill 이 부르는 길에는 달지 않는다 — 화면이 열리는 중에 커서를 빼앗지 않는다',
  !/const handleCustomerSelect[\s\S]{0,900}advanceQuoteFocus/.test(CUST))
ok('가격표 검색 칸이 등록한다', ROW.includes("registerQuoteFocus('priceSearch'"))
ok('입력칸 ref 를 받는 자리', /inputRef\?: \(el: HTMLInputElement \| null\) => void/.test(ROW))

console.log('\n── ② 품목 카드 포커스 표시 ──')
ok('카드에 이름표', ROW.includes('q-item-card'))
// 2026-11-26 묶음2 D — 연파랑(--color-brand-border)이던 것을 **공용 링**으로 올리고
//   호버도 함께 받게 했다(세 상태에 단계를 두지 않는다).
ok('호버·포커스 테두리 규칙', /\.q-item-card:hover,\s*\n\.q-item-card:focus-within\s*\{[^}]*--color-brand\)/.test(CSS))
// 2026-11-25 실측 — 테두리를 줄 쪽 style 에 두면 인라인이 CSS 를 이겨 색이 바뀌지 않았다.
ok('테두리는 CSS 가 그린다(인라인이 이기지 못하게)',
  /\.q-item-card\s*\{[^}]*border: 1px solid/.test(CSS) && !/border: '1px solid #e5e7eb'/.test(ROW))
ok('테두리색이 부드럽게 바뀐다', /\.q-item-card\s*\{[^}]*transition: border-color 0\.15s ease/.test(CSS))

console.log('\n── ③ 확정 뒤 메일 ──')
const PARTS = {
  quoteNo: 'Q-2026-0001', toEmail: 'a@b.co.kr', toName: '홍길동', toPosition: '과장',
  company: '가나정밀', firstItem: 'AFC-1000', fromName: '김기사',
}
// 2026-11-25 지시 — 제목은 「{회사명}_{첫 품목}_견적서 송부의 건」, 본문은 비운다.
eq('제목', M.mailSubject(PARTS), '가나정밀_AFC-1000_견적서 송부의 건')
eq('보기 그대로',
  M.mailSubject({ quoteNo: 'Q-1', company: '협진정공', firstItem: '스타일러스' }),
  '협진정공_스타일러스_견적서 송부의 건')
eq('품목이 없으면 회사명만', M.mailSubject({ quoteNo: 'Q-1', company: '협진정공' }),
  '협진정공_견적서 송부의 건')
eq('회사명까지 없으면 꼬리만', M.mailSubject({ quoteNo: 'Q-1' }), '견적서 송부의 건')
ok('제목에 견적 번호는 넣지 않는다 — 첨부한 PDF 에 적혀 있다',
  !M.mailSubject(PARTS).includes('Q-2026-0001'))
eq('본문은 비운다', M.mailBody(PARTS), '')
const URL = M.mailtoUrl(PARTS)
ok('mailto 로 연다', URL.startsWith('mailto:a%40b.co.kr?'))
ok('제목을 감싼다', URL.includes(`subject=${encodeURIComponent(M.mailSubject(PARTS))}`))
ok('body 파라미터 자체를 넣지 않는다', !/[?&]body=/.test(URL))
eq('창 제목', M.savedTitle('Q-2026-0001'), '견적서 Q-2026-0001 저장됨')
ok('첨부는 사람이 한다고 적는다', M.ATTACH_NOTICE.includes('끌어다 첨부'))
ok('버튼 아이콘은 이모지가 아니라 인라인 SVG',
  /MAIL_ICON/.test(SAVED) && /<svg /.test(SAVED)
  && !/[\u{1F300}-\u{1FAFF}\u{2700}-\u{27BF}\u{2600}-\u{26FF}]/u.test(SAVED),
  '이모지가 남아 있다')

console.log('\n── ④ 이메일이 없으면 ──')
eq('주소가 없으면 mailto 도 없다', M.mailtoUrl({ quoteNo: 'Q-1' }), null)
eq('빈 글자도 없는 것이다', M.mailtoUrl({ quoteNo: 'Q-1', toEmail: '  ' }), null)
eq('그 자리의 안내', M.NO_EMAIL_NOTICE, '수신인에 이메일이 없습니다 — 담당자 정보에서 추가')
ok('창이 그 안내를 띄운다', SAVED.includes('NO_EMAIL_NOTICE'))
ok('주소가 없으면 버튼을 내지 않는다', /\{href && \(/.test(SAVED))
ok('주소는 눌러서 바로 보낼 수 있다', SAVED.includes('href={`mailto:${email}`}'))

console.log('\n── 확정 흐름에 붙어 있다 ──')
ok('번호를 받은 뒤 알린다', SUBMIT.includes('onSaved?.(result.quoteNo)'))
ok('화면을 비우기 **전에** 알린다',
  SUBMIT.indexOf('onSaved?.(result.quoteNo)') < SUBMIT.indexOf('resetForm()'))
ok('화면이 그 창을 띄운다', PAGE.includes('<QuoteSavedModal') && PAGE.includes('savedMail'))
ok('수신인·회사·첫 품목·작성자를 담아 넘긴다',
  PAGE.includes('toEmail: selectedContact?.email') && PAGE.includes('fromName: engineerName'))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
