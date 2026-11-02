// 권한 판정 시험 — 「이 사람이 이 메뉴·이 영역을 볼 수 있는가」.
//
//   node scripts/permission-check.js
//
// 왜 따로 두는가 — 이 판정이 틀리면 **남의 자료가 보이거나 쓰는 사람이 못 들어간다**. 그런데
// 지금까지 시험이 없었다(docs/audit-2026-10.md D37). 두 가지가 특히 조용히 틀어진다.
//   · **파생 규칙**(DERIVED_PERMS) — 메뉴 하나를 켜면 teams.can_view_* 가 함께 켜지고 RLS 가
//     열린다. 예전에 메뉴에서 영역을 파생하다가 현장 팀 전원이 실적 집계에서 빠진 일이 있었다
//     (lib/permissions.ts 꼬리 주석). 어느 메뉴가 어느 영역을 여는지 여기서 못 박는다.
//   · **등록표**(MENU_PERMS) — 키·경로가 겹치거나 PARENT_MENU 가 없는 키를 가리키면 화면이
//     조용히 막힌다. 사람이 표를 고칠 때 바로 걸리게 한다.
//
// **지금 코드가 내는 답을 그대로 기대값으로 고정한다**(현재 동작의 스냅샷). 고쳐야 할 것이
// 보이면 여기서 고치지 않고 보고에 적는다 — 이 파일은 「동작이 바뀌었다」를 알리는 자리다.

// eslint 의 no-require-imports 는 맨 require() 를 센다. 이 파일은 node 로 직접 돌리는
// CJS 스크립트라 모듈을 그렇게 불러올 수밖에 없다 — 한 번만 묶어 두고 그것만 쓴다.
const load = module.require.bind(module)
const path = load('path')
const Module = load('module')
const ROOT = path.join(__dirname, '..')
const ts = load(path.join(ROOT, 'node_modules/typescript'))

