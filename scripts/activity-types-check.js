// 영업활동 종류 규칙 시험 — 드롭다운·집계·동선·색.
//
//   node scripts/activity-types-check.js
//
// 왜 따로 두는가 — 종류가 코드 상수에서 **표**로 옮겨 갔다(activity_types). 표가 바뀌면
// 네 자리가 함께 흔들린다: 고르는 칸, 카드·대시보드 집계, 동선 지도의 비방문 판정, 색.
// 그 넷의 규칙을 글로 못 박는다. 특히 **비활성·목록 밖 값의 과거 줄은 사라지면 안 된다** —
// 줄을 지우지 않는 표인데 화면에서 사라지면 합계와 줄이 어긋난다.

// eslint 의 no-require-imports 는 맨 require() 를 센다. node 로 직접 돌리는 CJS 라
// 그렇게 부를 수밖에 없다 — 한 번만 묶어 두고 그것만 쓴다.
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
        esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX,
      }, fileName: filename,
    }).outputText, filename)
  }
}
const origResolve = Module._resolveFilename
Module._resolveFilename = function (req, ...rest) {
  if (req.startsWith('@/')) req = path.join(ROOT, req.slice(2))
  return origResolve.call(this, req, ...rest)
}

const T = load(path.join(ROOT, 'lib/activityTypes.ts'))
const A = load(path.join(ROOT, 'lib/activity.ts'))
const R = load(path.join(ROOT, 'lib/routeMap.ts'))
const C = load(path.join(ROOT, 'lib/categoryColors.ts'))
const { SERVICE_TYPES } = load(path.join(ROOT, 'components/activity/ActivityCard.ts' + 'x'))

let fails = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
}

/** 지금 표의 모양 그대로 — 적용본(db/crm_cleanup_20261118.sql ⑥)의 다섯 줄. */
const type = (code, label, sort, extra = {}) =>
  ({ code, label, sort_order: sort, is_active: true, is_system: false, is_remote: false, ...extra })

const LIST = [
  type('PHONE', '전화상담', 10, { is_remote: true }),
  type('VISIT', '방문미팅', 20),
  type('SPEC', '사양검토', 30),
  type('BID', '경쟁입찰', 40),
  type('LEAD_REG', '리드 등록', 90, { is_system: true }),
]
/** 관리 화면에서 더한 종류 하나 + 비활성된 옛 종류 하나. */
const WITH_EXTRA = [
  ...LIST,
  type('DEMO', '데모 시연', 100),
  type('OLD', '옛 종류', 110, { is_active: false }),
]

console.log('── 드롭다운(고를 수 있는 종류) ──')
eq('활성이고 자동이 아닌 것만',
  T.selectableActivityTypes(LIST).map(t => t.label),
  ['전화상담', '방문미팅', '사양검토', '경쟁입찰'])
eq('system 줄(리드 등록)은 빠진다',
  T.selectableActivityTypes(LIST).some(t => t.is_system), false)
eq('비활성 줄은 빠진다',
  T.selectableActivityTypes(WITH_EXTRA).map(t => t.label),
  ['전화상담', '방문미팅', '사양검토', '경쟁입찰', '데모 시연'])
eq('지금 고른 값이 비활성이어도 **남긴다**(수정 창에서 값이 바뀌지 않게)',
  T.selectableActivityTypes(WITH_EXTRA, '옛 종류').map(t => t.label),
  ['전화상담', '방문미팅', '사양검토', '경쟁입찰', '데모 시연', '옛 종류'])
eq('지금 고른 값이 system 이어도 남긴다',
  T.selectableActivityTypes(LIST, '리드 등록').map(t => t.label),
  ['전화상담', '방문미팅', '사양검토', '경쟁입찰', '리드 등록'])
eq('이미 활성 목록에 있으면 두 번 넣지 않는다',
  T.selectableActivityTypes(LIST, '방문미팅').map(t => t.label),
  ['전화상담', '방문미팅', '사양검토', '경쟁입찰'])

console.log('\n── 집계 순서(표시) — 비활성·system 도 줄로 남는다 ──')
eq('서비스 유형 다음에 영업 종류',
  A.activityTypeOrder(LIST),
  [...SERVICE_TYPES, '전화상담', '방문미팅', '사양검토', '경쟁입찰', '리드 등록'])
eq('비활성 종류도 집계 줄에 있다(과거 줄이 사라지면 안 된다)',
  A.activityTypeOrder(WITH_EXTRA).includes('옛 종류'), true)
eq('표를 아직 못 읽었으면 서비스 유형만',
  A.activityTypeOrder([]), [...SERVICE_TYPES])

