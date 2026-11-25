// **고객사 담당자 등록** — 방식 고르기 · 아홉 칸 · 필수 다섯 (2026-11-25).
//
//   node scripts/contact-form-check.js
//
// 지키는 약속
//   ① 「＋」는 방식을 먼저 묻는다 — 사진으로 읽기 / 직접 입력, 둘뿐이다.
//   ② 칸은 아홉 개다(회사·주소·홈페이지는 사업장 것이라 없다).
//   ③ 필수 다섯은 처음부터 빨강이고, 차면 파랑이다. 휴대폰은 전화로 대신할 수 있다.
//   ④ 다 차기 전에는 저장을 누를 수 없고, 단추에 「필수 N개 남음」이 선다.
//   ⑤ 저장한 뒤 명함첩에도 담을지 묻는다 — 예면 한 장, 연결 키는 없다.
//   ⑥ 사진은 서버에 남지 않는다.
//   ⑦ 수정 창도 같은 칸·같은 필수 표시를 쓴다.
//
// ※ 이 파일은 **열쇠 없이** 돈다(하네스 규칙) — 글자와 순수 함수만 본다.

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

const C = load(path.join(ROOT, 'lib/contactForm.ts'))
const B = load(path.join(ROOT, 'lib/businessCard.ts'))

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
const has = (p) => fs.existsSync(path.join(ROOT, p))

const ADD = read('components/customer/modals/ContactAddModal.tsx')
const EDIT = read('components/customer/modals/ContactEditModal.tsx')
const FIELDS = read('components/customer/modals/ContactFields.tsx')
const CRUD = read('hooks/customer/useContactCrud.ts')
const ROUTE = read('app/api/customer-change/route.ts')
const CARD_ROUTE = read('app/api/business-card/route.ts')
const SQL_PATH = 'db/contacts_fields_20261125.sql'

console.log('── ① 방식 고르기 ──')
ok('방식을 먼저 묻는다', /useState<'pick' \| 'form'>\('pick'\)/.test(ADD))
ok('방식은 둘뿐이다 — 사진으로 읽기 / 직접 입력',
  ADD.includes('사진으로 읽기') && ADD.includes('직접 입력')
  && !ADD.includes('사진 촬영') && !ADD.includes('여러 장 등록'))
ok('명함 탭과 같은 틀(큰 버튼)', ADD.includes('bigPickButton') && ADD.includes('bigPickHead'))
ok('아이콘은 이모지가 아니라 인라인 SVG',
  /<svg /.test(read('components/customer/modals/pickStyle.tsx'))
  && !/[\u{1F300}-\u{1FAFF}\u{2700}-\u{27BF}\u{2600}-\u{26FF}]/u.test(ADD),
  '이모지가 남아 있다')

console.log('\n── ② 칸 아홉 개 ──')
eq('칸 수', C.CONTACT_FIELDS.length, 9)
eq('차례', C.CONTACT_FIELDS, [
  'name', 'name_en', 'position', 'department', 'mobile', 'phone', 'fax', 'email', 'memo',
])
ok('회사·주소·홈페이지는 없다 — 사업장 것이다',
  !C.CONTACT_FIELDS.includes('company') && !C.CONTACT_FIELDS.includes('address')
  && !C.CONTACT_FIELDS.includes('website'))
ok('아홉 칸 모두 이름이 있다', C.CONTACT_FIELDS.every(f => (C.CONTACT_LABEL[f] ?? '').length > 0))
ok('칸은 명함에도 다 있는 이름이다', C.CONTACT_FIELDS.every(f => B.CARD_FIELDS.includes(f)))
eq('폰 키패드', C.CONTACT_INPUT_TYPE.mobile, 'tel')
ok('두 창이 **같은 칸 한 벌**을 쓴다',
  ADD.includes('<ContactFields') && EDIT.includes('<ContactFields'))
ok('칸을 그리는 곳은 한 곳이다', FIELDS.includes("one('name')") && FIELDS.includes("one('memo', true)"))

console.log('\n── 없는 칸은 SQL 로 더한다 ──')
ok('SQL 파일이 있다', has(SQL_PATH))
eq('새 칸 넷', C.CONTACT_NEW_FIELDS, ['name_en', 'mobile', 'fax', 'memo'])
ok('SQL 이 그 넷을 더한다', (() => {
  const sql = read(SQL_PATH)
  return C.CONTACT_NEW_FIELDS.every(f => new RegExp(`add column if not exists ${f}`, 'i').test(sql))
})())
ok('라우트가 없는 칸을 빼고 담는다', ROUTE.includes('dropMissingContactColumns'))
ok('없는 칸은 42703 으로 알아낸다', /42703/.test(ROUTE))

console.log('\n── ③ 필수 다섯 ──')
eq('필수 칸', C.REQUIRED_CONTACT_FIELDS, ['name', 'position', 'department', 'mobile', 'email'])
const EMPTY = {}
eq('빈 칸은 빨강', C.borderKind(EMPTY, 'name'), 'required')
eq('차면 파랑', C.borderKind({ name: '홍길동' }, 'name'), 'ok')
eq('공백만 적은 것은 빈 것이다', C.borderKind({ name: '   ' }, 'name'), 'required')
eq('필수가 아닌 칸은 보통', C.borderKind({}, 'fax'), 'normal')
ok('휴대폰은 전화로 대신할 수 있다',
  C.isRequiredMet({ phone: '02-000-0000' }, 'mobile') && C.borderKind({ phone: '02-1' }, 'mobile') === 'ok')
