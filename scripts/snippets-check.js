// **문구함** — 표·RLS · 자리표 · 끼워 넣기 · 붙인 네 자리 · 권한 (2026-11-25).
//
//   node scripts/snippets-check.js
//
// 지키는 약속
//   ① 표와 RLS — 읽기는 내 것 또는 공용, 쓰기는 내 것(공용은 만든 사람·admin 이상).
//   ② 용도 다섯 · 범위 둘.
//   ③ 자리표를 그 화면의 값으로 바꾼다. **값이 없는 자리표는 그대로 둔다.**
//   ④ 커서 자리에 끼운다 — 기존 글은 지우지 않는다.
//   ⑤ 네 자리에 붙어 있다 — 서비스 내용 · 기타사항 · 견적 저장 창 · 접촉보고서 본문.
//   ⑥ 권한은 **라우트가** 다시 센다(남의 공용 문구는 403).
//   ⑦ 공용 초기 문구 둘.
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

const S = load(path.join(ROOT, 'lib/snippets.ts'))

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

const SQL_PATH = 'db/text_snippets_20261125.sql'
const ROUTE_PATH = 'app/api/snippets/route.ts'
const PICKER_PATH = 'components/common/SnippetPicker.tsx'
const SAVE_PATH = 'components/common/SnippetSaveModal.tsx'
const TAB_PATH = 'components/account/MySnippets.tsx'
const ACCOUNT_PATH = 'app/account/page.tsx'
const HOOK_PATH = 'hooks/useSnippets.ts'

console.log('── ① 표와 RLS ──')
ok('SQL 파일이 있다', has(SQL_PATH))
const SQL = has(SQL_PATH) ? read(SQL_PATH) : ''
ok('표를 만든다', /create table if not exists public\.text_snippets/.test(SQL))
ok('기본키는 serial', /snippet_id\s+serial primary key/.test(SQL))
ok('등록자는 engineers 를 가리킨다',
  /owner_engineer_id\s+integer not null references public\.engineers\(engineer_id\)/.test(SQL))
ok('용도·범위에 CHECK', /text_snippets_kind_chk/.test(SQL) && /text_snippets_scope_chk/.test(SQL))
ok('CHECK 에 용도 다섯이 그대로', (() => {
  const line = /check \(kind in \(([^)]*)\)\)/.exec(SQL)?.[1] ?? ''
  return S.SNIPPET_KINDS.every(k => line.includes(`'${k}'`))
})())
ok('CHECK 에 범위 둘', /check \(scope in \('private', 'shared'\)\)/.test(SQL))
ok('인덱스 둘', /text_snippets_scope_kind_idx[\s\S]{0,80}\(scope, kind\)/.test(SQL)
  && /text_snippets_owner_idx[\s\S]{0,80}\(owner_engineer_id\)/.test(SQL))
ok('RLS 를 켠다', /alter table public\.text_snippets enable row level security/.test(SQL))
ok('정책 넷', ['select', 'insert', 'update', 'delete']
  .every(c => new RegExp(`create policy text_snippets_${c}`).test(SQL)))
ok('읽기 = 내 것 또는 공용', /text_snippets_select[\s\S]{0,300}scope = 'shared'[\s\S]{0,200}owner_engineer_id in/.test(SQL))
ok('담기 = 내 것으로만', /text_snippets_insert[\s\S]{0,300}with check[\s\S]{0,200}owner_engineer_id in/.test(SQL))
ok('고치기 = 내 것, 공용은 admin 이상',
  /text_snippets_update[\s\S]{0,700}permission_level in \('admin', 'superadmin'\)/.test(SQL))
ok('지우기도 같은 조건',
  /text_snippets_delete[\s\S]{0,500}permission_level in \('admin', 'superadmin'\)/.test(SQL))
// 감싸기 규칙 — auth 함수를 줄마다 부르지 않게 괄호로 싸 둔다(initplan).
ok('auth 는 (select …) 로 감싼다',
  /\(select auth\.jwt\(\) ->> 'email'\)/.test(SQL) && !/[^(]auth\.jwt\(\) ->> 'email'\)/.test(SQL.replace(/\(select auth\.jwt\(\) ->> 'email'\)/g, '')))
ok('쓰기는 라우트가 한다 — authenticated 에는 select 만 내려 준다',
  /grant select on table public\.text_snippets to authenticated/.test(SQL)
  && !/grant[^;]*insert[^;]*to authenticated/.test(SQL))
