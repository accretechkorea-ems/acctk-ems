// 접촉보고서 **전체 엑셀** (2026-11-26).
//
//   node scripts/semi-export-all-check.js
//
// 진짜 Workbook 을 만들어 시트를 **읽어 본다**(키·서버 없이 돈다. exceljs 는 이미 들어 있다).
//
// 지키는 약속
//   ① 시트는 집계 셋(전체 · Action · 요약) + **건별 양식 시트**다.
//   ② 「전체」는 보고서 1건 = 1행이고, Project 네 칸이 맨 앞에 선다(어느 건인지 먼저 보인다).
//   ③ 「요약」은 Project 1건 = 1행 — 접촉 횟수·최근 접촉일·미완료 Action.
//   ④ 건별 시트에는 **상한**이 있다. 넘기면 요약에 몇 건을 뺐는지 적는다 — 조용히 자르지 않는다.
//   ⑤ 시트 이름은 겹치지 않는다(엑셀은 31자까지만 받고 같은 이름을 거부한다).
//   ⑥ 거르기는 목록 라우트와 **같은 순수 모듈**이 한다 — 화면 목록과 파일이 어긋나지 않는다.
//   ⑦ 건별 엑셀은 그대로 있다.

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

const ExcelJS = load(path.join(ROOT, 'node_modules/exceljs'))
const X = load(path.join(ROOT, 'lib/semiContact/excel.ts'))
const S = load(path.join(ROOT, 'lib/semiContact/search.ts'))

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

// ── 시험용 자료 — Project 둘 · 보고서 셋 · Action 둘 ────────────────────────
const project = (no, name) => ({ project_no: no, customer_name: name, site_dept: '측정실', title: `${name} 안건` })
const report = (id, date, who, extra = {}) => ({
  report_id: id,
  row: { report_id: id, contact_date: date, contact_method: '방문', fact: `${who} 가 쓴 내용`, detail: {}, ...extra },
  authorName: who,
})
const action = (id, reportId, what, status, due) => ({
  action_id: id, report_id: reportId,
  row: { action_id: id, report_id: reportId, what, owner: '권', due_date: due, status, priority: 'High', note: '' },
})

const groups = [
  {
    projectId: 1,
    project: project('SEMI-26-001', '삼성전자'),
    reports: [report(11, '2026-10-01', '권재원'), report(12, '2026-11-01', '권재원', { fact: '값이 바뀐 줄' })],
    actions: [action(101, 11, '사양서 송부', 'Open', '2026-10-10'), action(102, 12, '회신 확인', 'Done', '2026-11-10')],
  },
  {
    projectId: 2,
    project: project('SEMI-26-002', 'SK하이닉스'),
    reports: [report(21, '2026-11-20', '조영수')],
    actions: [],
  },
]

const build = (over = {}) => {
  const wb = new ExcelJS.Workbook()
  const made = X.buildAllWorkbook(wb, { groups, today: '2026-11-26', ...over })
  return { wb, made }
}

console.log('── ① 시트 구성 ──')
const { wb, made } = build()
const names = wb.worksheets.map(w => w.name)
eq('집계 셋이 맨 앞', names.slice(0, 3), ['전체', 'Action', '요약'])
eq('그 뒤는 건별 양식 시트 셋', names.length, 6)
eq('센 수를 돌려준다', [made.projects, made.reports, made.sheets, made.skipped], [2, 3, 3, 0])
ok('시트 이름이 겹치지 않는다', new Set(names).size === names.length)
ok('이름은 31자를 넘지 않는다', names.every(n => n.length <= 31))

console.log('\n── ② 전체 시트 ──')
const all = wb.getWorksheet('전체')
const head = all.getRow(1).values.slice(1)
eq('Project 네 칸이 맨 앞', head.slice(0, 4), ['Project 번호', '고객사', '사업장/부서', 'Project/구매안건'])
eq('그 뒤 차수·접촉일·접촉방법·작성자', head.slice(4, 8), ['차수', '접촉일', '접촉방법', '작성자'])
eq('보고서 1건 = 1행', all.rowCount - 1, 3)
eq('첫 줄은 Project 번호로 시작한다', all.getRow(2).getCell(1).value, 'SEMI-26-001')
eq('차수는 Project 안에서 센다', [all.getRow(2).getCell(5).value, all.getRow(3).getCell(5).value, all.getRow(4).getCell(5).value],
  ['#1', '#2', '#1'])
eq('접촉일 오름차순', [all.getRow(2).getCell(6).value, all.getRow(3).getCell(6).value, all.getRow(4).getCell(6).value],
  ['2026-10-01', '2026-11-01', '2026-11-20'])
ok('머리줄을 고정한다(Project 네 칸까지)', all.views?.[0]?.xSplit === 4 && all.views?.[0]?.ySplit === 1)
ok('거르개를 건다', !!all.autoFilter)
ok('바뀐 칸에 색을 입힌다(같은 Project 안에서만 견준다)',
  /CHANGED_BG/.test(read('lib/semiContact/excel.ts'))
  && /그 Project 안에서만\*\* 견준다/.test(read('lib/semiContact/excel.ts')))

