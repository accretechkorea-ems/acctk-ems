// 고객사 **전부 내보내기** 엑셀 시험 — 세 시트의 열 이름·순서·줄 수를 못 박는다 (2026-11-22).
//
// 「사업장」 시트는 **사업장 × 장비**다 — 줄 수 = 사업장마다 max(장비 수, 1) 의 합.
// 장비가 세 대면 사업장 정보가 세 줄 반복되고, 장비가 없는 사업장도 빈 칸으로 한 줄 남는다.
//
//   node scripts/customer-export-check.js
//
// 왜 따로 두는가 — 이 엑셀은 사람이 눈으로 받아 쓰는 양식이다. 열이 하나 밀리거나
// 담당자 열이 어긋나면 받는 쪽에서 한참 뒤에 발견한다. 특히 담당자는 **줄마다 사람 수가
// 다른데 열 수는 같아야** 한다 — 그 한 가지가 어긋나면 표 전체가 밀린다.
//
// 옛 양식(시트 하나)은 scripts/customer-excel-check.js 가 따로 지킨다.

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
  SHEET_NAMES, COMPANY_HEADER, CONTACT_FIELDS,
  buildContactHeader, contactCells, maxContactsOf, dateCell, installCell,
  buildCustomerSheets, customerExportFileName, sheetWidths, siteRowCount,
} = load(path.join(ROOT, 'lib/customerExportSheets.ts'))

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

// ── 본보기 자료 ────────────────────────────────────────────────────────────
const contact = (n) => ({ name: `담당${n}`, position: '과장', department: '품질', phone: `010-0000-000${n}`, email: `a${n}@x.com` })
const device = (n, over = {}) => ({
  lineup: 'SURFCOM', model: `NEX ${n}00`, option: 'A', serial: `SN${n}`, program: 'ACCTee',
  installYear: 2019, installDate: '2019-03-04', disposedAt: null, ...over,
})
const site = (id, contacts, devices = []) => ({
  customerId: id, companyId: 100, companyName: '가나공업', nameEn: 'GANA', industry: '3.자동차 - 완성차',
  siteName: `${id}공장`, status: '활성', region1: '경기', region2: '화성', address: '경기 화성시 1',
  agency: 'ACCT-K', deviceCount: 2, openQuotes: 1, totalQuotes: 3,
  touchDate: '2026-11-20', touchSource: '영업활동', touchActor: '홍길동',
  note: '메모다', contacts, devices,
})
const input = {
  // 장비 3대 · 0대 · 1대(폐기) — 줄 수는 3 + 1 + 1 = 5 여야 한다.
  sites: [
    site(1, [contact(1), contact(2)], [device(1), device(2), device(3)]),
    site(2, []),
    site(3, [contact(1)], [device(4, { disposedAt: '2026-05-06' })]),
  ],
  companies: [{
    companyId: 100, companyName: '가나공업', nameEn: 'GANA', industry: '3.자동차 - 완성차',
    siteCount: 3, deviceCount: 6, openQuotes: 3, totalQuotes: 9, touchDate: '2026-11-20', note: '회사 메모',
  }],
  agencies: [{
    agencyId: 500, name: '한빛', nameEn: 'HANBIT', address: '서울', siteCount: 2,
    openQuotes: 1, totalQuotes: 4, note: '', contacts: [contact(1), contact(2), contact(3)],
  }],
}
const sheets = buildCustomerSheets(input)
const byName = Object.fromEntries(sheets.map(s => [s.name, s.rows]))

console.log('\n── ① 시트 셋, 이름과 순서 ──')
eq('시트 이름·순서', sheets.map(s => s.name), ['사업장', '회사', '대리점'])
eq('SHEET_NAMES 도 같다', [...SHEET_NAMES], ['사업장', '회사', '대리점'])
eq('「장비」 시트는 없다(사업장 시트와 겹쳐 걷었다)', sheets.some(s => s.name === '장비'), false)

