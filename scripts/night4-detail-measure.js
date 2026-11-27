/**
 * **야간4 7-3 실측** — 고객사 상세 통일 (2026-11-28).
 *
 *   node scripts/night4-detail-measure.js --tag=after
 *
 * 보는 것
 *   ① 옛 주소 `/customer/{id}` 가 **301** 로 분할 보기로 간다. `?contact=` 도 따라간다.
 *   ② 그 주소로 들어가면 **그 사업장**이 열리고, 트리에서 그 줄이 파랗게 서고,
 *      **패널 안에 보인다**(가운데로 데려왔는가).
 *   ③ `?origin=/quote` 로 들어가 ← 를 누르면 그 주소로 나간다.
 *   ④ 캡처.
 *
 * 읽기만 한다 — 저장·삭제 단추는 누르지 않는다. .env.local 의 값은 찍지 않는다.
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
const SITE = Number(arg('site', '776'))
const OUT = path.join(ROOT, `docs/night4-detail-${TAG}.json`)
const SHOTS = path.join(ROOT, 'docs/screens-night4-20261128')

const env = {}
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim())
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
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

/** 트리에서 고른 줄이 **패널 안에 보이는가**. */
const TREE = `(() => {
  const row = document.querySelector('[data-site-row="on"]')
  if (!row) return { 고른줄: false }
  const r = row.getBoundingClientRect()
  const panel = document.querySelector('.side-panel')
  const p = panel ? panel.getBoundingClientRect() : null
  return {
    고른줄: true,
    글자: (row.textContent || '').trim().slice(0, 30),
    바탕: getComputedStyle(row).backgroundColor,
    줄: { top: Math.round(r.top), bottom: Math.round(r.bottom) },
    패널: p ? { top: Math.round(p.top), bottom: Math.round(p.bottom) } : null,
    패널안에_보인다: p ? (r.top >= p.top - 1 && r.bottom <= p.bottom + 1) : null,
  }
})()`

;(async () => {
  const { chromium } = require(path.join(ROOT, 'node_modules/playwright'))
  fs.mkdirSync(SHOTS, { recursive: true })
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const report = { tag: TAG, at: new Date().toISOString(), base: BASE, site: SITE }
  await login(page)

  // ── ① 301 ──────────────────────────────────────────────────────────────
  //   리다이렉트를 **따라가지 않고** 응답 그대로 본다.
  const cookies = await ctx.cookies()
  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')
  for (const [name, url] of [
    ['맨 주소', `${BASE}/customer/${SITE}`],
    ['?contact= 가 붙은 주소', `${BASE}/customer/${SITE}?contact=1642`],
  ]) {
    const res = await ctx.request.get(url, { headers: { cookie: cookieHeader }, maxRedirects: 0 })
    report[name] = { status: res.status(), location: res.headers()['location'] ?? null }
  }

  // ── ② 옛 주소로 들어가 본다(이번에는 따라간다) ──────────────────────────
  await page.goto(`${BASE}/customer/${SITE}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(6000)
  report.들어간_뒤 = {
    주소: await page.evaluate('location.pathname + location.search'),
    트리: await page.evaluate(TREE),
    상세가_열렸나: await page.evaluate(`!!document.querySelector('.home-grid.detail-open')`),
  }
  await page.screenshot({ path: path.join(SHOTS, `detail-split-${TAG}.png`) })

  // ── ③ origin — 견적에서 들어온 길 ───────────────────────────────────────
  await page.goto(`${BASE}/?view=list&site=${SITE}&origin=%2Fquote`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(6000)
  const backBtn = page.getByRole('button', { name: '이전 화면으로' }).first()
  const hasBack = await backBtn.isVisible().catch(() => false)
  report.돌아가기 = { 단추가_있나: hasBack }
  if (hasBack) {
    await backBtn.click()
    await page.waitForTimeout(3000)
    report.돌아가기.간_곳 = await page.evaluate('location.pathname + location.search')
  }
  await page.screenshot({ path: path.join(SHOTS, `detail-back-${TAG}.png`) })

  await ctx.close()
  await browser.close()
  fs.writeFileSync(OUT, JSON.stringify(report, null, 1))
  console.log(JSON.stringify(report, null, 1))
  console.log('\n저장: ' + OUT)
})().catch(e => { console.error(e); process.exit(1) })