ok('스키마를 깨운다', /notify pgrst, 'reload schema'/.test(SQL))
ok('APPLIED.md 에 미적용으로 적었다',
  /text_snippets_20261125\.sql[^|]*\|\s*\*\*미적용\*\*/.test(read('db/APPLIED.md')))

console.log('\n── ② 용도와 범위 ──')
eq('용도 다섯', [...S.SNIPPET_KINDS],
  ['mail_body', 'mail_subject', 'service_content', 'service_note', 'common'])
ok('용도마다 이름이 있다', S.SNIPPET_KINDS.every(k => (S.KIND_LABEL[k] ?? '').length > 0))
eq('범위 둘', [...S.SNIPPET_SCOPES], ['private', 'shared'])
eq('범위 이름', [S.SCOPE_LABEL.private, S.SCOPE_LABEL.shared], ['개인', '공용'])
eq('그 자리에서 보이는 용도', S.visibleKinds('service_content'), ['service_content', 'common'])
eq('공통 자리에서는 공통만', S.visibleKinds('common'), ['common'])
eq('모르는 값은 받지 않는다',
  [S.isSnippetKind('mail_body'), S.isSnippetKind('아무거나'), S.isSnippetScope('shared'), S.isSnippetScope('')],
  [true, false, true, false])

console.log('\n── ③ 자리표 ──')
eq('자리표 아홉', [...S.SNIPPET_VARS],
  ['수신인', '직급', '회사', '사업장', '장비', '품명', '견적번호', '작성자', '오늘'])
eq('값이 있으면 바꾼다',
  S.applyVars('{수신인} {직급}님, 안녕하세요.', { 수신인: '박성철', 직급: '과장' }),
  '박성철 과장님, 안녕하세요.')
// 값이 없는 자리표는 **그대로 둔다** — 빈 글자로 지우면 말이 깨지고 무엇을 채울지도 모른다.
eq('값이 없으면 그대로 둔다',
  S.applyVars('{수신인} {직급}님, 요청하신 {품명} 견적서입니다.', { 수신인: '박성철' }),
  '박성철 {직급}님, 요청하신 {품명} 견적서입니다.')
eq('빈 글자·공백도 없는 것으로 본다',
  S.applyVars('{장비} 점검', { 장비: '   ' }), '{장비} 점검')
eq('줄바꿈은 그대로 남는다',
  S.applyVars('1. 점검\n2. {장비} 교정', { 장비: 'UA3P' }), '1. 점검\n2. UA3P 교정')
eq('같은 자리표가 여러 번 나오면 모두 바꾼다',
  S.applyVars('{회사} / {회사}', { 회사: '가나정밀' }), '가나정밀 / 가나정밀')
eq('ctx 를 주지 않아도 터지지 않는다', S.applyVars('{오늘} 방문'), '{오늘} 방문')
eq('그 글이 쓰는 자리표', S.varsIn('{수신인}님 {장비} 점검'), ['수신인', '장비'])

console.log('\n── ④ 커서 자리에 끼운다 ──')
eq('커서 자리에', S.spliceAt('가나다', 2, 2, '[X]'), { value: '가나[X]다', caret: 5 })
eq('고른 범위는 바꾼다', S.spliceAt('가나다', 1, 3, 'X'), { value: '가X', caret: 2 })
eq('맨 끝', S.spliceAt('abc', 3, 3, 'd'), { value: 'abcd', caret: 4 })
eq('맨 앞', S.spliceAt('abc', 0, 0, 'z'), { value: 'zabc', caret: 1 })
eq('거꾸로 고른 범위도 같다', S.spliceAt('abcd', 3, 1, 'X'), { value: 'aXd', caret: 2 })
eq('범위를 넘겨도 잘리지 않는다', S.spliceAt('ab', 99, 99, 'c'), { value: 'abc', caret: 3 })
ok('기존 글을 지우지 않는다고 적어 둔다', S.INSERT_HINT.includes('기존 글은 지우지 않습니다'))
ok('칸이 없으면 글자만 돌려준다', S.insertAtCursor(null, '문구') === '문구')
ok('칸의 커서 자리에 끼운다', (() => {
  // 가짜 textarea — selectionStart·End 만 흉내 낸다(DOM 없이 돈다).
  const el = { value: '앞뒤', selectionStart: 1, selectionEnd: 1, setSelectionRange() {}, focus() {} }
  return S.insertAtCursor(el, '[중간]') === '앞[중간]뒤'
})())