// 화면이 쓰는 셈법 그대로 — 목록에 없는 값도 세고, 뒤에 줄로 붙인다.
const countWith = (order, rows) => {
  const counts = {}
  for (const t of order) counts[t] = 0
  for (const r of rows) if (r) counts[r] = (counts[r] ?? 0) + 1
  const extra = Object.keys(counts).filter(t => !order.includes(t)).sort()
  return { counts, shown: [...order, ...extra] }
}
console.log('\n── 목록 밖 값 ──')
{
  const order = A.activityTypeOrder(LIST)
  const got = countWith(order, ['방문미팅', '사라진 종류', '사라진 종류'])
  eq('목록 밖 값도 센다', got.counts['사라진 종류'], 2)
  eq('목록 밖 값은 줄 맨 뒤에 붙는다', got.shown[got.shown.length - 1], '사라진 종류')
  eq('합계가 맞는다', Object.values(got.counts).reduce((a, b) => a + b, 0), 3)
}

console.log('\n── 동선 지도(비방문 제외) ──')
eq('표의 is_remote 가 비방문 목록이다', T.remoteActivityTypes(LIST), ['전화상담'])
eq('서비스 쪽 비방문은 코드에 고정', [...R.REMOTE_SERVICE_TYPES], ['유선기술지원'])
{
  const entry = (id, type) => ({
    source: 'sales', id, engineerId: 1, date: '2026-11-19', type,
    customerId: 100 + id, customerName: `업체${id}`, notes: null, isPaid: null,
    lat: 37.5, lng: 127.0,
  })
  const entries = [entry(1, '방문미팅'), entry(2, '전화상담'), entry(3, '유선기술지원'), entry(4, '데모 시연')]
  const r1 = R.buildRoute(entries, T.remoteActivityTypes(LIST))
  eq('전화상담·유선기술지원은 빠진다', r1.excluded.map(e => e.type).sort(), ['유선기술지원', '전화상담'])
  eq('새 종류는 기본이 방문이라 지도에 찍힌다', r1.stops.map(s => s.customerId).sort(), [101, 104])

  // 관리 화면에서 그 종류를 비방문으로 바꾸면 지도에서 빠져야 한다.
  const remoteDemo = WITH_EXTRA.map(t => (t.code === 'DEMO' ? { ...t, is_remote: true } : t))
  const r2 = R.buildRoute(entries, T.remoteActivityTypes(remoteDemo))
  eq('비방문으로 바꾸면 빠진다', r2.stops.map(s => s.customerId), [101])
}

console.log('\n── 색 — 새 종류는 영업 기본 한 색 ──')
eq('표에 있는 종류는 제 색', C.activityTypeColor('방문미팅'), C.ACTIVITY_TYPE_COLORS['방문미팅'])
eq('새 종류는 영업 한 색', C.activityTypeColor('데모 시연'), C.TIMELINE_KIND_COLORS['영업'])
eq('값이 없으면 FALLBACK', C.activityTypeColor(null), C.FALLBACK_COLOR)
eq('새 색을 만들지 않는다(액센트 그대로)', C.activityTypeColor('데모 시연').dot, '#234ea2')

console.log('\n── 새 code·이름 검사 ──')
eq('빈 코드', T.validateNewCode(LIST, ''), '코드를 입력해주세요')
eq('소문자 금지', T.validateNewCode(LIST, 'demo'), '코드는 영문 대문자·숫자·밑줄만 쓸 수 있습니다')
eq('이미 있는 코드', T.validateNewCode(LIST, 'VISIT'), '이미 있는 코드입니다')
eq('괜찮은 코드', T.validateNewCode(LIST, 'DEMO_2'), null)
eq('이미 있는 이름(이름이 FK 대상이라 유일해야 한다)',
  T.validateNewLabel(LIST, '방문미팅'), '이미 있는 이름입니다')
eq('빈 이름', T.validateNewLabel(LIST, '  '), '이름을 입력해주세요')
eq('괜찮은 이름', T.validateNewLabel(LIST, '데모 시연'), null)

console.log('\n── 순서 ──')
eq('다음 순서는 맨 아래', T.nextSortOrder(LIST), 100)
eq('빈 목록이면 10', T.nextSortOrder([]), 10)

console.log('\n── 오류 문구 ──')
eq('권한', T.typeErrorMessage({ code: '42501' }), '권한이 없습니다. 활동 종류는 슈퍼관리자만 바꿀 수 있습니다')
eq('RLS 메시지', T.typeErrorMessage({ message: 'new row violates row-level security policy' }),
  '권한이 없습니다. 활동 종류는 슈퍼관리자만 바꿀 수 있습니다')
eq('중복', T.typeErrorMessage({ code: '23505' }), '이미 있는 코드나 이름입니다')
eq('참조 중', T.typeErrorMessage({ code: '23503' }), '활동 기록이 쓰고 있는 종류입니다')

console.log(fails === 0 ? '\n모두 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
