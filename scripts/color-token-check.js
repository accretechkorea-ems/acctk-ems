// 색 토큰이 **디자인 표와 같은 값**인지 — 그리고 직접 표기가 늘지 않는지 (2026-11-21)
//
// ── 왜 ──────────────────────────────────────────────────────────────────────
//   globals.css 의 토큰은 처음에 「전수 조사의 최다 빈도값」으로 넣었다. 그 방식은 네
//   자리에서 디자인 표와 **다른 값**을 골랐다(페이지 배경·테두리·본문 진함·위험).
//   토큰을 var() 로 부르는 자리가 아직 없어 화면에는 드러나지 않았지만, 그대로 두고
//   치환을 시작하면 그 네 색이 화면 전체에서 조용히 바뀐다.
//
//   정본은 **화면**이다 — .claude/rules/design-system.md 의 색상 표. 이 하네스는 표를
//   읽어 토큰과 맞춰 본다. 표를 고치면 토큰도 고쳐야 하고, 그 반대도 같다.
//
// ── 두 번째 일: 직접 표기 기준선 ──────────────────────────────────────────────
//   토큰과 **같은 값**을 손으로 적은 자리가 지금 1895건(148파일)이다. 그것을
//   var(--토큰) 으로 옮기는 일은 아직 하지 않았다(2026-11-21 조사 결과 — 그 중 일부는
//   SVG 속성·캔버스·PDF·주석이라 var() 가 듣지 않는다. docs/color-token-20261121.md).
//   여기서는 **늘지 않는 것만** 지킨다. 새로 적는 색은 토큰을 부르거나, 적어도 이
//   숫자를 넘기지 않아야 한다.

const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')

let fail = 0
const ok = (name, cond, hint) => {
  if (cond) console.log(`OK   ${name}`)
  else { fail++; console.error(`FAIL ${name}${hint ? `  — ${hint}` : ''}`) }
}

// ── 표 읽기 ────────────────────────────────────────────────────────────────
const rules = fs.readFileSync(path.join(ROOT, '.claude/rules/design-system.md'), 'utf8')
/** 역할 → 표의 값. `| 역할 | `#hex` | …` 꼴 줄만 읽는다. */
const table = {}
for (const line of rules.split(/\r?\n/)) {
  const m = line.match(/^\|\s*([^|]+?)\s*\|\s*`(#[0-9a-fA-F]{3,6})`\s*\|/)
  if (m) table[m[1].trim()] = m[2].toLowerCase()
}

// ── 토큰 읽기 ──────────────────────────────────────────────────────────────
const css = fs.readFileSync(path.join(ROOT, 'app/globals.css'), 'utf8')
const tokens = {}
for (const m of css.matchAll(/(--color-[a-z-]+):\s*(#[0-9a-fA-F]{3,6})\s*;/g)) {
  tokens[m[1]] = m[2].toLowerCase()
}

console.log('\n── ① 표에 있는 역할은 토큰과 값이 같다 ──')
/** 표의 역할 ↔ 토큰 이름. 표에 없는 역할(틴트·보조 배경 등)은 여기 두지 않는다. */
const PAIRS = [
  ['페이지 배경', '--color-bg'],
  ['표면(카드/모달/팝업) 배경', '--color-surface'],
  ['표면(카드/모달/팝업) 배경', '--color-white'],
  ['테두리', '--color-border'],
  ['카드 hover 테두리', '--color-brand-border'],
  ['텍스트 - 진함', '--color-ink'],
  ['텍스트 - 라벨', '--color-text-label'],
  ['텍스트 - 보조', '--color-text-secondary'],
  ['텍스트 - 흐림', '--color-text-muted'],
  ['텍스트 - 가장 흐림', '--color-text-disabled'],
  ['액센트', '--color-brand'],
  ['액센트 hover', '--color-brand-dark'],
  ['위험(누락 경고)', '--color-danger'],
]
for (const [role, token] of PAIRS) {
  const want = table[role]
  const got = tokens[token]
  ok(`${role} = ${token}`, want != null && got === want, `표 ${want ?? '(역할 못 찾음)'} ≠ 토큰 ${got ?? '(토큰 없음)'}`)
}

console.log('\n── ② 네 토큰을 고친 근거: var() 로 부르는 자리 ──')
// 고칠 때 0건이었다. 지금 몇 건이든 **값이 표와 같으면** 문제가 아니다 — ①이 그것을 본다.
// 여기서는 숫자만 적어 둔다(바뀐 날을 알아보는 데 쓴다).
const SKIP_DIR = new Set(['node_modules', '.next', '.next-perf', '.git'])
const files = []
const walk = d => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) walk(path.join(d, e.name)); continue }
    if (/\.(ts|tsx|css|mjs|js)$/.test(e.name)) files.push(path.join(d, e.name))
  }
}
for (const d of ['app', 'components', 'lib', 'hooks', 'scripts']) walk(path.join(ROOT, d))

