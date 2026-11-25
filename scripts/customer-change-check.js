// 고객사 바꾸기 — **누가 할 수 있고, 무엇이 기록되는가** (2026-11-23).
//
//   node scripts/customer-change-check.js
//
// 지키는 약속
//   ① 저장은 라우트가 한다 — 브라우저가 customers·contacts·devices 를 직접 고치지 않는다.
//      그래야 사건(customer_events)을 같은 자리에서 적을 수 있다(그 표는 service role 전용).
//   ② 문턱은 **로그인**이다. 이동·병합도 열렸고, 지우는 쪽(삭제·복구·대리점 전환)만 슈퍼관리자다.
//   ③ 바꿀 수 있는 칸은 흰 목록으로 못 박는다 — is_parent·deleted_at 같은 칸은 못 바꾼다.
//   ④ 사건의 before 는 **라우트가 DB 에서 읽은 값**이다(화면이 보낸 값을 믿지 않는다).
//   ⑤ 고친 자국은 활동이 아니다 — 「변경」 종류로 서고 기본 필터에서 꺼져 있다.

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

const E = load(path.join(ROOT, 'lib/customerEvents.ts'))
const V = load(path.join(ROOT, 'lib/customerEventView.ts'))
const T = load(path.join(ROOT, 'lib/timelineFilter.ts'))
const { touchDate } = load(path.join(ROOT, 'lib/customerLastTouch.ts'))

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

console.log('\n── ① 사건 종류 ──')
// 2026-11-26 — 열한 가지. 견적을 포캐스트에 걸고 푸는 일도 **고친 일**이다
// (그 포캐스트의 금액·단계가 함께 움직인다).
eq('고친 일 열한 가지', [...E.CHANGE_EVENT_TYPES], [
  'site_status_changed', 'site_agency_changed', 'site_moved', 'sites_merged',
  'company_industry_changed', 'site_edited', 'contact_edited', 'device_edited',
  'customer_deleted', 'customer_restored', 'quote_forecast_linked',
])
ok('리드 사건은 「고친 일」이 아니다',
  ['lead_registered', 'lead_assigned', 'lead_reassigned'].every(t => !E.isChangeEvent(t)))
ok('모르는 종류도 「고친 일」이 아니다', E.isChangeEvent('뭔가_새로운') === false)

console.log('\n── ② 바뀐 칸만 적는다 ──')
const LAB = { status: '상태', note: '메모' }
eq('바뀐 칸 하나', E.fieldChanges({ status: '활성', note: 'a' }, { status: '이탈', note: 'a' }, LAB),
  [{ field: 'status', label: '상태', before: '활성', after: '이탈' }])
eq('하나도 안 바뀌면 빈 배열', E.fieldChanges({ status: '활성' }, { status: '활성' }, LAB), [])
eq('빈 값과 null 은 같은 것으로 본다', E.fieldChanges({ note: null }, { note: '' }, LAB), [])
eq('공백만 있는 값도 같다', E.fieldChanges({ note: ' ' }, { note: '' }, LAB), [])
eq('새로 넣은 값은 before 가 null', E.fieldChanges(null, { note: '처음' }, LAB),
  [{ field: 'note', label: '메모', before: null, after: '처음' }])
eq('이름을 모르면 칸 이름을 그대로 쓴다', E.fieldChanges({}, { weird: 'v' }, LAB)[0].label, 'weird')

console.log('\n── ③ 활동 이력 한 줄 ──')
const line = (type, payload) => V.eventLine({ id: 1, customer_id: 1, event_type: type, occurred_at: '2026-11-23', actor_engineer_id: 4, payload })
eq('상태 변경', line('site_status_changed', { site_name: '1공장', before: '활성', after: '이탈' }),
  { label: '상태 변경', title: '1공장', body: '활성 → 이탈', owner: '' })
eq('대리점 변경 — 빈 값은 없음', line('site_agency_changed', { site_name: '1공장', before: null, after: '젠트' }).body,
  '없음 → 젠트')