console.log('\n── 목록과 권한 판정 ──')
const mineRow = { snippet_id: 1, title: '내 것', body: '본문', kind: 'common', scope: 'private', owner_engineer_id: 7 }
const sharedRow = { snippet_id: 2, title: '공용', body: '본문', kind: 'mail_body', scope: 'shared', owner_engineer_id: 4 }
eq('내 것인가', [S.isMine(mineRow, 7), S.isMine(mineRow, 8), S.isMine(mineRow, null)], [true, false, false])
eq('내 것은 고칠 수 있다', S.canEditSnippet({ engineer_id: 7, permission_level: 'member' }, mineRow), true)
eq('남의 공용은 일반 계정이 못 고친다',
  S.canEditSnippet({ engineer_id: 7, permission_level: 'member' }, sharedRow), false)
eq('공용은 admin 이상이면 고친다', [
  S.canEditSnippet({ engineer_id: 7, permission_level: 'admin' }, sharedRow),
  S.canEditSnippet({ engineer_id: 7, permission_level: 'superadmin' }, sharedRow),
], [true, true])
eq('남의 개인 문구는 admin 도 못 고친다',
  S.canEditSnippet({ engineer_id: 9, permission_level: 'admin' }, { ...mineRow, owner_engineer_id: 7 }), false)
eq('사람이 없으면 거짓', S.canEditSnippet(null, mineRow), false)
eq('용도별로 묶는다', S.groupByKind([sharedRow, mineRow]).map(g => [g.kind, g.rows.length]),
  [['mail_body', 1], ['common', 1]])
eq('묶음 머리줄', S.groupLabel('mail_body', 3), '메일 본문 · 3')
eq('찾기는 제목과 내용 둘 다',
  [S.matchSnippet(mineRow, '내'), S.matchSnippet(mineRow, '본문'), S.matchSnippet(mineRow, '없는말')],
  [true, true, false])
eq('한 줄 미리보기 — 줄바꿈을 눌러 준다', S.oneLine('가\n나\n다'), '가 나 다')
ok('길면 말줄임', S.oneLine('가'.repeat(200)).endsWith('…'))
ok('지우기 전에 되돌릴 수 없다고 적는다', S.deleteQuestion('제목').includes('되돌릴 수 없습니다'))
eq('담을 수 없는 까닭', [
  S.snippetBlockedReason({ title: '', body: '본문' }),
  S.snippetBlockedReason({ title: '제목', body: '  ' }),
  S.snippetBlockedReason({ title: '제목', body: '본문' }),
], ['제목을 입력해주세요', '내용을 입력해주세요', null])

