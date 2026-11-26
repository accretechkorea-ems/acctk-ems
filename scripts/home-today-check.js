// 홈 「내 오늘」 (2026-11-26).
//
//   node scripts/home-today-check.js
//
// 지키는 약속
//   ① 할 일 목록은 **지남 → 오늘 → 이후** 순이고, 같은 묶음 안에서는 기한이 이른 것부터다.
//     기한 없는 줄은 맨 끝이다(「언젠가」도 할 일이지만 재촉하지 않는다).
//   ② 자동 줄은 **표에 쓰지 않고 조회 때 만든다** — 견적 유효기간 만료 · 미배정 리드 ·
//     결재 대기 · 설치 예정 장비 · 실주 사유 미입력. 그래서 원본이 바뀌면 줄도 사라진다
//     (발주가 나면 「유효기간 만료」 줄은 그 자리에서 없어진다).
//   ③ 타일 여섯은 **목록과 같은 줄**을 센다. 한 곳(lib/tasks.ts)에서 만들기 때문에 어긋나지 않는다.
//   ④ 쓰기는 /api/task(service role)만 한다. 만든 사람은 세션에서 박고, 표가 아직 없으면
//     503 과 **무엇을 돌려야 하는지** 한 줄로 알려 준다(홈의 다른 카드는 그대로 돈다).
//   ⑤ 창은 **한 벌**이다 — 홈·포캐스트 카드·견적 줄·리드 줄·장비 카드가 같은 TaskAddModal 을 쓴다.
//   ⑥ 80 대시보드는 메뉴에서 내려가고 그 주소는 홈으로 간다. **코드는 그대로 남는다.**
//   ⑦ 「＋ 사후 실적」은 홈 「내 견적」 카드 머리에 있고 실적 현황에는 없다.

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

const T = load(path.join(ROOT, 'lib/tasks.ts'))

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

const TODAY = '2026-11-26'

console.log('── ① 기한 묶음과 차례 ──')
eq('기한이 지나면 지남', T.bucketOf('2026-11-21', TODAY), 'late')
eq('오늘이면 오늘', T.bucketOf(TODAY, TODAY), 'today')
eq('앞날이면 이후', T.bucketOf('2026-12-01', TODAY), 'later')
eq('기한이 없으면 이후', T.bucketOf(null, TODAY), 'later')
eq('꼬리표 — 지남', T.dueLabel('2026-11-21', TODAY), '지남 11-21')
eq('꼬리표 — 오늘', T.dueLabel(TODAY, TODAY), '오늘')
eq('꼬리표 — 이후', T.dueLabel('2026-12-01', TODAY), '12-01')
eq('꼬리표 — 기한 없음', T.dueLabel(null, TODAY), '기한 없음')

const item = (key, due) => ({ key, title: key, due, kind: 'manual', refType: null, refId: null, real: true })
eq('지남 → 오늘 → 이후, 오래 밀린 것이 위',
  T.sortItems([item('c', '2026-12-05'), item('b', TODAY), item('a1', '2026-11-20'), item('a2', '2026-11-10'), item('z', null)], TODAY)
    .map(i => i.key),
  ['a2', 'a1', 'b', 'c', 'z'])

console.log('\n── ② 자동 줄 ──')
const quotes = [
  // 유효기간 = 작성일 + 1개월 − 1일. 10-20 → 11-19(이미 지났다).
  { quote_id: 1, quote_number: 'KJW261020A', status: '견적중', quote_date: '2026-10-20', company: '네오오토' },
  // 11-01 → 11-30(7일 안이다).
  { quote_id: 2, quote_number: 'KJW261101A', status: '견적중', quote_date: '2026-11-01', company: '일진기계' },
  // 11-20 → 12-19(아직 멀다).
  { quote_id: 3, quote_number: 'KJW261120A', status: '견적중', quote_date: '2026-11-20', company: '디아이씨' },
  // 발주가 났으면 **세우지 않는다**(지시: 발주·실패 시 자동 소멸).
  { quote_id: 4, quote_number: 'KJW261020B', status: '발주(주문 대기)', quote_date: '2026-10-20', company: '두산' },
  { quote_id: 5, quote_number: 'KJW261020C', status: '실패', quote_date: '2026-10-20', company: '현대트랜시스' },
]
const expiry = T.quoteExpiryItems(quotes, TODAY)
eq('만료 임박·만료된 건만 선다', expiry.map(i => i.refId), [1, 2])
eq('글자는 「회사 » 번호 — 유효기간 만료」', expiry[0].title, '네오오토 » KJW261020A — 유효기간 만료')
eq('기한은 만료일이다(지난 건은 지남으로 떨어진다)', [expiry[0].due, T.bucketOf(expiry[0].due, TODAY)], ['2026-11-19', 'late'])
eq('되돌린 견적은 되돌린 날부터 다시 1개월',
  T.quoteExpiryItems([{ quote_id: 9, quote_number: 'R', status: '견적중', quote_date: '2026-09-01', revived_at: '2026-11-01T02:00:00Z' }], TODAY)
    .map(i => i.due), ['2026-11-30'])