ok('둘 다 없으면 못 넘긴다', !C.isRequiredMet({}, 'mobile'))
ok('화면이 빨강·파랑을 그 규칙으로 고른다',
  FIELDS.includes('borderKind(values, f)') && FIELDS.includes("kind === 'required'")
  && FIELDS.includes('BLUE_BORDER'))
eq('빈 필수 칸의 빨강', /const REQUIRED_BORDER = '(#[0-9a-f]{6})'/.exec(FIELDS)?.[1], '#ef4444')
ok('라벨 옆에 별표', C.REQUIRED_MARK === '*' && FIELDS.includes('REQUIRED_MARK'))
ok('필수 칸에만 별표', FIELDS.includes('REQUIRED_CONTACT_FIELDS.includes(f)'))

console.log('\n── ④ 다 차기 전에는 저장할 수 없다 ──')
ok('빈 폼은 저장 금지', !C.canSaveContact({}))
eq('남은 수를 적는다', C.missingLabel({}), '필수 5개 남음')
eq('하나 남으면', C.missingLabel({ name: '홍', position: '과장', department: '영업', mobile: '010' }), '필수 1개 남음')
const FULL = { name: '홍', position: '과장', department: '영업', mobile: '010-0000-0000', email: 'a@b.c' }
ok('다 차면 저장할 수 있다', C.canSaveContact(FULL))
eq('다 차면 글자가 없다', C.missingLabel(FULL), '')
ok('전화만으로도 다 찬 것이다',
  C.canSaveContact({ name: '홍', position: '과장', department: '영업', phone: '02-1', email: 'a@b.c' }))
ok('추가 창의 단추가 그 규칙으로 막힌다',
  ADD.includes('!canSaveContact(form)') && ADD.includes('disabled={blocked || isSaving}')
  && ADD.includes("{isSaving ? '저장 중...' : (left || '저장')}"))
ok('수정 창도 같다',
  EDIT.includes('!canSaveContact(form)') && EDIT.includes('disabled={blocked || isSaving}'))

console.log('\n── ⑤ 명함첩에도 담기 ──')
eq('묻는 말', C.COPY_TO_CARDS_TITLE, '명함첩에도 등록할까요?')
ok('저장한 뒤에 묻는다', CRUD.includes('COPY_TO_CARDS_TITLE') && CRUD.includes('confirmDialog({'))
ok('alert·confirm 은 쓰지 않는다', !/\balert\(|\bwindow\.confirm\(/.test(CRUD))
ok('예라고 해야 담는다', /if \(yes\) \{/.test(CRUD))
eq('방식 꼬리표', C.CONTACT_INPUT_METHOD, 'contact')
ok('표의 방식 목록에 있다', B.INPUT_METHODS.includes('contact') && B.METHOD_LABEL.contact.length > 0)
ok('SQL 이 CHECK 에 넣는다', /'contact'/.test(read(SQL_PATH)))
ok('CHECK 전에도 담긴다 — manual 로 떨어뜨린다', /23514/.test(CARD_ROUTE))
const PATCH = C.cardPatchFromContact(FULL, { company: '가나정밀', address: '서울' })
eq('사람 쪽 값은 그대로', PATCH.name, '홍')
eq('회사는 사업장 것', PATCH.company, '가나정밀')
eq('주소도 사업장 것', PATCH.address, '서울')
ok('빈 칸은 보내지 않는다', !('fax' in PATCH) && !('memo' in PATCH))
ok('연결 키는 두지 않는다 — 복사일 뿐이다',
  !('contact_id' in PATCH) && !('customer_id' in PATCH) && !/contact_id/.test(CRUD.split('copyToCards')[1] ?? ''))

console.log('\n── ⑥ 사진은 남지 않는다 ──')
ok('명함과 같은 길로 읽는다', ADD.includes("from '@/components/cards/useCardOcr'"))
ok('줄여서 한 번 보낸다', read('components/cards/useCardOcr.ts').includes('MAX_EDGE'))
ok('올리는 자리도 저장하는 자리도 없다',
  !/storage\.from|\.upload\(/.test(ADD) && !/storage\.from|\.upload\(/.test(read('app/api/cards/ocr/route.ts')))
ok('사람이 적은 칸은 덮지 않는다', ADD.includes("next[f].trim() === ''"))
ok('읽은 칸임을 알려 준다', ADD.includes('OCR_NOTICE'))
ok('못 읽어도 직접 입력으로 이어진다', ADD.includes("ocr.phase === 'error'"))

console.log('\n── ⑦ 수정 창도 같다 ──')
ok('수정 창이 아홉 칸을 담아 연다', EDIT.includes('for (const f of CONTACT_FIELDS)'))
ok('삭제 단추는 권한이 있을 때만', EDIT.includes('{onDelete && ('))
ok('고친 것이 있으면 닫기 전에 묻는다', EDIT.includes('confirmClose dirty={dirty}'))
ok('라우트가 수정에도 같은 칸을 받는다',
  ROUTE.includes("action === 'contact-edit'") || ROUTE.includes("'contact-edit'"))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
