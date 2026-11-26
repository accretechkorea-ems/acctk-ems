// 비밀번호 **초기화** — 권한 · 임시값 · 강제 변경 (2026-11-26).
//
//   node scripts/reset-password-check.js
//
// 서버도 키도 없이 돈다. 임시값 만들기는 **순수 모듈**이라 여기서 실제로 돌려 본다
// (lib/tempPassword.ts). 라우트·화면·미들웨어는 글로 확인한다.
//
// ── 지키는 약속 ─────────────────────────────────────────────────────────────
//   ① 관리자만 부른다 — 직원 계정을 다루는 자리와 **같은 판정**이다.
//   ② 임시값은 **서버가** 만든다. 영문 대소문자 + 숫자 10자, 헷갈리는 0·O·1·l 은 없다.
//   ③ 임시값은 **응답에만** 있다 — DB 에도 로그에도 남기지 않는다.
//   ④ 초기화하면 must_change_password 가 켜지고, 미들웨어가 그 사람을 새 비밀번호 화면으로
//     보낸다. 새 비밀번호를 저장하면 꺼진다.
//   ⑤ 칸이 아직 없어도 **초기화는 된다**(표식만 건너뛴다. 떠밀기도 없다).

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
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')

const T = load(path.join(ROOT, 'lib/tempPassword.ts'))
const A = load(path.join(ROOT, 'lib/accountRules.ts'))

console.log('── ① 임시 비밀번호 ──')
eq('길이 10', T.TEMP_PASSWORD_LENGTH, 10)
eq('헷갈리는 넷을 뺀다', [...T.TEMP_PASSWORD_BANNED], ['0', 'O', '1', 'l'])
eq('쓸 수 있는 글자는 58자', T.TEMP_PASSWORD_ALPHABET.length, 58)
for (const bad of T.TEMP_PASSWORD_BANNED) {
  ok(`  '${bad}' 는 글자 집합에 없다`, !T.TEMP_PASSWORD_ALPHABET.includes(bad))
}
ok('영문 대소문자와 숫자만', /^[A-Za-z2-9]+$/.test(T.TEMP_PASSWORD_ALPHABET))
// 실제로 많이 만들어 본다 — 길이·글자·중복을 한 번에 본다.
const made = Array.from({ length: 400 }, () => T.makeTempPassword())
ok('만든 값이 모두 10자', made.every(p => p.length === 10))
ok('만든 값에 금지 글자가 하나도 없다',
  made.every(p => [...T.TEMP_PASSWORD_BANNED].every(b => !p.includes(b))))
ok('400개가 모두 다르다(같은 값이 나오지 않는다)', new Set(made).size === 400)
ok('기준 길이를 넘는다(로그인 규칙과 어긋나지 않는다)',
  T.TEMP_PASSWORD_LENGTH >= A.PASSWORD_MIN, `${T.TEMP_PASSWORD_LENGTH} < ${A.PASSWORD_MIN}`)
// 치우치지 않는가 — 바이트를 0..255 로 돌려주면 모든 글자가 고르게 나와야 한다.
{
  let i = 0
  const seq = n => Uint8Array.from({ length: n }, () => i++ % 256)
  const s = T.makeTempPassword(seq, 2000)
  const count = new Map()
  for (const ch of s) count.set(ch, (count.get(ch) ?? 0) + 1)
  const vals = [...count.values()]
  ok('모든 글자가 나온다(버리는 값이 글자를 가리지 않는다)', count.size === 58, `${count.size}자`)
  ok('치우치지 않는다(가장 많은 글자와 적은 글자 차이 ≤ 1)',
    Math.max(...vals) - Math.min(...vals) <= 1, `${Math.min(...vals)}~${Math.max(...vals)}`)
}

console.log('\n── ② 라우트 ──')
const ROUTE = read('app/api/admin/reset-password/route.ts')
ok('관리자만 부른다', /loadCaller\(\{ kind: 'superadmin' \}/.test(ROUTE))
ok('service role 로 바꾼다', /sb\.auth\.admin\.updateUserById\(user\.id, \{ password: tempPassword \}\)/.test(ROUTE))
ok('임시값은 **서버가** 만든다', /makeTempPassword\(\)/.test(ROUTE)
  && /from '@\/lib\/tempPassword'/.test(ROUTE))
ok('임시값을 **응답으로만** 돌려준다', /tempPassword,/.test(ROUTE))
// DB 로 가는 글(`.update({…})` · `.insert({…})`) 안에 임시값이 들어가지 않는 것을 본다.
{
  const writes = [...ROUTE.matchAll(/\.(update|insert|upsert)\(\{[\s\S]{0,300}?\}\)/g)].map(m => m[0])
  ok(`DB 로 가는 글 ${writes.length}곳 어디에도 임시값이 없다`,
    writes.length > 0 && writes.every(w => !/tempPassword/.test(w)))
}
// 로그 줄에 값이 들어가지 않는 것을 **글자로** 본다.
{
  const logs = [...ROUTE.matchAll(/console\.(log|warn|error)\([\s\S]{0,400}?\n\s*\}\)/g)].map(m => m[0])
  ok(`로그 ${logs.length}줄 어디에도 임시값이 없다`, logs.every(l => !/tempPassword/.test(l)))
}
ok('누가·누구를·언제를 남긴다',
  /by: caller\.engineer_id/.test(ROUTE) && /target: engineerId/.test(ROUTE) && /at: new Date\(\)/.test(ROUTE))
