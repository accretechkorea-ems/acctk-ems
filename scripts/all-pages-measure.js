/**
 * **전 화면 점검** — 콘솔 오류 · 폰 넘침 · 조회 수 (2026-11-27 야간3 8).
 *
 *   node scripts/all-pages-measure.js --stage=console   # 8-1 크로미움 콘솔 오류·경고
 *   node scripts/all-pages-measure.js --stage=phone     # 8-2 390·350 요소 단위 right
 *   node scripts/all-pages-measure.js --stage=queries   # 8-3 화면별 Supabase 요청 수
 *
 * ── 왜 ios-overflow.js 와 따로인가 ────────────────────────────────────────
 *   그쪽은 **네 화면**을 두 엔진으로 깊게 본다(앱바·하단 틈·입력칸 크기까지).
 *   이쪽은 **모든 화면**을 얕게 훑는다 — 빠진 화면이 없게 하는 것이 목적이다.
 *   넘침은 **빼는 규칙 없이** 전 요소의 right 를 센다(2026-11-27 의 좌 패널 결함처럼
 *   조상이 가로를 가두면 문서 폭으로는 보이지 않는다).
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
const BASE = arg('base', 'http://localhost:3100')
const STAGE = arg('stage', 'console')
const ONLY = arg('only', '')

const env = {}
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim())
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

/** 로그인해야 보이는 화면 전부. 공개 화면(/login·/lead)과 디버그는 뺀다. */
const PAGES = [
  '/', '/account', '/activity', '/admin', '/approval', '/cards', '/cards/import',
  '/contact/semi', '/dashboard', '/dashboard/80', '/holdings', '/inquiries',
  '/inventory', '/leads', '/notifications', '/pipeline', '/purchase', '/quote',
  '/repair', '/repair/dashboard', '/sales', '/showroom', '/suggestions',
].filter(p => !ONLY || p === ONLY)

/**
 * 밖에서 오는 것·우리가 어쩔 수 없는 것은 센 뒤 따로 적는다.
 * 카카오는 :3100 이 등록된 도메인이 아니라 늘 401/도메인 오류를 낸다(배포본에서는 안 난다).
 */
const EXTERNAL = [/dapi\.kakao/, /daumcdn/, /kakaocdn/, /postcode\.map\.kakao/, /favicon/, /카카오 지도 SDK/]
const isExternal = t => EXTERNAL.some(re => re.test(t))

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  await page.getByPlaceholder('아이디').fill(env.E2E_EMAIL)
  await page.getByPlaceholder('비밀번호').fill(env.E2E_PASSWORD)
  await page.getByRole('button', { name: '로그인' }).click()
  await page.waitForTimeout(1500)
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30000 })
}
async function dismissNotice(page) {
  for (let i = 0; i < 3; i++) {
    const b = page.getByRole('button', { name: '확인' }).first()
    if (await b.isVisible().catch(() => false)) await b.click().catch(() => {}); else break
    await page.waitForTimeout(200)
  }
}

