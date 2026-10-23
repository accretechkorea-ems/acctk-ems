// 고객사 목록 엑셀 시험 — 양식(열 순서)과 옛 자료 해석을 못 박는다.
//
//   node scripts/customer-excel-check.js
//
// 왜 따로 두는가 — 이 엑셀은 사람이 눈으로 받아 쓰는 양식이다. 열이 하나 밀리거나
// 납입년·월 해석이 바뀌면 받는 쪽에서 한참 뒤에 발견한다. devices 의 날짜 칸은
// 「월만 들어간 옛 행」과 「진짜 날짜인 행」이 섞여 있어 특히 쉽게 깨진다.

// eslint 의 no-require-imports 는 맨 require() 를 센다. 이 파일은 node 로 직접 돌리는
// CJS 스크립트라 모듈을 그렇게 불러올 수밖에 없다 — 한 번만 묶어 두고 그것만 쓴다.
const load = module.require.bind(module)
const path = load('path')
const Module = load('module')
const ROOT = path.join(__dirname, '..')
const ts = load(path.join(ROOT, 'node_modules/typescript'))

for (const ext of ['.ts', '.tsx']) {
  Module._extensions[ext] = (mod, filename) => {
    mod._compile(ts.transpileModule(load('fs').readFileSync(filename, 'utf8'), {
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
  CUSTOMER_EXCEL_HEADER, customerRowsAoA, installYearMonth, regionsOf,
  columnWidths, customerExcelFileName, toExcelCustomer,
} = load(path.join(ROOT, 'lib/customerExcel.ts'))

let fails = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`)
  if (!ok) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}

console.log('── 양식(열 순서) ──')
eq('열 13개', CUSTOMER_EXCEL_HEADER.length, 13)
eq('열 이름·순서', [...CUSTOMER_EXCEL_HEADER], [
  '상태', '회사명', '지역1', '지역2',
  '장비명', '장비명2(모델)', '옵션', '납입년', '납입월', 'S/N',
  '대리점', '회사(소속)', '주소',
])
eq('고객 담당자 열은 없다', CUSTOMER_EXCEL_HEADER.includes('고객 담당자'), false)

console.log('\n── 납입년·월 (옛 자료가 섞여 있다) ──')
eq('연도 칸 + 월만 들어간 날짜 칸', installYearMonth('2016', '3'), { year: 2016, month: 3 })
eq('날짜가 YYYY-MM-DD', installYearMonth(null, '2014-02-01'), { year: 2014, month: 2 })
eq('날짜가 YYYY-MM', installYearMonth(null, '2016-05'), { year: 2016, month: 5 })
eq('연도와 날짜가 둘 다 있으면 연도 칸을 쓴다', installYearMonth('2007', '2007-08'), { year: 2007, month: 8 })
eq('월만 있고 연도가 없음', installYearMonth(null, '7'), { year: '', month: 7 })
eq('연도만 있고 날짜가 없음', installYearMonth('1989', null), { year: 1989, month: '' })
eq('둘 다 없음', installYearMonth(null, null), { year: '', month: '' })
eq('공백 한 칸은 없는 것으로 본다', installYearMonth(' ', ' '), { year: '', month: '' })
eq('월이 0 이나 13 이면 버린다', [installYearMonth('2020', '0'), installYearMonth('2020', '13')],
  [{ year: 2020, month: '' }, { year: 2020, month: '' }])
eq('연도가 네 자리가 아니면 버린다', installYearMonth('16', '3'), { year: '', month: 3 })

console.log('\n── 지역 (저장된 컬럼이 정본) ──')
eq('저장된 값이 있으면 그대로', regionsOf({ region1: '중부', region2: '화성', address: '경기도 수원시 …' }), ['중부', '화성'])
eq('비었으면 주소 앞 두 토큰에서', regionsOf({ region1: null, region2: null, address: '경기도 화성시 동탄' }), ['경기', '화성'])
eq('긴 시도 이름', regionsOf({ region1: '', region2: '', address: '경상남도 창원시 성산구' }), ['경남', '창원'])
eq('광역시', regionsOf({ region1: '', region2: '', address: '부산광역시 강서구 녹산' }), ['부산', '강서'])
eq('표에 없는 꼴은 꼬리만 뗀다', regionsOf({ region1: '', region2: '', address: '부산시 북구' }), ['부산', '북구'])
eq('한쪽만 비면 그쪽만 채운다', regionsOf({ region1: '남부', region2: '', address: '경남 김해시 주촌' }), ['남부', '김해'])
eq('주소가 없으면 빈칸', regionsOf({ region1: null, region2: null, address: null }), ['', ''])

console.log('\n── 줄 펼치기 ──')
const sample = [
  {
    customer_id: 1, status: '활성', company_name: '가나다전자', region1: '경기', region2: '화성',
    address: '경기도 화성시 1', agency: '한빛', parent_customer_id: 9,
    devices: [
      { device_name: 'WAFER', device_name2: 'W-200', option: 'A', serial_number: 'SN2', install_year: '2020', install_date: '5' },
      { device_name: 'PROBER', device_name2: 'P-8', option: null, serial_number: 'SN1', install_year: '2016', install_date: '3' },
    ],
  },
  {
    customer_id: 2, status: '잠재', company_name: '라마바', region1: null, region2: null,
    address: null, agency: null, parent_customer_id: null, devices: [],
  },
]
const aoa = customerRowsAoA(sample, id => (id === 9 ? '가나다홀딩스' : ''))
eq('머리글 + 장비 2대 + 장비 없는 고객사 1줄 = 4줄', aoa.length, 4)
eq('첫 줄은 머리글', aoa[0], [...CUSTOMER_EXCEL_HEADER])
eq('장비는 납입년·월 이른 것부터', [aoa[1][4], aoa[2][4]], ['PROBER', 'WAFER'])
eq('장비 줄 전체', aoa[1],
  ['활성', '가나다전자', '경기', '화성', 'PROBER', 'P-8', '', 2016, 3, 'SN1', '한빛', '가나다홀딩스', '경기도 화성시 1'])
eq('장비 없는 고객사는 장비 칸 6개가 비고 뒤는 그대로', aoa[3],
  ['잠재', '라마바', '', '', '', '', '', '', '', '', '', '', ''])
eq('모든 줄의 칸 수가 열 수와 같다', [...new Set(aoa.map(r => r.length))], [13])

console.log('\n── 지워진 장비는 줄이 되지 않는다 ──')
{
  const raw = {
    customer_id: 3, status: '활성', company_name: '사아자', region1: '충남', region2: '천안',
    address: null, agency: null, parent_customer_id: null,
    devices: [
      { device_name: '산 장비', device_name2: null, option: null, serial_number: 'A', install_year: '2020', install_date: '1', deleted_at: null },
      { device_name: '지운 장비', device_name2: null, option: null, serial_number: 'B', install_year: '2021', install_date: '2', deleted_at: '2026-01-01' },
    ],
  }
  const one = toExcelCustomer(raw)
  eq('살아있는 장비만 남는다', one.devices.map(d => d.device_name), ['산 장비'])
  const rows = customerRowsAoA([one], () => '')
  eq('지운 장비가 줄을 늘리지 않는다', rows.length, 2)
}

console.log('\n── 열 폭·파일 이름 ──')
const w = columnWidths(aoa)
eq('열 폭이 열 수만큼', w.length, 13)
eq('한글을 두 칸으로 세어 회사명 칸이 넓다', w[1].wch >= 10, true)
eq('최소 6 · 최대 40', w.every(x => x.wch >= 6 && x.wch <= 40), true)
eq('파일 이름', customerExcelFileName('2026-10-23'), '고객사목록_20261023.xlsx')

console.log(fails === 0 ? '\n모두 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
