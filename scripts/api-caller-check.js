// 공용 호출자 확인 시험 — lib/apiCaller.ts.
//
//   node scripts/api-caller-check.js
//
// 왜 따로 두는가 — 라우트 53개가 **이 함수 하나에 의존하게 될** 것이다(D11~D14). 그러면
// 여기서 한 글자 틀리는 것이 53곳에서 틀리는 것과 같다. 그래서 라우트를 바꾸기 **전에**
// 시험을 붙인다(docs/audit-2026-10.md D10 의 순서가 그 뜻이다).
//
// DB·세션·팀 권한은 **스텁**으로 갈아끼운다(loadCaller 의 opts.deps). 그래서 Supabase 키도
// 네트워크도 필요 없다 — 다른 하네스와 같이 어디서나 돈다.

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

const A = load(path.join(ROOT, 'lib/apiCaller.ts'))

let fails = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`)
  if (!ok) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}

// ── 스텁 ────────────────────────────────────────────────────────────────────
/** 그 사람의 engineers 한 행. */
const ROW = (over = {}) => ({
  engineer_id: 7, name: '홍길동', position: '책임', email: 'me@acctk.co.kr',
  permission_level: 'member', teams: '영업', resigned_date: null, can_switch_division: null,
  ...over,
})
/** 팀 권한 한 벌. */
const PERM = (menus, division = '계측') => ({ menus: new Set(menus), division, inSalesStats: true })

/**
 * 바깥을 전부 가짜로. 무엇이 어떻게 불렸는지 log 에 쌓아 두고 뒤에서 확인한다.
 *   email      — 세션이 돌려줄 메일. null 이면 로그인 안 된 것이다.
 *   row        — engineers 조회 결과(null 이면 행 없음)
 *   lookupError— 조회가 실패한 경우
 *   perm       — withTeamPerm 이 붙일 팀 권한
 */
const stub = ({ email = 'me@acctk.co.kr', row = ROW(), lookupError = null, perm = PERM([]), secret = 'cron-secret' } = {}) => {
  const log = { getUser: 0, getClaims: 0, select: null, eq: null, freshSeen: [] }
  const sb = {
    __kind: 'service-role',
    from: (table) => ({
      select: (cols) => { log.select = { table, cols }; return {
        eq: (col, val) => { log.eq = { col, val }; return {
          maybeSingle: async () => ({ data: row, error: lookupError }),
        } },
      } },
    }),
  }
  const deps = {
    session: async () => ({
      auth: {
        getUser: async () => { log.getUser += 1; return { data: { user: email ? { email } : null } } },
        getClaims: async () => { log.getClaims += 1; return { data: { claims: email ? { email } : {} }, error: null } },
      },
    }),
    admin: () => sb,
    withTeamPerm: async (e, opts) => { log.freshSeen.push(opts?.fresh); return e ? { ...e, perm } : null },
    cronSecret: () => secret,
  }
  return { deps, log, sb }
}
/** 가짜 요청. */
const req = (method, authorization = null) => ({ method, headers: { get: (n) => (n.toLowerCase() === 'authorization' ? authorization : null) } })
/** 응답을 상태+본문으로 눕힌다. */
const shape = async (res) => (res === null ? null : { status: res.status, body: await res.json() })

const run = async () => {
  // ════════════════════════════════════════════════════════════════
  console.log('── meetsNeed — 순수 판정 ──')
  const member = { ...ROW(), perm: PERM(['showroom']) }
  const superA = { ...ROW({ permission_level: 'superadmin' }), perm: PERM([]) }
  const semi = { ...ROW(), perm: PERM(['contact_semi'], '반도체') }
  eq('login 은 누구나', [A.meetsNeed({ kind: 'login' }, member), A.meetsNeed({ kind: 'login' }, superA)], [true, true])
  eq('superadmin', [A.meetsNeed({ kind: 'superadmin' }, member), A.meetsNeed({ kind: 'superadmin' }, superA)], [false, true])
  eq('menu — 켠 키', A.meetsNeed({ kind: 'menu', keys: ['showroom'] }, member), true)
  eq('menu — **하나라도** 통과하면 된다', A.meetsNeed({ kind: 'menu', keys: ['customers', 'showroom'] }, member), true)
  eq('menu — 전부 아니면 거짓', A.meetsNeed({ kind: 'menu', keys: ['customers', 'quote'] }, member), false)
  eq('menu — **빈 목록은 거부**(실수로 넘겼을 때 통과하는 것이 가장 나쁘다)',
    A.meetsNeed({ kind: 'menu', keys: [] }, member), false)
  eq('menu — superadmin 은 전부 통과', A.meetsNeed({ kind: 'menu', keys: ['quote'] }, superA), true)
  eq('menu — 없는 키는 거부(superadmin 은 통과 — permissions.ts 의 현재 동작)', [
    A.meetsNeed({ kind: 'menu', keys: ['no_such'] }, member),
    A.meetsNeed({ kind: 'menu', keys: ['no_such'] }, superA),
  ], [false, true])
  eq('semi — 반도체 팀 + 메뉴', A.meetsNeed({ kind: 'semi' }, semi), true)
  eq('semi — 계측 팀은 거짓', A.meetsNeed({ kind: 'semi' }, member), false)
  eq('semi — 전환 권한 없는 superadmin 이 계측 팀이면 거짓', A.meetsNeed({ kind: 'semi' }, superA), false)
  eq('cron 은 사람 판정이 아니다 — 여기서는 늘 거짓', A.meetsNeed({ kind: 'cron' }, superA), false)

  console.log('\n── freshFor — 신선도 기본값 ──')
  eq('쓰기 메서드는 새로 읽는다', ['POST', 'PATCH', 'PUT', 'DELETE'].map(m => A.freshFor(m)), [true, true, true, true])
  eq('읽기 메서드는 캐시', ['GET', 'HEAD', 'OPTIONS', 'get'].map(m => A.freshFor(m)), [false, false, false, false])
  eq('**메서드를 모르면 새로 읽는다**(낡은 판정이 허용으로 기울지 않게)',
    [A.freshFor(undefined), A.freshFor(null), A.freshFor('')], [true, true, true])
  eq('손으로 적으면 그 값이 이긴다', [A.freshFor('GET', true), A.freshFor('POST', false)], [true, false])

  // ════════════════════════════════════════════════════════════════
  console.log('\n── loadCaller — Need 별 분기 ──')
  {
    const s = stub({ perm: PERM(['showroom']) })
    const r = await A.loadCaller({ kind: 'menu', keys: ['showroom'] }, { tag: 't', req: req('POST'), deps: s.deps })
    eq('통과하면 error 가 null 이고 caller·sb 가 온다',
      [r.error, r.caller.engineer_id, r.caller.email, r.sb.__kind], [null, 7, 'me@acctk.co.kr', 'service-role'])
    eq('조회는 service role 로, 쓰는 칸만 읽는다',
      [s.log.select.table, s.log.select.cols === A.CALLER_COLUMNS, s.log.eq], ['engineers', true, { col: 'email', val: 'me@acctk.co.kr' }])
  }
  {
    const s = stub({ perm: PERM(['showroom']) })
    const r = await A.loadCaller({ kind: 'menu', keys: ['customers'] }, { tag: 't', req: req('POST'), deps: s.deps })
    eq('권한이 없으면 403 Forbidden · caller·sb 는 null',
      [await shape(r.error), r.caller, r.sb], [{ status: 403, body: { error: 'Forbidden' } }, null, null])
  }
  {
    const s = stub()
    const r = await A.loadCaller({ kind: 'login' }, { tag: 't', req: req('GET'), deps: s.deps })
    eq('login — 켠 메뉴가 없어도 통과', r.error, null)
  }
  {
    const s = stub({ row: ROW({ permission_level: 'superadmin' }) })
    const r = await A.loadCaller({ kind: 'superadmin' }, { tag: 't', req: req('POST'), deps: s.deps })
    eq('superadmin — 통과', r.error, null)
    const s2 = stub()
    const r2 = await A.loadCaller({ kind: 'superadmin' }, { tag: 't', req: req('POST'), deps: s2.deps })
    eq('superadmin — 팀원은 403', (await shape(r2.error)).status, 403)
  }
  {
    const s = stub({ perm: PERM(['contact_semi'], '반도체') })
    const r = await A.loadCaller({ kind: 'semi' }, { tag: 't', req: req('PATCH'), deps: s.deps })
    eq('semi — 반도체 팀 통과', r.error, null)
    const s2 = stub({ perm: PERM(['contact_semi'], '계측') })
    const r2 = await A.loadCaller({ kind: 'semi' }, { tag: 't', req: req('PATCH'), deps: s2.deps })
    eq('semi — 계측 팀 403', (await shape(r2.error)).status, 403)
  }

  console.log('\n── loadCaller — cron ──')
  {
    const s = stub()
    const r = await A.loadCaller({ kind: 'cron' }, { tag: 't', req: req('GET', 'Bearer cron-secret'), deps: s.deps })
    eq('비밀값이 맞으면 통과 — **사람은 없다(caller null)**, sb 는 온다',
      [r.error, r.caller, r.sb.__kind], [null, null, 'service-role'])
    eq('세션을 보지 않는다', [s.log.getUser, s.log.getClaims], [0, 0])
  }
  {
    const s = stub()
    const r = await A.loadCaller({ kind: 'cron' }, { tag: 't', req: req('GET', 'Bearer wrong'), deps: s.deps })
    eq('비밀값이 틀리면 401', await shape(r.error), { status: 401, body: { error: 'Unauthorized' } })
  }
  {
    const s = stub()
    const r = await A.loadCaller({ kind: 'cron' }, { tag: 't', req: req('GET'), deps: s.deps })
    eq('헤더가 없으면 401', (await shape(r.error)).status, 401)
  }
  {
    const s = stub({ secret: null })
    const r = await A.loadCaller({ kind: 'cron' }, { tag: 't', req: req('GET', 'Bearer x'), deps: s.deps })
    eq('**CRON_SECRET 이 없으면 503**(설정이 없는 것과 권한 없음을 가른다)',
      await shape(r.error), { status: 503, body: { error: 'Not configured' } })
  }
  {
    const s = stub()
    const r = await A.loadCaller({ kind: 'cron' }, { tag: 't', deps: s.deps })
    eq('요청을 안 넘기면 헤더를 볼 수 없어 401', (await shape(r.error)).status, 401)
  }

  console.log('\n── loadCaller — 막는 경우 ──')
  {
    const s = stub({ email: null })
    const r = await A.loadCaller({ kind: 'login' }, { tag: 't', req: req('POST'), deps: s.deps })
    eq('로그인 안 됨 → 401', await shape(r.error), { status: 401, body: { error: 'Unauthorized' } })
  }
  {
    const s = stub({ row: null })
    const r = await A.loadCaller({ kind: 'login' }, { tag: 't', req: req('POST'), deps: s.deps })
    eq('engineers 행이 없으면 403(계정은 있는데 직원이 아니다)', (await shape(r.error)).status, 403)
  }
  {
    const s = stub({ row: null, lookupError: { code: '42501', message: 'permission denied' } })
    const r = await A.loadCaller({ kind: 'login' }, { tag: 't', req: req('POST'), deps: s.deps })
    eq('**조회가 실패해도 403**(fail-closed — 허용으로 떨어뜨리지 않는다)', (await shape(r.error)).status, 403)
  }
  {
    const s = stub({ row: ROW({ resigned_date: '2026-10-31' }) })
    const r = await A.loadCaller({ kind: 'login' }, { tag: 't', req: req('POST'), deps: s.deps })
    eq('**퇴사자는 403**(모든 라우트 공통 — 종전에는 8/53 만 보았다)', (await shape(r.error)).status, 403)
  }
  {
    const s = stub({ row: ROW({ resigned_date: '2026-10-31', permission_level: 'superadmin' }) })
    const r = await A.loadCaller({ kind: 'login' }, { tag: 't', req: req('POST'), deps: s.deps })
    eq('퇴사한 superadmin 도 막는다', (await shape(r.error)).status, 403)
  }

  console.log('\n── loadCaller — 신선도가 실제로 넘어가는가 ──')
  {
    const s = stub()
    await A.loadCaller({ kind: 'login' }, { tag: 't', req: req('POST'), deps: s.deps })
    eq('POST → withTeamPerm({fresh:true})', s.log.freshSeen, [true])
  }
  {
    const s = stub()
    await A.loadCaller({ kind: 'login' }, { tag: 't', req: req('GET'), deps: s.deps })
    eq('GET → 캐시(fresh:false)', s.log.freshSeen, [false])
  }
  {
    const s = stub()
    await A.loadCaller({ kind: 'login' }, { tag: 't', deps: s.deps })
    eq('메서드를 모르면 새로 읽는다', s.log.freshSeen, [true])
  }
  {
    const s = stub()
    await A.loadCaller({ kind: 'login' }, { tag: 't', method: 'GET', fresh: true, deps: s.deps })
    eq('손으로 적은 fresh 가 이긴다', s.log.freshSeen, [true])
  }

  console.log('\n── loadCaller — readOnly ──')
  {
    const s = stub()
    const r = await A.loadCaller({ kind: 'login' }, { tag: 't', req: req('GET'), readOnly: true, deps: s.deps })
    eq('읽기 + readOnly → **getUser 왕복을 하지 않는다**(토큰 로컬 검증)',
      [r.error, s.log.getUser, s.log.getClaims], [null, 0, 1])
  }
  {
    const s = stub()
    const r = await A.loadCaller({ kind: 'login' }, { tag: 't', req: req('POST'), readOnly: true, deps: s.deps })
    eq('**쓰기 + readOnly → 무시하고 getUser 로 확인한다**(로그아웃한 토큰을 걸러야 한다)',
      [r.error, s.log.getUser, s.log.getClaims], [null, 1, 0])
  }
  {
    const s = stub()
    await A.loadCaller({ kind: 'login' }, { tag: 't', method: 'GET', fresh: true, readOnly: true, deps: s.deps })
    eq('fresh 를 손으로 켰다고 readOnly 가 꺼지지는 않는다(메서드가 정한다)', [s.log.getUser, s.log.getClaims], [0, 1])
  }
  {
    const s = stub()
    await A.loadCaller({ kind: 'login' }, { tag: 't', req: req('GET'), deps: s.deps })
    eq('readOnly 를 적지 않으면 getUser 로 확인한다(기본)', [s.log.getUser, s.log.getClaims], [1, 0])
  }

  // ════════════════════════════════════════════════════════════════
  console.log('\n── isOwner — 소유자 칸 7개 ──')
  const me = { engineer_id: 7 }
  eq('칸 이름 7개와 우선순위', [...A.OWNER_COLUMNS],
    ['created_by', 'requester_id', 'author_id', 'uploaded_by', 'owner_id', 'assigned_to', 'engineer_id'])
  eq('칸마다 본인을 알아본다', A.OWNER_COLUMNS.map(c => A.isOwner({ [c]: 7 }, me)),
    [true, true, true, true, true, true, true])
  eq('남의 것은 거짓', A.OWNER_COLUMNS.map(c => A.isOwner({ [c]: 9 }, me)),
    [false, false, false, false, false, false, false])
  eq('어느 칸에서 읽었는지 알려준다', [
    A.ownerOf({ created_by: 7 }), A.ownerOf({ engineer_id: 9 }), A.ownerOf({ assigned_to: 3 }),
  ], [{ id: 7, column: 'created_by' }, { id: 9, column: 'engineer_id' }, { id: 3, column: 'assigned_to' }])
  eq('**앞선 칸이 이긴다** — 대필 견적은 created_by(대필자) 것이다(engineer_id 는 실적 담당자)',
    [A.isOwner({ created_by: 9, engineer_id: 7 }, me), A.isOwner({ created_by: 7, engineer_id: 9 }, me)], [false, true])
  eq('앞선 칸이 null 이면 다음 칸을 본다', A.isOwner({ created_by: null, engineer_id: 7 }, me), true)
  eq('앞선 칸이 아예 없으면 다음 칸', A.isOwner({ engineer_id: 7 }, me), true)
  eq('**소유자 칸이 하나도 없으면 거짓**(모르는 줄을 본인 것으로 보지 않는다)',
    [A.isOwner({ quote_id: 7 }, me), A.isOwner({}, me), A.ownerOf({})], [false, false, null])
  eq('줄이 없거나 이상하면 거짓', [
    A.isOwner(null, me), A.isOwner(undefined, me), A.isOwner(7, me), A.isOwner('7', me), A.ownerOf(null),
  ], [false, false, false, false, null])
  eq('호출자가 없으면 거짓', [A.isOwner({ created_by: 7 }, null), A.isOwner({ created_by: 7 }, undefined)], [false, false])
  eq('이상한 번호는 칸이 없는 것으로 본다', [
    A.isOwner({ created_by: 0, engineer_id: 7 }, me), A.ownerOf({ created_by: -3 }), A.ownerOf({ created_by: 1.5 }),
  ], [true, null, null])
  eq('문자열 숫자도 받는다(PostgREST 가 bigint 를 문자열로 줄 수 있다)', A.isOwner({ created_by: '7' }, me), true)
  eq('본인 또는 관리자', [
    A.isOwnerOrSuperAdmin({ created_by: 9 }, { engineer_id: 7, permission_level: 'superadmin' }),
    A.isOwnerOrSuperAdmin({ created_by: 9 }, { engineer_id: 7, permission_level: 'member' }),
    A.isOwnerOrSuperAdmin({ created_by: 7 }, { engineer_id: 7, permission_level: 'member' }),
    A.isOwnerOrSuperAdmin({ created_by: 9 }, null),
  ], [true, false, true, false])

  console.log('\n── 견적의 「본인 견적인가」 — 종전 규칙과 같은가(D13) ──')
  // 라우트들이 손으로 쓰던 식은 `(created_by ?? engineer_id) === 나` 였다
  // (app/api/quote-duplicate · quote-delete 의 isWriter). isOwner 의 칸 우선순위가
  // 그 식과 **글자 단위로 같은 답**을 내는지 모든 조합으로 맞춰 본다.
  {
    const oldRule = (q, me) => (q.created_by ?? q.engineer_id) === me.engineer_id
    const vals = [null, 7, 9, undefined]
    const rows = []
    for (const created_by of vals) {
      for (const engineer_id of vals) {
        const q = {}
        if (created_by !== undefined) q.created_by = created_by
        if (engineer_id !== undefined) q.engineer_id = engineer_id
        rows.push({ q, old: oldRule(q, me), now: A.isOwner(q, me) })
      }
    }
    eq('16가지 조합에서 옛 식과 답이 같다', rows.filter(r => r.old !== r.now).map(r => r.q), [])
    eq('대필 — created_by 가 나면 참, 실적 담당자가 나여도 거짓',
      [A.isOwner({ created_by: 7, engineer_id: 9 }, me), A.isOwner({ created_by: 9, engineer_id: 7 }, me)], [true, false])
    eq('created_by 가 비면 실적 담당자를 본다(옛 ?? 규칙)',
      [A.isOwner({ created_by: null, engineer_id: 7 }, me), A.isOwner({ created_by: null, engineer_id: 9 }, me)], [true, false])
  }
  console.log(fails === 0 ? '\n모두 통과' : `\n실패 ${fails}건`)
  process.exit(fails === 0 ? 0 : 1)
}

run().catch(e => { console.error(e); process.exit(1) })