eq('체크할 수 없다(원본을 처리해야 사라진다)', expiry.every(i => i.real === false), true)

const leads = T.leadItems([{ lead_id: 7, lead_no: 'LD-26-032', company: '삼우정밀', created_at: '2026-11-22T01:00:00Z' }])
eq('리드 — 번호 · 회사 — 담당자 배정', leads[0].title, 'LD-26-032 · 삼우정밀 — 담당자 배정')
eq('리드의 기한은 등록일', leads[0].due, '2026-11-22')

const appr = T.approvalItems([{ doc_id: 3, title: '쇼룸 사용 신청' }])
eq('결재 — 제목 — 결재', appr[0].title, '쇼룸 사용 신청 — 결재')
eq('결재에는 기한을 매기지 않는다', appr[0].due, null)

const devs = T.deviceItems([
  { device_id: 1, device_name: 'SURFCOM', device_name2: 'NEX040', site: '일진글로벌', install_due_month: '2026-11' },
  { device_id: 2, device_name: 'SVA600A', device_name2: null, site: '현주산업', install_due_month: '2026-10' },
  { device_id: 3, device_name: '다음달', device_name2: null, site: 'KNA', install_due_month: '2026-12' },
], TODAY)
eq('당월·지난 달만 선다(다음 달은 재촉하지 않는다)', devs.map(d => d.refId), [1, 2])
eq('기한은 그 달 말일 — 당월은 이후', [devs[0].due, T.bucketOf(devs[0].due, TODAY)], ['2026-11-30', 'later'])
eq('지난 달은 지남', T.bucketOf(devs[1].due, TODAY), 'late')
eq('태그는 서비스', devs[0].kind, 'service')
eq('글자는 「사업장 » 장비 — 설치 예정」', devs[0].title, '일진글로벌 » SURFCOM NEX040 — 설치 예정')

const lostRows = T.lostReasonItems([{ opportunity_id: 5, title: '측정실 증설', company: '오토인더스트리' }])
eq('실주 사유 — 안내만 한다', lostRows[0].title, '오토인더스트리 » 측정실 증설 — 실주 사유 입력 필요')
eq('실주 사유 줄도 체크할 수 없다', lostRows[0].real, false)

console.log('\n── ②-2 표의 줄 + 자동 줄 ──')
const rows = [
  { task_id: 11, title: '구매팀 가격 협의', due_date: '2026-11-21', done_at: null, engineer_id: 4, created_by: 4, kind: 'forecast', ref_type: 'forecast', ref_id: 5, memo: null },
  { task_id: 12, title: '끝낸 일', due_date: '2026-11-20', done_at: '2026-11-25T01:00:00Z', engineer_id: 4, created_by: 4, kind: 'manual', ref_type: null, ref_id: null, memo: null },
]
const list = T.buildTaskList(rows, { today: TODAY, quotes, leads: [], approvals: [], devices: devs.length ? [] : [], lost: [] })
ok('끝낸 줄은 목록에 없다', !list.some(i => i.taskId === 12))
ok('표의 줄은 체크할 수 있다', list.find(i => i.taskId === 11).real === true)
ok('표의 줄과 자동 줄이 한 목록이다', list.some(i => i.real) && list.some(i => !i.real))
eq('태그 글자는 종류가 정한다', [T.KIND_LABEL.manual, T.KIND_LABEL.quote_expiry, T.KIND_LABEL.approval, T.KIND_LABEL.service],
  ['할 일', '견적', '결재', '서비스'])

