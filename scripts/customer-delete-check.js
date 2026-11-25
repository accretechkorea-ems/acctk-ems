// 지우기 — **전부 소프트**, 사유 필수, 되돌릴 수 있다 (2026-11-23).
//
//   node scripts/customer-delete-check.js
//
// 지키는 약속
//   ① 지우기는 deleted_at 을 채우는 **한 문장**이다 — 중간이 없다(부분 삭제가 불가능하다).
//   ② 하드 DELETE 가 남아 있지 않다 — 사업장·회사·대리점·담당자·장비 어디에도.
//   ③ 까닭이 없으면 못 지운다.
//   ④ 모달은 「지우지 말고 이탈로 바꾸세요」를 먼저 말하고, 무엇이 함께 숨는지 센다.
//     그 말을 한 창에 **그 길**(「이탈로 바꾸기」)이 함께 있다(2026-11-25).
//   ⑤ 되돌리기는 정리 필요 탭의 「삭제됨」 소탭에 있다.
//   ⑥ 문턱(2026-11-25 에 낮췄다) — 지우기·세기는 **고객사 메뉴**, 되살리기·숨긴 목록은
//     **관리 메뉴**다. 화면의 삭제 단추도 같은 말을 한다(보이는데 403 인 자리를 만들지 않는다).

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

const D = load(path.join(ROOT, 'lib/customerDelete.ts'))
const { CLEANUP_LABEL } = load(path.join(ROOT, 'components/home/list/CustomerListPanel.tsx'))

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

console.log('\n── ① 대상과 글자 ──')
eq('지울 수 있는 것 다섯', [...D.DELETE_TARGETS], ['site', 'company', 'agency', 'contact', 'device'])
eq('이름', D.DELETE_TARGETS.map(t => D.TARGET_LABEL[t]), ['사업장', '회사', '대리점', '담당자', '장비'])
// ── 경고문(2026-11-25 지시) ───────────────────────────────────────────────
// 지우기를 로그인한 사람 전부에게 열었다. 문턱이 낮아지면 **창이 하는 말**이 유일한
// 제동이다 — 넷을 다 말해야 한다: ① 묻고 ② 대신 할 일 ③ 써도 되는 경우 ④ 자국.
eq('먼저 하는 말', D.DELETE_ADVICE,
  '정말 삭제할까요? 거래가 끊긴 업체는 삭제하지 말고 상태를 「이탈」로 바꿔 주세요. '
  + '삭제는 잘못 등록했거나 중복된 경우에만 사용합니다. '
  + '삭제한 업체는 관리자가 복구할 수 있고, 누가 언제 어떤 사유로 삭제했는지 기록에 남습니다.')
for (const [what, word] of [['묻는다', '정말 삭제할까요'], ['대신 할 일', '「이탈」로 바꿔'],
  ['쓸 때를 좁힌다', '잘못 등록했거나 중복'], ['자국이 남는다', '기록에 남습니다']]) {
  ok(`경고문이 ${what}`, D.DELETE_ADVICE.includes(word))
}
eq('담당자는 한 줄', D.adviceFor('contact'), '담당자를 삭제합니다. 기록에 남습니다.')
ok('장비도 한 줄이고 폐기를 가리킨다',
  D.adviceFor('device').includes('폐기 처리') && D.adviceFor('device').length < 60)
for (const t of ['site', 'company', 'agency']) {
  eq(`${t} 는 업체의 말을 쓴다`, D.adviceFor(t), D.DELETE_ADVICE)
}
ok('되돌릴 수 있다고 적는다', /되돌릴 수 있습니다/.test(D.DELETE_NOTE))
ok('되돌리는 사람은 관리자다(슈퍼관리자만이 아니다)',
  /관리자가 되돌릴/.test(D.DELETE_NOTE) && !/슈퍼관리자/.test(D.DELETE_NOTE))

