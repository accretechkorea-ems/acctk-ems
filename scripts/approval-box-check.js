// 결재함·문서 판정 시험 — 「지금 무엇을 할 수 있나」·「어느 함에 보이나」·「결재란에 어떻게 그려지나」.
//
//   node scripts/approval-box-check.js
//
// 왜 따로 두는가 — 이 판정들은 **버튼이 보이는가·목록에 나오는가**를 가른다. 틀리면 조용히
// 틀린다(오류가 아니라 「없음」으로 보인다). 지금까지 시험이 없었다(docs/audit-2026-10.md D37).
// 특히 doneBox 는 옛 질의의 구멍 두 개(반려된 문서가 뒤 결재자에게 안 보임 · 기안자가 자기
// 종결 문서를 못 봄)를 메우려고 만든 파일이라, 그 두 가지가 다시 막히면 바로 걸려야 한다.
//
// 기대값은 **지금 코드가 내는 답**이다(현재 동작의 스냅샷). 의심스러운 동작은 고치지 않고
// 보고에 적는다. tableCells 의 칸·도장 규칙은 특히 손대지 않는다 — 시험만 둔다.

// eslint 의 no-require-imports 는 맨 require() 를 센다. 이 파일은 node 로 직접 돌리는
// CJS 스크립트라 모듈을 그렇게 불러올 수밖에 없다 — 한 번만 묶어 두고 그것만 쓴다.
const load = module.require.bind(module)
const path = load('path')
const Module = load('module')
const ROOT = path.join(__dirname, '..')
const ts = load(path.join(ROOT, 'node_modules/typescript'))

