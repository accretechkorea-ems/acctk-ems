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
// 「마지막 확인」은 2026-11-25 에 걷었다 — 그 자취가 남아 있지 않아야 한다.
ok('확인 기능의 자취가 없다',
  !/verified_at/.test(ROUTE) && !/card_verified/.test(ROUTE) && !/'verify'/.test(ROUTE))

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

// 글자를 줄로 끊어 칸을 맞추던 규칙은 2026-11-23 에 **모델**로 넘어갔다(app/api/cards/ocr).
// 여기서는 모델이 돌려준 값을 **믿지 않고 다듬는 쪽**만 본다.
console.log('\n── ⑥ 모델이 돌려준 값 다듬기 ──')
eq('① 국가번호는 0 으로',
  ['+82-10-1234-5678', '+82 2 6124 6500', '0082-31-123-4567'].map(O.normalizePhone),
  ['010-1234-5678', '02-6124-6500', '031-123-4567'])
eq('② 숫자·하이픈만 남긴다',
  ['T. 031 123 4567', '(031)123-4568', 'Mobile: 010.2222.3333'].map(O.normalizePhone),
  ['031-123-4567', '031-123-4568', '010-2222-3333'])
eq('③ 번호가 아니면 버린다', ['', '내선 7', '-', 'none'].map(O.normalizePhone), ['', '', '', ''])

eq('④ 코드펜스를 벗긴다',
  O.parseOcrJson('```json\n{"name":"홍길동"}\n```'), { name: '홍길동' })
eq('⑤ 앞뒤 군더더기를 걷는다',
  O.parseOcrJson('네, 읽었습니다.\n{"name":"홍길동"}\n도움이 되었길.'), { name: '홍길동' })
eq('⑥ JSON 이 아니면 null', O.parseOcrJson('읽지 못했습니다'), null)
// 모델이 배열로 감싸 보내도 **안의 객체**를 꺼낸다 — 중괄호 사이만 읽기 때문이다.
eq('⑦ 배열로 감싸 와도 꺼낸다', O.parseOcrJson('[{"name":"홍길동"}]'), { name: '홍길동' })

const g = O.fieldsFromJson({
  name: '홍길동', name_en: 'Gil-dong Hong', position: '과장', department: '영업1팀',
  company: '주식회사 가나정밀', company_en: null, phone: '+82-31-123-4567',
  mobile: '010 1234 5678', fax: '-', email: 'hong@gana.co.kr',
  address: '경기도 화성시 동탄대로 123', website: 'www.gana.co.kr', memo_hint: '지어낸 칸',
  셋째줄: '모르는 칸',
})
eq('⑧ 칸에 담으며 번호를 다듬는다', [g.name, g.phone, g.mobile, g.email, g.website],
  ['홍길동', '031-123-4567', '010-1234-5678', 'hong@gana.co.kr', 'www.gana.co.kr'])
