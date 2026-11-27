// 폰 앱바의 **제목이 비는 화면이 없게** (2026-11-27, 묶음4 C).
//
// 폰에는 사이드바가 없다. 앱바 가운데 글자가 「어느 화면인가」를 말하는 유일한 자리인데,
// 그 글자를 MENU_PERMS 에서 **경로로** 찾고 있었다. 그래서 메뉴에 없는 화면
// (사업장·회사·대리점 상세 · 홀딩 현황 · 내 정보 · 비밀번호 변경 · 화면 진단)에서는
// 제목 칸이 통째로 비어 있었다.
//
// 이 하네스는 `app/**/page.tsx` 를 **스스로 찾아** 화면 목록을 만든다 — 새 화면을 만들면
// 이름표를 두지 않은 순간 여기서 걸린다(목록을 손으로 적으면 그 목록이 먼저 낡는다).
//
// 키 없이 서버 없이 돈다.

const load = module.require.bind(module)
const fs = load('fs')
const path = load('path')
const Module = load('module')
const ROOT = path.join(__dirname, '..')
const ts = load(path.join(ROOT, 'node_modules/typescript'))
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')

let fails = 0
const ok = (name, good, extra) => {
  if (!good) fails++
  console.log(`${good ? 'OK  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`)
}

// TS 를 그대로 읽는다 — 다른 하네스와 같은 방식이다(scripts/forecast-board-check.js).
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

const MP = load(path.join(ROOT, 'lib/menuPerms.ts'))

/** app/ 아래의 화면을 전부 찾는다. 로그인·공개 화면은 앱바가 없다. */
const PUBLIC = ['/login', '/lead']
const routes = []
const walk = d => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name === 'page.tsx') {
      const r = '/' + path.relative(path.join(ROOT, 'app'), path.dirname(p)).split(path.sep).join('/')
      routes.push(r === '/.' ? '/' : r)
    }
  }
}
walk(path.join(ROOT, 'app'))

/** [id] 자리에 아무 값이나 넣어 실제 주소처럼 만든다. */
const sample = r => r.replace(/\[[^\]]+\]/g, '593')

console.log('── ① 화면마다 앱바 제목이 있다 ──')
const blank = []
for (const r of routes.sort()) {
  if (PUBLIC.includes(r)) continue
  // 하위 경로는 그 메뉴를 따른다(Sidebar 의 activePath 와 같은 셈).
  const pathname = sample(r)
  const matchSub = p => pathname === p || (p !== '/' && pathname.startsWith(p + '/'))
  const activePath = MP.MENU_PATHS.filter(matchSub)
    .sort((a, b) => (a === pathname ? 1 : 0) - (b === pathname ? 1 : 0) || a.length - b.length)
    .pop() ?? null
  const label = MP.MENU_PERMS.find(i => i.path === activePath)?.label ?? MP.screenTitleOf(pathname) ?? ''
  if (!label) blank.push(r)
}
ok(`제목이 비는 화면이 없다 (화면 ${routes.length - PUBLIC.length}개)`, blank.length === 0, blank.join(', '))

console.log('\n── ② 이름표가 하는 일 ──')
ok('사업장·회사·대리점 상세는 「고객사」', MP.screenTitleOf('/customer/593') === '고객사')
ok('홀딩 현황은 제 이름을 쓴다(권한은 80 대시보드를 따르지만 이름은 다르다)',
  MP.screenTitleOf('/holdings') === '홀딩 현황' && MP.menuKeyForPath('/holdings') === 'dashboard_80')
ok('내 정보·비밀번호 변경', MP.screenTitleOf('/account') === '내 정보' && MP.screenTitleOf('/account/change-password') === '비밀번호 변경')
ok('메뉴에 있는 화면은 메뉴 이름 그대로', MP.screenTitleOf('/pipeline') === '포캐스트' && MP.screenTitleOf('/') === '고객사')
ok('모르는 주소는 null — 아무 이름이나 지어내지 않는다', MP.screenTitleOf('/없는주소') === null)

console.log('\n── ③ 이름표는 권한 표와 따로다 ──')
// 한 표로 묶으면 홀딩 현황에 「80 대시보드」가 뜬다. 둘은 묻는 것이 다르다.
ok('두 표가 따로 있다', /export const SCREEN_TITLES/.test(read('lib/menuPerms.ts')) && /export const PARENT_MENU/.test(read('lib/menuPerms.ts')))
ok('메뉴에 있는 화면은 이름표에 적지 않는다(이름이 두 곳에 생기지 않게)',
  Object.keys(MP.SCREEN_TITLES).every(p => !MP.MENU_PATHS.includes(p)))

console.log('\n── ④ 앱바가 그 값을 쓴다 ──')
const SIDE = read('components/layout/Sidebar.tsx')
ok('앱바 제목이 이름표로 떨어진다', /screenTitleOf\(pathname\) \?\? ''/.test(SIDE))
ok('제목 줄은 길면 말줄임한다', /textOverflow: 'ellipsis', whiteSpace: 'nowrap' \}\}>\{currentLabel\}/.test(SIDE))

console.log(fails === 0 ? '\n전부 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
