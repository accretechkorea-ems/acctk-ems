/**
 * **iPhone Safari 가로 넘침**을 잰다 — WebKit 으로 (2026-11-26).
 *
 *   npm run ios                      # 기본 http://localhost:3100, 기본 화면 넷
 *   npm run ios -- --base=http://localhost:3000 --paths=/,/quote
 *   npm run ios -- --only=webkit     # 한 엔진만
 *
 * ── 왜 따로 있나 ──────────────────────────────────────────────────────────
 *   `npm run check` 의 하네스는 **키도 서버도 없이** 도는 것이 규칙이다. 이 측정은
 *   둘 다 필요하다(로그인해야 목록이 그려진다) — 그래서 check 에 넣지 않고 손으로
 *   부르는 명령으로 둔다(scripts/perf 와 같은 자리다). 파일 이름이 `-check.js` 가
 *   아니라서 scripts/run-checks.js 가 줍지도 않는다.
 *
 * ── 왜 WebKit 인가 ───────────────────────────────────────────────────────
 *   2026-11-25 에 실기기 iPhone Safari 에서만 고객사 목록이 오른쪽으로 잘렸다.
 *   크로미움 에뮬레이션(390×844)에서는 재현되지 않았다 — 에뮬레이션은 **엔진이
 *   크로미움**이라 iOS 전용 레이아웃 차이(100vw 와 스크롤바, -webkit-fill-available,
 *   고정 요소의 겹침)를 흉내 내지 못한다. 그래서 같은 화면을 **두 엔진**으로 재서
 *   다른 쪽만 걸리는 요소를 집어낸다.
 *
 * 돌려주는 것: 화면마다 documentElement.scrollWidth · innerWidth · 오른쪽으로
 * 삐져나온 요소 목록(위에서부터 몇 개). 종료 코드는 **넘친 화면이 있으면 1**이라
 * 자동화(이분 탐색)에서 good/bad 판정에 바로 쓴다.
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const arg = (name, dflt) => {
  const hit = process.argv.slice(2).find(a => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : dflt
}

const BASE = arg('base', 'http://localhost:3100')
const PATHS = arg('paths', '/,/quote,/cards,/customer/593').split(',').filter(Boolean)
const ONLY = arg('only', '')
/** 실기기와 같은 창 — iPhone 14(390×844, DPR 3). Playwright 의 기기 목록에서 가져온다. */
const DEVICE = arg('device', 'iPhone 14')

const env = {}
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim())
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

/**
 * 창 밖으로 **오른쪽으로** 나간 요소를 찾는다.
 * 숨은 것(크기 0)과 화면 밖으로 치워 둔 것(right ≤ 0)은 세지 않는다 —
 * 닫힌 서랍처럼 일부러 밖에 둔 것은 스크롤을 늘리지 않는다.
 *
 * ── 가로로 **스스로 구르는 통** 안에 있는 것은 따로 센다 (2026-11-26) ──────
 *   의뢰서의 종류 탭 띠(.iq-rail)와 포캐스트 판은 `overflow-x: auto` 다 — 안의 것이
 *   창보다 오른쪽에 있어도 **문서는 넓어지지 않는다**(그 통만 옆으로 구른다. 일부러
 *   그렇게 만든 자리다). 그것을 넘침으로 세면 고칠 것이 없는데도 빨간불이 켜져,
 *   정말 고쳐야 하는 자리(문서가 넓어지는 것)가 묻힌다.
 *   그래서 **조상 가운데 하나라도 가로를 가두면**(overflow-x 가 visible 이 아니면)
 *   그 줄은 `구르는통` 으로 옮기고 넘침에서 뺀다. 숨기는 것이 아니라 **가르는** 것이다 —
 *   두 수를 함께 적는다.
 */
