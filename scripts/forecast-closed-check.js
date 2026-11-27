// 포캐스트 — **세그먼트와 끝난 건 표** (2026-11-28, 야간4 4-3).
//
//   node scripts/forecast-closed-check.js
//
// 지키는 약속
//   ① 세그먼트 넷 「진행 중 | 수주 | 실주 | 전체」, 기본은 진행 중.
//   ② 진행 중은 **칸반만**, 나머지 셋은 **표만**. 둘이 함께 서지 않는다.
//   ③ 수주 건은 종료 **30일** 뒤 판에서 빠진다 — 표에는 남는다.
//   ④ 담당자·검색 필터가 표에도 걸린다(filtered 를 그대로 쓴다).
//   ⑤ 판 아래 「끝난 건」 접이 묶음은 걷혔다.
//   ⑥ 표의 칸: 회사 » 사업장 · 제목 · 금액 · 단계 이력 · 종료·사유·경쟁사 · 담당 · 열기.
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

const C = load(path.join(ROOT, 'lib/forecastClosed.ts'))

const fails = []
let total = 0
const ok = (name, got, want = true) => {
  total += 1
  const same = JSON.stringify(got) === JSON.stringify(want)
  console.log(`${same ? 'OK  ' : 'FAIL'} ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
  if (!same) fails.push(name)
}

const TODAY = '2026-11-28'
const o = (id, stage, closedAt = null, createdAt = '2026-09-01T00:00:00Z') =>
  ({ opportunity_id: id, stage, closed_at: closedAt, created_at: createdAt })

console.log('── ① 세그먼트 넷 ──')
ok('넷이다', C.FORECAST_VIEWS.map(v => v.key), ['open', 'won', 'lost', 'all'])
ok('글자', C.FORECAST_VIEWS.map(v => v.label), ['진행 중', '수주', '실주', '전체'])
ok('기본은 진행 중', /useState<ForecastView>\('open'\)/.test(code(read('app/pipeline/page.tsx'))))

console.log('── ② 판에 서는가 ──')
ok('상담은 선다', C.onBoard(o(1, '상담'), TODAY))
ok('실주는 서지 않는다', C.onBoard(o(2, '실주'), TODAY), false)
ok('종료 시각이 찍힌 협상도 서지 않는다', C.onBoard(o(3, '협상', '2026-11-01T00:00:00Z'), TODAY), false)
ok('수주 — 종료 시각이 없으면 선다', C.onBoard(o(4, '수주'), TODAY))
ok('수주 — 30일째까지는 선다', C.onBoard(o(5, '수주', '2026-10-29T00:00:00Z'), TODAY))
ok('수주 — 31일째에 빠진다', C.onBoard(o(6, '수주', '2026-10-28T00:00:00Z'), TODAY), false)
ok('30 일이 그 값이다', C.WON_BOARD_DAYS, 30)
ok('날수 셈', [C.daysSince('2026-10-29T00:00:00Z', TODAY), C.daysSince('2026-11-28', TODAY)], [30, 0])
ok('날짜가 아니면 null', C.daysSince(null, TODAY), null)

console.log('── ③ 표의 어느 칸인가 ──')
ok('수주', C.closedKind(o(1, '수주')), 'won')
ok('실주', C.closedKind(o(2, '실주')), 'lost')
ok('수동 종료(단계는 진행 중인데 closed_at 만)', C.closedKind(o(3, '협상', '2026-11-01T00:00:00Z')), 'lost')
ok('진행 중은 null', C.closedKind(o(4, '협상')), null)

console.log('── ④ 표에 서는 줄 ──')
const ROWS = [
  o(1, '상담'),
  o(2, '수주', '2026-11-20T00:00:00Z'),
  o(3, '실주', '2026-11-24T00:00:00Z'),
  o(4, '협상', '2026-10-05T00:00:00Z'),
]
ok('진행 중이면 표를 그리지 않는다', C.tableRows(ROWS, 'open'), [])
ok('수주', C.tableRows(ROWS, 'won').map(r => r.opportunity_id), [2])
ok('실주 — 수동 종료도 함께', C.tableRows(ROWS, 'lost').map(r => r.opportunity_id), [3, 4])
ok('전체 — 끝난 건 전부(진행 중은 빠진다)', C.tableRows(ROWS, 'all').map(r => r.opportunity_id), [3, 2, 4])
ok('끝난 날이 **최근인 것부터**', C.tableRows(ROWS, 'all').map(r => String(r.closed_at).slice(0, 10)),
  ['2026-11-24', '2026-11-20', '2026-10-05'])
// 수주 2번은 끝난 지 8일이라 **판에도 서고 표에도 있다** — 그래서 open 과 won 둘 다 센다.
// 30일이 지나면 open 에서만 빠진다(표에는 남는다).
ok('세그먼트 옆 건수', C.viewCounts(ROWS, TODAY), { open: 2, won: 1, lost: 2, all: 3 })
ok('수주가 30일을 넘기면 진행 중에서만 빠진다',
  C.viewCounts([o(9, '수주', '2026-10-01T00:00:00Z')], TODAY), { open: 0, won: 1, lost: 0, all: 1 })

console.log('── ⑤ 화면 ──')
const PAGE = code(read('app/pipeline/page.tsx'))
ok('세그먼트가 제목 줄에 선다', /<SegmentedControl/.test(PAGE) && /FORECAST_VIEWS\.map/.test(PAGE))
ok('건수를 옆에 적는다', /suffix: counts\[x\.key\] > 0 \? String\(counts\[x\.key\]\) : undefined/.test(PAGE))
ok('진행 중이 아니면 **표만** 그린다', /\) : view !== 'open' \? \(/.test(PAGE))
ok('그때 칸반은 그리지 않는다', /<ClosedTable[\s\S]{0,400}\) : \(\s*\r?\n\s*<DndContext/.test(PAGE))
ok('판에 서는 줄의 판정이 onBoard 하나다',
  (PAGE.match(/onBoard\(o, today\)/g) || []).length >= 3)
ok('표는 담당자·검색이 걸린 줄을 쓴다', /tableRows\(filtered, view\)/.test(PAGE))
ok('「끝난 건」 접이 묶음이 없다', /showLost|끝난 건<\/span>/.test(PAGE), false)
ok('표의 단계 이력은 표를 열 때 읽는다',
  /if \(view === 'open' \|\| closedRows\.length === 0\) return/.test(PAGE))

console.log('── ⑥ 표의 칸 ──')
const T = read('components/pipeline/ClosedTable.tsx')
for (const h of ['회사 » 사업장', '제목', '금액', '단계 이력', '종료 · 사유', '담당']) {
  ok(`「${h}」 칸`, T.includes(`>${h}</th>`))
}
ok('「열기」가 수정 모달을 연다', /onOpen\(o\)/.test(T) && /opp\.openEditOpp\(o\)/.test(PAGE))
ok('종료 줄은 결과 · 사유 · 경쟁사', /o\.lost_reason[\s\S]{0,120}o\.competitor/.test(T))
ok('단계 이력 요약은 공용 함수다', /summarizeStageHistory\(stageHistories\.get\(o\.opportunity_id\) \?\? \[\]\)/.test(T))
ok('이력이 없으면 「—」', /summary \|\| <span style=\{\{ color: DIM \}\}>—<\/span>/.test(T))
ok('금액은 칸반과 같은 축약', /krwShort\(o\.expected_amount\)/.test(T) && /krwFull\(o\.expected_amount\)/.test(T))
ok('줄 높이는 42px', /height: 42, borderBottom/.test(T))
ok('줄 호버는 .ems-pick', /className="ems-pick"/.test(T))

if (fails.length > 0) {
  console.error('\n실패:')
  for (const f of fails) console.error('  · ' + f)
  process.exit(1)
}
console.log(`\n통과 — 포캐스트 세그먼트·끝난 건 표(검사 ${total}개 · 실패 0)`)
