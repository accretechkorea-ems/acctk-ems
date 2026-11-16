// 견적 수신인(담당자) 규칙 시험 — 표기·고를 거리·옛 견적.
//
//   node scripts/quote-recipient-check.js
//
// 왜 따로 두는가 — 수신인은 **고객에게 나가는 문서의 첫 줄**이다(견적서의 「수신인 :」).
// 존칭이 겹치거나(「팀장님님」) 담당자를 바꾼 뒤 옛 글자가 남으면 그대로 인쇄돼 나간다.
// 읽는 곳이 넷이라(견적서·결재 검토표·내부 엑셀·다시쓰기) 규칙은 한 함수에 두고 여기서 센다.

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
  cleanPosition, contactOptionLabel, recipientLabel, displayRecipient,
} = load(path.join(ROOT, 'lib/quoteRecipient.ts'))

let fails = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
}

console.log('── 직위 다듬기 ──')
eq('앞뒤 공백', cleanPosition(' 과장 '), '과장')
// 실제 데이터에 있는 값들이다(2026-11-16 조사: " ", "팀장님", " 과장").
eq('이미 붙은 존칭을 뗀다', cleanPosition('팀장님'), '팀장')
eq('존칭이 겹쳐 있어도 뗀다', cleanPosition('팀장님님'), '팀장')
eq('공백만 든 값', cleanPosition(' '), '')
eq('null·undefined', [cleanPosition(null), cleanPosition(undefined)], ['', ''])

console.log('\n── 고르는 자리(존칭 없음) ──')
eq('이름 직위', contactOptionLabel({ name: '김소희', position: '과장' }), '김소희 과장')
eq('직위가 비면 이름만', contactOptionLabel({ name: '박보경', position: null }), '박보경')
eq('직위에 존칭이 붙어 있어도 뗀다', contactOptionLabel({ name: '이도훈', position: '팀장님' }), '이도훈 팀장')

console.log('\n── 문서에 찍히는 글자 ──')
eq('이름 + 직위 + 님', recipientLabel({ name: '김소희', position: '과장' }), '김소희 과장님')
eq('직위가 비면 이름 + 님', recipientLabel({ name: '박보경', position: ' ' }), '박보경님')
eq('존칭 겹침 없음', recipientLabel({ name: '이도훈', position: '팀장님' }), '이도훈 팀장님')
eq('이름이 비면 빈 글자', recipientLabel({ name: '', position: '과장' }), '')
eq('담당자가 없으면 빈 글자', recipientLabel(null), '')

console.log('\n── 읽는 곳이 함께 쓰는 규칙(네 군데) ──')
// ① 담당자가 연결된 새 견적
eq('담당자가 있으면 그 이름으로 짓는다',
  displayRecipient({ name: '김소희', position: '과장' }, null), '김소희 과장님')
// ② 옛 견적 — FK 가 없고 글자만 있다(저장된 145건이 이 꼴이다)
eq('옛 견적은 적혀 있던 글자 그대로',
  displayRecipient(null, '김강민 선임님'), '김강민 선임님')
eq('옛 글자의 앞뒤 공백은 턴다', displayRecipient(null, '  정준호 대표님 '), '정준호 대표님')
// ③ 담당자를 고른 견적에 옛 글자가 함께 남아 있어도 **담당자가 먼저**다
//    (저장할 때 그 시점 표기를 recipient 에 함께 남기므로 둘 다 있는 줄이 생긴다)
eq('둘 다 있으면 담당자가 이긴다',
  displayRecipient({ name: '김소희', position: '차장' }, '김소희 과장님'), '김소희 차장님')
// ④ 담당자가 0명인 고객사 — 고른 것도 적힌 것도 없다
eq('둘 다 없으면 빈 글자', displayRecipient(null, null), '')
eq('빈 글자끼리', displayRecipient(null, '   '), '')

console.log(fails === 0 ? '\n모두 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
