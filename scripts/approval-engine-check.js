// 결재 엔진 시험 — 상신·승인·전결·대결·생략·완료 판정.
//
//   node scripts/approval-engine-check.js
//
// 왜 따로 두는가 — 틀리면 **가장 비싼 곳**인데 지금까지 시험이 없었다(docs/audit-2026-10.md D37).
// `lib/approval/engine.ts` 는 DB 를 모르는 순수 모듈이라 그대로 돌릴 수 있다. 엔진은 한 줄도
// 바꾸지 않고 시험만 붙인다 — 이 하네스의 역할은 「동작이 바뀌었다」를 알리는 것이다.
//
// 기대값은 **지금 코드가 내는 답**이다(현재 동작의 스냅샷). 의심스러운 동작은 고치지 않고
// 보고에 적는다.

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

const E = load(path.join(ROOT, 'lib/approval/engine.ts'))
const R = load(path.join(ROOT, 'lib/approval/lineRules.ts'))
const C = load(path.join(ROOT, 'lib/approval/teamCc.ts'))

let fails = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`)
  if (!ok) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}

/** 결재선 한 줄. 판정에 쓰지 않는 칸은 기본값으로 둔다. */
const line = (line_id, step, kind, approver_id, state = '대기', extra = {}) => ({
  line_id, document_id: 1, step, kind, approver_id,
  is_delegated_authority: false, state, acted_by: null, acted_at: null, comment: null,
  ...extra,
})
/** 위임 한 건. */
const dele = (owner_id, delegate_id, start_date, end_date, doc_type = null) =>
  ({ owner_id, delegate_id, start_date, end_date, doc_type })

const TODAY = '2026-11-02'
const TYPE = 'showroom_usage'

// 보통 모양 — 결재 2단 + 합의 1 + 참조 1.
const normal = [
  line(11, 1, 'approve', 101),
  line(12, 2, 'agree', 102),
  line(13, 3, 'approve', 103),
  line(14, null, 'cc', 104),
]

// ════════════════════════════════════════════════════════════════
console.log('── sequentialLines — 참조는 순서에서 빠진다 ──')
eq('결재·합의만 step 순', E.sequentialLines(normal).map(l => l.line_id), [11, 12, 13])
eq('step 이 뒤섞여 들어와도 정렬한다', E.sequentialLines([
  line(3, 3, 'approve', 103), line(1, 1, 'approve', 101), line(2, 2, 'approve', 102),
]).map(l => l.line_id), [1, 2, 3])
eq('step 이 같으면 line_id 순', E.sequentialLines([
  line(9, 1, 'approve', 101), line(4, 1, 'agree', 102),
]).map(l => l.line_id), [4, 9])
eq('step 이 null 이면 0 으로 보아 맨 앞', E.sequentialLines([
  line(5, 1, 'approve', 101), line(6, null, 'agree', 102),
]).map(l => l.line_id), [6, 5])
eq('참조만 있으면 빈 목록', E.sequentialLines([line(1, null, 'cc', 101)]), [])
eq('빈 결재선', E.sequentialLines([]), [])
eq('원본을 뒤집지 않는다', normal.map(l => l.line_id), [11, 12, 13, 14])

console.log('\n── nextPendingLine · isComplete · untouched ──')
eq('아무도 안 눌렀으면 1단', E.nextPendingLine(normal).line_id, 11)
eq('1단이 끝나면 2단(합의)이 차례', E.nextPendingLine([
  line(11, 1, 'approve', 101, '승인'), line(12, 2, 'agree', 102), line(13, 3, 'approve', 103),
]).line_id, 12)
eq('참조는 차례가 되지 않는다', E.nextPendingLine([
  line(11, 1, 'approve', 101, '승인'), line(14, null, 'cc', 104),
]), null)
eq('전부 처리되면 차례가 없다', E.nextPendingLine([
  line(11, 1, 'approve', 101, '승인'), line(13, 2, 'approve', 103, '전결'),
]), null)
eq('생략된 줄은 차례가 아니다', E.nextPendingLine([
  line(11, 1, 'approve', 101, '전결'), line(13, 2, 'approve', 103, '생략'),
]), null)
eq('완료 판정은 「남은 대기가 없음」', [
  E.isComplete(normal),
  E.isComplete([line(11, 1, 'approve', 101, '승인')]),
  E.isComplete([line(11, 1, 'approve', 101, '승인'), line(12, 2, 'agree', 102)]),
], [false, true, false])
eq('**빈 결재선은 완료로 판정된다** — 상신 검증이 막아 실제로는 생기지 않는다', E.isComplete([]), true)
eq('참조만 있는 문서도 완료로 판정된다', E.isComplete([line(14, null, 'cc', 104)]), true)
eq('회수 가능(untouched) — 아무도 안 눌렀을 때만', [
  E.untouched(normal),
  E.untouched([line(11, 1, 'approve', 101, '승인'), line(12, 2, 'agree', 102)]),
  E.untouched([line(11, 1, 'approve', 101, '반려')]),
], [true, false, false])
eq('참조는 회수 판정에 끼지 않는다', E.untouched([line(14, null, 'cc', 104, '승인')]), true)
eq('빈 결재선도 untouched', E.untouched([]), true)

console.log('\n── skippedLineIds — 전결로 건너뛸 줄 ──')
eq('전결한 1단 뒤의 대기 줄', E.skippedLineIds(normal, 1), [12, 13])
eq('마지막 단에서 전결하면 건너뛸 줄이 없다', E.skippedLineIds(normal, 3), [])
eq('이미 처리된 앞 순번은 손대지 않는다', E.skippedLineIds([
  line(11, 1, 'approve', 101, '승인'), line(12, 2, 'approve', 102), line(13, 3, 'approve', 103),
], 2), [13])
eq('**참조는 생략 대상이 아니다**', E.skippedLineIds([
  line(11, 1, 'approve', 101), line(14, null, 'cc', 104),
], 0), [11])
eq('대기가 아닌 뒤 순번은 빠진다', E.skippedLineIds([
  line(11, 1, 'approve', 101), line(12, 2, 'approve', 102, '반려'),
], 1), [])
eq('빈 결재선', E.skippedLineIds([], 1), [])

console.log('\n── ccApproverIds ──')
eq('참조만 모은다', E.ccApproverIds(normal), [104])
eq('같은 사람이 두 번 들어와도 한 번', E.ccApproverIds([
  line(14, null, 'cc', 104), line(15, null, 'cc', 104), line(16, null, 'cc', 105),
]), [104, 105])
eq('참조가 없으면 빈 목록', E.ccApproverIds([line(11, 1, 'approve', 101)]), [])

console.log('\n── delegationActive — 기간 경계일 ──')
eq('기간 안', E.delegationActive(dele(101, 201, '2026-11-01', '2026-11-30'), TODAY, TYPE), true)
eq('**시작일 당일도 유효**', E.delegationActive(dele(101, 201, TODAY, '2026-11-30'), TODAY, TYPE), true)
eq('**종료일 당일도 유효**', E.delegationActive(dele(101, 201, '2026-10-01', TODAY), TODAY, TYPE), true)
eq('시작 하루 전은 아직 아니다', E.delegationActive(dele(101, 201, '2026-11-03', '2026-11-30'), TODAY, TYPE), false)
eq('종료 하루 뒤는 끝났다', E.delegationActive(dele(101, 201, '2026-10-01', '2026-11-01'), TODAY, TYPE), false)
eq('하루짜리 위임(시작=종료=오늘)', E.delegationActive(dele(101, 201, TODAY, TODAY), TODAY, TYPE), true)
eq('유형이 null 이면 모든 유형에 적용', E.delegationActive(dele(101, 201, '2026-11-01', '2026-11-30', null), TODAY, 'quote'), true)
eq('유형이 같으면 적용', E.delegationActive(dele(101, 201, '2026-11-01', '2026-11-30', TYPE), TODAY, TYPE), true)
eq('유형이 다르면 적용되지 않는다', E.delegationActive(dele(101, 201, '2026-11-01', '2026-11-30', 'quote'), TODAY, TYPE), false)

console.log('\n── delegatesOf — 대리인 찾기 ──')
const dels = [
  dele(101, 201, '2026-11-01', '2026-11-30'),
  dele(101, 202, '2026-11-01', '2026-11-30', 'quote'),   // 다른 유형 — 이 문서에는 안 걸린다
  dele(102, 203, '2026-11-01', '2026-11-30'),
  dele(101, 201, '2026-11-01', '2026-11-05'),             // 같은 대리인 중복
  dele(101, 204, '2026-01-01', '2026-01-31'),             // 지난 기간
]
eq('그 사람의 유효한 대리인만, 중복 없이', E.delegatesOf(101, dels, TODAY, TYPE), [201])
eq('유형을 바꾸면 대리인도 바뀐다', E.delegatesOf(101, dels, TODAY, 'quote'), [201, 202])
eq('다른 위임자의 대리인', E.delegatesOf(102, dels, TODAY, TYPE), [203])
eq('위임이 없는 사람', E.delegatesOf(999, dels, TODAY, TYPE), [])
eq('위임 목록이 비었으면', E.delegatesOf(101, [], TODAY, TYPE), [])
eq('**대결은 1단만 본다** — B→C 가 있어도 A 의 대리인에 C 는 없다',
  E.delegatesOf(101, [dele(101, 201, '2026-11-01', '2026-11-30'), dele(201, 301, '2026-11-01', '2026-11-30')], TODAY, TYPE),
  [201])

console.log('\n── actorFor — 그 줄을 처리할 수 있는가 ──')
const l1 = line(11, 1, 'approve', 101)
eq('본인', E.actorFor(l1, 101, dels, TODAY, TYPE), { ok: true, asDelegate: false })
eq('위임받은 사람 — 대결', E.actorFor(l1, 201, dels, TODAY, TYPE), { ok: true, asDelegate: true })
eq('남', E.actorFor(l1, 999, dels, TODAY, TYPE), { ok: false, asDelegate: false })
eq('다른 유형으로 위임받은 사람은 이 문서에서 거절', E.actorFor(l1, 202, dels, TODAY, TYPE), { ok: false, asDelegate: false })
eq('그 유형에서는 통과', E.actorFor(l1, 202, dels, TODAY, 'quote'), { ok: true, asDelegate: true })
eq('기간이 지난 위임은 거절', E.actorFor(l1, 204, dels, TODAY, TYPE), { ok: false, asDelegate: false })
eq('**본인 판정이 먼저다** — 자기 줄을 자기가 위임해 두었어도 대결이 아니다',
  E.actorFor(l1, 101, [dele(101, 101, '2026-11-01', '2026-11-30')], TODAY, TYPE), { ok: true, asDelegate: false })
eq('대리인이 둘이면 각각 통과한다(둘 다 누를 수 있다)', [
  E.actorFor(l1, 201, [dele(101, 201, TODAY, TODAY), dele(101, 202, TODAY, TODAY)], TODAY, TYPE).ok,
  E.actorFor(l1, 202, [dele(101, 201, TODAY, TODAY), dele(101, 202, TODAY, TODAY)], TODAY, TYPE).ok,
], [true, true])

console.log('\n── approvedState — 찍히는 도장 ──')
eq('본인 승인', E.approvedState(l1, false), '승인')
eq('대리인 승인 → 대결', E.approvedState(l1, true), '대결')
eq('전결 지정 줄은 본인이 눌러도 전결', E.approvedState(line(11, 1, 'approve', 101, '대기', { is_delegated_authority: true }), false), '전결')
eq('**전결이 대결보다 앞선다** — 대리인이 전결 줄을 처리하면 전결',
  E.approvedState(line(11, 1, 'approve', 101, '대기', { is_delegated_authority: true }), true), '전결')

console.log('\n── applyApproval — 메모리 위에 반영 ──')
{
  const after = E.applyApproval(normal, 11, '전결', [12, 13])
  eq('누른 줄에 상태가, 건너뛴 줄에 생략이', after.map(l => `${l.line_id}:${l.state}`),
    ['11:전결', '12:생략', '13:생략', '14:대기'])
  eq('반영 뒤에는 완료다', E.isComplete(after), true)
  eq('원본은 그대로', normal.map(l => l.state), ['대기', '대기', '대기', '대기'])
}
{
  const after = E.applyApproval(normal, 11, '승인', [])
  eq('생략이 없으면 한 줄만 바뀐다', after.map(l => `${l.line_id}:${l.state}`),
    ['11:승인', '12:대기', '13:대기', '14:대기'])
  eq('다음 차례는 2단', E.nextPendingLine(after).line_id, 12)
}
eq('없는 line_id 를 주면 아무것도 바뀌지 않는다',
  E.applyApproval(normal, 999, '승인', []).map(l => l.state), ['대기', '대기', '대기', '대기'])
eq('**생략 목록에 참조가 섞이면 참조도 생략으로 바뀐다** — 부르는 쪽이 skippedLineIds 를 쓴다',
  E.applyApproval(normal, 11, '승인', [14]).map(l => `${l.line_id}:${l.state}`),
  ['11:승인', '12:대기', '13:대기', '14:생략'])

// ════════════════════════════════════════════════════════════════
console.log('\n── validateLineInput — 상신 결재선 검증 ──')
const ACTIVE = new Set([101, 102, 103, 104])
const ME = 1
const inp = (step, kind, approverId, isDelegatedAuthority) => ({ step, kind, approverId, isDelegatedAuthority })
const ok1 = [inp(1, 'approve', 101)]
eq('결재자 한 명 — 통과', E.validateLineInput(ok1, ME, ACTIVE), null)
eq('결재 2단 + 합의 + 참조 — 통과', E.validateLineInput([
  inp(1, 'approve', 101), inp(2, 'agree', 102), inp(3, 'approve', 103), inp(1, 'cc', 104),
], ME, ACTIVE), null)
eq('**빈 결재선**', E.validateLineInput([], ME, ACTIVE), '결재선을 지정해주세요.')
eq('배열이 아니면 같은 메시지', E.validateLineInput(null, ME, ACTIVE), '결재선을 지정해주세요.')
eq('모르는 종류', E.validateLineInput([inp(1, 'review', 101)], ME, ACTIVE), '결재선 종류가 올바르지 않습니다: review')
eq('결재자 번호가 이상하면', [
  E.validateLineInput([inp(1, 'approve', 0)], ME, ACTIVE),
  E.validateLineInput([inp(1, 'approve', -3)], ME, ACTIVE),
  E.validateLineInput([inp(1, 'approve', 1.5)], ME, ACTIVE),
], ['결재자가 올바르지 않습니다.', '결재자가 올바르지 않습니다.', '결재자가 올바르지 않습니다.'])
eq('**상신자 본인은 못 들어간다**', E.validateLineInput([inp(1, 'approve', ME)], ME, ACTIVE),
  '상신자는 자기 결재선에 들어갈 수 없습니다.')
eq('본인을 참조로 넣어도 막는다', E.validateLineInput([inp(1, 'approve', 101), inp(1, 'cc', ME)], ME, ACTIVE),
  '상신자는 자기 결재선에 들어갈 수 없습니다.')
eq('**퇴사자**', E.validateLineInput([inp(1, 'approve', 900)], ME, ACTIVE),
  '퇴사했거나 없는 직원이 결재선에 있습니다.')
eq('**같은 사람 중복** — 결재에 두 번', E.validateLineInput([
  inp(1, 'approve', 101), inp(2, 'approve', 101),
], ME, ACTIVE), '같은 사람을 결재선에 두 번 넣을 수 없습니다.')
eq('결재와 참조에 같은 사람도 막는다', E.validateLineInput([
  inp(1, 'approve', 101), inp(1, 'cc', 101),
], ME, ACTIVE), '같은 사람을 결재선에 두 번 넣을 수 없습니다.')
eq('합의만 있으면 결재자가 없다', E.validateLineInput([inp(1, 'agree', 101)], ME, ACTIVE),
  '결재자를 한 명 이상 지정해주세요.')
eq('참조만 있으면 결재자가 없다', E.validateLineInput([inp(1, 'cc', 101)], ME, ACTIVE),
  '결재자를 한 명 이상 지정해주세요.')
eq('순서가 1 부터가 아니면', E.validateLineInput([inp(2, 'approve', 101)], ME, ACTIVE),
  '결재 순서는 1부터 빠짐없이 이어져야 합니다.')
eq('순서가 비면', E.validateLineInput([inp(1, 'approve', 101), inp(3, 'approve', 102)], ME, ACTIVE),
  '결재 순서는 1부터 빠짐없이 이어져야 합니다.')
eq('순서가 겹치면', E.validateLineInput([inp(1, 'approve', 101), inp(1, 'approve', 102)], ME, ACTIVE),
  '결재 순서는 1부터 빠짐없이 이어져야 합니다.')
eq('**참조의 step 은 순서 검사에 끼지 않는다**', E.validateLineInput([
  inp(1, 'approve', 101), inp(7, 'cc', 104),
], ME, ACTIVE), null)
eq('전결 지정이 여러 명이어도 통과한다', E.validateLineInput([
  inp(1, 'approve', 101, true), inp(2, 'approve', 102, true),
], ME, ACTIVE), null)

console.log('\n── toLineRows — DB 행 모양 ──')
eq('결재·합의·참조 세 줄', E.toLineRows(77, [
  inp(1, 'approve', 101, true), inp(2, 'agree', 102), inp(1, 'cc', 104),
]), [
  { document_id: 77, step: 1, kind: 'approve', approver_id: 101, is_delegated_authority: true, state: '대기' },
  { document_id: 77, step: 2, kind: 'agree', approver_id: 102, is_delegated_authority: false, state: '대기' },
  { document_id: 77, step: null, kind: 'cc', approver_id: 104, is_delegated_authority: false, state: '대기' },
])
eq('**전결은 결재 줄만** — 합의·참조에 켜도 꺼진다', E.toLineRows(77, [
  inp(1, 'agree', 102, true), inp(1, 'cc', 104, true),
]).map(r => r.is_delegated_authority), [false, false])
eq('빈 입력', E.toLineRows(77, []), [])

// ════════════════════════════════════════════════════════════════
console.log('\n── checkLineRules — 종류별 규칙(관리자 1명) ──')
const isSuper = id => id === 900
const RULES = { requireSuperadminApprover: true }
eq('규칙이 없으면 늘 통과', R.checkLineRules({ lines: ok1, rules: undefined, requesterIsSuperadmin: false, isSuperadmin: isSuper }),
  { ok: true })
eq('결재자에 관리자가 있으면 통과',
  R.checkLineRules({ lines: [inp(1, 'approve', 900)], rules: RULES, requesterIsSuperadmin: false, isSuperadmin: isSuper }),
  { ok: true })
eq('관리자가 없으면 막는다',
  R.checkLineRules({ lines: [inp(1, 'approve', 101)], rules: RULES, requesterIsSuperadmin: false, isSuperadmin: isSuper }),
  { ok: false, code: 'superadmin_approver_required', message: '결재자 중 관리자 1명 이상이 포함되어야 합니다.' })
eq('**합의 줄의 관리자는 인정하지 않는다**',
  R.checkLineRules({ lines: [inp(1, 'approve', 101), inp(2, 'agree', 900)], rules: RULES, requesterIsSuperadmin: false, isSuperadmin: isSuper }).ok,
  false)
eq('**참조의 관리자도 인정하지 않는다**',
  R.checkLineRules({ lines: [inp(1, 'approve', 101), inp(1, 'cc', 900)], rules: RULES, requesterIsSuperadmin: false, isSuperadmin: isSuper }).ok,
  false)
eq('**상신자가 관리자면 면제**',
  R.checkLineRules({ lines: [inp(1, 'approve', 101)], rules: RULES, requesterIsSuperadmin: true, isSuperadmin: isSuper }),
  { ok: true })
eq('규칙 칸이 꺼져 있으면 통과',
  R.checkLineRules({ lines: [inp(1, 'approve', 101)], rules: { requireSuperadminApprover: false }, requesterIsSuperadmin: false, isSuperadmin: isSuper }),
  { ok: true })
eq('빈 결재선 — 이 검사에서도 걸린다(모양 검사는 validateLineInput 이 한다)',
  R.checkLineRules({ lines: [], rules: RULES, requesterIsSuperadmin: false, isSuperadmin: isSuper }).code,
  'superadmin_approver_required')
eq('lines 가 없어도 터지지 않는다',
  R.checkLineRules({ lines: null, rules: RULES, requesterIsSuperadmin: false, isSuperadmin: isSuper }).ok, false)
eq('안내 문구', [
  R.lineRuleNotice(RULES, false), R.lineRuleNotice(RULES, true),
  R.lineRuleNotice(undefined, false), R.lineRuleNotice({ requireSuperadminApprover: false }, false),
], ['결재자 중 관리자 1명 이상이 필요합니다.', null, null, null])
eq('등급 이름', R.SUPERADMIN_LABEL, '관리자')

// ════════════════════════════════════════════════════════════════
console.log('\n── expandTeamCc — 팀으로 참조 추가 ──')
const member = (engineer_id, resigned_date = null) => ({ engineer_id, resigned_date })
eq('그냥 더해진다', C.expandTeamCc({ members: [member(10), member(11)], requesterId: 1, taken: new Set(), max: 30 }),
  { added: [10, 11], skipped: [], overLimit: false })
eq('본인·퇴사자·이미 있는 사람을 이유와 함께 뺀다', C.expandTeamCc({
  members: [member(1), member(11, '2026-01-01'), member(12), member(13)],
  requesterId: 1, taken: new Set([12]), max: 30,
}), {
  added: [13],
  skipped: [{ reason: 'self', id: 1 }, { reason: 'resigned', id: 11 }, { reason: 'already', id: 12 }],
  overLimit: false,
})
eq('**본인이 퇴사자이기도 하면 「본인」이 먼저다**', C.expandTeamCc({
  members: [member(1, '2026-01-01')], requesterId: 1, taken: new Set(), max: 30,
}).skipped, [{ reason: 'self', id: 1 }])
eq('같은 사람이 두 번 들어오면 조용히 한 번만(이유로 세지 않는다)', C.expandTeamCc({
  members: [member(10), member(10)], requesterId: 1, taken: new Set(), max: 30,
}), { added: [10], skipped: [], overLimit: false })
eq('번호가 이상한 줄은 건너뛴다', C.expandTeamCc({
  members: [member(0), member(-1), member(10)], requesterId: 1, taken: new Set(), max: 30,
}), { added: [10], skipped: [], overLimit: false })
eq('상신자를 모를 때(null)는 본인 제외를 하지 않는다', C.expandTeamCc({
  members: [member(1)], requesterId: null, taken: new Set(), max: 30,
}).added, [1])
eq('빈 팀', C.expandTeamCc({ members: [], requesterId: 1, taken: new Set(), max: 30 }),
  { added: [], skipped: [], overLimit: false })
eq('상한 상수', C.TEAM_CC_MAX, 30)
{
  const thirty = Array.from({ length: 30 }, (_, i) => member(100 + i))
  const r30 = C.expandTeamCc({ members: thirty, requesterId: 1, taken: new Set(), max: C.TEAM_CC_MAX })
  eq('**딱 30명은 들어간다**', [r30.added.length, r30.overLimit], [30, false])
  const r31 = C.expandTeamCc({ members: [...thirty, member(999)], requesterId: 1, taken: new Set(), max: C.TEAM_CC_MAX })
  eq('**31명이면 하나도 안 넣는다**(절반만 들어가는 것이 가장 나쁘다)', [r31.added.length, r31.overLimit], [0, true])
  const r31b = C.expandTeamCc({
    members: [...thirty, member(998), member(999)], requesterId: 998, taken: new Set([999]), max: C.TEAM_CC_MAX,
  })
  eq('상한은 **뺀 뒤의 인원**으로 센다', [r31b.added.length, r31b.overLimit, r31b.skipped.length], [30, false, 2])
}

console.log('\n── summarizeTeamCc — 한 줄 문구 ──')
eq('뺀 사람이 없으면 추가만', C.summarizeTeamCc({ added: [10, 11], skipped: [], overLimit: false }), '2명 추가')
eq('이유별로 센다(이미·본인·퇴사 순)', C.summarizeTeamCc({
  added: [13],
  skipped: [{ reason: 'self', id: 1 }, { reason: 'resigned', id: 11 }, { reason: 'already', id: 12 }],
  overLimit: false,
}), '1명 추가, 3명 제외(이미 결재선에 있음 1, 본인 1, 퇴사 1)')
eq('같은 이유가 여러 건', C.summarizeTeamCc({
  added: [], skipped: [{ reason: 'already', id: 1 }, { reason: 'already', id: 2 }], overLimit: false,
}), '0명 추가, 2명 제외(이미 결재선에 있음 2)')
eq('할 말이 없으면 null(빈 팀)', C.summarizeTeamCc({ added: [], skipped: [], overLimit: false }), null)
eq('상한 문구는 따로 쓴다', C.TEAM_CC_OVER_MESSAGE,
  '한 번에 30명까지 추가할 수 있습니다. 팀 인원이 많으면 나눠서 추가해 주세요')

console.log(fails === 0 ? '\n모두 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
