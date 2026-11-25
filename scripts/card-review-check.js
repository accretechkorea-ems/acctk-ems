// **명함 검토 대기** — 읽기 → 검토 → 승인 (2026-11-25).
//
//   node scripts/card-review-check.js
//
// 지키는 약속
//   ① 검토 대기(draft)는 **목록·검색·엑셀·중복 판정**에 나오지 않는다.
//   ② 승인은 status 를 active 로 바꾸고, 건너뛰기는 그 줄을 지운다(사건을 먼저 남긴다).
//   ③ 폰에는 「여러 장 등록」이 뜨지 않는다 — 검토 화면이 PC 전용이다.
//   ④ 쪽 이미지는 **브라우저 메모리**에만 있다 — 올리는 자리도 저장하는 자리도 없다.
//   ⑤ 목록 위의 띠(이어서·버리기)와 Enter/화살표.
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

const V = load(path.join(ROOT, 'lib/cardReview.ts'))

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

const SQL_PATH = 'db/business_cards_draft_20261125.sql'
const ROUTE_PATH = 'app/api/cards/import/route.ts'
const BULK_PATH = 'app/api/cards/ocr-bulk/route.ts'
const PAGE_PATH = 'app/cards/page.tsx'
const REVIEW_PATH = 'app/cards/import/page.tsx'
const MODAL_PATH = 'components/cards/BulkImportModal.tsx'
const FORM_PATH = 'components/cards/CardFormModal.tsx'

const R = has(ROUTE_PATH) ? read(ROUTE_PATH) : ''
const BULK = read(BULK_PATH)
const PAGE = read(PAGE_PATH)
const REVIEW = has(REVIEW_PATH) ? read(REVIEW_PATH) : ''
const MODAL = read(MODAL_PATH)

console.log('\n── ① 표와 칸 ──')
ok('SQL 파일이 있다', has(SQL_PATH))
const SQL = has(SQL_PATH) ? read(SQL_PATH) : ''
ok('status 와 import_page 를 더한다',
  /add column if not exists status\s+text not null default 'active'/.test(SQL)
  && /add column if not exists import_page int/.test(SQL))
ok('status 는 draft·active 둘뿐', /check \(status in \('draft', 'active'\)\)/.test(SQL))
ok('찾기 쉽게 인덱스', /create index if not exists business_cards_draft_idx/.test(SQL))
ok('스키마를 깨운다', /notify pgrst, 'reload schema'/.test(SQL))
ok('APPLIED.md 에 미적용으로 적었다',
  /business_cards_draft_20261125\.sql[^|]*\|\s*\*\*미적용\*\*/.test(read('db/APPLIED.md')))
eq('상태 이름', [V.STATUS_DRAFT, V.STATUS_ACTIVE], ['draft', 'active'])

console.log('\n── ② 검토 대기는 명함첩에 나오지 않는다 ──')
ok('목록이 active 만 담는다', PAGE.includes("String(r.status ?? STATUS_ACTIVE) === STATUS_ACTIVE"))
ok('대기는 따로 떼어 띠로만', PAGE.includes('setDrafts(all.filter'))
ok('중복 판정도 active 만 본다', BULK.includes("existingQuery.eq('status', STATUS_ACTIVE)"))
ok('읽은 줄은 draft 로 담는다',
  BULK.includes('...(asDraft ? { status: STATUS_DRAFT, import_page: page } : {})'))
ok('칸이 없으면 종전처럼 바로 등록', BULK.includes('hasDraftColumns'))
// 엑셀·검색은 목록이 준 줄(rows)만 본다 — rows 에 draft 가 없으므로 따라 들어가지 않는다.
ok('엑셀은 목록이 준 줄만 내보낸다', PAGE.includes('exportCardXlsx(shown, today)'))

