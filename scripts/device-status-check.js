// 장비 폐기 판정 시험 — 숨길 것과 남길 것.
//
//   node scripts/device-status-check.js
//
// 왜 따로 두는가 — 이 판정 하나가 장비가 보이는 **모든 화면**을 가른다(고객사 상세 목록·
// 업체 카드·지도·엑셀·쇼룸 장비 그리드·가동률). 두 가지가 쉽게 틀어진다.
//   · **status 가 빈 줄을 숨겨 버리는 것** — 숨기는 것은 '폐기' 라고 적혀 있을 때만이다.
//     null 을 「모른다」로 보고 빼면 장비가 조용히 사라진다(lib/deviceStatus.ts 머리말).
//   · **조회 조건** — `status <> '폐기'` 는 SQL 에서 null 줄을 함께 떨어뜨린다. 그래서
//     `.or('status.is.null,status.neq.폐기')` 를 쓴다. 그 문자열을 여기서 못 박는다.

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
  DEVICE_IN_USE, DEVICE_DISPOSED, IN_USE_FILTER,
  isDisposed, isInUse, inUseOnly, disposedOnly, disposedLabel, disposePatch, restorePatch,
} = load(path.join(ROOT, 'lib/deviceStatus.ts'))
const { toExcelCustomer } = load(path.join(ROOT, 'lib/customerExcel.ts'))

let fails = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
}

console.log('── 폐기인가 ──')
eq("'폐기' 면 폐기", isDisposed({ status: '폐기' }), true)
eq('앞뒤 공백은 무시한다', isDisposed({ status: ' 폐기 ' }), true)
eq("'사용중' 은 아니다", isDisposed({ status: DEVICE_IN_USE }), false)
eq('글자가 다르면 아니다(폐기예정 등)', isDisposed({ status: '폐기예정' }), false)

console.log('\n── 빈 값은 「사용중」으로 본다(숨기지 않는다) ──')
eq('null', [isDisposed({ status: null }), isInUse({ status: null })], [false, true])
eq('칸 자체가 없음', [isDisposed({}), isInUse({})], [false, true])
eq('빈 문자', [isDisposed({ status: '' }), isInUse({ status: '' })], [false, true])
eq('줄 자체가 없음(null·undefined)', [isDisposed(null), isDisposed(undefined)], [false, false])

console.log('\n── 목록 걸러내기 ──')
const list = [
  { device_id: 1, status: '사용중' },
  { device_id: 2, status: '폐기', disposed_at: '2026-11-02' },
  { device_id: 3, status: null },
  { device_id: 4, status: '폐기', disposed_at: null },
]
eq('사용중만 — 빈 값도 남는다', inUseOnly(list).map(d => d.device_id), [1, 3])
eq('폐기만 — 「폐기 포함」 건수', disposedOnly(list).map(d => d.device_id), [2, 4])
eq('순서를 바꾸지 않는다', inUseOnly([list[2], list[0]]).map(d => d.device_id), [3, 1])
eq('원본을 건드리지 않는다', list.map(d => d.device_id), [1, 2, 3, 4])
eq('빈 목록', [inUseOnly([]), disposedOnly([])], [[], []])

console.log('\n── 조회 조건(PostgREST or) ──')
eq('null 을 살리는 모양이다', IN_USE_FILTER, 'status.is.null,status.neq.폐기')
eq('폐기 글자가 상수와 같다', IN_USE_FILTER.endsWith(DEVICE_DISPOSED), true)

console.log('\n── 뱃지 글자 ──')
eq('날짜가 있으면 함께', disposedLabel({ status: '폐기', disposed_at: '2026-11-02' }), '폐기 2026-11-02')
eq('날짜 뒤에 시각이 붙어도 날짜만', disposedLabel({ status: '폐기', disposed_at: '2026-11-02T00:00:00' }), '폐기 2026-11-02')
eq('날짜가 없으면 「폐기」만', disposedLabel({ status: '폐기', disposed_at: null }), '폐기')

console.log('\n── 저장값 ──')
eq('폐기 처리', disposePatch('2026-11-02'), { status: '폐기', disposed_at: '2026-11-02' })
eq('폐기 취소 — 날짜까지 비운다', restorePatch(), { status: '사용중', disposed_at: null })
eq('왕복하면 처음으로 돌아온다', isInUse(restorePatch()), true)
eq('폐기 처리한 줄은 폐기로 읽힌다', isDisposed(disposePatch('2026-11-02')), true)

console.log('\n── 고객사 엑셀 — 폐기는 줄이 되지 않는다 ──')
{
  const row = {
    customer_id: 7, status: '활성', company_name: '가나다', region1: '경기', region2: '화성',
    address: null, agency: null, parent_customer_id: null,
    devices: [
      { device_name: '쓰는 장비', serial_number: 'A', deleted_at: null, status: '사용중' },
      { device_name: '폐기 장비', serial_number: 'B', deleted_at: null, status: '폐기' },
      { device_name: '지운 장비', serial_number: 'C', deleted_at: '2026-01-01', status: '사용중' },
      { device_name: '상태 빈 장비', serial_number: 'D', deleted_at: null, status: null },
    ],
  }
  eq('폐기·삭제는 빠지고 빈 값은 남는다',
    toExcelCustomer(row).devices.map(d => d.device_name), ['쓰는 장비', '상태 빈 장비'])
}

console.log(fails === 0 ? '\n모두 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
