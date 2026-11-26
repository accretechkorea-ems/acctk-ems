// 관리자 행위 기록표 — **라우트마다 한 줄씩 적는가** (2026-11-27 야간3 4).
//
//   node scripts/admin-events-check.js
//
// 지키는 약속
//   ① 비밀번호 값은 **어디에도** 들어가지 않는다(부르는 쪽이 실수해도 턴다).
//   ② 표가 아직 없으면 **서버 로그로 떨어지고** 본 일을 막지 않는다.
//   ③ 적는 라우트 여섯이 전부 부른다.
//   ④ RLS — 슈퍼관리자만 읽고, 쓰기 정책은 **아예 없다**(service role 만 쓴다).

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

const A = load(path.join(ROOT, 'lib/adminEvents.ts'))
const SQL = read('db/admin_events_20261127.sql')

console.log('── ① 비밀은 담지 않는다 ──')
eq('비밀번호를 턴다', A.scrubDetail({ email: 'a@b.c', password: 'x' }), { email: 'a@b.c' })
eq('임시 비밀번호도', A.scrubDetail({ tempPassword: 'x', forced: true }), { forced: true })
eq('토큰·열쇠도', A.scrubDetail({ token: 't', secret: 's', apiKey: 'k', name: '홍' }), { name: '홍' })
eq('한 겹 안쪽까지 턴다', A.scrubDetail({ a: { password: 'x', b: 1 } }), { a: { b: 1 } })
ok('비밀번호 초기화 라우트가 값을 넘기지 않는다',
  !/detail: \{[^}]*tempPassword/.test(read('app/api/admin/reset-password/route.ts')))

console.log('\n── ② 표가 없어도 돈다 ──')
ok('42P01·PGRST205 면 서버 로그로 떨어진다',
  /code === '42P01' \|\| code === 'PGRST205'/.test(read('lib/adminEvents.ts'))
  && /console\.log\('\[adminEvent\]'/.test(read('lib/adminEvents.ts')))
ok('던지지 않는다(본 일을 막지 않는다)', /본 일은 그대로다/.test(read('lib/adminEvents.ts')))

console.log('\n── ③ 적는 자리 여섯 ──')
eq('적는 일 일곱 가지', [...A.ADMIN_ACTIONS], [
  'password_reset', 'engineer_updated', 'division_switched',
  'customer_restored', 'team_created', 'team_deleted', 'quote_revived',
])
for (const [what, file, action] of [
  ['비밀번호 초기화', 'app/api/admin/reset-password/route.ts', 'password_reset'],
  ['역할·팀 변경', 'app/api/update-engineer/route.ts', 'engineer_updated'],
  ['소프트 삭제 복구', 'app/api/customer-delete/route.ts', 'customer_restored'],
  ['팀 추가', 'app/api/team/route.ts', 'team_created'],
  ['팀 삭제', 'app/api/team/route.ts', 'team_deleted'],
  ['미수주 → 견적중 되돌리기', 'app/api/quote-revive/route.ts', 'quote_revived'],
]) ok(`${what}`, new RegExp(`action: '${action}'`).test(read(file)), '기록 호출이 없다')
// 사업부 전환 플래그는 **팀** 설정이다(teams.can_switch_division) — 팀 기록에 담긴다.
ok('사업부 전환 플래그는 팀 기록에 담긴다', /can_switch_division: created\.can_switch_division/.test(read('app/api/team/route.ts')))
ok('누가 했는지는 **세션**에서 박는다(본문 값이 아니다)',
  !/actorId: body\./.test(read('app/api/team/route.ts'))
  && /actorId: caller\.engineer_id/.test(read('app/api/team/route.ts')))

console.log('\n── ④ SQL ──')
ok('표를 만든다', /create table if not exists public\.admin_events/.test(SQL))
ok('칸 일곱', ['id', 'actor_engineer_id', 'action', 'target_type', 'target_id', 'detail', 'created_at']
  .every(c => new RegExp(`^\\s{2}${c}\\s`, 'm').test(SQL)))
ok('RLS 를 켠다', /alter table public\.admin_events enable row level security/.test(SQL))
ok('읽기는 슈퍼관리자만', /create policy admin_events_select/.test(SQL) && /permission_level = 'superadmin'/.test(SQL))
ok('**쓰기 정책은 없다**(service role 만 쓴다)',
  !/for insert/.test(SQL) && !/for update/.test(SQL) && !/for delete/.test(SQL))
ok('authenticated 에는 읽기만 준다',
  /grant select on table public\.admin_events to authenticated/.test(SQL)
  && /revoke insert, update, delete on table public\.admin_events from authenticated/.test(SQL))
ok('비밀번호를 담지 말라고 적어 두었다', /비밀번호 값은 절대 담지 않는다/.test(SQL))
ok('스키마를 깨운다', /notify pgrst, 'reload schema'/.test(SQL))
ok('APPLIED.md 에 적어 두었다', /admin_events_20261127\.sql/.test(read('db/APPLIED.md')))

console.log('\n── ⑤ 화면은 만들지 않았다 ──')
ok('admin_events 를 읽는 화면이 없다(관리 리뉴얼 때)',
  !/from\('admin_events'\)/.test(read('app/admin/page.tsx')))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
