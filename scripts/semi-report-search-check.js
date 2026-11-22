// 반도체 접촉 보고 — **한 Project 안에서** 보고서를 찾는 규칙 시험 (2026-11-22).
//
//   node scripts/semi-report-search-check.js
//
// 지키는 약속
//   ① 검색 대상은 **읽는 화면에 그리는 칸**이다 — 가린 섹션(당사 판단·영업전략)과
//      Project 칸(고객사·사업장/부서·Project/구매안건)은 빠진다.
//   ② 「N곳 일치」는 **물들이는 수와 같다** — 세는 함수와 토막 나누는 함수가 같은 규칙을 본다.
//   ③ 대소문자를 가리지 않고, 겹치지 않는 앞에서부터 센다.
//   ④ 검색어가 없으면 목록을 그대로 돌려준다(아무것도 거르지 않는다).
//   ⑤ 화면은 연도 머리줄을 적지 않고, 검색어를 주소의 q= 로 들고 있는다(글자 검사).

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
  SEARCH_KEYS, ACTION_SEARCH_FIELDS, normQuery, matchRanges, countIn, splitHits,
  reportMatchCount, reportMatches, filterReports, sectionHasHit, isSearchKey,
} = load(path.join(ROOT, 'lib/semiContact/reportSearch.ts'))
const { FIELDS, emptyInput, SALES_JUDGEMENT_SECTION, HIDE_SALES_JUDGEMENT } =
  load(path.join(ROOT, 'lib/semiContact/fields.ts'))
const { PROJECT_KEYS } = load(path.join(ROOT, 'lib/semiContact/project.ts'))

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

// ── 본보기 — 보고서 세 장 ──────────────────────────────────────────────────
const rep = (over, actions = []) => ({
  input: { ...emptyInput(), ...over },
  authorName: over.__author ?? '김엔지',
  actions,
})
const r1 = rep({
  contact_date: '2026-10-01', contact_method: '대면', customer_contact: '박부장',
  purpose: '검사기 데모 일정', meeting_content: '데모는 11월에 하기로 했다. 데모 장비는 본사에서 보낸다.',
  fact: '예산 확정', customer_name: '가나반도체', title: '검사기 도입',
})
const r2 = rep({
  contact_date: '2026-09-02', contact_method: '전화', purpose: '견적 문의',
  meeting_content: '가격만 물었다', strategy: '데모로 밀어붙인다', assessment: '데모 필요',
})
const r3 = rep({
  contact_date: '2026-08-03', purpose: '첫 방문', next_check: 'Fab 담당 확인',
}, [
  { what: '데모 장비 수배', owner: '이과장', due_date: '2026-10-20', status: 'Open', priority: 'High', note: '본사 협의' },
])
const all = [r1, r2, r3]

console.log('\n── ① 검색 대상 칸 ──')
ok('가린 섹션(당사 판단·영업전략)의 칸은 빠진다',
  HIDE_SALES_JUDGEMENT
  && FIELDS.filter(f => f.section === SALES_JUDGEMENT_SECTION).every(f => !SEARCH_KEYS.includes(f.key)))
eq('빠진 칸 이름', FIELDS.filter(f => f.section === SALES_JUDGEMENT_SECTION).map(f => f.key),
  ['assessment', 'why_win', 'why_lose', 'strategy', 'hq_support'])
ok('Project 칸은 빠진다(한 Project 안에서는 모든 보고서가 같은 값이다)',
  PROJECT_KEYS.every(k => !SEARCH_KEYS.includes(k)))
eq('Project 칸 이름', [...PROJECT_KEYS], ['customer_name', 'site_dept', 'title'])
ok('나머지 칸은 모두 대상이다',
  FIELDS.filter(f => f.section !== SALES_JUDGEMENT_SECTION && !PROJECT_KEYS.includes(f.key))
    .every(f => SEARCH_KEYS.includes(f.key)))
ok('isSearchKey 도 같은 답을 준다',
  isSearchKey('fact') && isSearchKey('meeting_content') && !isSearchKey('strategy') && !isSearchKey('title'))
eq('Action 줄은 상태(셀렉트)만 뺀 다섯 칸', [...ACTION_SEARCH_FIELDS],
  ['what', 'owner', 'due_date', 'priority', 'note'])

console.log('\n── ② 검색어 다듬기 ──')
eq('앞뒤 공백·대문자', normQuery('  DEMO '), 'demo')
eq('빈 글자', normQuery(''), '')
eq('공백만', normQuery('   '), '')
eq('없는 값', normQuery(null), '')

console.log('\n── ③ 일치 자리 ──')
eq('두 곳', matchRanges('데모 뒤에 데모', '데모'), [[0, 2], [6, 8]])
eq('겹치지 않는다(aaa 에서 aa 는 한 곳)', matchRanges('aaa', 'aa'), [[0, 2]])
eq('대소문자를 가리지 않는다', matchRanges('Demo DEMO', 'demo'), [[0, 4], [5, 9]])
eq('검색어가 없으면 자리도 없다', matchRanges('데모', ''), [])
eq('세는 함수도 같은 수', countIn('데모 뒤에 데모', '데모'), 2)

