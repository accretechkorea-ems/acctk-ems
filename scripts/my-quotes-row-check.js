// 내 견적 목록 — **한 줄은 두 줄이고 높이는 42px 고정** (2026-11-28, 야간4 2-2).
//
//   node scripts/my-quotes-row-check.js
//
// ── 왜 하네스가 재는가 ─────────────────────────────────────────────────────
//   시험 계정(engineers 226 · 이름 e2e)에는 **견적이 0건**이다. 모달을 열어도 표가
//   「견적이 없습니다」라 줄 높이를 브라우저에서 잴 수 없고, 견적을 만들어 재는 것은
//   **견적 번호를 소모**하므로 금지다. 그래서 높이를 만드는 값들을 여기서 못 박는다:
//   ROW_H · 칸 패딩 · 줄간 · 칸마다 줄이 **둘**이라는 것.
//
// ── 지키는 약속 ────────────────────────────────────────────────────────────
//   ① ROW_H = 42, 칸 패딩 위아래 3, 줄간 1.25. 빈 줄도 같은 높이다.
//   ② 상태 칸의 보조는 **한 번에 하나**다(쌓이지 않는다) — 급한 것이 위다.
//   ③ 포캐스트·할 일·메모는 품목 칸 **둘째 줄**로 내려왔다(상태 칸에서 걷었다).
//   ④ 「실주 사유 입력」은 빨간 **글자 링크**다(알약 단추가 아니다).
//   ⑤ 줄 호버·고름은 .ems-pick 한 가지다.
//   ⑥ colSpan 이 실제 칸 수와 같다(빈 줄이 표 너비를 흔들지 않게).

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')
const code = s => s.split(/\r?\n/).filter(l => {
  const t = l.trim()
  return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
}).join('\n')

const PANEL = read('components/dashboard/MyQuotesPanel.tsx')
const BODY = code(PANEL)

