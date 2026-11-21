// 회사 → 대리점 전환의 **검사만(dry_run) 실측** — 2026-11-21
//
// ── 왜 이름이 `-check.js` 가 아닌가 ──────────────────────────────────────────
//   이 도구는 **운영 DB 에 붙는다**(service_role 키가 필요하다). scripts/run-checks.js 는
//   이름이 `-check.js` 인 것만 돌리고, 그 하네스들은 키 없이 어디서나 도는 순수 함수
//   시험이다(그 파일 머리말의 약속). 그래서 이름을 달리 두었다 — 손으로 부른다:
//
//       node scripts/convert-agency-dryrun.js [몇 곳을 볼지]   (기본 40)
//
//   SQL 쪽 계약(어떤 칸이 오는지)은 scripts/convert-agency-check.js 가 **글자로** 지키고,
//   이 도구는 **실제 응답**이 그 계약대로인지 본다. 기대하는 칸 목록은 여기 한 벌만 두고
//   둘이 같이 쓴다(아래 SHAPES).
//
// ── 쓰기는 하지 않는다 ──────────────────────────────────────────────────────
//   p_dry_run 은 **언제나 true** 다. 이 파일에는 false 를 넣는 길이 없다.
//   함수는 dry_run 일 때 update 를 한 줄도 하지 않는다(SQL 의 ② 전환 앞에서 돌아간다).

const load = module.require.bind(module)
const fs = load('fs')
const path = load('path')

const ROOT = path.resolve(__dirname, '..')

/** 응답 모양 계약 — 세 갈래다. */
const SHAPES = {
  /** 지날 수 있다 — 검사만 하고 돌아왔다. */
  ok: ['ok', 'dry_run', 'company_id', 'company_name', 'site_id', 'site_name', 'agency_name', 'follows', 'follows_total'],
  /** 막혔다 — 회사 줄에 직접 붙은 참조가 있다. */
  blocked: ['ok', 'dry_run', 'company_id', 'company_name', 'site_id', 'site_name', 'blockers', 'blocker_total'],
  /** 아예 들어가지 못한다 — 예외로 돌아온다(회사 줄이 아니다 · 사업장이 1곳이 아니다 …). */
  thrown: ['message'],
}
module.exports = { SHAPES }

if (require.main !== module) return

let fail = 0
const ok = (name, cond, hint) => {
  if (cond) console.log(`OK   ${name}`)
  else { fail++; console.error(`FAIL ${name}${hint ? `  — ${hint}` : ''}`) }
}

const pickEnv = (key) => {
  const p = path.join(ROOT, '.env.local')
  if (!fs.existsSync(p)) return null
  const m = fs.readFileSync(p, 'utf8').match(new RegExp('^' + key + '=(.*)$', 'm'))
  return m ? m[1].trim() : null
}