console.log('\n── ③ Action · 요약 ──')
const act = wb.getWorksheet('Action')
eq('Project 번호가 맨 앞', act.getRow(1).getCell(1).value, 'Project 번호')
eq('Action 두 줄', act.rowCount - 1, 2)
eq('기한 지난 미완료는 빨강', act.getRow(2).getCell(3).font?.color?.argb, 'FFDC2626')
eq('완료된 줄은 그냥', act.getRow(3).getCell(3).font?.color, undefined)

const sum = wb.getWorksheet('요약')
eq('요약 머리줄', sum.getRow(1).values.slice(1),
  ['Project 번호', '고객사', '사업장/부서', 'Project/구매안건', '접촉 횟수', '최근 접촉일', '다음 Contact 예정일', '미완료 Action'])
eq('Project 1건 = 1행', sum.rowCount - 1, 2)
eq('접촉 횟수·최근 접촉일', [sum.getRow(2).getCell(5).value, sum.getRow(2).getCell(6).value], ['2', '2026-11-01'])
eq('미완료 Action 수', sum.getRow(2).getCell(8).value, '1')
eq('Action 이 없으면 0', sum.getRow(3).getCell(8).value, '0')

console.log('\n── ④ 건별 시트 상한 ──')
const capped = build({ sheetCap: 2 })
eq('상한까지만 넣는다', capped.made.sheets, 2)
eq('뺀 건수를 돌려준다', capped.made.skipped, 1)
eq('시트는 집계 셋 + 둘', capped.wb.worksheets.length, 5)
const cs = capped.wb.getWorksheet('요약')
ok('요약에 몇 건을 뺐는지 적는다 — 조용히 자르지 않는다',
  String(cs.getRow(cs.rowCount).getCell(1).value ?? '').includes('1건은 위 「전체」 시트에만'))
ok('「전체」 시트에는 그 건도 있다', capped.wb.getWorksheet('전체').rowCount - 1 === 3)
eq('기본 상한', X.ALL_SHEET_CAP, 60)

console.log('\n── ⑤ 이름이 겹칠 때 ──')
const same = {
  projectId: 9,
  project: project('SEMI-26-003', '같은 날'),
  // 같은 Project · 같은 접촉일 둘 — 시트 이름이 같아진다.
  reports: [report(31, '2026-11-11', 'A'), report(32, '2026-11-11', 'B')],
  actions: [],
}
const dup = new ExcelJS.Workbook()
X.buildAllWorkbook(dup, { groups: [same], today: '2026-11-26' })
const dupNames = dup.worksheets.map(w => w.name)
eq('시트 다섯(집계 셋 + 건별 둘)', dupNames.length, 5)
ok('이름이 겹치지 않는다', new Set(dupNames).size === dupNames.length)
ok('꼬리에 번호를 붙인다', dupNames.some(n => /\s2$/.test(n)))

console.log('\n── ⑥ 거르기는 목록과 같은 모듈 ──')
const ROUTE = read('app/api/semi-contact/export/route.ts')
const PAGE = read('app/contact/semi/page.tsx')
ok('라우트가 그 모듈을 쓴다', /from '@\/lib\/semiContact\/search'/.test(ROUTE) && /filterProjects\(/.test(ROUTE))
ok('팀 좁히기도 목록과 같은 규칙', /creator\?\.teams\?\.trim\(\) === team \|\| teamAuthor\.has/.test(ROUTE))
ok('화면은 조건만 보낸다(고른 id 를 보내지 않는다)',
  /sp\.set\('q', words\)/.test(PAGE) && /all: '1'/.test(PAGE) && !/project_ids/.test(PAGE))
ok('그 이유를 적어 두었다', /조건이 두 곳에 적히면 반드시 갈린다/.test(PAGE))
ok('Project 가 남으면 **그 이력 전부**를 담는다', /보고서는 \*\*거르지 않는다\*\*/.test(ROUTE))
ok('파일명에 조건이 붙는다', /접촉보고서_전체_/.test(ROUTE))
ok('몇 장 넣었는지 헤더로 알려 준다', /'X-Export-Counts'/.test(ROUTE) && /X-Export-Counts/.test(PAGE))

console.log('\n── ⑦ 건별 엑셀은 그대로 ──')
eq('같은 함수가 건별 시트를 그린다', typeof X.buildReportSheet, 'function')
eq('Project 하나 이력도 그대로', typeof X.buildHistoryWorkbook, 'function')
ok('라우트의 세 길이 모두 남아 있다',
  /report_id=<id>/.test(ROUTE) && /buildHistoryWorkbook\(wb/.test(ROUTE) && /buildAllWorkbook\(wb/.test(ROUTE))
ok('목록 단추는 조건이 없을 때도 쓸 수 있다(막지 않는다)', /disabled=\{exporting \|\| shown\.length === 0\}/.test(PAGE))
eq('거르기 모듈은 그대로다', typeof S.filterProjects, 'function')

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
