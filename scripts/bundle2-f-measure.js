// 묶음2 F — **납품 예정 장비** 실측 (2026-11-26). [검증용] 줄만 만들고, 만든 id 만 지운다.
//
//   NEXT_DIST_DIR=.next-probe npx next dev -p 3100
//   node scripts/bundle2-f-measure.js --stage=INS          # [검증용] 납품 예정 장비 한 줄
//   node scripts/bundle2-f-measure.js --stage=READ         # 사업장 화면·목록·홈에 어떻게 보이나
//   node scripts/bundle2-f-measure.js --stage=COMMISSION   # 신규설치 레포트 → 운용 전환
//   node scripts/bundle2-f-measure.js --stage=CLEAN        # 장부에 적힌 id 만 지운다
//
// ── 규칙 (앞 회차와 같다) ──────────────────────────────────────────────────
//   ① 만드는 줄의 이름은 **반드시 [검증용]** 으로 시작한다(아래 MARK).
//   ② 만든 id 는 docs/bundle2-f-ids-20261126.json 에 쌓는다 — 지울 때 **그 파일만** 본다.
//   ③ 장부에 넣는 것은 **내가 만든 줄의 id** 뿐이다. 「표 전체」·「사업장의 전부」 같은
//     범위 조회 결과를 장부에 넣지 않는다. 사건(customer_events)은 **내가 만든 그 장비를
//     가리키는 줄**만 집는다(payload 의 device_id 가 내 id 인 것) — 범위가 아니다.
//   ④ 사업장은 **빌린다** — 한 글자도 고치지 않는다. 읽기만 한다.
//   ⑤ .env.local 의 값은 어디에도 찍지 않는다.
//
// ── 왜 장비를 **폼이 아니라 여기서** 만드나 ────────────────────────────────
//   지시는 「장비 폼에서 납품 예정 상태로 직접 등록」이었는데, **그 칸이 없다** —
//   장비 수정 폼에는 상태를 「납품 예정」으로 고르는 자리도, 설치 예정월 칸도 없다
//   (install_due_month 를 받는 화면은 견적의 납품 예정 장비 표 하나뿐이다:
//   components/quote/DeliveryDevices.tsx). 지시가 「견적 없이」라고 못 박았으므로,
//   줄은 여기서 만들고 **화면이 그 줄을 어떻게 보여 주는지**를 잰다. 폼에 칸을 더하는
//   일은 실측이 아니라 만드는 일이라 하지 않았다 — 보고서에 판단 필요로 적는다.

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const arg = (name, dflt) => {
  const hit = process.argv.slice(2).find(a => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : dflt
}
const BASE = arg('base', 'http://localhost:3100')
const STAGE = arg('stage', 'READ')
/** 빌릴 사업장. 한 글자도 고치지 않는다. */
const SITE = Number(arg('site', '593'))

/** 만드는 줄의 이름표. 이 글자로 시작하지 않는 것은 만들지 않는다. */
const MARK = '[검증용]'
const IDS_FILE = path.join(ROOT, 'docs/bundle2-f-ids-20261126.json')

const env = {}
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim())
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

// ── 만든 id 장부 ───────────────────────────────────────────────────────────
const ledger = fs.existsSync(IDS_FILE) ? JSON.parse(fs.readFileSync(IDS_FILE, 'utf8')) : {}
const note = (bucket, value) => {
  ledger[bucket] = [...new Set([...(ledger[bucket] ?? []), value])]
  fs.writeFileSync(IDS_FILE, JSON.stringify(ledger, null, 2) + '\n')
  console.log(`  ↳ 장부에 적었다: ${bucket} ${value}`)
}

const H = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
}
async function sel(table, query) {
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: H })
  if (!r.ok) throw new Error(`${table} 조회 실패 ${r.status} ${(await r.text()).slice(0, 200)}`)
  return r.json()
}
async function ins(table, row) {
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(row),
  })
  if (!r.ok) throw new Error(`${table} 쓰기 실패 ${r.status} ${(await r.text()).slice(0, 300)}`)
  return (await r.json())[0]
}
async function del(table, idCol, id) {
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}?${idCol}=eq.${id}`, {
    method: 'DELETE', headers: H,
  })
  if (!r.ok) throw new Error(`${table} 삭제 실패 ${r.status} ${(await r.text()).slice(0, 200)}`)
}

let fails = 0
const ok = (name, cond, hint) => {
  if (!cond) fails++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond || !hint ? '' : `  — ${hint}`}`)
}
const say = (name, value) => console.log(`··   ${name}: ${value}`)

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'load' })
  await page.getByPlaceholder('아이디').fill(env.E2E_EMAIL)
  await page.getByPlaceholder('비밀번호').fill(env.E2E_PASSWORD)
  await page.getByRole('button', { name: '로그인' }).click()
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30000 })
}
async function dismissNotice(page) {
  for (let i = 0; i < 3; i++) {
    const btn = page.getByRole('button', { name: '확인' }).first()
    if (await btn.isVisible().catch(() => false)) await btn.click().catch(() => {}); else break
    await page.waitForTimeout(200)
  }
}

