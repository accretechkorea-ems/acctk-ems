/**
 * **야간4 5 실측** — 폰 고객사 좌 패널의 **높이**와 스크롤 (2026-11-28).
 *
 *   node scripts/night4-panel-measure.js --tag=before
 *   node scripts/night4-panel-measure.js --tag=after
 *
 * scripts/home-phone-measure.js 는 **가로**(잘림)를 잰다. 이 대본은 **세로**를 잰다 —
 * 5-1 이 묻는 것이 그것이다: 묶음4 E 의 예외 규칙(`.home-grid .side-panel > *`)과
 * 8ddf167(absolute 340 → 100%)이 지금 폰에서 어떤 높이를 만들고 있나.
 *
 * 받아 적는 것
 *   ① 패널·상단 카드·목록 통의 높이 — 셋이 어떻게 나뉘나.
 *   ② 첫 카드와 **마지막 카드**가 화면 안에 있나(화면 밖이면 「목록이 비었다」로 읽힌다).
 *   ③ 구르는 통이 **어디**인가 — 목록 통인가 페이지(body)인가.
 *   ④ 바닥에 **회색 빈 자리**가 얼마나 남나.
 *   ⑤ 끝까지 굴렸을 때 마지막 카드가 보이나.
 *
 * 읽기만 한다. .env.local 의 값은 어디에도 찍지 않는다.
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
const WIDTHS = arg('widths', '390,350').split(',').map(Number)
const OUT = path.join(ROOT, `docs/night4-panel-${TAG}.json`)
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

const MEASURE = `(() => {
  const r = el => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) } }
  const panel = document.querySelector('.side-panel')
  const kids = panel ? [...panel.children] : []
  const list = document.querySelector('.customer-list-scroll')
  // 업체 카드 — 목록 안에서 **글자가 있는** 카드 꼴의 줄.
  const cards = list ? [...list.querySelectorAll('[class*="ems-pick"], article, a, li')].filter(el => {
    const b = el.getBoundingClientRect()
    return b.height > 40 && b.width > 100 && (el.textContent || '').trim().length > 2
  }) : []
  /** 구르는 통 — 세로로 스스로 구르는 조상 가운데 가장 가까운 것. */
  const scrollerOf = el => {
    for (let p = el; p; p = p.parentElement) {
      const cs = getComputedStyle(p)
      if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 2) {
        return (p.className && typeof p.className === 'string' ? '.' + p.className.split(/\\s+/)[0] : p.tagName.toLowerCase())
      }
    }
    return null
  }
  const doc = document.documentElement
  return {
    창: { w: window.innerWidth, h: window.innerHeight },
    문서: { scrollHeight: doc.scrollHeight, clientHeight: doc.clientHeight, 페이지가_구르나: doc.scrollHeight > doc.clientHeight + 2 },
    패널: r(panel),
    패널의_칸: kids.map(k => ({ ...r(k), cls: String(k.className || '').split(/\\s+/)[0] || k.tagName.toLowerCase() })),
    목록통: list ? { ...r(list), scrollHeight: Math.round(list.scrollHeight), clientHeight: Math.round(list.clientHeight), 스스로_구르나: list.scrollHeight > list.clientHeight + 2 } : null,
    카드수: cards.length,
    첫카드: r(cards[0]),
    끝카드: r(cards[cards.length - 1]),
    끝카드가_화면안: cards.length > 0 ? r(cards[cards.length - 1]).bottom <= window.innerHeight : null,
    구르는_통: cards.length > 0 ? scrollerOf(cards[0]) : null,
    바닥_빈자리: panel ? Math.max(0, window.innerHeight - r(panel).bottom) : null,
  }
})()`

;(async () => {
  const { chromium } = require(path.join(ROOT, 'node_modules/playwright'))
  fs.mkdirSync(SHOTS, { recursive: true })
  const browser = await chromium.launch()
  const report = { tag: TAG, at: new Date().toISOString(), base: BASE, 폭: {} }

  for (const W of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: W, height: W === 390 ? 844 : 760 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
    const page = await ctx.newPage()
    await login(page)
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(5000)

    const one = {}
    one.처음 = await page.evaluate(MEASURE)
    await page.screenshot({ path: path.join(SHOTS, `panel-${W}-list-${TAG}.png`) })

    // 끝까지 굴려 본다 — 목록 통이든 페이지든.
    await page.evaluate(`(() => {
      const list = document.querySelector('.customer-list-scroll')
      if (list && list.scrollHeight > list.clientHeight + 2) list.scrollTop = list.scrollHeight
      else window.scrollTo(0, document.documentElement.scrollHeight)
    })()`)
    await page.waitForTimeout(1200)
    one.끝까지_굴린_뒤 = await page.evaluate(MEASURE)
    await page.screenshot({ path: path.join(SHOTS, `panel-${W}-bottom-${TAG}.png`) })

    report.폭[W] = one
    await ctx.close()
  }

  await browser.close()
  fs.writeFileSync(OUT, JSON.stringify(report, null, 1))
  console.log(JSON.stringify(report, null, 1))
  console.log('\n저장: ' + OUT)
})().catch(e => { console.error(e); process.exit(1) })
