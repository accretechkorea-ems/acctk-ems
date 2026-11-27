/**
 * **장비 등록/수정 모달의 세 칸** 실측 — 라인업 · 모델명 · 옵션 (2026-11-27).
 *
 *   node scripts/device-modal-measure.js --tag=before
 *   node scripts/device-modal-measure.js --tag=after
 *
 * 390 과 350 두 폭에서 사업장 화면을 열고
 *   ① 「+ 장비 추가」 모달 — 세 칸 각각의 **폭과 right**
 *   ② 기존 장비 「수정」 모달 — 같은 것
 *   ③ 라인업 칸을 눌러 뜬 **목록**의 폭·높이
 *   ④ 견적 작성의 사명 칸 목록
 * 를 재고 캡처를 남긴다. 읽기만 한다 — 저장 단추는 누르지 않는다.
 * .env.local 의 값은 어디에도 찍지 않는다.
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const arg = (name, dflt) => {
  const hit = process.argv.slice(2).find(a => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : dflt
}
const BASE = arg('base', 'http://localhost:3101')
const TAG = arg('tag', 'before')
const SITE = arg('site', '593')
const SHOTS = path.join(ROOT, 'docs/screens-device-modal-20261127')

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
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false })
  console.log('     캡처 docs/screens-device-modal-20261127/' + name + '.png')
}

/** 세 칸(라인업·모델·옵션)의 입력칸을 placeholder 로 찾아 폭·right 를 센다. */
const THREE = `(() => {
  const W = window.innerWidth
  const want = ['라인업', '모델', '구성']
  const out = []
  for (const key of want) {
    const el = [...document.querySelectorAll('input[placeholder]')]
      .find(i => (i.getAttribute('placeholder') || '').startsWith(key))
    if (!el) { out.push({ key, found: false }); continue }
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    out.push({ key, found: true, w: Math.round(r.width), right: Math.round(r.right), left: Math.round(r.left), fontSize: Math.round(parseFloat(cs.fontSize)) })
  }
  return { W, cols: out }
})()`

/** 떠 있는 목록(role=listbox 또는 안내 한 줄)의 자리. */
const LIST = `(() => {
  const W = window.innerWidth, H = window.innerHeight
  const lb = document.querySelector('[role="listbox"]')
  const host = lb ? lb.closest('div[style]') : null
  const panel = (() => {
    let n = lb
    while (n && n.parentElement) {
      const cs = getComputedStyle(n)
      if (cs.position === 'fixed' || cs.position === 'absolute') return n
      n = n.parentElement
    }
    return host
  })()
  if (!panel) return { W, H, found: false }
  const r = panel.getBoundingClientRect()
  return {
    W, H, found: true,
    w: Math.round(r.width), h: Math.round(r.height),
    left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom),
    rows: document.querySelectorAll('[role="option"]').length,
  }
})()`

