// **자잘한 손질 묶음** (2026-11-25) — 줄 호버 한 곳 · 되돌린 견적의 날짜 ·
// 접촉보고서 문구 · 이어 읽기 · 이메일 없을 때의 길.
//
//   node scripts/small-fixes-check.js
//
// 지키는 약속
//   ① 표의 줄 호버는 **한 곳**에서 온다 — 고객사 목록과 명함 목록이 같은 클래스를 쓴다.
//   ② D-day·포캐스트 달이 coalesce(revived_at, quote_date) 를 본다(칸이 없으면 빼고 읽는다).
//   ③ 접촉보고서의 **긴 글 칸 전부**에 「문구 ▾」가 선다.
//   ④ 검토 화면의 「다음 N쪽 읽기」가 올린 파일을 그대로 이어 읽는다(다시 올리지 않는다).
//   ⑤ 수신인 이메일이 없으면 **그 담당자 수정 창**으로 가는 링크가 뜬다.
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

const M = load(path.join(ROOT, 'lib/quoteMail.ts'))
const V = load(path.join(ROOT, 'lib/cardReview.ts'))

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

const CSS = read('app/globals.css')
const PANE = read('components/home/list/CompanyPane.tsx')
const CARDS = read('app/cards/page.tsx')
const DASH = read('hooks/dashboard/useDashboard80.ts')
const FC = read('lib/forecast.ts')
const FCD = read('lib/forecastData.ts')
const REPORT = read('app/contact/semi/[projectId]/write/page.tsx')
const MODAL = read('components/cards/BulkImportModal.tsx')
const REVIEW = read('app/cards/import/page.tsx')
const SESSION = read('lib/cardImportSession.ts')
const SAVED = read('components/quote/QuoteSavedModal.tsx')
const DETAIL = read('components/customer/CustomerDetailBody.tsx')
const SITE_PAGE = read('app/customer/[id]/page.tsx')

console.log('── ① 줄 호버는 한 곳에서 ──')
ok('공용 클래스가 바탕을 그린다',
  /\.ems-row-hover:hover > td,\s*\n\.ems-row-hover\.on > td \{\s*\n\s*background: var\(--row-hover-bg\);/.test(CSS))
// 값은 **고객사 목록이 쓰던 그 색**이어야 한다 — 색을 여기 적지 않고 두 자리를 견준다
// (하네스가 색을 들고 있으면 세는 수가 또 는다 — scripts/color-token-check.js).
const rawHoverBg = /--row-hover-bg:\s*([^;]+);/.exec(CSS)?.[1]?.trim()
/** var(--x) 면 그 토큰의 값으로 푼다 — 값끼리 견주려면 같은 모양이어야 한다. */
const resolveVar = (v) => {
  const m = /^var\((--[\w-]+)\)$/.exec(String(v ?? ''))
  if (!m) return v
  return new RegExp(`${m[1]}:\\s*([^;]+);`).exec(CSS)?.[1]?.trim() ?? v
}
const hoverBg = resolveVar(rawHoverBg)
const paneHover = /\.site-row:hover \.site-edit-cell \{ background: ([^}]+) \}/.exec(PANE)?.[1]?.trim()
ok('공용 바탕값이 있다', !!hoverBg)
eq('그 값 = 고객사 목록이 쓰던 값', hoverBg, paneHover)
ok('구분선 색은 표마다 넘긴다(--row-line)', /--row-line:\s*[^;]+;/.test(CSS)
  && /border-bottom: 1px solid var\(--row-line\);/.test(CSS))
