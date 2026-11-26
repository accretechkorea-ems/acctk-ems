// 통계용 엑셀 — **한 줄 = 한 건** (2026-11-27 야간3 3).
//
//   node scripts/forecast-stats-excel-check.js
//
// 지키는 약속
//   ① 종류 판정의 **차례**가 규칙이다(수리 → 업그레이드 → 장비 → 소모품 → 기타).
//   ② 열 열여섯이 그 차례로 선다. 금액은 **원 단위 전체 자릿수**다(축약하지 않는다).
//   ③ 생성일 **내림차순**.
//   ④ 파일 이름은 「포캐스트통계_{기간}_{yyyymmdd}.xlsx」.
//   ⑤ 기존 「본사 보고용」 엑셀은 **그대로 남아 있다**(둘은 다른 파일이다).

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

let fails = 0
const ok = (name, cond, hint) => {
  if (!cond) fails++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond || !hint ? '' : `  — ${hint}`}`)
}
const eq = (name, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want)
  if (!good) fails++
  console.log(`${good ? 'OK  ' : 'FAIL'} ${name}`)
  if (!good) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')

const X = load(path.join(ROOT, 'lib/forecastStatsExcel.ts'))
const base = { group_kind: 'base' }
const opt = { group_kind: 'option' }

console.log('── ① 종류 판정 — 차례가 규칙이다 ──')
eq('수리 건이면 수리', X.statsKindOf({ repairId: 7, items: [base] }), '수리')
eq('분류 이름에 「수리」가 있어도 수리', X.statsKindOf({ category: 'REPAIR', categoryLabel: '수리' }), '수리')
eq('업그레이드 분류', X.statsKindOf({ category: 'UPG', categoryLabel: '업그레이드' }), '업그레이드')
eq('업그레이드가 수리보다 **뒤**다(수리가 이긴다)',
  X.statsKindOf({ repairId: 1, category: 'UPG', categoryLabel: '업그레이드' }), '수리')
eq('본체 줄이 있으면 장비', X.statsKindOf({ items: [opt, base] }), '장비')
eq('본체 줄이 없고 분류가 소모품', X.statsKindOf({ category: 'PART', categoryLabel: '소모품', items: [opt] }), '소모품')
eq('분류를 몰라도 품목이 있으면 소모품', X.statsKindOf({ items: [opt] }), '소모품')
eq('아무것도 없으면 기타', X.statsKindOf({}), '기타')
eq('품목을 못 읽었으면 기타', X.statsKindOf({ items: null }), '기타')
eq('본체 묶음 열쇠는 한 곳에서 온다', X.statsKindOf({ items: [{ group_kind: 'base' }] }), '장비')
eq('다섯 가지뿐', [...X.STATS_KINDS], ['장비', '소모품', '업그레이드', '수리', '기타'])

console.log('\n── ② 열 ──')
eq('열 열여섯', [...X.STATS_HEAD], [
  '구분', '종류', '회사', '사업장', '대리점', '담당자', '팀', '품명', '금액',
  '생성일', '단계/상태', '종료 상태', '종료일', '실주 사유', '경쟁사', '연결 견적 번호',
])
const row = {
  kindOfUnit: '포캐스트', kind: '장비', company: '네오오토', site: '본사', dealer: '',
  owner: '박상 선임', team: '80CS', product: '측정실 증설', amount: 490406000,
  createdAt: '2026-11-02', stage: '협상', result: '진행', closedAt: '',
  lostReason: '', competitor: '', quoteNos: 'KJW261102A',
}
eq('한 줄이 그 차례로 선다', X.statsRowCells(row).length, 16)
eq('금액은 **원 단위 전체 자릿수**', X.statsRowCells(row)[8], 490406000)
ok('축약 함수를 부르지 않는다', !/krwShort|compactKRW/.test(read('lib/forecastStatsExcel.ts')))

console.log('\n── ③ 차례 ──')
const aoa = X.statsAoA([
  { ...row, createdAt: '2026-10-01', company: 'A' },
  { ...row, createdAt: '2026-11-20', company: 'B' },
  { ...row, createdAt: '2026-11-02', company: 'C' },
])
eq('생성일 내림차순', aoa.slice(1).map(r => r[9]), ['2026-11-20', '2026-11-02', '2026-10-01'])
eq('머리줄이 첫 줄', aoa[0][0], '구분')

console.log('\n── ④ 파일 이름 ──')
eq('모양', X.statsFileName('FY2026', '2026-11-27'), '포캐스트통계_FY2026_20261127.xlsx')
eq('팀까지 붙인 기간', X.statsFileName('FY2026_80CS', '2026-11-27'), '포캐스트통계_FY2026_80CS_20261127.xlsx')
ok('쓸 수 없는 글자를 뗀다', !/[\\/:*?"<>|]/.test(X.statsFileName('FY2026/80:CS', '2026-11-27')))

console.log('\n── ⑤ 화면 ──')
const PAGE = read('app/pipeline/page.tsx')
ok('⬇ 팝오버에 「통계용(전체)」이 있다', /통계용\(전체\) 내려받기/.test(PAGE))
ok('기존 「내려받기」도 그대로다', /\{fc\.loading \? '자료 읽는 중\.\.\.' : '내려받기'\}/.test(PAGE))
ok('기간은 생성일 기준 FY 전체다', /const from = `\$\{xFy\}-04-01`/.test(PAGE) && /const to = `\$\{xFy \+ 1\}-03-31`/.test(PAGE))
ok('팀·담당자 거르개는 기존 것을 그대로 쓴다', /const idSet = new Set\(exportEngineerIds\)/.test(PAGE))
ok('포캐스트에 **안 붙은** 견적만 더한다', /\.is\('opportunity_id', null\)/.test(PAGE))
ok('포캐스트 줄은 판이 이미 읽어 둔 것을 쓴다(조회를 늘리지 않는다)',
  /const oppRows: StatsRow\[\] = opportunities/.test(PAGE))
ok('끝난 결과 네 가지', /'실주' : closed \? \(stage === '수주' \? '수주' : '취소'\) : '진행'/.test(PAGE))
ok('기존 엑셀 파일 이름은 그대로다', /포캐스트_\$\{safe\}\.xlsx/.test(read('lib/forecastExcel.ts')))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