async function openAdd(page) {
  await page.goto(`${BASE}/customer/${SITE}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(7000)
  await dismissNotice(page)
  for (const name of ['장비 추가', '+ 장비 추가', '＋ 장비 추가']) {
    const b = page.getByRole('button', { name: new RegExp(name.replace(/[+＋]/g, '.?')) }).first()
    if (await b.isVisible().catch(() => false)) { await b.click(); await page.waitForTimeout(1200); return true }
  }
  return false
}
async function openEdit(page) {
  await page.goto(`${BASE}/customer/${SITE}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(7000)
  await dismissNotice(page)
  const b = page.getByRole('button', { name: '장비 수정' }).first()
  if (!(await b.isVisible().catch(() => false))) return false
  await b.click()
  await page.waitForTimeout(1500)
  return true
}

async function measure(page, W, label) {
  const three = await page.evaluate(THREE)
  console.log(`\n── ${label} · ${W}px ──`)
  for (const c of three.cols) {
    if (!c.found) { ok(`${label} ${c.key} 칸이 있다`, false); continue }
    console.log(`     ${c.key.padEnd(4)} 폭 ${String(c.w).padStart(3)} · left ${String(c.left).padStart(3)} · right ${String(c.right).padStart(3)} · 글자 ${c.fontSize}px`)
    ok(`${label} ${c.key} 칸이 화면 안에 있다`, c.right <= W + 0.5, `right ${c.right} ≤ ${W}`)
    ok(`${label} ${c.key} 칸을 쓸 수 있는 폭이다(≥ 120)`, c.w >= 120, `폭 ${c.w}`)
    ok(`${label} ${c.key} 글자 16px 이상(iOS 가 확대하지 않는다)`, c.fontSize >= 16, `${c.fontSize}px`)
  }
  return three
}

async function measureList(page, W, label) {
  const lineup = page.locator('input[placeholder^="라인업"]').first()
  if (!(await lineup.isVisible().catch(() => false))) { ok(`${label} 라인업 칸을 찾았다`, false); return null }
  await lineup.click()
  await page.waitForTimeout(900)
  const l = await page.evaluate(LIST)
  if (!l.found) { ok(`${label} 목록이 떴다`, false); return null }
  console.log(`     목록 폭 ${l.w} · 높이 ${l.h} · left ${l.left} · right ${l.right} · top ${l.top} · 줄 ${l.rows}`)
  ok(`${label} 목록이 화면 폭을 넘지 않는다`, l.right <= W + 0.5 && l.left >= -0.5, `${l.left}~${l.right} / ${W}`)
  ok(`${label} 목록이 읽을 만한 폭이다(≥ 화면의 80%)`, l.w >= W * 0.8, `폭 ${l.w} / ${W}`)
  ok(`${label} 목록에 줄이 보인다`, l.rows > 0, `${l.rows}줄`)
  return l
}

/**
 * **이어서 고르기** — 라인업을 고르면 모델이, 모델을 고르면 구성이 좁혀진다.
 * 시트에서 고른 값이 칸에 들어오는지, 그리고 저장 단추에 손이 닿는지를 본다.
 */
async function flow(page, W) {
  console.log(`\n── 이어 고르기 · ${W}px ──`)
  const steps = [['라인업', '라인업'], ['모델', '모델명'], ['구성', '옵션']]
  // 앞 단계의 시트가 떠 있으면 그 어둑한 바탕이 다음 칸을 가린다 — 먼저 닫는다.
  const closeSheet = async () => {
    if (await page.locator('[role="dialog"]').count()) {
      await page.keyboard.press('Escape')
      await page.waitForTimeout(500)
    }
  }
  for (const [ph, name] of steps) {
    await closeSheet()
    const box = page.locator(`input[placeholder^="${ph}"]`).first()
    if (!(await box.isVisible().catch(() => false))) { ok(`${name} 칸이 있다`, false); return }
    await box.click()
    await page.waitForTimeout(800)
    const first = page.locator('[role="option"]').first()
    if (!(await first.isVisible().catch(() => false))) { ok(`${name} 시트에 고를 줄이 있다`, false); return }
    const text = (await first.textContent()) ?? ''
    await first.click()
    await page.waitForTimeout(700)
    const got = await box.inputValue()
    console.log(`     ${name.padEnd(4)} 고른 값 「${got}」`)
    ok(`${name} 에 고른 값이 들어간다`, got.trim() !== '' && text.includes(got.trim().split(' ')[0]), `「${got}」`)
    const sheet = await page.locator('[role="dialog"]').count()
    ok(`${name} 고르면 시트가 닫힌다`, sheet === 0, `남은 시트 ${sheet}`)
  }
  await closeSheet()
  const save = page.getByRole('button', { name: /^저장/ }).first()
  if (!(await save.isVisible().catch(() => false))) { ok('저장 단추가 보인다', false); return }
  const r = await save.boundingBox()
  console.log(`     저장 단추 right ${Math.round(r.x + r.width)} · bottom ${Math.round(r.y + r.height)}`)
  ok('저장 단추가 화면 안에 있다', r.x + r.width <= W + 0.5 && r.y + r.height <= 844 + 0.5)
  ok('저장 단추를 누를 만큼 크다(≥ 44px 높이)', r.height >= 40, `높이 ${Math.round(r.height)}`)
}


;(async () => {
  const { webkit } = require(path.join(ROOT, 'node_modules/playwright-core'))
  for (const W of [390, 350]) {
    const browser = await webkit.launch()
    const ctx = await browser.newContext({ viewport: { width: W, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
    const page = await ctx.newPage()
    await login(page)

    if (await openAdd(page)) {
      await measure(page, W, '등록')
      await shot(page, `${TAG}-${W}-add`)
      await measureList(page, W, '등록 목록')
      await shot(page, `${TAG}-${W}-add-list`)
      await flow(page, W)
      await shot(page, `${TAG}-${W}-add-chosen`)
    } else ok(`${W} 「장비 추가」 단추를 찾았다`, false)

    if (await openEdit(page)) {
      await measure(page, W, '수정')
      await shot(page, `${TAG}-${W}-edit`)
    } else ok(`${W} 「수정」 단추를 찾았다`, false)

    await browser.close()
  }

  /**
  /**
   * **견적 작성의 사명 칸** — 지시문이 한 번 보라고 한 자리다.
   *
   * 결론부터: 이 칸은 **SearchSelect 가 아니다.** 손으로 만든 콤보다
   * (components/quote/CustomerCard.tsx 의 customerSearchRef · customerListRef · customerKeys).
   * 그래서 이번 시트는 그 칸에 닿지 않는다 — 여기서는 **칸이 넘치지 않는 것**만 재고
   * 보고서에 「아직 공용 부품이 아니다」로 적는다. 바꾸는 일은 이 커밋의 몫이 아니다.
   */
  {
    const browser = await webkit.launch()
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
    const page = await ctx.newPage()
    await login(page)
    await page.goto(`${BASE}/quote`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(9000)
    await dismissNotice(page)
    const info = await page.evaluate(() => {
      const W = window.innerWidth
      const el = [...document.querySelectorAll('input')]
        .find(i => /업체|회사|사명/.test(i.getAttribute('placeholder') || ''))
      if (!el) return { W, found: false }
      const r = el.getBoundingClientRect()
      return {
        W, found: true, ph: el.getAttribute('placeholder'),
        w: Math.round(r.width), right: Math.round(r.right),
        role: el.getAttribute('role'), fontSize: Math.round(parseFloat(getComputedStyle(el).fontSize)),
      }
    })
    console.log('\n── 견적 작성 사명 칸 · 390px ──')
    if (info.found) {
      console.log(`     「${info.ph}」 폭 ${info.w} · right ${info.right} · role=${info.role ?? '없음'} · 글자 ${info.fontSize}px`)
      ok('사명 칸이 화면 안에 있다', info.right <= info.W + 0.5, `right ${info.right} ≤ ${info.W}`)
      ok('사명 칸 글자가 16px 이상이다', info.fontSize >= 16, `${info.fontSize}px`)
      console.log('     ※ 이 칸은 SearchSelect 가 아니라 손으로 만든 콤보다 — 시트는 아직 닿지 않는다.')
    } else ok('사명 칸을 찾았다', false)
    await shot(page, `${TAG}-390-quote-company`)
    await browser.close()
  }

  console.log(`\n${fails === 0 ? '전부 통과' : `실패 ${fails}건`}`)
})()
