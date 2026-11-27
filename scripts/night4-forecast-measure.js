/**
 * **야간4 4-5 실측** — 포캐스트 단계 이력 (2026-11-28).
 *
 *   node scripts/night4-forecast-measure.js --tag=after
 *
 * 하는 일
 *   ① 세그먼트 넷을 눌러 **칸반 ↔ 표**가 바뀌는지 보고 캡처한다(읽기만).
 *   ② `[검증용]` 포캐스트 **한 건**을 화면으로 만들고 → 단계를 두 번 옮기고 →
 *      실주로 닫고 → 남은 자국을 센 뒤 → **그 id 로만** 지운다.
 *
 * 왜 화면으로 하나: 4-1 이 고친 것은 **코드 길**이다. DB 에 직접 넣으면 그 길을
 * 지나지 않아 자국이 남는지 알 수 없다.
 *
 * 지키는 것
 *   · 내가 만든 줄만 건드린다. 지울 때도 **이 세션에서 만든 id** 만 쓴다(범위 조회 금지).
 *   · 견적은 만들지 않는다(견적 번호를 소모하지 않는다).
 *   · 사업장은 **빌리기만** 한다 — 그 줄은 한 글자도 고치지 않는다.
 *   · 못 지우면 id 를 찍어 둔다(db/cleanup_night4_20261128.sql 에 적는다).
 *   · .env.local 의 값은 어디에도 찍지 않는다.
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const arg = (name, dflt) => {
  const hit = process.argv.slice(2).find(a => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : dflt
}
const BASE = arg('base', 'http://localhost:3101')
const TAG = arg('tag', 'after')
const OUT = path.join(ROOT, `docs/night4-forecast-${TAG}.json`)
const SHOTS = path.join(ROOT, 'docs/screens-night4-20261128')
/** 만든 줄에 붙이는 표. 이 글자가 없는 줄은 건드리지 않는다. */
const MARK = '[검증용] 야간4 단계이력'

