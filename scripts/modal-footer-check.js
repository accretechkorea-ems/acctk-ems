// 모달 **바닥줄** — 조각으로 준 버튼이 그려지는가 (2026-11-28, 야간4).
//
//   node scripts/modal-footer-check.js
//
// ── 왜 생겼나 ──────────────────────────────────────────────────────────────
//   2026-11-27(묶음5 1-3)에 바닥줄을 **슬롯 둘**({left, right})로도 받게 넓혔다.
//   조각 하나로 준 옛 길과 가르는 줄이 이것이었다:
//
//       !('$typeof' in f)        ← 달러 **하나**
//
//   React 조각의 표시는 `$$typeof`(달러 둘)다. 그래서 조각으로 준 바닥줄이 전부
//   **슬롯으로 읽혀** footer.left·footer.right 가 undefined 가 되고, **버튼이 하나도
//   그려지지 않았다**. 조각 바닥줄을 쓰는 모달은 확인 창을 포함해 70곳이 넘는다 —
//   그 사이 저장·취소·삭제가 전부 사라져 있었다. 포캐스트 등록 창을 캡처하다 보았다.
//
// 지키는 약속
//   ① 판정 함수는 **React 조각을 슬롯으로 보지 않는다**(실제 조각을 만들어 돌려 본다).
//   ② 슬롯 객체({left}/{right}/{})는 슬롯으로 본다.
//   ③ 소스에 달러 하나짜리 표시가 남아 있지 않다.
//
// 키도 서버도 없이 돈다.

const load = module.require.bind(module)
const path = load('path')
const fs = load('fs')
const ROOT = path.join(__dirname, '..')
const React = load(path.join(ROOT, 'node_modules/react'))

const SRC = fs.readFileSync(path.join(ROOT, 'components/common/ModalCard.tsx'), 'utf8')
const code = SRC.split(/\r?\n/).filter(l => {
  const t = l.trim()
  return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
}).join('\n')

const fails = []
let total = 0
const ok = (name, got, want = true) => {
  total += 1
  const same = JSON.stringify(got) === JSON.stringify(want)
  console.log(`${same ? 'OK  ' : 'FAIL'} ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
  if (!same) fails.push(name)
}

// 소스에서 판정 한 줄을 떼어 그대로 돌린다 — 글자만 보지 않는다.
const line = /const isSlots = [^\n]*\n[^\n]*/.exec(code)
if (!line) { console.error('isSlots 를 찾지 못했다'); process.exit(1) }
const body = line[0].slice(line[0].indexOf('=>') + 2).replace(/ as object/g, '').trim()
const isSlots = new Function('f', `return (${body})`)

console.log('── ① 조각은 슬롯이 아니다 ──')
const frag = React.createElement(React.Fragment, null,
  React.createElement('button', null, '취소'),
  React.createElement('button', null, '저장'))
ok('조각 하나로 준 바닥줄', isSlots(frag), false)
ok('요소 하나로 준 바닥줄', isSlots(React.createElement('button', null, '닫기')), false)
ok('조각 배열', isSlots([React.createElement('button', null, 'a')]), false)
ok('글자', isSlots('저장'), false)
ok('없음', isSlots(null), false)

console.log('── ② 슬롯 객체는 슬롯이다 ──')
ok('양쪽', isSlots({ left: frag, right: frag }))
ok('오른쪽만', isSlots({ right: frag }))
ok('빈 객체도 슬롯이다(자리를 비우려는 뜻)', isSlots({}))

console.log('── ③ 소스 ──')
ok('달러 **둘**로 가른다', /'\$\$typeof' in/.test(code))
ok('달러 하나짜리가 남아 있지 않다', /[^$]'\$typeof' in/.test(code), false)
ok('두 길을 다 그린다', /\{isSlots\(footer\) \? \(/.test(code) && /\) : footer\}/.test(code))

console.log('── ④ 조각 바닥줄을 쓰는 모달이 실제로 많다 ──')
// 많으니까 이 한 줄이 중요하다 — 숫자가 줄어도 올라도 막지 않고, **있다**만 본다.
const walk = (dir, out = []) => {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = path.join(dir, name)
    const st = fs.statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (name.endsWith('.tsx')) out.push(full)
  }
  return out
}
const files = [...walk(path.join(ROOT, 'app')), ...walk(path.join(ROOT, 'components'))]
const fragFooters = files.filter(f => /footer=\{</.test(fs.readFileSync(f, 'utf8')))
ok('조각 바닥줄을 쓰는 파일이 스무 곳을 넘는다', fragFooters.length > 20, true)
console.log(`     (지금 ${fragFooters.length}곳)`)

if (fails.length > 0) {
  console.error('\n실패:')
  for (const f of fails) console.error('  · ' + f)
  process.exit(1)
}
console.log(`\n통과 — 모달 바닥줄(검사 ${total}개 · 실패 0)`)
