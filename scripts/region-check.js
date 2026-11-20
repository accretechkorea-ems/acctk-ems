// 지역(시도) 규칙 시험 — 정본 17개로 모으는 한 함수.
//
//   node scripts/region-check.js
//
// 왜 따로 두는가 — 지역 값을 만들어 내는 자리가 셋이다(등록·수정 저장, 리드 전환, 화면의
// 주소 추출). 각자 다른 규칙을 쓰면 또 갈린다 — 실제로 필터에 「경기도」·「강원특별자치도」·
// 「갈산리」가 섞여 떴고, 저장된 값에는 「남부」·「중부」 같은 사내 구역이 남아 있었다
// (2026-11-19 실측). 그 규칙을 여기 못 박는다.

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

const R = load(path.join(ROOT, 'lib/region.ts'))

let fails = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
}

console.log('── 정본 목록 ──')
eq('17개다', R.REGIONS.length, 17)
eq('순서는 행정 순서', [...R.REGIONS].slice(0, 9),
  ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기'])
eq('필터 목록은 17 + 없음', R.REGION_FILTER_OPTIONS.length, 18)
eq('마지막이 「없음」', R.REGION_FILTER_OPTIONS[17], R.NO_REGION)

console.log('\n── 토막 하나 → 약칭 ──')
eq('긴 이름', [R.regionOfToken('경기도'), R.regionOfToken('경상남도'), R.regionOfToken('충청북도')], ['경기', '경남', '충북'])
eq('특별자치도', [R.regionOfToken('강원특별자치도'), R.regionOfToken('전북특별자치도'), R.regionOfToken('제주특별자치도')], ['강원', '전북', '제주'])
eq('옛 이름도 받는다', [R.regionOfToken('강원도'), R.regionOfToken('전라북도')], ['강원', '전북'])
eq('광역시·시', [R.regionOfToken('부산광역시'), R.regionOfToken('부산시'), R.regionOfToken('대구광역시')], ['부산', '부산', '대구'])
eq('이미 약칭이면 그대로', R.regionOfToken('경남'), '경남')
eq('사내 구역은 시도가 아니다 — 버린다', [R.regionOfToken('남부'), R.regionOfToken('중부')], [null, null])
eq('읍·면·리는 시도가 아니다', [R.regionOfToken('갈산리'), R.regionOfToken('진영읍')], [null, null])
eq('빈 값', [R.regionOfToken(''), R.regionOfToken(null), R.regionOfToken('  ')], [null, null, null])

console.log('\n── 저장할 값 ──')
eq('적힌 값이 정본이면 그대로', R.normalizeRegion('경남', '경기도 화성시 1'), '경남')
eq('적힌 값이 긴 이름이면 약칭으로', R.normalizeRegion('경상남도', null), '경남')
eq('비어 있으면 주소 첫 토막에서', R.normalizeRegion(null, '경기도 화성시 동탄 1'), '경기')
eq('사내 구역이면 주소에서 다시 뽑는다', R.normalizeRegion('남부', '경남 창원시 성산구'), '경남')
eq('주소도 시도로 시작하지 않으면 null', R.normalizeRegion('남부', '진영읍 하계로 240'), null)
eq('해외 주소도 null', R.normalizeRegion(null, 'Prol. Ruiz Cortines S/N, 671'), null)
eq('둘 다 없으면 null', R.normalizeRegion(null, null), null)

console.log('\n── 화면에 쓰는 값 ──')
eq('없으면 「없음」', R.regionLabel(null), '없음')
eq('사내 구역도 「없음」으로 묶인다', R.regionLabel('중부'), '없음')
eq('필터 키 — 주소까지 본다', R.regionKey(null, '울산광역시 북구'), '울산')
eq('필터 키 — 못 잡으면 「없음」', R.regionKey('남부', '녹동일반 산업단지 내'), '없음')


console.log('\n── 지역2(시·군·구) ──')
eq('주소에서 시를 뽑는다', R.districtOf('경기도 화성시 동탄기흥로 590'), '화성시')
eq('구도 뽑는다', R.districtOf('서울특별시 강남구 테헤란로 152'), '강남구')
eq('군도 뽑는다', R.districtOf('경기도 양평군 양평읍 1'), '양평군')
eq('시도가 빠진 주소도 본다', R.districtOf('화성시 동탄기흥로 590'), '화성시')
eq('세종처럼 시·군·구가 없으면 null', R.districtOf('세종특별자치시 한누리대로 2130'), null)
eq('주소가 없으면 null', R.districtOf(''), null)

eq('저장된 지역2 가 시·군·구면 쓴다', R.usableRegion2('화성시'), '화성시')
eq('시도를 또 적어 둔 값은 버린다', R.usableRegion2('울산'), null)

eq('두 단계로 찍는다', R.regionLabel2('경기', null, '경기도 화성시 동탄기흥로 590'), '경기 화성시')
eq('저장된 지역2 를 쓴다', R.regionLabel2('서울', '강남구', '서울특별시 강남구 1'), '서울 강남구')
eq('믿을 수 없는 지역2 는 주소로 대신한다', R.regionLabel2('울산', '울산', '울산광역시 북구 양정동 700'), '울산 북구')
eq('시·군·구를 모르면 시도만', R.regionLabel2('세종', null, '세종특별자치시 한누리대로'), '세종')
eq('둘 다 없으면 없음', R.regionLabel2(null, null, null), '없음')

console.log(fails === 0 ? '\n모두 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
