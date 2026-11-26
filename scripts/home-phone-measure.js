/**
 * **폰 고객사 화면의 가로 잘림**을 요소 단위로 잰다 (2026-11-27).
 *
 *   node scripts/home-phone-measure.js                      # 390, 세 상태
 *   node scripts/home-phone-measure.js --widths=375,390,430
 *   node scripts/home-phone-measure.js --tag=before --shots=docs/screens-phone-20261127
 *
 * ── 왜 따로 있나 ──────────────────────────────────────────────────────────
 *   scripts/ios-overflow.js 는 **문서가 넓어졌는가**(scrollWidth)를 본다. 그리고 가로로
 *   스스로 구르는 통 안의 것은 넘침에서 **뺀다** — 일부러 옆으로 미는 자리(발주 표·
 *   의뢰서 띠)가 빨간불을 켜지 않게 하려는 규칙이다. 그런데 고객사 화면의 좌 패널은
 *   조상이 `overflow: hidden` 이라, 화면 밖으로 나가도 **문서는 넓어지지 않고** 그 규칙에
 *   걸러져 「넘침 0」으로 보였다. 잘린 채로 조용했다는 뜻이다.
 *
 *   그래서 이 대본은 **빼지 않는다** — 그 세 화면의 **모든 요소**를 보고
 *   `getBoundingClientRect().right ≤ innerWidth` 인지 하나씩 센다.
 *
 * 돌려주는 것: 화면마다 넘친 요소 목록(오른쪽으로 많이 나간 것부터)과, 눈으로 보는
 * 자리 셋(좌 패널 · 검색 카드 · 업체 카드)의 left/right.
 * 종료 코드는 **넘친 요소가 있으면 1** 이다.
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const arg = (name, dflt) => {
  const hit = process.argv.slice(2).find(a => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : dflt
}
const BASE = arg('base', 'http://localhost:3100')
const WIDTHS = arg('widths', '390').split(',').map(Number).filter(Boolean)
const TAG = arg('tag', '')
/** ③ 에서 펼쳐 볼 사업장. 읽기만 한다 — 한 글자도 고치지 않는다. */
const SITE = arg('site', '593')
const SHOTS = arg('shots', '')

const env = {}
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim())
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

/**
 * 창 밖으로 나간 **모든 요소**. 빼는 것은 두 가지뿐이다 —
 * 크기가 0 인 것(숨은 것)과, 왼쪽으로 치워 둔 것(right ≤ 0. 닫힌 서랍).
 * 「구르는 통 안」이라고 봐주지 않는다 — 그 봐주기가 이 결함을 놓쳤다.
 */
const PROBE = `(() => {
  const W = window.innerWidth
  const out = []
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    if (r.right <= 0) continue
    if (r.right <= W + 0.5) continue
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\\s+/).slice(0, 2).join('.') : ''
    out.push({
      tag: el.tagName.toLowerCase() + (cls ? '.' + cls : ''),
      left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width),
      over: Math.round(r.right - W),
      text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 24),
    })
  }
  out.sort((a, b) => b.over - a.over)

  // 눈으로 보는 자리 셋 — 있으면 좌표를 함께 적는다.
  const spot = (label, sel) => {
    const el = document.querySelector(sel)
    if (!el) return { label, found: false }
    const r = el.getBoundingClientRect()
    return { label, found: true, left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), ok: r.right <= W + 0.5 }
  }
  return {
    W,
    doc: document.documentElement.scrollWidth,
    over: out.slice(0, 12),
    overCount: out.length,
    spots: [
      spot('좌 패널', '.side-panel'),
      spot('검색 카드', '.side-panel > div'),
      spot('업체 카드', '.side-panel .cust-card, .side-panel article, .side-panel [data-card]'),
    ],
  }
})()`

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
    const btn = page.getByRole('button', { name: '확인' }).first()
    if (await btn.isVisible().catch(() => false)) await btn.click().catch(() => {}); else break
    await page.waitForTimeout(200)
  }
}

;(async () => {
  const { webkit } = require(path.join(ROOT, 'node_modules/playwright-core'))
  let bad = 0
  for (const W of WIDTHS) {
    const browser = await webkit.launch()
    const ctx = await browser.newContext({
      viewport: { width: W, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    })
    const page = await ctx.newPage()
    try {
      await login(page)
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(9000)
      await dismissNotice(page)

      /**
       * 세 상태 — ① 목록 보기 ② 지도 보기 ③ 업체 하나를 고른 상태.
       *
       * ⚠ 보기는 **주소**로 바꾼다(?view=). 화면 아래 「업체 목록 | 지도」 탭은 폰 전용
       *   탭이라 「지도」를 누르면 좌 패널을 **감춘다**(mobile-hide) — 그러면 재려던
       *   그 패널이 없어진다. 지시가 말한 「지도 보기의 좌 패널」은 보기가 지도일 때
       *   목록 탭에 서는 그 패널이다(app/page.tsx 의 둘째 SidePanel).
       */
      const go = async url => {
        await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(8000)
        await dismissNotice(page)
      }
      const states = [
        ['목록 보기', () => go('/?view=list')],
        ['지도 보기', () => go('/?view=map')],
        ['업체 선택', () => go(`/?view=list&site=${SITE}`)],
      ]

      for (const [name, go] of states) {
        await go()
        const r = await page.evaluate(PROBE)
        const flag = r.overCount === 0 ? '정상' : '잘림'
        console.log(`\n══ ${W}px · ${name} ══  ${flag}  (창 ${r.W} · 문서 ${r.doc} · 넘친 요소 ${r.overCount}개)`)
        for (const s of r.spots) {
          console.log(s.found
            ? `   ${s.label.padEnd(7)} left ${String(s.left).padStart(4)} · right ${String(s.right).padStart(4)} · 폭 ${String(s.width).padStart(4)}  ${s.ok ? 'OK' : `← ${s.right - r.W}px 넘침`}`
            : `   ${s.label.padEnd(7)} (없다)`)
        }
        for (const o of r.over) {
          console.log(`   +${String(o.over).padStart(3)}px  ${o.tag}  left ${o.left} right ${o.right} 폭 ${o.width}  「${o.text}」`)
        }
        if (r.overCount > 0) bad++
        if (SHOTS) {
          fs.mkdirSync(SHOTS, { recursive: true })
          const file = `${name.replace(/\s/g, '')}-${W}${TAG ? '-' + TAG : ''}.png`
          await page.screenshot({ path: path.join(SHOTS, file) })
        }
      }
    } catch (e) {
      console.log(`\n══ ${W}px ══  오류 — ${e.message}`)
      bad++
    } finally {
      await browser.close()
    }
  }
  console.log(bad === 0 ? '\n걸린 화면 없음' : `\n${bad}건 걸림`)
  process.exit(bad === 0 ? 0 : 1)
})()
