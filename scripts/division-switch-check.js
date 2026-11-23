// 사업부 전환 권한은 **팀**이 가진다 (2026-11-23).
//
//   node scripts/division-switch-check.js
//
// 지키는 약속
//   ① 판정은 소속 팀의 teams.can_switch_division 하나다. 등급(superadmin)은 보지 않는다.
//   ② 사람 칸(engineers.can_switch_division)은 **어느 조회의 열 목록에도 없다** — 코드가 읽지 않는다.
//   ③ 전환 가능 팀은 어느 사업부에 있든 관리·실적 메뉴를 본다(사이드바의 「관리」 묶음 예외).
//   ④ 팀 추가·수정·삭제는 service role 라우트에서만. 화면은 teams 에 직접 쓰지 않는다.
//   ⑤ 칸이 없는 DB 에서는 저장이 503 으로 **무엇을 돌려야 하는지** 말해 준다.

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

const D = load(path.join(ROOT, 'lib/division.ts'))
const M = load(path.join(ROOT, 'lib/menuPerms.ts'))

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
const team = (over) => ({ menus: new Set(), division: '계측', inSalesStats: false, canSwitchDivision: false, ...over })

console.log('\n── ① 판정은 팀 하나다 ──')
ok('전환 가능 팀이면 참', D.canSwitchDivision({ permission_level: 'member', perm: team({ canSwitchDivision: true }) }))
ok('꺼진 팀이면 거짓', D.canSwitchDivision({ permission_level: 'superadmin', perm: team() }) === false)
ok('팀이 없으면 거짓', D.canSwitchDivision({ permission_level: 'superadmin', perm: null }) === false)
ok('등급만으로는 안 된다 — superadmin 도 팀이 꺼져 있으면 거짓',
  D.canSwitchDivision({ permission_level: 'superadmin', perm: team() }) === false)
ok('사람 칸을 들고 와도 보지 않는다',
  D.canSwitchDivision({ permission_level: 'superadmin', can_switch_division: true, perm: team() }) === false)
ok('판정 함수가 perm 만 본다(글자 검사)',
  /return u\?\.perm\?\.canSwitchDivision === true/.test(read('lib/division.ts')))
ok('lib/division.ts 는 사람 칸 이름을 더 쓰지 않는다',
  !/u\.can_switch_division/.test(read('lib/division.ts')))

console.log('\n── ② 사람 칸을 읽는 조회가 없다 ──')
for (const [label, file] of [
  ['호출자(lib/apiCaller.ts)', 'lib/apiCaller.ts'],
  ['본인(lib/appData/me.ts)', 'lib/appData/me.ts'],
  ['직원 목록(lib/appData/engineers.ts)', 'lib/appData/engineers.ts'],
  ['페이지 가드(hooks/usePageGuard.ts)', 'hooks/usePageGuard.ts'],
]) {
  const src = read(file)
  // 주석에서는 「옛 자리가 어디였는지」를 설명할 수 있다. 보는 것은 **열 목록 글자**와 **타입 칸**이다.
  const colLines = src.split(/\r?\n/).filter(l => /COLUMNS\s*=/.test(l))
  ok(`${label} 열 목록에 없다`, !colLines.some(l => l.includes('can_switch_division')))
  ok(`${label} 타입 칸에도 없다`, !/^\s*can_switch_division\??:/m.test(src))
}

console.log('\n── ③ 팀 조회는 그 칸을 읽되, 없어도 멈추지 않는다 ──')
// 없는 칸을 select 에 적으면 PostgREST 가 42703 으로 조회 전체를 거절한다 —
// 그러면 팀 권한 맵이 비어 **모든 직원의 메뉴가 사라진다**(superadmin 만 멀쩡해 보인다).
ok('열 목록 두 벌이 있다',
  D.TEAM_PERM_COLUMNS.endsWith('can_switch_division') &&
  !D.TEAM_PERM_COLUMNS_LEGACY.includes('can_switch_division'))
ok('옛 열 목록은 새 것에서 칸 하나만 뺀 것이다',
  D.TEAM_PERM_COLUMNS === `${D.TEAM_PERM_COLUMNS_LEGACY}, can_switch_division`)
