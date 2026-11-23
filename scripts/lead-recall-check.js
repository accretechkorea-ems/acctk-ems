// 리드 **회수** — 번호를 반납하고 다음 리드가 그 번호를 받는다 (2026-11-23).
//
//   node scripts/lead-recall-check.js
//
// 지키는 약속
//   ① 회수는 **지우기가 아니다** — 행과 내용은 남고 번호만 반납한다.
//   ② 다음 번호는 그 해 **반납 목록의 가장 작은 번호**부터. 없으면 max+1.
//      **그냥 비어 있는 번호는 건드리지 않는다**(쓴 적도 반납한 적도 없는 자리).
//   ③ 되돌리기는 그 번호가 **아직 비어 있을 때만**.
//   ④ 배정불가·미진행은 상태일 뿐 번호를 쓴다 — 회수와 다르다.
//   ⑤ 문턱은 슈퍼관리자. 하드 삭제 코드는 남아 있지 않다.

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

const R = load(path.join(ROOT, 'lib/leadRecall.ts'))
const { LEAD_STATUSES, LEAD_STATUS_BLOCKED } = load(path.join(ROOT, 'lib/leadOptions.ts'))

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

const P = 'LD-26-'
const lead = (over) => ({ lead_id: 1, lead_no: 'LD-26-027', recalled_no: null, status: '신규', ...over })

console.log('\n── ① 회수된 줄인가 ──')
ok('번호를 반납했으면 회수', R.isRecalled(lead({ lead_no: null, recalled_no: 'LD-26-027' })))
ok('번호가 있으면 아니다', R.isRecalled(lead()) === false)
ok('번호도 원래 번호도 없으면 아니다(발급 실패한 줄)', R.isRecalled(lead({ lead_no: null })) === false)
ok('배정불가는 회수가 아니다 — 번호를 그대로 쓴다',
  R.isRecalled(lead({ status: LEAD_STATUS_BLOCKED })) === false)
ok('상태 목록에 「회수」는 없다(상태가 아니라 번호 반납이다)', !LEAD_STATUSES.includes('회수'))

console.log('\n── ② 다음 번호 ──')
eq('반납이 없으면 max + 1', R.nextLeadNo(P, ['LD-26-001', 'LD-26-027'], []), 'LD-26-028')
eq('반납이 있으면 가장 작은 것부터', R.nextLeadNo(P, ['LD-26-001', 'LD-26-027'], ['LD-26-020', 'LD-26-005']), 'LD-26-005')
eq('그냥 빈 번호는 건드리지 않는다(002~026 이 비어도 028)',
  R.nextLeadNo(P, ['LD-26-001', 'LD-26-027'], []), 'LD-26-028')
eq('이미 누가 다시 쓰는 반납 번호는 후보가 아니다',
  R.nextLeadNo(P, ['LD-26-005'], ['LD-26-005', 'LD-26-009']), 'LD-26-009')
eq('하나도 없으면 001', R.nextLeadNo(P, [], []), 'LD-26-001')
eq('다른 해 번호는 섞이지 않는다', R.nextLeadNo(P, ['LD-25-900'], ['LD-25-100']), 'LD-26-001')
eq('세 자리로 채운다', R.nextLeadNo(P, ['LD-26-009'], []), 'LD-26-010')
eq('999 를 넘으면 자릿수가 는다', R.nextLeadNo(P, ['LD-26-999'], []), 'LD-26-1000')
eq('번호 자리 파싱', [R.seqOf('LD-26-027', P), R.seqOf('LD-25-001', P), R.seqOf(null, P)], [27, null, null])

console.log('\n── ③ 회수할 수 있는가 ──')
eq('사유가 짧으면 막는다', R.recallBlockedReason(lead(), '중복'), `회수 사유를 ${R.RECALL_REASON_MIN}자 이상 적어주세요`)
eq('사유를 적었으면 통과', R.recallBlockedReason(lead(), '중복 등록'), null)
eq('이미 회수된 줄', R.recallBlockedReason(lead({ lead_no: null, recalled_no: 'LD-26-027' }), '중복 등록'), '이미 회수된 리드입니다')
eq('번호가 없는 줄', R.recallBlockedReason(lead({ lead_no: null }), '중복 등록'), '번호가 없는 리드입니다')
eq('너무 긴 사유', R.recallBlockedReason(lead(), '가'.repeat(R.RECALL_REASON_MAX + 1)),
  `회수 사유는 ${R.RECALL_REASON_MAX}자까지 적을 수 있습니다`)

