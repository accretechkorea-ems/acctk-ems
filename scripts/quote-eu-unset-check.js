// 사명(E.U)이 비어 있는 견적을 화면이 **글자로** 알리는지 본다 (2026-11-28, 야간4 8-2).
//
//   node scripts/quote-eu-unset-check.js
//
// 하나무역 5건은 사명 칸에 대리점 자신이 들어가 있었다. 바로잡으면 사명이 한동안 비어
// 있게 되는데(E.U 는 Kevin 이 나중에 채운다), 그 동안 표가 `-` 만 찍으면
// **「아직 안 적었다」와 「내가 못 보는 사명」이 같아 보인다**. 뒤쪽은 고객사 열람 권한이
// 없을 때 나는 모습이라 사람이 할 일이 없고, 앞쪽은 고치라는 표시다.
//
// 근거: docs/hanamuyeok-quotes-20261128.md · db/hanamuyeok_quotes_move_20261128.sql
//
// 키도 서버도 없이 돈다 — 순수 함수를 그대로 돌리고 나머지는 글자 검사다.

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

const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')
/** 주석을 뺀 코드만 — 「이 글자가 없어야 한다」 류가 제 주석에 걸리지 않게. */
const code = s => s.split(/\r?\n/).filter(l => {
  const t = l.trim()
  return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
}).join('\n')

const fails = []
let total = 0
const ok = (name, cond) => { total += 1; if (!cond) fails.push(name) }

// ── ① 글자와 함수가 한 곳에 있다 ──────────────────────────────────────────
const { EU_UNSET_LABEL, quoteCustomerLabel } = load(path.join(ROOT, 'lib/quoteEuName.ts'))
ok('EU_UNSET_LABEL 은 「E.U 미지정」', EU_UNSET_LABEL === 'E.U 미지정')
ok('quoteCustomerLabel 이 있다', typeof quoteCustomerLabel === 'function')

// 세 갈래가 다 달라야 뜻이 있다.
ok('사명 id 가 없으면 「E.U 미지정」', quoteCustomerLabel(null, null) === EU_UNSET_LABEL)
ok('사명 id 가 없으면 이름이 있어도 「E.U 미지정」', quoteCustomerLabel(undefined, '하나무역') === EU_UNSET_LABEL)
ok('id 는 있고 이름이 없으면 `-`', quoteCustomerLabel(1767, null) === '-')
ok('id 는 있고 이름이 공백뿐이면 `-`', quoteCustomerLabel(1767, '   ') === '-')
ok('이름이 있으면 그 이름', quoteCustomerLabel(776, '가레트모션코리아') === '가레트모션코리아')
ok('fallback 을 건네면 그것을 쓴다', quoteCustomerLabel(776, '', '') === '')

// ── ② 견적 사명을 찍는 **세 표**가 그 함수를 쓴다 ─────────────────────────
for (const [name, file] of [
  ['내 견적', 'components/dashboard/MyQuotesPanel.tsx'],
  ['실적 견적 표', 'app/sales/page.tsx'],
  ['칸반 견적 단독 줄', 'app/pipeline/page.tsx'],
]) {
  const s = read(file)
  ok(`${name} 이 quoteCustomerLabel 을 가져온다`, /import \{ quoteCustomerLabel \} from '@\/lib\/quoteEuName'/.test(s))
  ok(`${name} 이 quoteCustomerLabel 로 사명을 적는다`, /quoteCustomerLabel\(q\.customer_id/.test(code(s)))
}

// 옛 모습이 남아 있지 않다 — `-` 하나로 두 뜻을 덮던 줄.
ok('내 견적에 옛 사명 폴백 줄이 남아 있지 않다',
  !/company_name: \(q\.customer_id != null && custMap\[q\.customer_id\]\) \|\| '-'/.test(read('components/dashboard/MyQuotesPanel.tsx')))
ok('실적 표에 옛 사명 폴백이 남아 있지 않다',
  !/\{q\.customers\?\.company_name \|\| '-'\}/.test(read('app/sales/page.tsx')))

// ── ③ 칸반이 사명 id 를 **읽어 온다** ─────────────────────────────────────
//   읽지 않으면 q.customer_id 가 늘 undefined 라, 사명이 있는 건까지 「E.U 미지정」이 된다.
const PIPE = read('app/pipeline/page.tsx')
const sel = PIPE.slice(PIPE.indexOf('const { data: loose'))
ok('칸반의 견적 조회가 customer_id 를 함께 읽는다', /opportunity_id, customer_id, customers\(/.test(sel.slice(0, 800)))
ok('칸반의 LooseQuote 가 customer_id 를 받는다', /customer_id\?: number \| null/.test(sel.slice(0, 2500)))

// ── ④ 사명 없는 견적을 **고칠 수 있는** 길이 막혀 있지 않다 ───────────────
//   견적 수정 모달은 대리점 건을 mainId = dealer_id · euId = customer_id 로 읽는다.
//   그 두 줄이 바뀌면 사명 NULL 건을 열었을 때 대리점 칸이 비고 길이 끊긴다.
const PRE = code(read('hooks/quote/useQuotePrefill.ts'))
ok('수정 모달이 대리점 건의 사명 칸을 dealer_id 로 세운다', /const mainId = dealer \? quote\.dealer_id : quote\.customer_id/.test(PRE))
ok('수정 모달이 E.U 칸을 customer_id 로 세운다', /const euId = dealer \? quote\.customer_id : null/.test(PRE))

// ── ⑤ 바꾸는 일은 **SQL 한 파일**에만 있다 ────────────────────────────────
const SQL = read('db/hanamuyeok_quotes_move_20261128.sql')
ok('SQL 머리에 0단계 조회가 먼저 온다', SQL.indexOf('[0' + '단계]') < SQL.indexOf('begin;'))
ok('SQL 이 트랜잭션이다', /\bbegin;/.test(SQL) && /\bcommit;/.test(SQL))
ok('SQL 이 **5건만** 고른다(대리점이 빈 줄만)', /where customer_id = 1767\r?\n\s*and dealer_id is null/.test(SQL))
ok('SQL 이 사건을 남긴다', /insert into customer_events/.test(SQL) && /quote_dealer_moved/.test(SQL))
ok('SQL 의 2574 삭제는 주석이다', /^-- update customers$/m.test(SQL))
ok('SQL 이 9건을 건드리지 않는다', !/update quotes[\s\S]{0,400}dealer_id = 1767\s*$/m.test(SQL))
ok('폐기한 묶음5 파일에 「사용 안 함」 머리말이 있다', read('db/hanamuyeok_merge_20261127.sql').slice(0, 400).includes('사용 안 함'))

if (fails.length > 0) {
  console.error('실패:')
  for (const f of fails) console.error('  · ' + f)
  process.exit(1)
}
console.log(`통과 — 견적 사명 빈 칸 표기(검사 ${total}개 · 실패 0)`)
