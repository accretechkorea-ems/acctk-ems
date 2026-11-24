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
ok('확인일을 비운다', /const VERIFIED_AT = null/.test(R) && /verified_at: VERIFIED_AT/.test(R))
ok('표가 bulk 를 받아들이게 SQL 이 있다', has('db/business_cards_bulk_20261124.sql'))
const SQL = has('db/business_cards_bulk_20261124.sql') ? read('db/business_cards_bulk_20261124.sql') : ''
ok('CHECK 에 bulk 를 더한다',
  /check \(input_method in \('camera', 'upload', 'manual', 'bulk'\)\)/.test(SQL))
ok('빈 확인일을 등록일로 채운다(bulk 는 빼고)',
  /set verified_at = registered_at/.test(SQL) && /input_method is distinct from 'bulk'/.test(SQL))
ok('스키마를 깨운다', /notify pgrst, 'reload schema'/.test(SQL))
ok('APPLIED.md 에 미적용으로 적었다',
  /business_cards_bulk_20261124\.sql[^|]*\|\s*\*\*미적용\*\*/.test(read('db/APPLIED.md')))

console.log('\n── ③ 한 장씩 담은 줄 = 확인일이 등록일 ──')
const ONE = read(ONE_PATH)
ok('담을 때 확인일을 함께 넣는다', /verified_at: verified/.test(ONE))
ok('방식으로 가른다', /checkedOnEntry\(method\) \? now : null/.test(ONE))
eq('bulk 만 비운다',
  ['manual', 'camera', 'upload', 'bulk'].map(m => C.checkedOnEntry(m)), [true, true, true, false])
eq('방식 넷', [...C.INPUT_METHODS], ['camera', 'upload', 'manual', 'bulk'])
eq('이름', C.METHOD_LABEL.bulk, '여러 장 등록')

console.log('\n── ④ 중복과 빈 줄 ──')
ok('살아 있는 줄만 본다', /\.is\('deleted_at', null\)/.test(R))
ok('휴대폰 또는 이메일', /byPhone\.get\(phone\)\) \|\| \(mail && byMail\.get\(mail\)\)/.test(R))
ok('중복이면 담지 않고 기존 id 를 준다', /reason: 'dup', card_id: hit\.card_id/.test(R))
ok('같은 묶음 안의 중복도 잡는다', /byPhone\.set\(phone, \{ card_id: cardId/.test(R))
ok('이름·회사 둘 다 없으면 담지 않는다', /if \(!row\.name && !row\.company\)[\s\S]{0,80}'empty'/.test(R))
eq('집계', B.addLines(B.EMPTY_TALLY, [
  { index: 0, ok: true, card_id: 1 },
  { index: 1, ok: false, reason: 'dup', card_id: 1 },
  { index: 2, ok: false, reason: 'parse' },
]), { done: 3, saved: 1, dup: 1, failed: 1 })
eq('요약 글자', B.summaryLabel({ done: 3, saved: 1, dup: 1, failed: 1 }), '등록 1 · 중복 1 · 실패 1')
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

console.log('\n── ⑦ 「확인 전」 보기 ──')
const rows = [
  { card_id: 1, name: 'ㄱ', division: '계측', registered_at: '2026-11-24', verified_at: '2026-11-24' },
  { card_id: 2, name: 'ㄴ', division: '계측', registered_at: '2026-11-24', verified_at: null },
  { card_id: 3, name: 'ㄷ', division: '반도체', registered_at: '2026-11-24', verified_at: null },
]
eq('확인 전인가', rows.map(r => Q.isUnchecked(r)), [false, true, true])
eq('보이는 사업부 안에서만 센다', Q.countUnchecked(rows, ['계측']), 1)
eq('양쪽을 보면 둘', Q.countUnchecked(rows, ['계측', '반도체']), 2)
eq('조건을 걸면 확인 전만',
  Q.applyCardFilter(rows, { ...Q.EMPTY_FILTER, checked: 'none' }, ['계측', '반도체']).map(r => r.card_id), [2, 3])
eq('조건이 없으면 전부',
  Q.applyCardFilter(rows, Q.EMPTY_FILTER, ['계측', '반도체']).map(r => r.card_id), [1, 2, 3])
eq('주소에 남는다', Q.queryFromFilter({ ...Q.EMPTY_FILTER, checked: 'none' }), '?checked=none')
eq('주소에서 읽는다', Q.filterFromQuery(new URLSearchParams('checked=none')).checked, 'none')
eq('모르는 값은 전체', Q.filterFromQuery(new URLSearchParams('checked=yes')).checked, '')
eq('목록 글자 — 확인 전', C.checkedLabel({ verified_at: null, registered_at: '2026-11-24' }), '확인 전')
eq('등록일과 같으면 되풀이하지 않는다',
  C.checkedLabel({ verified_at: '2026-11-24T05:00:00Z', registered_at: '2026-11-24T00:00:00Z' }), '')
eq('다른 날이면 그 달을',
  C.checkedLabel({ verified_at: '2026-12-01T00:00:00Z', registered_at: '2026-11-24T00:00:00Z' }), '확인 2026-12')
const PAGE = read('app/cards/page.tsx')
ok('목록에 「여러 장 등록」 버튼이 있다', /여러 장 등록/.test(PAGE))
ok('확인 전 칩이 있다', /확인 전 \{unchecked\}건/.test(PAGE))
ok('0건이면 칩을 두지 않는다', /\{unchecked > 0 && \(/.test(PAGE))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
