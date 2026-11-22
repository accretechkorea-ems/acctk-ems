/**
 * 활동 이력 **필터**와 회사 카드 **포캐스트 블록**의 규칙.
 *
 * 여기서 지키는 약속
 *   · 전부 고른 것은 「좁히지 않음」이다 — 칩도 없고 줄도 하나 안 빠진다.
 *   · 아무것도 고르지 않으면 0건이다(전부 고른 것과 같게 보지 않는다).
 *   · 사업장으로 좁히면 사업장 없는 줄이 빠지고, 기간으로 좁히면 날짜 없는 줄이 빠진다.
 *   · 칩을 마지막 하나까지 지우면 그 묶음은 **전부 고른 상태**로 돌아간다(0건으로 떨어지지 않게).
 *   · 포캐스트 블록은 「진행 중」만 센다 — 실주·closed_at 은 빠지고 수주는 남는다.
 */
const load = module.require.bind(module)
const path = load('path')
const fs = load('fs')
const Module = load('module')
const ts = load('typescript')
const ROOT = path.resolve(__dirname, '..')

// '@/…' 를 프로젝트 뿌리로 돌려 주고, .ts 를 그 자리에서 자바스크립트로 바꿔 읽는다
// (다른 하네스와 같은 방식 — scripts/customer-events-check.js).
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith('@/')) request = path.join(ROOT, request.slice(2))
  return origResolve.call(this, request, ...rest)
}
require.extensions['.ts'] = (mod, filename) => {
  const out = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  }).outputText
  mod._compile(out, filename)
}

const F = load(path.join(ROOT, 'lib', 'timelineFilter.ts'))
const C = load(path.join(ROOT, 'lib', 'companyForecast.ts'))

let fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) console.log(`OK   ${name}  got=${JSON.stringify(got)}`)
  else { fail++; console.error(`FAIL ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`) }
}

const KINDS = ['영업', '서비스', '견적', '의뢰', '포캐스트', '홀딩', '사건']
const SITES = [11, 22, 33]
const siteName = id => ({ 11: '제천 1공장', 22: '경주공장', 33: '제천 2공장' })[id] ?? ''
const rows = [
  { kind: '서비스', date: '2026-11-17', siteId: 11 },
  { kind: '서비스', date: '2026-10-16', siteId: 33 },
  { kind: '견적', date: '2026-11-02', siteId: 11 },
  { kind: '영업', date: '2026-09-01', siteId: 22 },
  { kind: '포캐스트', date: '2026-11-18', siteId: 11 },
  { kind: '서비스', date: null, siteId: 22 },      // 날짜 미상 — 옛 이관 자료
  { kind: '사건', date: '2026-08-01', siteId: null }, // 사업장이 없는 줄
]
const avail = { kinds: KINDS, siteIds: SITES }

console.log('── 좁히지 않음 ──')
const all = F.allSelected(KINDS, SITES)
eq('전부 고르면 한 줄도 안 빠진다', F.applyFilter(rows, all, avail).length, rows.length)
eq('전부 고르면 칩이 없다', F.filterChips(all, avail, siteName).length, 0)
eq('종류를 좁혔는가', F.narrowsKind(all, KINDS), false)
eq('사업장을 좁혔는가', F.narrowsSite(all, SITES), false)

console.log('\n── 종류 ──')
const onlyService = { ...all, kinds: ['서비스'] }
eq('서비스만', F.applyFilter(rows, onlyService, avail).length, 3)
eq('칩 하나', F.filterChips(onlyService, avail, siteName).map(c => c.label), ['서비스'])
eq('둘 고르면 둘 다 센다', F.applyFilter(rows, { ...all, kinds: ['서비스', '견적'] }, avail).length, 4)
eq('아무것도 고르지 않으면 0건', F.applyFilter(rows, { ...all, kinds: [] }, avail).length, 0)
eq('종류별 건수', F.countByKind(rows), { 영업: 1, 서비스: 3, 견적: 1, 의뢰: 0, 포캐스트: 1, 홀딩: 0, 사건: 1 })

console.log('\n── 사업장 ──')
const onlySite11 = { ...all, siteIds: [11] }
eq('제천 1공장만', F.applyFilter(rows, onlySite11, avail).length, 3)
eq('사업장 없는 줄은 빠진다', F.applyFilter(rows, onlySite11, avail).some(r => r.siteId == null), false)
eq('사업장별 건수', [...F.countBySite(rows).entries()].sort(), [[11, 3], [22, 2], [33, 1]])
eq('칩 이름은 사업장명', F.filterChips(onlySite11, avail, siteName).map(c => c.label), ['제천 1공장'])

console.log('\n── 기간 ──')
eq('11월만', F.applyFilter(rows, { ...all, from: '2026-11-01', to: '2026-11-30' }, avail).length, 3)
eq('날짜 없는 줄은 빠진다',
  F.applyFilter(rows, { ...all, from: '2000-01-01', to: '2099-12-31' }, avail).length, rows.length - 1)
eq('시작만', F.applyFilter(rows, { ...all, from: '2026-11-01' }, avail).length, 3)
eq('종료만', F.applyFilter(rows, { ...all, to: '2026-09-30' }, avail).length, 2)
eq('기간 칩 글자', F.filterChips({ ...all, from: '2026-01-01' }, avail, siteName)[0].label, '2026-01-01 이후')

