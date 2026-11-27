/**
 * **묶음4 실측** — 장비 칸 · 담당자 카드 · 회사 줄 · 견적 사명 콤보 (2026-11-27).
 *
 *   node scripts/bundle4-measure.js --tag=after
 *   node scripts/bundle4-measure.js --tag=after --only=F   # 한 항목만
 *
 *   A 장비 라인업/모델/옵션 — PC(1600) 칸 폭 비율 · 폰(390·350) 세로
 *   B 담당자 카드          — 폰에서 PC 와 **같은 모양**인가
 *   E 회사 줄              — 닫힘/열림에서 누를 때 무엇이 달라지나
 *   F 견적 사명 콤보       — 키보드 흐름(↑↓·Enter·Esc·Tab)과 고른 뒤 커서
 *
 * 읽기만 한다 — 저장 단추는 누르지 않는다. .env.local 의 값은 어디에도 찍지 않는다.
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
const ONLY = arg('only', '')
const SITE = arg('site', '593')
/** 담당자 카드를 재는 사업장 — **번호가 있는 곳**이어야 tel: 을 볼 수 있다.
    593 의 담당자는 번호 칸이 빈 글자라 화면에 「—」 가 선다(그것도 맞는 모양이다). */
const BSITE = arg('bsite', '112')
const SHOTS = path.join(ROOT, 'docs/screens-bundle4-20261127')

const env = {}
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim())
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

