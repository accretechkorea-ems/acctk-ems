/**
 * **묶음6 실측** — 실적 현황의 요약 여섯 칸과 그래프 범위 (2026-11-27).
 *
 *   node scripts/bundle6-measure.js --tag=before
 *   node scripts/bundle6-measure.js --tag=after
 *
 * 기간 셋(월별 · H1 · 연간) × 팀 둘(전체 · 80CS) = **여섯 조합**의 타일 값과
 * 그래프 막대 수를 받아 적는다. 전/후를 견주려고 JSON 으로도 남긴다.
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
const OUT = path.join(ROOT, `docs/bundle6-sales-${TAG}.json`)
const SHOTS = path.join(ROOT, 'docs/screens-bundle6-20261127')

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
async function dismiss(page) {
  for (let i = 0; i < 3; i++) {
    const b = page.getByRole('button', { name: '확인' }).first()
    if (await b.isVisible().catch(() => false)) await b.click().catch(() => {}); else break
    await page.waitForTimeout(200)
  }
}

/**
 * 타일 여섯 — 바탕이 **회색 타일**인 칸 중 첫 자식이 라벨인 것만 센다.
 * (차트 범례의 「수주액」 같은 글자를 함께 집지 않으려고 자리를 좁힌다.)
 */
const TILES = `(() => {
  const out = {}
  for (const el of document.querySelectorAll('div')) {
    const cs = getComputedStyle(el)
    if (cs.backgroundColor !== 'rgb(248, 250, 252)') continue
    const kids = [...el.children]
    if (kids.length < 2) continue
    const label = (kids[0].textContent || '').trim()
    if (!label || label.length > 8) continue
    out[label] = kids.slice(1).map(k => (k.textContent || '').trim()).filter(Boolean).join(' / ')
  }
  const bars = document.querySelectorAll('svg g text').length
  return { tiles: out }
})()`

/** 그래프의 가로축 글자 — 몇 칸이 서 있고 무엇이라 적혀 있나. */
const AXIS = `(() => {
  const svgs = [...document.querySelectorAll('svg[role="img"]')]
  const first = svgs[0]
  if (!first) return { panels: svgs.length, labels: [] }
  // 바닥 글자들 — y 가 가장 큰 무리.
  const texts = [...first.querySelectorAll('text')].map(t => ({ y: Number(t.getAttribute('y')), s: (t.textContent || '').trim() }))
  const maxY = Math.max(...texts.map(t => t.y))
  return {
    panels: svgs.length,
    labels: texts.filter(t => Math.abs(t.y - maxY) < 6).map(t => t.s).filter(Boolean),
  }
})()`

;(async () => {
  const { chromium } = require(path.join(ROOT, 'node_modules/playwright-core'))
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await ctx.newPage()
  await login(page)
  await page.goto(`${BASE}/sales`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(9000)
  await dismiss(page)

  const out = {}
  const seg = async label => {
    const b = page.getByRole('button', { name: label, exact: true }).first()
    if (await b.isVisible().catch(() => false)) { await b.click(); await page.waitForTimeout(1500) }
    else console.log(`  (세그먼트 「${label}」 을 못 찾았다)`)
  }

  for (const team of ['전체', '80CS']) {
    await seg(team)
    for (const [mode, label] of [['month', '월별'], ['h1', 'H1'], ['year', '연간']]) {
      await seg(label)
      await page.waitForTimeout(1200)
      const t = await page.evaluate(TILES)
      const a = await page.evaluate(AXIS)
      const key = `${label}·${team}`
      out[key] = { tiles: t.tiles, axis: a.labels, panels: a.panels }
      console.log(`\n── ${key} ──`)
      for (const [k, v] of Object.entries(t.tiles)) console.log(`     ${k.padEnd(8)} ${v}`)
      console.log(`     가로축 ${a.labels.length}칸: ${a.labels.join(' ')}`)
      if (team === '80CS' && mode === 'month') {
        fs.mkdirSync(SHOTS, { recursive: true })
        await page.screenshot({ path: path.join(SHOTS, `${TAG}-sales-80CS-month.png`) })
        console.log('     캡처 docs/screens-bundle6-20261127/' + TAG + '-sales-80CS-month.png')
      }
    }
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1))
  console.log('\n적었다 ' + path.relative(ROOT, OUT))
  await browser.close()
})()
