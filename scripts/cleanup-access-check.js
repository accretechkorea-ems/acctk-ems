// 사업장 정리 — **담당자가 자기 회사를 고칠 수 있다** (2026-11-23).
//
//   node scripts/cleanup-access-check.js
//
// ── 왜 ──────────────────────────────────────────────────────────────────────
// 「정리 필요 820곳」이 쌓인 까닭은 고칠 사람이 한 명이었기 때문이다. 고치는 일은
// 고객사를 보는 사람이면 하게 하고, **지우는 일만** 슈퍼관리자로 남긴다.
//
// 지키는 약속
//   ① 고치는 길은 전부 고객사 메뉴 문턱이다(member 가 지난다).
//   ② 지우는 길 넷 + 사업장 삭제는 슈퍼관리자 문턱이다.
//   ③ 지울 수 없는 사람에게는 「삭제」 대신 「삭제 요청」이 선다 — 화면과 라우트가 같은 말을 한다.
//   ④ 삭제 요청은 아무것도 지우지 않는다. 사건 한 줄과 슈퍼관리자 알림만 남긴다.
//   ⑤ 병합 창은 고르기 전에 한 줄, 실행 전에 숫자 한 줄을 보여 준다.

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
const L = load(path.join(ROOT, 'lib/customerList.ts'))
const EV = load(path.join(ROOT, 'lib/customerEvents.ts'))
const V = load(path.join(ROOT, 'lib/customerEventView.ts'))

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

const PC = read('app/api/parent-company/route.ts')
const CC = read('app/api/customer-change/route.ts')
const CD = read('app/api/customer-delete/route.ts')

console.log('\n── ① 고치는 길 — 고객사 메뉴 문턱 ──')
// 회사 수준(이름·병합·전환·삭제)만 superadmin 이고, 나머지는 사업장 수준이다.
ok('사업장 수준이 셋이다(rename-site·move·merge-sites)',
  /const SITE_LEVEL = new Set\(\['rename-site', 'move', 'merge-sites'\]\)/.test(PC))
ok('그 셋은 고객사 메뉴로 지난다',
  /SITE_LEVEL\.has\(action\)[\s\S]{0,120}kind: 'menu', keys: \['customers'\]/.test(PC))
