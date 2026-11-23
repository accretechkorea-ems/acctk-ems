// 계정 문턱 — **퇴사자 차단**과 **비밀번호 최소 길이** (2026-11-23).
//
//   node scripts/account-guard-check.js
//
// 지키는 약속
//   ① 퇴사 판정은 lib/accountRules.ts 하나다 — 날짜가 들어 있으면 퇴사다(미래 날짜도).
//   ② 막는 자리가 **넷**이다: 로그인 · 세션 갱신 · 화면 이동(미들웨어) · 서버 라우트.
//      서버 라우트는 **401**(종전 403) 이고 글자는 「퇴사 처리된 계정입니다」다.
//   ③ 비밀번호 최소 길이는 **생성·변경 모두 8**이다(종전 8/6).
//   ④ 팀 권한 체크 목록은 그 팀의 **사업부 메뉴만** 보여 준다.
//
// 키 없이 돈다 — loadCaller 는 스텁(opts.deps)으로 돌리고, 나머지는 글자 검사다.

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

const A = load(path.join(ROOT, 'lib/accountRules.ts'))
const CALLER = load(path.join(ROOT, 'lib/apiCaller.ts'))
const { checkableGroups, CHECKABLE_MENUS, menuDivision } = load(path.join(ROOT, 'lib/menuPerms.ts'))

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

console.log('\n── ① 퇴사 판정 ──')
ok('날짜가 있으면 퇴사', A.isResigned({ resigned_date: '2026-10-31' }))
ok('미래 날짜도 퇴사로 본다', A.isResigned({ resigned_date: '2099-12-31' }))
ok('빈 값은 재직', A.isResigned({ resigned_date: null }) === false)
ok('칸이 없어도 재직', A.isResigned({}) === false)
ok('행이 없으면 재직으로 보지 않는다(판정 대상이 아니다)', A.isResigned(null) === false)
eq('문구', A.RESIGNED_MESSAGE, '퇴사 처리된 계정입니다')
eq('돌아가는 주소의 까닭', A.RESIGNED_REASON, 'resigned')

console.log('\n── ② 서버 라우트 — 퇴사 계정 401 ──')
const ROW = (over) => ({
  engineer_id: 7, name: '홍길동', position: '선임', email: 'a@x.com',
  permission_level: 'member', teams: '영업', resigned_date: null,
  ...over,
})
const stub = (row) => ({
  session: async () => ({ auth: { getUser: async () => ({ data: { user: { email: 'a@x.com' } } }) } }),
  admin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }),
  }),
  withTeamPerm: async (r) => ({ ...r, perm: { menus: new Set(['customers']), division: '계측', inSalesStats: true, canSwitchDivision: false } }),
  cronSecret: () => 'secret',
})
const req = (method) => ({ method, headers: { get: () => null } })
const statusOf = async (res) => res.status

