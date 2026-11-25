// **명함 여러 장 등록** — 라우트·확인일·중복·브라우저 전용 (2026-11-24).
//
//   node scripts/card-bulk-check.js
//
// 지키는 약속
//   ① 한 요청에 **세 개까지**. 묶음은 동시에 읽고(Promise.all), 바로 담는다.
//   ② 일괄로 담은 줄은 input_method 'bulk' · **확인일을 비운다**(= 확인 전).
//   ③ 한 장씩 담은 줄은 **확인일을 등록일로 채운다**.
//   ④ 중복은 휴대폰 **또는** 이메일이 살아 있는 줄과 같을 때. 담지 않고 기존 id 를 준다.
//   ⑤ pdf-lib 는 **브라우저에서만** 쓴다 — 서버 코드(app/api·lib 의 서버 모듈)에 없다.
//   ⑥ PDF 를 읽을 수 있다(모델에 document 블록으로 넘긴다). 단건 안내 문구도 PDF 를 말한다.
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

const B = load(path.join(ROOT, 'lib/businessCardBulk.ts'))
const C = load(path.join(ROOT, 'lib/businessCard.ts'))
const Q = load(path.join(ROOT, 'lib/businessCardQuery.ts'))

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

const BULK_PATH = 'app/api/cards/ocr-bulk/route.ts'
const ONE_PATH = 'app/api/business-card/route.ts'
const OCR_PATH = 'app/api/cards/ocr/route.ts'