const env = {}
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim())
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
const rest = async (q, init = {}) => {
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${q}`, { ...init, headers: { ...H, ...(init.headers || {}) } })
  const text = await r.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = text.slice(0, 200) }
  return { ok: r.ok, status: r.status, body }
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  await page.getByPlaceholder('아이디').fill(env.E2E_EMAIL)
  await page.getByPlaceholder('비밀번호').fill(env.E2E_PASSWORD)
  await page.getByRole('button', { name: '로그인' }).click()
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30000 })
  await page.waitForTimeout(1500)
}

/** 화면에 보이는 것 — 칸반인가 표인가. */
const WHAT = `(() => {
  const table = document.querySelector('table')
  return {
    표: !!table,
    표의_머리: table ? [...table.querySelectorAll('thead th')].map(th => (th.textContent || '').trim()) : [],
    표의_줄수: table ? table.querySelectorAll('tbody tr').length : 0,
    칸반_열: [...document.querySelectorAll('div')]
      .filter(d => /^(상담|사양검토|견적제출|협상|수주)\\d+건/.test((d.textContent || '').replace(/\\s/g, '')))
      .length,
    빈_안내: [...document.querySelectorAll('div')].map(d => (d.textContent || '').trim())
      .filter(t => /건이 없습니다$/.test(t) && t.length < 30)[0] ?? null,
  }
})()`

;(async () => {
  const { chromium } = require(path.join(ROOT, 'node_modules/playwright'))
  fs.mkdirSync(SHOTS, { recursive: true })
  const report = { tag: TAG, at: new Date().toISOString(), base: BASE, 만든_id: [], 지운_id: [], 남은_id: [] }

  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  page.on('console', m => { if (m.type() === 'error') (report.브라우저_오류 ??= []).push(m.text().slice(0, 160)) })
  await login(page)

  // ── ① 세그먼트 넷 ───────────────────────────────────────────────────────
  await page.goto(`${BASE}/pipeline`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4500)
  report.세그먼트 = {}
  for (const label of ['진행 중', '수주', '실주', '전체']) {
    const btn = page.getByRole('button', { name: new RegExp(`^${label}`) }).first()
    if (!(await btn.isVisible().catch(() => false))) { report.세그먼트[label] = '단추를 찾지 못함'; continue }
    await btn.click()
    await page.waitForTimeout(1200)
    report.세그먼트[label] = await page.evaluate(WHAT)
    await page.screenshot({ path: path.join(SHOTS, `forecast-${label.replace(/\s/g, '')}-${TAG}.png`) })
  }
  await page.getByRole('button', { name: /^진행 중/ }).first().click().catch(() => {})
  await page.waitForTimeout(900)

  // ── ② [검증용] 한 건 — 만들기 ───────────────────────────────────────────
  let madeId = null
  const steps = []
  const step = (name, ok, note) => { steps.push({ name, ok, ...(note ? { note } : {}) }) }
  try {
    await page.getByRole('button', { name: '+ 포캐스트' }).click()
    await page.waitForTimeout(1500)

    // 업체 — 검색칸에 치고 첫 줄을 고른다. 고르기만 한다(그 줄은 고치지 않는다).
    const pick = page.getByPlaceholder('회사명 · 영문명').first()
    if (await pick.isVisible().catch(() => false)) {
      await pick.fill('가레트')
      await page.waitForTimeout(1600)
      const first = page.locator('[role="option"], li, button').filter({ hasText: '가레트' }).first()
      if (await first.isVisible().catch(() => false)) { await first.click(); await page.waitForTimeout(800) }
    }
    const title = page.getByPlaceholder('예: A동 라인 증설').first()
    if (await title.isVisible().catch(() => false)) await title.fill(MARK)
    else step('제목 칸', false, 'placeholder 로 찾지 못함')
    await page.screenshot({ path: path.join(SHOTS, `forecast-new-modal-${TAG}.png`) })
    const save = page.getByRole('button', { name: /저장|등록/ }).last()
    await save.click()
    await page.waitForTimeout(3000)

    const found = await rest(`sales_opportunities?select=opportunity_id,title,stage,customer_id,engineer_id,created_at&title=eq.${encodeURIComponent(MARK)}`)
    if (found.ok && Array.isArray(found.body) && found.body.length > 0) {
      madeId = found.body[found.body.length - 1].opportunity_id
      report.만든_id = [madeId]
      report.만든_줄 = found.body[found.body.length - 1]
      step('만들기', true, `opportunity_id=${madeId}`)
    } else {
      step('만들기', false, `줄을 찾지 못함 (${found.status})`)
    }
  } catch (e) {
    step('만들기', false, String(e).slice(0, 200))
  }

  // ── ③ 단계 두 번 · 실주 ────────────────────────────────────────────────
  if (madeId != null) {
    try {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(4000)
      const card = page.locator('.pl-card').filter({ hasText: MARK }).first()
      step('카드가 판에 있다', await card.isVisible().catch(() => false))
      for (const next of ['사양검토', '견적제출']) {
        const sel = card.locator('select').first()
        if (await sel.isVisible().catch(() => false)) {
          await sel.selectOption({ label: next }).catch(async () => { await sel.selectOption(next).catch(() => {}) })
        } else {
          await card.hover()
          await page.waitForTimeout(400)
          const sel2 = card.locator('select').first()
          await sel2.selectOption(next).catch(() => {})
        }
        await page.waitForTimeout(2500)
        const now = await rest(`sales_opportunities?select=stage&opportunity_id=eq.${madeId}`)
        step(`단계 → ${next}`, now.ok && now.body?.[0]?.stage === next, `지금=${now.body?.[0]?.stage}`)
      }
      // 실주 — 카드의 「실주」를 누르고 사유를 고른다.
      // 실주는 **단계 select** 에서 고른다 — 고르면 사유 창이 열린다(OpportunityCard).
      await card.hover()
      await page.waitForTimeout(600)
      const lostSel = card.locator('select').first()
      if (await lostSel.isVisible().catch(() => false)) {
        await lostSel.selectOption('실주').catch(() => {})
        await page.waitForTimeout(1800)
        // 사유는 **고르는 칸**이다(「사유 고르기」) — 눌러서 목록을 열고 첫 줄을 고른다.
        const reasonBox = page.getByPlaceholder('사유 고르기').first()
        if (await reasonBox.isVisible().catch(() => false)) {
          await reasonBox.click()
          await page.waitForTimeout(900)
          const item = page.getByText('가격', { exact: true }).first()
          if (await item.isVisible().catch(() => false)) { await item.click(); await page.waitForTimeout(700) }
        }
        await page.screenshot({ path: path.join(SHOTS, `forecast-lost-modal-${TAG}.png`) })
        const ok2 = page.getByRole('button', { name: /실주 처리|저장|확인/ }).last()
        await ok2.click().catch(() => {})
        await page.waitForTimeout(3000)
      }
      const after = await rest(`sales_opportunities?select=stage,closed_at,lost_reason&opportunity_id=eq.${madeId}`)
      step('실주로 닫혔다', after.ok && after.body?.[0]?.stage === '실주', JSON.stringify(after.body?.[0] ?? null))
    } catch (e) {
      step('단계 옮기기', false, String(e).slice(0, 200))
    }

    // ── ④ 남은 자국 ──────────────────────────────────────────────────────
    const hist = await rest(`opportunity_stage_history?select=*&opportunity_id=eq.${madeId}&order=changed_at`)
    report.단계_이력 = hist.ok ? hist.body : `표 없음/오류 ${hist.status} — ${JSON.stringify(hist.body).slice(0, 120)}`
    const cid = report.만든_줄?.customer_id
    if (cid) {
      const ev = await rest(`customer_events?select=id,event_type,occurred_at,payload&customer_id=eq.${cid}&order=id.desc&limit=12`)
      report.사건 = ev.ok
        ? ev.body.filter(e => String(e.event_type).startsWith('forecast_'))
          .filter(e => JSON.stringify(e.payload ?? {}).includes('검증용') || Number(e.payload?.opportunity_id) === madeId)
        : `조회 실패 ${ev.status}`
    }

    // ── ⑤ 지운다 — **이 id 만** ──────────────────────────────────────────
    const del = await rest(`sales_opportunities?opportunity_id=eq.${madeId}`, { method: 'DELETE' })
    if (del.ok) report.지운_id = [madeId]
    else { report.남은_id = [madeId]; step('지우기', false, `DELETE ${del.status}`) }
    // 사건 줄도 내가 만든 것만 거둔다.
    if (Array.isArray(report.사건)) {
      for (const e of report.사건) {
        const d = await rest(`customer_events?id=eq.${e.id}`, { method: 'DELETE' })
        if (d.ok) (report.지운_사건_id ??= []).push(e.id)
        else (report.남은_사건_id ??= []).push(e.id)
      }
    }
  }

  report.단계 = steps
  await ctx.close()
  await browser.close()
  fs.writeFileSync(OUT, JSON.stringify(report, null, 1))
  console.log(JSON.stringify(report, null, 1))
  console.log('\n저장: ' + OUT)
})().catch(e => { console.error(e); process.exit(1) })
