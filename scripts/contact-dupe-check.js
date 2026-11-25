// 담당자 **중복 의심** 표시 (2026-11-26, 지시 N).
//
//   node scripts/contact-dupe-check.js
//
// 지키는 약속
//   ① 같은 **휴대폰**이나 같은 **이메일**을 쓰는 줄이 둘 이상이면 그 줄에 「중복?」이 붙는다.
//   ② **회사 전화는 보지 않는다** — 같은 사무실이면 같은 번호가 정상이다(그것까지 치면
//     한 사업장 전원에 뱃지가 붙는다).
//   ③ **이름은 견주지 않는다** — 같은 이름이 흔하다(김영수 둘).
//   ④ 번호 모양이 달라도 같은 번호로 본다(010-1234-5678 · 01012345678 · +82 10 1234 5678).
//   ⑤ **자동으로 합치지 않는다.** 호버에 사람이 할 일을 적는다.

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

const D = load(path.join(ROOT, 'lib/contactDupes.ts'))

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
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')
const marks = rows => [...D.dupeMarks(rows)].map(([id, m]) => [id, m.kind, m.count])

console.log('── ① 번호 고르기 ──')
eq('하이픈은 무시', D.normMobile('010-1234-5678'), '1012345678')
eq('붙여 써도 같다', D.normMobile('01012345678'), '1012345678')
eq('국가번호도 같다', D.normMobile('+82 10 1234 5678'), '1012345678')
eq('괄호·공백도 무시', D.normMobile('(010) 1234 5678'), '1012345678')
eq('번호로 보기 어려운 값은 견주지 않는다', [D.normMobile('1234'), D.normMobile(''), D.normMobile(null)], ['', '', ''])
eq('이메일은 소문자·공백 떼기', D.normEmail('  Kim@Example.COM '), 'kim@example.com')

console.log('\n── ② 같은 휴대폰 ──')
eq('둘이 같으면 둘 다 표시', marks([
  { contact_id: 1, name: '김민수', mobile: '010-1234-5678' },
  { contact_id: 2, name: '김 민수', mobile: '01012345678' },
]), [[1, 'mobile', 2], [2, 'mobile', 2]])
eq('셋이면 수가 셋', marks([
  { contact_id: 1, mobile: '010-1234-5678' },
  { contact_id: 2, mobile: '010-1234-5678' },
  { contact_id: 3, mobile: '010-1234-5678' },
]).map(m => m[2]), [3, 3, 3])
eq('다르면 아무 표시도 없다', marks([
  { contact_id: 1, mobile: '010-1111-1111' },
  { contact_id: 2, mobile: '010-2222-2222' },
]), [])
eq('비어 있는 줄끼리는 중복이 아니다', marks([
  { contact_id: 1, mobile: '' },
  { contact_id: 2, mobile: null },
]), [])

console.log('\n── ③ 같은 이메일 ──')
eq('이메일만 같아도 표시', marks([
  { contact_id: 1, email: 'kim@a.com' },
  { contact_id: 2, email: 'KIM@A.COM' },
]), [[1, 'email', 2], [2, 'email', 2]])
eq('둘 다 같으면 both', marks([
  { contact_id: 1, mobile: '010-1234-5678', email: 'kim@a.com' },
  { contact_id: 2, mobile: '010-1234-5678', email: 'kim@a.com' },
]).map(m => m[1]), ['both', 'both'])
eq('한쪽만 겹쳐도 그 줄은 표시', marks([
  { contact_id: 1, mobile: '010-1111-1111', email: 'kim@a.com' },
  { contact_id: 2, mobile: '010-2222-2222', email: 'kim@a.com' },
  { contact_id: 3, mobile: '010-3333-3333', email: 'lee@a.com' },
]).map(m => m[0]), [1, 2])

console.log('\n── ④ 보지 않는 것 ──')
eq('회사 전화가 같아도 표시하지 않는다', marks([
  { contact_id: 1, name: '김', phone: '031-123-4567' },
  { contact_id: 2, name: '이', phone: '031-123-4567' },
]), [])
eq('이름이 같아도 표시하지 않는다', marks([
  { contact_id: 1, name: '김영수', mobile: '010-1111-1111' },
  { contact_id: 2, name: '김영수', mobile: '010-2222-2222' },
]), [])
ok('그 이유를 적어 두었다',
  /같은 사무실 사람끼리 같은 번호를 쓰는 것이 정상/.test(read('lib/contactDupes.ts'))
  && /이름은 \*\*견주지 않는다\*\*/.test(read('lib/contactDupes.ts')))

console.log('\n── ⑤ 안내 글 ──')
eq('뱃지 글자', D.DUPE_BADGE, '중복?')
eq('호버 — 번호', D.dupeHint('mobile', 2, ['이철수']), '같은 번호 2명 (이철수) — 하나만 남기고 삭제하세요')
eq('호버 — 이메일', D.dupeHint('email', 3), '같은 이메일 3명 — 하나만 남기고 삭제하세요')
eq('호버 — 둘 다', D.dupeHint('both', 2), '같은 번호·이메일 2명 — 하나만 남기고 삭제하세요')
ok('이름을 함께 적는다(어느 줄과 겹치는지 알아야 지운다)',
  D.dupeMarks([
    { contact_id: 1, name: '김민수', mobile: '010-1234-5678' },
    { contact_id: 2, name: '김 민수', mobile: '010-1234-5678' },
  ]).get(1).hint.includes('김 민수'))
ok('합치는 말은 없다 — 지우라고만 한다', !/병합|합칩|합치기/.test(read('lib/contactDupes.ts').split('export function dupeHint')[1].slice(0, 400)))

console.log('\n── ⑥ 화면 ──')
const COL = read('components/customer/SiteInfoColumn.tsx')
const BAND = read('components/customer/HeaderBand.tsx')
ok('담당자 카드 줄에 뱃지가 붙는다', /dupe={dupes\.get\(c\.contact_id\)}/.test(COL) && /\{DUPE_BADGE\}/.test(COL))
ok('칩에도 붙는다(회사 머리줄)', /dupe={dupes\.get\(c\.contact_id\)}/.test(BAND) && /\{DUPE_BADGE\}/.test(BAND))
ok('호버 안내를 쓴다', /title=\{dupe\.hint\}/.test(COL) && /dupe \? dupe\.hint :/.test(BAND))
ok('목록에서 한 번만 센다', /useMemo\(\(\) => dupeMarks\(contacts\), \[contacts\]\)/.test(COL)
  && /useMemo\(\(\) => dupeMarks\(contacts\), \[contacts\]\)/.test(BAND))
ok('자동으로 합치는 길은 어디에도 없다',
  !/merge|병합/.test(COL) && !/merge|병합/.test(BAND))
// 색은 **lib 한 곳에만** 적는다 — 담당자 카드와 칩이 같은 값을 쓰고, SiteInfoColumn 에는
// hex 를 한 줄도 두지 않는다(scripts/site-v8-check.js 가 그것을 지킨다).
ok('뱃지 색은 한 곳에만 있다', /#fef3c7/.test(read('lib/contactDupes.ts')) && !/#[0-9a-fA-F]{6}/.test(COL))
ok('두 화면이 같은 색을 쓴다', /DUPE_BG/.test(COL) && /DUPE_BG/.test(BAND))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
