// 반도체 접촉 보고 — 목록 거르기와 「당사 판단·영업전략」 가리기 시험 (2026-11-22).
//
//   node scripts/semi-search-check.js
//
// 지키는 약속
//   ① 검색어는 Project 칸뿐 아니라 **보고서 본문 전문**(detail 의 글자까지)을 본다.
//   ② 기간·작성자는 **보고서 단위** 조건이다 — 지나는 보고서가 한 건이라도 있어야 남는다.
//   ③ 두 조건을 같이 걸면 **그 조건을 지난 보고서 안에서만** 검색어를 찾는다.
//   ④ 「당사 판단·영업전략」은 **읽는 화면에서만** 빠진다 — 자료·입력 폼·저장·엑셀·API 는 그대로.
//   ⑤ 상수 하나(HIDE_SALES_JUDGEMENT)를 false 로 바꾸면 돌아온다.

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

const {
  filterProjects, reportPasses, reportText, authorOptions, ymd, isNarrowed,
} = load(path.join(ROOT, 'lib/semiContact/search.ts'))
const {
  SECTIONS, FIELDS, HIDE_SALES_JUDGEMENT, SALES_JUDGEMENT_SECTION, isSectionShown,
} = load(path.join(ROOT, 'lib/semiContact/fields.ts'))

let fails = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`)
  if (!ok) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}
const ok = (name, cond, hint) => {
  if (!cond) fails++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond || !hint ? '' : `  — ${hint}`}`)
}

// ── 본보기 ────────────────────────────────────────────────────────────────
const projects = [
  { project_id: 1, project_no: 'SEMI-01', customer_name: '가나반도체', site_dept: '평택 1라인', title: '검사기 도입' },
  { project_id: 2, project_no: 'SEMI-02', customer_name: '다라전자', site_dept: null, title: '조도계 교체' },
  { project_id: 3, project_no: 'SEMI-03', customer_name: '마바소재', site_dept: '청주', title: '신규 평가' },
]
const reports = [
  {
    report_id: 11, project_id: 1, contact_date: '2026-10-05', author_id: 7,
    contact_method: '대면', customer_contact: '김과장', purpose: '사양 협의', fact: '데모 일정 잡음',
    detail: { meeting_content: '웨이퍼 두께 측정 요구', strategy: '가격보다 납기로 간다' },
    author: { name: '홍길동' },
  },
  {
    report_id: 12, project_id: 1, contact_date: '2026-11-10', author_id: 8,
    contact_method: '전화', purpose: '견적 설명', fact: '예산 확인 중',
    detail: { why_win: '납기 우위' }, author: { name: '이순신' },
  },
  {
    report_id: 21, project_id: 2, contact_date: '2026-11-20', author_id: 7,
    purpose: '정기 방문', fact: '특이사항 없음', detail: {}, author: { name: '홍길동' },
  },
  // 3번 Project 는 보고서가 없다.
]
const F = (over = {}) => ({ q: '', from: '', to: '', author: null, ...over })
const ids = list => list.map(p => p.project_id)

console.log('\n── ① 검색어 ──')
eq('조건이 없으면 전부', ids(filterProjects(projects, reports, F())), [1, 2, 3])
eq('Project 칸에 걸린다(고객사)', ids(filterProjects(projects, reports, F({ q: '다라' }))), [2])
eq('Project 번호로도', ids(filterProjects(projects, reports, F({ q: 'semi-03' }))), [3])
eq('**보고서 본문**에 걸린다(FACT)', ids(filterProjects(projects, reports, F({ q: '데모 일정' }))), [1])
eq('detail 의 글자에도 걸린다(회의 내용)', ids(filterProjects(projects, reports, F({ q: '웨이퍼' }))), [1])
eq('가려진 섹션의 글자도 **검색은 된다**(영업전략)', ids(filterProjects(projects, reports, F({ q: '납기로' }))), [1])
eq('작성자 이름으로도', ids(filterProjects(projects, reports, F({ q: '이순신' }))), [1])
eq('없는 글자는 빈 결과', ids(filterProjects(projects, reports, F({ q: '없는말' }))), [])
eq('보고서가 없는 Project 는 Project 칸으로만 걸린다',
  ids(filterProjects(projects, reports, F({ q: '마바' }))), [3])

console.log('\n── ② 기간 ──')
eq('11월만', ids(filterProjects(projects, reports, F({ from: '2026-11-01' }))), [1, 2])
eq('10월만', ids(filterProjects(projects, reports, F({ to: '2026-10-31' }))), [1])
eq('양끝 포함 — 그날 하루', ids(filterProjects(projects, reports, F({ from: '2026-11-20', to: '2026-11-20' }))), [2])
eq('기간을 걸면 보고서 없는 Project 는 빠진다',
  ids(filterProjects(projects, reports, F({ from: '2020-01-01' }))), [1, 2])
eq('맞는 보고서가 없으면 빈 결과', ids(filterProjects(projects, reports, F({ from: '2027-01-01' }))), [])

