// 내 견적 **제목 줄** — 「내 견적 ··· [기간 ▾] [상태 ▾] [검색] ⬇ ✕」 (2026-11-28, 야간4 2-3).
//
//   node scripts/my-quotes-head-check.js
//
// 지키는 약속
//   ① 기간은 **드롭다운 하나 · 다섯 갈래**다(이번 달 · 이번 분기 · FY올해 · FY지난해 · 전체).
//      기본은 올해다. 셀렉트 셋(회계연도 × 단위 × 칸)은 걷혔다.
//   ② 요약 여섯 칸과 목록이 **같은 범위**를 본다 — 범위를 내는 함수가 하나다.
//   ③ 상태 칩 줄은 걷히고 **드롭다운**이 됐다. 「전체」가 맨 위다.
//   ④ 검색은 번호·고객사·**품목** 셋을 본다. 보이는 품목 글자와 찾히는 글자가 같다.
//   ⑤ 조종 칸은 모달 머리줄에 **포털로** 심는다 — 상태를 끌어올리지 않는다.
//   ⑥ 엑셀(⬇)도 그 줄로 올라갔다.
//
// 키도 서버도 없이 돈다.

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

const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')
const code = s => s.split(/\r?\n/).filter(l => {
  const t = l.trim()
  return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
}).join('\n')

const PANEL = read('components/dashboard/MyQuotesPanel.tsx')
const BODY = code(PANEL)
const CARD = code(read('components/dashboard/MyQuoteCard.tsx'))

