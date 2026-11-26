// 묶음2 B — **버그 넷**이 되돌아오지 않게 못 박는다 (2026-11-26).
//
//   node scripts/bundle2-bugs-check.js
//
// 실측은 scripts/bundle2-measure.js 가 한다(서버·키가 필요해 check 에 넣지 않는다).
// 여기서는 **코드가 그 모양으로 남아 있는지**만 본다 — 키도 서버도 없이 돈다.
//
// 지키는 약속
//   B1 모달 바탕은 **document.body 로 포털**해 그린다. 조상에 transform 이 걸리면
//     position: fixed 의 기준이 그 조상으로 바뀌어, 카드 안에서 열린 창이 카드 크기로
//     줄고 잘렸다(실측 1430×900 → 275×328. 호버가 들고 날 때마다 왕복 = 깜빡임).
//   B2 활동 현황의 'A/S' 는 **두 출처**(서비스 레포트 · 영업활동)가 **한 줄로 합산**된다.
//     집계는 이름을 열쇠로 쓰고, 줄 목록은 겹치는 이름을 지운다.
//   B3 견적 작성의 커서 차례 — 대리점이면 E.U 를 **고른 뒤에야** 수신인을 혼자 정하고,
//     「사람이 잡은 칸은 빼앗지 않는다」 판정은 **제가 옮긴 자리**를 사람의 것으로 보지 않는다.
//   B4 쪽 번호 묶음은 줄의 **가운데**에 선다(양쪽에 같은 받침).

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