console.log('\n── ③ 타일 ──')
const tiles = T.tileCounts(list, TODAY, { stale: 2, lead: 1, approval: 0 })
eq('지난 할 일 — 목록의 지남과 같은 수', tiles.late, list.filter(i => T.bucketOf(i.due, TODAY) === 'late').length)
eq('오늘 할 일 — 목록의 오늘과 같은 수', tiles.today, list.filter(i => T.bucketOf(i.due, TODAY) === 'today').length)
eq('나머지 셋은 받은 수 그대로', [tiles.stale, tiles.lead, tiles.approval], [2, 1, 0])
// 「교정 예정 30일」 타일은 2026-11-26 지시로 **빠졌다** — 다시 생기지 않는 것까지 본다.
ok('교정 타일은 없다', tiles.calibration === undefined && T.CALIBRATION_SOON_DAYS === undefined && T.calibrationSoon === undefined)
eq('멈춘 딜은 14일', T.STALE_DAYS, 14)
const stale = T.staleDeals([
  { opportunity_id: 1, title: 'A', last_at: '2026-11-05' },   // 21일
  { opportunity_id: 2, title: 'B', last_at: '2026-11-10' },   // 16일
  { opportunity_id: 3, title: 'C', last_at: '2026-11-25' },   // 1일 — 아니다
  { opportunity_id: 4, title: 'D', last_at: null },           // 활동 없음
], TODAY)
eq('14일 넘은 건만, 오래 멈춘 것부터', stale.map(d => d.opportunity_id), [4, 1, 2])
eq('멈춘 날 수를 함께 준다', stale[1].idleDays, 21)

console.log('\n── ④ 라우트 ──')
const ROUTE = read('app/api/task/route.ts')
ok('쓰기는 service role 라우트가 한다', /adminClient\(\)/.test(ROUTE) && /loadCaller\(\{ kind: 'login' \}/.test(ROUTE))
ok('만든 사람은 세션에서 박는다', /created_by: me/.test(ROUTE))
ok('목록은 내 것(또는 내가 적어 준 것)만', /\.or\(`engineer_id\.eq\.\$\{me\},created_by\.eq\.\$\{me\}`\)/.test(ROUTE))
ok('끝낸 줄은 기본으로 뺀다', /\.is\('done_at', null\)/.test(ROUTE))
ok('완료는 지우지 않고 찍는다', /action === 'done'/.test(ROUTE) && /done_at: done \? now : null/.test(ROUTE))
ok('남의 줄은 403', /이 할 일을 고칠 권한이 없습니다/.test(ROUTE))
ok('표가 없으면 503 과 한 줄 안내', /TASK_SCHEMA_MESSAGE, schema: true \}, \{ status: 503 \}/.test(ROUTE))
ok('그 한 줄은 lib 에 있다(화면도 같은 글자를 쓴다)', /tasks_20261126\.sql/.test(T.TASK_SCHEMA_MESSAGE))
ok('기한 모양을 검사한다', /\\d\{4\}-\\d\{2\}-\\d\{2\}/.test(ROUTE))