const thisMonth = () => new Date().toISOString().slice(0, 7)

// ── INS — [검증용] 납품 예정 장비 한 줄 ────────────────────────────────────
async function stageIns() {
  console.log('── INS: [검증용] 납품 예정 장비 ──')
  const site = (await sel('customers', `customer_id=eq.${SITE}&select=customer_id,company_name,site_name`))[0]
  if (!site) { console.error(`사업장 ${SITE} 를 찾지 못했다`); process.exit(1) }
  say('빌린 사업장(고치지 않는다)', `${site.customer_id} · ${site.company_name}`)

  // 마스터에서 하나 고른다 — 「마스터 선택」 길이다(없으면 자유 입력으로 간다).
  const master = (await sel('equipment_models', 'select=id,name,lineup_id&active=is.true&limit=1'))[0] ?? null
  say('고른 마스터', master ? `${master.id} · ${master.name}` : '(없다 — 자유 입력)')

  const row = {
    customer_id: SITE,
    device_name: `${MARK} 납품예정`,
    device_name2: master?.name ?? 'DELIVERY-TEST',
    status: '납품 예정',
    install_due_month: thisMonth(),
    master_pending: !master,
  }
  const made = await ins('devices', row)
  say('만든 장비', `${made.device_id} · ${made.device_name} ${made.device_name2} · 예정 ${made.install_due_month}`)
  note('devices', made.device_id)

  ok('상태가 납품 예정이다', made.status === '납품 예정')
  ok('설치 예정월이 들어갔다', made.install_due_month === thisMonth())
  ok('S/N 은 비어 있다(아직 안 온 장비다)', !made.serial_number)
  ok('이름이 [검증용] 으로 시작한다', String(made.device_name).startsWith(MARK))
}