eq('분류 지정', line('company_industry_changed', { company_name: '가나', before: null, after: '3.자동차 - 완성차' }).label, '분류 지정')
eq('회사 이동', line('site_moved', { site_name: '1공장', before: '가나', after: '다라' }).body, '가나 → 다라')
eq('사업장 병합', line('sites_merged', { kept: '본사', merged_count: 2 }).body, '사업장 2곳을 이 줄로 합쳤습니다')
eq('사업장 수정 — 칸 여럿', line('site_edited', {
  site_name: '1공장',
  changes: [{ label: '상태', before: '활성', after: '이탈' }, { label: '메모', before: null, after: '확인' }],
}).body, '상태 활성 → 이탈 · 메모 없음 → 확인')
eq('담당자 추가', line('contact_edited', { mode: 'add', name: '박부장' }),
  { label: '담당자 추가', title: '박부장', body: '담당자를 추가했습니다', owner: '' })
eq('장비 수정', line('device_edited', { mode: 'edit', device: 'SURFCOM 1800', changes: [{ label: 'S/N', before: 'A', after: 'B' }] }).body,
  'S/N A → B')
eq('바뀐 칸을 못 받아도 줄은 선다', line('site_edited', {}).body, '수정했습니다')

console.log('\n── ④ 활동 이력에서의 자리 ──')
ok('「변경」 종류가 있다', T.TIMELINE_KINDS.includes('변경'))
eq('기본으로 꺼 두는 종류', [...T.DEFAULT_OFF_KINDS], ['변경'])
const all = T.allSelected(T.TIMELINE_KINDS, [1, 2])
ok('처음 상태에는 「변경」이 빠져 있다', !all.kinds.includes('변경'))
ok('나머지는 다 켜져 있다', T.TIMELINE_KINDS.filter(k => k !== '변경').every(k => all.kinds.includes(k)))
ok('처음 상태는 「좁힌 것」이 아니다(칩이 깔리지 않는다)', T.narrowsKind(all, T.TIMELINE_KINDS) === false)
ok('「변경」을 켜면 좁힌 상태다', T.narrowsKind({ ...all, kinds: [...T.TIMELINE_KINDS] }, T.TIMELINE_KINDS) === true)
const rows = [{ kind: '변경', date: '2026-11-23', siteId: 1 }, { kind: '서비스', date: '2026-11-20', siteId: 1 }]
eq('처음 상태에서는 변경 줄이 빠진다', T.applyFilter(rows, all, { kinds: T.TIMELINE_KINDS, siteIds: [1, 2] }).length, 1)
eq('켜면 보인다', T.applyFilter(rows, { ...all, kinds: [...T.TIMELINE_KINDS] }, { kinds: T.TIMELINE_KINDS, siteIds: [1, 2] }).length, 2)

console.log('\n── ⑤ 최근 활동은 이 줄을 보지 않는다 ──')
const TOUCH = fs.readFileSync(path.join(ROOT, 'lib/customerLastTouch.ts'), 'utf8')
ok('최근 활동 정본이 customer_events 를 읽지 않는다', !/customer_events/.test(TOUCH))
ok('날짜 자르기는 그대로다(회귀 확인)', touchDate('2026-11-23T10:00:00+09:00') === '2026-11-23')

console.log('\n── ⑥ 라우트가 같은 약속을 지키는가(글자 검사) ──')
const ROUTE = fs.readFileSync(path.join(ROOT, 'app/api/customer-change/route.ts'), 'utf8')
const PARENT = fs.readFileSync(path.join(ROOT, 'app/api/parent-company/route.ts'), 'utf8')
const PANE = fs.readFileSync(path.join(ROOT, 'components/home/list/CompanyPane.tsx'), 'utf8')
const SAVE = fs.readFileSync(path.join(ROOT, 'lib/saveCustomerEdit.ts'), 'utf8')
const CONTACT = fs.readFileSync(path.join(ROOT, 'hooks/customer/useContactCrud.ts'), 'utf8')
const DEVICE = fs.readFileSync(path.join(ROOT, 'hooks/customer/useDeviceCrud.ts'), 'utf8')
const PAGE = fs.readFileSync(path.join(ROOT, 'app/page.tsx'), 'utf8')