;(async () => {
  {
    const r = await CALLER.loadCaller({ kind: 'login' }, { tag: 't', req: req('POST'), deps: stub(ROW({ resigned_date: '2026-10-31' })) })
    eq('퇴사자는 401', await statusOf(r.error), 401)
    eq('문구도 같다', (await r.error.json()).error, A.RESIGNED_MESSAGE)
  }
  {
    const r = await CALLER.loadCaller({ kind: 'superadmin' }, { tag: 't', req: req('POST'), deps: stub(ROW({ resigned_date: '2026-10-31', permission_level: 'superadmin' })) })
    eq('퇴사한 관리자도 401', await statusOf(r.error), 401)
  }
  {
    const r = await CALLER.loadCaller({ kind: 'login' }, { tag: 't', req: req('GET'), deps: stub(ROW()) })
    ok('재직자는 통과한다', r.error === null && r.caller?.engineer_id === 7)
  }
  {
    const s = stub(null)
    const r = await CALLER.loadCaller({ kind: 'login' }, { tag: 't', req: req('GET'), deps: s })
    eq('행이 없으면 종전대로 403', await statusOf(r.error), 403)
  }

  console.log('\n── ③ 막는 자리 넷(글자 검사) ──')
  const MW = fs.readFileSync(path.join(ROOT, 'middleware.ts'), 'utf8')
  const ME = fs.readFileSync(path.join(ROOT, 'lib/appData/me.ts'), 'utf8')
  const LOGIN = fs.readFileSync(path.join(ROOT, 'app/login/page.tsx'), 'utf8')
  const API = fs.readFileSync(path.join(ROOT, 'lib/apiCaller.ts'), 'utf8')
  ok('미들웨어가 재직 여부를 본다', /from\('engineers'\)[\s\S]{0,120}resigned_date/.test(MW))
  ok('미들웨어는 세션을 지우고 로그인으로 보낸다',
    MW.includes('auth.signOut()') && MW.includes('RESIGNED_REASON'))
  ok('미들웨어는 조회 실패에 재직자를 쫓아내지 않는다(isResigned 만 본다)', MW.includes('isResigned(data)'))
  ok('세션 갱신에서 본인 정보를 주지 않는다', /isResigned\([\s\S]{0,200}me: null, error: RESIGNED_MESSAGE/.test(ME))
  ok('로그인 화면이 들여보내지 않는다',
    LOGIN.includes('meError === RESIGNED_MESSAGE') && LOGIN.includes('auth.signOut()'))
  ok('로그인 화면에 돌아온 까닭 안내가 있다', LOGIN.includes('resignedOut'))
  ok('서버 라우트는 한 자리에서 막는다(isResigned)', API.includes('isResigned(row)'))
  ok('네 자리가 같은 모듈을 읽는다',
    [MW, ME, LOGIN, API].every(src => src.includes("@/lib/accountRules")))

  console.log('\n── ④ 비밀번호 최소 길이 ──')
  eq('최소 길이 8', A.PASSWORD_MIN, 8)
  ok('8자는 통과', A.isPasswordLongEnough('12345678'))
  ok('7자는 거절', A.isPasswordLongEnough('1234567') === false)
  ok('빈 값·없는 값도 거절', !A.isPasswordLongEnough('') && !A.isPasswordLongEnough(null))
  ok('공백도 글자로 센다(앞뒤를 지우지 않는다)', A.isPasswordLongEnough('        '))
  const CREATE = fs.readFileSync(path.join(ROOT, 'app/api/create-user/route.ts'), 'utf8')
  const ACCOUNT = fs.readFileSync(path.join(ROOT, 'app/account/page.tsx'), 'utf8')
  ok('계정 생성이 같은 함수를 쓴다', CREATE.includes('isPasswordLongEnough(password)'))
  ok('본인 변경도 같은 함수를 쓴다', ACCOUNT.includes('isPasswordLongEnough(newPassword)'))
  ok('6자 기준이 남아 있지 않다',
    !/6자 이상/.test(ACCOUNT) && !/length < 6/.test(ACCOUNT), '6자 문구가 남았다')

  console.log('\n── ⑤ 팀 권한 체크 목록 — 사업부로 거른다 ──')
  const all = checkableGroups()
  const measure = checkableGroups('계측')
  const semi = checkableGroups('반도체')
  const keysOf = (gs) => gs.flatMap(g => g.items.map(i => i.key))
  ok('사업부를 주지 않으면 전부(종전 동작)', keysOf(all).length === CHECKABLE_MENUS.length)
  ok('계측 목록에 반도체 전용 메뉴가 없다', !keysOf(measure).includes('contact_semi'),
    '접촉 보고서가 계측 팀 화면에 보인다')
  ok('반도체 목록에는 있다', keysOf(semi).includes('contact_semi'))
  ok('공통 메뉴는 양쪽에 있다',
    CHECKABLE_MENUS.filter(m => menuDivision(m) === '공통').every(m =>
      keysOf(measure).includes(m.key) && keysOf(semi).includes(m.key)))
  ok('계측 + 반도체 = 전부(빠지는 메뉴가 없다)',
    new Set([...keysOf(measure), ...keysOf(semi)]).size === CHECKABLE_MENUS.length)
  const ADMIN = fs.readFileSync(path.join(ROOT, 'app/admin/page.tsx'), 'utf8')
  ok('관리 화면이 그 팀의 사업부를 넘긴다',
    ADMIN.includes('toDivision(permEditTeam.division)'))
  ok('새 팀 폼은 계측으로 그린다(teams.division 기본값)',
    ADMIN.includes("permCheckboxes(newTeamPerm, setNewTeamPerm, '계측')"))

  console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
  process.exit(fails === 0 ? 0 : 1)
})()
