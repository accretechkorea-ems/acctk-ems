// 고객사 **검색이 보는 칸** (2026-11-27, 묶음4 D).
//
//   node scripts/list-search-scope-check.js
//
// ── 왜 좁혔나 ──────────────────────────────────────────────────────────────
//   2026-11-23 에 「통합 검색창을 넓게」 하며 다섯 칸(회사명·영문명·사업장명·주소·대리점명)
//   을 보게 했다. 운영에서 거꾸로 돌았다:
//     · 주소 — 「화성」을 치면 화성에 있는 **남의 회사**가 전부 걸린다. 지역은 칩이 가른다.
//     · 대리점명 — 「○○상사」를 치면 그 대리점이 맡은 **회사 전부**가 걸려, 정작 그
//       대리점 줄은 묻힌다. 대리점은 이미 필터 조건이 있다.
//   그래서 **이름만** 본다. 탭마다 보는 이름이 다르다.
//
//     회사 탭 · 정리 필요 탭 · 지도 보기 — 회사명 · 영문명 · 사업장명
//     대리점 탭                        — 대리점명 · 영문명
//
// 키 없이 서버 없이 돈다.

const load = module.require.bind(module)
const fs = load('fs')
const path = load('path')
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

const S = load(path.join(ROOT, 'lib/companySearch.ts'))
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')

let fails = 0
const ok = (name, good, extra) => {
  if (!good) fails++
  console.log(`${good ? 'OK  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`)
}

/** 같은 줄을 네 가지로 본다 — 어느 칸이 걸리고 어느 칸이 안 걸리는지 한눈에. */
const HYUNDAI = {
  company_name: '현대자동차',
  name_en: 'HYUNDAI MOTOR',
  site_name: '남양연구소',
  address: '경기 화성시 장덕동 772-1',
  agency_name: '대한정밀상사',
}

console.log('── ① 회사·사업장 검색은 **이름 셋**만 본다 ──')
ok('회사명으로 찾힌다', S.matchesCompany(HYUNDAI, '현대자동차'))
ok('영문명으로 찾힌다', S.matchesCompany(HYUNDAI, 'hyundai'))
ok('사업장명으로 찾힌다', S.matchesCompany(HYUNDAI, '남양연구소'))
ok('**주소로는 안 찾힌다** — 지역은 칩이 가른다', !S.matchesCompany(HYUNDAI, '화성시'))
ok('**대리점명으로도 안 찾힌다** — 대리점은 필터가 가른다', !S.matchesCompany(HYUNDAI, '대한정밀'))
ok('검색어가 비면 전부 참이다(거르지 않는다)', S.matchesCompany(HYUNDAI, '   '))

console.log('\n── ② 대리점 탭은 **그 줄의 이름**만 본다 ──')
const AGENCY = { company_name: '대한정밀상사', name_en: 'DAEHAN PRECISION', address: '경기 수원시' }
ok('대리점명으로 찾힌다', S.matchesAgency(AGENCY, '대한정밀'))
ok('영문명으로 찾힌다', S.matchesAgency(AGENCY, 'daehan'))
// 지시문이 못 박은 줄 — 대리점 탭에서 회사명을 치면 0건이다.
ok('**회사명으로 찾으면 0건**', !S.matchesAgency(AGENCY, '현대자동차'))
ok('주소로도 안 찾힌다', !S.matchesAgency(AGENCY, '수원'))
ok('검색어가 비면 전부 참이다', S.matchesAgency(AGENCY, ''))

console.log('\n── ③ 안내 글이 보는 칸과 같은 말을 한다 ──')
ok('회사 탭 안내 글', S.COMPANY_SEARCH_PLACEHOLDER === '회사명 · 영문명 · 사업장명')
ok('대리점 탭 안내 글', S.AGENCY_SEARCH_PLACEHOLDER === '대리점명 · 영문명')
ok('칸 목록도 셋·둘이다',
  S.COMPANY_SEARCH_FIELDS.join('·') === '회사명·영문명·사업장명'
  && S.AGENCY_SEARCH_FIELDS.join('·') === '대리점명·영문명')
ok('안내 글은 칸 목록에서 나온 말과 같다',
  S.COMPANY_SEARCH_PLACEHOLDER === S.COMPANY_SEARCH_FIELDS.join(' · ')
  && S.AGENCY_SEARCH_PLACEHOLDER === S.AGENCY_SEARCH_FIELDS.join(' · '))

console.log('\n── ④ 서버 조건도 같은 칸이다 ──')
const or = S.companySearchOr('현대', true)
ok('회사명·영문명·사업장명을 건다', /company_name\.ilike/.test(or) && /name_en\.ilike/.test(or) && /site_name\.ilike/.test(or))
ok('**주소는 걸지 않는다**', !/address\.ilike/.test(or))
ok('영문명 칸이 없는 DB 에서는 그것만 뺀다', !/name_en/.test(S.companySearchOr('현대', false)))

console.log('\n── ⑤ 화면이 그 판정을 쓴다 ──')
const PAGE = read('app/page.tsx')
const LIST = read('lib/customerList.ts')
const PANEL = read('components/home/list/CustomerListPanel.tsx')
const HEAD = read('components/home/PanelHeader.tsx')
// 지도 보기와 회사 탭이 **같은 것**을 봐야 한다 — 다르면 같은 글자에 다른 수가 나온다.
ok('지도 보기는 이름 셋만 넘긴다',
  /company_name: c\.company_name, name_en: parent\?\.name_en \?\? null, site_name: c\.site_name/.test(PAGE))
ok('지도 보기가 상태·장비 줄을 더 보지 않는다', !/\[c\.status, deviceLine\]/.test(PAGE))
ok('목록 보기(트리)도 주소·대리점명을 넘기지 않는다',
  !/address: c\.address,/.test(LIST.split('export function matchesSite')[1].slice(0, 1600))
  && !/agency_name: c\.agency_name/.test(LIST))
ok('대리점 탭이 matchesAgency 로 좁힌다', /matchesAgency\(/.test(PANEL) && /shownAgencies/.test(PANEL))
// 2026-11-27(묶음6 4-1) — 「정리 필요」 탭을 걷었다. 탭은 회사·대리점 둘이다.
ok('탭은 둘뿐이다', /export type ListTab = .company. | .agency./.test(PANEL))
ok('정리 필요 셈도 함께 걷었다', !/cleanupShown/.test(PANEL))
ok('안내 글은 탭이 정한다', /searchPlaceholder/.test(HEAD) && /AGENCY_SEARCH_PLACEHOLDER : COMPANY_SEARCH_PLACEHOLDER/.test(PAGE))

console.log(fails === 0 ? '\n전부 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