let fails = 0
const ok = (name, good, extra) => {
  if (!good) fails++
  console.log(`${good ? 'OK  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`)
}
const want = it => !ONLY || ONLY.toUpperCase().includes(it)

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  await page.getByPlaceholder('아이디').fill(env.E2E_EMAIL)
  await page.getByPlaceholder('비밀번호').fill(env.E2E_PASSWORD)
  await page.getByRole('button', { name: '로그인' }).click()
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30000 })
  await page.waitForTimeout(1500)
}
async function dismissNotice(page) {
  for (let i = 0; i < 3; i++) {
    const b = page.getByRole('button', { name: '확인' }).first()
    if (await b.isVisible().catch(() => false)) await b.click().catch(() => {}); else break
    await page.waitForTimeout(200)
  }
}
const shot = async (page, name) => {
  fs.mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) })
  console.log(`     캡처 docs/screens-bundle4-20261127/${name}.png`)
}
const openSite = async (page, site = SITE) => {
  await page.goto(`${BASE}/customer/${site}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(7000)
  await dismissNotice(page)
}

// ── A 장비 세 칸 ────────────────────────────────────────────────────────────
const GRID = `(() => {
  const g = document.querySelector('.eqp-grid')
  if (!g) return { found: false }
  const cs = getComputedStyle(g)
  const cells = [...g.querySelectorAll('.eqp-cell')].map(c => {
    const i = c.querySelector('input')
    const r = (i ?? c).getBoundingClientRect()
    return { w: Math.round(r.width), right: Math.round(r.right), ell: i ? getComputedStyle(i).textOverflow : null, title: i ? i.getAttribute('title') : null }
  })
  const label = [...g.querySelectorAll('.eqp-label')].filter(l => getComputedStyle(l).display !== 'none').map(l => l.textContent)
  return { found: true, W: window.innerWidth, cols: cs.gridTemplateColumns, gridW: Math.round(g.getBoundingClientRect().width), cells, label }
})()`

async function itemA(browsers) {
  console.log('\n══ A 장비 라인업 / 모델명 / 옵션 ══')
  for (const [engine, W, name] of [[browsers.chromium, 1600, 'PC'], [browsers.webkit, 390, '폰390'], [browsers.webkit, 350, '폰350']]) {
    const browser = await engine.launch()
    const ctx = await browser.newContext({ viewport: { width: W, height: W > 800 ? 1000 : 844 }, isMobile: W <= 400, hasTouch: W <= 400 })
    const page = await ctx.newPage()
    await login(page)
    for (const [which, re] of [['add', /장비 추가/], ['edit', /장비 수정/]]) {
      await openSite(page)
      const b = page.getByRole('button', { name: re }).first()
      if (!(await b.isVisible().catch(() => false))) { ok(`${name} ${which} 창을 열었다`, false); continue }
      await b.click()
      await page.waitForTimeout(1500)
      const g = await page.evaluate(GRID)
      if (!g.found) { ok(`${name} ${which} 세 칸을 찾았다`, false); continue }
      console.log(`\n── ${name} · ${which} ──`)
      console.log(`     격자 ${g.gridW}px · ${g.cols}`)
      console.log(`     칸 폭 ${g.cells.map(c => c.w).join(' · ')}`)
      ok(`${name} ${which} 세 칸이 모두 화면 안`, g.cells.every(c => c.right <= g.W + 0.5))
      ok(`${name} ${which} 쓸 수 있는 폭(≥ 120)`, g.cells.every(c => c.w >= 120), g.cells.map(c => c.w).join('/'))
      ok(`${name} ${which} 긴 값은 말줄임`, g.cells.every(c => c.ell === 'ellipsis'))
      if (W > 800) {
        // 2 : 1 : 1.5 — 라인업이 모델의 두 배, 구성이 모델의 1.5 배다(여백 때문에 ±2px 본다).
        const [a, b2, c] = g.cells.map(x => x.w)
        ok('PC 비율 2 : 1 : 1.5', Math.abs(a - b2 * 2) <= 12 && Math.abs(c - b2 * 1.5) <= 12, `${a} : ${b2} : ${c}`)
        ok('PC 에서는 칸 이름을 숨긴다', g.label.length === 0)
      } else {
        ok(`${name} 세로 석 줄(한 열)`, g.cols.split(' ').length === 1, g.cols)
        ok(`${name} 칸마다 이름이 붙는다`, g.label.join('/') === '라인업/모델명/옵션', g.label.join('/'))
      }
      await shot(page, `${TAG}-A-${name}-${which}`)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(600)
    }
    await browser.close()
  }
}

// ── B 담당자 카드 ───────────────────────────────────────────────────────────
/**
 * **보이는** 카드만 본다 — 폰 띠와 PC 왼쪽 열이 한 화면에 다 있고 CSS 로 하나만 보인다.
 * 번호·이메일은 **있을 때만** 링크다. 없으면 「—」 가 서야 한다(비우면 「못 읽었다」가 된다).
 */
const CONTACTS = `(() => {
  const vis = el => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0
  const cards = [...document.querySelectorAll('.ctl-card')].filter(vis)
  const head = [...document.querySelectorAll('b')].filter(vis).find(b => b.textContent === '담당자')
  const one = cards[0]
  const lines = cards.map(c => {
    const tel = c.querySelector('a[href^="tel:"]')
    const mail = c.querySelector('a[href^="mailto:"]')
    const dashes = [...c.querySelectorAll('span')].filter(s => s.textContent.trim() === '—').length
    return {
      name: (c.querySelector('b') || {}).textContent || '',
      tel: tel ? tel.getAttribute('href') : null,
      mail: mail ? mail.getAttribute('href') : null,
      dashes,
    }
  })
  return {
    count: cards.length,
    head: !!head,
    addWide: [...document.querySelectorAll('.ctl-add-wide')].some(b => getComputedStyle(b).display !== 'none'),
    addIcon: [...document.querySelectorAll('.ctl-add-icon')].some(b => getComputedStyle(b).display !== 'none'),
    editVisible: one ? [...one.querySelectorAll('.ctl-edit')].some(e => getComputedStyle(e).display !== 'none') : null,
    tappable: one ? one.getAttribute('role') === 'button' : null,
    right: one ? Math.round(one.getBoundingClientRect().right) : null,
    W: window.innerWidth,
    lines,
  }
})()`

async function itemB(browsers) {
  console.log('\n══ B 담당자 카드 ══')
  for (const [engine, W, name] of [[browsers.chromium, 1600, 'PC'], [browsers.webkit, 390, '폰390'], [browsers.webkit, 350, '폰350']]) {
    const browser = await engine.launch()
    const ctx = await browser.newContext({ viewport: { width: W, height: W > 800 ? 1000 : 844 }, isMobile: W <= 400, hasTouch: W <= 400 })
    const page = await ctx.newPage()
    await login(page)
    await openSite(page, BSITE)
    const c = await page.evaluate(CONTACTS)
    console.log(`\n── ${name} ──`)
    console.log(`     카드 ${c.count}장 · ✎ 보임 ${c.editVisible} · ＋아이콘 ${c.addIcon} · ＋넓은단추 ${c.addWide}`)
    for (const l of c.lines) console.log(`     ${l.name} · ${l.tel ?? "—"} · ${l.mail ?? "—"}`)
    ok(`${name} 같은 부품으로 그린다(.ctl-card)`, c.count > 0)
    ok(`${name} 머리에 「담당자」`, c.head)
    ok(`${name} 번호가 있으면 tel:`, c.lines.some(l => (l.tel ?? '').startsWith('tel:')))
    ok(`${name} 번호·이메일은 링크 아니면 「—」 — 빈 자리를 두지 않는다`,
      c.lines.every(l => (l.tel ? 1 : 0) + (l.mail ? 1 : 0) + l.dashes >= 2))
    ok(`${name} 카드가 화면 안`, c.right != null && c.right <= c.W + 0.5, `right ${c.right} / ${c.W}`)
    ok(`${name} 카드를 눌러도 수정이 열린다(role=button)`, c.tappable === true)
    if (W > 800) {
      ok('PC — ＋ 는 머리줄 아이콘', c.addIcon === true && c.addWide === false)
    } else {
      ok(`${name} — ＋ 는 목록 아래 넓은 단추`, c.addWide === true && c.addIcon === false)
      ok(`${name} — ✎ 는 숨는다(카드를 누른다)`, c.editVisible === false)
    }
    await shot(page, `${TAG}-B-${name}`)
    await browser.close()
  }
}

// ── E 회사 줄 ───────────────────────────────────────────────────────────────
async function itemE(browsers) {
  console.log('\n══ E 회사 줄 펼침·접힘 ══')
  for (const [engine, W, name] of [[browsers.chromium, 1600, 'PC'], [browsers.webkit, 390, '폰390']]) {
    const browser = await engine.launch()
    const ctx = await browser.newContext({ viewport: { width: W, height: W > 800 ? 1000 : 844 }, isMobile: W <= 400, hasTouch: W <= 400 })
    const page = await ctx.newPage()
    await login(page)
    await page.goto(`${BASE}/?view=list`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(9000)
    await dismissNotice(page)
    /**
     * **화면 안에 있는** 줄을 고른다. 목록은 600줄쯤이라 첫 줄이 화면 아래에 있을 수
     * 있는데, 그 줄을 누르라고 하면 재는 쪽이 패널을 굴리다 다른 것을 짚는다.
     */
    const idx = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[role="button"][aria-expanded]')]
      return rows.findIndex(r => {
        const b = r.getBoundingClientRect()
        return b.width > 0 && b.top > 60 && b.bottom < window.innerHeight - 40
      })
    })
    if (idx < 0) { ok(`${name} 화면 안의 회사 줄을 찾았다`, false); await browser.close(); continue }
    const row = page.locator('[role="button"][aria-expanded]').nth(idx)
    console.log(`\n── ${name} ──`)
    const state = async () => (await row.getAttribute('aria-expanded')) === 'true'
    if (await state()) { await page.locator('button[aria-label$="접기"]').first().click(); await page.waitForTimeout(600) }
    ok(`${name} 처음엔 닫혀 있다`, !(await state()))
    await row.click()
    await page.waitForTimeout(900)
    ok(`${name} 닫힌 줄을 누르면 **펴진다**`, await state())
    await shot(page, `${TAG}-E-${name}-open`)
    /**
     * 폰에서는 회사를 고르는 순간 **그 회사 화면이 폭을 다 쓰고 좌 패널이 숨는다**
     * (.home-grid.detail-open .side-panel — 2026-11-21 부터의 동작이다).
     * 목록으로 돌아가는 길은 pane 머리의 ← 다. 돌아와서 **그 줄이 아직 펴져 있는지**
     * 보는 것이 폰에서 「접히지 않는다」를 확인하는 길이다.
     */
    const back = page.locator('.pane-back').first()
    if (await back.isVisible().catch(() => false)) {
      await back.click()
      await page.waitForTimeout(900)
      ok(`${name} 돌아와도 그 줄은 **펴진 채**다`, await state())
    }
    await row.click()
    await page.waitForTimeout(900)
    ok(`${name} 열린 줄을 또 눌러도 **접히지 않는다**`, await state())
    if (await back.isVisible().catch(() => false)) { await back.click(); await page.waitForTimeout(900) }
    const chev = page.locator('button[aria-label$="접기"]').first()
    ok(`${name} ∨ 가 「접기」로 서 있다`, await chev.isVisible().catch(() => false))
    await chev.click()
    await page.waitForTimeout(900)
    ok(`${name} ∨ 로는 접힌다`, !(await state()))
    // 키보드도 같은 규칙이다.
    await row.focus()
    await page.keyboard.press('Enter')
    await page.waitForTimeout(900)
    ok(`${name} Enter 로도 펴진다`, await state())
    if (await back.isVisible().catch(() => false)) { await back.click(); await page.waitForTimeout(900) }
    await row.focus()
    await page.keyboard.press('Enter')
    await page.waitForTimeout(900)
    ok(`${name} Enter 를 또 눌러도 접히지 않는다`, await state())
    if (await back.isVisible().catch(() => false)) { await back.click(); await page.waitForTimeout(900) }
    await shot(page, `${TAG}-E-${name}-still-open`)
    await browser.close()
  }
}

/**
 * 견적 작성은 **분류·양식을 고르기 전까지 아래가 잠겨 있다**(LockedSection).
 * 사명 칸을 만지려면 먼저 그 둘을 골라야 한다 — 잠금막이 클릭을 받는다.
 */
async function unlockQuote(page) {
  const sels = page.locator('select')
  const n = await sels.count()
  for (let i = 0; i < Math.min(n, 4); i++) {
    const sel = sels.nth(i)
    const opts = await sel.locator('option:not([disabled])').all()
    if (opts.length === 0) continue
    const v = await opts[0].getAttribute('value')
    if (v) await sel.selectOption(v).catch(() => {})
    await page.waitForTimeout(500)
  }
  await page.waitForTimeout(1200)
  const locked = await page.locator('text=분류와 양식을 먼저 선택하세요').count()
  ok('분류·양식을 골라 잠금을 풀었다', locked === 0)
}
// ── F 견적 사명 콤보 ────────────────────────────────────────────────────────
async function itemF(browsers) {
  console.log('\n══ F 견적 「사명」 콤보 — 키보드 흐름 ══')
  const browser = await browsers.chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await ctx.newPage()
  await login(page)
  await page.goto(`${BASE}/quote`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(9000)
  await dismissNotice(page)
  await unlockQuote(page)

  const box = page.locator('input[placeholder^="업체·대리점 검색"]').first()
  if (!(await box.isVisible().catch(() => false))) { ok('사명 칸을 찾았다', false); await browser.close(); return }
  ok('안내 글은 그대로다', (await box.getAttribute('placeholder')) === '업체·대리점 검색 (사전 등록 필요)')
  ok('공용 콤보다(role=combobox)', (await box.getAttribute('role')) === 'combobox')

  const listCount = () => page.locator('[role="option"]').count()
  await box.click()
  await box.fill('주')
  await page.waitForTimeout(1800)
  const n = await listCount()
  console.log(`     「주」 로 찾은 줄 ${n}개`)
  ok('글자를 치면 목록이 뜬다', n > 0)

  // ↑↓ — 고른 자리가 움직인다. 시작 자리는 자리마다 다를 수 있어 **움직임**만 본다.
  const activeIdx = () => page.evaluate(() => {
    const all = [...document.querySelectorAll('[role="option"]')]
    return all.findIndex(o => o.getAttribute('aria-selected') === 'true')
  })
  await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(350)
  const i1 = await activeIdx()
  const a1 = await page.locator('[role="option"][aria-selected="true"]').count()
  ok('↓ 로 고른 자리가 생긴다', a1 === 1 && i1 >= 0, `${i1} 번째`)
  await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(350)
  const i2 = await activeIdx()
  console.log(`     ↓ 두 번 → ${i1} → ${i2} 번째 줄`)
  ok('↓ 를 또 누르면 다음 줄로', i2 === i1 + 1)
  await page.keyboard.press('ArrowUp')
  await page.waitForTimeout(350)
  ok('↑ 로 되돌아온다', (await activeIdx()) === i1)

  // Esc — 목록만 닫힌다(화면은 그대로).
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  ok('Esc 로 목록이 닫힌다', (await listCount()) === 0)
  ok('Esc 가 화면을 떠나게 하지 않는다', page.url().includes('/quote'))

  // 다시 열어 Enter 로 고른다 — 고른 뒤 커서가 다음 칸으로 간다(lib/quoteFocus.ts).
  // Esc 뒤에는 칸이 아직 포커스를 쥐고 있어 다시 누른다고 열리지 않는다 —
  // **글자를 다시 쳐서** 연다(사람이 하는 길과 같다).
  await box.click()
  await box.fill('')
  await page.waitForTimeout(500)
  await box.type('주', { delay: 80 })
  await page.waitForTimeout(2000)
  ok('글자를 치면 다시 열린다', (await listCount()) > 0)
  await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(400)
  const pickedName = (await page.locator('[role="option"][aria-selected="true"]').first().innerText().catch(() => '')).split('\n')[0]
  await page.keyboard.press('Enter')
  await page.waitForTimeout(2000)
  console.log(`     Enter 로 고른 줄 「${pickedName}」`)
  ok('Enter 로 골라진다 — 목록이 닫힌다', (await listCount()) === 0)
  // 고르면 칸이 **글자 + ✓** 로 바뀐다(그 자리는 콤보가 아니라 결과다).
  const picked = await page.evaluate(() => {
    const still = document.querySelector('input[placeholder^="업체·대리점 검색"]')
    const mark = [...document.querySelectorAll('[title="등록된 업체와 연결됨"]')].length
    return { stillInput: !!still, mark, text: (document.querySelector('.q-box') || {}).innerText || '' }
  })
  console.log(`     고른 뒤 사명 칸 — 입력칸 ${picked.stillInput ? "그대로" : "글자로 바뀜"} · ✓ ${picked.mark}`)
  ok('고르면 칸이 글자 + ✓ 로 바뀐다', picked.stillInput === false && picked.mark > 0)
  const after = await page.evaluate(() => {
    const el = document.activeElement
    return {
      tag: el ? el.tagName.toLowerCase() : null,
      ph: el ? el.getAttribute('placeholder') : null,
      id: el ? el.id : null,
    }
  })
  console.log(`     고른 뒤 커서 → ${after.tag} ${after.ph ?? after.id ?? ''}`)
  ok('고른 뒤 커서가 다음 칸으로 간다(body 에 남지 않는다)', after.tag !== 'body')
  await shot(page, `${TAG}-F-pc-picked`)
  await browser.close()
}

// ── F 폰 — 같은 칸이 시트로 뜨는가 ──────────────────────────────────────────
async function itemFPhone(browsers) {
  console.log('\n══ F 견적 「사명」 — 폰 390 ══')
  const browser = await browsers.webkit.launch()
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  await login(page)
  await page.goto(`${BASE}/quote`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(9000)
  await dismissNotice(page)
  await unlockQuote(page)
  const box = page.locator('input[placeholder^="업체·대리점 검색"]').first()
  if (!(await box.isVisible().catch(() => false))) { ok('폰에서 사명 칸을 찾았다', false); await browser.close(); return }
  await box.click()
  await box.fill('주')
  await page.waitForTimeout(1800)
  const sheet = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]')
    if (!d) return { found: false, W: window.innerWidth }
    const r = d.getBoundingClientRect()
    return { found: true, W: window.innerWidth, w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom), rows: document.querySelectorAll('[role="option"]').length }
  })
  if (sheet.found) console.log(`     시트 폭 ${sheet.w} / 화면 ${sheet.W} · 높이 ${sheet.h} · 줄 ${sheet.rows}`)
  ok('폰에서는 아래 시트로 뜬다', sheet.found === true)
  ok('시트가 화면 폭을 쓴다', sheet.found && sheet.w >= sheet.W - 0.5, `폭 ${sheet.w}`)
  ok('시트에 줄이 보인다', sheet.found && sheet.rows > 0)
  await shot(page, `${TAG}-F-phone-sheet`)
  await browser.close()
}

;(async () => {
  const browsers = {
    chromium: require(path.join(ROOT, 'node_modules/playwright-core')).chromium,
    webkit: require(path.join(ROOT, 'node_modules/playwright-core')).webkit,
  }
  if (want('A')) await itemA(browsers)
  if (want('B')) await itemB(browsers)
  if (want('E')) await itemE(browsers)
  if (want('F')) { await itemF(browsers); await itemFPhone(browsers) }
  console.log(`\n${fails === 0 ? '전부 통과' : `실패 ${fails}건`}`)
})()
