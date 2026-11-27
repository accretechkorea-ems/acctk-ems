// 고객사 상세 — **분할 보기 하나**로 모았다 (2026-11-28, 야간4 7).
//
//   node scripts/customer-detail-unify-check.js
//
// 지키는 약속
//   ① 단독 상세 라우트(app/customer/[id])가 **없다**. 그 주소는 **301** 로 받는다.
//   ② 손으로 적은 `/customer/{id}` 가 코드 어디에도 남아 있지 않다 —
//      주소는 lib/mapPopup.ts 의 세 함수가 만든다.
//   ③ `?site=` 로 들어오면 회사를 펴고 **그 사업장까지** 연다.
//   ④ 고른 줄을 **패널 가운데**로 데려온다.
//   ⑤ `?origin=` 이 ← 가 돌아갈 자리를 정한다. 한 번 쓰면 비운다.
//   ⑥ `?contact=` 를 분할 보기가 받는다(단독 페이지가 받던 일이다).
//   ⑦ 라우트 표(menuPerms)의 두 줄은 **남는다** — 301 이 지나는 동안 쓰인다.
//
// 키도 서버도 없이 돈다.

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

const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')
const code = s => s.split(/\r?\n/).filter(l => {
  const t = l.trim()
  return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
}).join('\n')

const M = load(path.join(ROOT, 'lib/mapPopup.ts'))
const HOME = code(read('app/page.tsx'))

const fails = []
let total = 0
const ok = (name, got, want = true) => {
  total += 1
  const same = JSON.stringify(got) === JSON.stringify(want)
  console.log(`${same ? 'OK  ' : 'FAIL'} ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
  if (!same) fails.push(name)
}

console.log('── ① 라우트와 301 ──')
ok('단독 상세 라우트가 없다', fs.existsSync(path.join(ROOT, 'app/customer')), false)
ok('그 주소를 301 로 받는다',
  /source: '\/customer\/:id', destination: '\/\?view=list&site=:id', statusCode: 301/.test(read('next.config.ts')))
// 307(permanent:false)로 두지 않는 까닭 — 단독 상세는 **다시 만들지 않는다**.
ok('307 이 아니다', /source: '\/customer\/:id'[^}]*permanent: false/.test(read('next.config.ts')), false)

console.log('── ② 손으로 적은 주소가 없다 ──')
const walk = (dir, out = []) => {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = path.join(dir, name)
    if (fs.statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(name)) out.push(full)
  }
  return out
}
const files = ['app', 'components', 'lib', 'hooks'].flatMap(d => walk(path.join(ROOT, d)))
// 주석은 뺀다 — 「그 화면이 어떤 방식이었나」를 적은 자국은 남긴다.
const handWritten = files.filter(f => /\/customer\/\$\{|["'`]\/customer\/\d/.test(code(fs.readFileSync(f, 'utf8'))))
ok('템플릿으로 적은 /customer/ 주소가 없다', handWritten.map(f => path.relative(ROOT, f)), [])
ok('주소는 세 함수가 만든다',
  [typeof M.siteListHref, typeof M.siteHref, typeof M.companyHref], ['function', 'function', 'function'])

console.log('── ③ origin ──')
ok('지도에서 가면 origin=map',
  M.siteHref({ customer_id: 776, company_name: 'A', parent_customer_id: 1525 }, 'map'),
  '/?view=list&company=1525&site=776&origin=map')
ok('회사 보기도 같이 싣는다',
  M.companyHref({ customer_id: 776, company_name: 'A', parent_customer_id: 1525 }, 'map'),
  '/?view=list&company=1525&origin=map')
ok('다른 메뉴는 경로를 싣는다', M.siteListHref(593, '/quote'), '/?view=list&site=593&origin=%2Fquote')
ok('안 실으면 종전 그대로', M.siteListHref(593), '/?view=list&site=593')
ok('화면이 map 과 경로만 받는다', /o === 'map' \|\| o\.startsWith\('\/'\)/.test(HOME))
ok('← 가 지도로 돌아간다', /if \(origin === 'map'\) \{ setOrigin\(null\); setSelectedSiteId\(null\); setView\('map'\); return \}/.test(HOME))
ok('← 가 다른 메뉴로 나간다', /if \(origin && origin\.startsWith\('\/'\)\) \{ setOrigin\(null\); window\.location\.href = origin; return \}/.test(HOME))
ok('한 번 쓰면 비운다', (HOME.match(/setOrigin\(null\)/g) || []).length, 2)
// history.back() 은 301 로 들어온 옛 주소로 되튀어 돌 수 있다.
ok('history.back() 을 쓰지 않는다', /history\.back\(\)/.test(HOME), false)

console.log('── ④ 트리가 하는 일 ──')
ok('회사를 편다', /setExpanded\(prev => new Set\(prev\)\.add\(parent\)\)/.test(HOME))
ok('**그 사업장까지** 연다', /setSelectedSiteId\(pendingFocusSiteId\)/.test(HOME))
ok('고른 줄에 표가 붙는다', /data-site-row=\{on \? 'on' : undefined\}/.test(code(read('components/home/list/CustomerListPanel.tsx'))))
ok('그 줄을 **가운데**로 데려온다',
  /querySelector\('\[data-site-row="on"\]'\)/.test(HOME) && /block: 'center'/.test(HOME))
ok('줄이 바뀔 때마다 한 번만', /\}, \[selectedSiteId\]\)/.test(HOME))

console.log('── ⑤ ?contact= ──')
ok('분할 보기가 받는다', /const contact = Number\(q\.get\('contact'\)\)/.test(HOME))
ok('본문에 넘긴다', /openContactId=\{openContactId\}/.test(HOME))
ok('메일 링크가 그 주소를 만든다',
  code(read('lib/quoteMail.ts')).includes("`${siteListHref(id)}&contact=${contact}`"))

console.log('── ⑥ 라우트 표는 남는다 ──')
const PERMS = read('lib/menuPerms.ts')
ok('권한 표에 남아 있다', /'\/customer\/\[id\]': 'customers'/.test(PERMS))
ok('제목 표에도 남아 있다', /'\/customer\/\[id\]': '고객사'/.test(PERMS))

console.log('── ⑦ 조사 표 ──')
const DOC = read('docs/customer-detail-links-20261128.md')
ok('문서가 있다', DOC.length > 500)
for (const f of ['MapView.tsx', 'CustomerCard.tsx', 'TodayCards.tsx', 'quoteMail.ts', 'CustomerDetailBody.tsx', 'CompanyLink.tsx']) {
  ok(`${f} 가 표에 있다`, DOC.includes(f))
}
ok('손대지 않은 것도 적었다', DOC.includes('손대지 않은 것') && DOC.includes('menuPerms'))

if (fails.length > 0) {
  console.error('\n실패:')
  for (const f of fails) console.error('  · ' + f)
  process.exit(1)
}
console.log(`\n통과 — 고객사 상세 통일(검사 ${total}개 · 실패 0)`)