console.log('\n── ① 한 요청에 세 개 ──')
ok('라우트가 있다', has(BULK_PATH))
const R = has(BULK_PATH) ? read(BULK_PATH) : ''
ok('POST 다', /export async function POST\(/.test(R))
ok('로그인한 사람만', /loadCaller\(\{ kind: 'login' \}/.test(R))
eq('한 묶음 = 3', B.MAX_PER_REQUEST, 3)
ok('넘으면 받지 않는다', /files\.length > MAX_PER_REQUEST/.test(R) && /'too_many'/.test(R))
ok('셋을 동시에 읽는다', /Promise\.all\(files\.map\(f => readCard\(f, key\)\)\)/.test(R))
eq('세 개씩 끊는다', B.chunk([1, 2, 3, 4, 5, 6, 7]).map(g => g.length), [3, 3, 1])
eq('빈 목록', B.chunk([]), [])

console.log('\n── ② 일괄로 담은 줄 = 확인 전 ──')
ok('방식은 bulk', /const INPUT_METHOD = BULK_METHOD/.test(R))
eq('그 값이 bulk', B.BULK_METHOD, 'bulk')
ok('표가 bulk 를 받아들이게 SQL 이 있다', has('db/business_cards_bulk_20261124.sql'))
const SQL = has('db/business_cards_bulk_20261124.sql') ? read('db/business_cards_bulk_20261124.sql') : ''
ok('CHECK 에 bulk 를 더한다',
  /check \(input_method in \('camera', 'upload', 'manual', 'bulk'\)\)/.test(SQL))
ok('빈 확인일을 등록일로 채운다(bulk 는 빼고)',
  /set verified_at = registered_at/.test(SQL) && /input_method is distinct from 'bulk'/.test(SQL))
ok('스키마를 깨운다', /notify pgrst, 'reload schema'/.test(SQL))
// 이 파일은 아직 돌리지 않았다(아래 묶음 SQL·초안 SQL 은 2026-11-25 에 적용됐다).
ok('APPLIED.md 에 미적용으로 적었다',
  /business_cards_bulk_20261124\.sql[^|]*\|\s*\*\*미적용\*\*/.test(read('db/APPLIED.md')))

console.log('\n── ③ 「마지막 확인」은 걷었다 ──')
const ONE = read(ONE_PATH)
// 2026-11-25 — 쓰는 사람이 없었고 한 장씩 담으면 등록일과 늘 같은 값이었다.
ok('한 장씩 담는 라우트에 확인일이 없다', !/verified_at/.test(ONE))
ok('여러 장 담는 라우트에도 없다', !/verified_at/.test(R))
ok('지우는 SQL 이 있다', has('db/business_cards_drop_verified_20261125.sql'))
// 2026-11-25: 담당자에서 복사해 담는 길이 생겨 'contact' 가 더해졌다(고객사 담당자 등록).
eq('방식 다섯', [...C.INPUT_METHODS], ['camera', 'upload', 'manual', 'bulk', 'contact'])
eq('이름', C.METHOD_LABEL.bulk, '여러 장 등록')

console.log('\n── ④ 중복과 빈 줄 ──')
ok('살아 있는 줄만 본다', /\.is\('deleted_at', null\)/.test(R))
ok('같은 사람인지 한 함수가 가른다', /findPerson\(actives, row\)/.test(R) && /samePerson/.test(R))
ok('중복이면 담지 않고 기존 id 를 준다', /reason: 'dup', card_id: hit\.card_id/.test(R))
// 검토 대기 칸이 아직 없는 DB 에서도 **방금 내가 담은 줄**에는 합친다(쪼개지 않는다).
ok('같은 묶음 안의 같은 사람도 잡는다',
  /batchDrafts\.push\(\{ card_id: cardId/.test(R) && !/actives\.push/.test(R))
ok('이름·회사 둘 다 없으면 담지 않는다', /if \(!row\.name && !row\.company\)[\s\S]{0,80}'empty'/.test(R))
eq('집계', B.addLines(B.EMPTY_TALLY, [
  { index: 0, ok: true, card_id: 1 },
  { index: 1, ok: false, reason: 'dup', card_id: 1 },
  { index: 2, ok: false, reason: 'parse' },
]), { done: 3, saved: 1, dup: 1, failed: 1, merged: 0, noPerson: 0, empty: 0, flipped: 0 })
eq('요약 글자', B.summaryLabel({ done: 3, saved: 1, dup: 1, failed: 1, merged: 0, noPerson: 0 }), '등록 1 · 중복 1 · 실패 1')
eq('진행 글자', B.progressLabel(137, 300), '137 / 300')
eq('진행률', [B.progressPercent(137, 300), B.progressPercent(0, 0), B.progressPercent(9, 3)], [46, 0, 100])
ok('중단 물음이 **담긴 것은 남는다**를 먼저 적는다', B.stopQuestion(12).startsWith('지금까지 읽힌 12건은 저장되어 있습니다'))

console.log('\n── ⑤ pdf-lib 는 브라우저에서만 ──')
ok('패키지가 있다', /"pdf-lib"/.test(read('package.json')))
const SERVER_DIRS = ['app/api', 'lib']
const serverHits = []
const walk = (d) => {
  for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
    const rel = `${d}/${e.name}`
    if (e.isDirectory()) { walk(rel); continue }
    if (!/\.(ts|tsx)$/.test(e.name)) continue
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
    const code = src.split(/\r?\n/).filter(l => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n')
    if (/['"]pdf-lib['"]/.test(code)) serverHits.push(rel)
  }
}
for (const d of SERVER_DIRS) walk(d)
eq('서버 코드에서 쓰는 자리', serverHits, [])
const MODAL = 'components/cards/BulkImportModal.tsx'
const M = read(MODAL)
ok('화면은 누를 때 불러온다', /await import\('pdf-lib'\)/.test(read(MODAL)))
ok('그 화면은 브라우저 전용이다', read(MODAL).startsWith("'use client'"))
ok('브라우저 confirm 을 쓰지 않는다', !/window\.confirm|\balert\(/.test(read(MODAL)))

console.log('\n── ⑥ PDF 를 읽는다 ──')
const OCR = read('lib/cardOcrServer.ts')
ok('PDF 는 document 블록으로', /type: 'document'[\s\S]{0,60}media_type: PDF/.test(OCR))
ok('사진은 그대로 image 블록', /type: 'image'[\s\S]{0,80}media_type: MEDIA/.test(OCR))
ok('받는 형식을 한 곳에서 가른다', /export function kindOf/.test(OCR))
ok('한 장 라우트도 같은 길을 쓴다', /readCard\(/.test(read(OCR_PATH)))
ok('단건 파일 고르기가 PDF 를 받는다',
  /accept="image\/\*,application\/pdf"/.test(read('components/cards/CardFormModal.tsx')))
ok('단건 안내 문구가 PDF 를 말한다',
  /읽을 수 없는 형식입니다 — 사진\(jpg·png\)이나 PDF 로 올려 주세요/.test(read('components/cards/useCardOcr.ts')))
ok('PDF 는 줄이지 않는다', /file\.type === 'application\/pdf'\) return file/.test(read('components/cards/useCardOcr.ts')))

// ── 쪽 순서 처리 — 2026-11-24. 실제 스캐너 PDF 35쪽에서 21건 중 5건이 쓰레기였다 ──
console.log('\n── ⑧ 뒷면·사람 없는 면 ──')
// 읽는 규칙은 위에서 이미 읽어 두었다(const OCR).
ok('지시문이 is_back_side 를 받는다', /"is_back_side": false/.test(OCR))
ok('뒷면이 무엇인지 적어 두었다', /로고·슬로건·본사 주소·계좌번호·예금주/.test(OCR))
ok('계좌·사업자번호는 어느 칸에도 넣지 않는다', /계좌번호·사업자등록번호·법인번호는 \*\*어떤 칸에도 넣지 않는다\*\*/.test(OCR))
ok('이름 칸은 사람 이름만', /name 은 \*\*사람 이름만\*\* 넣는다/.test(OCR))
// 2026-11-25 3차 — 「한글 이름을 name 에」가 아니라 **인쇄된 주 표기**를 name 에 넣는다.
ok('주 표기를 본칸에, 로마자는 따로 있을 때만',
  /name · company · department · position = \*\*그 면에 인쇄된 주 표기\*\* 그대로/.test(OCR)
  && /\*\*같은 면에 로마자 표기가 따로 있을 때만\*\* 채운다/.test(OCR))
ok('현지 문자 우선이라는 말이 없다', !/현지 문자 우선/.test(OCR))
ok('한 쪽에 앞뒤가 같이 있으면 한 장', /한 쪽에 앞뒤가 같이 찍혔으면\(돌아가 있어도\) 둘을 합쳐/.test(OCR))
ok('읽은 값에서 뒷면 깃발을 꺼낸다', /export function backSideFromJson/.test(read('lib/businessCardOcr.ts')))
ok('모르면 뒷면이 아니라고 본다(명함을 잃지 않는 쪽)',
  /return String\(v \?\? ''\)\.trim\(\)\.toLowerCase\(\) === 'true'/.test(read('lib/businessCardOcr.ts')))

const HIM = { name: '홍길동', company: '가나정밀', mobile: '010-1111-2222' }
eq('뒷면이면 연락처 없는 면', B.isNoPerson({ ...HIM, company: '가나' }, true), true)
eq('이름이 없으면 연락처 없는 면', B.isNoPerson({ name: '', company: '가나정밀' }, false), true)
eq('이름이 회사명과 같으면 연락처 없는 면',
  [B.isNoPerson({ name: '㈜가나정밀', company: '(주) 가나정밀', mobile: '010-1' }, false),
    B.isNoPerson({ name: '가나정밀', company: '가나정밀', mobile: '010-1' }, false)], [true, true])
eq('이름 + 휴대폰이면 아니다', B.isNoPerson(HIM, false), false)
eq('이름 + 이메일만이어도 아니다',
  B.isNoPerson({ name: '홍길동', company: '가나정밀', email: 'a@b.c' }, false), false)
// 2026-11-25 3차 — 열쇠(휴대폰·이메일)가 없는 면은 같은 사람을 가려낼 길이 없다.
// 사무실 전화만 있는 면은 **앞 draft 의 다른 면**으로 보고 회사명으로 붙인다.
eq('휴대폰·이메일이 둘 다 없으면 연락처 없는 면',
  B.isNoPerson({ name: '山田太郎', company: '株式会社テスト精密', phone: '+81-42-000-1111' }, false), true)
eq('열쇠가 있나', [
  B.hasPersonKey({ mobile: '010-1' }), B.hasPersonKey({ email: 'a@b.c' }),
  B.hasPersonKey({ phone: '031-1' }), B.hasPersonKey({}),
], [true, true, false, false])

// 연락처 없는 면을 **바로 앞 draft 에 붙일 수 있나** — 2026-11-25 3차부터 **회사명만** 본다.
const prevCo = { company: '주식회사 다라상사', company_en: null }
// 글자가 겹치지 않으면 붙이지 않는다 — 번역 관계인지는 보지 않는다(2차의 잘못을 되풀이하지 않게).
eq('한글 회사명 ↔ 로마자 회사명은 글자가 겹치지 않으면 남의 면',
  B.canMergeBack(prevCo, { company: 'DARA TRADING' }), false)
eq('영문 회사명이 앞 명함의 영문 칸과 겹치면 붙인다',
  B.canMergeBack({ company: '다라', company_en: 'DARA TRADING' }, { company: 'DARA TRADING' }), true)
eq('회사가 다르면 남의 면이다',
  B.canMergeBack(prevCo, { company: '마바부동산 공인중개사사무소' }), false)
eq('회사명이 겹치면 붙인다', B.canMergeBack(prevCo, { company: '다라상사' }), true)
eq('㈜ 표기 차이는 같은 회사로 본다',
  B.canMergeBack({ company: '㈜가나정밀' }, { company: '(주) 가나정밀' }), true)
eq('회사명조차 없는 면은 앞 명함의 면으로 본다', B.canMergeBack(prevCo, { company: '' }), true)
eq('이쪽 영문 회사명으로도 견준다',
  B.canMergeBack({ company: 'ACME KOREA Co., Ltd.' }, { company: null, company_en: 'ACME KOREA' }), true)
ok('라우트가 그 판정을 지난다', /canMergeBack\(prevRow/.test(R))

console.log('\n── ⑨ 글자 순위 — 한글 > 한자·가나 > 로마자 ──')
eq('한글이 섞였나', [B.hasHangul('홍길동'), B.hasHangul('Hong'), B.hasHangul('')], [true, false, false])
eq('로마자뿐인가', [B.isRomanOnly('Hong Gil-dong'), B.isRomanOnly('홍길동'), B.isRomanOnly('010-1')], [true, false, false])
eq('순위', [
  B.scriptRank('홍길동'), B.scriptRank('山田太郎'), B.scriptRank('やまだ'),
  B.scriptRank('Taro Yamada'), B.scriptRank(''), B.scriptRank(null),
], [3, 2, 2, 1, 0, 0])
eq('한글 > 로마자 — 밀려난 로마자는 영문 칸으로',
  B.priorityPatch({ name: 'John Kim', name_en: '', company: 'ACME KOREA Co., Ltd.', company_en: '', position: 'Manager' },
    { name: '김존', company: '에이씨엠이코리아', position: '과장' }),
  {
    patch: {
      name: '김존', name_en: 'John Kim',
      company: '에이씨엠이코리아', company_en: 'ACME KOREA Co., Ltd.',
      position: '과장',
    },
    replaced: [
      { field: 'name', from: 'John Kim', to: '김존' },
      { field: 'company', from: 'ACME KOREA Co., Ltd.', to: '에이씨엠이코리아' },
      { field: 'position', from: 'Manager', to: '과장' },
    ],
  })
eq('한자 > 로마자 — 이번 면이 로마자면 그 값이 영문 칸으로',
  B.priorityPatch({ name: '山田太郎', name_en: '', company: '株式会社テスト精密', company_en: '' },
    { name: 'Taro Yamada', company: 'TEST SEIMITSU' }),
  { patch: { name_en: 'Taro Yamada', company_en: 'TEST SEIMITSU' }, replaced: [] })
eq('한글 > 한자 — 한글면이 이긴다',
  B.priorityPatch({ name: '山田太郎', name_en: '' }, { name: '야마다타로' }),
  { patch: { name: '야마다타로' }, replaced: [{ field: 'name', from: '山田太郎', to: '야마다타로' }] })
eq('영문 칸이 이미 차 있으면 덮지 않는다',
  B.priorityPatch({ name: 'Hong', name_en: 'Gil-dong Hong', company: 'GANA', company_en: 'GANA PRECISION' },
    { name: '홍길동', company: '가나정밀' }),
  {
    patch: { name: '홍길동', company: '가나정밀' },
    replaced: [
      { field: 'name', from: 'Hong', to: '홍길동' },
      { field: 'company', from: 'GANA', to: '가나정밀' },
    ],
  })
eq('빈 칸은 순위를 다투지 않고 그냥 채운다',
  B.priorityPatch({ name: '', department: null }, { name: 'John Kim', department: 'Sales' }),
  { patch: { name: 'John Kim', department: 'Sales' }, replaced: [] })
eq('같은 순위끼리는 들고 있던 값을 지킨다',
  B.priorityPatch({ name: '홍길동', name_en: '' }, { name: '홍길동2' }), { patch: {}, replaced: [] })
eq('부서·직급에는 영문 칸이 없다 — 교체만 한다',
  B.priorityPatch({ department: 'Quality', position: 'Auditor' }, { department: '품질팀', position: '심사역' }),
  {
    patch: { department: '품질팀', position: '심사역' },
    replaced: [
      { field: 'department', from: 'Quality', to: '품질팀' },
      { field: 'position', from: 'Auditor', to: '심사역' },
    ],
  })
eq('빈 칸만 채운다',
  B.fillBlanks({ name: '홍길동', company: '', fax: null }, { name: '다른이름', company: '가나정밀', fax: '031-1' },
    ['name', 'company', 'fax']),
  { company: '가나정밀', fax: '031-1' })

console.log('\n── ⑩ 쪽 순서를 라우트가 지킨다 ──')
ok('직전 명함을 받는다', /form\.get\('prev_card_id'\)/.test(R))
ok('다음 요청에 넘겨준다', /last_card_id: prevId/.test(R))
ok('ⓐ 연락처 없는 면', /if \(isNoPerson\(row, got\.back\)\)/.test(R))
ok('ⓐ 앞 draft 와 회사가 겹치지 않으면 no_person', /reason: 'no_person'/.test(R))
ok('ⓑ 같은 묶음의 draft 와 같은 사람이면 그 줄에 합친다',
  /const draftHit = findPerson\(batchDrafts, row\)/.test(R)
  && /reason: 'merged',\s*\n?\s*card_id: draftHit\.card_id/.test(R))
ok('ⓑ 합쳐 들어간 줄이 **바로 앞 draft** 가 된다',
  /prevId = draftHit\.card_id/.test(R))
ok('ⓒ 등록된 명함과 같은 사람이면 중복 — 빈 칸만 채운다',
  /reason: 'dup'/.test(R) && /mergeInto\(hit\.card_id, old as Record<string, unknown>, row, \{ priority: false \}\)/.test(R))
ok('ⓓ 담은 쪽이 다음 쪽의 바로 앞 draft 가 된다', /prevId = cardId/.test(R))
ok('합치기는 빈 칸 채우기 + 글자 순위',
  R.includes('fillBlanks(targetRow, row, WRITE_FIELDS)') && R.includes('priorityPatch(targetRow, row)'))
ok('바뀐 것이 없으면 쓰지 않는다', /if \(Object\.keys\(patch\)\.length === 0\) return targetRow/.test(R))
eq('사건 이름 둘', [B.EVENT_MERGED, B.EVENT_HANGUL], ['card_merged_back', 'card_hangul_fixed'])
ok('그 이름으로 사건을 남긴다', /EVENT_MERGED/.test(R) && /EVENT_HANGUL/.test(R))
ok('교체 전 값을 card_merged_back 에 남긴다',
  /logEvent\(target, EVENT_MERGED, \{ filled: Object\.keys\(fill\), replaced \}\)/.test(R))
ok('화면은 앞 응답을 받은 뒤 다음 요청을 보낸다',
  M.includes('let prevCardId: number | null = null')
  && M.includes("body.append('prev_card_id', String(at.prevId))"))

console.log('\n── ⑪ 집계와 읽기 비용 ──')
eq('집계에 뒷면·사람없음이 든다', B.addLines(B.EMPTY_TALLY, [
  { index: 0, ok: true, card_id: 1 },
  { index: 1, ok: false, reason: 'merged', card_id: 1, merged_into: 1 },
  { index: 2, ok: false, reason: 'no_person' },
  { index: 3, ok: false, reason: 'dup', card_id: 1 },
  { index: 4, ok: false, reason: 'parse' },
]), { done: 5, saved: 1, dup: 1, failed: 1, merged: 1, noPerson: 1, empty: 0, flipped: 0 })
eq('요약 글자', B.summaryLabel({ done: 5, saved: 1, dup: 1, failed: 1, merged: 1, noPerson: 1 }),
  '등록 1 · 중복 1 · 뒷면 합침 1 · 사람 이름 없음 1 · 실패 1')
eq('0인 항목은 적지 않는다', B.summaryLabel({ done: 1, saved: 1, dup: 0, failed: 0, merged: 0, noPerson: 0 }),
  '등록 1 · 중복 0 · 실패 0')
eq('환산 상수는 입력·출력 따로', Object.keys(B.WON_PER_MTOK).sort(), ['input', 'output'])
eq('비용', B.costWon({ input: 1_000_000, output: 1_000_000 }), B.WON_PER_MTOK.input + B.WON_PER_MTOK.output)
eq('35쪽쯤의 비용', B.costWon({ input: 45_000, output: 5_000 }), 10)
ok('마지막 줄에 적는다', /읽기 비용 약 /.test(B.costLabel({ input: 1000, output: 100 })))
ok('화면이 그 줄을 쓴다', /costLabel\(usage\)/.test(read(MODAL)))
ok('쪽마다 토큰을 남긴다', /\[\$\{TAG\}\] page`, \{ index: i, input: usage\.input, output: usage\.output \}/.test(R))
ok('건별 토큰을 응답에 담는다', R.includes('lines.push({ index: i, ok: true, card_id: cardId, usage, page })'))

console.log('\n── ⑫ 실제 명함 PDF 는 저장소에 들이지 않는다 ──')
const GI = read('.gitignore')
ok('이름에 「명함」이 든 PDF 를 막는다', /명함.*\.pdf/.test(GI))
eq('저장소에 들어온 명함 PDF', (() => {
  const hits = []
  const seek = (d) => {
    for (const e of fs.readdirSync(path.join(ROOT, d || '.'), { withFileTypes: true })) {
      const rel = d ? `${d}/${e.name}` : e.name
      if (e.isDirectory()) { if (!['node_modules', '.next', '.next-perf', '.git'].includes(e.name)) seek(rel); continue }
      if (/명함.*\.pdf$/i.test(e.name)) hits.push(rel)
    }
  }
  seek('')
  return hits
})(), [])

// ── 2026-11-25 ──
console.log('\n── ⑬ 가져오기 묶음 ──')
ok('SQL 파일이 있다', has('db/business_cards_batch_20261125.sql'))
const BSQL = has('db/business_cards_batch_20261125.sql') ? read('db/business_cards_batch_20261125.sql') : ''
ok('묶음 칸과 인덱스를 더한다',
  /add column if not exists import_batch_id uuid/.test(BSQL)
  && /create index if not exists business_cards_import_batch_idx/.test(BSQL))
ok('스키마를 깨운다', /notify pgrst, 'reload schema'/.test(BSQL))
ok('APPLIED.md 에 적용한 날을 적었다',
  /business_cards_batch_20261125\.sql[^|]*\|\s*2026-\d\d-\d\d/.test(read('db/APPLIED.md')))
ok('사건 FK 를 건드리지 않은 까닭을 적었다', /on delete cascade/.test(BSQL))

ok('화면이 묶음 id 를 만든다', /newBatchId\(\)/.test(M))
ok('매 요청에 보낸다', /body\.append\('import_batch_id', batchId\.current\)/.test(M))
ok('라우트가 **새로 담는 줄에만** 적는다',
  /\.\.\.\(batchId \? \{ import_batch_id: batchId \} : \{\}\)/.test(R)
  && !/import_batch_id/.test(R.split('mergeInto')[1]?.split('// 담기는')[0] ?? ''))
ok('칸이 없으면 빼고 담는다', /hasBatchColumn/.test(R))
ok('받은 묶음 id 를 믿기 전에 꼴을 본다', /isBatchId\(rawBatch\)/.test(R))
eq('uuid 꼴만 받는다',
  ['11111111-2222-4333-8444-555555555555', '아무거나', ''].map(v => B.isBatchId(v)),
  [true, false, false])
eq('만들면 uuid 꼴', B.isBatchId(B.newBatchId()), true)
eq('두 번 만들면 다르다', B.newBatchId() === B.newBatchId(), false)
ok('되돌리기 물음이 **무엇이 남는지** 적는다',
  B.undoQuestion(12) === '이번에 새로 담긴 12건을 삭제합니다. 합쳐진 뒷면·기존 명함은 그대로입니다.')

console.log('\n── ⑭ 지우기 라우트 ──')
const DEL_PATH = 'app/api/cards/delete/route.ts'
ok('라우트가 있다', has(DEL_PATH))
const D = has(DEL_PATH) ? read(DEL_PATH) : ''
ok('POST · 로그인 필수', /export async function POST\(/.test(D) && /loadCaller\(\{ kind: 'login' \}/.test(D))
ok('card_id 배열을 받는다', /body\.card_ids/.test(D))
ok('고른 줄은 **소프트** 삭제', /update\(\{ deleted_at: now \}\)\.in\('card_id', ids\)/.test(D))
ok("사건 'card_deleted' 를 남긴다", /event_type: EVENT_DELETED/.test(D) && B.EVENT_DELETED === 'card_deleted')
ok('묶음 되돌리기는 진짜 지운다', /action === 'batch'/.test(D) && /\.delete\(\)\.in\('card_id', ids\)/.test(D))
ok('묶음은 그 묶음 줄만 본다', /\.eq\('import_batch_id', batchId\)/.test(D))
ok('화면이 보낸 목록을 믿지 않는다 — 다시 읽어 판정한다',
  /\.select\('card_id, name, engineer_id'\)/.test(D) && /canDeleteCard\(caller, r\)/.test(D))
ok('묶음 칸이 없으면 무엇을 돌려야 하는지 말한다',
  /42703/.test(D) && /business_cards_batch_20261125\.sql/.test(D))

console.log('\n── ⑮ 누가 지울 수 있나 ──')
const me = (level, id) => ({ engineer_id: id, permission_level: level })
eq('본인이 등록한 줄은 누구나',
  B.canDeleteCard(me('member', 7), { engineer_id: 7 }), true)
eq('남의 줄은 member 가 못 지운다',
  B.canDeleteCard(me('member', 7), { engineer_id: 8 }), false)
eq('admin 이상은 전체',
  [B.canDeleteCard(me('admin', 7), { engineer_id: 8 }),
    B.canDeleteCard(me('superadmin', 7), { engineer_id: 8 })], [true, true])
eq('등록자가 비면 남의 줄이다', B.canDeleteCard(me('member', 7), { engineer_id: null }), false)
eq('사람이 없으면 거짓', B.canDeleteCard(null, { engineer_id: 7 }), false)
eq('제외 안내', [B.skippedNotice(3), B.skippedNotice(0)], ['권한 없는 3건은 제외됩니다', ''])
eq('선택 띠 글자', B.selectionTitle(5), '5건 선택')

console.log('\n── ⑯ 뒤집어 다시 읽기 ──')
// 2026-11-25 — 조건을 좁혔다. 「사람 이름 없음·빈 면」이면 무조건 돌리던 것을
// **모델이 거꾸로라고 한 쪽만** 돌리는 것으로 바꿨다(토큰만 두 배로 쓰던 자리다).
eq('거꾸로라고 한 쪽만 다시 읽는다', [
  B.worthRetry({ ok: false, reason: 'no_person', upside_down: true }),
  B.worthRetry({ ok: false, reason: 'empty', upside_down: true }),
  B.worthRetry({ ok: false, reason: 'no_person' }),
  B.worthRetry({ ok: false, reason: 'empty', upside_down: false }),
  B.worthRetry({ ok: true }),
], [true, true, false, false, false])
ok('지시문이 text_upside_down 을 받는다', /"text_upside_down": false/.test(OCR))
ok('뒷면·빈 면이라서 못 읽은 것은 거짓이라고 적었다',
  /뒷면이라서·빈 면이라서 못 읽은 것은 \*\*false\*\* 다/.test(OCR))
ok('읽은 값에서 그 깃발을 꺼낸다', /export function upsideDownFromJson/.test(read('lib/businessCardOcr.ts')))
ok('라우트가 쪽마다 그 깃발을 돌려준다', /upside_down: got\.upsideDown/.test(R))
ok('화면이 그 쪽만 돌린다', M.includes('if (!worthRetry(got[k])) continue'))
ok('다시 읽는 요청임을 알린다', /body\.append\('retry', '1'\)/.test(M) && /const isRetry = String\(form\.get\('retry'\) \?\? ''\) === '1'/.test(R))
ok('다시 읽기에서는 이름+연락처가 없으면 담지 않는다',
  /if \(isRetry && !hasContact\(row\)\)/.test(R))
eq('이름 + 연락할 길 하나', [
  B.hasContact({ name: '홍길동', mobile: '010-1' }),
  B.hasContact({ name: '홍길동', email: 'a@b.c' }),
  B.hasContact({ name: '홍길동', phone: '031-1' }),
  B.hasContact({ name: '홍길동' }),
  B.hasContact({ mobile: '010-1' }),
], [true, true, true, false, false])
eq('돌려 읽은 결과를 받아들일 때', [
  B.acceptRetry({ ok: true }),
  B.acceptRetry({ ok: false, reason: 'dup' }),
  B.acceptRetry({ ok: false, reason: 'merged' }),
  B.acceptRetry({ ok: false, reason: 'no_person' }),
  B.acceptRetry({ ok: false, reason: 'empty' }),
], [true, true, true, false, false])
ok('화면이 그 판정을 쓴다', M.includes('if (!now || !acceptRetry(now)) continue'))

// ── 2026-11-25 ──
console.log('\n── ⑲ 쪽 번호 ──')
ok('쪽 번호를 받는다', R.includes("form.get('page_base')") && R.includes("form.get('prev_page')"))
// 2026-11-25 3차 — **쪽이 붙어 있는지는 보지 않는다**. 떨어진 쪽의 같은 사람도 합친다.
ok('붙은 쪽만 합치던 조건을 걷었다', !R.includes('page === prevPage + 1') && !/\badjacent\b/.test(R))
ok('떨어진 면도 합치거나 no_person 이다', !R.includes("'orphan_back'"))
ok('쪽 번호를 응답에 담는다', R.includes('usage, page }') || R.includes('usage, page,'))
ok('다음 요청에 쪽 번호를 넘긴다', R.includes('last_page: prevPage'))
ok('화면이 쪽을 세어 보낸다',
  M.includes("body.append('page_base', String(at.pageBase))")
  && M.includes("body.append('prev_page', String(at.prevPage))"))
ok('돌려 읽기도 **그 쪽 차례**에서 한다',
  M.includes('pageBase: page, prevId: cardByPage.get(page - 1) ?? null, prevPage: page - 1, retry: true'))
eq('떨어진 뒷면도 「사람 이름 없음」에 센다',
  B.addLines(B.EMPTY_TALLY, [{ index: 0, ok: false, reason: 'orphan_back' }]).noPerson, 1)
eq('까닭 글자', B.BULK_REASON_LABEL.orphan_back, '앞면과 떨어진 뒷면')

console.log('\n── ⑳ 같은 사람 판정 — 휴대폰, 없으면 이메일 ──')
// 2026-11-25 3차 — 2차의 「회사명이 다르면 분리」를 걷었다. 그 규칙이 한글면·영문면을
// 다른 회사로 보아 같은 사람을 두 장으로 쪼갰다(실제 20쪽에서 4쌍).
eq('회사명 비교는 사라졌다', [
  /sameCompany/.test(read('lib/businessCardBulk.ts')),
  /sameCompany/.test(R),
  /localScriptPatch/.test(read('lib/businessCardBulk.ts')),
  /localScriptPatch/.test(R),
], [false, false, false, false])
eq('휴대폰이 같으면 같은 사람', [
  B.samePerson({ mobile: '010-7777-0201' }, { mobile: '010-7777-0201' }),
  B.samePerson({ mobile: '01077770201' }, { mobile: '010-7777-0201' }),
  B.samePerson({ mobile: '010-7777-0201' }, { mobile: '010-7777-0202' }),
], [true, true, false])
eq('회사가 달라도 휴대폰이 같으면 같은 사람',
  B.samePerson({ mobile: '010-1', company: 'ACME KOREA Co., Ltd.' },
    { mobile: '010-1', company: '에이씨엠이코리아' }), true)
eq('휴대폰이 한쪽이라도 없으면 이메일로 본다', [
  B.samePerson({ email: 'taro@test.co.jp' }, { email: 'TARO@test.co.jp' }),
  B.samePerson({ mobile: '010-1', email: 'a@b.c' }, { email: 'a@b.c' }),
  B.samePerson({ email: 'a@b.c' }, { email: 'x@y.z' }),
], [true, true, false])
eq('휴대폰이 둘 다 있고 다르면 이메일이 같아도 다른 사람',
  B.samePerson({ mobile: '010-1', email: 'a@b.c' }, { mobile: '010-2', email: 'a@b.c' }), false)
eq('열쇠가 아예 없으면 같은 사람이 아니다',
  [B.samePerson({}, {}), B.samePerson({ phone: '031-1' }, { phone: '031-1' })], [false, false])

console.log('\n── ㉑ 현지 문자(한자·가나) ──')
eq('현지 문자인가', [
  B.hasLocalScript('홍길동'), B.hasLocalScript('山田'), B.hasLocalScript('やまだ'),
  B.hasLocalScript('ヤマダ'), B.hasLocalScript('Yamada'),
], [true, true, true, true, false])
eq('한자면이 로마자면을 밀어낸다',
  B.priorityPatch({ name: 'Taro Yamada', name_en: '', company: 'GANA SEIMITSU', company_en: '' },
    { name: '山田 太郎', company: '株式会社 ガナ精密' }).patch,
  { name: '山田 太郎', name_en: 'Taro Yamada', company: '株式会社 ガナ精密', company_en: 'GANA SEIMITSU' })
eq('가나면도 마찬가지',
  B.priorityPatch({ name: 'Taro', name_en: '', company: 'GANA', company_en: '' },
    { name: 'やまだ たろう', company: 'ガナ' }).patch,
  { name: 'やまだ たろう', name_en: 'Taro', company: 'ガナ', company_en: 'GANA' })
eq('한글이 한자보다 앞이다',
  B.priorityPatch({ name: '山田', name_en: '', company: 'ガナ', company_en: '' },
    { name: '야마다', company: '가나' }).patch,
  { name: '야마다', company: '가나' })

console.log('\n── ㉒ 읽기 지시문 ──')
ok('범위 번호는 앞 번호만', OCR.includes('**앞 번호만**') && OCR.includes('031-8059-5155~8'))
ok('이메일 앞부분을 빠뜨리지 않는다', OCR.includes('@ 앞부분을 **빠뜨리지 말고**'))
ok('이름을 비슷한 글자로 바꾸지 않는다', OCR.includes('**인쇄된 글자 그대로**'))
// 2026-11-25 3차 — 실제 20쪽에서 모델이 명함에 없는 한글을 만들어냈다.
ok('번역·음차 금지를 못 박았다', OCR.includes('**번역·음차·로마자화·한글화 금지**'))
ok('없는 글자를 만들지 말라고 적었다', OCR.includes('**없는 글자를 만들면 안 된다.**'))
ok('틀린 보기를 들어 두었다',
  OCR.includes('高橋秀明') && OCR.includes('ACCRETECH KOREA') && OCR.includes('JD Kim') && OCR.includes('Auditor'))
ok('직함도 번역하지 않는다', OCR.includes('직함(Manager·Auditor·CEO 등)도 **번역하지 않는다**'))
ok('일본 명함은 +81 을 붙이고 앞 0 을 뗀다',
  OCR.includes('042-642-0381 → +81-42-642-0381') && OCR.includes('**+81**'))
ok('한국 명함 번호는 그대로', OCR.includes('한국 명함의 번호는 그대로 둔다'))

console.log('\n── ⑯-2 국제번호 ──')
const O2 = load(path.join(ROOT, 'lib/businessCardOcr.ts'))
eq('+82 는 0 으로', O2.normalizePhone('+82-10-1234-5678'), '010-1234-5678')
eq('82- 도 0 으로', O2.normalizePhone('82-2-6124-6500'), '02-6124-6500')
eq('+81 은 그대로 둔다', O2.normalizePhone('+81-42-642-1701'), '+81-42-642-1701')
eq('+ 없이 온 81- 에는 + 를 붙인다', O2.normalizePhone('81-42-642-1701'), '+81-42-642-1701')
eq('우리 번호는 그대로', O2.normalizePhone('010-7777-0101'), '010-7777-0101')
eq('대표번호는 나라 번호가 아니다', O2.normalizePhone('1588-1234'), '1588-1234')
eq('0081 도 +81', O2.normalizePhone('0081-42-642-1701'), '+81-42-642-1701')
eq('TEL 꼬리표는 턴다', O2.normalizePhone('TEL. 81-42-642-1701'), '+81-42-642-1701')
ok('화면이 180° 돌린다', /async function flip\(/.test(M) && /setRotation\(degrees\(\(pg\.getRotation\(\)\.angle \+ 180\) % 360\)\)/.test(M))
ok('사진은 캔버스로 돌린다', /ctx\.rotate\(Math\.PI\)/.test(M))
ok('센다', /flipped: acc\.flipped \+ 1/.test(M))
ok('지시문에 직함을 회사명으로 쓰지 말라고 적었다',
  /「코디」·「담당」·「매니저」·「실장」 같은 직함은 \*\*회사명이 아니다\*\*/.test(OCR))

console.log('\n── ⑰ 빈 면 집계 ──')
eq('빈 면을 따로 센다', B.addLines(B.EMPTY_TALLY, [
  { index: 0, ok: false, reason: 'empty' },
  { index: 1, ok: false, reason: 'empty' },
  { index: 2, ok: false, reason: 'parse' },
]), { done: 3, saved: 0, dup: 0, failed: 1, merged: 0, noPerson: 0, empty: 2, flipped: 0 })
eq('요약에 적는다',
  B.summaryLabel({ done: 4, saved: 1, dup: 0, failed: 0, merged: 0, noPerson: 0, empty: 2, flipped: 1 }),
  '등록 1 · 중복 0 · 빈 면 2 · 뒤집어 다시 읽음 1 · 실패 0')

console.log('\n── ⑱ 묶음 고르기 ──')
eq('주소에 남는다', Q.queryFromFilter({ ...Q.EMPTY_FILTER, batch: 'abc' }), '?batch=abc')
eq('주소에서 읽는다', Q.filterFromQuery(new URLSearchParams('batch=abc')).batch, 'abc')
eq('묶음으로 거른다', Q.applyCardFilter([
  { card_id: 1, name: 'ㄱ', division: '계측', registered_at: '2026-11-25', import_batch_id: 'A' },
  { card_id: 2, name: 'ㄴ', division: '계측', registered_at: '2026-11-25', import_batch_id: 'B' },
  { card_id: 3, name: 'ㄷ', division: '계측', registered_at: '2026-11-25' },
], { ...Q.EMPTY_FILTER, batch: 'A' }, ['계측']).map(r => r.card_id), [1])
const PAGE_SRC = read('app/cards/page.tsx')
const FILTER_SRC = read('components/cards/CardFilterModal.tsx')
// 2026-11-25 — 묶음 고르기는 **필터 창** 안으로 들어갔다.
ok('필터 창에 묶음 칸이 있다', /가져오기 묶음/.test(FILTER_SRC))
ok('최근 열 개만 넘긴다', PAGE_SRC.includes('.slice(0, 10)'))

console.log("\n── ⑦ 방식 고르기와 필터 ──")
const PAGE = read('app/cards/page.tsx')
const FORM = read('components/cards/CardFormModal.tsx')
// 2026-11-25 — 「여러 장 등록」 버튼을 걷고 방식 고르기의 **네 번째 항목**으로 옮겼다.
ok('목록에 여러 장 등록 버튼이 없다', !/onClick={() => setBulkOpen(true)}>여러 장 등록/.test(PAGE))
ok('방식 고르기에 네 번째가 있다', /여러 장 등록/.test(FORM) && /PDF·사진 여러 장을 한 번에/.test(FORM))
ok('그 자리에서 건너간다', PAGE.includes('onBulk={() => { setFormOpen(false)'))
ok('파일 올리기로 이름이 바뀌었다', FORM.includes('파일 올리기') && FORM.includes('(jpg · png · pdf)'))
ok('확인 전 칩이 사라졌다', !/확인 전/.test(PAGE))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
