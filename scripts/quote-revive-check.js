// **미수주 견적 되돌리기** — 만료 기준일 · 권한 · 사유 (2026-11-25).
//
//   node scripts/quote-revive-check.js
//
// 지키는 약속
//   ① 만료 기준일 = coalesce(revived_at, quote_date). 되돌린 날부터 다시 1개월이다.
//      그 기간이 또 지나면 다시 실패가 되는 것은 정상이다.
//   ② 단추는 **관리 메뉴를 가진 사람**(+ superadmin)에게만. 일반 사용자에게는 없다.
//   ③ 라우트가 그 문턱을 **다시** 센다(403).
//   ④ 되돌리는 이유는 필수다.
//   ⑤ 사후 실적 입력 줄은 대상이 아니다.
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

const V = load(path.join(ROOT, 'lib/quoteRevive.ts'))
const S = load(path.join(ROOT, 'lib/quoteStatus.ts'))

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
const has = (p) => fs.existsSync(path.join(ROOT, p))

const SQL_PATH = 'db/quote_revive_20261125.sql'
const ROUTE_PATH = 'app/api/quote-revive/route.ts'
const SWEEP_PATH = 'app/api/auto-fail/route.ts'
const MODAL_PATH = 'components/quote/QuoteReviveModal.tsx'
const SALES_PATH = 'app/sales/page.tsx'
const PANEL_PATH = 'components/dashboard/MyQuotesPanel.tsx'

console.log('── ① 만료 기준일 ──')
// 되돌린 날이 없으면 작성일 — 종전과 같다.
eq('되돌리지 않은 건은 작성일', V.expiryBase({ quote_date: '2026-09-20' }), '2026-09-20')
eq('되돌린 건은 되돌린 날',
  V.expiryBase({ quote_date: '2026-09-20', revived_at: '2026-11-25T01:02:03.000Z' }), '2026-11-25')
eq('둘 다 없으면 null', V.expiryBase({}), null)
eq('빈 글자는 없는 것으로 본다', V.expiryBase({ quote_date: '2026-09-20', revived_at: '  ' }), '2026-09-20')
// 2개월 전 견적을 되돌린 바로 그 날 — 다시 실패로 잡히지 않는다(이 회차의 핵심).
ok('두 달 전 견적을 되돌린 날에는 만료가 아니다',
  S.isExpired(V.expiryBase({ quote_date: '2026-09-20', revived_at: '2026-11-25T00:00:00Z' }), '2026-11-25') === false)
ok('되돌리기 전이라면 만료였다',
  S.isExpired(V.expiryBase({ quote_date: '2026-09-20' }), '2026-11-25') === true)
// 되돌린 날부터 **다시 1개월** — 그 기간이 지나면 또 실패다(정상).
ok('되돌린 날 + 1개월 − 1일까지는 산다',
  S.isExpired(V.expiryBase({ quote_date: '2026-09-20', revived_at: '2026-11-25T00:00:00Z' }), '2026-12-24') === false)
ok('그 뒤에는 다시 만료다',
  S.isExpired(V.expiryBase({ quote_date: '2026-09-20', revived_at: '2026-11-25T00:00:00Z' }), '2026-12-25') === true)
eq('기간 상수는 그대로 — 작성일 + 1개월 − 1일', S.quoteExpiry('2026-11-25'), '2026-12-24')

console.log('\n── 자동 실주가 그 기준을 쓴다 ──')
const SWEEP = read(SWEEP_PATH)
ok('기준일을 expiryBase 로 센다', /isExpired\(expiryBase\(q\), today\)/.test(SWEEP))
ok('되돌린 날을 함께 읽는다', /quote_id, quote_date, revived_at/.test(SWEEP))
ok('칸이 없으면 빼고 다시 읽는다 — 그래도 돈다',
  /42703/.test(SWEEP) && /await read\(false\)/.test(SWEEP))
ok('대상은 견적중뿐', /\.eq\('status', PENDING_STATUS\)/.test(SWEEP))
ok('그사이 상태가 바뀌면 건드리지 않는다', /\.eq\('status', PENDING_STATUS\)[\s\S]{0,200}\.select\('quote_id'\)/.test(SWEEP))