const varUse = {}
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8')
  for (const m of text.matchAll(/var\((--color-[a-z-]+)\)/g)) varUse[m[1]] = (varUse[m[1]] || 0) + 1
}
for (const t of ['--color-bg', '--color-border', '--color-ink', '--color-danger']) {
  console.log(`     ${t} 를 var() 로 쓰는 자리: ${varUse[t] || 0}건`)
}

console.log('\n── ③ 토큰과 같은 값의 직접 표기는 늘지 않는다 ──')
/**
 * 기준선. 옮기는 일을 시작하면 **내려야** 한다(올라가면 하네스가 막는다).
 * PDF(react-pdf)는 var() 를 모르므로 세지 않는다.
 *
 * 2026-11-21 … 1895
 * 2026-11-23 … 1914 — 명함 화면(목록·등록 창)이 든 표의 값 넷.
 * 2026-11-23 … 1910 — 명함 하네스도 그 색 셋을 기대값으로 들고 있다(scripts/business-card-check.js).
 * 2026-11-23 … 1907 — 명함의 나이 꼬리표 색 셋(초록·주황·빨강, lib/businessCard.ts).
 *   표의 상태색 그대로다. 그 셋을 내보내는 공용 자리가 없어 그 파일에 적었다.
 * 2026-11-23 … 1915 — 글자색 전역 규칙으로 **토큰 하나가 늘었다**(#4b5563, 안내문·보조).
 *   손으로 적은 색이 늘어서가 아니다 — 원래 있던 #6b7280 자리들이 그 값으로 옮겨 갔고,
 *   그 값이 토큰이 되면서 세는 대상에 들어왔다. 역할 토큰을 적어 둔 두 파일(lib/textTokens.ts ·
 *   scripts/text-color-check.js)도 그 값을 들고 있어 파일 수가 148 → 150 이 됐다.
 * 2026-11-25 … 1915 / 154 — 명함 **검토 화면**(app/cards/import)이 새로 생겼다.
 *   시안의 상태 뱃지 색(승인 초록·건너뜀 빨강·합침 남색·중복 주황)을 쓴다. 그 값들은
 *   표에 없는 **상태색**이라 토큰이 없다 — 한 파일 안에 BADGE 로 모아 두었다.
 *   쓸 수 있는 토큰(NEUTRAL_BG·SUB·MUTED·SKELETON·CARD_BG)은 전부 토큰으로 썼다.
 * 2026-11-26 … 1915 / 155 — 홈 화면 앱의 로그인 안내 한 줄(components/auth/StandaloneNote.tsx).
 * 2026-11-27 … 1915 / 156 — **툴팁**(components/common/Tooltip.tsx). 바탕 #1f2937 은
 *   디자인 표에 없던 값인데, 캔버스 Tooltips E안이 못 박은 값이라 그대로 썼다. 어두운
 *   말풍선은 흰 바탕 위에서만 서는 자리라 본문 글자색(#111827)을 쓸 수 없다. **판단 필요**.
 *   **건수는 늘지 않았다** — 파일만 하나 늘었다. 로그인 화면은 어두운 바탕이라 제 색을
 *   따로 쓰는데(#111 · #2a2a2a 는 토큰이 아니다), 그 가운데 글자색 하나(#6b7280)가
 *   토큰과 같은 값이다. 로그인 화면의 다른 안내 두 줄(무활동·퇴사)과 **똑같은 모양**이어야
 *   해서 그 값을 그대로 적었다 — 그 두 줄도 같은 값을 손으로 들고 있다.
 */
const BASELINE = 1915
const BASELINE_FILES = 156
const byValue = new Map()
const byFile = new Map()
const tokenValues = new Map()      // 값 → 토큰 이름(여럿이면 첫 번째)
for (const [t, v] of Object.entries(tokens)) if (!tokenValues.has(v)) tokenValues.set(v, t)

let total = 0
for (const f of files) {
  const rel = path.relative(ROOT, f).split(path.sep).join('/')
  const text = fs.readFileSync(f, 'utf8')
  if (/@react-pdf\/renderer/.test(text)) continue
  let n = 0
  for (const m of text.matchAll(/#[0-9a-fA-F]{6}\b/g)) {
    const hex = m[0].toLowerCase()
    if (!tokenValues.has(hex)) continue
    n++; total++
    byValue.set(hex, (byValue.get(hex) || 0) + 1)
  }
  if (n) byFile.set(rel, n)
}
ok(`직접 표기 ${total}건 ≤ 기준선 ${BASELINE}`, total <= BASELINE, `${total - BASELINE}건 늘었다 — 새 색은 토큰을 부른다`)
ok(`그 값을 든 파일 ${byFile.size}개 ≤ 기준선 ${BASELINE_FILES}`, byFile.size <= BASELINE_FILES, `${byFile.size - BASELINE_FILES}파일 늘었다`)
const top = [...byValue.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
console.log('     많은 값: ' + top.map(([v, n]) => `${v} ${n}건(${tokenValues.get(v)})`).join(' · '))

console.log(fail === 0 ? '\n전부 통과' : `\n${fail}건 실패`)
process.exit(fail === 0 ? 0 : 1)