// ── READ — 화면이 그 줄을 어떻게 보여 주나 ─────────────────────────────────
async function stageRead(page) {
  console.log('\n── READ: 화면 표시 ──')
  const id = (ledger.devices ?? [])[0]
  if (!id) { console.log('건너뜀 — 장부에 만든 장비가 없다(먼저 --stage=INS)'); return }

  await page.goto(`${BASE}/customer/${SITE}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(7000)
  await dismissNotice(page)

  const seen = await page.evaluate(mark => {
    const cards = [...document.querySelectorAll('article')]
    const mine = cards.find(c => (c.textContent ?? '').includes(mark))
    if (!mine) return { found: false, cards: cards.length }
    const cs = getComputedStyle(mine)
    const text = (mine.textContent ?? '').replace(/\s+/g, ' ')
    return {
      found: true,
      cards: cards.length,
      borderStyle: cs.borderStyle,
      borderColor: cs.borderColor,
      // 「예정 2026-11」·「지연 · …」 뱃지
      badge: (text.match(/(지연 · )?예정 \d{4}-\d{2}/) ?? [null])[0],
      // 가동 수에서 빠지는가 — 「가동 N」 같은 머리 글자를 함께 집어 본다.
      head: (document.body.textContent ?? '').replace(/\s+/g, ' ').match(/장비 \d+/)?.[0] ?? null,
    }
  }, MARK)

  ok('사업장 화면에 그 장비 카드가 선다', seen.found, `카드 ${seen.cards}장 중 없다`)
  if (seen.found) {
    say('카드 테두리', `${seen.borderStyle} ${seen.borderColor}`)
    ok('점선으로 두른다(아직 없는 장비다)', seen.borderStyle === 'dashed')
    say('뱃지', seen.badge ?? '(없다)')
    ok('예정월 뱃지가 붙는다', !!seen.badge)
  }

  // 홈의 「설치 예정」 할 일 줄 — **견적이 있어야** 뜬다(소유 판정이 source_quote_id 다).
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(5000)
  await dismissNotice(page)
  const onHome = await page.evaluate(mark => (document.body.textContent ?? '').includes(mark), MARK)
  say('홈 할 일에 그 줄이 있나', String(onHome))
  console.log('     (없는 것이 지금 규칙이다 — hooks/dashboard/useToday.ts 는 **내 견적이 만든**')
  console.log('      장비만 센다: source_quote_id 가 내 견적 id 에 들어 있어야 한다.')
  console.log('      견적 없이 만든 줄은 주인이 없어 홈에 뜨지 않는다. 보고서에 판단 필요로 적는다.)')
}

// ── COMMISSION — 신규설치 레포트 → 운용 전환 ───────────────────────────────
async function stageCommission(page) {
  console.log('\n── COMMISSION: 신규설치 → 운용 ──')
  const id = (ledger.devices ?? [])[0]
  if (!id) { console.log('건너뜀 — 장부에 만든 장비가 없다'); return }

  const before = (await sel('devices', `device_id=eq.${id}&select=status,serial_number,install_date,install_due_month`))[0]
  say('바꾸기 전', `${before.status} · S/N ${before.serial_number ?? '-'} · 예정 ${before.install_due_month ?? '-'}`)

  // 화면의 그 창이 부르는 **그 라우트**를 로그인한 브라우저에서 그대로 부른다
  // (components/customer/modals/ServiceAddModal.tsx 가 신규설치 저장 뒤에 부르는 길이다).
  const serial = `${MARK}-SN-${Date.now().toString().slice(-6)}`
  const today = new Date().toISOString().slice(0, 10)
  const res = await page.evaluate(async ([deviceId, sn, day]) => {
    const r = await fetch('/api/customer-change', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'device-commission', id: deviceId, serial_number: sn, install_date: day }),
    })
    return { status: r.status, body: await r.json().catch(() => null) }
  }, [id, serial, today])
  say('라우트 응답', `${res.status} ${JSON.stringify(res.body).slice(0, 120)}`)

  const after = (await sel('devices', `device_id=eq.${id}&select=status,serial_number,install_date,install_due_month`))[0]
  say('바꾼 뒤', `${after.status} · S/N ${after.serial_number ?? '-'} · 납입 ${after.install_date ?? '-'} · 예정 ${after.install_due_month ?? '-'}`)
  ok('상태가 사용중으로 바뀐다', after.status === '사용중')
  ok('S/N 이 들어간다', after.serial_number === serial)
  ok('납입일이 들어간다', after.install_date === today)
  ok('설치 예정월이 비워진다', after.install_due_month === null)

  // 그 행위가 남긴 사건 — **내 장비를 가리키는 줄만** 집어 장부에 적는다(범위 조회가 아니다).
  const events = await sel('customer_events', `customer_id=eq.${SITE}&event_type=eq.device_edited&select=id,payload&order=id.desc&limit=20`)
  for (const e of events) {
    if (Number(e.payload?.device_id) === Number(id)) note('customer_events', e.id)
  }
}

// ── CLEAN — 장부에 적힌 id 만 ──────────────────────────────────────────────
async function stageClean() {
  console.log('\n── CLEAN: 장부에 적힌 id 만 지운다 ──')
  console.log(JSON.stringify(ledger, null, 2))
  // 사건을 먼저 지운다(장비를 가리키는 줄이다).
  for (const id of ledger.customer_events ?? []) {
    await del('customer_events', 'id', id); console.log(`  지웠다 customer_events ${id}`)
  }
  for (const id of ledger.devices ?? []) {
    const row = (await sel('devices', `device_id=eq.${id}&select=device_id,device_name`))[0]
    if (!row) { console.log(`  이미 없다 devices ${id}`); continue }
    if (!String(row.device_name ?? '').startsWith(MARK)) {
      console.error(`  ⚠ 멈춘다 — devices ${id} 의 이름이 ${MARK} 로 시작하지 않는다: ${row.device_name}`)
      process.exit(1)
    }
    await del('devices', 'device_id', id); console.log(`  지웠다 devices ${id}`)
  }
  // 남은 것이 없는지 **적힌 id 로만** 확인한다.
  for (const id of ledger.devices ?? []) {
    const left = await sel('devices', `device_id=eq.${id}&select=device_id`)
    ok(`devices ${id} 가 없다`, left.length === 0)
  }
  for (const id of ledger.customer_events ?? []) {
    const left = await sel('customer_events', `id=eq.${id}&select=id`)
    ok(`customer_events ${id} 가 없다`, left.length === 0)
  }
  fs.writeFileSync(IDS_FILE, JSON.stringify({ ...ledger, cleaned_at: new Date().toISOString() }, null, 2) + '\n')
}

;(async () => {
  if (STAGE === 'INS') { await stageIns(); return done() }
  if (STAGE === 'CLEAN') { await stageClean(); return done() }
  const { chromium } = require(path.join(ROOT, 'node_modules/playwright-core'))
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await ctx.newPage()
  const errs = []
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 150)) })
  try {
    await login(page)
    if (STAGE === 'READ') await stageRead(page)
    if (STAGE === 'COMMISSION') await stageCommission(page)
  } finally {
    console.log(`\n콘솔 오류 ${errs.length}건${errs.length ? ' — ' + errs.slice(0, 3).join(' | ') : ''}`)
    await browser.close()
  }
  done()
})()

function done() {
  console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
  process.exit(fails === 0 ? 0 : 1)
}
