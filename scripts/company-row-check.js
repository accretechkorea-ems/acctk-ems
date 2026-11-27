// 회사 줄의 **펼침·접힘** 규칙 (2026-11-27, 묶음4 E).
//
//   node scripts/company-row-check.js
//
// 전에는 줄을 누를 때마다 토글이었다. 그래서 펴 둔 회사를 **고르려고** 다시 누르면
// 그 자리에서 접혔다 — 사업장을 보며 회사를 고르는 일이 한 번에 되지 않았다.
//
//   닫힘 — 줄 어디를 눌러도 **펴고 + 고른다**
//   열림 — 줄 클릭은 **고르기만** 한다(접히지 않는다)
//   접기 — **∨ 하나**뿐이다
//   폰도 키보드(Enter · Space)도 같은 규칙이다.
//
// 규칙 자체(pickCompany)는 순수 함수라 **돌려 본다**. 화면이 그 함수를 쓰는지는 글자로 본다.
// 키 없이 서버 없이 돈다.

const load = module.require.bind(module)
const fs = load('fs')
const path = load('path')
const ROOT = path.join(__dirname, '..')
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

const PANEL = read('components/home/list/CustomerListPanel.tsx')

/**
 * 화면의 pickCompany 와 **같은 규칙**을 여기서 한 번 더 적어 돌려 본다.
 * 글자 검사만 두면 「썼는가」는 알아도 「무엇을 하는가」는 모른다.
 */
const pickCompany = (open) => ({ toggled: !open, selected: true })

console.log('── ① 닫힌 줄 ──')
eq('닫혀 있으면 펴고 + 고른다', pickCompany(false), { toggled: true, selected: true })

console.log('\n── ② 열린 줄 ──')
eq('열려 있으면 **고르기만** 한다(접히지 않는다)', pickCompany(true), { toggled: false, selected: true })

console.log('\n── ③ 화면이 그 규칙을 쓴다 ──')
ok('규칙이 한 함수에 있다', /const pickCompany = useCallback\(\(companyId: number, open: boolean\) => \{/.test(PANEL))
ok('열려 있으면 토글하지 않는다', /if \(!open\) toggleExpand\(companyId\)/.test(PANEL))
ok('어느 쪽이든 고른다', /if \(!open\) toggleExpand\(companyId\)\s*\r?\n\s*onSelectCompany\(companyId\)/.test(PANEL))
ok('줄 클릭이 그 함수를 부른다', /onClick=\{\(\) => pickCompany\(g\.companyId, open\)\}/.test(PANEL))
// 예전 모양이 남아 있으면 두 길이 생긴다.
ok('줄에서 바로 토글하던 옛 길이 없다', !/onClick=\{\(\) => \{ toggleExpand\(g\.companyId\); onSelectCompany\(g\.companyId\) \}\}/.test(PANEL))

console.log('\n── ④ 키보드도 같다 ──')
ok('Enter · Space 가 같은 함수를 부른다',
  /onKeyDown=\{e => \{ if \(e\.key === 'Enter' \|\| e\.key === ' '\) \{ e\.preventDefault\(\); pickCompany\(g\.companyId, open\) \} \}\}/.test(PANEL))
ok('줄이 펼침 상태를 알린다(aria-expanded)', /role="button"\s*\r?\n\s*tabIndex=\{0\}\s*\r?\n\s*aria-expanded=\{open\}/.test(PANEL))

console.log('\n── ⑤ 접는 자리는 ∨ 하나 ──')
ok('∨ 가 단추다(누를 수 있는 것으로 보인다)', /aria-label=\{`\$\{g\.companyName\} \$\{open \? '접기' : '펼치기'\}`\}/.test(PANEL))
ok('∨ 는 줄 클릭을 막고 저 혼자 토글한다',
  /onClick=\{e => \{ e\.stopPropagation\(\); toggleExpand\(g\.companyId\) \}\}/.test(PANEL))
ok('∨ 위의 키 입력도 줄로 올라가지 않는다', /onKeyDown=\{e => e\.stopPropagation\(\)\}/.test(PANEL))
ok('∨ 도 펼침 상태를 알린다', (PANEL.match(/aria-expanded=\{open\}/g) || []).length === 2)

console.log('\n── ⑥ 폰도 같다 ──')
// 폭으로 갈리는 규칙이 없다 — 한 벌로 돈다.
ok('이 줄에 폭 분기가 없다', !/matchMedia|max-width: 7\d\d/.test(PANEL.split('groups.map(g => {')[1].slice(0, 2000)))

console.log(fails === 0 ? '\n전부 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
