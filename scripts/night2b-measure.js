// 밤 2부 후속 — **실측** (2026-11-26). [검증용] 줄만 만들고, 만든 id 만 지운다.
//
//   NEXT_DIST_DIR=.next-perf npx next start -p 3100
//   node scripts/night2b-measure.js --stage=F           # 할 일
//   node scripts/night2b-measure.js --stage=SITE        # [검증용] 회사·사업장
//   node scripts/night2b-measure.js --stage=D           # 장비 등록 둘
//   node scripts/night2b-measure.js --stage=L           # 포캐스트 실주
//   node scripts/night2b-measure.js --stage=READ        # 합성 줄·타일 읽기만
//
// ── 규칙 ────────────────────────────────────────────────────────────────────
//   ① 만드는 줄의 이름은 **반드시 [검증용]** 으로 시작한다(아래 MARK).
//   ② 만든 id 는 docs/night2b-ids-20261126.json 에 쌓는다 — 지울 때 **그 파일만** 본다.
//   ③ 지우기는 다른 명령(--stage=CLEAN)이다. 접두사·표 전체로 지우는 문장은 없다.
//   ④ 운영 줄은 **읽기만** 한다. 확인 조회에 service role 을 쓰지만 select 뿐이다.
//   ⑤ .env.local 의 값은 어디에도 찍지 않는다.
//
// 이 파일 이름은 `-check.js` 가 아니라 scripts/run-checks.js 가 줍지 않는다(서버·키가 필요하다).

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const arg = (name, dflt) => {
  const hit = process.argv.slice(2).find(a => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : dflt
}
const BASE = arg('base', 'http://localhost:3100')
const STAGE = arg('stage', 'READ')

/** 만드는 줄의 이름표. 이 글자로 시작하지 않는 것은 만들지 않는다. */
const MARK = '[검증용]'
const IDS_FILE = path.join(ROOT, 'docs/night2b-ids-20261126.json')

const env = {}
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim())
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ── 만든 id 장부 ───────────────────────────────────────────────────────────
const ledger = fs.existsSync(IDS_FILE) ? JSON.parse(fs.readFileSync(IDS_FILE, 'utf8')) : {}
const note = (bucket, value) => {
  ledger[bucket] = [...new Set([...(ledger[bucket] ?? []), value])]
  fs.writeFileSync(IDS_FILE, JSON.stringify(ledger, null, 2) + '\n')
  console.log(`  ↳ 장부에 적었다: ${bucket} ${value}`)
}

// ── 확인 조회 (select 만) ──────────────────────────────────────────────────
async function sel(table, query) {
  const url = `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}?${query}`
  const r = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  })
  if (!r.ok) throw new Error(`${table} 조회 실패 ${r.status} ${(await r.text()).slice(0, 200)}`)
  return r.json()
}

