/**
 * **묶음5 실측** — 툴팁·아이콘 버튼(1) · 폰 메모 자리(12-1) (2026-11-27).
 *
 *   node scripts/bundle5-measure.js --base=http://localhost:3101
 *
 * 읽기만 한다 — 저장 단추는 누르지 않는다. .env.local 의 값은 어디에도 찍지 않는다.
 */
const fs = require('fs'), path = require('path')
const ROOT = process.cwd()
const env = {}
for (const l of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l.trim())
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const BASE = 'http://localhost:3101'
const OUT = path.join(ROOT, 'docs/screens-bundle5-20261127')
fs.mkdirSync(OUT, { recursive: true })
const shot = async (page, n) => { await page.screenshot({ path: path.join(OUT, n + '.png') }); console.log('  캡처 ' + n) }
const login = async page => {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  await page.getByPlaceholder('아이디').fill(env.E2E_EMAIL)
  await page.getByPlaceholder('비밀번호').fill(env.E2E_PASSWORD)
  await page.getByRole('button', { name: '로그인' }).click()
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30000 })
  await page.waitForTimeout(1200)
}
const dismiss = async page => {
  for (let i = 0; i < 3; i++) {
    const b = page.getByRole('button', { name: '확인' }).first()
    if (await b.isVisible().catch(() => false)) await b.click().catch(() => {}); else break
    await page.waitForTimeout(200)
  }
}
let fails = 0
const ok = (n, g, x) => { if (!g) fails++; console.log(`${g ? 'OK  ' : 'FAIL'} ${n}${x ? '  ' + x : ''}`) }

;(async () => {
  const pw = require(path.join(ROOT, 'node_modules/playwright-core'))

  // ── PC — 툴팁 · 아이콘 버튼 · 트리 화살표 ──
  {
    const b = await pw.chromium.launch()
    const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage()
    await login(page)
    await page.goto(`${BASE}/customer/112`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(7000)
    await dismiss(page)

    // 아이콘 버튼이 **늘 보이는가** — 호버 없이.
    const btn = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button[aria-label]')]
        .find(x => (x.getAttribute('aria-label') || '').includes('수정') && x.getBoundingClientRect().width > 0)
      if (!b) return null
      const cs = getComputedStyle(b)
      const r = b.getBoundingClientRect()
      return { op: cs.opacity, w: Math.round(r.width), h: Math.round(r.height), border: cs.borderColor, cls: b.className }
    })
    console.log('  수정 버튼: ' + JSON.stringify(btn))
    ok('아이콘 버튼이 호버 없이 보인다', btn != null && Number(btn.op) === 1)
    ok('30×30', btn != null && btn.w === 30 && btn.h === 30, btn ? `${btn.w}×${btn.h}` : '')
    ok('공용 링 클래스', btn != null && /ems-pick/.test(btn.cls))
    await shot(page, 'pc-icon-buttons')

    // 툴팁 — 올리면 300ms 뒤 뜬다.
    const target = page.locator('button[aria-label*="수정"]:visible').first()
    await target.hover()
    await page.waitForTimeout(700)
    const tip = await page.evaluate(() => {
      const t = document.querySelector('[role="tooltip"]')
      if (!t) return null
      const cs = getComputedStyle(t)
      return { text: t.textContent, bg: cs.backgroundColor, radius: cs.borderRadius, pad: cs.padding, fs: cs.fontSize }
    })
    console.log('  툴팁: ' + JSON.stringify(tip))
    ok('툴팁이 뜬다', tip != null)
    ok('알약이다', tip != null && parseFloat(tip.radius) >= 99, tip?.radius)
    ok('바탕이 어둡다', tip != null && tip.bg === 'rgb(31, 41, 55)', tip?.bg)
    ok('12px', tip != null && tip.fs === '12px')
    await shot(page, 'pc-tooltip')
    await b.close()
  }

  // ── PC — 사이드바 툴팁(단축키 칩) ──
  {
    const b = await pw.chromium.launch()
    const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage()
    await login(page)
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(5000)
    await dismiss(page)
    const t = page.locator('button[aria-label="사이드바 접기"]:visible, button[aria-label="사이드바 펼치기"]:visible').first()
    if (await t.isVisible().catch(() => false)) {
      await t.hover()
      await page.waitForTimeout(700)
      const tip = await page.evaluate(() => (document.querySelector('[role="tooltip"]') || {}).textContent)
      console.log('  사이드바 툴팁: ' + JSON.stringify(tip))
      ok('단축키 칩이 붙는다', typeof tip === 'string' && tip.includes('Ctrl+B'), String(tip))
      await shot(page, 'pc-sidebar-tooltip')
    } else ok('사이드바 단추를 찾았다', false)
    await b.close()
  }

  // ── 폰 — 사업장 화면의 메모 자리 ──
  for (const W of [390, 350]) {
    const b = await pw.webkit.launch()
    const page = await (await b.newContext({ viewport: { width: W, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage()
    await login(page)
    await page.goto(`${BASE}/customer/112`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(7000)
    await dismiss(page)
    const order = await page.evaluate(() => {
      const memo = document.querySelector('.band-memo-row')
      const con = document.querySelector('.band-contacts')
      const agency = [...document.querySelectorAll('span')].find(s => s.textContent === '대리점')
      const top = el => (el ? Math.round(el.getBoundingClientRect().top) : null)
      return {
        agency: top(agency), memo: top(memo), contacts: top(con),
        memoHidden: memo ? getComputedStyle(memo).display === 'none' : null,
      }
    })
    console.log(`  ${W} 자리: ` + JSON.stringify(order))
    if (order.memoHidden) ok(`${W} 메모가 비어 줄이 없다`, true)
    else {
      ok(`${W} 메모가 대리점 아래`, order.agency != null && order.memo != null && order.memo > order.agency)
      ok(`${W} 메모가 담당자 위`, order.contacts != null && order.memo < order.contacts)
    }
    await shot(page, `phone${W}-site-memo`)
    await b.close()
  }

  console.log(fails === 0 ? '\n전부 통과' : `\n실패 ${fails}건`)
})()