eq('⑨ 「없음」을 뜻하는 값은 빈 칸', [g.fax, g.company_en], ['', ''])
eq('⑨-2 memo_hint 는 더 이상 받지 않는다', g.memo_hint ?? null, null)
eq('⑩ 모르는 칸은 들어오지 않는다', Object.keys(g).filter(k => !O.OCR_KEYS.includes(k)), [])
eq('⑪ 칸 이름 열둘', O.OCR_KEYS.length, 12)

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
// 사진을 **받는** 자리는 읽는 라우트 둘뿐이다(한 장 · 여러 장) — 거기서도 메모리에서만 쓴다.
// 받은 파일을 어디에도 남기지 않는 것은 scripts/card-ocr-check.js 와 card-bulk-check.js 가 본다.
const OCR_ROUTES = new Set(['app/api/cards/ocr/route.ts', 'app/api/cards/ocr-bulk/route.ts'])
const uploaders = cardFiles
  .filter(f => !OCR_ROUTES.has(f))
  .filter(f => /storage\.from\(|\.upload\(|formData\(\)/.test(read(f)))
eq('사진을 올리거나 저장하는 자리', uploaders, [])
ok('명함 라우트는 파일을 받지 않는다', !/formData\(\)/.test(ROUTE) && !/storage\./.test(ROUTE))
ok('그 사실을 코드에 적어 두었다', /PHOTO_IS_NEVER_STORED/.test(read('lib/businessCardOcr.ts')))

console.log('\n── ⑧ 칸·검색·엑셀 ──')
eq('칸 열세 개', C.CARD_FIELDS.length, 13)
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

// ── ⑨ 영문 둘 — 2026-11-23. 표의 칸은 db/business_cards_en_20261123.sql 로 더한다 ──
console.log('\n── ⑨ 영문 이름·회사명 ──')
eq('한글 칸 바로 아래에 선다',
  [C.CARD_FIELDS.indexOf('name_en') - C.CARD_FIELDS.indexOf('name'),
    C.CARD_FIELDS.indexOf('company_en') - C.CARD_FIELDS.indexOf('company')], [1, 1])
eq('칸 이름', [C.FIELD_LABEL.name_en, C.FIELD_LABEL.company_en], ['영문 이름', '영문 회사명'])
eq('선택 입력이다(필수는 이름뿐)', [...C.REQUIRED_FIELDS], ['name'])
eq('빈 폼에도 자리가 있다', [C.EMPTY_CARD_FORM.name_en, C.EMPTY_CARD_FORM.company_en], ['', ''])
eq('아직 없을 수 있는 칸', [...C.EN_FIELDS], ['name_en', 'company_en'])
eq('엑셀 열 둘', ['name_en', 'company_en'].map(k => C.EXCEL_COLUMNS.some(c => c.key === k)), [true, true])
ok('영문으로도 찾아진다',
  C.matchesCard({ ...card, name_en: 'Gil-dong Hong', company_en: 'GANA PRECISION' }, 'gana precision'))
// 모델이 읽어 온 영문도 그대로 칸에 담긴다(라우트는 표에 칸이 없으면 뺀다).
const en = O.fieldsFromJson({ name: '홍길동', name_en: 'Gil-dong Hong', company_en: 'GANA PRECISION Co., Ltd.' })
eq('모델이 준 영문을 담는다', [en.name_en, en.company_en], ['Gil-dong Hong', 'GANA PRECISION Co., Ltd.'])
const enMerged = O.mergeBack({ name: '홍길동', name_en: '' }, { name_en: 'Gil-dong Hong', company_en: 'GANA' })
eq('뒷면에서 영문만 채운다', [enMerged.name, enMerged.name_en, enMerged.company_en],
  ['홍길동', 'Gil-dong Hong', 'GANA'])
eq('채운 칸 목록에도 든다', O.filledFields({ name: '홍길동', name_en: 'Gil-dong Hong', company_en: '' }),
  ['name', 'name_en'])
ok('SQL 파일이 있다', fs.existsSync(path.join(ROOT, 'db/business_cards_en_20261123.sql')))
const EN_SQL = read('db/business_cards_en_20261123.sql')
ok('두 칸을 더하고 스키마를 깨운다',
  /add column if not exists name_en\s+text/.test(EN_SQL)
  && /add column if not exists company_en text/.test(EN_SQL)
  && /notify pgrst, 'reload schema'/.test(EN_SQL))
ok('칸이 없어도 담기가 깨지지 않는다(라우트가 뺀다)',
  /dropMissingColumns/.test(ROUTE) && /PGRST204/.test(ROUTE))
// ── ⑩ 고른 줄 지우기 — 2026-11-25 ──
console.log('\n── ⑩ 선택 삭제 띠 ──')
const CARDS_PAGE = read('app/cards/page.tsx')
ok('줄마다 체크칸', /checked=\{picked\.has\(c\.card_id\)\}/.test(CARDS_PAGE))
ok('머리글에 전체 고르기', /checked=\{allPicked\} onChange=\{toggleAll\}/.test(CARDS_PAGE))
ok('고른 것이 있으면 띠가 선다', /\{picked\.size > 0 && \(/.test(CARDS_PAGE))
ok('고객사 목록과 같은 띠(ems-bulk-bar)', /className="ems-bulk-bar"/.test(CARDS_PAGE))
ok('띠에 건수·삭제·선택 해제', /selectionTitle\(picked\.size\)/.test(CARDS_PAGE)
  && /삭제\s*\n?\s*<\/button>/.test(CARDS_PAGE) && /선택 해제/.test(CARDS_PAGE))
ok('권한 밖은 안내하고 뺀다',
  /skippedNotice\(skipped\)/.test(CARDS_PAGE) && /canDeleteCard\(me, c\)/.test(CARDS_PAGE))
ok('지우기는 서버 라우트로', /fetch\('\/api\/cards\/delete'/.test(CARDS_PAGE))
ok('폰에서는 「선택」 토글로 체크칸이 뜬다',
  /\{picking \? '선택 끝' : '선택'\}/.test(CARDS_PAGE) && /\{picking && \(/.test(CARDS_PAGE))
ok('체크칸이 줄 열기를 가로채지 않는다', /onClick=\{e => e\.stopPropagation\(\)\}/.test(CARDS_PAGE))

// ── ⑩-2 화면 정돈 — 2026-11-25 ──
console.log('\n── ⑩-2 목록·모달 정돈 ──')
const FORM_SRC = read('components/cards/CardFormModal.tsx')
ok('필터는 단추 하나로', /aria-label="필터"/.test(CARDS_PAGE) && /setFilterOpen\(true\)/.test(CARDS_PAGE))
ok('그 창이 있다', fs.existsSync(path.join(ROOT, 'components/cards/CardFilterModal.tsx')))
ok('드롭다운 셋을 걷었다',
  !/등록자 전체/.test(CARDS_PAGE) && !/사업부 전체/.test(CARDS_PAGE) && !/가져오기 전체/.test(CARDS_PAGE))
ok('엑셀은 아이콘 버튼', /aria-label="엑셀 내보내기"/.test(CARDS_PAGE) && !/⬇ 엑셀/.test(CARDS_PAGE))
ok('등록 버튼은 「＋ 명함」', CARDS_PAGE.includes('＋ 명함<') && !CARDS_PAGE.includes('＋ 명함 등록<'))
eq('등록일은 yy-mm-dd', (() => {
  const m = CARDS_PAGE.match(/const shortDay[\s\S]*?\n\}/)
  return m ? /slice\(2\)/.test(m[0]) : false
})(), true)
ok('「● 오늘」 꼬리표를 표에서 걷었다', !/<AgeTag registeredAt=\{c\.registered_at\} today=\{today\} \/>\s*\n\s*<\/td>/.test(CARDS_PAGE))
ok('행 호버 클래스', /className="ems-card-row"/.test(CARDS_PAGE)
  && /\.ems-card-row:hover > td/.test(read('app/globals.css')))
ok('호버는 테마 파랑 테두리', /--color-brand-border/.test(read('app/globals.css')))
ok('열람이 기본이다', /const \[mode2, setMode2\] = useState<'view' \| 'edit'>\('view'\)/.test(FORM_SRC))
ok('수정을 누르면 입력 모드', /setMode2\('edit'\)/.test(FORM_SRC))
ok('취소로 열람에 돌아온다', /if \(editing\) setMode2\('view'\)/.test(FORM_SRC))
ok('값은 글자로 보여 준다', /const viewValue/.test(FORM_SRC) && /viewLabel/.test(FORM_SRC))
ok('넓은 창(760)', /width=\{760\}/.test(FORM_SRC))
ok('폰은 1단', /narrow \? '1fr' : '1fr 1fr'/.test(FORM_SRC))

// ── ⑪ 휴대폰이 없으면 회사 전화 — 2026-11-25 ──
console.log('\n── ⑪ 연락처 한 줄 ──')
eq('휴대폰이 먼저',
  C.displayPhone({ mobile: '010-1234-5678', phone: '031-123-4567' }),
  { number: '010-1234-5678', isCompany: false })
eq('휴대폰이 없으면 회사 전화',
  C.displayPhone({ mobile: '', phone: '031-123-4567' }),
  { number: '031-123-4567', isCompany: true })
eq('공백만 있어도 없는 것으로',
  C.displayPhone({ mobile: '   ', phone: '+81-42-642-1701' }),
  { number: '+81-42-642-1701', isCompany: true })
eq('둘 다 없으면 null', C.displayPhone({ mobile: null, phone: null }), null)
eq('표기 글자', C.COMPANY_PHONE_MARK, '회사')
ok('PC 표가 그 함수를 쓴다', /const got = displayPhone\(c\)/.test(CARDS_PAGE))
eq('두 자리(표·폰 카드)에서 쓴다', (CARDS_PAGE.match(/displayPhone\(c\)/g) || []).length, 2)
ok('회사 표기는 안내색', /color: SUB, marginRight: 4/.test(CARDS_PAGE) || /color: SUB, marginRight: 3/.test(CARDS_PAGE))
ok('엑셀 열은 그대로 둘이다',
  C.EXCEL_COLUMNS.some(c => c.key === 'mobile') && C.EXCEL_COLUMNS.some(c => c.key === 'phone'))

ok('칸이 없어도 목록이 비지 않는다(짧은 select 로 다시 읽는다)',
  /SELECT_BASE/.test(read('app/cards/page.tsx')) && /error\?\.code === '42703'/.test(read('app/cards/page.tsx')))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