console.log('\n── ② 단추의 권한 분기 ──')
const admin = { permission_level: 'member', perm: { menus: new Set(['admin']) } }
const sales = { permission_level: 'member', perm: { menus: new Set(['sales']) } }
const sa = { permission_level: 'superadmin', perm: { menus: new Set() } }
const failed = { quote_id: 1, status: '실패', fail_reason: '유효기간 만료' }
eq('관리 메뉴가 있으면 보인다', V.canReviveQuote(admin, failed), true)
eq('superadmin 은 늘 보인다', V.canReviveQuote(sa, failed), true)
eq('일반 사용자에게는 없다', V.canReviveQuote({ permission_level: 'member', perm: { menus: new Set() } }, failed), false)
// 영역 판정(canViewAdmin)은 영업 메뉴로도 열려 이 자리에는 넓다 — 메뉴 권한으로 가른다.
eq('영업 메뉴만 있으면 없다', V.canReviveQuote(sales, failed), false)
eq('사람이 없으면 없다', V.canReviveQuote(null, failed), false)
eq('실패가 아닌 건에는 없다', [
  V.canReviveQuote(admin, { status: '견적중' }),
  V.canReviveQuote(admin, { status: '매출완료' }),
  V.canReviveQuote(admin, { status: '취소요청' }),
], [false, false, false])
// 사유가 무엇이든 — 손으로 실패시킨 건도, 자동 실주도 되돌린다.
eq('미수주 사유는 무엇이든 된다', [
  V.canReviveQuote(admin, { status: '실패', fail_reason: '유효기간 만료' }),
  V.canReviveQuote(admin, { status: '실패', fail_reason: '경쟁사 수주' }),
  V.canReviveQuote(admin, { status: '실패', fail_reason: null }),
], [true, true, true])

console.log('\n── ⑤ 사후 실적 입력은 대상이 아니다 ──')
eq('사후 입력 줄에는 단추가 없다',
  V.canReviveQuote(admin, { status: '실패', fail_reason: '유효기간 만료', backfilled_at: '2026-11-23T00:00:00Z' }),
  false)
ok('그 까닭을 글로 적어 두었다', V.BACKFILL_BLOCKED.includes('사후 실적'))

console.log('\n── ④ 사유는 필수 ──')
eq('비면 못 보낸다', V.reviveBlockedReason(''), '되돌리는 이유를 입력해주세요')
eq('공백만도 못 보낸다', V.reviveBlockedReason('   '), '되돌리는 이유를 입력해주세요')
eq('적으면 통과', V.reviveBlockedReason('발주서 등록 누락'), null)
ok('너무 길면 막는다', typeof V.reviveBlockedReason('가'.repeat(V.REASON_MAX + 1)) === 'string')
const MODAL = read(MODAL_PATH)
ok('창이 그 판정을 쓴다', /reviveBlockedReason\(reason\)/.test(MODAL))
ok('사유를 적기 전에는 단추가 막힌다', /disabled=\{blocked != null \|\| busy\}/.test(MODAL))
ok('번호·회사·실패 사유를 보여 준다',
  /quote\.quote_number/.test(MODAL) && /quote\.company/.test(MODAL) && /미수주 사유/.test(MODAL))
ok('ModalCard 를 쓴다', /<ModalCard/.test(MODAL))
ok('무엇이 바뀌는지 먼저 적는다',
  V.REVIVE_NOTICE.includes('견적중') && V.REVIVE_NOTICE.includes('되돌린 날'))