const PROBE = () => {
  const vw = window.innerWidth
  const out = []
  const rolled = []
  /** 이 요소와 뿌리 사이에 가로를 가두는 조상이 있는가. 있으면 그것을 돌려준다. */
  const clipper = el => {
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const ox = getComputedStyle(a).overflowX
      if (ox !== 'visible') return a
    }
    return null
  }
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    if (r.right <= vw + 0.5) continue
    if (r.right <= 0) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    const box = clipper(el)
    if (box) {
      rolled.push(`${el.tagName.toLowerCase()}.${String(el.className || '').slice(0, 24)} ⊂ ${box.tagName.toLowerCase()}.${String(box.className || '').slice(0, 24)}`)
      continue
    }
    out.push({
      tag: el.tagName.toLowerCase(),
      cls: String(el.className || '').slice(0, 40),
      right: Math.round(r.right),
      left: Math.round(r.left),
      w: Math.round(r.width),
      pos: cs.position,
      // 그 요소가 **스스로** 넓은가, 부모가 밀었는가 — 고칠 자리를 가른다.
      넓이규칙: [cs.width, cs.minWidth, cs.maxWidth].join(' / '),
    })
  }
  out.sort((a, b) => b.right - a.right)
  return {
    문서폭: document.documentElement.scrollWidth,
    창폭: vw,
    body폭: document.body.scrollWidth,
    html넘침: getComputedStyle(document.documentElement).overflowX,
    body넘침: getComputedStyle(document.body).overflowX,
    넘친것: out.slice(0, 8),
    넘친수: out.length,
    // 가로로 구르는 통 안에 있던 것 — 문서를 넓히지 않으므로 넘침이 아니다.
    구르는통수: rolled.length,
    구르는통: [...new Set(rolled)].slice(0, 4),
  }
}

async function measure(engineName, engine) {
  const playwright = require(path.join(ROOT, 'node_modules/playwright'))
  const device = playwright.devices[DEVICE]
  const browser = await engine.launch()
  const ctx = await browser.newContext({ ...device })
  const page = await ctx.newPage()
  const rows = []

  let ok = false
  for (let i = 1; i <= 3 && !ok; i++) {
    await page.goto(`${BASE}/login`, { waitUntil: 'load' })
    await page.waitForTimeout(700 * i)
    await page.getByPlaceholder('아이디').fill(env.E2E_EMAIL)
    await page.getByPlaceholder('비밀번호').fill(env.E2E_PASSWORD)
    await page.getByRole('button', { name: /로그인/ }).click()
    ok = await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 25000 })
      .then(() => true).catch(() => false)
  }
  if (!ok) { await browser.close(); throw new Error(`${engineName}: 로그인 실패`) }

  for (const p of PATHS) {
    await page.goto(`${BASE}${p}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(6000)
    rows.push({ path: p, ...(await page.evaluate(PROBE)) })
  }
  await browser.close()
  return rows
}

;(async () => {
  const playwright = require(path.join(ROOT, 'node_modules/playwright'))
  const engines = [['webkit', playwright.webkit], ['chromium', playwright.chromium]]
    .filter(([n]) => !ONLY || n === ONLY)

  let bad = 0
  for (const [name, engine] of engines) {
    console.log(`\n══ ${name} · ${DEVICE} ══`)
    let rows
    try { rows = await measure(name, engine) } catch (e) { console.log(`   ${e.message}`); bad++; continue }
    for (const r of rows) {
      const over = r.문서폭 - r.창폭
      if (over > 0 || r.넘친수 > 0) bad++
      console.log(`${over > 0 || r.넘친수 > 0 ? '넘침' : '정상'} ${r.path}  문서 ${r.문서폭} / 창 ${r.창폭} (${over > 0 ? `+${over}` : '0'}) · body ${r.body폭} · overflow-x html:${r.html넘침} body:${r.body넘침} · 삐져나온 요소 ${r.넘친수}${r.구르는통수 ? ` · (구르는 통 안 ${r.구르는통수}: ${r.구르는통.join(' · ')})` : ''}`)
      for (const e of r.넘친것) {
        console.log(`      ${e.tag}.${e.cls}  left ${e.left} right ${e.right} (w ${e.w}) ${e.pos} · ${e.넓이규칙}`)
      }
    }
  }
  console.log(bad === 0 ? '\n넘친 화면 없음' : `\n${bad}건 넘침`)
  process.exit(bad === 0 ? 0 : 1)
})()
