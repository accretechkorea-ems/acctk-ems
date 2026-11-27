/**
 * **야간4 2 실측** — 내 견적 모달의 요약 칸·행 높이·폰 넘침 (2026-11-28).
 *
 *   node scripts/night4-myquotes-measure.js --tag=before
 *   node scripts/night4-myquotes-measure.js --tag=after
 *
 * 받아 적는 것
 *   ① 요약 칸 — 라벨과 값 전부(전/후 표의 근거다. 정의가 안 바뀐 것을 숫자로 본다).
 *   ② 모달 안에 「내 견적」 글자가 **몇 번** 나오는가(2-1 은 하나여야 한다).
 *   ③ 표 행 높이 — 첫 열 줄의 실제 높이(2-2 는 42px 고정이다).
 *   ④ 1366×768 에서 한 번에 보이는 행 수 + 캡처.
 *   ⑤ 폰 390 에서 요소 단위 넘침(right > innerWidth) 건수 + 캡처.
 *
 * 읽기만 한다 — 저장·삭제 단추는 누르지 않는다. .env.local 의 값은 어디에도 찍지 않는다.
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
const OUT = path.join(ROOT, `docs/night4-myquotes-${TAG}.json`)
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

/** 모달을 연다 — 홈의 「내 견적」 카드 제목을 누른다. */
async function openModal(page) {
  await page.goto(`${BASE}/dashboard?quoteTab=${encodeURIComponent('전체')}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)
  // 주소로 들어오면 모달이 처음부터 열린다. 안 열렸으면 카드를 누른다.
  const open = await page.locator('text=견적번호 / 고객사 / 내용').first().isVisible().catch(() => false)
  if (!open) {
    await page.getByText('내 견적', { exact: true }).first().click({ timeout: 10000 }).catch(() => {})
    await page.waitForTimeout(3000)
  }
  await page.waitForTimeout(2500)
}

/**
 * 요약 칸 — 모달 안에서 **라벨 + 값**을 짝지어 읽는다.
 *
 * 전(flex 여섯 묶음)과 후(회색 타일 격자) 둘 다 「작은 라벨 한 줄 + 굵은 값 한 줄」이라
 * 같은 규칙으로 집힌다: 자식이 둘 이상이고 첫 자식이 10자 이하의 글자인 div.
 */
const SUMMARY = `(() => {
  const card = document.querySelector('[data-modal-card], [role="dialog"]') || document.body
  const out = []
  for (const el of card.querySelectorAll('div')) {
    const kids = [...el.children].filter(k => k.tagName === 'DIV' || k.tagName === 'SPAN')
    if (kids.length < 2) continue
    const label = (kids[0].textContent || '').trim()
    if (!label || label.length > 10 || /\\n/.test(label)) continue
    if (!/^(견적|수주|매출|순이익|진행|유효)/.test(label)) continue
    const rest = kids.slice(1).map(k => (k.textContent || '').trim()).filter(Boolean)
    if (rest.length === 0) continue
    out.push({ label, value: rest.join(' / ') })
  }
  // 같은 라벨이 겉·속 두 번 집히면 **가장 짧은 값**(가장 속)만 남긴다.
  const best = new Map()
  for (const r of out) {
    const old = best.get(r.label)
    if (!old || r.value.length < old.length) best.set(r.label, r.value)
  }
  return [...best.entries()].map(([label, value]) => ({ label, value }))
})()`

/** 모달 안에 「내 견적」 글자가 몇 번 서 있나 — 제 자식에 같은 글자가 없는 칸만 센다. */
const TITLE_COUNT = `(() => {
  const nodes = [...document.querySelectorAll('div, span, h1, h2, h3')]
    .filter(el => (el.textContent || '').trim() === '내 견적')
    .filter(el => ![...el.children].some(k => (k.textContent || '').trim() === '내 견적'))
  return nodes.map(el => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return { top: Math.round(r.top), left: Math.round(r.left), fontSize: cs.fontSize, fontWeight: cs.fontWeight }
  })
})()`

/** 표 행 — 높이·줄 수. 모달 안에서 보이는 tbody 줄만 본다. */
const ROWS = `(() => {
  const rows = [...document.querySelectorAll('tbody tr')].filter(tr => {
    const r = tr.getBoundingClientRect()
    return r.height > 4 && r.width > 100
  })
  const hs = rows.map(tr => Math.round(tr.getBoundingClientRect().height * 10) / 10)
  const inView = rows.filter(tr => {
    const r = tr.getBoundingClientRect()
    return r.top >= 0 && r.bottom <= window.innerHeight
  }).length
  return {
    count: rows.length,
    heights: hs.slice(0, 14),
    unique: [...new Set(hs)].sort((a, b) => a - b),
    inView,
    firstCellLines: rows.length === 0 ? null
      : [...rows[0].querySelectorAll('td')].map(td => (td.textContent || '').trim().length).slice(0, 10),
  }
})()`

/** 요소 단위 넘침 — right > innerWidth. 넘치는 상자 안에 든 것은 세지 않는다. */
const OVERFLOW = `(() => {
  const W = window.innerWidth
  const scrollable = el => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX
      if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return true
    }
    return false
  }
  const hits = []
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    if (r.right <= W + 0.5) continue
    if (scrollable(el)) continue
    hits.push({
      tag: el.tagName.toLowerCase(),
      right: Math.round(r.right),
      text: (el.textContent || '').trim().slice(0, 30),
    })
  }
  return { innerWidth: W, docWidth: document.documentElement.scrollWidth, count: hits.length, hits: hits.slice(0, 8) }
})()`

;(async () => {
  const { chromium } = require(path.join(ROOT, 'node_modules/playwright'))
  fs.mkdirSync(SHOTS, { recursive: true })
  const browser = await chromium.launch()
  const report = { tag: TAG, at: new Date().toISOString(), base: BASE }

  // ── PC 1366×768 ─────────────────────────────────────────────────────────
  {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } })
    const page = await ctx.newPage()
    await login(page)
    await openModal(page)
    report.pc = {
      summary: await page.evaluate(SUMMARY),
      titles: await page.evaluate(TITLE_COUNT),
      rows: await page.evaluate(ROWS),
    }
    await page.screenshot({ path: path.join(SHOTS, `myquotes-1366-${TAG}.png`) })
    await ctx.close()
  }

  // ── 폰 390×844 · 350×760 ────────────────────────────────────────────────
  for (const W of [390, 350]) {
    const ctx = await browser.newContext({ viewport: { width: W, height: W === 390 ? 844 : 760 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
    const page = await ctx.newPage()
    await login(page)
    await openModal(page)
    report[`phone${W}`] = {
      overflow: await page.evaluate(OVERFLOW),
      rows: await page.evaluate(ROWS),
    }
    await page.screenshot({ path: path.join(SHOTS, `myquotes-${W}-${TAG}.png`), fullPage: false })
    await ctx.close()
  }

  await browser.close()
  fs.writeFileSync(OUT, JSON.stringify(report, null, 1))
  console.log(JSON.stringify(report, null, 1))
  console.log('\n저장: ' + OUT)
})().catch(e => { console.error(e); process.exit(1) })