console.log('\n── ③ 라우트가 다시 센다 ──')
ok('라우트가 있다', has(ROUTE_PATH))
const R = has(ROUTE_PATH) ? read(ROUTE_PATH) : ''
ok('POST 다', /export async function POST\(/.test(R))
ok('관리 메뉴를 요구한다', /loadCaller\(\s*\{ kind: 'menu', keys: \['admin'\] \}/.test(R))
ok('화면이 보낸 상태를 믿지 않는다 — 지금 값을 다시 읽는다',
  /\.from\('quotes'\)[\s\S]{0,200}\.eq\('quote_id', quoteId\)/.test(R))
ok('같은 함수로 판정한다', /if \(!canReviveQuote\(caller, quote\)\)/.test(R))
ok('권한이면 403', /status: 403/.test(R))
ok('사유를 서버에서도 본다', /reviveBlockedReason\(reason\)/.test(R))
ok('견적중으로 바꾸고 사유를 지운다',
  /status: REVIVED_STATUS/.test(R) && /fail_reason: null/.test(R))
eq('되돌린 뒤 상태', V.REVIVED_STATUS, '견적중')
ok('되돌린 날·사람·까닭을 적는다',
  /revived_at: now/.test(R) && /revived_by: caller\.engineer_id/.test(R) && /revive_reason: reason/.test(R))
ok('그사이 상태가 바뀌면 쓰지 않는다', /\.eq\('status', FAIL_STATUS\)/.test(R))
ok('칸이 없으면 아무것도 쓰지 않고 안내한다',
  /SCHEMA_MESSAGE/.test(R) && V.SCHEMA_MESSAGE.includes('db/quote_revive_20261125.sql'))

console.log('\n── 사건 대신 note 한 줄 ──')
// 견적 사건 표가 없다 — 되돌린 자국을 사람이 읽는 칸에도 남긴다.
eq('견적 사건 표는 없다', fs.readdirSync(path.join(ROOT, 'db')).filter(f => /quote_events/.test(f)), [])
eq('note 한 줄', V.reviveNoteLine('2026-11-25T05:00:00Z', '권재원', '발주서 등록 누락'),
  '[되돌림 26-11-25 권재원: 발주서 등록 누락]')
eq('이름이 없어도 선다', V.reviveNoteLine('2026-11-25T05:00:00Z', null, '사유'), '[되돌림 26-11-25: 사유]')
eq('기존 글 뒤에 붙인다', V.appendNote('앞의 메모', '[되돌림]'), '앞의 메모\n[되돌림]')
eq('비어 있으면 그 줄만', V.appendNote(null, '[되돌림]'), '[되돌림]')
ok('라우트가 그 줄을 쓴다', /note: appendNote\(quote\.note, reviveNoteLine\(now, caller\.name, reason\)\)/.test(R))

console.log('\n── 뱃지 ──')
eq('되돌린 건인가', [
  V.isRevived({ revived_at: '2026-11-25T00:00:00Z' }), V.isRevived({}), V.isRevived({ revived_at: null }),
], [true, false, false])
eq('뱃지 글자', V.reviveBadge({ revived_at: '2026-11-25T05:00:00Z' }), '되돌림 26-11-25')
eq('아니면 빈 글자', V.reviveBadge({ quote_date: '2026-11-01' }), '')

console.log('\n── 붙인 자리 ──')
const SALES = read(SALES_PATH)
const PANEL = read(PANEL_PATH)
for (const [name, src] of [['영업 현황 견적 목록', SALES], ['내 견적 패널', PANEL]]) {
  ok(`${name} — 권한이 있을 때만 단추`, /canReviveQuote\(me, editQuote\)/.test(src))
  ok(`${name} — 창을 띄운다`, /<QuoteReviveModal/.test(src))
  ok(`${name} — 라우트를 부른다`, /'\/api\/quote-revive'/.test(src))
  ok(`${name} — 되돌림 뱃지`, /reviveBadge\(q\)/.test(src))
}
ok('내 견적 패널의 만료 표시도 그 기준', /isExpired\(expiryBase\(q\), today\)/.test(PANEL))
ok('패널이 되돌린 날을 함께 읽는다 — 칸이 없으면 빼고 읽는다',
  /revived_at, backfilled_at/.test(PANEL) && /42703/.test(PANEL))
ok('기존 되돌리기(수동 실패)는 그대로 둔다 — 지우지 않았다',
  /editStatusesFor/.test(SALES) && /REVERT_NOTICE/.test(SALES))

console.log('\n── SQL ──')
ok('SQL 파일이 있다', has(SQL_PATH))
const SQL = has(SQL_PATH) ? read(SQL_PATH) : ''
ok('칸 셋을 더한다',
  /add column if not exists revived_at\s+timestamptz/.test(SQL)
  && /add column if not exists revived_by\s+integer references public\.engineers\(engineer_id\)/.test(SQL)
  && /add column if not exists revive_reason text/.test(SQL))
ok('스키마를 깨운다', /notify pgrst, 'reload schema'/.test(SQL))
ok('재실행 안전', /add column if not exists/.test(SQL))
ok('APPLIED.md 에 미적용으로 적었다',
  /quote_revive_20261125\.sql[^|]*\|\s*\*\*미적용\*\*/.test(read('db/APPLIED.md')))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