console.log('\n── ④ 토막 — 이어 붙이면 원래 글자다 ──')
const parts = splitHits('가 데모 나', '데모')
eq('토막 셋', parts, [{ text: '가 ', hit: false }, { text: '데모', hit: true }, { text: ' 나', hit: false }])
eq('이어 붙이면 원래 글자', parts.map(p => p.text).join(''), '가 데모 나')
eq('물든 토막 수 = 일치 수', parts.filter(p => p.hit).length, countIn('가 데모 나', '데모'))
eq('검색어가 없으면 한 토막', splitHits('데모', ''), [{ text: '데모', hit: false }])
eq('빈 글자는 토막도 없다', splitHits('', '데모'), [])
eq('맨 앞·맨 뒤에 걸려도 빈 토막을 만들지 않는다', splitHits('데모', '데모'), [{ text: '데모', hit: true }])

console.log('\n── ⑤ 보고서 한 장의 일치 수 ──')
eq('목적 1 + 회의내용 2 = 3곳', reportMatchCount(r1, '데모'), 3)
ok('가린 섹션의 글자는 세지 않는다(r2 의 영업전략·Assessment 에 「데모」가 있다)',
  reportMatchCount(r2, '데모') === 0,
  `${reportMatchCount(r2, '데모')}곳이 세어졌다`)
eq('r2 는 「가격」에 걸린다', reportMatchCount(r2, '가격'), 1)
eq('Action 줄도 센다(할 일)', reportMatchCount(r3, '데모'), 1)
eq('Action 의 담당·비고도 센다', reportMatchCount(r3, '이과장') + reportMatchCount(r3, '본사'), 2)
eq('작성자 이름도 센다', reportMatchCount(r1, '김엔지'), 1)
eq('Project 칸은 세지 않는다(고객사 「가나반도체」)', reportMatchCount(r1, '가나반도체'), 0)
eq('검색어가 없으면 0곳', reportMatchCount(r1, ''), 0)
ok('reportMatches 는 수가 0 보다 큰가다',
  reportMatches(r1, '데모') === true && reportMatches(r2, '데모') === false)

console.log('\n── ⑥ 목록 거르기 ──')
eq('「데모」 — r1·r3 만 남는다', filterReports(all, '데모').map(r => r.input.contact_date),
  ['2026-10-01', '2026-08-03'])
eq('순서는 넘겨받은 순서 그대로', filterReports(all, '데모').map(r => r.input.purpose),
  ['검사기 데모 일정', '첫 방문'])
eq('검색어가 없으면 전부', filterReports(all, '').length, 3)
eq('아무것도 안 걸리면 빈 목록', filterReports(all, '없는말').length, 0)
eq('대소문자를 가리지 않는다', filterReports([rep({ fact: 'Fab Line' })], 'fab line').length, 1)

console.log('\n── ⑦ 접힌 섹션 — 일치가 들었는지 ──')
ok('일치가 든 섹션은 펴야 한다', sectionHasHit(r3.input, ['next_check', 'memo'], 'fab'))
ok('없으면 그대로', sectionHasHit(r3.input, ['next_check', 'memo'], '데모') === false)
ok('가린 칸은 일치로 보지 않는다', sectionHasHit(r2.input, ['strategy', 'assessment'], '데모') === false)
ok('검색어가 없으면 펴지 않는다', sectionHasHit(r3.input, ['next_check'], '') === false)

console.log('\n── ⑧ 화면이 같은 약속을 지키는가(글자 검사) ──')
const page = fs.readFileSync(path.join(ROOT, 'app/contact/semi/[projectId]/page.tsx'), 'utf8')
ok('검색창이 좌측 목록에 있다', page.includes('이 Project 의 보고서 검색'))
ok('300ms 디바운스', /setTimeout\(\(\) => setQDebounced\(qInput\), 300\)/.test(page))
ok('검색어를 주소의 q= 로 들고 있다', page.includes("sp.set('q', v)") && page.includes("sp.delete('q')"))
ok('뒤로 가기 기록을 쌓지 않는다(replaceState)', page.includes('window.history.replaceState'))
ok('연도 머리줄의 글자를 지웠다', !page.includes('{year}'))
ok('해가 바뀌는 자리에 글자 없는 줄 하나', page.includes('{yearBreak && <div style={{ height: 1'))
ok('거르기·세기는 순수 모듈이 한다', page.includes("from '@/lib/semiContact/reportSearch'"))
ok('일치는 mark 로 그린다(▲▼ 가 DOM 순서로 집는다)', page.includes("data-sem-hit=\"1\""))
ok('지금 보는 일치만 테두리를 더한다', page.includes('sem-hit-on'))
ok('일치 띠에 수와 ▲▼ 가 있다', page.includes('곳 일치') && page.includes('aria-label="이전 일치"') && page.includes('aria-label="다음 일치"'))
ok('일치가 든 섹션은 접혀 있어도 펴 둔다', page.includes('open.has(g.section.no) || sectionHasHit('))
ok('고른 보고서가 걸러지면 남은 첫 줄을 연다', page.includes('?? (q ? shown[0]?.view : undefined)'))
ok('보고서 자체는 손대지 않았다(쓰기 호출이 늘지 않았다)',
  (page.match(/method: 'PATCH'|method: 'DELETE'/g) ?? []).length === 3,
  `${(page.match(/method: 'PATCH'|method: 'DELETE'/g) ?? []).length}개`)

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