const fails = []
let total = 0
const ok = (name, got, want = true) => {
  total += 1
  const same = JSON.stringify(got) === JSON.stringify(want)
  console.log(`${same ? 'OK  ' : 'FAIL'} ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
  if (!same) fails.push(name)
}

console.log('── ① 기간 — 드롭다운 하나, 다섯 갈래 ──')
ok('다섯 갈래다', (BODY.match(/\{ key: '(month|quarter|thisFy|prevFy|all)'/g) || []).length, 5)
ok('기본은 올해다', /useState<Period>\('thisFy'\)/.test(BODY))
ok('셀렉트는 **기간 하나**다 — 회계연도·단위·칸 셋이 걷혔다',
  !/fyOptions/.test(BODY) && !/MONTHS_FISCAL/.test(BODY) && !/setSel\(/.test(BODY) && !/changeUnit/.test(BODY))
ok('유효 견적 모드가 남아 있지 않다', /inValidQuoteView/.test(BODY), false)
ok('기간을 고르면 페이지가 1로 돌아간다', /const changePeriod = \(next: Period\) => \{ setPeriod\(next\); setPage\(1\) \}/.test(BODY))

// 범위를 내는 함수를 그대로 돌려 본다.
const panelJs = ts.transpileModule(PANEL, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, jsx: ts.JsxEmit.React },
}).outputText
// 화면 부품은 부르지 않는다 — 날짜 함수 넷만 떼어 돌린다.
const cut = (name) => {
  const i = panelJs.indexOf(`function ${name}(`)
  if (i < 0) throw new Error(`${name} 없음`)
  let depth = 0, j = panelJs.indexOf('{', i)
  for (let k = j; k < panelJs.length; k++) {
    if (panelJs[k] === '{') depth += 1
    else if (panelJs[k] === '}') { depth -= 1; if (depth === 0) return panelJs.slice(i, k + 1) }
  }
  throw new Error(`${name} 끝을 못 찾음`)
}
const pad = n => String(n).padStart(2, '0')
const lastDay = (y, mm) => new Date(y, mm, 0).getDate()
const PERIODS = [
  { key: 'month', label: '이번 달' }, { key: 'quarter', label: '이번 분기' },
  { key: 'thisFy', label: 'FY' }, { key: 'prevFy', label: 'FY' }, { key: 'all', label: '전체' },
]
const dates = new Function('pad', 'lastDay', 'PERIODS',
  `${cut('periodRange')}\n${cut('periodDates')}\n${cut('periodLabel')}\nreturn { periodDates, periodLabel }`)(pad, lastDay, PERIODS)

console.log('── ② 다섯 갈래의 범위 ──')
// 2026-11(FY2026 3분기) 을 오늘로 둔다.
const CUR_FY = 2026, CM = 11, CUR_Q = 3
const r = k => dates.periodDates(k, CUR_FY, CM, CUR_Q)
ok('이번 달', [r('month').start, r('month').end], ['2026-11-01', '2026-11-30'])
ok('이번 분기(10~12월)', [r('quarter').start, r('quarter').end], ['2026-10-01', '2026-12-31'])
ok('FY2026 = 2026-04-01 ~ 2027-03-31', [r('thisFy').start, r('thisFy').end], ['2026-04-01', '2027-03-31'])
ok('FY2025 = 2025-04-01 ~ 2026-03-31', [r('prevFy').start, r('prevFy').end], ['2025-04-01', '2026-03-31'])
ok('전체는 모든 날을 담는다', [r('all').start, r('all').end], ['1900-01-01', '2999-12-31'])
ok('글자는 FY 두 갈래만 해가 들어간다',
  PERIODS.map(x => dates.periodLabel(x.key, CUR_FY)),
  ['이번 달', '이번 분기', 'FY2026', 'FY2025', '전체'])

console.log('── ③ 요약과 목록이 같은 범위 ──')
ok('범위를 내는 자리가 하나다', (BODY.match(/periodDates\(period, curFy, cm, curQuarter\)/g) || []).length, 1)
ok('목록은 그 범위로만 거른다', /const dateFiltered = quotes\.filter\(inRangeDate\)/.test(BODY))
ok('요약도 같은 rangeStart·rangeEnd 를 받는다', /quotes, engineerId, rangeStart, rangeEnd,/.test(BODY))
ok('나눔수는 기간 하나에서 온다', /const divisor = PERIOD_DIVISOR\[period\]/.test(BODY))
ok('지난해를 고르면 그 해 목표를 본다', /period === 'prevFy' \? curFy - 1 : curFy/.test(BODY))

console.log('── ④ 상태 — 칩 줄 걷고 드롭다운 ──')
ok('상태 칩 줄이 없다', /STATUS_TABS\.map\(s => \(/.test(BODY), false)
ok('상태 드롭다운이 있다', /STATUS_TABS\.map\(st => \(/.test(BODY))
ok('「전체」가 맨 위다', /st === '전체' \? '상태: 전체'/.test(BODY))
ok('주소로 들어온 상태를 그대로 받는다', /initialStatus && STATUS_TABS\.includes\(initialStatus\)/.test(BODY))

console.log('── ⑤ 검색 — 번호·고객사·품목 ──')
ok('품목까지 본다', /\[q\.quote_number, itemsTextOf\(q\)\]/.test(BODY))
ok('보이는 품목과 찾히는 품목이 같은 함수다', /const itemNames = itemsTextOf\(q\) \|\| '-'/.test(BODY))
ok('안내 글자가 셋을 말한다', /placeholder="번호 · 고객사 · 품목"/.test(BODY))
// 품목 글자 규칙 — 할인 줄은 뺀다.
const itemsTextOf = new Function(`${cut('itemsTextOf')}\nreturn itemsTextOf`)()
ok('할인 줄은 품목에서 뺀다',
  itemsTextOf({ quote_items: [{ product_name: 'S-NEX001', row_kind: null }, { product_name: '할인', row_kind: 'discount' }] }),
  'S-NEX001')
ok('품목명이 비면 가격표 이름을 쓴다',
  itemsTextOf({ quote_items: [{ product_name: null, price_list: { model_jp: 'SD2-13' } }] }), 'SD2-13')
ok('품목이 없으면 빈 글자', itemsTextOf({ quote_items: null }), '')

console.log('── ⑥ 조종 칸은 모달 머리줄에 ──')
ok('패널이 포털로 심는다', /createPortal\(controlsRow, controlsTarget\)/.test(BODY))
ok('없으면 제 줄로 선다(홈 카드 밖에서도 쓰게)', /controlsTarget\r?\n?\s*\? createPortal/.test(BODY) || /controlsTarget[\s\S]{0,40}\? createPortal/.test(BODY))
ok('모달이 그 자리를 내려 준다', /titleExtra=\{<span className="myq-controls-slot" ref=\{setControlsBox\} \/>\}/.test(CARD))
// 폰에서는 조종 칸이 제목 아래 줄로 접힌다 — order 를 안 주면 ✕ 가 셋째 줄로 밀린다(390 에서 봤다).
ok('폰에서는 그 자리가 제목 아래로 접힌다',
  /\.myq-controls-slot \{[\s\S]{0,500}order: 1;[\s\S]{0,120}flex: 1 1 100%;/.test(read('app/globals.css')))
ok('머리줄이 접히게 두었다', /flexWrap: 'wrap' \}\}/.test(CARD))
ok('그 자리를 패널에 넘긴다', /controlsTarget=\{controlsBox\}/.test(CARD))
ok('상태를 끌어올리지 않았다 — 카드에 기간·검색 상태가 없다',
  !/useState<Period>/.test(CARD) && !/setSearch/.test(CARD))

console.log('── ⑦ 엑셀도 그 줄로 ──')
const row = BODY.slice(BODY.indexOf('const controlsRow = ('), BODY.indexOf('const controls = controlsTarget'))
ok('엑셀 단추가 조종 칸에 있다', /<QuoteExcelButton/.test(row))
ok('기간·상태·검색이 한 줄이다',
  /<select value=\{period\}/.test(row) && /<select value=\{statusFilter\}/.test(row) && /<input value=\{search\}/.test(row))

if (fails.length > 0) {
  console.error('\n실패:')
  for (const f of fails) console.error('  · ' + f)
  process.exit(1)
}
console.log(`\n통과 — 내 견적 제목 줄(검사 ${total}개 · 실패 0)`)