console.log('\n── ② 「사업장」 시트 — 한 줄 = 사업장 × 장비 ──')
eq('앞 16열 이름·순서', byName['사업장'][0].slice(0, 16), [
  '회사명', '영문명', '분류', '사업장명', '상태', '지역1', '지역2', '주소', '대리점',
  '라인업', '모델', '옵션', 'S/N', '소프트웨어', '납입일', '폐기',
])
eq('걷은 아홉 열이 없다',
  ['장비 수', '진행 견적 수', '전체 견적 수', '최근 활동일', '최근 활동 종류', '최근 활동 작성자', '메모', '회사 id', '사업장 id']
    .filter(h => byName['사업장'][0].includes(h)), [])
eq('담당자 열은 가장 많은 줄(2명) 기준 10열', byName['사업장'][0].slice(16), [
  '담당자1 이름', '담당자1 직급', '담당자1 부서', '담당자1 전화', '담당자1 이메일',
  '담당자2 이름', '담당자2 직급', '담당자2 부서', '담당자2 전화', '담당자2 이메일',
])
eq('줄 수 = 사업장마다 max(장비 수, 1) 의 합 (3+1+1)', byName['사업장'].length - 1, 5)
eq('siteRowCount 도 같은 수를 센다', siteRowCount(input.sites), 5)
ok('모든 줄의 열 수가 같다', byName['사업장'].every(r => r.length === byName['사업장'][0].length))
eq('장비 3대면 사업장 정보가 3줄 반복된다',
  byName['사업장'].slice(1, 4).map(r => r.slice(0, 4).join('|')),
  ['가나공업|GANA|3.자동차 - 완성차|1공장', '가나공업|GANA|3.자동차 - 완성차|1공장', '가나공업|GANA|3.자동차 - 완성차|1공장'])
eq('그 세 줄의 장비 칸은 서로 다르다', byName['사업장'].slice(1, 4).map(r => r[10]), ['NEX 100', 'NEX 200', 'NEX 300'])
eq('장비 없는 사업장은 장비 칸 일곱이 빈 한 줄', byName['사업장'][4].slice(9, 16), ['', '', '', '', '', '', ''])
eq('장비 칸은 저장 칸 그대로다(합치지 않는다)', byName['사업장'][1].slice(9, 14), ['SURFCOM', 'NEX 100', 'A', 'SN1', 'ACCTee'])
ok('납입일은 날짜(Date)로 나간다', byName['사업장'][1][14] instanceof Date)
eq('쓰는 장비는 「폐기」 칸이 빈 칸', byName['사업장'][1][15], '')
ok('폐기한 장비는 폐기일이 날짜로 든다', byName['사업장'][5][15] instanceof Date)
eq('담당자 없는 줄은 빈 칸 10개', byName['사업장'][4].slice(16), ['', '', '', '', '', '', '', '', '', ''])
eq('담당자 하나인 줄은 뒤 다섯이 빈 칸', byName['사업장'][5].slice(16), ['담당1', '과장', '품질', '010-0000-0001', 'a1@x.com', '', '', '', '', ''])

console.log('\n── ③ 「회사」 시트 ──')
eq('열 이름·순서', byName['회사'][0], [
  '회사명', '영문명', '분류', '사업장 수', '장비 수', '진행 견적', '전체 견적', '최근 활동일', '메모', 'id',
])
eq('줄 수 = 머리 1 + 회사 1', byName['회사'].length, 2)
ok('회사 시트에는 담당자 열이 없다', byName['회사'][0].length === COMPANY_HEADER.length)

console.log('\n── ④ 「대리점」 시트 ──')
eq('앞 8열 이름·순서', byName['대리점'][0].slice(0, 8), [
  '대리점명', '영문명', '주소', '거래 사업장 수', '진행 견적', '전체 견적', '메모', 'id',
])
eq('담당자 셋 → 15열', byName['대리점'][0].length - 8, 15)
eq('줄 수 = 머리 1 + 대리점 1', byName['대리점'].length, 2)
eq('id 는 담당자 앞 마지막 열', byName['대리점'][1][7], 500)

console.log('\n── ⑥ 담당자 펴기 ──')
eq('다섯 칸이 한 사람', [...CONTACT_FIELDS], ['이름', '직급', '부서', '전화', '이메일'])
eq('머리글 N명 → 5N', buildContactHeader(3).length, 15)
eq('담당자가 없으면 열도 없다', buildContactHeader(0), [])
eq('가장 많은 줄이 열 수를 정한다', maxContactsOf([{ contacts: [1] }, { contacts: [1, 2, 3] }, { contacts: [] }]), 3)
eq('사람이 모자라면 빈 칸', contactCells([contact(1)], 2).length, 10)
eq('한 사람도 없으면 전부 빈 칸', contactCells([], 1), ['', '', '', '', ''])