ok('나머지는 슈퍼관리자다', /: await loadCaller\(\{ kind: 'superadmin' \}, \{ tag: 'parent-company'/.test(PC))

// 바꾸는 라우트는 통째로 로그인 문턱이다 — 상태·대리점·분류·사업장·담당자·장비가 모두 여기 있다.
ok('바꾸는 길은 로그인이면 된다', /loadCaller\(\{ kind: 'login' \}, \{ tag: TAG/.test(CC))
for (const a of ['site-status', 'site-agency', 'company-industry', 'company-edit', 'site-edit', 'contact-add', 'contact-edit', 'device-add', 'device-edit']) {
  ok(`바꾸는 길에 ${a} 가 있다`, CC.includes(`'${a}'`))
}

console.log('\n── ② 지우는 길 — 슈퍼관리자 ──')
ok('지우기 라우트의 기본 문턱이 슈퍼관리자',
  /: await loadCaller\(\{ kind: 'superadmin' \}, \{ tag: TAG, req, method: 'POST' \}\)/.test(CD))
// 2026-11-25 — **지우기와 세기도** 고객사 메뉴로 내려왔다(지시). 지우기는 숨기기이고
// 누가·왜가 사건으로 남으며 관리자가 되돌릴 수 있어, 문턱을 낮춰도 잃는 것이 없다.
// 되살리기와 숨긴 목록은 그대로 관리 쪽이다 — 아래 ②-ⓑ 가 그것을 본다.
ok('요청·목록·세기·지우기가 고객사 메뉴로 내려온다',
  /const MEMBER_ACTIONS = new Set\(\['request', 'list-requests', 'counts', 'delete'\]\)/.test(CD))
ok('되살리기·숨긴 목록은 관리 메뉴다',
  /const ADMIN_ACTIONS = new Set\(\['restore', 'list-deleted'\]\)/.test(CD)
  && /ADMIN_ACTIONS\.has\(action\)\s*\n\s*\? await loadCaller\(\{ kind: 'menu', keys: \['admin'\] \}/.test(CD))
for (const a of ['rename', 'merge', 'convert-agency', 'delete']) {
  ok(`회사 수준 ${a} 는 SITE_LEVEL 에 없다`, !new RegExp(`SITE_LEVEL = new Set\\(\\[[^\\]]*'${a}'`).test(PC))
}

console.log('\n── ③ 화면과 라우트가 같은 말을 한다 ──')
const PAGE = read('app/page.tsx')
// 2026-11-27(묶음6 4) — 「정리 필요」 탭을 걷으면서 그 안의 셋이 제자리를 찾아갔다:
//   회사 삭제   → **회사 수정 창 바닥줄 왼쪽**(4-2)
//   삭제 요청   → **걷었다**(4-3 — 미처리 0건을 확인하고)
//   삭제됨 복구 → **관리 메뉴의 임시 카드**(4-4)
ok('회사 삭제는 수정 창 바닥줄 왼쪽이다', /onDelete=\{onDelete \? /.test(read('components/home/list/CompanyPane.tsx')) || /onDelete=\{onDeleteCompany \? /.test(read('components/home/list/CompanyPane.tsx')))
ok('지울 수 없으면 꺼진 채로 까닭을 띄운다', /deleteBlockedReason/.test(read('components/home/list/CompanyEditModal.tsx')))
ok('지우는 길은 사업장 삭제와 같은 확인 창을 쓴다', /onDeleteCompany=\{\(id, name\) => deleteEmptyCompany\(id, name\)\}/.test(read('app/page.tsx')))
// 2026-11-25 — 화면도 라우트와 같이 **누구에게나** 넘긴다. 그래서 「삭제 요청」 자리는
// 서지 않는다 — 길(라우트·창·꼬리표)은 그대로 남아 있다(다시 좁히면 그 자리가 돌아온다).
ok('화면이 누구에게나 지우기를 넘긴다',
  /onDeleteCompany=\{\(id, name\) => deleteEmptyCompany\(id, name\)\}/.test(PAGE))
// 화면의 길만 걷었다 — **라우트와 지난 사건은 그대로**다(되살릴 때 그대로 쓴다).
ok('삭제 요청 라우트는 그대로 살아 있다', /action === 'request'/.test(read('app/api/customer-delete/route.ts')))
ok('화면에서는 삭제 요청을 걷었다', !/DeleteRequestModal/.test(read('app/page.tsx')))
ok('요청 꼬리표도 함께 걷었다', !/deleteRequested/.test(read('components/home/list/CustomerListPanel.tsx')))
eq('버튼 글자', [D.DELETE_REQUEST_LABEL, D.DELETE_REQUESTED_LABEL], ['삭제 요청', '삭제 요청됨'])

console.log('\n── ③-ⓑ 영문명은 회사 줄 한 칸이다 ──')
// 영문명은 아래 사업장 이름을 다시 만들지 않는다 — 회사명과 같은 문턱에 둘 까닭이 없다.
ok('바꾸는 길이 영문명을 받는다', /patch\.name_en = String/.test(CC))
const CE = read('components/home/list/CompanyEditModal.tsx')
ok('창은 회사명만 잠근다',
  CE.includes('회사명은 슈퍼관리자만 바꿀 수 있습니다') && !CE.includes('회사명·영문명은 슈퍼관리자만'))
ok('영문명 칸은 잠기지 않는다', /<input value=\{form\.nameEn\} disabled=\{isSaving\}/.test(CE))
const CP = read('components/home/list/CompanyPane.tsx')
ok('영문명만 바뀌면 슈퍼관리자 라우트를 거치지 않는다',
  /if \(nameChanged\) \{/.test(CP) && /enChanged && !nameChanged/.test(CP))

console.log('\n── ④ 삭제 요청 ──')
eq('까닭이 없으면 못 보낸다', D.requestBlockedReason('   ', false), '지워야 하는 까닭을 적어주세요')
eq('적었으면 보낸다', D.requestBlockedReason('중복 줄입니다', false), null)
eq('보내는 중에는 막는다', D.requestBlockedReason('중복 줄입니다', true), '보내는 중입니다')
eq('너무 길면 막는다', D.requestBlockedReason('가'.repeat(D.DELETE_REASON_MAX + 1), false),
  `까닭은 ${D.DELETE_REASON_MAX}자까지 적을 수 있습니다`)
ok('사건 종류가 있다', EV.isChangeEvent('company_delete_requested') === false
  && JSON.stringify(EV.CHANGE_EVENT_TYPES).includes('company_delete_requested') === false)
eq('활동 이력 한 줄', V.eventLine({
  id: 1, customer_id: 1, event_type: 'company_delete_requested', occurred_at: 'x',
  actor_engineer_id: 1, payload: { name: '가나상사', reason: '중복 줄입니다' },
}).label, '삭제 요청')
ok('회사만 요청할 수 있다', /if \(target !== 'company'\) return bad\('회사만 삭제 요청할 수 있습니다'\)/.test(CD))
ok('사업장이 남아 있으면 막는다', /action === 'request'[\s\S]{0,900}사업장 \$\{count\}곳이 묶여 있습니다/.test(CD))
ok('슈퍼관리자 전원에게 알린다',
  /permission_level', 'superadmin'[\s\S]{0,400}from\('notifications'\)\.insert/.test(CD))
ok('알림이 실패해도 요청은 남는다', /if \(notiErr\) console\.error/.test(CD))

console.log('\n── ⑤ 병합 창의 말 ──')
eq('고르기 전 한 줄', L.MERGE_ADVICE,
  '장비가 많은 줄을 남기고, 이름이 더 정확한 쪽으로 이름을 맞추세요. 병합은 되돌릴 수 없습니다.')
eq('실행 전 숫자 — 장비와 기록이 다 있을 때', L.mergeSummary(2, 2, 17), '3곳 → 1곳, 장비 2대·기록 17건 이동')
eq('장비만', L.mergeSummary(1, 3, 3), '2곳 → 1곳, 장비 3대·기록 3건 이동')
eq('옮길 것이 없을 때', L.mergeSummary(1, 0, 0), '2곳 → 1곳, 옮길 기록 없음')
const MERGE = read('components/home/list/SiteMergeModal.tsx')
ok('창이 그 두 줄을 쓴다', MERGE.includes('MERGE_ADVICE') && MERGE.includes('mergeSummary('))
ok('숫자는 장비 수를 보고서에서 꺼낸다', /report\.moved\?\.\['devices\.customer_id'\] \?\? 0/.test(MERGE))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
