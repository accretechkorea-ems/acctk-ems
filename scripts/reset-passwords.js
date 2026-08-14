// 전 직원 비밀번호를 초기 비밀번호로 일괄 리셋하는 일회성 스크립트.
//
// 실행:
//   node scripts/reset-passwords.js              → dry-run (대상만 출력, 아무것도 바꾸지 않음)
//   node scripts/reset-passwords.js --execute    → 실제 리셋
//
// 준비: 아래 ADMIN_EMAIL / NEW_PASSWORD 두 상수를 채운 뒤 실행할 것.
//       service_role 키는 .env.local 에서 읽는다(코드에 넣지 말 것).
//
// 대상: engineers 의 이메일과 auth 계정을 대조해 겹치는 계정.
//       ADMIN_EMAIL 과 퇴사자(resigned_date 있음)는 제외한다.
//       engineers 에 없는 auth 계정은 건드리지 않고 목록만 보여준다.

// ── 여기를 채울 것 ──────────────────────────────────────────────────────────
const ADMIN_EMAIL = 'jwkwon@accretechkorea.com'      // 제외할 관리자 본인 이메일
const NEW_PASSWORD = 'acctk11?'     // 초기 비밀번호
// ───────────────────────────────────────────────────────────────────────────

const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')

const EXECUTE = process.argv.includes('--execute')
const WAIT_MS = 3000

// .env.local 을 직접 읽는다(dotenv 미설치). KEY=VALUE 한 줄씩, 주석·빈 줄은 건너뛴다.
function loadEnv() {
  const file = path.join(__dirname, '..', '.env.local')
  if (!fs.existsSync(file)) {
    console.error('.env.local 을 찾을 수 없습니다:', file)
    process.exit(1)
  }
  const env = {}
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const s = line.trim()
    if (!s || s.startsWith('#')) continue
    const eq = s.indexOf('=')
    if (eq < 1) continue
    env[s.slice(0, eq).trim()] = s.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
  }
  return env
}

const norm = e => (e || '').trim().toLowerCase()
const sleep = ms => new Promise(r => setTimeout(r, ms))

// auth 계정은 페이지 단위로만 받아올 수 있어 끝까지 훑는다.
async function listAllAuthUsers(supabase) {
  const users = []
  const perPage = 200
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage })
    if (error) throw new Error('auth 계정 조회 실패: ' + error.message)
    users.push(...data.users)
    if (data.users.length < perPage) break
  }
  return users
}

async function main() {
  // ── 안전장치 1: 상수가 비어 있으면 중단 ──
  if (!ADMIN_EMAIL.trim() || !NEW_PASSWORD.trim()) {
    console.error('중단: 스크립트 상단의 ADMIN_EMAIL 과 NEW_PASSWORD 를 먼저 채워주세요.')
    process.exit(1)
  }

  const env = loadEnv()
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    console.error('중단: .env.local 에 NEXT_PUBLIC_SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY 가 있어야 합니다.')
    process.exit(1)
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  // ── 직원 명단 ──
  const { data: engineers, error: engErr } = await supabase
    .from('engineers')
    .select('engineer_id, name, email, resigned_date')
  if (engErr) {
    console.error('engineers 조회 실패:', engErr.message)
    process.exit(1)
  }

  // ── auth 계정 ──
  const authUsers = await listAllAuthUsers(supabase)
  const authByEmail = new Map(authUsers.map(u => [norm(u.email), u]))

  // ── 대상 추리기 ──
  const targets = []
  const skippedAdmin = []
  const skippedResigned = []
  const noAuthAccount = []      // engineers 에는 있는데 auth 계정이 없는 사람

  for (const e of engineers) {
    const email = norm(e.email)
    if (!email) continue
    if (email === norm(ADMIN_EMAIL)) { skippedAdmin.push(e); continue }
    if (e.resigned_date) { skippedResigned.push(e); continue }
    const user = authByEmail.get(email)
    if (!user) { noAuthAccount.push(e); continue }
    targets.push({ id: user.id, name: e.name || '(이름 없음)', email })
  }

  // engineers 에 없는 auth 계정 — 건드리지 않고 보여주기만 한다
  const engineerEmails = new Set(engineers.map(e => norm(e.email)).filter(Boolean))
  const orphanAuth = authUsers.filter(u => u.email && !engineerEmails.has(norm(u.email)))

  // ── 출력 ──
  console.log('')
  console.log('== 비밀번호 리셋', EXECUTE ? '[실제 실행]' : '[dry-run]', '==')
  console.log('')
  console.log('engineers:', engineers.length, '명 / auth 계정:', authUsers.length, '개')
  console.log('')

  console.log('[대상]', targets.length, '명')
  targets.forEach((t, i) => console.log(`  ${String(i + 1).padStart(3)}. ${t.name}  ${t.email}`))
  console.log('')

  if (skippedAdmin.length) {
    console.log('[제외 - 관리자 본인]', skippedAdmin.length, '명')
    skippedAdmin.forEach(e => console.log(`  - ${e.name || '(이름 없음)'}  ${e.email}`))
    console.log('')
  }
  if (skippedResigned.length) {
    console.log('[제외 - 퇴사자]', skippedResigned.length, '명')
    skippedResigned.forEach(e => console.log(`  - ${e.name || '(이름 없음)'}  ${e.email}  (퇴사 ${e.resigned_date})`))
    console.log('')
  }
  if (noAuthAccount.length) {
    console.log('[건너뜀 - auth 계정 없음]', noAuthAccount.length, '명')
    noAuthAccount.forEach(e => console.log(`  - ${e.name || '(이름 없음)'}  ${e.email}`))
    console.log('')
  }
  if (orphanAuth.length) {
    console.log('[손대지 않음 - engineers 에 없는 auth 계정]', orphanAuth.length, '개')
    orphanAuth.forEach(u => console.log(`  - ${u.email}`))
    console.log('')
  }

  // ── 안전장치 2: 대상이 0명이면 중단 ──
  if (targets.length === 0) {
    console.log('중단: 리셋할 대상이 없습니다.')
    return
  }

  if (!EXECUTE) {
    console.log('dry-run 입니다. 아무것도 바꾸지 않았습니다.')
    console.log('실제로 리셋하려면: node scripts/reset-passwords.js --execute')
    return
  }

  // ── 안전장치 3: 건수 재확인 + 3초 대기 ──
  console.log(`${targets.length}명의 비밀번호를 초기 비밀번호로 바꿉니다. ${WAIT_MS / 1000}초 뒤 시작합니다. (중지: Ctrl+C)`)
  await sleep(WAIT_MS)
  console.log('')

  let done = 0
  const failed = []
  for (const t of targets) {
    const { error } = await supabase.auth.admin.updateUserById(t.id, { password: NEW_PASSWORD })
    if (error) {
      failed.push({ ...t, message: error.message })
      console.log(`  실패  ${t.name}  ${t.email}  → ${error.message}`)
    } else {
      done++
      console.log(`  완료  ${t.name}  ${t.email}`)
    }
  }

  console.log('')
  console.log('== 요약 ==')
  console.log('성공:', done, '건 / 실패:', failed.length, '건 (대상', targets.length, '건)')
  if (failed.length) {
    console.log('')
    console.log('[실패 목록]')
    failed.forEach(f => console.log(`  - ${f.name}  ${f.email}  → ${f.message}`))
    process.exitCode = 1
  }
}

main().catch(err => {
  console.error('오류:', err.message)
  process.exit(1)
})