console.log('\n── ③ 작성자 ──')
eq('홍길동(7)', ids(filterProjects(projects, reports, F({ author: 7 }))), [1, 2])
eq('이순신(8)', ids(filterProjects(projects, reports, F({ author: 8 }))), [1])
eq('칸 목록은 쓴 사람만, 이름순', authorOptions(reports),
  [{ engineer_id: 8, name: '이순신' }, { engineer_id: 7, name: '홍길동' }])

console.log('\n── ④ 조건을 겹치면 ──')
eq('작성자 + 본문 — 그 사람 보고서 안에서만 찾는다',
  ids(filterProjects(projects, reports, F({ q: '데모 일정', author: 8 }))), [])
eq('같은 글자를 쓴 사람으로 고르면 걸린다',
  ids(filterProjects(projects, reports, F({ q: '데모 일정', author: 7 }))), [1])
eq('기간 + 본문 — 기간 밖 보고서의 글자는 안 걸린다',
  ids(filterProjects(projects, reports, F({ q: '웨이퍼', from: '2026-11-01' }))), [])
eq('Project 칸은 기간을 지난 보고서가 있으면 걸린다',
  ids(filterProjects(projects, reports, F({ q: '가나', from: '2026-11-01' }))), [1])

console.log('\n── ⑤ 자잘한 것 ──')
eq('날짜 모양이 아니면 빈 글자로 본다', [ymd('2026-11-22'), ymd('2026-11'), ymd(null)], ['2026-11-22', '', ''])
ok('조건이 있으면 narrowed', isNarrowed(F({ q: '가' })) && isNarrowed(F({ author: 7 })) && !isNarrowed(F()))
ok('보고서 글자는 소문자로 모은다', reportText(reports[0]).includes('김과장'))
ok('날짜 없는 보고서는 기간을 걸면 빠진다',
  !reportPasses({ project_id: 1, report_id: 0, contact_date: null, author_id: 1 }, { from: '2026-01-01', to: '', author: null })
  && reportPasses({ project_id: 1, report_id: 0, contact_date: null, author_id: 1 }, { from: '', to: '', author: null }))

console.log('\n── ⑥ 「당사 판단·영업전략」 가리기 ──')
eq('가리는 섹션은 5', SALES_JUDGEMENT_SECTION, 5)
eq('그 섹션의 이름', SECTIONS.find(s => s.no === 5).label, '당사 판단·영업전략')
eq('그 섹션의 칸 다섯', FIELDS.filter(f => f.section === 5).map(f => f.key),
  ['assessment', 'why_win', 'why_lose', 'strategy', 'hq_support'])
ok('지금은 가린다', HIDE_SALES_JUDGEMENT === true)
ok('5만 빠지고 나머지는 그대로', SECTIONS.filter(s => isSectionShown(s.no)).map(s => s.no).join(',') === '1,2,3,4,6')

const DETAIL = fs.readFileSync(path.join(ROOT, 'app/contact/semi/[projectId]/page.tsx'), 'utf8')
const WRITE = fs.readFileSync(path.join(ROOT, 'app/contact/semi/[projectId]/write/page.tsx'), 'utf8')
const EXCEL = fs.readFileSync(path.join(ROOT, 'lib/semiContact/excel.ts'), 'utf8')
const FIELDS_SRC = fs.readFileSync(path.join(ROOT, 'lib/semiContact/fields.ts'), 'utf8')
ok('읽는 화면이 **섹션을 통째로** 거른다(빈 머리줄을 남기지 않는다)',
  /SECTIONS\s*\n\s*\.filter\(s => isSectionShown\(s\.no\)\)/.test(DETAIL))
ok('입력 폼은 그대로다(가리지 않는다)', !/isSectionShown|HIDE_SALES_JUDGEMENT/.test(WRITE))
ok('엑셀은 그대로다(가리지 않는다)', !/isSectionShown|HIDE_SALES_JUDGEMENT/.test(EXCEL))
ok('되돌리는 길이 상수 하나다', /export const HIDE_SALES_JUDGEMENT = true/.test(FIELDS_SRC))
ok('등록표에서 칸을 빼지 않았다(자료는 그대로)', FIELDS.filter(f => f.section === 5).length === 5)

console.log('\n── ⑦ 목록 화면이 약속을 지키는가(글자 검사) ──')
const LIST = fs.readFileSync(path.join(ROOT, 'app/contact/semi/page.tsx'), 'utf8')
const ROUTE = fs.readFileSync(path.join(ROOT, 'app/api/semi-contact/projects/route.ts'), 'utf8')
ok('검색어는 300ms 디바운스', /setTimeout\(\(\) => setDebouncedQ\(q\), 300\)/.test(LIST))
ok('조건을 주소에 남긴다', /window\.history\.replaceState/.test(LIST))
ok('주소에서 조건을 읽어 온다', /new URLSearchParams\(window\.location\.search\)/.test(LIST))
ok('결과 건수를 보여 준다', /결과 \{shown\.length\}건/.test(LIST))
ok('기간·작성자 칸이 있다', /aria-label="접촉일 시작"/.test(LIST) && /aria-label="작성자"/.test(LIST))
ok('거르기는 서버가 한다', /filterProjects\(scoped, reports, filter\)/.test(ROUTE))
ok('라우트는 읽기만 한다', !/\.(insert|update|upsert|delete)\(/.test(ROUTE))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
