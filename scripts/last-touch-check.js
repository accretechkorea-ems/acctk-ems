// 「최근 활동」 — **활동 이력에 줄로 나오는 것만** 활동이다 (2026-11-22).
//
//   node scripts/last-touch-check.js
//
// 지키는 약속
//   ① 정본은 lib/customerLastTouch.ts 하나다 — 일곱 갈래(영업활동·서비스·견적·수리·의뢰·
//      포캐스트·홀딩)를 보고, 가장 늦은 날을 돌려준다.
//   ② **고친 시각(updated_at)은 어디에서도 보지 않는다.** 업체·사업장·담당자·장비 정보
//      수정, 메모 수정, 병합·이동은 활동이 아니다. 포캐스트·홀딩도 등록·시작·종료한 날로 센다.
//   ③ 정렬·표시(지도 목록·목록 보기·회사 카드 타일·사업장 표·대리점 표)가 모두 그 값 하나를 쓴다.
//      지도 목록은 **장비 납입일·customer_id 를 섞지 않는다**(둘 다 활동이 아니다).

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

const { pickLastTouch, touchValue, touchDate } = load(path.join(ROOT, 'lib/customerLastTouch.ts'))
const { sortGroups, daysSince } = load(path.join(ROOT, 'lib/customerList.ts'))

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

console.log('\n── ① 일곱 갈래 ──')
eq('가장 늦은 날이 이긴다',
  pickLastTouch({ activity: ['2026-01-02'], service: ['2026-03-04'], quote: ['2025-12-31'] }),
  { date: '2026-03-04', source: '서비스', actorId: null })
eq('같은 날이면 앞선 갈래(영업활동)가 이긴다',
  pickLastTouch({ activity: ['2026-03-04'], service: ['2026-03-04'] }).source, '영업활동')
eq('포캐스트도 활동이다', pickLastTouch({ forecast: ['2026-05-06'] }),
  { date: '2026-05-06', source: '포캐스트', actorId: null })
eq('홀딩도 활동이다', pickLastTouch({ holding: ['2026-05-07'] }),
  { date: '2026-05-07', source: '홀딩', actorId: null })
eq('의뢰도 활동이다', pickLastTouch({ inquiry: ['2026-05-08'] }).source, '의뢰')
eq('수리도 활동이다', pickLastTouch({ repair: ['2026-05-09'] }).source, '수리')
eq('아무것도 없으면 null', pickLastTouch({}), null)
eq('날짜가 아닌 값은 세지 않는다', pickLastTouch({ activity: ['', null, '2026', '어제'] }), null)
eq('사람(actorId)도 같이 온다',
  pickLastTouch({ service: [{ date: '2026-02-02', actorId: 7 }] }),
  { date: '2026-02-02', source: '서비스', actorId: 7 })
eq('시각이 섞여 와도 날짜로 자른다', touchDate('2026-02-02T11:22:33+09:00'), '2026-02-02')
ok('정렬 값은 날짜순으로 는다',
  touchValue({ date: '2026-03-04' }) > touchValue({ date: '2026-03-03' })
  && touchValue(null) === 0)

console.log('\n── ② 고친 시각은 활동이 아니다 ──')
const TOUCH = fs.readFileSync(path.join(ROOT, 'lib/customerLastTouch.ts'), 'utf8')
ok('정본이 updated_at 을 읽지 않는다', !/updated_at(?!\))/.test(TOUCH.replace(/\/\/.*$/gm, '')),
  'updated_at 을 읽는 줄이 있다')
eq('읽는 표 — 일곱 갈래 + 서비스 참여자',
  (TOUCH.match(/sb\.from\('[a-z_]+'\)/g) ?? []),
  ["sb.from('sales_activities')", "sb.from('service_history')", "sb.from('quotes')",
    "sb.from('repairs')", "sb.from('service_engineers')", "sb.from('inquiries')",
    "sb.from('sales_opportunities')", "sb.from('holdings')"])
ok('포캐스트는 등록일·종료일로 센다(고친 시각이 아니다)',
  /created_at, closed_at/.test(TOUCH) && !/opportunit[\s\S]{0,120}updated_at/.test(TOUCH))
ok('홀딩은 시작일·해결일로 센다', /started_at, resolved_at/.test(TOUCH))
ok('시각 칸은 한국 날짜로 읽는다(UTC 로 자르지 않는다)', /kstYmd/.test(TOUCH))