let fails = 0
const ok = (name, cond, hint) => {
  if (!cond) fails++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond || !hint ? '' : `  — ${hint}`}`)
}
const eq = (name, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want)
  if (!good) fails++
  console.log(`${good ? 'OK  ' : 'FAIL'} ${name}`)
  if (!good) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')
/** 주석을 뺀 코드 — 「이 글자가 없어야 한다」를 볼 때는 제 설명에 걸리지 않게 이것을 쓴다. */
const code = p => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split(/\r?\n/).map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n')

console.log('── B1 모달 바탕은 body 로 포털한다 ──')
const OV = read('components/common/ModalOverlay.tsx')
ok('createPortal 로 그린다', /createPortal\(overlay, document\.body\)/.test(OV))
ok('react-dom 에서 가져온다', /from 'react-dom'/.test(OV))
ok('서버에서는 아무것도 내지 않는다', /if \(!mounted\) return null/.test(OV))
ok('effect 안 setState 로 켜지 않는다(useSyncExternalStore)', /useSyncExternalStore\(noSubscribe, onClient, onServer\)/.test(OV))
ok('왜 옮겼는지 적어 두었다', /transform/.test(OV) && /containing block/.test(OV))
// 깜빡임의 조건 — 카드가 transform 과 overflow:hidden 을 함께 들고 있다(그대로 둔다. 모양이다).
const DASH = read('components/dashboard/DashCard.tsx')
ok('카드는 여전히 호버에 2px 떠오른다(모양은 그대로다)', /translateY\(-2px\)/.test(DASH))
ok('카드는 여전히 제 안을 자른다', /overflow: 'hidden'/.test(DASH))
ok('그 카드 머리에 「＋ 사후 실적」이 들어간다', /headerRight/.test(DASH)
  && /<BackfillButton/.test(read('app/dashboard/page.tsx')))

console.log('\n── B2 활동 현황의 A/S 는 한 줄이다 ──')
const A = load(path.join(ROOT, 'lib/activity.ts'))
const SERVICE = load(path.join(ROOT, 'components/activity/ActivityCard.tsx')).SERVICE_TYPES
ok("서비스 유형에 'A/S' 가 있다", SERVICE.includes('A/S'))
// 영업 종류 표에도 'A/S' 가 있다(수리 완료가 남기는 자동 줄). 둘이 겹쳐도 줄은 하나다.
const order = A.activityTypeOrder([{ label: 'A/S' }, { label: '방문미팅' }, { label: '전화' }])
eq("겹치는 'A/S' 는 한 번만 선다", order.filter(t => t === 'A/S').length, 1)
eq('서비스 유형이 먼저고 영업 종류가 뒤다', order.slice(0, SERVICE.length), [...SERVICE])
eq('목록에 없던 영업 종류는 뒤에 붙는다', order.slice(SERVICE.length), ['방문미팅', '전화'])
// 집계는 **이름을 열쇠**로 쓴다 — 그래서 두 출처가 같은 칸에 더해진다.
const ACT = read('app/activity/page.tsx')
ok('서비스는 이름 칸에 더한다', /counts\[sh\.service_type\]\+\+/.test(ACT))
ok('영업도 **같은 이름 칸**에 더한다', /counts\[a\.activity_type\] = \(counts\[a\.activity_type\] \?\? 0\) \+ 1/.test(ACT))
ok('줄 목록은 겹치는 이름을 지운 것이다', /activityTypeOrder\(salesTypes\)/.test(ACT))
ok('목록 밖 값은 중복 없이 뒤에 붙는다', /\.filter\(t => !typeOrder\.includes\(t\)\)/.test(ACT))
const DET = read('components/activity/ActivityDetail.tsx')
ok('상세 모달의 유형 칩도 같은 규칙이다', /activityTypeOrder\(salesTypes\)/.test(DET)
  && /!typeOrder\.includes\(t\)/.test(DET))
ok('수리 완료가 남기는 줄의 종류는 A/S 하나다',
  /const REPAIR_ACTIVITY_TYPE = 'A\/S'/.test(read('app/api/customer-change/route.ts')))

console.log('\n── B3 견적 작성의 커서 차례 ──')
const F = load(path.join(ROOT, 'lib/quoteFocus.ts'))
eq('직판은 사명 다음이 수신인', F.nextFocusStep('company', { isDealer: false }), 'recipient')
eq('대리점은 사명 다음이 E.U', F.nextFocusStep('company', { isDealer: true }), 'eu')
eq('E.U 다음은 수신인', F.nextFocusStep('eu', { isDealer: true }), 'recipient')
eq('수신인 다음은 가격표', F.nextFocusStep('recipient', { isDealer: true }), 'priceSearch')
eq('가격표가 마지막', F.nextFocusStep('priceSearch', { isDealer: true }), null)
eq('담당자가 한 사람이면 그 사람', F.onlyContactId([{ contact_id: 7 }]), 7)
eq('둘이면 고르게 둔다', F.onlyContactId([{ contact_id: 7 }, { contact_id: 8 }]), null)
eq('아무도 없으면 null', F.onlyContactId([]), null)
const QF = read('lib/quoteFocus.ts')
ok('렌더가 끝난 뒤에 옮긴다(두 겹 rAF)',
  /requestAnimationFrame\(\(\) => window\.requestAnimationFrame\(tick\)\)/.test(QF))
ok('칸이 열리기를 프레임마다 기다린다', /frames\+\+ < MAX_FRAMES/.test(QF))
ok('**제가 옮긴 자리**는 사람의 것으로 보지 않는다', /taken !== movedTo/.test(QF) && /movedTo = el/.test(QF))
ok('사라진 칸이 그 자리였으면 기억도 지운다', /if \(was && was === movedTo\) movedTo = null/.test(QF))
const CC = code('components/quote/CustomerCard.tsx')
ok('대리점 건은 E.U 를 고른 뒤에야 수신인을 혼자 정한다', /if \(isDealer && !selectedEU\) return/.test(CC))
ok('그 효과의 의존에 두 값이 들어 있다', /isDealer, selectedEU\]/.test(CC))
const QP = read('app/quote/page.tsx')
ok('담긴 담당자 목록이 **어느 업체들의 것인가**를 들고 있다', /const \[contactsKey, setContactsKey\]/.test(QP))
ok('어긋나면 「불러오는 중」이다(효과가 아니라 렌더에서 판정)',
  /const contactsStale = contactsKey !== recipientIdsKey/.test(QP)
  && /loading: contactsLoading \|\| contactsStale/.test(QP))

console.log('\n── B4 쪽 번호는 줄 가운데 ──')
const PG = read('components/common/Pager.tsx')
ok('왼쪽 건수가 받침을 갖는다', /flex: 1, minWidth: 0, fontSize: 12, color: MUTED/.test(PG))
ok('오른쪽에도 **같은 받침**이 있다', /\{pages > 1 && <span style=\{\{ flex: 1, minWidth: 0 \}\} aria-hidden \/>\}/.test(PG))
ok('번호 묶음은 줄어들지 않는다', /gap: 4, flexShrink: 0/.test(PG))
ok('옛 받침 한 개짜리 줄은 없다', !/<span style=\{\{ flex: 1 \}\} \/>/.test(code('components/common/Pager.tsx')))
ok('버튼 안 글자는 손대지 않았다(실측 치우침 0px)', /minWidth: 30, height: 30, padding: '0 8px'/.test(PG))

console.log('\n── 실측 대본이 있다 ──')
const M = read('scripts/bundle2-measure.js')
ok('네 단계를 잰다', ['B1', 'B2', 'B3', 'B4'].every(s => M.includes(`STAGE === '${s}'`)))
ok('운영 자료를 쓰지 않는다고 적어 두었다', /운영 자료를 \*\*쓰지 않는다\*\*/.test(M))
ok('하네스로 줍히지 않는 이름이다', !/bundle2-measure-check\.js/.test(M))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
