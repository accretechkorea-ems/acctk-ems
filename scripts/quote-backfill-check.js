// 사후 실적 입력 — **EMS 밖에서 끝난 건을 손으로 담는다** (2026-11-23).
//
//   node scripts/quote-backfill-check.js
//
// 지키는 약속
//   ① 담는 일은 슈퍼관리자만. 남의 실적을 만드는 일이다.
//   ② 필수 칸이 하나라도 비면 담기지 않는다 — 못 누르는 까닭을 **한 번에 하나만** 말한다.
//   ③ 상태를 고르면 **그 상태가 쓰는 날짜**를 받는다. 그 칸이 비면 집계에 잡히지 않는다.
//   ④ 금액은 통화·환율을 거쳐 원화로 담긴다.
//   ⑤ 담긴 줄은 실적 집계에 **그대로 잡힌다**(lib/salesStats.ts 와 같은 규칙).
//   ⑥ 담긴 줄은 「사후 입력」으로 보인다.
//   ⑦ 칸이 없는 DB 에서는 503 으로 무엇을 돌릴지 말해 준다.

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

const B = load(path.join(ROOT, 'lib/quoteBackfill.ts'))
const S = load(path.join(ROOT, 'lib/salesStats.ts'))

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

const ROUTE = read('app/api/quote-backfill/route.ts')
const MODAL = read('components/sales/BackfillModal.tsx')
const PAGE = read('app/sales/page.tsx')
// 2026-11-26 — 단추가 **홈 「내 견적」 카드 머리로 옮겨갔다**(지시 F6). 창·검사·라우트는
// 그대로고, 누르는 자리만 바뀌었다. 뱃지·목록은 여전히 실적 현황(PAGE)이 보여 준다.
const HOME = read('app/dashboard/page.tsx')
const BTN = read('components/dashboard/BackfillButton.tsx')