ok('고객사 목록 줄이 그 클래스를 쓴다', /'site-row ems-row-hover ems-row-brand on' : 'site-row ems-row-hover ems-row-brand'/.test(PANE))
ok('고객사 줄의 구분선 값은 그대로 — 그 표의 BORDER 를 넘긴다', /\['--row-line' as string\]: BORDER/.test(PANE))
ok('손으로 칠하던 호버를 걷었다',
  !/onMouseEnter=\{e => \{ if \(!on\) e\.currentTarget\.style\.background/.test(PANE))
ok('명함 목록도 같은 클래스', /className="ems-row-hover"/.test(CARDS))
// 테마 파랑 테두리(inset box-shadow)는 걷었다 — 두 화면이 같은 모양이어야 한다.
ok('줄 호버에 inset box-shadow 를 쓰지 않는다',
  !/\.ems-row-hover:hover > td \{[\s\S]{0,120}inset/.test(CSS))

console.log('\n── ② 되돌린 견적의 날짜 ──')
ok('D-day 가 expiryBase 를 쓴다', /quoteExpiry\(expiryBase\(q\) as string\)/.test(DASH))
ok('D-day 조회가 되돌린 날을 읽는다', /\$\{EXPIRY_COLUMNS\}, revived_at/.test(DASH))
ok('칸이 없으면 빼고 다시 읽는다', /42703/.test(DASH) && /select\(EXPIRY_COLUMNS\)/.test(DASH))
ok('포캐스트 달도 expiryBase', (FC.match(/quoteExpiry\(expiryBase\(q\) \?\? ''\)/g) ?? []).length === 2)
ok('포캐스트 조회가 되돌린 날을 읽는다', /QUOTE_COLUMNS_REVIVE/.test(FCD) && /, revived_at`/.test(FCD))
ok('포캐스트도 칸이 없으면 빼고 읽는다', /42703/.test(FCD) && /sb\.from\('quotes'\)\.select\(QUOTE_COLUMNS\)/.test(FCD))
ok('견적 줄의 타입에 칸이 있다', /revived_at\?: string \| null/.test(FC))

console.log('\n── ③ 접촉보고서 — 긴 글 칸 전부 ──')
ok('긴 글 칸이면 문구를 단다', /const withSnippet = def\.kind === 'longtext'/.test(REPORT))
ok('한 줄짜리 칸에는 달지 않는다', !/def\.kind === 'text'[\s\S]{0,40}withSnippet/.test(REPORT))
ok('공통 용도로 연다', /kind="common"/.test(REPORT))
ok('커서 자리에 끼운다', /insertAtCursor\(bodyRef\.current, text\)/.test(REPORT))
// 그 칸이 몇 개인지 — 적어도 회의 내용·FACT 를 포함한다.
const longFields = (read('lib/semiContact/fields.ts').match(/kind: 'longtext'/g) ?? []).length
ok(`긴 글 칸 ${longFields}개가 그 규칙을 받는다`, longFields >= 5)

console.log('\n── ④ 다음 N쪽 이어 읽기 ──')
eq('남은 쪽이 20보다 적으면 그 수', [V.nextChunkCount(25), V.nextChunkCount(5), V.nextChunkCount(0)], [20, 5, 0])
eq('단추 글자', V.nextChunkLabel(5), '등록하고 다음 5쪽 읽기 →')
eq('묻는 말', V.nextChunkTitle(25), '다음 20쪽을 읽을까요?')
ok('남은 수를 적는다', V.nextChunkMessage(25).includes('남은 쪽은 5쪽입니다'))
ok('세션이 이어 읽기 값을 만든다', /export function resumeFromSession/.test(SESSION)
  && /pageFrom: s\.rest\[0\]\.page/.test(SESSION))
ok('묶음 id 를 그대로 쓴다 — 되돌리기 한 번에 지워진다',
  /batchId: s\.batchId/.test(SESSION) && /useRef\(resume\?\.batchId \?\? newBatchId\(\)\)/.test(MODAL))
ok('창이 열리자마자 읽는다', /void run\(resume\.pieces, resume\.pageFrom, resume\.total\)/.test(MODAL))
ok('두 번 읽지 않는다', /resumed\.current = true/.test(MODAL))
ok('쪽 번호를 이어 센다', /pageBase: pageFrom \+ base/.test(MODAL)
  && /page: pageFrom \+ i/.test(MODAL) && /page: pageFrom \+ batch\.length \+ i/.test(MODAL))
ok('비용도 이어서 센다', /\(resume\?\.usage\.input \?\? 0\) \+ used\.input/.test(MODAL))
ok('검토 화면이 그 길로 보낸다', /router\.push\('\/cards\?resume=1'\)/.test(REVIEW))
ok('세션을 지우지 않고 넘긴다', /세션은 \*\*지우지 않는다\*\*/.test(REVIEW))
ok('목록 화면이 받아 연다', /params\.get\('resume'\) !== '1'/.test(CARDS)
  && /setBulkResume\(next\)/.test(CARDS) && /resume=\{bulkResume\}/.test(CARDS))
ok('주소는 바로 지운다 — 새로고침에 또 열리지 않게', /router\.replace\('\/cards'\)/.test(CARDS))
ok('새로고침해서 파일이 없으면 종전 안내', V.RELOAD_NOTICE.includes('다시 올려 주세요')
  && /RELOAD_NOTICE/.test(REVIEW))

console.log('\n── ⑤ 이메일이 없을 때 ──')
eq('수신인을 알면 그 담당자 수정 창으로',
  M.contactHref({ quoteNo: 'Q-1', customerId: 593, contactId: 1642 }), '/customer/593?contact=1642')
eq('사업장만 알면 사업장 화면으로', M.contactHref({ quoteNo: 'Q-1', customerId: 593 }), '/customer/593')
eq('둘 다 모르면 링크 없음', M.contactHref({ quoteNo: 'Q-1' }), null)
eq('잘못된 id 도 링크 없음', M.contactHref({ quoteNo: 'Q-1', customerId: 0 }), null)
eq('링크가 되는 글자', M.NO_EMAIL_LINK_TEXT, '담당자 정보에서 추가')
ok('안내 글에 그 글자가 들어 있다', M.NO_EMAIL_NOTICE.includes(M.NO_EMAIL_LINK_TEXT))
ok('창이 그 길을 쓴다', /const fixHref = contactHref\(parts\)/.test(SAVED) && /href=\{fixHref\}/.test(SAVED))
ok('링크가 없으면 글자만', /\) : NO_EMAIL_NOTICE\}/.test(SAVED))
ok('견적 화면이 두 id 를 넘긴다',
  /customerId: euCustomerId \?\? customerId,/.test(read('app/quote/page.tsx'))
  && /contactId: selectedContact\?\.contact_id \?\? null,/.test(read('app/quote/page.tsx')))
ok('사업장 화면이 ?contact= 를 받는다', /search\.get\('contact'\)/.test(SITE_PAGE)
  && /openContactId=\{openContactId\}/.test(SITE_PAGE))
ok('Suspense 경계 안에서 읽는다', /<Suspense fallback=\{null\}>/.test(SITE_PAGE))
ok('본문이 그 담당자 창을 연다', /contact\.setSelectedContact\(found\)/.test(DETAIL))
ok('한 번만 연다', /openedContact\.current = true/.test(DETAIL))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