let fails = 0
const ok = (name, cond, hint) => {
  if (!cond) fails++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond || !hint ? '' : `  — ${hint}`}`)
}
const say = (name, value) => console.log(`··   ${name}: ${value}`)

async function login(page) {
  let ready = false
  for (let a = 1; a <= 3 && !ready; a++) {
    await page.goto(`${BASE}/login`, { waitUntil: 'load' })
    await sleep(800 * a)
    const id = page.getByPlaceholder('아이디')
    const pw = page.getByPlaceholder('비밀번호')
    await id.fill(env.E2E_EMAIL)
    await pw.fill(env.E2E_PASSWORD)
    ready = !!(await id.inputValue()) && !!(await pw.inputValue())
  }
  await page.getByRole('button', { name: /로그인/ }).click()
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 40000 })
  const who = await sel('engineers', `select=engineer_id,name,email&email=eq.${encodeURIComponent(env.E2E_EMAIL)}`)
  return who[0] ?? null
}

// ════════════════════════════════════════════════════════════════════════
// F — 할 일 (tasks 표)
// ════════════════════════════════════════════════════════════════════════
async function stageF(page, me) {
  console.log('\n══ F · 할 일 ══')
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'load' })
  await sleep(3500)

  const tiles = await page.evaluate(() => [...document.querySelectorAll('.today-tiles > *')]
    .map(el => el.textContent?.replace(/\s+/g, ' ').trim() ?? ''))
  say('타일(앞)', tiles.join(' | '))
  ok('타일이 다섯이다(교정 타일이 빠졌다)', tiles.length === 5, `${tiles.length}개`)
  ok('교정 타일이 없다', !tiles.some(t => t.includes('교정')))

  const before = await sel('tasks', `select=task_id&engineer_id=eq.${me.engineer_id}&done_at=is.null`)
  say('내 할 일(앞)', `${before.length}건`)

  // ── ① 손으로 담기 ──
  const title1 = `${MARK} 할 일 추가 — 홈`
  // 홈 카드의 단추는 **글자만** 있다(title 이 없다) — 그 화면에는 끌어 놓기 껍데기가 없어
  // 이름으로 집어도 안전하다. 칸반·목록 안의 단추는 title 로 집는다(아래 ②·③).
  await page.getByRole('button', { name: '＋ 할 일' }).first().click()
  await sleep(900)
  await page.getByPlaceholder(/구매팀 가격 협의/).fill(title1)
  await page.locator('.ems-modal-card').getByRole('button', { name: '오늘', exact: true }).click()
  await page.locator('.ems-modal-card').getByRole('button', { name: '담기' }).click()
  await sleep(2500)
  const made1 = await sel('tasks', `select=task_id,title,due_date,kind,ref_type,created_by&title=eq.${encodeURIComponent(title1)}`)
  ok('① 줄이 생겼다', made1.length >= 1, `${made1.length}건`)
  for (const t of made1) note('tasks', t.task_id)
  if (made1[0]) {
    say('① 값', JSON.stringify(made1[0]))
    ok('① 기한이 오늘이다', !!made1[0].due_date)
    ok('① 종류는 manual', made1[0].kind === 'manual')
    ok('① 적은 사람이 나다', Number(made1[0].created_by) === Number(me.engineer_id))
  }
  const shown = await page.evaluate(t => document.body.innerText.includes(t), title1)
  ok('① 홈 목록에 보인다', shown)
  const tiles2 = await page.evaluate(() => [...document.querySelectorAll('.today-tiles > *')]
    .map(el => el.textContent?.replace(/\s+/g, ' ').trim() ?? ''))
  say('타일(담은 뒤)', tiles2.join(' | '))

  // ── ② 포캐스트에 연결 ──
  await page.goto(`${BASE}/pipeline`, { waitUntil: 'load' })
  await sleep(4000)
  const title2 = `${MARK} 할 일 — 포캐스트 연결`
  const fBtn = page.getByTitle('할 일로 담기').first()
  if (await fBtn.count() > 0) {   // 칸반에 카드가 없으면 단추도 없다
    await fBtn.click()
    await sleep(900)
    const preset = await page.evaluate(() => {
      const el = [...document.querySelectorAll('.ems-modal-card *')]
        .find(e => e.previousElementSibling?.textContent?.includes('연결 대상'))
      return el?.textContent?.trim() ?? null
    })
    say('② 연결 대상 칸', preset ?? '(못 읽었다)')
    await page.getByPlaceholder(/구매팀 가격 협의/).fill(title2)
    await page.locator('.ems-modal-card').getByRole('button', { name: '내일', exact: true }).click()
    await page.locator('.ems-modal-card').getByRole('button', { name: '담기' }).click()
    await sleep(2500)
    const made2 = await sel('tasks', `select=task_id,ref_type,ref_id,kind,due_date&title=eq.${encodeURIComponent(title2)}`)
    ok('② 포캐스트에 걸린 줄이 생겼다', made2.length >= 1, `${made2.length}건`)
    for (const t of made2) note('tasks', t.task_id)
    if (made2[0]) {
      say('② 값', JSON.stringify(made2[0]))
      ok('② ref_type 이 forecast', made2[0].ref_type === 'forecast')
      ok('② ref_id 가 찍혔다', made2[0].ref_id != null)
    }
  } else {
    ok('② 칸반에 「＋ 할 일」 단추가 있다', false, '카드가 없어 누를 자리가 없었다')
  }

  // ── ③ 견적에 연결 ──
  await page.goto(`${BASE}/sales`, { waitUntil: 'load' })
  await sleep(5000)
  const title3 = `${MARK} 할 일 — 견적 연결`
  const qBtn = page.getByTitle('할 일로 담기').first()
  if (await qBtn.count() > 0) {
    await qBtn.click()
    await sleep(900)
    await page.getByPlaceholder(/구매팀 가격 협의/).fill(title3)
    await page.locator('.ems-modal-card').getByRole('button', { name: '다음 주', exact: true }).click()
    await page.locator('.ems-modal-card').getByRole('button', { name: '담기' }).click()
    await sleep(2500)
    const made3 = await sel('tasks', `select=task_id,ref_type,ref_id,kind&title=eq.${encodeURIComponent(title3)}`)
    ok('③ 견적에 걸린 줄이 생겼다', made3.length >= 1, `${made3.length}건`)
    for (const t of made3) note('tasks', t.task_id)
    if (made3[0]) {
      say('③ 값', JSON.stringify(made3[0]))
      ok('③ ref_type 이 quote', made3[0].ref_type === 'quote')
      ok('③ 종류는 quote_expiry', made3[0].kind === 'quote_expiry')
    }
  } else {
    ok('③ 견적 줄에 「＋ 할 일」 단추가 있다', false, '내 견적 줄이 없어 누를 자리가 없었다')
  }

  // ── ④ 완료 체크 ──
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'load' })
  await sleep(3500)
  const row = page.locator('div', { hasText: title1 }).last()
  const box = page.getByLabel('완료').first()
  if (await box.count() > 0 && await row.count() > 0) {
    // check() 가 아니라 click() 이다 — 이 체크 칸은 checked={false} 로 고정이고(줄이 사라지는
    // 것으로 끝낸 것을 보인다) check() 는 checked 가 참이 되기를 기다리다 시간이 넘는다.
    await box.click()
    await sleep(2500)
    const after = await sel('tasks', `select=task_id,title,done_at&task_id=in.(${(ledger.tasks ?? []).join(',')})`)
    const doneRows = after.filter(t => t.done_at)
    ok('④ 끝낸 자국이 찍혔다(지우지 않았다)', doneRows.length >= 1,
      `찍힌 줄 ${doneRows.length} / ${after.length}`)
    say('④ 끝낸 줄', doneRows.map(t => `${t.task_id} ${t.title}`).join(' · ') || '(없다)')
    const stillShown = await page.evaluate(ts => ts.filter(t => document.body.innerText.includes(t)),
      doneRows.map(t => t.title))
    ok('④ 목록에서 사라졌다', stillShown.length === 0, `남은 것: ${stillShown.join(' · ')}`)
  } else {
    ok('④ 체크 칸이 있다', false, '체크할 줄을 찾지 못했다')
  }
}

// ════════════════════════════════════════════════════════════════════════
// READ — 합성 줄·타일 (운영 자료를 읽기만 한다)
// ════════════════════════════════════════════════════════════════════════
async function stageRead(page, me) {
  console.log('\n══ READ · 합성 줄과 타일 (읽기만) ══')
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'load' })
  await sleep(4000)
  const tiles = await page.evaluate(() => [...document.querySelectorAll('.today-tiles > *')]
    .map(el => el.textContent?.replace(/\s+/g, ' ').trim() ?? ''))
  say('타일', tiles.join(' | '))
  const rows = await page.evaluate(() => {
    const card = [...document.querySelectorAll('div')]
      .find(d => d.firstElementChild?.textContent?.startsWith('할 일'))
    if (!card) return null
    return [...card.querySelectorAll(':scope > div:last-child > div')]
      .map(r => r.textContent?.replace(/\s+/g, ' ').trim() ?? '')
  })
  say('할 일 줄', rows ? `${rows.length}건` : '(카드를 못 찾았다)')
  for (const r of rows ?? []) console.log(`     · ${r}`)
  const kinds = {
    '견적 유효기간 만료': (rows ?? []).filter(r => r.includes('견적')).length,
    '실주 사유 입력 필요': (rows ?? []).filter(r => r.includes('실주 사유')).length,
    '결재 대기': (rows ?? []).filter(r => r.includes('결재')).length,
  }
  for (const [k, v] of Object.entries(kinds)) say(`자동 줄 — ${k}`, `${v}건`)

  // 표 쪽에서도 센다 — 화면과 어긋나지 않는지 본다(읽기만).
  const expiring = await sel('quotes',
    `select=quote_id&engineer_id=eq.${me.engineer_id}&status=in.(견적중,결재중,보류)&limit=200`)
  say('내 살아 있는 견적(표)', `${expiring.length}건`)
  const reasons = await sel('lost_reasons', 'select=label,requires_competitor,sort&order=sort')
  ok('실주 사유 목록이 표에서 온다', reasons.length > 0, `${reasons.length}건`)
  say('사유 목록', reasons.map(r => r.label + (r.requires_competitor ? '(경쟁사)' : '')).join(' · '))
  const master = await sel('equipment_lineups', 'select=id&limit=2000')
  say('장비 라인업(표)', `${master.length}건`)
}

// ════════════════════════════════════════════════════════════════════════
// SITE — 실측에 쓸 사업장을 **빌린다**(만들지 않는다)
//
//   회사·사업장을 새로 만들려면 주소 칸을 채워야 하는데, 그 칸은 **카카오 우편번호
//   검색 전용**(readOnly)이고 카카오 JS 키는 localhost:3000 만 허용한다 — 측정 포트
//   3100 에서는 401 이라 창을 넘어갈 수 없다(2026-11-26 확인).
//   그래서 **있는 사업장 하나를 빌려** 거기에 [검증용] 줄만 올린다. 그 사업장 줄 자체는
//   한 글자도 고치지 않는다. 빌린 번호는 장부의 borrowedSite 에 적고 **지우지 않는다**.
// ════════════════════════════════════════════════════════════════════════
async function stageSite() {
  console.log('\n══ SITE · 사업장 빌리기 ══')
  const id = Number(arg('site', '593'))
  const rows = await sel('customers', `select=customer_id,company_name,site_name,deleted_at&customer_id=eq.${id}`)
  ok('빌릴 사업장이 있다', rows.length === 1 && !rows[0].deleted_at, JSON.stringify(rows))
  if (rows.length !== 1) return
  say('빌린 사업장', JSON.stringify(rows[0]))
  ledger.borrowedSite = id
  ledger.borrowedSiteNote = '빌려 읽고 [검증용] 줄만 올렸다 — 이 줄은 지우지 않는다'
  fs.writeFileSync(IDS_FILE, JSON.stringify(ledger, null, 2) + '\n')
  const before = await sel('devices', `select=device_id&customer_id=eq.${id}`)
  const oppBefore = await sel('sales_opportunities', `select=opportunity_id&customer_id=eq.${id}`)
  const evBefore = await sel('customer_events', `select=id&customer_id=eq.${id}`)
  say('앞선 줄 수', `장비 ${before.length} · 포캐스트 ${oppBefore.length} · 사건 ${evBefore.length}`)
}

// ════════════════════════════════════════════════════════════════════════
// D — 장비 등록 (마스터 선택 1 · 자유 입력 1)
// ════════════════════════════════════════════════════════════════════════
async function stageD(page) {
  console.log('\n══ D · 장비 등록 ══')
  const siteId = ledger.borrowedSite
  if (!siteId) { ok('빌린 사업장이 장부에 있다', false, '--stage=SITE 를 먼저 돌려라'); return }
  const lineups = await sel('equipment_lineups', 'select=name&active=is.true&pending=is.false&order=name&limit=5')
  const pick = lineups[0]?.name ?? null
  say('마스터에서 고를 라인업', pick ?? '(마스터가 비었다)')

  for (const [i, kind] of [['master', '마스터 선택'], ['free', '자유 입력']].entries()) {
    const [tag, label] = kind
    await page.goto(`${BASE}/customer/${siteId}`, { waitUntil: 'load' })
    await sleep(4000)
    const add = page.getByRole('button', { name: /장비 추가|＋ 장비|\+ 장비/ }).first()
    if (await add.count() === 0) { ok(`${label} — 장비 추가 단추`, false, '단추를 못 찾았다'); continue }
    await add.click()
    await sleep(1200)
    const lineupBox = page.getByPlaceholder(/라인업 \(ex/)
    const name = tag === 'master' ? (pick ?? `${MARK} 라인업`) : `${MARK} 목록밖 라인업`
    await lineupBox.fill(name)
    await sleep(900)
    if (tag === 'master' && pick) {
      // 떠 있는 목록에서 그 이름을 눌러 **고른다**(적기만 한 것과 구분된다).
      const opt = page.getByText(pick, { exact: false }).last()
      if (await opt.count() > 0) await opt.click().catch(() => {})
      await sleep(500)
    }
    await page.getByPlaceholder('시리얼넘버').fill(`${MARK}-SN-${Date.now()}-${i}`)
    await page.getByRole('button', { name: /^등록$|^저장$|추가/ }).last().click()
    await sleep(4000)
    const rows = await sel('devices',
      `select=device_id,device_name,serial_number,master_pending,status&customer_id=eq.${siteId}&order=device_id`)
    // ⚠ **내가 적은 S/N 이 붙은 줄만** 장부에 적는다. 2026-11-26 에 「이 사업장의 장비 전부」를
    //   적는 실수를 해 운영 장비 넷(585·586·592·593)이 장부에 들어갔다 — 지우는 명령이 장부만
    //   보므로 그 실수가 곧 운영 자료 삭제가 된다. 이름표로 가르는 것이 유일한 안전장치다.
    const mine = rows.filter(d => String(d.serial_number ?? '').startsWith(MARK))
    for (const d of mine) if (!(ledger.devices ?? []).includes(d.device_id)) note('devices', d.device_id)
    // 이번 걸음이 만든 줄 — 이름이 같고 가장 늦게 생긴 것.
    const made = mine.filter(d => String(d.device_name ?? '') === name).slice(-1)[0] ?? null
    ok(`${label} — 줄이 생겼다`, !!made, `[검증용] 줄 ${mine.length}건 가운데 「${name}」 없음`)
    if (made) say(`${label} 값`, JSON.stringify(made))
    if (tag === 'master' && made) ok('마스터에서 고른 줄은 master_pending 이 아니다', !made.master_pending)
    if (tag === 'free' && made) ok('목록 밖 값은 master_pending 이 찍힌다', !!made.master_pending)
  }
}

// ════════════════════════════════════════════════════════════════════════
// L — 포캐스트 실주 (경쟁사 → 회사명 칸)
//
//   신규 등록은 /pipeline 의 「+ 포캐스트」다(업체 상세에는 그 길이 없다 — 판에서 만든다).
// ════════════════════════════════════════════════════════════════════════
async function stageL(page) {
  console.log('\n══ L · 포캐스트 실주 ══')
  const siteId = ledger.borrowedSite
  if (!siteId) { ok('빌린 사업장이 장부에 있다', false, '--stage=SITE 를 먼저 돌려라'); return }
  const site = (await sel('customers', `select=company_name,site_name&customer_id=eq.${siteId}`))[0]
  const title = `${MARK} 실주 확인`

  await page.goto(`${BASE}/pipeline`, { waitUntil: 'load' })
  await sleep(4500)
  await page.getByRole('button', { name: '+ 포캐스트' }).click()
  await sleep(1500)
  // 업체 — 고르는 칸이다. 사업장명으로 찾아 **눌러서** 고른다.
  const pick = page.locator('.ems-modal-card input').first()
  await pick.fill(String(site.site_name ?? site.company_name ?? '').slice(0, 8))
  await sleep(1800)
  await page.getByText(String(site.site_name ?? ''), { exact: false }).last().click()
  await sleep(900)
  await page.getByPlaceholder(/A동 라인 증설/).fill(title)
  await page.getByPlaceholder(/150000000/).fill('12000000')
  await page.getByRole('button', { name: /^저장$|^등록$/ }).last().click()
  await sleep(4500)

  const opps = await sel('sales_opportunities',
    `select=opportunity_id,title,stage,expected_amount,lost_reason_id,competitor,lost_at,customer_id&title=eq.${encodeURIComponent(title)}`)
  ok('포캐스트가 생겼다', opps.length >= 1, `${opps.length}건`)
  for (const o of opps) note('sales_opportunities', o.opportunity_id)
  if (opps.length === 0) return
  say('만든 포캐스트', JSON.stringify(opps[0]))
  ok('빌린 사업장에 붙었다', Number(opps[0].customer_id) === Number(siteId), String(opps[0].customer_id))

  // ── 실주 — 「경쟁사」를 고르면 회사명 칸이 나타난다 ──
  await page.goto(`${BASE}/pipeline`, { waitUntil: 'load' })
  await sleep(4500)
  const card = page.locator('.pl-card', { hasText: title }).first()
  if (await card.count() === 0) { ok('판에 그 카드가 보인다', false, '카드를 못 찾았다'); return }
  await card.hover()
  await sleep(800)
  // 실주는 **단추가 아니라 단계 select** 다 — '실주' 를 고르면 사유 창이 열린다.
  const stage = card.locator('select')
  if (await stage.count() === 0) { ok('단계 고르는 칸이 있다', false, '칸을 못 찾았다'); return }
  await stage.selectOption('실주')
  await sleep(1800)
  ok('실주를 고르면 사유 창이 열린다', await page.locator('.ems-modal-card').count() > 0)
  const before = await page.getByPlaceholder(/미쓰토요/).count()
  ok('창을 열면 회사명 칸은 아직 없다', before === 0, `${before}개`)
  // 콤보박스에 적어 좁힌 뒤 그 줄을 누른다 — 줄에는 「경쟁사 필수」 꼬리가 붙어 있어
  // 그 글자로 집는 쪽이 확실하다(사유 이름만으로는 입력칸과 줄이 같이 걸린다).
  const combo = page.getByPlaceholder('사유 고르기')
  await combo.click()
  await combo.fill('경쟁사')
  await sleep(1200)
  await page.getByText('경쟁사 필수').last().click()
  await sleep(1200)
  const after = await page.getByPlaceholder(/미쓰토요/).count()
  ok('「경쟁사」를 고르면 회사명 칸이 나타난다', after === 1, `${after}개`)
  if (after === 1) await page.getByPlaceholder(/미쓰토요/).fill(`${MARK} 경쟁사`)
  await page.getByRole('button', { name: '실주 처리' }).click()
  await sleep(4500)
  // 막혔으면 창이 그대로 열려 있고 토스트에 까닭이 적힌다 — 그 글자를 받아 적는다.
  const still = await page.locator('.ems-modal-card').count()
  const toast = await page.evaluate(() => [...document.querySelectorAll('body *')]
    .map(e => e.children.length === 0 ? (e.textContent || '').trim() : '')
    .filter(t => /실패|오류|권한|없습니다|못/.test(t)).slice(0, 6))
  say('창이 남아 있나', still > 0 ? '열려 있다(막혔다)' : '닫혔다')
  if (toast.length) say('화면의 말', toast.join(' / '))
  const done = await sel('sales_opportunities',
    `select=opportunity_id,stage,closed_at,lost_reason_id,competitor,lost_at,lost_reason&opportunity_id=eq.${opps[0].opportunity_id}`)
  say('실주 뒤', JSON.stringify(done[0]))
  ok('단계가 실주다', String(done[0]?.stage ?? '').includes('실주'), String(done[0]?.stage))
  ok('사유 id 가 찍혔다', done[0]?.lost_reason_id != null)
  ok('경쟁사 이름이 찍혔다', !!done[0]?.competitor, String(done[0]?.competitor))
  ok('실주 날짜가 찍혔다', !!done[0]?.lost_at)
}

// ════════════════════════════════════════════════════════════════════════
// CLEAN — **장부에 적힌 id 만** 지운다. 접두사·표 전체로 지우는 문장은 없다.
// ════════════════════════════════════════════════════════════════════════
async function del(table, idCol, ids) {
  if (!ids || ids.length === 0) { console.log(`··   ${table}: 지울 것 없음`); return }
  // in.(…) 으로 **적힌 번호만** 고른다.
  const url = `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}?${idCol}=in.(${ids.join(',')})`
  const r = await fetch(url, {
    method: 'DELETE',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: 'return=representation',
    },
  })
  const body = await r.text()
  console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${table} ${idCol} in (${ids.join(', ')}) → ${r.status} ${body.slice(0, 200)}`)
  if (!r.ok) fails++
}