console.log('\n── ⑤ 네 자리에 붙어 있다 ──')
const SVC_ADD = read('components/customer/modals/ServiceAddModal.tsx')
const SVC_EDIT = read('components/customer/modals/ServiceEditModal.tsx')
const QUOTE = read('components/quote/QuoteSavedModal.tsx')
const REPORT = read('app/contact/semi/[projectId]/write/page.tsx')
ok('서비스 레포트 추가 — 서비스 내용', /kind="service_content"[\s\S]{0,200}service_notes: insertAtCursor/.test(SVC_ADD))
ok('서비스 레포트 추가 — 기타사항', /kind="service_note"[\s\S]{0,200}etc_notes: insertAtCursor/.test(SVC_ADD))
ok('서비스 레포트 수정도 두 칸', /kind="service_content"/.test(SVC_EDIT) && /kind="service_note"/.test(SVC_EDIT))
ok('자리표 값을 창이 받는다', /snippetCtx\?: SnippetCtx/.test(SVC_ADD) && /snippetCtx\?: SnippetCtx/.test(SVC_EDIT))
ok('사업장·장비·작성자는 화면이 준다',
  /사업장: customer\?\.company_name/.test(read('components/customer/CustomerDetailBody.tsx'))
  && /장비: \[dev\?\.device_name/.test(read('components/customer/CustomerDetailBody.tsx'))
  && /작성자: engineers\.find/.test(read('components/customer/CustomerDetailBody.tsx')))
ok('수신인·직급은 고른 담당자에서', /수신인: picked\?\.name/.test(SVC_ADD) && /직급: picked\?\.position/.test(SVC_ADD))
ok('견적 저장 창 — 본문 문구 고르기', /useSnippets\('mail_body'\)/.test(QUOTE) && /본문 문구/.test(QUOTE))
ok('고른 문구는 자리표를 바꿔 보여 준다', /applyVars\(chosen\.body, ctx\)/.test(QUOTE))
ok('그 글이 메일 본문이 된다', /mailtoUrl\(parts, preview\)/.test(QUOTE))
ok('안 고르면 본문 없음', /option value=""/.test(QUOTE) && /본문 없이 보내기/.test(QUOTE))
ok('접촉보고서 본문에도 붙었다', /kind="common"[\s\S]{0,120}insertAtCursor\(bodyRef\.current/.test(REPORT))
ok('제목 규칙은 그대로다 — 번호 없이 회사·품명',
  read('lib/quoteMail.ts').includes("'견적서 송부의 건'"))

console.log('\n── mailto 본문 ──')
const M = load(path.join(ROOT, 'lib/quoteMail.ts'))
const PARTS = { quoteNo: 'Q-1', toEmail: 'a@b.co.kr', company: '협진정공', firstItem: '스타일러스' }
ok('고르지 않으면 body 파라미터가 없다', !/[?&]body=/.test(M.mailtoUrl(PARTS)))
ok('고르면 body 가 붙는다', /[?&]body=/.test(M.mailtoUrl(PARTS, '안녕하세요.\n감사합니다.')))
ok('줄바꿈은 %0D%0A 로 간다', M.mailtoUrl(PARTS, '한\n줄').includes('%0D%0A'))
ok('공백만이면 붙이지 않는다', !/[?&]body=/.test(M.mailtoUrl(PARTS, '   ')))
eq('제목은 지금 규칙 그대로', M.mailSubject(PARTS), '협진정공_스타일러스_견적서 송부의 건')

console.log('\n── ⑥ 권한은 라우트가 다시 센다 ──')
ok('라우트가 있다', has(ROUTE_PATH))
const R = has(ROUTE_PATH) ? read(ROUTE_PATH) : ''
ok('POST · 로그인 필수', /export async function POST\(/.test(R) && /loadCaller\(\{ kind: 'login' \}/.test(R))
ok('네 가지를 한다', ["'list'", "'create'", "'update'", "'delete'"].every(a => R.includes(a)))
ok('주인은 세션에서 넣는다 — 화면이 보낸 값을 쓰지 않는다',
  /owner_engineer_id: caller\.engineer_id/.test(R) && !/owner_engineer_id: Number\(body/.test(R))
ok('고치기·지우기 전에 같은 판정을 돌린다', /if \(!canEditSnippet\(caller, row\)\)/.test(R))
ok('아니면 403', /status: 403/.test(R))
ok('표가 없으면 무엇을 돌려야 하는지 말한다',
  /SCHEMA_MESSAGE/.test(R) && S.SCHEMA_MESSAGE.includes('db/text_snippets_20261125.sql'))
ok('읽기는 내 것 + 공용만', /scope\.eq\.shared,owner_engineer_id\.eq\./.test(R))
ok('화면은 이 라우트만 쓴다 — 표를 직접 만지지 않는다', (() => {
  const files = [PICKER_PATH, SAVE_PATH, TAB_PATH, HOOK_PATH]
  return files.every(f => !/from\('text_snippets'\)/.test(read(f)))
    && /fetch\('\/api\/snippets'/.test(read(HOOK_PATH))
})())
ok('alert·confirm 을 쓰지 않는다',
  [PICKER_PATH, SAVE_PATH, TAB_PATH].every(f => !/\balert\(|window\.confirm\(/.test(read(f))))

console.log('\n── 고르기 창과 저장 창 ──')
const PICKER = read(PICKER_PATH)
ok('라벨 옆 「문구 ▾」', S.PICK_LABEL === '문구 ▾' && PICKER.includes('PICK_LABEL'))
ok('Popover 로 띄운다 — 모달 안에서도 잘리지 않는다', /<Popover/.test(PICKER))
ok('SearchSelect 와 같은 키보드 규칙',
  /useListKeyboard/.test(PICKER) && /useOverlayEsc/.test(PICKER)
  && /isComposing/.test(PICKER) && /e\.key === 'Tab'/.test(PICKER))
ok('마우스 hover 는 고른 자리만 옮긴다', /onMouseEnter=\{\(\) => keys\.setActive/.test(PICKER))
ok('내 문구 · 공용으로 나눠 보여 준다', PICKER.includes("group('내 문구'") && PICKER.includes("group('공용'"))
ok('다른 용도 전체 보기', PICKER.includes('OTHER_KINDS_LABEL') && S.OTHER_KINDS_LABEL.includes('다른 용도'))
ok('지금 내용을 문구로 저장', PICKER.includes('SAVE_CURRENT_LABEL') && S.SAVE_CURRENT_LABEL.includes('지금 내용'))
ok('고르면 자리표를 바꿔 끼운다', /onPick\(applyVars\(s\.body, ctx\)\)/.test(PICKER))
const SAVE = read(SAVE_PATH)
ok('저장 창은 ModalCard 를 쓴다', /<ModalCard/.test(SAVE))
ok('제목·용도·범위·내용 네 칸', ['제목', '용도', '범위', '내용'].every(t => SAVE.includes(`>${t}<`)))
ok('공용을 고르면 안내 한 줄', /scope === 'shared' && \(/.test(SAVE) && S.SHARED_NOTICE.includes('관리자만'))
ok('고치기도 같은 창', /editing \? '문구 수정' : '문구로 저장'/.test(SAVE))

console.log('\n── 내 문구 탭 ──')
const TAB = read(TAB_PATH)
ok('내 정보 페이지에 탭이 있다',
  /AccountTab/.test(read(ACCOUNT_PATH)) && read(ACCOUNT_PATH).includes("tab === 'snippets'"))
ok('검색 · 용도 · 범위로 거른다',
  TAB.includes('문구 검색') && TAB.includes('용도 전체') && TAB.includes('내 것 · 공용'))
ok('용도별로 묶는다', /groupByKind\(rows\)/.test(TAB))
ok('내 것은 수정·삭제', TAB.includes('>수정<') && TAB.includes('>삭제<'))
ok('공용은 내 것으로 복사', TAB.includes('내 것으로 복사') && /scope: 'private'/.test(TAB))
ok('＋ 문구 추가 — 저장 창을 다시 쓴다', TAB.includes('＋ 문구 추가') && /<SnippetSaveModal/.test(TAB))
ok('아래에 자리표 안내', TAB.includes('VAR_HELP_HEAD') && TAB.includes('SNIPPET_VARS'))
ok('지우기 전에 묻는다(confirm 창)', /await confirm\(\{/.test(TAB) && /deleteQuestion\(s\.title\)/.test(TAB))

console.log('\n── 홈의 「내 문구」 카드 ──')
const CARD = read('components/dashboard/MySnippetCard.tsx')
const DASH = read('app/dashboard/page.tsx')
ok('홈 격자의 **마지막 칸**에 선다', /<MySnippetCard/.test(DASH) && /마지막 칸/.test(DASH))
ok('건수를 개인·공용으로 적는다', /개인 \{mine\} · 공용 \{shared\}/.test(CARD))
ok('최근 세 장', /const RECENT = 3/.test(CARD) && /\.slice\(0, RECENT\)/.test(CARD))
ok('최근순으로 고른다', /updated_at \?\? b\.created_at/.test(CARD))
ok('제목 옆에 용도 뱃지', /KIND_LABEL\[s\.kind\]/.test(CARD))
ok('＋ 추가 · 전체 관리 둘', CARD.includes('＋ 추가') && CARD.includes('전체 관리'))
// 「전체 관리」는 **화면을 옮기지 않는다** — 내 정보 탭과 같은 부품을 창에 끼운다.
ok('전체 관리는 모달 안에서 같은 부품을 쓴다',
  /<MySnippets me=\{me\} \/>/.test(CARD) && /width=\{760\}/.test(CARD) && !/router\.push\('\/account/.test(CARD))
ok('＋ 추가는 저장 창을 그대로 쓴다', /<SnippetSaveModal/.test(CARD))
ok('내 정보 탭은 그대로 있다', read('app/account/page.tsx').includes("tab === 'snippets'"))

console.log('\n── ⑦ 공용 초기 문구 둘 ──')
ok('견적서 송부', /insert into public\.text_snippets[\s\S]{0,400}'견적서 송부'[\s\S]{0,400}'mail_body', 'shared', 4/.test(SQL))
ok('그 본문에 자리표가 있다',
  SQL.includes('{수신인} {직급}님, 안녕하세요.') && SQL.includes('요청하신 {품명} 견적서를 송부드립니다.'))
ok('정기 점검 기본', /'정기 점검 기본'[\s\S]{0,400}'service_content', 'shared', 4/.test(SQL))
ok('그 본문 네 줄',
  ['1. 장비 외관 및 구동부 점검', '2. 프로브 교정 및 측정 정확도 확인', '3. 소프트웨어 백업', '4. 고객 요청 사항 확인']
    .every(l => SQL.includes(l)))
ok('두 번 돌려도 늘지 않는다', (SQL.match(/where not exists \(/g) ?? []).length >= 2)

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
