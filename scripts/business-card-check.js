// 명함 — 표·권한·사업부·중복·나이·OCR·사진 미저장 (2026-11-23).
//
//   node scripts/business-card-check.js
//
// 지키는 약속
//   ① 표에 **고객사 연결 칸이 없다**(지시) · 등록일은 고칠 수 없다 · 쓰기 정책이 없다.
//   ② 담기·고치기·확인은 로그인이면 되고, **지우기만** 슈퍼관리자다.
//   ③ 사업부 기본값은 등록자 팀의 사업부. 전환 가능 팀은 양쪽을 본다.
//   ④ 같은 이름+휴대폰 또는 같은 이메일이면 **물어본다**(막지는 않는다).
//   ⑤ 나이 꼬리표 경계 — 364일 초록 · 365일 주황 · 1095일 빨강.
//   ⑥ OCR 이 읽은 글자를 칸에 바르게 나눈다(샘플 다섯).
//   ⑦ **사진은 서버로 가지 않는다** — 올리는 라우트도, Storage 에 쓰는 코드도 없다.

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

const C = load(path.join(ROOT, 'lib/businessCard.ts'))
const O = load(path.join(ROOT, 'lib/businessCardOcr.ts'))
const M = load(path.join(ROOT, 'lib/menuPerms.ts'))

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

const SQL = read('db/business_cards_20261123.sql')
const ROUTE = read('app/api/business-card/route.ts')

console.log('\n── ① 표 ──')
for (const col of ['name', 'company', 'department', 'position', 'mobile', 'phone', 'fax',
  'email', 'address', 'website', 'memo', 'division', 'registered_at', 'verified_at',
  'input_method', 'engineer_id', 'registered_name', 'registered_team', 'registered_div', 'deleted_at']) {
  ok(`칸 ${col}`, new RegExp(`\\b${col}\\s`).test(SQL))
}
ok('이름은 필수다', /name\s+text not null/.test(SQL) && /btrim\(name\) <> ''/.test(SQL))
// 주석에서는 「두지 않는다」를 설명할 수 있다 — 보는 것은 **칸 선언**이다.
const sqlCode = SQL.split(/\r?\n/).filter(l => !/^\s*--/.test(l)).join('\n')
ok('**고객사·사업장 연결 칸이 없다**(지시)', !/customer_id|site_id|parent_customer_id/.test(sqlCode),
  '연결 칸이 들어갔다 — 지시는 두지 말라는 것이다')
ok('등록일은 트리거가 막는다', /new\.registered_at := old\.registered_at/.test(SQL))
ok('사업부는 둘 중 하나', /division in \('계측', '반도체'\)/.test(SQL))
ok('넣는 방식은 셋 중 하나', /input_method in \('camera', 'upload', 'manual'\)/.test(SQL))
ok('지우기는 소프트다', /deleted_at\s+timestamptz/.test(SQL) && !/delete from public\.business_cards/i.test(SQL))
ok('읽기는 로그인 전원', /for select to authenticated/.test(SQL))
ok('authenticated 쓰기 정책이 없다',
  !/for (insert|update|delete) to authenticated/.test(SQL), '브라우저 열쇠로 쓸 수 있게 됐다')
ok('변경 기록 표가 있다', /create table if not exists public\.business_card_events/.test(SQL))
ok('스키마를 다시 읽힌다', /notify pgrst, 'reload schema'/.test(SQL))

console.log('\n── ② 권한 ──')
ok('지우기·되돌리기만 슈퍼관리자',
  /const needsAdmin = action === 'delete' \|\| action === 'restore'/.test(ROUTE))
