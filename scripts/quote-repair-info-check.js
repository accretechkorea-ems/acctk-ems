// 견적의 수리 건 정보 규칙 시험 — 상태 판정 · 날짜 표기 · 연결 축.
//
//   node scripts/quote-repair-info-check.js
//
// 왜 따로 두는가 — 이 기능은 **화면 셋이 같은 판정**을 써야 한다(작성 화면의 패널,
// 목록 뱃지, 드로어). 한 곳만 기준이 달라지면 「목록은 완료인데 열어 보면 비어 있는」
// 꼴이 된다. 그리고 연결 축이 하나(repairs.quote_id)라는 것도 여기서 못 박는다.
//
// 네 가지 경우를 센다.
//   ① 수리 건 견적      — 수리 건이 걸려 있고 적은 내용에 따라 미작성/작성중/완료
//   ② 일반 견적         — 수리 건이 없으면 뱃지도 패널도 나오지 않는다
//   ③ 연결 후 확정      — 확정 전 고른 값이 초안에 남고, 확정은 그 값으로 간다
//   ④ 드로어 저장       — 저장 뒤 목록 뱃지가 그 자리에서 바뀐다

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

const {
  repairInfoState, REPAIR_INFO_LABEL, REPAIR_INFO_DOT, repairDate, shippedLabel,
} = load(path.join(ROOT, 'lib/quoteRepairInfo.ts'))
const { isDraftMeaningful } = load(path.join(ROOT, 'lib/quoteDraft.ts'))

let fails = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
}

const info = (symptom, cause, result) => ({ symptom, cause, result })

console.log('── ① 수리 건 견적 — 얼마나 적었나 ──')
eq('아무것도 안 적었으면 미작성', repairInfoState(info(null, null, null)), 'none')
eq('줄이 아예 없어도 미작성', repairInfoState(null), 'none')
eq('공백만 적은 것은 적은 것이 아니다', repairInfoState(info('  ', '\n', '')), 'none')
eq('증상만', repairInfoState(info('전원이 안 들어옴', null, null)), 'partial')
eq('증상·원인', repairInfoState(info('전원이 안 들어옴', '기판 소손', null)), 'partial')
eq('셋 다 적으면 완료', repairInfoState(info('전원이 안 들어옴', '기판 소손', '기판 교체')), 'done')
eq('결과만 비면 완료가 아니다', repairInfoState(info('a', 'b', '   ')), 'partial')
eq('뱃지 글자', [REPAIR_INFO_LABEL.none, REPAIR_INFO_LABEL.partial, REPAIR_INFO_LABEL.done],
  ['미작성', '작성중', '완료'])
eq('뱃지 점 색이 셋 다 다르다', new Set(Object.values(REPAIR_INFO_DOT)).size, 3)

console.log('\n── 읽기 줄의 날짜 ──')
eq('입고일', repairDate('2026-11-02'), '2026-11-02')
eq('시각이 붙어 있으면 날짜만', repairDate('2026-11-02T09:31:00+09:00'), '2026-11-02')
eq('비면 -', repairDate(null), '-')
// 출고일만 「미출고」다 — '-' 로 두면 적다 만 것처럼 보인다.
eq('아직 안 나갔으면 미출고', shippedLabel(null), '미출고')
eq('공백도 미출고', shippedLabel('   '), '미출고')
eq('나갔으면 그 날짜', shippedLabel('2026-11-10'), '2026-11-10')

console.log('\n── ② 일반 견적 ──')
// 라우트는 수리 건이 아닌 견적을 아예 담지 않는다(states 에서 continue). 화면은 그 표에
// 없는 견적에 단추를 내지 않는다 — 여기서는 그 약속을 글로 못 박는다.
const states = new Map([[101, { isRepair: true, state: 'none' }]])
eq('수리 건 견적에는 뱃지가 있다', states.get(101)?.isRepair === true, true)
eq('일반 견적은 표에 없다 → 단추 없음', states.get(202) ?? null, null)

console.log('\n── ③ 연결 후 확정 — 고른 값이 초안에 남는다 ──')
const baseDraft = {
  company: '', customerQuery: '', receiver: '', customerId: null, euCustomerId: null,
  opportunityId: null, showSignature: false, isDealer: false, termsOpen: false,
  recipientContactId: null, repairLinkId: null,
  repairInfo: { symptom: null, cause: null, result: null },
  rows: [],
}
eq('빈 초안은 저장하지 않는다', isDraftMeaningful(baseDraft), false)
eq('수리 건을 걸면 「쓰던 내용」이다', isDraftMeaningful({ ...baseDraft, repairLinkId: 77 }), true)
eq('수리 정보를 적어도 그렇다',
  isDraftMeaningful({ ...baseDraft, repairInfo: info('전원 불량', null, null) }), true)
eq('공백만 적은 것은 아니다',
  isDraftMeaningful({ ...baseDraft, repairInfo: info('   ', null, null) }), false)

console.log('\n── ④ 드로어 저장 — 뱃지가 그 자리에서 바뀐다 ──')
// 목록은 저장 결과를 다시 읽지 않고 **같은 판정 함수**로 제자리에서 고친다.
const saved = info('전원이 안 들어옴', '기판 소손', '기판 교체 후 정상')
const next = new Map(states).set(101, { isRepair: true, state: repairInfoState(saved) })
eq('미작성 → 완료', [states.get(101).state, next.get(101).state], ['none', 'done'])
eq('다른 행은 그대로', next.get(202) ?? null, null)
// 라우트도 저장 뒤 같은 상태를 돌려준다(화면과 서버가 같은 함수를 쓴다).
eq('일부만 저장하면 작성중', repairInfoState(info('전원이 안 들어옴', '', null)), 'partial')

console.log(fails === 0 ? '\n모두 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
