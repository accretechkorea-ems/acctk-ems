// Sentry 로 **무엇이 나가는가** 시험 — 보내면 안 되는 것이 섞이지 않는지.
//
//   node scripts/sentry-scrub-check.js
//
// 왜 따로 두는가 — 오류 보고에 견적 금액·고객 정보·메일이 섞여 나가면 그것은 되돌릴 수 없다
// (Sentry 는 사내 서비스가 아니다). 그리고 **DSN 이 없으면 아무것도 하지 않는다**는 약속도
// 여기서 못 박는다 — 로컬·CI 가 키 없이 돌아야 하기 때문이다.

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

const { SENTRY_COMMON, scrubEvent, sentryDsn, sentryEnabled } = load(path.join(ROOT, 'lib/sentryOptions.ts'))

let fails = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`)
  if (!ok) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}

console.log('── DSN 이 없으면 꺼진다 ──')
{
  const keep = { s: process.env.SENTRY_DSN, b: process.env.NEXT_PUBLIC_SENTRY_DSN }
  delete process.env.SENTRY_DSN
  delete process.env.NEXT_PUBLIC_SENTRY_DSN
  eq('서버 DSN 빈 글자', sentryDsn('server'), '')
  eq('브라우저 DSN 빈 글자', sentryDsn('browser'), '')
  eq('양쪽 다 꺼짐', [sentryEnabled('server'), sentryEnabled('browser')], [false, false])

  process.env.NEXT_PUBLIC_SENTRY_DSN = '  '
  eq('공백만 넣어도 꺼짐', sentryEnabled('browser'), false)

  process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://abc@o1.ingest.sentry.io/2'
  eq('브라우저 키만 넣으면 브라우저 켜짐', sentryEnabled('browser'), true)
  eq('서버는 브라우저 키로도 켜진다', sentryEnabled('server'), true)

  process.env.SENTRY_DSN = 'https://srv@o1.ingest.sentry.io/3'
  eq('서버는 서버 키를 먼저 본다', sentryDsn('server'), 'https://srv@o1.ingest.sentry.io/3')
  eq('브라우저는 서버 키를 보지 않는다', sentryDsn('browser'), 'https://abc@o1.ingest.sentry.io/2')

  if (keep.s === undefined) delete process.env.SENTRY_DSN; else process.env.SENTRY_DSN = keep.s
  if (keep.b === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN; else process.env.NEXT_PUBLIC_SENTRY_DSN = keep.b
}

console.log('\n── 요청에서 보내는 것은 주소·메서드뿐 ──')
{
  const e = scrubEvent({
    request: {
      url: 'https://ems.example.com/api/quote-approval?quote_id=108&email=hong%40x.com',
      method: 'POST',
      data: { total_supply: 19358000, customer: '무브넥스', note: '단가 협의' },
      headers: { cookie: 'sb-access-token=eyJ…', authorization: 'Bearer eyJ…' },
      cookies: { 'sb-access-token': 'eyJ…' },
      query_string: 'quote_id=108&email=hong%40x.com',
      env: { REMOTE_ADDR: '1.2.3.4' },
    },
  })
  eq('남는 칸은 둘뿐', Object.keys(e.request).sort(), ['method', 'url'])
  eq('주소는 물음표 앞까지', e.request.url, 'https://ems.example.com/api/quote-approval')
  eq('메서드는 남는다', e.request.method, 'POST')
  eq('본문·헤더·쿠키·질의·env 는 없다',
    [e.request.data, e.request.headers, e.request.cookies, e.request.query_string, e.request.env],
    [undefined, undefined, undefined, undefined, undefined])
}
{
  // 주소가 없거나 글자가 아니면 그 칸을 만들지 않는다.
  const e = scrubEvent({ request: { data: { a: 1 } } })
  eq('주소가 없으면 request 는 빈 객체', e.request, {})
  const e2 = scrubEvent({ request: { url: 123, method: {} } })
  eq('글자가 아닌 주소·메서드는 버린다', e2.request, {})
}
eq('request 가 없으면 만들지 않는다', scrubEvent({ message: 'x' }).request, undefined)

console.log('\n── 사용자는 engineer_id 만 ──')
{
  const e = scrubEvent({ user: { id: 20, email: 'hong@x.com', username: '홍길동', ip_address: '1.2.3.4' } })
  eq('남는 칸은 id 뿐', Object.keys(e.user), ['id'])
  eq('id 는 글자로', e.user.id, '20')
  eq('메일·이름·ip 는 없다', [e.user.email, e.user.username, e.user.ip_address], [undefined, undefined, undefined])
}
eq('id 가 없으면 빈 객체', scrubEvent({ user: { email: 'a@b.c' } }).user, {})
eq('user 가 없으면 만들지 않는다', scrubEvent({ message: 'x' }).user, undefined)

console.log('\n── 그 밖 ──')
eq('서버 이름은 지운다', scrubEvent({ server_name: 'vercel-iad1-abc' }).server_name, undefined)
eq('같은 객체를 돌려준다(새로 만들지 않는다)', (() => { const o = { message: 'x' }; return scrubEvent(o) === o })(), true)
eq('손대지 않는 칸은 그대로', scrubEvent({ level: 'error', tags: { route: '/api/x' } }).tags, { route: '/api/x' })

console.log('\n── 쿼터를 지키는 값 ──')
eq('에러는 100%', SENTRY_COMMON.sampleRate, 1)
eq('성능 추적은 0', SENTRY_COMMON.tracesSampleRate, 0)
eq('ip·쿠키를 자동으로 붙이지 않는다', SENTRY_COMMON.sendDefaultPii, false)

console.log(fails === 0 ? '\n모두 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