// ── 8-1 콘솔 ────────────────────────────────────────────────────────────────
async function stageConsole() {
  const { chromium } = require(path.join(ROOT, 'node_modules/playwright-core'))
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await ctx.newPage()
  let bag = []
  page.on('console', m => {
    if (m.type() !== 'error' && m.type() !== 'warning') return
    bag.push({ type: m.type(), text: m.text().slice(0, 200) })
  })
  page.on('pageerror', e => bag.push({ type: 'pageerror', text: String(e.message).slice(0, 200) }))
  await login(page)
  console.log('화면'.padEnd(22), '오류', '경고', '  (밖에서 오는 것은 따로)')
  const rows = []
  for (const p of PAGES) {
    bag = []
    await page.goto(`${BASE}${p}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(7000)
    await dismissNotice(page)
    const mine = bag.filter(b => !isExternal(b.text))
    const out = bag.filter(b => isExternal(b.text))
    const err = mine.filter(b => b.type !== 'warning').length
    const warn = mine.filter(b => b.type === 'warning').length
    rows.push({ page: p, err, warn, ext: out.length, sample: mine.slice(0, 3).map(b => b.text) })
    console.log(p.padEnd(22), String(err).padStart(3), String(warn).padStart(4), `  밖 ${out.length}`)
    for (const b of mine.slice(0, 3)) console.log('      ·', String(b.text).slice(0, 150))
  }
  await browser.close()
  fs.writeFileSync(path.join(ROOT, 'docs/night3-console.json'), JSON.stringify(rows, null, 1))
  const bad = rows.filter(r => r.err + r.warn > 0)
  console.log(`\n깨끗한 화면 ${rows.length - bad.length}/${rows.length}`)
}

// ── 8-2 폰 ──────────────────────────────────────────────────────────────────
const PHONE_PROBE = `(() => {
  const W = window.innerWidth
  const over = []
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    if (r.right <= 0) continue
    if (r.right <= W + 0.5) continue
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\\s+/).slice(0, 2).join('.') : ''
    // 조상이 가로를 **가두고** 있는가. 두 가지가 다 「화면이 잘린 것」이 아니다 —
    //   auto·scroll 은 일부러 옆으로 미는 자리(넓은 표·레일)고,
    //   hidden 은 그 칸 안에서 말줄임으로 자른 자리(tableLayout: fixed 의 td)다.
    //   둘 중 하나라도 있으면 이 요소는 문서 폭을 밀지 못한다. 가두는 그 조상이 화면보다
    //   넓으면 **조상 자신이** 따로 걸리므로, 자식까지 두 번 셀 까닭이 없다.
    let rolled = false
    for (let a = el.parentElement; a; a = a.parentElement) {
      const ox = getComputedStyle(a).overflowX
      if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') { rolled = true; break }
    }
    over.push({ tag: el.tagName.toLowerCase() + (cls ? '.' + cls : ''), right: Math.round(r.right), over: Math.round(r.right - W), rolled })
  }
  const small = [...document.querySelectorAll('input,select,textarea,[contenteditable]')].filter(e => {
    const cs = getComputedStyle(e)
    if (cs.display === 'none' || cs.visibility === 'hidden') return false
    const t = (e.getAttribute('type') || '').toLowerCase()
    if (['checkbox', 'radio', 'range', 'color', 'hidden'].includes(t)) return false
    return parseFloat(cs.fontSize) < 16
  }).length
  const bar = document.querySelector('.ems-topbar')
  const barOk = !!bar && getComputedStyle(bar).display !== 'none' && bar.getBoundingClientRect().height > 0
  const real = over.filter(o => !o.rolled)
  return { W, over: real.sort((a, b) => b.over - a.over).slice(0, 5), overCount: real.length, rolledCount: over.length - real.length, small, barOk }
})()`

async function stagePhone() {
  const { webkit } = require(path.join(ROOT, 'node_modules/playwright-core'))
  const rows = []
  for (const W of [390, 350]) {
    const browser = await webkit.launch()
    const ctx = await browser.newContext({ viewport: { width: W, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
    const page = await ctx.newPage()
    await login(page)
    for (const p of PAGES) {
      await page.goto(`${BASE}${p}`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(6000)
      await dismissNotice(page)
      const r = await page.evaluate(PHONE_PROBE)
      rows.push({ w: W, page: p, ...r })
      const bad = r.overCount > 0 || r.small > 0 || !r.barOk
      console.log(`${bad ? '걸림' : '정상'} ${String(W)} ${p.padEnd(22)} 넘침 ${String(r.overCount).padStart(3)} (가둔 통 안 ${r.rolledCount}) · 16px미만 ${r.small} · 앱바 ${r.barOk ? '보임' : '**안 보임**'}`)
      for (const o of r.over) console.log(`        +${o.over}px ${o.tag} right ${o.right}`)
    }
    await browser.close()
  }
  fs.writeFileSync(path.join(ROOT, 'docs/night3-phone.json'), JSON.stringify(rows, null, 1))
  const bad = rows.filter(r => r.overCount > 0 || r.small > 0 || !r.barOk)
  console.log(`\n걸린 화면 ${bad.length} / ${rows.length}`)
}

// ── 8-3 조회 수 ─────────────────────────────────────────────────────────────
async function stageQueries() {
  const { chromium } = require(path.join(ROOT, 'node_modules/playwright-core'))
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await ctx.newPage()
  let calls = []
  page.on('request', r => {
    const u = r.url()
    if (!u.includes('/rest/v1/')) return
    const m = u.match(/\/rest\/v1\/([a-z_]+)\?([^#]*)/)
    calls.push({ table: m?.[1] ?? '?', q: decodeURIComponent(m?.[2] ?? '').slice(0, 400) })
  })
  await login(page)
  const WANT = ['/dashboard', '/', '/pipeline', '/sales']
  const rows = []
  for (const p of WANT) {
    calls = []
    await page.goto(`${BASE}${p}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(9000)
    await dismissNotice(page)
    await page.waitForTimeout(1500)
    const byTable = {}
    for (const c of calls) (byTable[c.table] ??= []).push(c.q)
    // **같은 표 같은 조건**이 둘 이상인 것만 합칠 거리다.
    const dupes = Object.entries(byTable)
      .map(([t, qs]) => {
        const same = new Map()
        for (const q of qs) same.set(q, (same.get(q) ?? 0) + 1)
        const worst = [...same.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1])
        return { table: t, calls: qs.length, repeated: worst.map(([q, n]) => ({ n, q })) }
      })
      .filter(r => r.calls > 0)
      .sort((a, b) => b.calls - a.calls)
    rows.push({ page: p, total: calls.length, tables: dupes })
    console.log(`\n══ ${p} — 요청 ${calls.length}건 ══`)
    for (const d of dupes) {
      const rep = d.repeated.length ? `  ← **같은 조건 ${d.repeated.map(r => r.n).join('·')}회**` : ''
      console.log(`   ${d.table.padEnd(24)} ${String(d.calls).padStart(3)}건${rep}`)
      for (const r of d.repeated) console.log(`        ${r.n}× ${r.q.slice(0, 200)}`)
    }
  }
  await browser.close()
  fs.writeFileSync(path.join(ROOT, 'docs/night3-queries.json'), JSON.stringify(rows, null, 1))
}

;(async () => {
  if (STAGE === 'console') await stageConsole()
  if (STAGE === 'phone') await stagePhone()
  if (STAGE === 'queries') await stageQueries()
})()