console.log('\n── ④ 되돌릴 수 있는가 ──')
const recalled = lead({ lead_no: null, recalled_no: 'LD-26-027' })
eq('아무도 안 쓰면 통과', R.restoreBlockedReason(recalled, ['LD-26-026']), null)
eq('누가 쓰고 있으면 막는다', R.restoreBlockedReason(recalled, ['LD-26-027']),
  'LD-26-027 번호를 다른 리드가 이미 쓰고 있습니다')
eq('회수된 줄이 아니면 막는다', R.restoreBlockedReason(lead(), []), '회수된 리드가 아닙니다')

console.log('\n── ⑤ 목록에서 보이는 것 ──')
const list = [lead({ lead_id: 1 }), lead({ lead_id: 2, lead_no: null, recalled_no: 'LD-26-010' })]
eq('기본은 숨긴다', R.visibleLeads(list, false).map(l => l.lead_id), [1])
eq('토글을 켜면 보인다', R.visibleLeads(list, true).map(l => l.lead_id), [1, 2])
eq('숨은 수', R.recalledCount(list), 1)
eq('목록 한 줄 글자', R.recallLabel({ lead_id: 2, recalled_no: 'LD-26-010', recall_reason: '중복 등록', recalled_at: '2026-11-23T01:00:00Z' }, '홍길동'),
  '회수 (원래 LD-26-010) · 중복 등록 · 홍길동 · 2026-11-23')

console.log('\n── ⑥ 라우트·화면이 같은 약속을 지키는가(글자 검사) ──')
const ROUTE = fs.readFileSync(path.join(ROOT, 'app/api/lead-recall/route.ts'), 'utf8')
const DEL = fs.readFileSync(path.join(ROOT, 'app/api/lead-delete/route.ts'), 'utf8')
const ISSUE = fs.readFileSync(path.join(ROOT, 'app/api/lead/route.ts'), 'utf8')
const PAGE = fs.readFileSync(path.join(ROOT, 'app/leads/page.tsx'), 'utf8')
const SQL = fs.readFileSync(path.join(ROOT, 'db/lead_recall_20261123.sql'), 'utf8')

ok('회수는 슈퍼관리자만', /loadCaller\(\{ kind: 'superadmin' \}/.test(ROUTE))
ok('지우지 않는다 — 라우트에 delete 가 없다', !/\.delete\(\)/.test(ROUTE))
ok('번호를 비우고 원래 번호를 남긴다', /lead_no: null,[\s\S]{0,60}recalled_no: original/.test(ROUTE))
ok('사건을 남긴다', ROUTE.includes('lead_recalled') && ROUTE.includes('lead_restored'))
ok('하드 삭제 코드가 남아 있지 않다',
  !/\.delete\(\)/.test(DEL) && !/CARD_BUCKET/.test(DEL), '지우는 코드가 남아 있다')
ok('옛 주소는 410 으로 무엇을 쓰라고 말해 준다', /status: 410/.test(DEL) && /lead-recall/.test(DEL))
ok('번호 발급이 반납 목록을 본다', /recalled_no/.test(ISSUE) && /nextLeadNoFrom\(/.test(ISSUE))
ok('화면에 「회수 포함」 토글이 있다', PAGE.includes('회수 포함'))
ok('회수된 줄은 취소선으로 보여 준다', /<s style=\{\{ color: MUTED \}\}>\{lead\.recalled_no\}<\/s>/.test(PAGE))
ok('회수·되돌리기 버튼이 있다', PAGE.includes('>회수</button>') && PAGE.includes('>번호 되돌리기</button>'))
ok('기본 목록은 회수를 걸러서 센다', /visibleLeads\(leads, includeRecalled\)/.test(PAGE))
ok('SQL 은 칸만 더하고 지우지 않는다',
  /add column if not exists recalled_no/.test(SQL) && !/drop /i.test(SQL))
ok('살아 있는 번호에 유니크를 건다', /create unique index[\s\S]{0,120}where lead_no is not null/.test(SQL))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
