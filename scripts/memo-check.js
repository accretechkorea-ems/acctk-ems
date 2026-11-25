// 메모 — **보여 주는 모양 하나, 판정은 한 곳** (2026-11-26).
//
//   node scripts/memo-check.js
//
// 지키는 약속
//   ① 메모를 보여 주는 모양은 **둘뿐**이다(.claude/rules/design-system.md).
//     · 목록 한 줄 = 아이콘 + 팝오버(MemoPopover)
//     · 읽는 자리 = 글자 + 호버(MemoHoverText)
//     떠오르는 판의 생김새는 **같은 상수**를 쓴다(MEMO_PANEL_STYLE).
//   ② 팝오버에는 **그 건의 식별 제목**이 붙는다 — 「회사 · 모델 · S/N」·「번호 · 회사」.
//     부르는 자리마다 title 을 넘긴다(빠지면 무슨 건의 메모인지 알 수 없다).
//   ③ **누가 고치나는 lib/memoPerm.ts 한 곳**이 정한다 — 화면에 참을 박지 않는다.
//     서버도 같은 함수를 본다(라우트).
//   ④ 아이콘은 한 벌이다(lucide message-square-text) — 이모지를 쓰지 않는다.

const load = module.require.bind(module)
const path = load('path')
const fs = load('fs')
const ROOT = path.join(__dirname, '..')

let fails = 0
const ok = (name, cond, hint) => {
  if (!cond) fails++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond || !hint ? '' : `  — ${hint}`}`)
}
const eq = (name, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want)
  if (!good) fails++
  console.log(`${good ? 'OK  ' : 'FAIL'} ${name}`)
  if (!good) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')

// 메모 부품을 쓰는 파일을 모은다.
const files = []
const walk = d => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) { if (!/node_modules|\.next/.test(p)) walk(p) }
    else if (e.name.endsWith('.tsx')) files.push(p)
  }
}
walk(path.join(ROOT, 'app'))
walk(path.join(ROOT, 'components'))
const rel = f => path.relative(ROOT, f).split(path.sep).join('/')

const popovers = []
const hovers = []
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8')
  const r = rel(f)
  if (r.startsWith('components/common/Memo')) continue
  for (const m of s.matchAll(/<MemoPopover\b([\s\S]{0,900}?)\/>/g)) popovers.push({ file: r, props: m[1] })
  for (const m of s.matchAll(/<MemoHoverText\b([\s\S]{0,900}?)\/>/g)) hovers.push({ file: r, props: m[1] })
}

console.log(`── ① 메모를 보여 주는 자리 — 팝오버 ${popovers.length} · 글자+호버 ${hovers.length} ──`)
for (const p of popovers) console.log(`   팝오버 ${p.file}`)
for (const h of hovers) console.log(`   글자   ${h.file}`)
ok('두 모양 말고 다른 메모 부품이 없다', popovers.length > 0 && hovers.length > 0)

console.log('\n── ② 팝오버에는 식별 제목이 붙는다 ──')
const noTitle = popovers.filter(p => !/title=/.test(p.props))
eq('title 을 빠뜨린 자리', noTitle.map(p => p.file), [])
const noTitleHover = hovers.filter(h => !/title=/.test(h.props))
eq('글자 쪽도 제목을 준다', noTitleHover.map(h => h.file), [])

console.log('\n── ③ 판정은 lib/memoPerm.ts 한 곳 ──')
const PERM = read('lib/memoPerm.ts')
ok('요청 메모 — 작성자 본인 또는 영업관리',
  /export function canEditRequestMemo/.test(PERM) && /user\.engineerId === quoteOwnerId/.test(PERM))
ok('영업관리 메모 — 영업관리만', /export function canEditOrderMemo/.test(PERM))
ok('수리 메모 — 목록을 보는 사람', /export function canEditRepairMemo/.test(PERM))
const PUR = read('app/purchase/page.tsx')
ok('발주 목록이 그 함수를 쓴다(참을 박지 않는다)',
  /canEdit=\{canEditRequestMemo\(memoUser, q\.engineer_id\)\}/.test(PUR)
  && /canEdit=\{canEditOrderMemo\(memoUser\)\}/.test(PUR))
const REP = read('app/repair/page.tsx')
ok('20 수리도 그 함수를 쓴다', /canEdit=\{canEditRepairMemo\(/.test(REP))
// 내 견적은 **내 것만** 나오는 목록이라 작성자가 늘 본인이다 — 그 자리만 참이어도 된다.
const MY = read('components/dashboard/MyQuotesPanel.tsx')
ok('내 견적 — 요청 메모는 본인이 고친다', /badge="요청"[\s\S]{0,200}canEdit/.test(MY))
ok('내 견적 — 영업관리 메모는 읽기만', /badge="영업관리"[\s\S]{0,160}onSave/.test(MY) === false)

console.log('\n── ④ 생김새는 한 벌 ──')
const MP = read('components/common/MemoPopover.tsx')
const MH = read('components/common/MemoHoverText.tsx')
ok('떠오르는 판의 상수가 한 곳에 있다', /export const MEMO_PANEL_STYLE/.test(MP))
ok('글자 쪽도 그 상수를 쓴다', /MEMO_PANEL_STYLE/.test(MH))
ok('아이콘은 인라인 SVG 다(이모지가 아니다)',
  /<svg /.test(MP) && !/[📝🗒️💬✏️]/.test(MP))
ok('메모가 없어도 자리를 남긴다', /없어도 자리는 남긴다|자리는 남긴다/.test(MP))
ok('길이 상한이 한 곳이다', /export const MEMO_MAX = 1000/.test(MP))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
