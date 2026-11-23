// 지우기 — **전부 소프트**, 사유 필수, 되돌릴 수 있다 (2026-11-23).
//
//   node scripts/customer-delete-check.js
//
// 지키는 약속
//   ① 지우기는 deleted_at 을 채우는 **한 문장**이다 — 중간이 없다(부분 삭제가 불가능하다).
//   ② 하드 DELETE 가 남아 있지 않다 — 사업장·회사·대리점·담당자·장비 어디에도.
//   ③ 까닭이 없으면 못 지운다. 문턱은 슈퍼관리자다.
//   ④ 모달은 「지우지 말고 이탈로 바꾸세요」를 먼저 말하고, 무엇이 함께 숨는지 센다.
//   ⑤ 되돌리기는 정리 필요 탭의 「삭제됨」 소탭에 있다.

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
eq('먼저 하는 말', D.DELETE_ADVICE, '거래가 안 되는 업체는 삭제가 아니라 상태를 이탈로 바꾸세요.')
ok('되돌릴 수 있다고 적는다', /되돌릴 수 있습니다/.test(D.DELETE_NOTE))

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
  /update\(\{ deleted_at: new Date\(\)\.toISOString\(\) \}\)/.test(ROUTE) && !/\.delete\(\)/.test(ROUTE))
ok('되돌리기는 deleted_at 을 비운다', /update\(\{ deleted_at: null \}\)/.test(ROUTE))

console.log('\n── ⑤ 문턱과 기록 ──')
ok('슈퍼관리자만', /loadCaller\(\{ kind: 'superadmin' \}/.test(ROUTE))
ok('까닭이 없으면 400', /지우는 까닭을 적어주세요/.test(ROUTE))
ok('사건을 남긴다', ROUTE.includes('customer_deleted') && ROUTE.includes('customer_restored'))
ok('사업장이 묶인 회사는 숨기지 않는다', /사업장 \$\{count\}곳이 묶여 있습니다/.test(ROUTE))

console.log('\n── ⑥ 되돌릴 자리 ──')
ok('정리 필요 탭에 「삭제됨」 소탭이 있다', CLEANUP_LABEL.deleted === '삭제됨')
const PANEL = fs.readFileSync(path.join(ROOT, 'components/home/list/CustomerListPanel.tsx'), 'utf8')
ok('복구 버튼은 넘겨줄 때만 선다(권한)', /onRestore && \(/.test(PANEL))
const PAGE = fs.readFileSync(path.join(ROOT, 'app/page.tsx'), 'utf8')
ok('복구는 슈퍼관리자에게만 넘긴다', /onRestore=\{canExportExcel \?/.test(PAGE))
ok('지워진 줄 목록은 라우트가 읽어 준다', /action: 'list-deleted'/.test(PAGE) && /list-deleted/.test(ROUTE))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