console.log('\n── ③ 승인·건너뛰기·버리기 ──')
ok('라우트가 있다', has(ROUTE_PATH))
ok('POST · 로그인 필수', /export async function POST\(/.test(R) && /loadCaller\(\{ kind: 'login' \}/.test(R))
ok('내 대기 줄만 만진다',
  R.includes("if (data.status !== STATUS_DRAFT) return { row: null, schema: false }")
  && R.includes('Number(data.engineer_id ?? 0) !== Number(caller.engineer_id)'))
ok('승인이 status 를 바꾼다', R.includes('{ ...fields, status: STATUS_ACTIVE }'))
ok('승인 사건을 남긴다', R.includes('EVENT_APPROVED'))
ok('건너뛰기는 그 줄을 지운다', R.includes("action === 'skip'") && /\.delete\(\)\.eq\('card_id', cardId\)/.test(R))
ok('지우기 전에 사건을 먼저 남긴다',
  /await logEvent\(cardId, EVENT_SKIPPED[\s\S]{0,200}\.delete\(\)/.test(R))
eq('사건 이름', [V.EVENT_APPROVED, V.EVENT_SKIPPED], ['card_approved', 'card_skipped'])
ok('전부 승인', R.includes("action === 'approve_all'"))
ok('버리기', R.includes("action === 'discard'"))
ok('칸이 없으면 무엇을 돌려야 하는지 말한다',
  R.includes('business_cards_draft_20261125.sql') && R.includes('503'))

console.log('\n── ④ 검토 화면 ──')
ok('화면이 있다', has(REVIEW_PATH))
ok('세 단(목록·이미지·칸)', REVIEW.includes('쪽 목록') || REVIEW.includes('읽힌 내용'))
ok('Enter 로 승인', REVIEW.includes("if (e.key === 'Enter')") && REVIEW.includes('void approve()'))
ok('←/→ 로 이동',
  REVIEW.includes("e.key === 'ArrowLeft'") && REVIEW.includes("e.key === 'ArrowRight'"))
ok('글자를 치는 중에는 화살표를 듣지 않는다', REVIEW.includes('if (typing) return'))
ok('대기가 남으면 다음으로 못 간다', REVIEW.includes('blockedReason(tally)') && REVIEW.includes('blocked != null'))
ok('「나중에 이어서」', REVIEW.includes('나중에 이어서'))
// 가드는 경로로 판정한다 — 이 길이 없으면 「접근 권한이 없습니다」가 뜬다(2026-11-25 실측).
ok('검토 화면이 명함 권한을 따른다',
  read('lib/menuPerms.ts').includes("'/cards/import': 'business_cards'"))
ok('이미지가 없으면 안내', REVIEW.includes('을 보며 검토해 주세요'))
eq('대기만 손볼 수 있다', [V.isPending('wait'), V.isPending('approved'), V.isPending('merged')], [true, false, false])
eq('집계', V.tallyOf(['approved', 'wait', 'skipped', 'merged', 'dup', 'none', 'empty']),
  { approved: 1, wait: 1, skipped: 1, merged: 1, dup: 1, none: 1, empty: 1 })
eq('대기가 있으면 막는다', typeof V.blockedReason({ approved: 1, wait: 2, skipped: 0, merged: 0, dup: 0, none: 0, empty: 0 }), 'string')
eq('대기가 없으면 통과', V.blockedReason({ approved: 1, wait: 0, skipped: 0, merged: 0, dup: 0, none: 0, empty: 0 }), null)
eq('왼쪽 줄 글자', [
  V.rowLabel({ state: 'wait', name: '홍길동', company: '가나정밀' }),
  V.rowLabel({ state: 'merged', mergedInto: 2 }),
  V.rowLabel({ state: 'none' }),
  V.rowLabel({ state: 'empty' }),
], ['홍길동 · 가나정밀', '↳ 3쪽에 합침', '사람 없는 면', '빈 면'])
eq('쪽 글자', [V.pageLabel(13), V.pageRangeLabel(0, 19)], ['14쪽', '1~20쪽'])
// 2026-11-25 3차 — 앞뒷면만 합치는 것이 아니다. 「뒷면」 대신 **합쳐 들어간 쪽**을 적는다.
ok('합친 줄에 「뒷면」이라 적지 않는다', !V.rowLabel({ state: 'merged', mergedInto: 2 }).includes('뒷면'))

console.log('\n── ⑧ 이 묶음 버리기 ──')
ok('검토 화면 상단에 단추가 있다', REVIEW.includes('이 묶음 버리기'))
ok('묻고 나서 버린다',
  REVIEW.includes('discardQuestion(tally.wait)') && REVIEW.includes("title: '이 묶음을 버릴까요?'"))
ok('그 묶음만 버린다', REVIEW.includes("action: 'discard', import_batch_id: batchId"))
ok('버린 뒤 목록으로 나간다',
  REVIEW.includes('건을 버렸습니다') && /toast\.success[\s\S]{0,60}leave\(\)/.test(REVIEW))
ok('라우트에 버리기가 있다', read('app/api/cards/import/route.ts').includes("action === 'discard'"))
ok('물음이 **되돌릴 수 없다**를 적는다', V.discardQuestion(3).includes('되돌릴 수 없습니다'))

console.log('\n── ⑤ 쪽 이미지는 서버에 가지 않는다 ──')
ok('메모리에만 둔다(모듈 변수)', read('lib/cardImportSession.ts').includes('let session: ImportSession | null = null'))
ok('object URL 로만 쓴다', REVIEW.includes('URL.createObjectURL'))
ok('떠날 때 거둔다', REVIEW.includes('URL.revokeObjectURL'))
ok('검토 화면이 파일을 올리지 않는다',
  !/fetch\([^)]*,\s*\{[^}]*body:\s*(body|form)\b/.test(REVIEW) && !/new FormData\(\)/.test(REVIEW))
ok('검토 라우트가 파일을 받지 않는다', !/formData\(\)/.test(R) && !/storage\./.test(R))

console.log('\n── ⑥ 20쪽씩 읽고 검토로 ──')
eq('한 번에 스무 쪽', V.REVIEW_CHUNK, 20)
ok('화면이 그만큼만 읽는다', MODAL.includes('pieces.slice(0, REVIEW_CHUNK)'))
ok('읽고 나면 검토 화면으로', MODAL.includes("router.push('/cards/import')"))
ok('쪽 이미지를 들고 간다', MODAL.includes('putSession({') && MODAL.includes('blob: p.file'))
ok('폰에는 여러 장 등록이 없다', read(FORM_PATH).includes('{onBulk && !narrow && ('))

console.log('\n── ⑦ 목록 위의 띠 ──')
ok('대기가 있으면 띠', PAGE.includes('pendingBannerLabel(drafts.length)'))
ok('이어서', PAGE.includes("router.push(`/cards/import?batch=${draftBatch(drafts)}`)"))
ok('버리기', PAGE.includes('void discardDrafts()') && PAGE.includes("action: 'discard'"))
ok('버리기 전에 묻는다', PAGE.includes('discardQuestion(drafts.length)'))
eq('띠 글자', V.pendingBannerLabel(24), '검토 대기 24장')
ok('버리기 물음이 **되돌릴 수 없다**를 적는다', V.discardQuestion(3).includes('되돌릴 수 없습니다'))
ok('파일 이름은 브라우저가 기억한다',
  /export function writeFileName/.test(read('lib/cardReview.ts')) && V.FILE_NAME_KEY === 'cards.import.fileName')
ok('표에는 파일 이름 칸이 없다', !/file_name/.test(read('lib/businessCard.ts')))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
