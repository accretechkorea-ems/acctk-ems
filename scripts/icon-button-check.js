/**
 * 수정·추가 **아이콘 버튼은 공용 하나만** 쓴다 — components/common/IconButton.tsx.
 *
 * 전수조사(2026-11-20): 같은 「고치기」가 테두리 있는 정사각형·테두리 없는 연필·글자
 * 「수정」 버튼·화면마다 만든 iconBtn 으로 네 가지였다. 누르는 자리가 매번 달라 보이면
 * 사람은 그때그때 다시 찾는다. 그래서 **연필·더하기 svg 를 직접 그린 버튼**을 막는다.
 *
 * 무엇을 막는가
 *   · 연필 path(M18.5 2.5 / M16.5 3.5 꼴)를 품은 <svg> 가 소스에 또 생기는 것
 *   · aria-label/title 이 「… 수정」인데 공용 버튼을 쓰지 않은 <button>
 *
 * 무엇을 허용하는가
 *   · components/common/IconButton.tsx 자신(원본이 여기 있다)
 *   · **글자가 있는** 버튼(「수정」 글자 버튼·「+ 사업장 추가」) — 표의 행동 묶음은 글자가 낫다
 *   · 연필이 아닌 아이콘(닫기·복사·화살표…)
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const SRC = ['components', 'app', 'lib', 'hooks'].map(d => path.join(ROOT, d))
/** 원본이 있는 곳 — 여기서는 직접 그려야 한다. */
const ALLOW = [path.join(ROOT, 'components', 'common', 'IconButton.tsx')]

/** 연필 아이콘의 손잡이 — 모양이 조금씩 달라도 이 두 꼴 중 하나다. */
const PENCIL = [/M18\.5 2\.5a2\.121/, /M16\.5 3\.5a2\.1/]

const walk = (dir, out = []) => {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.(tsx|ts)$/.test(name)) out.push(p)
  }
  return out
}

const files = SRC.filter(d => fs.existsSync(d)).flatMap(d => walk(d))
const rel = p => p.replace(ROOT + path.sep, '').replace(/\\/g, '/')

let fail = 0
const bad = (file, line, why) => {
  fail++
  console.error(`  ✗ ${rel(file)}:${line} — ${why}`)
}

console.log('[icon-button] 연필 아이콘을 직접 그린 자리')
for (const f of files) {
  if (ALLOW.includes(f)) continue
  const lines = fs.readFileSync(f, 'utf8').split('\n')
  lines.forEach((text, i) => {
    if (PENCIL.some(re => re.test(text))) {
      bad(f, i + 1, '연필 svg 를 직접 그렸다 — EditIconButton 을 쓴다')
    }
  })
}
if (fail === 0) console.log('  ✓ 없음')

console.log('[icon-button] 공용 버튼이 제자리에 있는가')
const srcIcon = fs.readFileSync(ALLOW[0], 'utf8')
for (const [name, why] of [['EditIconButton', '수정'], ['AddIconButton', '추가']]) {
  if (srcIcon.includes(`export function ${name}`)) console.log(`  ✓ ${name} (${why})`)
  else { fail++; console.error(`  ✗ ${name} 가 없다`) }
}

console.log('[icon-button] 공용 버튼을 쓰는 화면')
const users = files.filter(f => !ALLOW.includes(f) && /from '@\/components\/common\/IconButton'/.test(fs.readFileSync(f, 'utf8')))
console.log(`  ✓ ${users.length}곳: ${users.map(rel).join(', ')}`)
if (users.length < 5) { fail++; console.error('  ✗ 바꾸다 만 것으로 보인다(5곳 미만)') }

if (fail > 0) { console.error(`\n[icon-button] 실패 ${fail}건`); process.exit(1) }
console.log('\n[icon-button] 전부 통과')
