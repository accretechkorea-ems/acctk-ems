/**
 * **모서리 둥글기는 토큰만 쓴다** — lib/radius.ts 의 `R`.
 *
 * 왜 하네스가 필요한가 (2026-11-20 전수조사)
 *   같은 역할의 모서리가 값 15가지로 흩어져 있었다 — 6(444회)·8(314회)·10(56)·
 *   20(28)·16(27)·14(18)·18(16)·4(15)·7(13)·12(11)·11(10)·9·5·2·3.
 *   화면마다 손으로 적다 보니 카드가 8인 곳과 12인 곳이 섞였고, 7·9·11px 처럼
 *   아무 뜻 없는 값도 생겼다. 토큰으로 모아 두면 한 자리를 고쳐 전부 따라온다.
 *
 * 무엇을 막는가
 *   · `borderRadius: 8` 처럼 **숫자를 직접 적는 것**
 *   · `borderRadius: '8px'` 처럼 한 값을 문자열로 적는 것
 *
 * 무엇을 허용하는가(토큰 밖 예외 — 조사에서 추린 목록이다)
 *   · `'50%'` — 아바타·상태 점·지도 마커. 원형은 토큰이 아니다.
 *   · 한쪽만 둥근 복합값(`'4px 4px 0 0'`, `'8px 0 0 8px'`, `'14px 14px 0 0'`)
 *     — 막대 끝단·좌측 띠·탭 머리. 역할이 하나가 아니라 토큰에 담기지 않는다.
 *   · 값이 **계산**인 자리(`borderRadius: height`, `radius`, `changed ? 0 : undefined`)
 *   · `borderRadius: 0` — 각지게 하는 것은 토큰이 아니다.
 *   · 아래 ALLOW 에 적힌 한 줄(2px 선의 끝 1px 하나)
 *   · 지도 마커·메일 HTML 처럼 **CSS 문자열**로 만드는 자리(`border-radius:8px`)
 *     — 리터럴 문자열이라 토큰을 끼울 수 없다. 이 검사는 인라인 style 만 본다.
 */
// 맨 require() 는 eslint 경고를 남긴다(no-require-imports). 이 파일은 node 로 직접
// 돌리는 CJS 하네스라 그렇게 불러올 수밖에 없으니, run-checks.js 와 같은 방식으로
// 한 번만 묶어 둔다 — 경고 기준선을 올리지 않으려고.
const load = module.require.bind(module)
const fs = load('fs')
const path = load('path')

const ROOT = path.resolve(__dirname, '..')
const SRC = ['components', 'app', 'lib', 'hooks'].map(d => path.join(ROOT, d))
const TOKENS = path.join(ROOT, 'lib', 'radius.ts')

/** 토큰 밖에 남겨 둔 한 줄 — 왜 남겼는지 같이 적는다. */
const ALLOW = [
  { file: 'components/sales/salesChart.tsx', value: '1', why: '2px 선의 끝 — 반지름이 선 굵기의 절반' },
]

const walk = (dir, out = []) => {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) walk(p, out)
    else if (/\.(tsx|ts)$/.test(name)) out.push(p)
  }
  return out
}

const files = SRC.filter(d => fs.existsSync(d)).flatMap(d => walk(d))
const rel = p => p.replace(ROOT + path.sep, '').split(path.sep).join('/')

let fail = 0
const bad = (file, line, why) => {
  fail++
  console.error(`  ✗ ${rel(file)}:${line} — ${why}`)
}

// ── ① 토큰 파일이 제자리에 있고 역할이 다 들어 있는가 ──────────────────────
console.log('[radius] 토큰 정본')
const ROLES = ['card', 'modal', 'control', 'icon', 'tag', 'pill', 'tile']
if (!fs.existsSync(TOKENS)) {
  fail++
  console.error('  ✗ lib/radius.ts 가 없다')
} else {
  const src = fs.readFileSync(TOKENS, 'utf8')
  for (const role of ROLES) {
    if (new RegExp(`\\b${role}:\\s*\\d`).test(src)) console.log(`  ✓ R.${role}`)
    else { fail++; console.error(`  ✗ R.${role} 가 없다`) }
  }
}

// ── ② CSS 쪽 짝이 어긋나지 않았는가 ───────────────────────────────────────
console.log('[radius] globals.css 와 값이 같은가')
{
  const css = fs.readFileSync(path.join(ROOT, 'app', 'globals.css'), 'utf8')
  const ts = fs.existsSync(TOKENS) ? fs.readFileSync(TOKENS, 'utf8') : ''
  for (const role of ROLES) {
    const inTs = ts.match(new RegExp(`\\b${role}:\\s*(\\d+)`))
    const inCss = css.match(new RegExp(`--radius-${role}:\\s*(\\d+)px`))
    if (!inTs) continue
    if (!inCss) { fail++; console.error(`  ✗ --radius-${role} 가 globals.css 에 없다`) }
    else if (inCss[1] !== inTs[1]) {
      fail++
      console.error(`  ✗ R.${role}=${inTs[1]} 인데 --radius-${role}=${inCss[1]}px 이다`)
    }
  }
  if (fail === 0) console.log('  ✓ 일곱 값 모두 같다')
}

// ── ③ 숫자를 직접 적은 자리 ───────────────────────────────────────────────
console.log('[radius] 토큰 밖의 직접 값')
const allowed = new Set(ALLOW.map(a => `${a.file}|${a.value}`))
let direct = 0
for (const f of files) {
  if (f === TOKENS) continue
  const lines = fs.readFileSync(f, 'utf8').split('\n')
  lines.forEach((text, i) => {
    const re = /borderRadius:\s*([^,}\n]+)/g
    let m
    while ((m = re.exec(text))) {
      const expr = m[1].trim()
      // 문자열: '50%' 와 복합값은 예외, '8px' 꼴만 잡는다
      const one = expr.match(/^'(\d+)px'$/)
      if (one) { bad(f, i + 1, `'${one[1]}px' — R 토큰을 쓴다`); direct++; continue }
      if (/['"`]/.test(expr)) continue
      const nums = expr.match(/\b\d+\b/g)
      if (!nums) continue
      for (const n of nums) {
        if (n === '0') continue
        if (allowed.has(`${rel(f)}|${n}`)) continue
        bad(f, i + 1, `${n} — R 토큰을 쓴다`)
        direct++
      }
    }
  })
}
if (direct === 0) console.log('  ✓ 0건')

// ── ④ 바꾸다 만 것이 아닌가 ───────────────────────────────────────────────
console.log('[radius] 토큰을 쓰는 파일')
const users = files.filter(f => f !== TOKENS && /from '@\/lib\/radius'/.test(fs.readFileSync(f, 'utf8')))
console.log(`  ✓ ${users.length}곳`)
if (users.length < 100) { fail++; console.error('  ✗ 바꾸다 만 것으로 보인다(100곳 미만)') }

// ── ⑤ 남겨 둔 예외는 적힌 그대로 있는가 ───────────────────────────────────
console.log('[radius] 적어 둔 예외')
for (const a of ALLOW) {
  const p = path.join(ROOT, a.file)
  const ok = fs.existsSync(p) && new RegExp(`borderRadius:\\s*${a.value}\\b`).test(fs.readFileSync(p, 'utf8'))
  if (ok) console.log(`  ✓ ${a.file} ${a.value} — ${a.why}`)
  else { fail++; console.error(`  ✗ ${a.file} 의 예외(${a.value})가 사라졌다 — ALLOW 를 고친다`) }
}

if (fail > 0) { console.error(`\n[radius] 실패 ${fail}건`); process.exit(1) }
console.log('\n[radius] 전부 통과')