console.log('\n── ⑤ 창과 들어오는 자리 다섯 ──')
const MODAL = read('components/task/TaskAddModal.tsx')
const PICKER = read('components/task/TaskRefPicker.tsx')
const BUTTON = read('components/task/TaskAddButton.tsx')
ok('공용 부품을 쓴다(ModalCard·ModalOverlay)', /<ModalCard/.test(MODAL) && /<ModalOverlay/.test(MODAL))
ok('닫을 때 묻는다(쓴 것이 있으면)', /confirmClose dirty=\{dirty\}/.test(MODAL))
ok('연결 대상은 SearchSelect 로 찾는다', /<SearchSelect<TaskRefPick>/.test(PICKER))
ok('대상 다섯을 고를 수 있다', /TASK_REF_TYPES\.map/.test(PICKER))
eq('그 다섯', [...T.TASK_REF_TYPES], ['forecast', 'quote', 'lead', 'customer', 'device'])
ok('대상이 박혀 오면 고르는 칸이 아니다', /preset \? \(/.test(MODAL))
ok('단추는 클릭 전파를 끊는다(목록·카드 안에 들어간다)', /e\.stopPropagation\(\)/.test(BUTTON))
for (const [where, file, what] of [
  ['홈', 'app/dashboard/page.tsx', /<TaskAddModal/],
  ['포캐스트 카드', 'components/pipeline/OpportunityCard.tsx', /type: 'forecast'/],
  ['견적 줄', 'components/dashboard/MyQuotesPanel.tsx', /type: 'quote'/],
  ['리드 줄', 'app/leads/page.tsx', /type: 'lead'/],
  ['장비 카드', 'components/customer/DeviceSection.tsx', /type: 'device'/],
]) ok(`${where} 에서 열 수 있다`, what.test(read(file)) && /TaskAdd(Button|Modal)/.test(read(file)))

console.log('\n── ⑥ 홈 화면 ──')
const HOME = read('app/dashboard/page.tsx')
ok('타일 다섯이 선다', /<TodayTiles/.test(HOME))
ok('할 일 카드는 두 칸을 쓴다', /className="home-cell wide"/.test(HOME) && /\.home-cell\.wide \{ grid-column: span 2; \}/.test(HOME))
ok('작은 카드 둘이 선다', /<StaleDealsCard/.test(HOME) && /<UnassignedLeadsCard/.test(HOME))
ok('교정 카드는 없다(2026-11-26 지시로 뺐다)', !/CalibrationCard/.test(HOME) && !/CalibrationCard/.test(read('components/dashboard/TodayCards.tsx')))
ok('남긴 카드 넷 — 내 실적·내 견적·활동 기록·내 문구',
  /<MyStatCard/.test(HOME) && /<MyQuoteCard/.test(HOME) && /<ActivityCard/.test(HOME) && /<MySnippetCard/.test(HOME))
ok('뺀 카드 셋 — 포캐스트·알림·결재 대기',
  !/<ForecastCard/.test(HOME) && !/<NotificationCard/.test(HOME) && !/<ApprovalCard/.test(HOME))
ok('그 카드 부품은 지우지 않았다',
  /export function ForecastCard/.test(read('components/dashboard/HomeCards.tsx'))
  && /export function NotificationCard/.test(read('components/dashboard/HomeCards.tsx'))
  && /export function ApprovalCard/.test(read('components/dashboard/HomeCards.tsx')))
ok('미배정 리드는 배정하는 사람에게만 읽는다', /seeUnassignedLeads = isSuperAdmin\(me\)/.test(HOME))
ok('결재 수는 사이드바와 같은 스토어에서 온다', /useApprovalInbox\(engineerId\)/.test(HOME))
const HOOK = read('hooks/dashboard/useToday.ts')
ok('조각마다 따로 읽는다(하나가 실패해도 나머지는 뜬다)', /const run = async/.test(HOOK))
ok('칸·표가 없으면 조용히 빈 값', /schemaMissing/.test(HOOK) && /42703/.test(HOOK))
ok('미배정 리드를 못 보는 사람에게는 **읽지도** 않는다', /if \(seeLeads\) \{/.test(HOOK))

console.log('\n── ⑦ 80 대시보드 · ＋ 사후 실적 ──')
const D80 = read('app/dashboard/80/page.tsx')
const MENU = read('lib/menuPerms.ts')
ok('메뉴에서 내렸다(키는 남긴다)', /key: 'dashboard_80'[^\n]*hidden: true/.test(MENU))
ok('키를 지우지 않은 이유를 적어 두었다', /홀딩 현황\(\/holdings\)의 판정이 이 키를 쓰고/.test(MENU))
ok('그 주소는 홈으로 간다', /router\.replace\('\/dashboard'\)/.test(D80))
ok('화면 코드는 그대로 남아 있다', /export function Dashboard80Body\(\)/.test(D80))
ok('20 대시보드는 그대로다', /key: 'repair_dashboard'/.test(MENU) && !/repair_dashboard[^\n]*hidden/.test(MENU))
const SALES = read('app/sales/page.tsx')
ok('실적 현황에 「＋ 사후 실적」이 없다', !/\+ 사후 실적/.test(SALES) && !/<BackfillModal/.test(SALES))
ok('옮긴 자리를 적어 두었다', /홈 「내 견적」 카드 머리로 옮겼다/.test(SALES))
ok('홈 「내 견적」 카드 머리에 있다', /<BackfillButton/.test(HOME) && /headerRight=\{isSuperAdmin\(me\)/.test(HOME))
ok('창은 같은 창이다', /from '@\/components\/sales\/BackfillModal'/.test(read('components/dashboard/BackfillButton.tsx')))

console.log('\n── ⑧ SQL ──')
const SQL = read('db/tasks_20261126.sql')
ok('표를 만든다', /create table if not exists public\.tasks/.test(SQL))
ok('칸 — 제목·기한·완료·주인·종류·대상·메모',
  ['title', 'due_date', 'done_at', 'engineer_id', 'created_by', 'kind', 'ref_type', 'ref_id', 'memo']
    .every(c => new RegExp(`^\\s{2}${c}\\s`, 'm').test(SQL)))
ok('값 검사 셋', /tasks_kind_chk/.test(SQL) && /tasks_ref_type_chk/.test(SQL) && /tasks_title_chk/.test(SQL))
ok('RLS 정책 넷', ['tasks_select', 'tasks_insert', 'tasks_update', 'tasks_delete'].every(p => SQL.includes(`create policy ${p}`)))
ok('authenticated 에는 읽기만 내려 준다', /grant select on table public\.tasks to authenticated/.test(SQL)
  && !/grant (insert|update|delete)[^\n]*tasks/.test(SQL))
ok('자동 줄은 표에 쓰지 않는다고 적어 두었다', /\*\*이 표에 쓰지 않는다\*\*/.test(SQL))
ok('스키마를 깨운다', /notify pgrst, 'reload schema'/.test(SQL))
ok('APPLIED.md 에 적어 두었다', /tasks_20261126\.sql/.test(read('db/APPLIED.md')))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