;(async () => {
  const url = pickEnv('NEXT_PUBLIC_SUPABASE_URL')
  const key = pickEnv('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    console.log('SKIP — .env.local 에 키가 없다(이 도구는 운영 DB 에 붙는다)')
    process.exit(0)
  }
  const { createClient } = await import('file://' + path.join(ROOT, 'node_modules/@supabase/supabase-js/dist/index.mjs').split(path.sep).join('/'))
  const sb = createClient(url, key)

  /** dry_run 만 부른다. */
  const dry = async (companyId) => {
    const { data, error } = await sb.rpc('convert_company_to_agency', { p_company_id: companyId, p_dry_run: true })
    return error ? { thrown: true, message: error.message } : { thrown: false, data }
  }
  const keysOf = o => Object.keys(o).sort()
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])

  // ── 대상 고르기 — 읽기만 한다 ──────────────────────────────────────────
  const { data: rows, error } = await sb
    .from('customers')
    .select('customer_id, parent_customer_id, company_name, site_name, is_parent, is_agency, deleted_at')
    .is('deleted_at', null)
    .limit(5000)
  if (error) { console.error('고객 표를 읽지 못했다:', error.message); process.exit(1) }

  const liveKids = new Map()
  for (const r of rows) if (r.parent_customer_id) liveKids.set(r.parent_customer_id, (liveKids.get(r.parent_customer_id) || 0) + 1)
  const parents = rows.filter(r => r.is_parent && !r.is_agency)
  const one = parents.filter(r => (liveKids.get(r.customer_id) || 0) === 1)
  const many = parents.filter(r => (liveKids.get(r.customer_id) || 0) > 1)
  const site = rows.find(r => r.parent_customer_id && !r.is_parent && !r.is_agency)

  console.log(`\n회사 ${parents.length}곳 · 사업장 1곳인 회사 ${one.length} · 2곳 이상 ${many.length}`)

  console.log('\n── ① 함수가 보이는가(스키마 캐시) ──')
  const probe = await dry(one[0]?.customer_id ?? parents[0]?.customer_id ?? 0)
  const missing = probe.thrown && /Could not find the function|schema cache/i.test(probe.message)
  ok('RPC 로 부를 수 있다', !missing, probe.message)
  if (missing) { console.error('\nSQL 을 적용한 뒤 `notify pgrst, \'reload schema\';` 를 돌려야 한다.'); process.exit(1) }

  console.log('\n── ② 사업장이 1곳인 회사 — 지날 수 있거나(ok) 막히거나(blocked) ──')
  let okSeen = 0, blockedSeen = 0
  const SAMPLE_N = Number(process.argv[2]) || 40
  const sample = one.slice(0, SAMPLE_N)
  for (const c of sample) {
    const r = await dry(c.customer_id)
    if (r.thrown) { ok(`${c.company_name}(${c.customer_id}) — 예외는 message 하나다`, keysOf({ message: r.message }).length === 1, r.message); continue }
    const got = keysOf(r.data)
    if (r.data.ok === true) {
      okSeen++
      ok(`${c.company_name}(${c.customer_id}) — ok 모양`, same(got, [...SHAPES.ok].sort()), got.join(','))
      ok(`${c.company_name} — dry_run 이 true 다`, r.data.dry_run === true)
      ok(`${c.company_name} — follows 는 객체, follows_total 은 수`, r.data.follows && typeof r.data.follows === 'object' && typeof r.data.follows_total === 'number')
      const sum = Object.values(r.data.follows).reduce((a, b) => a + b, 0)
      ok(`${c.company_name} — follows 의 합(${sum})이 follows_total(${r.data.follows_total})과 같다`, sum === r.data.follows_total)
      ok(`${c.company_name} — site_id 가 그 회사의 사업장이다`, rows.some(x => x.customer_id === r.data.site_id && x.parent_customer_id === c.customer_id))
      if (okSeen === 1) console.log('     보기: ' + JSON.stringify(r.data))
    } else {
      blockedSeen++
      ok(`${c.company_name}(${c.customer_id}) — blocked 모양`, same(got, [...SHAPES.blocked].sort()), got.join(','))
      const sum = Object.values(r.data.blockers).reduce((a, b) => a + b, 0)
      ok(`${c.company_name} — blockers 의 합(${sum})이 blocker_total(${r.data.blocker_total})과 같다`, sum === r.data.blocker_total)
      ok(`${c.company_name} — 막힌 표 이름이 「표.칸」 꼴이다`, Object.keys(r.data.blockers).every(k => /^[a-z_0-9]+\.[a-z_0-9]+$/.test(k)), Object.keys(r.data.blockers).join(','))
      ok(`${c.company_name} — 자식 사업장(customers.parent_customer_id)은 막는 사유가 아니다`, !('customers.parent_customer_id' in r.data.blockers))
      if (blockedSeen === 1) console.log('     보기: ' + JSON.stringify(r.data))
    }
  }
  console.log(`     본 회사 ${sample.length}곳(사업장 1곳인 회사 ${one.length} 중) · 지날 수 있다 ${okSeen} · 막혔다 ${blockedSeen}`)
  ok('두 갈래 중 하나로만 돌아온다', okSeen + blockedSeen > 0)
  if (blockedSeen === 0) {
    // 막힘은 **데이터에 달렸다** — 회사 줄을 직접 가리키는 기록이 있어야 생긴다.
    // 지금 데이터에는 그런 회사가 없다(모든 기록이 사업장 줄에 붙어 있다).
    // 모양 자체는 정적 하네스(convert-agency-check.js ⑦)가 SQL 글에서 지킨다.
    console.log('     ※ 막힘(blocked) 갈래는 실측하지 못했다 — 회사 줄을 직접 가리키는 기록을')
    console.log('        가진 회사가 데이터에 없다. 그 모양은 convert-agency-check.js ⑦ 이 본다.')
  }

  console.log('\n── ③ 들어갈 수 없는 자리는 예외로 돌아온다 ──')
  if (many.length) {
    const r = await dry(many[0].customer_id)
    ok(`사업장이 ${liveKids.get(many[0].customer_id)}곳인 회사는 막힌다`, r.thrown && /사업장이 정확히 1곳/.test(r.message), r.thrown ? r.message : JSON.stringify(r.data))
  } else console.log('     (사업장 2곳 이상인 회사가 없다 — 건너뛴다)')
  if (site) {
    const r = await dry(site.customer_id)
    ok('사업장 줄을 넣으면 막힌다', r.thrown && /회사 줄이 아닙니다/.test(r.message), r.thrown ? r.message : JSON.stringify(r.data))
  }
  const gone = await dry(-1)
  ok('없는 id 는 막힌다', gone.thrown && /회사를 찾을 수 없습니다/.test(gone.message), gone.thrown ? gone.message : JSON.stringify(gone.data))

  console.log('\n── ④ 쓰기는 하지 않았다 ──')
  const { count } = await sb.from('customers').select('customer_id', { count: 'exact', head: true }).is('deleted_at', null)
  ok(`살아있는 줄 수가 그대로다(${count})`, count === rows.length, `${rows.length} → ${count}`)

  console.log(fail === 0 ? '\n전부 통과' : `\n${fail}건 실패`)
  process.exit(fail === 0 ? 0 : 1)
})()