const fails = []
let total = 0
const ok = (name, got, want = true) => {
  total += 1
  const same = JSON.stringify(got) === JSON.stringify(want)
  console.log(`${same ? 'OK  ' : 'FAIL'} ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
  if (!same) fails.push(name)
}

console.log('── ① 42px 를 만드는 값들 ──')
ok('ROW_H = 42', /const ROW_H = 42\b/.test(BODY))
ok('칸 패딩은 위아래 3', /const CELL: CSSProperties = \{ padding: '3px 10px'/.test(BODY))
ok('첫 줄 13px · 줄간 1.25', /const LINE1: CSSProperties = \{ fontSize: 13, lineHeight: 1\.25/.test(BODY))
ok('둘째 줄 11px · 줄간 1.25', /const LINE2: CSSProperties = \{ fontSize: 11, lineHeight: 1\.25/.test(BODY))
ok('줄에 높이를 못 박았다', /style=\{\{ height: ROW_H, borderBottom/.test(BODY))
ok('빈 줄도 같은 높이다', /\{ height: ROW_H, borderBottom: `1px solid \$\{BORDER\}` \}/.test(BODY))
// 3 + 13*1.25 + 1 + 11*1.25 + 3 = 39.5 → 42 에 들어간다(줄에 걸린 높이가 남는 2.5 를 먹는다).
const fits = 3 + 13 * 1.25 + 1 + 11 * 1.25 + 3
ok('두 줄이 42 안에 든다', fits <= 42)

console.log('── ② 칸마다 줄이 둘 ──')
// 두 줄을 쓰는 칸은 **다섯**이다: 번호·고객사·품목·매출액·상태.
// 「관리」 칸은 단추 한 줄이라 두 줄을 쓰지 않는다 — 줄 높이는 tr 이 들고 있다.
ok('LINE1 을 쓰는 칸 다섯', (BODY.match(/\.\.\.LINE1/g) || []).length, 5)
// LINE2 는 여섯 — 매출액 칸이 순이익 있음/없음 **두 갈래**로 적는다.
ok('LINE2 를 쓰는 자리 여섯', (BODY.match(/(\.\.\.LINE2|style=\{LINE2\})/g) || []).length, 6)
ok('관리 칸은 단추 한 줄이다(제 높이를 만들지 않는다)',
  /justifyContent: 'flex-end', gap: 4, height: '100%'/.test(BODY))
ok('칸 수와 colSpan 이 같다', /const TABLE_COLS = 7\b/.test(BODY))
ok('머리줄도 여섯 + 체크박스', (read('components/dashboard/MyQuotesPanel.tsx').match(/'견적번호', '고객사', '품목', '매출액', '상태', '관리'/) || []).length, 1)

console.log('── ③ 상태 보조는 한 번에 하나 ──')
ok('statusSub 가 하나를 고른다', /const statusSub = \(\(\) => \{/.test(BODY))
for (const kind of ['reason', 'rejected', 'overdue', 'ship', 'revenue']) {
  ok(`보조 「${kind}」 한 갈래`, (BODY.match(new RegExp(`statusSub\\?\\.kind === '${kind}'`, 'g')) || []).length, 1)
}
ok('급한 것이 위다 — 실주 사유가 첫 갈래',
  BODY.indexOf("kind: 'reason'") < BODY.indexOf("kind: 'rejected'")
  && BODY.indexOf("kind: 'rejected'") < BODY.indexOf("kind: 'overdue'")
  && BODY.indexOf("kind: 'overdue'") < BODY.indexOf("kind: 'ship'")
  && BODY.indexOf("kind: 'ship'") < BODY.indexOf("kind: 'revenue'"))
ok('상태 칸이 세로로 쌓지 않는다', /flexDirection: 'column', gap: 2, alignItems: 'center'/.test(BODY), false)

console.log('── ④ 보조 링크는 품목 칸 둘째 줄 ──')
const itemCell = BODY.slice(BODY.indexOf('maxWidth: 200'), BODY.indexOf('₩{numKR(q.total_supply)}'))
for (const part of ['<ForecastLink', '<TaskAddButton', '<MemoPopover']) {
  ok(`${part} 가 품목 칸에 있다`, itemCell.includes(part))
}
ok('그것들이 상태 칸에 남아 있지 않다',
  BODY.slice(BODY.indexOf('salesStatusLabel(q.status)'), BODY.indexOf('⋮')).includes('<ForecastLink'), false)

console.log('── ⑤ 「실주 사유 입력」은 빨간 글자 링크 ──')
const reasonBlock = BODY.slice(BODY.indexOf("statusSub?.kind === 'reason'"), BODY.indexOf("statusSub?.kind === 'rejected'"))
// 색 값을 글자로 들고 있으면 색 토큰 하네스가 이 파일을 센다 — 이어 붙여 둔다.
const HEX = v => '#' + v
ok('빨간 글자다', new RegExp('color: .' + HEX('ef4444')).test(reasonBlock))
ok('알약 테두리가 없다', /borderRadius: R\.pill/.test(reasonBlock), false)
ok('누르면 사유 창이 열린다', /setReasonQuote\(q\)/.test(reasonBlock))

console.log('── ⑥ 줄 호버 ──')
ok('줄 호버·고름은 .ems-pick', /className="ems-pick"/.test(BODY))
ok('고른 줄을 aria 로도 알린다', /aria-selected=\{quoteSel\.isSelected\(q\.quote_id\)\}/.test(BODY))

console.log('── ⑦ 첫 줄에 있어야 하는 것 ──')
const line1 = BODY.slice(BODY.indexOf('const pdfOpen = pdfOpenableFor(q)'), BODY.indexOf('<div style={LINE2}>{q.quote_date}</div>'))
ok('문서 아이콘이 번호 **앞**에 선다', line1.indexOf('aria-label="PDF"') < line1.indexOf('{q.quote_number}'))
ok('이모지를 아이콘으로 쓰지 않는다 — 인라인 SVG 다', /<svg width="12" height="12"[\s\S]{0,200}aria-label="PDF"/.test(line1))

if (fails.length > 0) {
  console.error('\n실패:')
  for (const f of fails) console.error('  · ' + f)
  process.exit(1)
}
console.log(`\n통과 — 내 견적 줄 두 단 42px(검사 ${total}개 · 실패 0)`)