ok('그 밖에는 로그인이면 된다', /: await loadCaller\(\{ kind: 'login' \}/.test(ROUTE))
ok('고친 자국을 남긴다', /business_card_events/.test(ROUTE) && /card_edited/.test(ROUTE))
ok('등록자는 세션에서 만든다', /snapshotOf\(caller, division\)/.test(ROUTE) && !/registered_name: body\./.test(ROUTE))
ok('확인은 등록일을 건드리지 않는다',
  /action === 'verify'[\s\S]{0,200}update\(\{ verified_at: now \}\)/.test(ROUTE))

console.log('\n── ③ 사업부 ──')
eq('기본값은 등록자 팀의 사업부', [
  C.defaultDivision({ perm: { division: '반도체' } }),
  C.defaultDivision({ perm: { division: '계측' } }),
  C.defaultDivision({ perm: null }),
  C.defaultDivision(null),
], ['반도체', '계측', '계측', '계측'])
eq('전환 가능 팀은 양쪽을 본다',
  C.visibleDivisions({ canSwitch: true, teamDivision: '계측' }), ['계측', '반도체'])
eq('그 밖에는 자기 사업부만', [
  C.visibleDivisions({ canSwitch: false, teamDivision: '계측' }),
  C.visibleDivisions({ canSwitch: false, teamDivision: '반도체' }),
], [['계측'], ['반도체']])
ok('명함 메뉴는 사업부를 타지 않는다', M.menuDivision(M.MENU_BY_KEY.business_cards) === '공통')
ok('「전사」 묶음에 있다', M.MENU_BY_KEY.business_cards.group === '전사')
ok('팀 권한 체크 목록에 뜬다', M.checkableGroups().some(g => g.items.some(i => i.key === 'business_cards')))

console.log('\n── ④ 중복 ──')
const rows = [
  { card_id: 1, name: '홍길동', mobile: '010-1234-5678', email: 'hong@gana.co.kr', division: '계측', registered_at: '2026-01-01' },
  { card_id: 2, name: '김철수', mobile: '010-9999-0000', email: null, division: '계측', registered_at: '2026-01-01' },
  { card_id: 3, name: '박민수', mobile: null, email: null, division: '계측', registered_at: '2026-01-01', deleted_at: '2026-02-01' },
]
eq('이름+휴대폰이 같으면 찾는다',
  C.findDuplicate({ name: '홍길동', mobile: '01012345678', email: '' }, rows)?.card_id, 1)
eq('이메일만 같아도 찾는다',
  C.findDuplicate({ name: '다른사람', mobile: '', email: 'HONG@gana.co.kr ' }, rows)?.card_id, 1)
eq('이름만 같으면 아니다', C.findDuplicate({ name: '김철수', mobile: '010-1111-2222', email: '' }, rows), null)
eq('지워진 줄은 보지 않는다', C.findDuplicate({ name: '박민수', mobile: '', email: '' }, rows), null)
eq('물어보는 말', [C.DUPLICATE_TITLE, C.DUPLICATE_OPEN, C.DUPLICATE_SAVE],
  ['이미 등록된 명함입니다', '기존 것 열기', '그래도 저장'])

console.log('\n── ⑤ 나이 꼬리표 ──')
eq('경계 — 364·365·1094·1095', [
  C.ageTone(0), C.ageTone(364), C.ageTone(365), C.ageTone(1094), C.ageTone(1095),
], ['fresh', 'fresh', 'stale', 'stale', 'old'])
eq('색은 표의 상태색', [C.AGE_TONES.fresh, C.AGE_TONES.stale, C.AGE_TONES.old],
  ['#16a34a', '#f59e0b', '#ef4444'])
eq('글자', [C.ageLabel(0), C.ageLabel(12), C.ageLabel(90), C.ageLabel(400), C.ageLabel(1200)],
  ['오늘', '12일 전', '3개월 전', '1년 전', '3년 전'])
eq('날짜 수 세기', C.daysBetween('2026-11-01T00:00:00Z', '2026-11-23T00:00:00Z'), 22)
eq('확인 꼬리표', [C.verifiedLabel('2026-11-23T05:00:00Z'), C.verifiedLabel(null)], ['확인 2026-11', ''])

console.log('\n── ⑥ OCR 칸 배치 ──')
const S1 = '주식회사 가나정밀\n영업1팀\n홍길동 과장\nM. 010-1234-5678\nT. 031-123-4567\nF. 031-123-4568\nhong@gana.co.kr\n경기도 화성시 동탄대로 123\nwww.gana.co.kr'
const f1 = O.fieldsFromText(S1)
eq('① 흔한 한글 명함', [f1.name, f1.company, f1.department, f1.position, f1.mobile, f1.phone, f1.fax, f1.email, f1.website, f1.address],
  ['홍길동', '주식회사 가나정밀', '영업1팀', '과장', '010-1234-5678', '031-123-4567', '031-123-4568',
    'hong@gana.co.kr', 'www.gana.co.kr', '경기도 화성시 동탄대로 123'])

const f2 = O.fieldsFromText('㈜대한기계\n기술지원팀\n김철수 책임\n휴대폰 010-9876-5432\n전화 02-555-1234\nkim@daehan.com')
eq('② 이름과 직급이 한 줄', [f2.name, f2.position, f2.company, f2.department, f2.mobile, f2.phone],
  ['김철수', '책임', '㈜대한기계', '기술지원팀', '010-9876-5432', '02-555-1234'])

const f3 = O.fieldsFromText('아크레텍코리아\nFax. 02-6124-6501\nTel. 02-6124-6500\n이영희\n대리\nlee@acctk.co.kr')
eq('③ 팩스가 전화보다 먼저 나와도 안 섞인다', [f3.fax, f3.phone, f3.name, f3.position],
  ['02-6124-6501', '02-6124-6500', '이영희', '대리'])

const f4 = O.fieldsFromText('GANA PRECISION Co., Ltd.\nSales Team\nGil-dong Hong / Manager\nMobile +82-10-1234-5678\nhong@gana.co.kr')
eq('④ 영문 뒷면', [f4.company, f4.department, f4.mobile, f4.email],
  ['GANA PRECISION Co., Ltd.', 'Sales Team', '+82-10-1234-5678', 'hong@gana.co.kr'])

const f5 = O.fieldsFromText('박민수\n010-2222-3333')
eq('⑤ 짧은 명함 — 못 읽은 칸은 비운다', [f5.name, f5.mobile, f5.company ?? null, f5.email ?? null],
  ['박민수', '010-2222-3333', null, null])

const merged = O.mergeBack(
  { name: '홍길동', company: '주식회사 가나정밀', email: '' },
  { name: 'Gil-dong Hong', company: 'GANA PRECISION', email: 'hong@gana.co.kr', website: 'www.gana.co.kr' },
)
eq('뒷면은 **빈 칸만** 채운다', [merged.name, merged.company, merged.email, merged.website],
  ['홍길동', '주식회사 가나정밀', 'hong@gana.co.kr', 'www.gana.co.kr'])
eq('자동으로 채운 칸 목록', O.filledFields({ name: '홍길동', company: '', email: 'a@b.c' }), ['name', 'email'])
eq('안내 글', O.OCR_NOTICE, '사진에서 읽음 · 확인 필요')

console.log('\n── ⑦ 사진은 서버로 가지 않는다 ──')
const SKIP = new Set(['node_modules', '.next', '.next-perf', '.git'])
const files = []
const walk = (d) => {
  for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
    const rel = `${d}/${e.name}`
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(rel); continue }
    if (/\.(ts|tsx)$/.test(e.name)) files.push(rel)
  }
}
for (const d of ['app', 'components', 'lib', 'hooks']) walk(d)
const cardFiles = files.filter(f => /business-?[Cc]ard|\/cards\//.test(f))
ok('명함 코드가 있다', cardFiles.length > 0)
const uploaders = cardFiles.filter(f => /storage\.from\(|\.upload\(|formData\(\)/.test(read(f)))
eq('사진을 올리거나 저장하는 자리', uploaders, [])
ok('라우트가 파일을 받지 않는다', !/formData\(\)/.test(ROUTE) && !/storage\./.test(ROUTE))
ok('그 사실을 코드에 적어 두었다', /PHOTO_IS_NEVER_STORED/.test(read('lib/businessCardOcr.ts')))

console.log('\n── ⑧ 칸·검색·엑셀 ──')
eq('칸 열한 개', C.CARD_FIELDS.length, 11)
eq('이름만 필수', [...C.REQUIRED_FIELDS], ['name'])
eq('폰 키패드', [C.FIELD_INPUT_TYPE.mobile, C.FIELD_INPUT_TYPE.email, C.FIELD_INPUT_TYPE.website],
  ['tel', 'email', 'url'])
eq('이름이 없으면 못 담는다', C.cardBlockedReason({ name: '  ', memo: '' }), '이름을 적어주세요')
eq('이름이 있으면 담긴다', C.cardBlockedReason({ name: '홍길동', memo: '' }), null)
const card = { card_id: 1, name: '홍길동', company: '가나정밀', department: '영업1팀', mobile: '010-1234-5678', email: 'hong@gana.co.kr', division: '계측', registered_at: '2026-01-01' }
eq('검색 — 이름·회사·부서·번호·이메일', [
  C.matchesCard(card, '홍길'), C.matchesCard(card, '가나'), C.matchesCard(card, '영업'),
  C.matchesCard(card, '1234'), C.matchesCard(card, 'hong@'), C.matchesCard(card, '없는말'),
], [true, true, true, true, true, false])
ok('번호는 숫자만 비교한다(01012345678 로도 걸린다)', C.matchesCard(card, '01012345678'))
ok('엑셀에 등록자 이름·팀·사업부가 있다',
  ['registered_name', 'registered_team', 'registered_div'].every(k => C.EXCEL_COLUMNS.some(c => c.key === k)))
eq('등록자 글자', C.registrarLabel({ registered_name: '권재원', registered_team: '80CS' }), '권재원 · 80CS')

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