eq('「칸이 없다」를 가려낸다', [
  D.isMissingSwitchColumn({ code: '42703' }),
  D.isMissingSwitchColumn({ code: 'PGRST204' }),
  D.isMissingSwitchColumn({ code: '42501', message: 'permission denied' }),
  D.isMissingSwitchColumn(null),
], [true, true, false, false])
for (const file of ['lib/teamPerms.ts', 'lib/teamPermsServer.ts']) {
  const src = read(file)
  ok(`${file} — 공용 열 목록을 쓴다`, src.includes('TEAM_PERM_COLUMNS'))
  ok(`${file} — 거절당하면 옛 열 목록으로 다시 읽는다`,
    src.includes('TEAM_PERM_COLUMNS_LEGACY') && src.includes('isMissingSwitchColumn'))
  ok(`${file} — TeamPerm 에 담는다`, /canSwitchDivision: t\.can_switch_division === true/.test(src))
}

console.log('\n── ④ 관리·실적은 사업부를 타지 않는다 ──')
// 「관리」 묶음은 사업부 표시가 없어 계측으로 읽힌다. 전환 가능 팀은 그 거르기를 건너뛴다.
const admin = { permission_level: 'superadmin', perm: team({ canSwitchDivision: true, division: '반도체' }) }
eq('거르지 않으면 두 메뉴가 다 보인다',
  M.visibleMenus('관리', admin).map(m => m.key), ['sales', 'admin'])
eq('반도체로 거르면 하나도 안 남는다(이것이 사라지던 까닭)',
  M.visibleMenus('관리', admin, '반도체').map(m => m.key), [])
const SIDEBAR = read('components/layout/Sidebar.tsx')
ok('사이드바가 「관리」 묶음만 예외로 둔다',
  /if \(canSwitch && group === '관리'\) return visibleMenus\(group, engineer\)/.test(SIDEBAR))
ok('그 밖의 묶음은 종전대로 사업부로 거른다',
  /visibleMenus\(group, engineer, currentDivision\)/.test(SIDEBAR))

console.log('\n── ⑤ 팀 쓰기는 라우트에서만 ──')
const ROUTE = read('app/api/team/route.ts')
const ADMIN = read('app/admin/page.tsx')
for (const m of ['POST', 'PATCH', 'DELETE']) {
  ok(`${m} 은 슈퍼관리자만`, new RegExp(`export async function ${m}[\\s\\S]{0,400}?loadCaller\\(\\{ kind: 'superadmin' \\}`).test(ROUTE))
}
ok('service role 로 쓴다', /const supabaseAdmin = adminClient\(\)/.test(ROUTE))
ok('지우기 전에 재직 인원을 센다', /is\('resigned_date', null\)/.test(ROUTE) && /재직 중인 직원이/.test(ROUTE))
ok('지울 때 권한 줄을 먼저 치운다', /from\('team_permissions'\)\.delete\(\)\.eq\('team_id', teamId\)/.test(ROUTE))
ok('순서는 서버가 정한다', /display_order: nextOrder/.test(ROUTE))
ok('바꾼 뒤 서버 캐시를 버린다', (ROUTE.match(/invalidateTeamPerms\(\)/g) ?? []).length >= 3)
ok('화면은 teams 에 직접 쓰지 않는다',
  !/from\('teams'\)\s*\.?\s*(insert|update|delete)/.test(ADMIN), '관리 화면에 teams 직접 쓰기가 남아 있다')
ok('화면은 /api/team 으로 보낸다', ADMIN.includes(`fetch('/api/team'`))

console.log('\n── ⑥ 칸이 없으면 무엇을 돌릴지 말해 준다 ──')
ok('503 과 파일 이름', /status: 503/.test(ROUTE) && ROUTE.includes('db/team_division_switch_20261123.sql'))
ok('판정은 공용 함수 하나다', ROUTE.includes('isMissingSwitchColumn'))

console.log('\n── ⑦ SQL ──')
const SQL = read('db/team_division_switch_20261123.sql')
ok('칸만 더한다', /add column if not exists can_switch_division boolean not null default false/.test(SQL))
ok('지우는 문장이 살아 있지 않다',
  !SQL.split(/\r?\n/).some(l => /^\s*(drop|truncate|delete)\s/i.test(l)))
ok('지금 쓰는 사람의 팀을 켠다', /update public\.teams t[\s\S]{0,200}can_switch_division = true/.test(SQL))
ok('스키마를 다시 읽힌다', /notify pgrst, 'reload schema'/.test(SQL))
ok('표 권한 회수는 주석이고 「라우트 배포 후 실행」이라 적혀 있다',
  SQL.includes('라우트 배포 후 실행') && /^--\s+revoke insert, delete on table public\.teams/m.test(SQL))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