for (const ext of ['.ts', '.tsx']) {
  Module._extensions[ext] = (mod, filename) => {
    mod._compile(ts.transpileModule(load('fs').readFileSync(filename, 'utf8'), {
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

const A = load(path.join(ROOT, 'lib/approval/docActions.ts'))
const B = load(path.join(ROOT, 'lib/approval/doneBox.ts'))
const G = load(path.join(ROOT, 'lib/approval/delegation.ts'))
const T = load(path.join(ROOT, 'lib/approval/docTypes.ts'))
const K = load(path.join(ROOT, 'lib/approval/tableCells.ts'))

let fails = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`)
  if (!ok) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}

const line = (line_id, step, kind, approver_id, state = '대기', extra = {}) => ({
  line_id, document_id: 1, step, kind, approver_id,
  is_delegated_authority: false, state, acted_by: null, acted_at: null, comment: null,
  ...extra,
})
const dele = (owner_id, delegate_id, start_date, end_date, doc_type = null) =>
  ({ owner_id, delegate_id, start_date, end_date, doc_type })
const TODAY = '2026-11-02'

const ME = 1
const doc = (status, doc_type, lines, requester_id = ME) =>
  ({ doc_type, status, requester_id, approval_lines: lines })
const twoStep = [line(11, 1, 'approve', 101), line(12, 2, 'approve', 102), line(13, null, 'cc', 103)]

// ════════════════════════════════════════════════════════════════
console.log('── processedCount — 「이미 N명이 결재했습니다」 ──')
eq('아무도 안 눌렀으면 0', A.processedCount(twoStep), 0)
eq('승인·전결·대결을 센다', A.processedCount([
  line(11, 1, 'approve', 101, '승인'), line(12, 2, 'approve', 102, '전결'), line(13, 3, 'agree', 103, '대결'),
]), 3)
eq('**생략은 세지 않는다**(사람이 판단한 것이 아니다)', A.processedCount([
  line(11, 1, 'approve', 101, '전결'), line(12, 2, 'approve', 102, '생략'),
]), 1)
eq('반려도 세지 않는다', A.processedCount([line(11, 1, 'approve', 101, '반려')]), 0)
eq('**참조는 애초에 빠진다**', A.processedCount([line(13, null, 'cc', 103, '승인')]), 0)
eq('빈 결재선', A.processedCount([]), 0)

console.log('\n── ownerActions — 상신자가 할 수 있는 일 ──')
eq('진행중 — 회수만', A.ownerActions(doc('진행중', 'showroom_usage', twoStep)),
  { withdraw: true, resubmit: false, deleteClosed: null, rejectedNotice: null })
eq('진행중 — 이미 한 명이 눌렀어도 회수된다', A.ownerActions(doc('진행중', 'showroom_usage', [
  line(11, 1, 'approve', 101, '승인'), line(12, 2, 'approve', 102),
])).withdraw, true)
eq('완료 — 아무것도 없다', A.ownerActions(doc('완료', 'showroom_usage', twoStep)),
  { withdraw: false, resubmit: false, deleteClosed: null, rejectedNotice: null })
eq('쇼룸 반려 — 재작성', A.ownerActions(doc('반려', 'showroom_usage', twoStep)),
  { withdraw: false, resubmit: true, deleteClosed: null, rejectedNotice: null })
eq('쇼룸 회수 — 재작성 + 문서 삭제', A.ownerActions(doc('회수', 'showroom_usage', twoStep)), {
  withdraw: false, resubmit: true,
  deleteClosed: {
    endpoint: '/api/approval', action: 'delete', idKey: 'documentId', idFrom: 'document',
    confirmText: '결재 문서가 삭제되며 되돌릴 수 없습니다',
  },
  rejectedNotice: null,
})
eq('**폐기 — 지울 수는 있고 재작성은 없다**(옛 문서를 되살리지 않는다)',
  [A.ownerActions(doc('폐기', 'showroom_usage', twoStep)).resubmit,
    A.ownerActions(doc('폐기', 'showroom_usage', twoStep)).deleteClosed !== null], [false, true])
eq('**견적서 반려 — 재작성도 삭제도 없고 안내만**', A.ownerActions(doc('반려', 'quote', twoStep)), {
  withdraw: false, resubmit: false, deleteClosed: null,
  rejectedNotice: '반려된 문서는 기록으로 남습니다. 반려된 견적은 지울 수 없고 「다시쓰기」로 새로 작성합니다',
})
eq('견적서 회수 — 견적과 함께 삭제, 재작성은 없다', [
  A.ownerActions(doc('회수', 'quote', twoStep)).resubmit,
  A.ownerActions(doc('회수', 'quote', twoStep)).deleteClosed.endpoint,
  A.ownerActions(doc('회수', 'quote', twoStep)).deleteClosed.action,
], [false, '/api/quote-delete', 'self'])
eq('견적 삭제 요청 — 반려면 재작성', [
  A.ownerActions(doc('반려', 'quote_delete', twoStep)).resubmit,
  A.ownerActions(doc('반려', 'quote_delete', twoStep)).rejectedNotice,
], [true, null])
eq('**모르는 유형은 재작성을 막지 않는다**(등록표가 없으면 허용이 기본)',
  A.ownerActions(doc('반려', 'no_such_type', twoStep)),
  { withdraw: false, resubmit: true, deleteClosed: null, rejectedNotice: null })
eq('임시저장 — 아무것도 없다', A.ownerActions(doc('임시저장', 'showroom_usage', twoStep)),
  { withdraw: false, resubmit: false, deleteClosed: null, rejectedNotice: null })

console.log('\n── turnOf — 지금 내 차례인가 ──')
const dels = [dele(101, 201, '2026-11-01', '2026-11-30')]
eq('1단 결재자 본인', A.turnOf(doc('진행중', 'showroom_usage', twoStep), 101, dels, TODAY),
  { canAct: true, asDelegate: false, line: twoStep[0] })
eq('위임받은 사람 — 대결', A.turnOf(doc('진행중', 'showroom_usage', twoStep), 201, dels, TODAY),
  { canAct: true, asDelegate: true, line: twoStep[0] })
eq('**2단 결재자는 아직 차례가 아니다**',
  A.turnOf(doc('진행중', 'showroom_usage', twoStep), 102, dels, TODAY).canAct, false)
eq('1단이 끝나면 2단 차례', A.turnOf(doc('진행중', 'showroom_usage', [
  line(11, 1, 'approve', 101, '승인'), line(12, 2, 'approve', 102),
]), 102, dels, TODAY).canAct, true)
eq('남은 차례가 없으면 거짓', A.turnOf(doc('진행중', 'showroom_usage', [
  line(11, 1, 'approve', 101, '승인'),
]), 101, dels, TODAY), { canAct: false, asDelegate: false, line: null })
eq('**종결된 문서는 누구도 처리하지 못한다**', ['완료', '반려', '회수', '폐기', '임시저장'].map(
  s => A.turnOf(doc(s, 'showroom_usage', twoStep), 101, dels, TODAY).canAct), [false, false, false, false, false])
eq('참조자는 차례가 없다', A.turnOf(doc('진행중', 'showroom_usage', twoStep), 103, dels, TODAY).canAct, false)
eq('기간이 지난 위임으로는 처리하지 못한다',
  A.turnOf(doc('진행중', 'showroom_usage', twoStep), 201, [dele(101, 201, '2026-01-01', '2026-01-31')], TODAY).canAct, false)
eq('문서 유형이 다른 위임은 걸리지 않는다',
  A.turnOf(doc('진행중', 'showroom_usage', twoStep), 201, [dele(101, 201, '2026-11-01', '2026-11-30', 'quote')], TODAY).canAct, false)

// ════════════════════════════════════════════════════════════════
console.log('\n── 기결함 — 종결 상태 ──')
eq('종결은 완료·반려뿐', [...B.CLOSED_STATUSES], ['완료', '반려'])
eq('isClosedStatus', ['완료', '반려', '진행중', '회수', '폐기', '임시저장', null, undefined].map(B.isClosedStatus),
  [true, true, false, false, false, false, false, false])

console.log('\n── hasMyLine · hasMyActedLine ──')
const myApprove = [line(11, 1, 'approve', ME), line(12, 2, 'approve', 102)]
eq('내 결재 줄이 있으면 참 — **상태는 보지 않는다**(대기도 포함)', B.hasMyLine(myApprove, ME), true)
eq('합의 줄도 센다', B.hasMyLine([line(11, 1, 'agree', ME)], ME), true)
eq('**참조 줄만 있으면 거짓**(수신참조문서 함에만 보인다)', B.hasMyLine([line(13, null, 'cc', ME)], ME), false)
eq('**대결 — approver 가 남이고 acted_by 가 나면 참**',
  B.hasMyLine([line(11, 1, 'approve', 101, '대결', { acted_by: ME })], ME), true)
eq('남의 줄만 있으면 거짓', B.hasMyLine([line(11, 1, 'approve', 101)], ME), false)
eq('줄이 없거나 null 이면 거짓', [B.hasMyLine([], ME), B.hasMyLine(null, ME), B.hasMyLine(undefined, ME)],
  [false, false, false])
eq('hasMyActedLine — 도장이 찍혀야 참', [
  B.hasMyActedLine(myApprove, ME),
  B.hasMyActedLine([line(11, 1, 'approve', ME, '승인')], ME),
  B.hasMyActedLine([line(11, 1, 'approve', 101, '대결', { acted_by: ME })], ME),
], [false, true, true])
eq('**생략도 「찍힌 것」으로 센다**(대기만 아니면 참)',
  B.hasMyActedLine([line(11, 1, 'approve', ME, '생략')], ME), true)

console.log('\n── inClosedBox — 「기결문서(종결)」 ──')
eq('완료된 내 상신 문서', B.inClosedBox({ status: '완료', requester_id: ME, approval_lines: [] }, ME), true)
eq('**반려된 내 상신 문서도 보인다**(옛 질의의 구멍 ①)',
  B.inClosedBox({ status: '반려', requester_id: ME, approval_lines: [] }, ME), true)
eq('**내 차례 전에 반려돼 내 줄이 대기인 문서도 보인다**(옛 질의의 구멍 ②)',
  B.inClosedBox({ status: '반려', requester_id: 9, approval_lines: [line(11, 1, 'approve', 101, '반려'), line(12, 2, 'approve', ME)] }, ME),
  true)
eq('진행중은 안 보인다', B.inClosedBox({ status: '진행중', requester_id: ME, approval_lines: [] }, ME), false)
eq('회수·폐기는 안 보인다 — 결재가 돌지 않은 건이다', [
  B.inClosedBox({ status: '회수', requester_id: ME, approval_lines: [] }, ME),
  B.inClosedBox({ status: '폐기', requester_id: ME, approval_lines: [] }, ME),
], [false, false])
eq('참조로만 걸린 문서는 안 보인다',
  B.inClosedBox({ status: '완료', requester_id: 9, approval_lines: [line(13, null, 'cc', ME)] }, ME), false)
eq('남의 문서는 안 보인다',
  B.inClosedBox({ status: '완료', requester_id: 9, approval_lines: [line(11, 1, 'approve', 101)] }, ME), false)
eq('내가 누구인지 모르면 안 보인다',
  B.inClosedBox({ status: '완료', requester_id: ME, approval_lines: [] }, null), false)

console.log('\n── closedAtOf — 종결 시각 ──')
eq('완료 → completed_at', B.closedAtOf({ status: '완료', completed_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-02T00:00:00Z' }),
  '2026-11-01T10:00:00Z')
eq('완료인데 completed_at 이 없으면 updated_at 으로 떨어진다',
  B.closedAtOf({ status: '완료', completed_at: null, updated_at: '2026-11-02T00:00:00Z' }), '2026-11-02T00:00:00Z')
eq('**반려 → 반려 줄의 acted_at**(updated_at 을 쓰지 않는다)', B.closedAtOf({
  status: '반려', updated_at: '2026-11-09T00:00:00Z',
  approval_lines: [line(11, 1, 'approve', 101, '반려', { acted_at: '2026-11-03T09:00:00Z' })],
}), '2026-11-03T09:00:00Z')
eq('반려 줄이 여럿이면 늦은 쪽', B.closedAtOf({
  status: '반려', updated_at: '2026-11-09T00:00:00Z',
  approval_lines: [
    line(11, 1, 'approve', 101, '반려', { acted_at: '2026-11-03T09:00:00Z' }),
    line(12, 2, 'approve', 102, '반려', { acted_at: '2026-11-05T09:00:00Z' }),
  ],
}), '2026-11-05T09:00:00Z')
eq('반려인데 시각이 없으면 updated_at', B.closedAtOf({
  status: '반려', updated_at: '2026-11-09T00:00:00Z', approval_lines: [line(11, 1, 'approve', 101, '반려')],
}), '2026-11-09T00:00:00Z')
eq('그 밖의 상태는 completed_at → updated_at → null', [
  B.closedAtOf({ status: '진행중', updated_at: '2026-11-09T00:00:00Z' }),
  B.closedAtOf({ status: '진행중' }),
], ['2026-11-09T00:00:00Z', null])

console.log('\n── closedInPeriod · sortByClosedAt ──')
const at = (document_id, completed_at) => ({ document_id, status: '완료', completed_at, approval_lines: [] })
eq('기간 안', B.closedInPeriod(at(1, '2026-11-02T10:00:00Z'), '2026-11-01', '2026-11-30'), true)
eq('**시작일 당일·종료일 당일 포함**', [
  B.closedInPeriod(at(1, '2026-11-01T00:00:00Z'), '2026-11-01', '2026-11-30'),
  B.closedInPeriod(at(1, '2026-11-30T23:59:59Z'), '2026-11-01', '2026-11-30'),
], [true, true])
eq('하루 벗어나면 거짓', [
  B.closedInPeriod(at(1, '2026-10-31T23:00:00Z'), '2026-11-01', '2026-11-30'),
  B.closedInPeriod(at(1, '2026-12-01T00:00:00Z'), '2026-11-01', '2026-11-30'),
], [false, false])
eq('**시각을 모르는 문서는 거르지 않는다**', B.closedInPeriod({ status: '완료' }, '2026-11-01', '2026-11-30'), true)
eq('최신순 정렬', B.sortByClosedAt([
  at(1, '2026-11-01T00:00:00Z'), at(2, '2026-11-05T00:00:00Z'), at(3, '2026-11-03T00:00:00Z'),
]).map(d => d.document_id), [2, 3, 1])
eq('같은 시각이면 번호가 큰 쪽이 먼저', B.sortByClosedAt([
  at(7, '2026-11-05T00:00:00Z'), at(9, '2026-11-05T00:00:00Z'),
]).map(d => d.document_id), [9, 7])
eq('원본을 뒤집지 않는다', (() => {
  const src = [at(1, '2026-11-01T00:00:00Z'), at(2, '2026-11-05T00:00:00Z')]
  B.sortByClosedAt(src)
  return src.map(d => d.document_id)
})(), [1, 2])

console.log('\n── closedBoxRows — 함 한 벌 ──')
{
  const rows = [
    { document_id: 1, doc_type: 'quote', status: '완료', requester_id: ME, completed_at: '2026-11-05T00:00:00Z', approval_lines: [] },
    { document_id: 1, doc_type: 'quote', status: '완료', requester_id: ME, completed_at: '2026-11-05T00:00:00Z', approval_lines: [] },
    { document_id: 2, doc_type: 'showroom_usage', status: '진행중', requester_id: ME, approval_lines: [] },
    { document_id: 3, doc_type: 'showroom_usage', status: '반려', requester_id: 9, approval_lines: [line(11, 1, 'approve', ME, '반려', { acted_at: '2026-11-07T00:00:00Z' })] },
    { document_id: 4, doc_type: 'quote', status: '완료', requester_id: 9, approval_lines: [line(13, null, 'cc', ME)] },
  ]
  eq('중복은 지우고, 종결·내 것만, 최신순', B.closedBoxRows(rows, { myId: ME }).map(d => d.document_id), [3, 1])
  eq('유형으로 좁힌다', B.closedBoxRows(rows, { myId: ME, docType: 'quote' }).map(d => d.document_id), [1])
  eq('기간으로 좁힌다', B.closedBoxRows(rows, { myId: ME, from: '2026-11-06', to: '2026-11-30' }).map(d => d.document_id), [3])
  eq('내가 누구인지 모르면 빈 목록', B.closedBoxRows(rows, { myId: null }), [])
}

// ════════════════════════════════════════════════════════════════
console.log('\n── 위임 — 기간 겹침(양 끝 포함) ──')
eq('완전히 겹침', G.rangesOverlap('2026-11-01', '2026-11-30', '2026-11-10', '2026-11-20'), true)
eq('**끝나는 날과 시작하는 날이 같으면 겹친다**', G.rangesOverlap('2026-11-01', '2026-11-10', '2026-11-10', '2026-11-20'), true)
eq('하루 떨어지면 겹치지 않는다', G.rangesOverlap('2026-11-01', '2026-11-09', '2026-11-10', '2026-11-20'), false)
eq('순서를 바꿔도 같다', [
  G.rangesOverlap('2026-11-10', '2026-11-20', '2026-11-01', '2026-11-10'),
  G.rangesOverlap('2026-11-01', '2026-11-10', '2026-11-10', '2026-11-20'),
], [true, true])
eq('하루짜리끼리', [
  G.rangesOverlap('2026-11-02', '2026-11-02', '2026-11-02', '2026-11-02'),
  G.rangesOverlap('2026-11-02', '2026-11-02', '2026-11-03', '2026-11-03'),
], [true, false])
eq('적용 범위 겹침 — 한쪽이 전체(null)면 겹친다', [
  G.scopesOverlap(null, null), G.scopesOverlap(null, 'quote'), G.scopesOverlap('quote', null),
  G.scopesOverlap('quote', 'quote'), G.scopesOverlap('quote', 'showroom_usage'),
], [true, true, true, true, false])

console.log('\n── delegationStatus — 오늘 기준 ──')
eq('기간 안이면 진행 중', G.delegationStatus({ start_date: '2026-11-01', end_date: '2026-11-30' }, TODAY), '진행 중')
eq('**시작일 당일·종료일 당일은 진행 중**', [
  G.delegationStatus({ start_date: TODAY, end_date: '2026-11-30' }, TODAY),
  G.delegationStatus({ start_date: '2026-10-01', end_date: TODAY }, TODAY),
], ['진행 중', '진행 중'])
eq('아직 시작 전이면 예정', G.delegationStatus({ start_date: '2026-11-03', end_date: '2026-11-30' }, TODAY), '예정')
eq('어제 끝났으면 종료', G.delegationStatus({ start_date: '2026-10-01', end_date: '2026-11-01' }, TODAY), '종료')

console.log('\n── findPeriodConflict — 같은 위임자의 기존 위임 ──')
const existing = [
  { delegation_id: 1, ...dele(101, 201, '2026-11-01', '2026-11-30'), reason: null },
  { delegation_id: 2, ...dele(102, 202, '2026-11-01', '2026-11-30'), reason: null },
  { delegation_id: 3, ...dele(101, 203, '2026-12-01', '2026-12-31', 'quote'), reason: null },
]
const input = (ownerId, delegateId, startDate, endDate, docType = null) =>
  ({ ownerId, delegateId, startDate, endDate, docType, reason: null })
eq('같은 위임자·같은 기간 → 부딪힌다',
  G.findPeriodConflict(input(101, 299, '2026-11-10', '2026-11-20'), existing).delegation_id, 1)
eq('**다른 위임자의 위임은 부딪히지 않는다**',
  G.findPeriodConflict(input(999, 299, '2026-11-10', '2026-11-20'), existing), null)
eq('기간이 안 겹치면 괜찮다',
  G.findPeriodConflict(input(101, 299, '2026-10-01', '2026-10-31'), existing), null)
eq('경계일이 맞닿으면 부딪힌다',
  G.findPeriodConflict(input(101, 299, '2026-11-30', '2026-12-05'), existing).delegation_id, 1)
eq('기간이 겹쳐도 **종류가 다르면** 괜찮다',
  G.findPeriodConflict(input(101, 299, '2026-12-10', '2026-12-20', 'showroom_usage'), existing), null)
eq('한쪽이 전체(null)면 종류가 달라도 부딪힌다',
  G.findPeriodConflict(input(101, 299, '2026-12-10', '2026-12-20', null), existing).delegation_id, 3)
eq('기존 위임이 없으면 괜찮다', G.findPeriodConflict(input(101, 299, '2026-11-10', '2026-11-20'), []), null)

console.log('\n── findChainProblem — 사슬(대결은 1단만) ──')
eq('**대리인이 이미 남에게 위임 중**(A→B 인데 B→C 가 있다)',
  G.findChainProblem(input(999, 101, '2026-11-10', '2026-11-20'), existing),
  { kind: 'delegate_is_owner', row: existing[0] })
eq('**위임자가 남의 대리인**(A→B 인데 C→A 가 있다)',
  G.findChainProblem(input(201, 299, '2026-11-10', '2026-11-20'), existing),
  { kind: 'owner_is_delegate', row: existing[0] })
eq('기간이 안 겹치면 사슬이 아니다',
  G.findChainProblem(input(999, 101, '2026-10-01', '2026-10-15'), existing), null)
eq('사슬이 없으면 null', G.findChainProblem(input(777, 888, '2026-11-10', '2026-11-20'), existing), null)

console.log('\n── validateDelegationInput — 등록 전 검증 ──')
const ctx = {
  today: TODAY,
  activeIds: new Set([201, 202, 203, 299]),
  existing: [],
  nameOf: id => `${id}번`,
}
eq('정상', G.validateDelegationInput(input(101, 201, '2026-11-10', '2026-11-20'), ctx), null)
eq('자기 자신에게', G.validateDelegationInput(input(101, 101, '2026-11-10', '2026-11-20'), ctx),
  '자기 자신에게 위임할 수 없습니다.')
eq('퇴사자에게', G.validateDelegationInput(input(101, 777, '2026-11-10', '2026-11-20'), ctx),
  '퇴사했거나 없는 직원에게는 위임할 수 없습니다.')
eq('날짜 모양이 아니면', G.validateDelegationInput(input(101, 201, '2026/11/10', '2026-11-20'), ctx),
  '기간을 올바르게 입력해주세요.')
eq('시작이 종료보다 늦으면', G.validateDelegationInput(input(101, 201, '2026-11-20', '2026-11-10'), ctx),
  '시작일이 종료일보다 늦습니다.')
eq('**종료일이 어제면 거절**', G.validateDelegationInput(input(101, 201, '2026-10-01', '2026-11-01'), ctx),
  '종료일이 이미 지났습니다. 오늘 이후로 지정해주세요.')
eq('**종료일이 오늘이면 통과**(경계)', G.validateDelegationInput(input(101, 201, '2026-10-01', TODAY), ctx), null)
eq('모르는 문서 종류', G.validateDelegationInput(input(101, 201, '2026-11-10', '2026-11-20', 'no_such'), ctx),
  '등록되지 않은 문서 종류입니다.')
eq('사유 길이 상한', [
  G.REASON_MAX,
  G.validateDelegationInput({ ...input(101, 201, '2026-11-10', '2026-11-20'), reason: 'ㄱ'.repeat(200) }, ctx),
  G.validateDelegationInput({ ...input(101, 201, '2026-11-10', '2026-11-20'), reason: 'ㄱ'.repeat(201) }, ctx),
], [200, null, '사유는 200자까지 쓸 수 있습니다.'])
eq('기간이 부딪히면 사람 이름을 넣어 알린다',
  G.validateDelegationInput(input(101, 299, '2026-11-10', '2026-11-20'), { ...ctx, existing }),
  '이미 2026-11-01 ~ 2026-11-30 기간에 201번님께 위임(전체 문서)이 있습니다. 기간이 겹치지 않게 지정하거나 기존 위임을 해제해주세요.')
eq('isYmd', [G.isYmd('2026-11-02'), G.isYmd('2026-1-2'), G.isYmd(''), G.isYmd(null), G.isYmd(20261102)],
  [true, false, false, false, false])
eq('적용 범위 이름', [G.scopeLabel(null), G.scopeLabel('quote'), G.scopeLabel('no_such')],
  ['전체 문서', '견적서', 'no_such'])
eq('기간 표기', G.periodLabel('2026-11-01', '2026-11-30'), '2026-11-01 ~ 2026-11-30')

// ════════════════════════════════════════════════════════════════
console.log('\n── 문서 유형 등록표 ──')
eq('등록된 유형 셋', [...T.DOC_TYPE_KEYS], ['quote', 'showroom_usage', 'quote_delete'])
eq('docTypeOf — 등록된 키', T.docTypeOf('quote').label, '견적서')
eq('docTypeOf — 모르는 키·이상한 값은 null', [
  T.docTypeOf('no_such'), T.docTypeOf(null), T.docTypeOf(undefined), T.docTypeOf(7), T.docTypeOf(''),
], [null, null, null, null, null])
eq('**프로토타입 이름으로 뚫리지 않는다**', [T.docTypeOf('toString'), T.docTypeOf('constructor')], [null, null])
eq('재상신 — 견적서만 막혀 있다', T.DOC_TYPE_KEYS.map(k => T.canResubmitDocument(T.DOC_TYPES[k])),
  [false, true, true])
eq('반려 가능 — 셋 다', T.DOC_TYPE_KEYS.map(k => T.canRejectDocument(T.DOC_TYPES[k], {})), [true, true, true])
eq('summary 가 없어도 판정된다', T.canRejectDocument(T.DOC_TYPES.showroom_usage, null), true)
eq('canReject 가 꺼진 가짜 유형은 거짓', T.canRejectDocument({ canReject: false }, {}), false)
eq('기본 승인 버튼 이름', T.APPROVE_LABEL, '승인')
eq('쇼룸 **사후 신청은 「확인」**', [
  T.approveLabelOf(T.DOC_TYPES.showroom_usage, { is_retroactive: true }),
  T.approveLabelOf(T.DOC_TYPES.showroom_usage, { payload: { is_retroactive: true } }),
], ['확인', '확인'])
eq('사전 신청·빈 요약은 「승인」', [
  T.approveLabelOf(T.DOC_TYPES.showroom_usage, { is_retroactive: false }),
  T.approveLabelOf(T.DOC_TYPES.showroom_usage, {}),
  T.approveLabelOf(T.DOC_TYPES.showroom_usage, null),
], ['승인', '승인', '승인'])
eq('다른 유형은 요약과 무관하게 「승인」',
  T.approveLabelOf(T.DOC_TYPES.quote, { is_retroactive: true }), '승인')
eq('셋 다 결재선 규칙(관리자 1명)을 요구한다',
  T.DOC_TYPE_KEYS.map(k => T.DOC_TYPES[k].lineRules?.requireSuperadminApprover === true), [true, true, true])
eq('key 칸과 표의 키가 같다', T.DOC_TYPE_KEYS.filter(k => T.DOC_TYPES[k].key !== k), [])

// ════════════════════════════════════════════════════════════════
console.log('\n── 결재란 칸·도장(tableCells) ──')
eq('isStamped — 대기·생략만 빈칸', ['대기', '생략', '승인', '반려', '전결', '대결'].map(K.isStamped),
  [false, false, true, true, true, true])
{
  const lines = [
    line(13, null, 'cc', 103),
    line(12, 2, 'agree', 102, '승인'),
    line(11, 1, 'approve', 101, '승인'),
    line(14, 3, 'approve', 104),
  ]
  const t = K.tableLines(lines)
  eq('결재 줄과 합의 줄을 갈라 순서대로', [t.approve.map(l => l.line_id), t.agree.map(l => l.line_id)],
    [[11, 14], [12]])
  eq('**참조는 어느 쪽에도 없다**', t.approve.concat(t.agree).some(l => l.kind === 'cc'), false)
  eq('줄이 없으면 빈 두 목록', K.tableLines(null), { approve: [], agree: [] })
}
eq('step 이 같으면 line_id 순', K.tableLines([
  line(9, 1, 'approve', 101), line(4, 1, 'approve', 102),
]).approve.map(l => l.line_id), [4, 9])
eq('기안자 칸 수 — 아는 문서면 1', [K.requesterCells(5), K.requesterCells(null), K.requesterCells(undefined)], [1, 0, 0])
eq('기안자 도장 — 상신했으면 찍힌다', [
  K.requesterStamped(5, '2026-11-02T00:00:00Z'), K.requesterStamped(5, null), K.requesterStamped(null, '2026-11-02T00:00:00Z'),
], [true, false, false])

console.log('\n── progressCount — 「진행(N/M)」 ──')
eq('상신 직후 — 기안자 1칸만 찍혔다', K.progressCount({
  requester_id: ME, submitted_at: '2026-11-02T00:00:00Z', approval_lines: twoStep,
}), { done: 1, total: 3 })
eq('1단이 승인하면', K.progressCount({
  requester_id: ME, submitted_at: '2026-11-02T00:00:00Z',
  approval_lines: [line(11, 1, 'approve', 101, '승인'), line(12, 2, 'approve', 102), line(13, null, 'cc', 103)],
}), { done: 2, total: 3 })
eq('**생략된 칸은 분모에 남고 분자에는 안 들어간다**', K.progressCount({
  requester_id: ME, submitted_at: '2026-11-02T00:00:00Z',
  approval_lines: [line(11, 1, 'approve', 101, '전결'), line(12, 2, 'approve', 102, '생략')],
}), { done: 2, total: 3 })
eq('합의 칸도 센다', K.progressCount({
  requester_id: ME, submitted_at: '2026-11-02T00:00:00Z',
  approval_lines: [line(11, 1, 'approve', 101, '승인'), line(12, 2, 'agree', 102, '승인')],
}), { done: 3, total: 3 })
eq('**참조는 분모에도 없다**', K.progressCount({
  requester_id: ME, submitted_at: '2026-11-02T00:00:00Z',
  approval_lines: [line(11, 1, 'approve', 101), line(13, null, 'cc', 103), line(15, null, 'cc', 105)],
}), { done: 1, total: 2 })
eq('임시저장(상신일 없음) — 기안자 칸은 빈칸', K.progressCount({
  requester_id: ME, submitted_at: null, approval_lines: twoStep,
}), { done: 0, total: 3 })
eq('기안자를 모르는 옛 호출부 — 기안자 칸 없이 센다', K.progressCount({ approval_lines: twoStep }),
  { done: 0, total: 2 })
eq('줄이 없는 문서', K.progressCount({ requester_id: ME, submitted_at: '2026-11-02T00:00:00Z' }),
  { done: 1, total: 1 })

console.log(fails === 0 ? '\n모두 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