console.log('\n── 겹쳐 고르기 ──')
const both = { ...all, kinds: ['서비스'], siteIds: [11] }
eq('서비스 + 제천 1공장', F.applyFilter(rows, both, avail).length, 1)
eq('칩 둘', F.filterChips(both, avail, siteName).map(c => c.label), ['서비스', '제천 1공장'])

console.log('\n── 칩 지우기 ──')
const chips = F.filterChips(both, avail, siteName)
const afterKind = F.dropChip(both, chips[0], avail)
eq('종류 칩을 지우면 종류는 전부로', F.narrowsKind(afterKind, KINDS), false)
eq('사업장은 그대로 좁혀 있다', F.narrowsSite(afterKind, SITES), true)
const afterSite = F.dropChip(both, chips[1], avail)
eq('사업장 칩을 지우면 사업장은 전부로', F.narrowsSite(afterSite, SITES), false)
eq('기간 칩을 지우면 기간이 빈다',
  F.dropChip({ ...all, from: '2026-01-01', to: '2026-12-31' }, { key: 'period', label: '', drop: { period: true } }, avail).from, '')

console.log('\n── 포캐스트 줄 — 생성·종료 둘뿐 ──')
// 영업 기회 한 건은 활동 이력에 **두 줄**을 낼 수 있다: 만든 날, 끝난 날.
// 전에는 「고침」 줄(updated_at)이 하나 더 있었다 — 제목·금액만 고쳐도 올라가는 시각이라
// 활동이 아닌데 줄로 섰다(2026-11-22 에 걷었다). 집계·필터는 줄을 세므로 함께 맞는다.
const TL = fs.readFileSync(path.join(ROOT, 'components', 'customer', 'ActivityTimeline.tsx'), 'utf8')
const code = TL.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
eq('포캐스트 줄에 updated_at 을 쓰지 않는다', /updated_at/.test(code), false)
eq('「고침」 꼬리표가 없다', /고침/.test(code), false)
eq('만든 줄이 있다', code.includes('key: `op-${o.opportunity_id}`'), true)
eq('종료 줄이 있다', code.includes('key: `op-${o.opportunity_id}-cl`'), true)
eq('고침 줄은 없다', code.includes('-up`'), false)

// 두 줄짜리 포캐스트 한 건이 집계·필터에 어떻게 잡히는가.
const fcRows = [
  { kind: '포캐스트', date: '2026-03-02', siteId: 11 },  // 만든 날
  { kind: '포캐스트', date: '2026-09-09', siteId: 11 },  // 끝난 날
  { kind: '서비스', date: '2026-05-05', siteId: 11 },
]
eq('종류별 건수 — 포캐스트 2', F.countByKind(fcRows).포캐스트, 2)
eq('활동 이력 N — 좁히지 않으면 셋', F.applyFilter(fcRows, F.allSelected(KINDS, SITES), avail).length, 3)
eq('포캐스트만 고르면 둘', F.applyFilter(fcRows, { ...F.allSelected(KINDS, SITES), kinds: ['포캐스트'] }, avail).length, 2)
eq('기간으로 끝난 날만 남기면 하나',
  F.applyFilter(fcRows, { ...F.allSelected(KINDS, SITES), from: '2026-06-01', to: '2026-12-31' }, avail)
    .filter(r => r.kind === '포캐스트').length, 1)
console.log('\n── 포캐스트 블록 ──')
const op = (id, stage, amount, close, closedAt) => ({
  opportunity_id: id, customer_id: 11, engineer_id: 1, title: `건 ${id}`, stage,
  expected_amount: amount, expected_close: close, lost_reason: null, lost_note: null,
  closed_at: closedAt ?? null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  engineers: { name: '양정모', position: '책임' },
})
const ops = [
  op(1, '상담', 85000000, '2027-03-31'),
  op(2, '견적제출', 40000000, '2026-12-31'),
  op(3, '실주', 99000000, '2026-12-31'),            // 끝난 건
  op(4, '수주', 10000000, '2026-11-30'),            // 수주는 아직 진행 중
  op(5, '협상', 70000000, '2026-10-31', '2026-10-31T00:00:00Z'), // closed_at 이 찍힌 건
]
const block = C.companyForecast({ opportunities: ops, siteName: () => '제천 1공장' })
eq('진행 중만 센다', block.count, 3)
eq('합계도 진행 중만', block.total, 85000000 + 40000000 + 10000000)
eq('금액 큰 순', block.lines.map(l => l.id), [1, 2, 4])
eq('예정 시기는 달로', block.lines[0].when, '2027 3월')
eq('담당자는 이름 직급', block.lines[0].owner, '양정모 책임')
eq('줄 수는 limit 만큼', C.companyForecast({ opportunities: ops, limit: 2 }).lines.length, 2)
eq('진행 중이 없으면 빈 블록', C.companyForecast({ opportunities: [op(9, '실주', 1, '2026-01-31')] }), { count: 0, total: 0, lines: [] })
eq('예정 시기가 비면 빈 글자', C.whenLabel(null), '')
eq('이상한 값도 빈 글자', C.whenLabel('2026-13-31'), '')

if (fail > 0) { console.error(`\n실패 ${fail}건`); process.exit(1) }
console.log('\n모두 통과')