console.log('\n── ③ 정렬·표시가 모두 같은 값을 쓴다 ──')
const PAGE = fs.readFileSync(path.join(ROOT, 'app/page.tsx'), 'utf8')
const LIST = fs.readFileSync(path.join(ROOT, 'lib/customerList.ts'), 'utf8')
const HOME = fs.readFileSync(path.join(ROOT, 'hooks/useHomeData.ts'), 'utf8')
const COMPANY = fs.readFileSync(path.join(ROOT, 'components/home/list/CompanyPane.tsx'), 'utf8')
const AGENCY = fs.readFileSync(path.join(ROOT, 'components/home/list/AgencyPane.tsx'), 'utf8')
const DATA = fs.readFileSync(path.join(ROOT, 'lib/customerExportData.ts'), 'utf8')

// 지도 목록의 정렬 토막만 떼어 본다.
const sortBlock = (() => {
  const at = PAGE.indexOf('return [...filtered].sort(')
  return at < 0 ? '' : PAGE.slice(at, PAGE.indexOf('\n  }, [', at))
})()
ok('지도 목록 정렬 토막을 찾았다', sortBlock.length > 0)
ok('지도 목록은 접점 값만 본다', /latestServiceDateMap\.get/.test(sortBlock))
ok('지도 목록이 장비 납입일을 섞지 않는다', !/install_date/.test(sortBlock), '장비 날짜가 섞였다')
ok('지도 목록이 customer_id 를 섞지 않는다', !/customer_id\b/.test(sortBlock.replace(/latestServiceDateMap\.get\(\w\.customer_id\)/g, '')),
  'id 가 정렬에 섞였다')
ok('활동이 같으면 이름순', /localeCompare\(.*'ko'\)/.test(sortBlock))
ok('지도 목록의 접점 값은 정본에서 온다(touchValue)', /touchValue\(touch\)/.test(HOME))

ok('목록 보기 정렬은 touch 만 본다',
  /const ad = a\.touch\?\.date \?\? ''/.test(LIST) && !/updated_at/.test(LIST))
ok('목록 트리의 경과일도 touch 에서 센다', /days: daysSince\(touch\?\.date \?\? null, today\)/.test(LIST))
eq('경과일 — 날짜가 없으면 null', daysSince(null, '2026-11-22'), null)
eq('경과일 — 이틀 전', daysSince('2026-11-20', '2026-11-22'), 2)

ok('회사 카드 타일은 group.touch 를 쓴다', /value=\{group\.touch \? group\.touch\.date : '-'\}/.test(COMPANY))
ok('사업장 표·대리점 표도 touch 를 쓴다', /s\.touch/.test(COMPANY) && /r\.touch/.test(AGENCY))

console.log('\n── ④ updated_at 으로 정렬·표시하는 자리 0건 ──')
// 「최근 활동」을 세고·세우고·보여 주는 파일들. 업체 표에는 updated_at 칸 자체가 없다(2026-11-22 확인).
const SPOTS = [
  ['lib/customerLastTouch.ts', TOUCH],
  ['lib/customerList.ts', LIST],
  ['hooks/useHomeData.ts', HOME],
  ['lib/customerExportData.ts', DATA],
  ['app/page.tsx — 정렬 토막', sortBlock],
  ['components/home/list/AgencyPane.tsx', AGENCY],
]
let dirty = 0
for (const [name, src] of SPOTS) {
  const hits = (src.replace(/\/\/.*$/gm, '').match(/updated_at/g) ?? []).length
  if (hits > 0) dirty++
  ok(`${name} — updated_at 0건`, hits === 0, `${hits}건`)
}
eq('합계 0건', dirty, 0)
// CompanyPane 은 **영업 기록을 저장할 때** sales_activities.updated_at 을 쓴다(쓰기다).
// 그 한 자리 말고 최근 활동을 보여 주는 칸에는 없어야 한다.
eq('회사 화면의 updated_at 은 영업 기록 저장 한 자리뿐',
  (COMPANY.match(/updated_at/g) ?? []).length, 1)
ok('그 한 자리는 sales_activities 저장이다',
  /from\('sales_activities'\)\.update\(\{[\s\S]{0,400}updated_at: nowIso/.test(COMPANY))

console.log('\n── ⑤ 묶음 세우기 ──')
const g = (name, date) => ({ companyName: name, touch: date ? { date, source: '서비스', actorId: null } : null })
eq('최근 활동이 위, 없는 묶음은 맨 아래',
  sortGroups([g('가', '2026-01-01'), g('나', null), g('다', '2026-05-05')], 'touch').map(x => x.companyName),
  ['다', '가', '나'])
eq('이름순은 가나다', sortGroups([g('다', '2026-05-05'), g('가', null)], 'name').map(x => x.companyName), ['가', '다'])

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
