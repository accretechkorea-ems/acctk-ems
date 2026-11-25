// 검색 드롭다운은 **한 컴포넌트**로, 회사 검색은 **한 함수**로 (2026-11-23).
//
//   node scripts/combo-box-check.js
//
// 지키는 약속
//   ① 회사를 글자로 찾는 자리는 lib/companySearch.ts 한 곳을 지난다
//      — 회사명 · 영문명 · 사업장명 · 주소 · 대리점명. 손으로 적은 회사명 필터는 0건.
//   ② 검색 드롭다운(입력칸 + 떠 있는 후보 목록)은 components/common/SearchSelect.tsx 를 쓴다.
//      목록과 키보드를 **직접** 들고 있는 파일(useListKeyboard 를 바로 부르는 파일)은
//      아래 PENDING 에 적힌 것뿐이고, 그 수는 **늘지 않는다**.
//   ③ 공용 컴포넌트는 ↑↓·Enter·Esc·Tab 과 마우스 혼용을 지킨다.
//   ④ 결과 줄에는 영문명이 회색으로 나란히 선다.

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

const S = load(path.join(ROOT, 'lib/companySearch.ts'))

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

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

/** 코드 파일 전부(빌드 산출물·설정 제외). */
function sources() {
  const out = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`
      if (e.isDirectory()) { walk(rel); continue }
      if (/\.(ts|tsx)$/.test(e.name)) out.push(rel)
    }
  }
  for (const d of ['app', 'components', 'lib', 'hooks']) walk(d)
  return out
}
const FILES = sources()

console.log('\n── ① 회사 검색은 한 함수다 ──')
const hyundai = {
  company_name: '(주)현대트랜시스 서산공장',
  name_en: 'HYUNDAI TRANSYS',
  site_name: '서산공장',
  address: '충남 서산시 지곡면',
  agency_name: '감마세타',
}
eq('다섯 칸을 다 본다', [
  S.matchesCompany(hyundai, '현대'),
  S.matchesCompany(hyundai, 'HYUNDAI'),
  S.matchesCompany(hyundai, '서산공장'),
  S.matchesCompany(hyundai, '지곡면'),
  S.matchesCompany(hyundai, '감마세타'),
], [true, true, true, true, true])
ok('대소문자를 가리지 않는다', S.matchesCompany(hyundai, 'hyundai transys'))
ok('없는 말은 안 걸린다', S.matchesCompany(hyundai, '기아') === false)
ok('검색어가 비면 전부 통과(거르지 않는다)', S.matchesCompany({ company_name: null }, '   '))
ok('빈 칸은 건너뛴다', S.matchesCompany({ company_name: '가나', name_en: null, address: null }, '가나'))
ok('그 자리만 보는 칸(extra)도 본다',
  S.matchesCompany(hyundai, 'SBS-100', ['SBS-100 · 12345']))
ok('extra 가 없어도 터지지 않는다', S.matchesCompany(hyundai, '현대', undefined))
eq('한 줄로 모은 글자는 소문자다', S.companyHaystack({ company_name: 'ACCT-K' }), 'acct-k')
eq('칸 이름 다섯', S.COMPANY_SEARCH_FIELDS.length, 5)
ok('안내 글이 다섯 칸을 적어 둔다',
  ['회사명', '영문명', '사업장명', '주소', '대리점'].every(w => S.COMPANY_SEARCH_PLACEHOLDER.includes(w)))

console.log('\n── ①-ⓑ 회사를 **고를** 때는 이름 둘만 본다 ──')
// 고르는 칸에서 주소까지 보면 「지곡면」으로 그 동네의 남의 회사가 후보에 오른다.
eq('이름 둘로는 걸린다', [
  S.matchesCompanyPick(hyundai, '현대'),
  S.matchesCompanyPick(hyundai, 'HYUNDAI'),
], [true, true])
eq('주소·사업장명·대리점명으로는 안 걸린다', [
  S.matchesCompanyPick(hyundai, '지곡면'),
  S.matchesCompanyPick(hyundai, '감마세타'),
  S.matchesCompanyPick({ company_name: '가나', site_name: '서산공장' }, '서산공장'),
], [false, false, false])
ok('검색어가 비면 전부 통과', S.matchesCompanyPick(hyundai, '  '))
eq('칸 이름 둘', S.COMPANY_PICK_FIELDS.length, 2)
eq('고르기 안내 글', S.COMPANY_PICK_PLACEHOLDER, '회사명 · 영문명')
eq('서버 조건도 이름 둘', S.companyPickOr('현대', true), 'company_name.ilike.%현대%,name_en.ilike.%현대%')
eq('영문명 칸이 없으면 하나', S.companyPickOr('현대', false), 'company_name.ilike.%현대%')
// 고르는 자리가 ⓐ(넓은 검색)를 쓰면 안 된다.
const PICKERS = [
  'components/customer/AgencyPicker.tsx',
  'components/customer/ParentPicker.tsx',
  'components/customer/modals/OpportunityModal.tsx',
  'components/showroom/CustomerSearch.tsx',
  'components/home/list/CompanySearchModal.tsx',
  'components/home/AddCustomerModal.tsx',
]
eq('고르는 자리는 모두 ⓑ 를 쓴다',
  PICKERS.filter(f => !/matchesCompanyPick\(|companyPickOr\(/.test(read(f))), [])
eq('고르는 자리에 ⓐ 가 섞이지 않았다',
  PICKERS.filter(f => /matchesCompany\(|companySearchOr\(/.test(read(f))), [])

console.log('\n── ② 서버 조회 조건 ──')
eq('영문명 칸이 있을 때', S.companySearchOr('현대', true),
  'company_name.ilike.%현대%,name_en.ilike.%현대%,site_name.ilike.%현대%,address.ilike.%현대%')
eq('영문명 칸이 없을 때는 그것만 빠진다', S.companySearchOr('현대', false),
  'company_name.ilike.%현대%,site_name.ilike.%현대%,address.ilike.%현대%')

console.log('\n── ③ 손으로 적은 회사명 필터가 없다 ──')
// 「회사명 한 칸만 보고 거르는」 코드. 자리마다 보는 칸이 갈리던 원인이다.
const handRolled = FILES.filter(f => f !== 'lib/companySearch.ts')
  .filter(f => /company_name[^\n]{0,40}toLowerCase\(\)\.includes/.test(read(f)))
eq('남은 자리', handRolled, [])

console.log('\n── ④ 드롭다운은 공용 컴포넌트를 쓴다 ──')
// 아직 옮기지 못한 자리 — **견적 화면 셋**. 입력칸이 상자(q-box) 안에서 지우기 × 와 한 몸이라
// 입력칸을 통째로 넘기는 공용 컴포넌트에 그대로 들어가지 않는다. 그 상자를 손보는 일은
// 견적 입력 전체를 건드리므로 따로 다룬다. 지금은 **수가 늘지 않는 것**만 지킨다.
const PENDING_HOOK = ['app/quote/QuoteItemRow.tsx', 'hooks/quote/useQuoteCustomer.ts']
const PENDING_LIST = ['app/quote/QuoteItemRow.tsx', 'components/quote/CustomerCard.tsx']
const ALLOWED = ['components/common/SearchSelect.tsx', 'hooks/useListKeyboard.ts']
// 엑셀 미리보기는 드롭다운이 아니라 **표**다 — 같은 훅을 쓰지만 고르는 목록이 아니다.
const NOT_A_DROPDOWN = ['components/xlsx/XlsxPreviewModal.tsx']
/**
 * 문구 고르기(2026-11-25)는 **입력칸이 패널 안에** 있다 — 라벨 옆의 「문구 ▾」를 누르면
 * 검색칸·묶음 머리글(내 문구·공용)·아래 두 줄(다른 용도 보기·지금 내용을 문구로 저장)이
 * 한 판에 함께 뜬다(시안). 공용 콤보박스는 입력칸을 **밖에** 두고 목록만 띄우는 모양이라
 * 이 생김새가 들어가지 않는다. 대신 **조작 규칙은 같은 부품**을 쓴다 —
 * useListKeyboard · useOverlayEsc · IME 가드 · Tab 닫기 · hover 는 고른 자리만 옮기기.
 * 아래 ⑤ 가 그 다섯을 지킨다.
 */
const SAME_RULES = ['components/common/SnippetPicker.tsx']

const handHook = FILES.filter(f => !ALLOWED.includes(f) && /useListKeyboard\(/.test(read(f)))
eq('키보드를 직접 붙인 파일은 적어 둔 것뿐', handHook.sort(), [...PENDING_HOOK].sort())

// 후보 목록을 **직접 그리는** 파일 — 줄마다 setActive 를 부르는 것이 그 표시다.
const handList = FILES
  .filter(f => !ALLOWED.includes(f) && !NOT_A_DROPDOWN.includes(f) && !SAME_RULES.includes(f))
  .filter(f => /setActive\(/.test(read(f)))
eq('후보 목록을 직접 그리는 파일도 적어 둔 것뿐', handList.sort(), [...PENDING_LIST].sort())

// 생김새가 달라 공용 컴포넌트에 들어가지 않는 자리는 **조작 규칙을 같은 부품으로** 지킨다.
for (const f of SAME_RULES) {
  const src = read(f)
  ok(`${f} — 같은 키보드 부품을 쓴다`,
    /useListKeyboard/.test(src) && /useOverlayEsc/.test(src)
    && /isComposing/.test(src) && /e\.key === 'Tab'/.test(src)
    && /onMouseEnter=\{\(\) => keys\.setActive/.test(src),
    'useListKeyboard · useOverlayEsc · IME 가드 · Tab 닫기 · hover=setActive 다섯을 모두 써야 한다')
}

const MIGRATED = [
  'components/common/AutocompleteInput.tsx',
  'components/customer/AgencyPicker.tsx',
  'components/customer/ParentPicker.tsx',
  'components/customer/modals/OpportunityModal.tsx',
  'components/showroom/CustomerSearch.tsx',
]
for (const f of MIGRATED) {
  ok(`${f} — 공용 콤보박스를 쓴다`, read(f).includes("from '@/components/common/SearchSelect'"))
}
// 옮긴 자리가 목록을 **한 벌 더** 들고 있으면 조작이 다시 갈린다.
const ownList = MIGRATED.filter(f => /<Popover/.test(read(f)) || /setActive\(/.test(read(f)))
eq('옮긴 자리는 후보 목록을 더 그리지 않는다', ownList, [])

console.log('\n── ⑤ 공용 컴포넌트가 지키는 것 ──')
const C = read('components/common/SearchSelect.tsx')
ok('↑↓·Enter 는 공용 훅', C.includes("from '@/hooks/useListKeyboard'"))
// Esc 는 **쌓임**이 받는다 — 이 앱의 React 뿌리와 모달의 Esc 가 둘 다 document 에 걸려
// 있어, 입력칸에서 stopPropagation 해도 모달이 함께 닫혔다(2026-11-23 실측).
ok('Esc 는 쌓임이 받는다', /useOverlayEsc\(true, \(\) => setOpen\(false\), isOpen\)/.test(C))
ok('입력칸은 Esc 를 가로채지 않는다(모달이 닫히는 길을 막지 않는다)',
  /if \(e\.key === 'Escape'\) return/.test(C) && !/e\.stopPropagation\(\)/.test(C))
ok('Tab 이면 닫고 다음 칸으로', /e\.key === 'Tab'/.test(C))
ok('IME 조합 중에는 가로채지 않는다', /isComposing \|\| e\.keyCode === 229/.test(C))
ok('hover 는 색을 칠하지 않고 고른 자리만 옮긴다',
  /onMouseEnter=\{\(\) => keys\.setActive\(i\)\}/.test(C) && !/currentTarget\.style\.background/.test(C))
ok('고른 줄 하나만 강조한다(마우스·키보드가 같은 표시)',
  /background: i === keys\.active \? NEUTRAL_BG : 'transparent'/.test(C))
ok('mousedown 으로 고른다(포커스를 잃기 전에)', /onMouseDown=\{e => \{ e\.preventDefault\(\); r\.run\(\) \}\}/.test(C))
ok('목록은 포털로 뜬다(모달·스크롤 상자 안에서 잘리지 않게)', C.includes('<Popover'))
ok('더 두는 줄(직판·새로 등록)도 키보드로 닿는다', /\.\.\.top\.map\(toRow\)/.test(C) && /\.\.\.bottom\.map\(toRow\)/.test(C))
ok('읽어 주는 표시(role)를 단다', /role="combobox"/.test(C) && /role="listbox"/.test(C) && /role="option"/.test(C))

console.log('\n── ⑥ 결과 줄에 영문명이 회색으로 선다 ──')
ok('영문명 줄을 그리는 자리가 하나다', /export function CompanyOption/.test(C))
ok('영문명은 회색 11', /nameEn \? \([\s\S]{0,120}fontSize: 11, color: MUTED/.test(C))
const withEn = MIGRATED.filter(f => read(f).includes('CompanyOption'))
eq('회사를 고르는 자리는 모두 영문명을 함께 보여 준다', withEn.sort(), [
  'components/customer/AgencyPicker.tsx',
  'components/customer/ParentPicker.tsx',
  'components/customer/modals/OpportunityModal.tsx',
  'components/showroom/CustomerSearch.tsx',
].sort())

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