ok('문턱은 로그인이다', /loadCaller\(\{ kind: 'login' \}/.test(ROUTE))
ok('바꿀 수 있는 칸을 흰 목록으로 거른다', /function pick\(/.test(ROUTE) && /SITE_COLUMNS/.test(ROUTE))
ok('흰 목록에 위험한 칸이 없다',
  !/is_parent|deleted_at|is_agency/.test(ROUTE.slice(ROUTE.indexOf('const SITE_COLUMNS'), ROUTE.indexOf('function pick'))))
ok('before 는 DB 에서 읽는다', /select\('\*'\)[\s\S]{0,200}maybeSingle\(\)/.test(ROUTE))
ok('actor 는 세션에서 넣는다', /actor_engineer_id: actor/.test(ROUTE))
ok('여덟 종류를 모두 적는다',
  ['site_status_changed', 'site_agency_changed', 'company_industry_changed', 'site_edited',
    'contact_edited', 'device_edited'].every(t => ROUTE.includes(t))
  && ['site_moved', 'sites_merged'].every(t => PARENT.includes(t)))
ok('이동·병합이 사업장 수준으로 내려왔다',
  /SITE_LEVEL = new Set\(\['rename-site', 'move', 'merge-sites'\]\)/.test(PARENT))
ok('지우는 쪽은 슈퍼관리자로 남는다',
  /kind: 'superadmin'/.test(PARENT) && PARENT.includes("action === 'delete'"))
ok('화면은 더 이상 표를 직접 고치지 않는다 — 일괄',
  !/from\('customers'\)\.update/.test(PANE), 'CompanyPane 에 직접 쓰기가 남아 있다')
ok('화면은 더 이상 표를 직접 고치지 않는다 — 사업장 수정',
  !/from\('customers'\)\.update/.test(SAVE))
ok('화면은 더 이상 표를 직접 고치지 않는다 — 담당자',
  !/from\('contacts'\)\.(insert|update)\(\{ name/.test(CONTACT))
ok('장비 추가·수정도 라우트를 지난다',
  DEVICE.includes("action: 'device-add'") && DEVICE.includes("action: 'device-edit'"))
ok('분류 일괄 지정도 라우트를 지난다', PAGE.includes("action: 'company-industry'"))
ok('병합 버튼이 슈퍼관리자 전용이 아니다', !/canMergeSites=\{canEditCompany\}/.test(PANE))

console.log('\n── ⑦ 저장 뒤 다시 읽기는 **한 길**이다 ──')
const BODY = fs.readFileSync(path.join(ROOT, 'components/customer/CustomerDetailBody.tsx'), 'utf8')
ok('다시 읽기 함수가 하나 있다', /const refreshCustomers = useCallback\(async \(\) => \{/.test(PAGE))
ok('그 함수가 회사 목록과 업체 자료를 함께 읽는다',
  /invalidateParents\(\)[\s\S]{0,200}loadParents\(\), fetchData\(\)/.test(PAGE))
ok('저장 경로가 제각각 읽지 않는다 — loadParents 직접 호출이 남아 있지 않다',
  (PAGE.match(/loadParents\(\)\.then\(setCompanies\)/g) ?? []).length === 0,
  '예전 방식(개별 호출)이 남아 있다')
ok('회사·대리점 pane 이 그 함수를 부른다',
  (PAGE.match(/onSaved=\{\(\) => \{ void refreshCustomers\(\) \}\}/g) ?? []).length >= 2)
ok('가운데 pane 도 알린다', /onChanged=\{\(\) => \{ void refreshCustomers\(\) \}\}/.test(PAGE))
ok('사업장 상세는 세 훅에 **같은 함수**를 넘긴다',
  (BODY.match(/fetchDetail: refreshAll/g) ?? []).length === 3 && /const refreshAll = useCallback/.test(BODY))
ok('그 함수가 바깥에도 알린다', /onChanged\?\.\(\)/.test(BODY))
ok('일괄 작업은 낙관적으로 먼저 고친다', /onPatchLocal\?\.\(selected, optimistic\)/.test(PANE))
ok('낙관적 반영은 아는 칸만 고친다',
  /patchCustomersLocally = useCallback\(\(ids: number\[\], patch: Partial<Customer>\)/.test(PAGE))

console.log('\n── ⑧ 리드 사건은 「리드」 종류다(기본 켜짐) ──')
eq('리드 묶음 여덟 가지', E.LEAD_EVENT_TYPES.length, 8)
ok('리드는 「고친 일」이 아니다', E.LEAD_EVENT_TYPES.every(t => !E.isChangeEvent(t)))
ok('「리드」 종류가 목록에 있다', T.TIMELINE_KINDS.includes('리드'))
ok('리드는 기본으로 켜져 있다', !T.DEFAULT_OFF_KINDS.includes('리드'))
const TL = fs.readFileSync(path.join(ROOT, 'components/customer/ActivityTimeline.tsx'), 'utf8')
ok('타임라인이 리드를 따로 세운다', /isLeadEvent\(e\.event_type\)/.test(TL))
eq('배정 불가 한 줄', V.eventLine({ id: 1, customer_id: 1, event_type: 'lead_unassignable', occurred_at: 'x', actor_engineer_id: 1, payload: { lead_no: 'LD-26-003', reason: '예산 없음' } }).body, '예산 없음')
eq('상태 바뀜 한 줄', V.eventLine({ id: 1, customer_id: 1, event_type: 'lead_status_changed', occurred_at: 'x', actor_engineer_id: 1, payload: { lead_no: 'LD-26-003', from: '신규', to: '미진행', reason: '연락 두절' } }).body, '신규 → 미진행 · 연락 두절')
eq('회수 한 줄', V.eventLine({ id: 1, customer_id: 1, event_type: 'lead_recalled', occurred_at: 'x', actor_engineer_id: 1, payload: { lead_no: 'LD-26-003', reason: '중복 등록' } }).label, '리드 회수')
eq('등록 줄은 요약이 먼저다(전문은 줄바꿈 뒤)', V.eventLine({ id: 1, customer_id: 1, event_type: 'lead_registered', occurred_at: 'x', actor_engineer_id: 1, payload: { lead_no: 'LD-26-003', interest_product: 'CMM', partner_company: '가나상사', note: '긴 회의록' } }).body.split(String.fromCharCode(10))[0], 'CMM · 가나상사')
eq('전문도 들고 있다', V.eventLine({ id: 1, customer_id: 1, event_type: 'lead_registered', occurred_at: 'x', actor_engineer_id: 1, payload: { lead_no: 'LD-26-003', interest_product: 'CMM', partner_company: '가나상사', note: '긴 회의록' } }).body.split(String.fromCharCode(10))[1], '긴 회의록')
eq('옛 줄은 업종으로 떨어진다', V.eventLine({ id: 1, customer_id: 1, event_type: 'lead_registered', occurred_at: 'x', actor_engineer_id: 1, payload: { lead_no: 'LD-26-003', industry: '3.자동차' } }).body, '3.자동차')
const PANE2 = fs.readFileSync(path.join(ROOT, 'components/home/list/CompanyPane.tsx'), 'utf8')
const MERGE2 = fs.readFileSync(path.join(ROOT, 'components/home/list/SiteMergeModal.tsx'), 'utf8')
ok('빈 사업장 이름은 다른 곳과 같은 말을 쓴다',
  !/'\\(이름 없음\\)'/.test(PANE2) && !/'\\(이름 없음\\)'/.test(MERGE2))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