async function stageClean() {
  console.log('\n══ CLEAN · 장부의 id 만 지운다 ══')
  console.log(`장부: ${JSON.stringify(ledger)}`)
  // 딸린 줄부터 — 자식이 먼저다.
  await del('tasks', 'task_id', ledger.tasks)
  await del('sales_activities', 'activity_id', ledger.sales_activities)
  await del('sales_opportunities', 'opportunity_id', ledger.sales_opportunities)
  await del('devices', 'device_id', ledger.devices)
  await del('customer_events', 'id', ledger.customer_events)
  await del('contacts', 'contact_id', ledger.contacts)
  await del('customers', 'customer_id', ledger.customers)
  // 남은 것이 있으면 눈으로 본다.
  for (const [table, col] of [['tasks', 'task_id'], ['sales_opportunities', 'opportunity_id'],
    ['devices', 'device_id'], ['customers', 'customer_id']]) {
    const ids = ledger[table]
    if (!ids || ids.length === 0) continue
    const left = await sel(table, `select=${col}&${col}=in.(${ids.join(',')})`)
    ok(`${table} 가 남지 않았다`, left.length === 0, `남은 것: ${left.map(x => x[col]).join(', ')}`)
  }
}

;(async () => {
  if (!env.E2E_EMAIL || !env.E2E_PASSWORD) { console.error('.env.local 에 실측 계정이 없다'); process.exit(2) }
  const alive = await fetch(`${BASE}/login`).then(r => r.ok).catch(() => false)
  if (!alive) { console.error(`서버가 없다: ${BASE}`); process.exit(2) }

  const { chromium } = require(path.join(ROOT, 'node_modules/playwright'))
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  page.on('pageerror', e => console.log(`   [pageerror] ${String(e).slice(0, 200)}`))
  page.on('console', m => { if (m.type() === 'error') console.log(`   [console] ${m.text().slice(0, 300)}`) })

  const me = await login(page)
  console.log(`로그인 됨 · engineer_id ${me?.engineer_id}`)

  if (STAGE === 'CLEAN') await stageClean()
  else if (STAGE === 'F') await stageF(page, me)
  else if (STAGE === 'READ') await stageRead(page, me)
  else if (STAGE === 'SITE') await stageSite()
  else if (STAGE === 'D') await stageD(page)
  else if (STAGE === 'L') await stageL(page)
  else console.error(`모르는 단계: ${STAGE}`)

  await browser.close()
  console.log(`\n장부(${path.relative(ROOT, IDS_FILE).replace(/\\/g, '/')}): ${JSON.stringify(ledger)}`)
  console.log(fails === 0 ? '걸린 것 없음' : `${fails}건 걸렸다`)
})().catch(e => { console.error(e); process.exit(1) })