console.log('\n── ⑦ 날짜·납입일 ──')
ok('YYYY-MM-DD → Date', dateCell('2026-11-22') instanceof Date)
eq('빈 값은 빈 칸', dateCell(null), '')
eq('날짜가 아니면 글자 그대로', dateCell('언젠가'), '언젠가')
ok('온전한 날짜면 Date', installCell(2019, '2019-03-04') instanceof Date)
eq('연·월만 있으면 YYYY-MM', installCell(2014, '3'), '2014-03')
eq('연만 있으면 YYYY', installCell(2014, null), '2014')
eq('아무것도 없으면 빈 칸', installCell(null, null), '')

console.log('\n── ⑧ 파일 이름 ──')
eq('고객사_YYYYMMDD_HHmm.xlsx',
  /^고객사_\d{8}_\d{4}\.xlsx$/.test(customerExportFileName(new Date('2026-11-22T01:23:00Z'))), true)
eq('한국 시각으로 찍는다(UTC 01:23 → 10:23)',
  customerExportFileName(new Date('2026-11-22T01:23:00Z')), '고객사_20261122_1023.xlsx')

console.log('\n── ⑨ 열 폭 ──')
eq('열마다 하나씩', sheetWidths(byName['회사']).length, COMPANY_HEADER.length)
ok('가장 좁아도 6, 가장 넓어도 40', sheetWidths(byName['사업장']).every(w => w >= 6 && w <= 40))

console.log('\n── ⑩ 라우트·화면이 같은 약속을 지키는가(글자 검사) ──')
const ROUTE = fs.readFileSync(path.join(ROOT, 'app/api/customer-export/route.ts'), 'utf8')
const PAGE = fs.readFileSync(path.join(ROOT, 'app/page.tsx'), 'utf8')
const AGENCY = fs.readFileSync(path.join(ROOT, 'lib/customerAgency.ts'), 'utf8')
// 조회·셈은 라우트에서 떼어내 이 모듈에 있다 — 실측 도구와 같이 쓴다.
const DATA = fs.readFileSync(path.join(ROOT, 'lib/customerExportData.ts'), 'utf8')
ok('라우트는 superadmin 문턱이다', /loadCaller\(\{ kind: 'superadmin' \}/.test(ROUTE))
ok('라우트는 읽기만 한다(insert·update·delete 가 없다)',
  !/\.(insert|update|upsert|delete)\(/.test(ROUTE + DATA), '쓰기 호출이 들어왔다')
ok('줄 수는 화면이 보낸 사업장 id 가 정한다', /for \(const id of siteIds\)/.test(DATA))
ok('화면은 목록 트리의 사업장을 보낸다',
  /const siteIds = listTree\.groups\.flatMap\(g => g\.sites\.map\(s => Number\(s\.customer\.customer_id\)\)\)/.test(PAGE))
ok('화면은 서버가 만든 파일을 받는다', /fetch\('\/api\/customer-export'/.test(PAGE))
const label = /DIRECT_SALE_LABEL = '([^']+)'/.exec(AGENCY)?.[1]
const routeLabel = /DIRECT_SALE_LABEL = '([^']+)'/.exec(DATA)?.[1]
eq('직판 글자가 화면과 같다', routeLabel, label)
ok('머리줄을 고정한다', /state: 'frozen', ySplit: 1/.test(ROUTE))
ok('머리줄은 굵게', /head\.font = \{ bold: true \}/.test(ROUTE))
ok('장비는 폐기도 담는다(조회에서 is_in_use 로 거르지 않는다)',
  /from\('devices'\)[\s\S]{0,260}\.is\('deleted_at', null\)\.range/.test(DATA))
ok('사업장 줄에 장비를 붙여 넘긴다', /devices: sortDevices\(devicesOf\.get\(id\) \?\? \[\]\)\.map\(toSiteDevice\)/.test(DATA))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
