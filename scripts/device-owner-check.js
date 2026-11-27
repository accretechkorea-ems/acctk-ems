// 「납품 예정」 장비 줄의 **주인** (2026-11-27, 묶음4 G1).
//
//   node scripts/device-owner-check.js
//
//   ① 그 줄을 만든 견적(source_quote_id)의 **작성자**
//   ② 없으면 **그 줄을 만든 사람**(devices.created_by)
//   ③ 둘 다 없으면 **홈 할 일에 띄우지 않는다** — 사업장 화면에만 둔다
//
// 규칙은 순수 함수라 **돌려 본다**. 화면·조회가 그 규칙을 따르는지는 글자로 본다.
// 키 없이 서버 없이 돈다.

const load = module.require.bind(module)
const fs = load('fs')
const path = load('path')
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

const O = load(path.join(ROOT, 'lib/deviceOwner.ts'))
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')

let fails = 0
const ok = (name, good, extra) => {
  if (!good) fails++
  console.log(`${good ? 'OK  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`)
}
const eq = (name, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want)
  if (!good) fails++
  console.log(`${good ? 'OK  ' : 'FAIL'} ${name}`)
  if (!good) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}

console.log('── ① 차례 ──')
eq('견적 작성자가 먼저다', O.deviceOwnerOf({ sourceQuoteEngineerId: 7, createdBy: 9 }), { ownerId: 7, via: 'quote' })
eq('견적이 없으면 만든 사람', O.deviceOwnerOf({ sourceQuoteEngineerId: null, createdBy: 9 }), { ownerId: 9, via: 'created_by' })
eq('둘 다 없으면 주인이 없다', O.deviceOwnerOf({}), { ownerId: null, via: 'none' })
eq('칸이 아직 없는 DB 도 같다(둘 다 undefined)',
  O.deviceOwnerOf({ sourceQuoteEngineerId: undefined, createdBy: undefined }), { ownerId: null, via: 'none' })

console.log('\n── ② 값이 성치 않을 때 ──')
// 0 · 음수 · 글자는 id 가 아니다. 그대로 믿으면 엉뚱한 사람에게 할 일이 붙는다.
eq('0 은 id 가 아니다', O.deviceOwnerOf({ sourceQuoteEngineerId: 0, createdBy: 5 }), { ownerId: 5, via: 'created_by' })
eq('음수도 아니다', O.deviceOwnerOf({ sourceQuoteEngineerId: -3 }), { ownerId: null, via: 'none' })
eq('숫자 글자는 받는다(조회가 글자로 돌려주는 자리가 있다)',
  O.deviceOwnerOf({ createdBy: '12' }), { ownerId: 12, via: 'created_by' })

console.log('\n── ③ 홈 할 일에 서는가 ──')
ok('내 견적에서 생긴 줄은 선다', O.isHomeTaskOf({ sourceQuoteEngineerId: 7 }, 7))
ok('남의 견적에서 생긴 줄은 안 선다', !O.isHomeTaskOf({ sourceQuoteEngineerId: 8 }, 7))
ok('내가 손으로 넣은 줄도 선다', O.isHomeTaskOf({ createdBy: 7 }, 7))
// 지시문이 못 박은 줄 — 주인이 없으면 **아무의 할 일도 아니다**.
ok('주인이 없으면 누구에게도 안 선다', !O.isHomeTaskOf({}, 7))
ok('로그인 전(engineerId 없음)에는 서지 않는다', !O.isHomeTaskOf({ sourceQuoteEngineerId: 7 }, null))
ok('사업장 화면은 주인과 무관하게 전부 보여 준다', O.SHOWS_ON_SITE_ALWAYS === true)

console.log('\n── ④ 홈 조회가 그 규칙대로 읽는다 ──')
const TODAY = read('hooks/dashboard/useToday.ts')
ok('① 내 견적에서 생긴 줄', /\.in\('source_quote_id', ids\)/.test(TODAY))
ok('② 견적 없이 내가 만든 줄', /\.is\('source_quote_id', null\)\.eq\('created_by', engineerId\)/.test(TODAY))
ok('③ 주인 없는 줄은 **조회하지 않는다**', !/created_by.*is.*null/.test(TODAY))
ok('두 갈래를 id 로 합친다(같은 줄이 두 번 서지 않게)', /const byId = new Map<number, PendingRow>\(\)/.test(TODAY))
ok('칸이 아직 없으면 그 갈래만 건너뛴다',
  /MISSING_COLUMN = new Set\(\['42703', 'PGRST204', 'PGRST205'\]\)/.test(TODAY)
  && /if \(!MISSING_COLUMN\.has\(made\.error\.code \?\? ''\)\) throw made\.error/.test(TODAY))

console.log('\n── ⑤ 손으로 넣을 때 만든 사람을 적는다 ──')
const ROUTE = read('app/api/customer-change/route.ts')
ok('장비 등록이 created_by 를 담는다', /created_by: actor/.test(ROUTE))
ok('칸이 없으면 빼고 담는다(등록 자체가 막히지 않게)',
  /DEVICE_NEW: readonly string\[\] = \['master_pending', 'install_due_month', 'created_by'\]/.test(ROUTE)
  && /deviceNewKnown === false \? patch :/.test(ROUTE))

console.log('\n── ⑥ SQL ──')
const SQL = read('db/devices_created_by_20261127.sql')
ok('칸을 더한다(재실행 안전)', /add column if not exists created_by integer references public\.engineers\(engineer_id\)/.test(SQL))
ok('홈이 찾는 자리에 인덱스', /create index if not exists devices_created_by_pending_idx/.test(SQL))
ok('끝에 reload schema', /notify pgrst, 'reload schema';/.test(SQL))
ok('옛 줄은 채우지 않는다 — update 문이 없다', !/^\s*update\s/im.test(SQL))
ok('APPLIED.md 에 줄이 있다', /devices_created_by_20261127\.sql/.test(read('db/APPLIED.md')))

console.log(fails === 0 ? '\n전부 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