console.log('\n── ① 문턱 ──')
ok('라우트는 슈퍼관리자만', /loadCaller\(\{ kind: 'superadmin' \}, \{ tag: TAG, method: 'POST' \}\)/.test(ROUTE))
ok('화면도 슈퍼관리자에게만 버튼을 낸다', /headerRight=\{isSuperAdmin\(me\) \? <BackfillButton/.test(HOME))
ok('그 자리는 홈 「내 견적」 카드 머리다', /<MyQuoteCard[\s\S]{0,900}<BackfillButton/.test(HOME))
ok('실적 현황에는 더 이상 없다', !/\+ 사후 실적/.test(PAGE) && !/<BackfillModal/.test(PAGE))
ok('창은 **같은 창**이다', /from '@\/components\/sales\/BackfillModal'/.test(BTN))
ok('재직자는 누를 때 비로소 읽는다', /누를 때 비로소 재직자를 읽는다/.test(BTN))
ok('적은 사람은 세션에서 넣는다(화면이 보낸 값을 믿지 않는다)',
  /backfilled_by: caller\.engineer_id/.test(ROUTE) && !/backfilled_by: form\./.test(ROUTE))
ok('담당자는 화면이 고른 사람이다', /engineer_id: owner\.engineer_id/.test(ROUTE))

console.log('\n── ② 필수 칸 — 한 번에 하나만 ──')
const full = {
  customerId: 853, formKind: 'parts80', engineerId: 7, status: '수주',
  quoteDate: '2026-11-23', statusDate: '2026-11-20', amount: 1000, currency: 'KRW',
  exchangeRate: 0, quoteNumber: '', autoNumber: true, hasPdf: true, note: '',
}
eq('다 채우면 막지 않는다', B.backfillBlockedReason(full), null)
eq('사업장', B.backfillBlockedReason({ ...full, customerId: null }), '사업장을 골라주세요')
eq('양식', B.backfillBlockedReason({ ...full, formKind: '' }), '양식을 골라주세요')
eq('담당자', B.backfillBlockedReason({ ...full, engineerId: null }), '담당자를 골라주세요')
eq('상태', B.backfillBlockedReason({ ...full, status: '' }), '상태를 골라주세요')
eq('견적일', B.backfillBlockedReason({ ...full, quoteDate: '' }), '견적일을 적어주세요')
eq('상태가 쓰는 날짜', B.backfillBlockedReason({ ...full, statusDate: '' }), '발주일을 적어주세요')
eq('매출완료면 다른 날짜를 묻는다',
  B.backfillBlockedReason({ ...full, status: '매출완료', statusDate: '' }), '세금계산서 완료일을 적어주세요')
eq('견적중은 그 날짜를 묻지 않는다',
  B.backfillBlockedReason({ ...full, status: '견적중', statusDate: '' }), null)
eq('금액', B.backfillBlockedReason({ ...full, amount: 0 }), '금액을 적어주세요')
eq('환율 — 원화가 아니면 받는다',
  B.backfillBlockedReason({ ...full, currency: 'JPY', exchangeRate: 0 }), '환율을 적어주세요')
eq('환율 — 원화면 묻지 않는다', B.backfillBlockedReason({ ...full, currency: 'KRW', exchangeRate: 0 }), null)
eq('견적번호 — 자동이 아니면 받는다',
  B.backfillBlockedReason({ ...full, autoNumber: false, quoteNumber: '  ' }), '견적번호를 적거나 자동으로 받으세요')
eq('PDF 는 필수다', B.backfillBlockedReason({ ...full, hasPdf: false }), 'PDF 를 첨부해주세요')
eq('비고 길이', B.backfillBlockedReason({ ...full, note: '가'.repeat(B.NOTE_MAX + 1) }),
  `비고는 ${B.NOTE_MAX}자까지 적을 수 있습니다`)
ok('라우트도 같은 함수로 막는다', /backfillBlockedReason\(\{ \.\.\.form, hasPdf \}\)/.test(ROUTE))
ok('PDF 는 **실제로 온 파일**을 본다', /const hasPdf = pdf instanceof File && pdf\.size > 0/.test(ROUTE))

console.log('\n── ③ 상태가 쓰는 날짜 ──')
eq('수주 → 발주일', [B.statusDateField('수주'), B.statusDateLabel('수주')], ['purchase_order_at', '발주일'])
eq('매출완료 → 세금계산서 완료일',
  [B.statusDateField('매출완료'), B.statusDateLabel('매출완료')], ['tax_invoice_completed_at', '세금계산서 완료일'])
eq('견적중 → 없음', [B.statusDateField('견적중'), B.statusDateLabel('견적중')], [null, null])
eq('고를 수 있는 상태 셋', [...B.BACKFILL_STATUSES], ['견적중', '수주', '매출완료'])
ok('라우트가 그 칸에 담는다', /if \(dateField\) row\[dateField\] = form\.statusDate/.test(ROUTE))

console.log('\n── ④ 금액 ──')
eq('원화는 그대로', B.amountKrw(1500000, 'KRW', 0), 1500000)
eq('엔화는 환율을 곱한다', B.amountKrw(100000, 'JPY', 9.3), 930000)
eq('달러도 같다', B.amountKrw(1200, 'USD', 1380), 1656000)
eq('환율이 없으면 0(막힌다)', B.amountKrw(100000, 'JPY', 0), 0)
eq('금액이 0이면 0', B.amountKrw(0, 'KRW', 0), 0)
ok('라우트가 원화로 담는다', /const supply = amountKrw\(form\.amount, form\.currency, form\.exchangeRate\)/.test(ROUTE))
ok('통화·환율은 품목 줄에 남는다',
  /from\('quote_items'\)\.insert\(\{[\s\S]{0,300}currency: form\.currency[\s\S]{0,120}exchange_rate/.test(ROUTE))

console.log('\n── ⑤ 담긴 줄이 집계에 잡힌다 ──')
// 라우트가 담는 모양 그대로 만들어, 실적 모듈이 그것을 세는지 본다.
const fy = 2026
const made = (over) => ({
  engineer_id: 7, quote_date: '2026-11-23', status: '수주', total_supply: 1000000,
  purchase_order_at: '2026-11-20', tax_invoice_completed_at: null, ...over,
})
ok('수주로 잡힌다', S.inOrderPeriod(made(), fy, 'year', 11))
ok('발주일이 비면 안 잡힌다', S.inOrderPeriod(made({ purchase_order_at: null }), fy, 'year', 11) === false)
ok('매출로 잡힌다',
  S.inRevenuePeriod(made({ status: '매출완료', tax_invoice_completed_at: '2026-11-21' }), fy, 'year', 11))
ok('매출완료가 아니면 매출이 아니다',
  S.inRevenuePeriod(made({ tax_invoice_completed_at: '2026-11-21' }), fy, 'year', 11) === false)
const stat = S.engineerStat([made()], [], { engineerId: 7, fy, mode: 'year', month: 11 })
eq('한 사람 몫에 금액이 더해진다', stat.orderedAmt, 1000000)
eq('견적 제출에도 잡힌다(견적일이 있으므로)', stat.quotedAmt, 1000000)

console.log('\n── ⑥ 번호와 뱃지 ──')
eq('자동 번호 — create_quote 와 같은 글자', B.quoteNumberOf('jwk', '20261123', 1), 'No.JWK20261123-A')
eq('26을 넘으면 두 글자', B.quoteNumberOf('ZZ', '20261123', 27), 'No.ZZ20261123-AA')
eq('날짜 꼴 바꾸기', [B.ymdCompact('2026-11-23'), B.ymdCompact('2026/11/23')], ['20261123', ''])
ok('순번은 DB 가 센다', /rpc\('next_quote_seq'/.test(ROUTE))
eq('뱃지 글자', B.BACKFILL_BADGE, '사후 입력')
eq('자국이 있으면 사후 입력', [
  B.isBackfilled({ backfilled_at: '2026-11-23T00:00:00Z' }),
  B.isBackfilled({ backfilled_at: null }),
  B.isBackfilled({}),
  B.isBackfilled(null),
], [true, false, false, false])
ok('목록이 뱃지를 띄운다', PAGE.includes('isBackfilled(q)') && PAGE.includes('BACKFILL_BADGE'))

console.log('\n── ⑦ 칸이 없는 DB ──')
eq('42703·PGRST204 를 그 뜻으로 읽는다', [
  B.isMissingBackfillColumn({ code: '42703' }),
  B.isMissingBackfillColumn({ code: 'PGRST204' }),
  B.isMissingBackfillColumn({ code: '42501', message: 'permission denied' }),
  B.isMissingBackfillColumn(null),
], [true, true, false, false])
ok('503 과 파일 이름', /status: 503/.test(ROUTE) && B.BACKFILL_SCHEMA_MESSAGE.includes('db/quote_backfill_20261123.sql'))
const SQL = read('db/quote_backfill_20261123.sql')
ok('SQL 은 칸만 더한다', /add column if not exists backfilled_at/.test(SQL) && !/^\s*drop /im.test(SQL))
ok('스키마를 다시 읽힌다', /notify pgrst, 'reload schema'/.test(SQL))

console.log('\n── ⑧ 창 ──')
ok('회사→사업장은 의뢰서와 같은 부품', MODAL.includes("from '@/components/inquiry/SitePicker'"))
ok('막는 까닭을 적어 둔다', /\{blocked && <div/.test(MODAL))
ok('원화 환산 금액을 미리 보여 준다', /실적에 들어가는 금액/.test(MODAL))
ok('PDF 는 pdf 만 받는다', /accept="application\/pdf"/.test(MODAL))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