for (const ext of ['.ts', '.tsx']) {
  Module._extensions[ext] = (mod, filename) => {
    mod._compile(ts.transpileModule(load('fs').readFileSync(filename, 'utf8'), {
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

// permissions ↔ menuPerms 는 서로를 import 한다(순환). 둘 다 상대를 함수 안에서만 쓰므로
// 어느 쪽을 먼저 불러도 된다 — 그 사실도 이 하네스가 지키는 것 중 하나다.
const P = load(path.join(ROOT, 'lib/permissions.ts'))
const M = load(path.join(ROOT, 'lib/menuPerms.ts'))
const D = load(path.join(ROOT, 'lib/division.ts'))

let fails = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`)
  if (!ok) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}

/** 사람 하나 — 켜 둔 메뉴 집합과 등급만 있으면 판정된다. */
const who = (menus, level = 'member', extra = {}) => ({
  permission_level: level,
  teams: '어느 팀',
  perm: menus === null ? null : { menus: new Set(menus), division: '계측', inSalesStats: true },
  ...extra,
})
const SUPER = who([], 'superadmin')
const NOBODY = who([])            // 팀은 있는데 켠 메뉴가 없다
const NO_TEAM = who(null)         // 팀 권한을 아직 못 읽었다(로딩 중)

// ════════════════════════════════════════════════════════════════
console.log('── isSuperAdmin ──')
eq("'superadmin' 이면 참", P.isSuperAdmin({ permission_level: 'superadmin' }), true)
eq("'member' 는 거짓", P.isSuperAdmin({ permission_level: 'member' }), false)
eq("폐지된 'manager' 는 member 와 같다", P.isSuperAdmin({ permission_level: 'manager' }), false)
eq('값이 없거나 사람이 없으면 거짓', [
  P.isSuperAdmin({ permission_level: null }), P.isSuperAdmin({}), P.isSuperAdmin(null), P.isSuperAdmin(undefined),
], [false, false, false, false])

console.log('\n── canViewMenu — 공개 메뉴 ──')
eq('홈은 메뉴 권한이 없어도 열린다', P.canViewMenu(NOBODY, 'home'), true)
eq('알림·건의사항도 공개', [P.canViewMenu(NOBODY, 'notifications'), P.canViewMenu(NOBODY, 'suggestions')], [true, true])
eq('공개 메뉴라도 **사람이 없으면** 막는다(로딩 중)', P.canViewMenu(null, 'home'), false)
eq('팀 권한을 못 읽어도 공개 메뉴는 열린다', P.canViewMenu(NO_TEAM, 'home'), true)

console.log('\n── canViewMenu — 없는 키·꺼진 키 ──')
eq('등록표에 없는 키는 거부', P.canViewMenu(NOBODY, 'no_such_menu'), false)
eq('옛 키(requests)도 거부 — 표에서 지웠다', P.canViewMenu(NOBODY, 'requests'), false)
eq('켜지 않은 메뉴는 거부', P.canViewMenu(NOBODY, 'quote'), false)
eq('켠 메뉴는 통과', P.canViewMenu(who(['quote']), 'quote'), true)
eq('다른 메뉴를 켠 것은 통과가 아니다', P.canViewMenu(who(['customers']), 'quote'), false)

console.log('\n── canViewMenu — superadmin 우회 ──')
eq('켠 메뉴가 하나도 없어도 전부 통과', [
  P.canViewMenu(SUPER, 'quote'), P.canViewMenu(SUPER, 'admin'), P.canViewMenu(SUPER, 'contact_semi'),
], [true, true, true])
eq('**없는 키는 superadmin 도 통과한다** — 키를 보지 않고 먼저 돌려준다', P.canViewMenu(SUPER, 'no_such_menu'), true)
eq('숨긴 메뉴(inventory)도 superadmin 은 통과', P.canViewMenu(SUPER, 'inventory'), true)
eq('숨긴 메뉴는 팀원이 켤 수 없어 늘 거짓이다', P.canViewMenu(who(['purchase']), 'inventory'), false)

console.log('\n── 파생 7개(canViewXxx) ──')
eq('고객사 메뉴 → 고객 영역', P.canViewCustomers(who(['customers'])), true)
eq('의뢰서만 켜도 고객 영역이 열린다(RLS 가 그 칸을 본다)', P.canViewCustomers(who(['inquiries'])), true)
eq('견적 메뉴 → 견적 영역, 고객 영역은 아니다', [
  P.canViewQuote(who(['quote'])), P.canViewCustomers(who(['quote'])),
], [true, false])
eq('80 대시보드 → 대시보드·고객·견적 셋', [
  P.canViewDashboard(who(['dashboard_80'])), P.canViewCustomers(who(['dashboard_80'])), P.canViewQuote(who(['dashboard_80'])),
], [true, true, true])
eq('포캐스트 → 포캐스트·고객', [P.canViewPipeline(who(['pipeline'])), P.canViewCustomers(who(['pipeline']))], [true, true])
eq('발주 → 영업관리·견적', [P.canViewSalesMgmt(who(['purchase'])), P.canViewQuote(who(['purchase']))], [true, true])
eq('실적 현황 → 관리·견적', [P.canViewAdmin(who(['sales'])), P.canViewQuote(who(['sales']))], [true, true])
eq('리드 → 리드만', [
  P.canViewLeads(who(['leads'])), P.canViewCustomers(who(['leads'])), P.canViewQuote(who(['leads'])),
], [true, false, false])
eq('접촉 보고서는 어느 영역도 열지 않는다(계측 자료 격리)', [
  P.canViewCustomers(who(['contact_semi'])), P.canViewQuote(who(['contact_semi'])), P.canViewSalesMgmt(who(['contact_semi'])),
], [false, false, false])
eq('**전자결재를 켜면 고객·견적·관리 세 영역이 함께 열린다**', [
  P.canViewCustomers(who(['approvals'])), P.canViewQuote(who(['approvals'])), P.canViewAdmin(who(['approvals'])),
], [true, true, true])
eq('superadmin 은 파생과 무관하게 전부 통과', [
  P.canViewCustomers(SUPER), P.canViewLeads(SUPER), P.canViewAdmin(SUPER),
], [true, true, true])
eq('팀 권한을 못 읽으면 전부 거짓(superadmin 제외)', [
  P.canViewCustomers(NO_TEAM), P.canViewQuote(NO_TEAM), P.canViewCustomers(null),
], [false, false, false])
eq('canViewAll 은 로그인만 본다', [P.canViewAll(NOBODY), P.canViewAll(NO_TEAM), P.canViewAll(null)], [true, true, false])

console.log('\n── canManageEngineers · getViewScope ──')
eq('직원 관리는 superadmin 만', [P.canManageEngineers(SUPER), P.canManageEngineers(who(['admin']))], [true, false])
eq('열람 범위 — superadmin 은 전사', P.getViewScope(SUPER), 'all')
eq('그 밖은 본인 것만', P.getViewScope(who(['admin'])), 'self')
eq('**로딩 중(사람 미확정)은 self** — 모를 때 넓히지 않는다', [P.getViewScope(null), P.getViewScope(undefined)], ['self', 'self'])

// ════════════════════════════════════════════════════════════════
console.log('\n── deriveArea · DERIVED_PERMS ──')
eq('빈 집합은 어느 영역도 아니다', Object.keys(M.DERIVED_PERMS).map(a => M.deriveArea(new Set(), a)),
  [false, false, false, false, false, false, false])
eq('영역 7개 이름', Object.keys(M.DERIVED_PERMS).sort(),
  ['admin', 'customers', 'dashboard', 'leads', 'pipeline', 'quote', 'salesMgmt'])
eq('deriveArea 는 사람이 아니라 집합만 본다(superadmin 예외 없음)', M.deriveArea(new Set(['leads']), 'quote'), false)
eq('고객 영역을 여는 메뉴 목록', [...M.DERIVED_PERMS.customers],
  ['repair_dashboard', 'dashboard_80', 'activity', 'customers', 'repair', 'showroom', 'inquiries', 'pipeline', 'admin', 'approvals'])
eq('견적 영역을 여는 메뉴 목록', [...M.DERIVED_PERMS.quote],
  ['dashboard_80', 'quote', 'purchase', 'sales', 'admin', 'approvals'])
eq('관리 영역을 여는 메뉴 목록', [...M.DERIVED_PERMS.admin], ['sales', 'admin', 'approvals'])
eq('파생 규칙이 가리키는 메뉴 키는 모두 등록표에 있다',
  Object.values(M.DERIVED_PERMS).flat().filter(k => !M.MENU_BY_KEY[k]), [])

console.log('\n── deriveTeamColumns · TEAM_PERM_COLUMN 왕복 ──')
eq('빈 집합 → 7칸 모두 false', M.deriveTeamColumns(new Set()), {
  can_view_customers: false, can_view_quote: false, can_view_sales_mgmt: false,
  can_view_dashboard: false, can_view_pipeline: false, can_view_leads: false, can_view_admin: false,
})
eq('관리 메뉴 하나 → 고객·견적·영업관리·관리 네 칸', M.deriveTeamColumns(new Set(['admin'])), {
  can_view_customers: true, can_view_quote: true, can_view_sales_mgmt: true,
  can_view_dashboard: false, can_view_pipeline: false, can_view_leads: false, can_view_admin: true,
})
eq('전자결재 하나 → 고객·견적·관리 세 칸', M.deriveTeamColumns(new Set(['approvals'])), {
  can_view_customers: true, can_view_quote: true, can_view_sales_mgmt: false,
  can_view_dashboard: false, can_view_pipeline: false, can_view_leads: false, can_view_admin: true,
})
eq('칸 이름 7개가 영역 7개를 모두 덮는다',
  Object.keys(M.DERIVED_PERMS).filter(a => !M.TEAM_PERM_COLUMN[a]), [])
eq('칸 이름에 중복이 없다',
  new Set(Object.values(M.TEAM_PERM_COLUMN)).size, Object.keys(M.TEAM_PERM_COLUMN).length)
eq('왕복 — 각 영역의 첫 메뉴를 켜면 그 영역 칸이 켜진다',
  Object.keys(M.DERIVED_PERMS).map(a => M.deriveTeamColumns(new Set([M.DERIVED_PERMS[a][0]]))[M.TEAM_PERM_COLUMN[a]]),
  [true, true, true, true, true, true, true])

console.log('\n── menuKeyForPath ──')
eq('고객사 목록(/)', M.menuKeyForPath('/'), 'customers')
eq('견적(/quote)', M.menuKeyForPath('/quote'), 'quote')
eq('홈은 공개 메뉴', M.menuKeyForPath('/dashboard'), M.PUBLIC_MENU)
eq('전자결재는 menuPublic — 공개로 돌려준다', M.menuKeyForPath('/approval'), M.PUBLIC_MENU)
eq('숨긴 재고는 **발주 권한으로** 판정한다(permKey)', M.menuKeyForPath('/inventory'), 'purchase')
eq('끝 슬래시는 떼고 본다', M.menuKeyForPath('/quote/'), 'quote')
eq('하위 화면은 딸린 메뉴로(PARENT_MENU)', [
  M.menuKeyForPath('/customer/1363'), M.menuKeyForPath('/inquiries/7'), M.menuKeyForPath('/holdings'),
], ['customers', 'inquiries', 'dashboard_80'])
eq('접촉 보고서 하위 두 경로', [
  M.menuKeyForPath('/contact/semi/12'), M.menuKeyForPath('/contact/semi/12/write'),
], ['contact_semi', 'contact_semi'])
eq('본인 정보·결재 문서는 로그인만', [
  M.menuKeyForPath('/account'), M.menuKeyForPath('/approval/doc/55'),
], [M.PUBLIC_MENU, M.PUBLIC_MENU])
eq('등록되지 않은 경로는 null — 가드가 막는다', [
  M.menuKeyForPath('/no-such-page'), M.menuKeyForPath('/customer'), M.menuKeyForPath('/customer/1/extra'),
], [null, null, null])
eq('menuForPath 는 공개 메뉴도 메뉴로 돌려준다', [
  M.menuForPath('/dashboard').key, M.menuForPath('/approval').key, M.menuForPath('/customer/1363').key,
], ['home', 'approvals', 'customers'])
eq('menuForPath — 로그인만 열리는 경로는 null', M.menuForPath('/account'), null)

console.log('\n── visibleMenus ──')
eq('켠 메뉴가 없어도 주 메뉴는 홈·알림·전자결재', M.visibleMenus('주 메뉴', NOBODY).map(m => m.key),
  ['home', 'notifications', 'approvals'])
eq('사람이 없으면 아무것도 안 보인다', M.visibleMenus('주 메뉴', null).map(m => m.key), [])
eq('고객 묶음 — 켠 것만, order 순', M.visibleMenus('고객', who(['showroom', 'customers'])).map(m => m.key),
  ['customers', 'showroom'])
eq('superadmin 은 고객 묶음 전부', M.visibleMenus('고객', SUPER).map(m => m.key),
  ['customers', 'repair', 'showroom', 'inquiries'])
eq('**숨긴 메뉴는 superadmin 에게도 안 보인다**', M.visibleMenus('주문', SUPER).map(m => m.key), ['purchase'])
eq('사업부를 주면 그 사업부+공통만', [
  M.visibleMenus('영업', SUPER, '계측').map(m => m.key),
  M.visibleMenus('영업', SUPER, '반도체').map(m => m.key),
], [['leads', 'pipeline', 'quote'], ['contact_semi']])
eq('건의사항은 공통이라 두 사업부에서 보인다', [
  M.visibleMenus('하단', NOBODY, '계측').map(m => m.key), M.visibleMenus('하단', NOBODY, '반도체').map(m => m.key),
], [['suggestions'], ['suggestions']])

console.log('\n── 등록표 무결성 ──')
eq('키 중복 없음', M.MENU_PERMS.length, new Set(M.MENU_PERMS.map(m => m.key)).size)
eq('경로 중복 없음', M.MENU_PATHS.length, new Set(M.MENU_PATHS).size)
eq('MENU_BY_KEY 가 표 전체를 담는다', Object.keys(M.MENU_BY_KEY).length, M.MENU_PERMS.length)
eq('PARENT_MENU 가 가리키는 키는 모두 있는 메뉴이거나 public',
  Object.values(M.PARENT_MENU).filter(k => k !== M.PUBLIC_MENU && !M.MENU_BY_KEY[k]), [])
eq('모든 메뉴의 묶음이 MENU_GROUPS 에 있다',
  M.MENU_PERMS.filter(m => !M.MENU_GROUPS.some(g => g.group === m.group)).map(m => m.key), [])
eq('public 과 menuPublic 을 함께 켠 메뉴는 없다',
  M.MENU_PERMS.filter(m => m.public && m.menuPublic).map(m => m.key), [])
eq('숨긴 메뉴에는 permKey 가 있다(권한 행이 사라져도 막히지 않게)',
  M.MENU_PERMS.filter(m => m.hidden && !m.permKey).map(m => m.key), [])
eq('permKey 가 가리키는 키는 등록표에 있다',
  M.MENU_PERMS.filter(m => m.permKey && !M.MENU_BY_KEY[m.permKey]).map(m => m.key), [])
eq('체크 대상 — 공개·숨김·permKey 를 뺀 것', M.CHECKABLE_MENUS.map(m => m.key),
  ['approvals', 'repair_dashboard', 'dashboard_80', 'activity', 'customers', 'repair', 'showroom',
    'inquiries', 'leads', 'pipeline', 'quote', 'contact_semi', 'purchase', 'sales', 'admin'])
eq('menuPublic(전자결재)은 체크 대상에 남는다 — 「전체 결재 조회」를 잠근다',
  M.CHECKABLE_MENUS.some(m => m.key === 'approvals'), true)
eq('공개 메뉴(홈·알림·건의사항)는 체크 대상이 아니다',
  M.CHECKABLE_MENUS.filter(m => ['home', 'notifications', 'suggestions'].includes(m.key)), [])
eq('묶음별 체크 목록은 묶음 순서대로, 빈 묶음은 빠진다', M.checkableGroups().map(g => g.group),
  ['주 메뉴', '대시보드', '고객', '영업', '주문', '관리'])
eq('묶음 안은 order 순', M.checkableGroups().map(g => g.items.map(i => i.order).every((v, i, a) => i === 0 || a[i - 1] <= v)),
  [true, true, true, true, true, true])
eq('data 영역 이름은 세 가지뿐(RLS 가 묻는 것)',
  [...new Set(M.MENU_PERMS.flatMap(m => m.data))].sort(), ['customers', 'quote', 'sales_mgmt'])
eq('menuDivision — 적지 않으면 계측', [
  M.menuDivision(M.MENU_BY_KEY.home), M.menuDivision(M.MENU_BY_KEY.contact_semi), M.menuDivision(M.MENU_BY_KEY.suggestions),
], ['계측', '반도체', '공통'])

// ════════════════════════════════════════════════════════════════
console.log('\n── 사업부(division) ──')
const semiTeam = { menus: new Set(['contact_semi']), division: '반도체', inSalesStats: true }
const gaugeTeam = { menus: new Set(['contact_semi']), division: '계측', inSalesStats: true }
eq('toDivision — 아는 값은 그대로', [D.toDivision('계측'), D.toDivision('반도체')], ['계측', '반도체'])
eq('toDivision — 모르는 값·빈 값은 계측', [
  D.toDivision(null), D.toDivision(undefined), D.toDivision(''), D.toDivision('영업'), D.toDivision(3),
], ['계측', '계측', '계측', '계측', '계측'])
eq('isDivision', [D.isDivision('계측'), D.isDivision('반도체'), D.isDivision('물류')], [true, true, false])
eq('teamDivisionOf — 팀의 사업부', D.teamDivisionOf({ perm: semiTeam }), '반도체')
eq('teamDivisionOf — 팀이 없으면 계측', [
  D.teamDivisionOf({ perm: null }), D.teamDivisionOf({}), D.teamDivisionOf(null),
], ['계측', '계측', '계측'])
eq('canSwitchDivision — superadmin + 전환 권한', [
  D.canSwitchDivision({ permission_level: 'superadmin', can_switch_division: true }),
  D.canSwitchDivision({ permission_level: 'superadmin', can_switch_division: false }),
  D.canSwitchDivision({ permission_level: 'superadmin' }),
  D.canSwitchDivision({ permission_level: 'member', can_switch_division: true }),
], [true, false, false, false])
eq('접촉 보고서 — 반도체 팀 + 메뉴 권한', D.canAccessSemiContact({ permission_level: 'member', perm: semiTeam }), true)
eq('반도체 팀인데 메뉴를 안 켰으면 거짓',
  D.canAccessSemiContact({ permission_level: 'member', perm: { ...semiTeam, menus: new Set() } }), false)
eq('계측 팀은 메뉴를 켜도 거짓', D.canAccessSemiContact({ permission_level: 'member', perm: gaugeTeam }), false)
eq('**전환 권한 없는 superadmin 이 계측 팀이면 막힌다**',
  D.canAccessSemiContact({ permission_level: 'superadmin', perm: gaugeTeam }), false)
eq('전환 권한 있는 superadmin 은 팀과 무관하게 통과',
  D.canAccessSemiContact({ permission_level: 'superadmin', can_switch_division: true, perm: gaugeTeam }), true)
eq('반도체 팀 superadmin 은 메뉴 권한이 늘 통과라 열린다',
  D.canAccessSemiContact({ permission_level: 'superadmin', perm: { ...semiTeam, menus: new Set() } }), true)
eq('사람이 없으면 거짓', [D.canAccessSemiContact(null), D.canAccessSemiContact(undefined)], [false, false])
eq('메뉴 키 상수', D.SEMI_CONTACT_KEY, 'contact_semi')
eq('사업부 시작 화면', [D.DIVISION_HOME['계측'], D.DIVISION_HOME['반도체']], ['/dashboard', '/contact/semi'])

console.log(fails === 0 ? '\n모두 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