ok('표식을 켠다', /update\(\{ must_change_password: true \}\)/.test(ROUTE))
ok('칸이 없으면 초기화만 하고 지나간다', /schemaMissing\(flagErr\.code\)/.test(ROUTE) && /forced = false/.test(ROUTE))
ok('직원·계정을 못 찾으면 404', /status: 404/.test(ROUTE))
ok('직원 번호가 이상하면 400', /Number\.isInteger\(engineerId\)/.test(ROUTE) && /status: 400/.test(ROUTE))

console.log('\n── ③ 화면 ──')
const BTN = read('components/admin/ResetPasswordButton.tsx')
const ADMIN = read('app/admin/page.tsx')
ok('직원 표의 한 줄에 선다', /<ResetPasswordButton/.test(ADMIN) && /'비밀번호'/.test(ADMIN))
ok('확인창 문구가 지시 그대로다',
  /의 비밀번호를 초기화합니다\. 임시 비밀번호는 한 번만 표시됩니다\./.test(BTN))
ok('공용 확인창을 쓴다(alert 아님)', /useConfirm\(\)/.test(BTN) && !/\balert\(/.test(BTN))
ok('공용 모달 부품을 쓴다', /<ModalCard/.test(BTN) && /<ModalOverlay/.test(BTN))
ok('값을 큰 글씨로 보여 준다', /fontSize: 24/.test(BTN))
ok('복사 단추가 있다', /navigator\.clipboard\.writeText/.test(BTN) && /복사/.test(BTN))
ok('복사가 막히면 알려 준다(글자는 화면에 남는다)', /복사하지 못했습니다/.test(BTN))
ok('닫으면 버린다(상태에만 있다)', /setShown\(null\)/.test(BTN) && !/localStorage/.test(BTN))
ok('다시 못 본다고 적어 둔다', /지금 한 번만<\/b> 보입니다/.test(BTN))
ok('칸이 없을 때를 화면이 말한다', /must_change_password_20261126\.sql/.test(BTN))

console.log('\n── ④ 강제 변경 ──')
const MW = read('middleware.ts')
const PAGE = read('app/account/change-password/page.tsx')
eq('그 화면 주소는 한 곳에 적는다', A.CHANGE_PASSWORD_PATH, '/account/change-password')
ok('미들웨어가 표식을 읽는다', /select\('resigned_date, must_change_password'\)/.test(MW))
ok('표식이 켜져 있으면 그리로 보낸다',
  /if \(mustChange && pathname !== CHANGE_PASSWORD_PATH\)/.test(MW))
ok('그 화면 자신은 보내지 않는다(무한 이동 금지)', /pathname !== CHANGE_PASSWORD_PATH/.test(MW))
ok('칸이 없으면 떠밀지 않는다(42703 폴백)',
  /error\.code === '42703'/.test(MW) && /resigned_date'\)/.test(MW))
ok('재직 판정은 그대로다', /isResigned\(data\)/.test(MW))
ok('화면이 있다', fs.existsSync(path.join(ROOT, 'app/account/change-password/page.tsx')))
ok('길이 규칙은 기존 것을 그대로 쓴다',
  /isPasswordLongEnough/.test(PAGE) && /PASSWORD_SHORT_MESSAGE/.test(PAGE))
ok('두 번 적게 해 오타를 막는다', /일치하지 않습니다/.test(PAGE))
ok('저장하면 표식을 끈다', /update\(\{ must_change_password: false \}\)/.test(PAGE))
ok('지금 비밀번호는 묻지 않는다(임시값으로 이미 들어와 있다)', !/현재 비밀번호/.test(PAGE))
ok('끈 뒤에 옮긴다', /router\.replace\('\/dashboard'\)/.test(PAGE))

console.log('\n── ⑤ SQL ──')
const SQL = read('db/must_change_password_20261126.sql')
ok('칸을 더한다', /add column if not exists must_change_password boolean not null default false/.test(SQL))
ok('스키마를 깨운다', /notify pgrst, 'reload schema'/.test(SQL))
ok('APPLIED.md 에 적어 두었다', /must_change_password_20261126\.sql/.test(read('db/APPLIED.md')))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