console.log('\n── ①-ⓑ 대신 할 일 — 「이탈로 바꾸기」 ──')
eq('버튼 글자', D.LEAVE_LABEL, '이탈로 바꾸기')
eq('그 버튼이 만드는 상태', D.LEAVE_STATUS, '이탈')
const MODAL = fs.readFileSync(path.join(ROOT, 'components/home/list/DeleteCustomerModal.tsx'), 'utf8')
ok('창이 넘겨받을 때만 그 버튼을 낸다', /onLeave\?: \(\) => void/.test(MODAL) && /\{onLeave && \(/.test(MODAL))
ok('그 버튼은 사유 칸 **아래**다',
  MODAL.indexOf('DELETE_REASON_MAX)') < MODAL.indexOf('{LEAVE_LABEL}'))
ok('창은 대상마다 다른 말을 한다(adviceFor)', /\{adviceFor\(target\)\}/.test(MODAL))
// 담당자·장비는 **세는 쪽이 없다** — 그런데도 「연결된 기록을 세는 중…」이 끝까지 떠
// 있었다(2026-11-25). 세는 대상(업체 셋)일 때만 그 줄을 낸다.
ok('세지 않는 대상에는 「세는 중」 줄이 없다',
  /const counting = counts === null && \(target === 'site' \|\| target === 'company' \|\| target === 'agency'\)/.test(MODAL)
  && /\{counting \? \(/.test(MODAL))
ok('장비·담당자 창은 counts 를 받지 않는다',
  (fs.readFileSync(path.join(ROOT, 'components/customer/CustomerDetailBody.tsx'), 'utf8')
    .match(/counts=\{null\}/g) || []).length === 2)
const CRUD = fs.readFileSync(path.join(ROOT, 'hooks/customer/useCustomerCrud.ts'), 'utf8')
ok('이탈은 **상태 바꾸기 라우트**를 쓴다(사건도 그쪽이 남긴다)',
  /action: 'site-status', ids: \[customer\.customer_id\], status: LEAVE_STATUS/.test(CRUD))
ok('이탈로 바꾸면 창이 닫힌다', /leaveSite = async[\s\S]{0,700}setDeleteOpen\(false\)/.test(CRUD))
const BODY = fs.readFileSync(path.join(ROOT, 'components/customer/CustomerDetailBody.tsx'), 'utf8')
ok('사업장 창에만 넘긴다(장비·담당자 창에는 없다)',
  (BODY.match(/onLeave=/g) || []).length === 1
  && /target="site"[\s\S]{0,600}onLeave=\{\(\) => void customerCrud\.leaveSite\(\)\}/.test(BODY))

console.log('\n── ② 함께 숨는 것 ──')
const counts = { ...D.EMPTY_COUNTS, activity: 3, service: 1, device: 2 }
eq('0 인 것은 적지 않는다', D.hiddenWithText(counts), '영업활동 3 · 서비스 1 · 장비 2 가 함께 숨겨집니다')
eq('하나도 없으면 빈 글자', D.hiddenWithText(D.EMPTY_COUNTS), '')
ok('하나라도 있으면 true', D.hasLinked(counts) && !D.hasLinked(D.EMPTY_COUNTS))
eq('세는 차례', D.COUNT_LABELS.map(c => c.label), ['영업활동', '서비스', '견적', '의뢰', '장비', '담당자'])

console.log('\n── ③ 까닭이 없으면 못 지운다 ──')
eq('빈 까닭', D.deleteBlockedReason('', false), '지우는 까닭을 적어주세요')
eq('공백만', D.deleteBlockedReason('   ', false), '지우는 까닭을 적어주세요')
eq('적었으면 통과', D.deleteBlockedReason('폐업 확인', false), null)
eq('너무 길면 막는다', D.deleteBlockedReason('가'.repeat(D.DELETE_REASON_MAX + 1), false),
  `까닭은 ${D.DELETE_REASON_MAX}자까지 적을 수 있습니다`)
eq('지우는 중이면 막는다', D.deleteBlockedReason('폐업', true), '지우는 중입니다')

console.log('\n── ④ 하드 DELETE 가 남아 있지 않다 ──')
const HOOK = fs.readFileSync(path.join(ROOT, 'hooks/customer/useCustomerCrud.ts'), 'utf8')
const CONTACT = fs.readFileSync(path.join(ROOT, 'hooks/customer/useContactCrud.ts'), 'utf8')
const DEVICE = fs.readFileSync(path.join(ROOT, 'hooks/customer/useDeviceCrud.ts'), 'utf8')
const PARENT = fs.readFileSync(path.join(ROOT, 'app/api/parent-company/route.ts'), 'utf8')
const ROUTE = fs.readFileSync(path.join(ROOT, 'app/api/customer-delete/route.ts'), 'utf8')

ok('사업장 상세에 .delete() 가 없다', !/\.delete\(\)/.test(HOOK), '하드 삭제가 남아 있다')
ok('담당자·장비에도 없다', !/\.delete\(\)/.test(CONTACT) && !/\.delete\(\)/.test(DEVICE))
// 주석에는 그 말이 남아 있다(왜 바꿨는지 적어 두었다) — **동작**이 사라졌는지 본다.
ok('「중간에 멈추는」 삭제가 사라졌다',
  !/const abort = async/.test(HOOK) && !/삭제에 실패해 중단했습니다/.test(HOOK),
  '부분 삭제가 가능한 경로가 남아 있다')
ok('회사 줄도 하드로 지우지 않는다', !/\.delete\(\)/.test(PARENT),
  'parent-company 에 하드 삭제가 남아 있다')
ok('지우기 라우트는 update 로만 지운다',
  /const full = \{ deleted_at: now, deleted_by: caller\.engineer_id, delete_reason: reason \}/.test(ROUTE)
  && !/\.delete\(\)/.test(ROUTE))
ok('그 칸이 없는 표에서는 시각만 적는다(42703)',
  /error\.code === '42703' \|\| error\.code === 'PGRST204'/.test(ROUTE)
  && /update\(\{ deleted_at: now \}\)/.test(ROUTE))
ok('되돌리기는 deleted_at 을 비운다', /update\(\{ deleted_at: null, deleted_by: null, delete_reason: null \}\)/.test(ROUTE))

console.log('\n── ⑤ 문턱과 기록 ──')
// 2026-11-25 — 지우기·세기는 고객사 메뉴, 되살리기·숨긴 목록은 관리 메뉴다.
// 그 밖의 작업(요청이 아닌 것)은 슈퍼관리자로 남는다.
ok('지우기는 고객사 메뉴', /'counts', 'delete'/.test(ROUTE))
ok('되살리기·숨긴 목록은 관리 메뉴', /ADMIN_ACTIONS = new Set\(\['restore', 'list-deleted'\]\)/.test(ROUTE))
ok('남은 작업의 문턱은 슈퍼관리자', /loadCaller\(\{ kind: 'superadmin' \}/.test(ROUTE))
ok('까닭이 없으면 400', /지우는 까닭을 적어주세요/.test(ROUTE))
ok('사건을 남긴다', ROUTE.includes('customer_deleted') && ROUTE.includes('customer_restored'))
ok('사업장이 묶인 회사는 숨기지 않는다', /사업장 \$\{count\}곳이 묶여 있습니다/.test(ROUTE))

console.log('\n── ⑥ 되돌릴 자리 ──')
ok('정리 필요 탭에 「삭제됨」 소탭이 있다', CLEANUP_LABEL.deleted === '삭제됨')
const PANEL = fs.readFileSync(path.join(ROOT, 'components/home/list/CustomerListPanel.tsx'), 'utf8')
ok('복구 버튼은 넘겨줄 때만 선다(권한)', /onRestore && \(/.test(PANEL))
const PAGE = fs.readFileSync(path.join(ROOT, 'app/page.tsx'), 'utf8')
ok('복구는 관리 메뉴를 가진 사람에게 넘긴다',
  /const canRestoreCustomer = canViewMenu\(me, 'admin'\)/.test(PAGE)
  && /onRestore=\{canRestoreCustomer \?/.test(PAGE))
ok('지워진 줄 목록은 라우트가 읽어 준다', /action: 'list-deleted'/.test(PAGE) && /list-deleted/.test(ROUTE))

console.log('\n── ⑦ 삭제 단추는 모두에게 선다(2026-11-25) ──')
// 버튼이 보이는데 눌러서 403 이 나는 자리를 만들지 않는다 — 라우트와 화면이 같은 말을 한다.
ok('사업장 수정 창의 삭제', /onDelete=\{customerCrud\.openDeleteCustomer\}/.test(BODY))
ok('담당자 수정 창의 삭제', /onDelete=\{contact\.openDeleteContact\}/.test(BODY))
ok('장비 수정 창의 삭제', /onDelete=\{device\.openDeleteDevice\}/.test(BODY))
ok('슈퍼관리자 판정이 그 셋에 남아 있지 않다',
  !/isSuperAdmin\(\{ permission_level: currentUserRole \}\)/.test(BODY))
ok('담당자 삭제는 대리점 화면에도 열려 있다', /canDeleteContact\n/.test(PAGE) || /canDeleteContact$/m.test(PAGE))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
