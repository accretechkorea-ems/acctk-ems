// 밤 작업 2부 — **읽기 전용 실측** (2026-11-26).
//
//   NEXT_DIST_DIR=.next-perf npx next start -p 3100
//   node scripts/night2-measure.js
//
// ── 무엇을 재는가 ───────────────────────────────────────────────────────────
//   이번 회차에 바뀐 화면을 1440 과 390 에서 열어 **보이는가 · 넘치는가 · 콘솔이
//   깨지는가**를 본다. 캡처는 docs/screens-20261126/ 에 남긴다.
//
// ── 쓰지 않는다 ─────────────────────────────────────────────────────────────
//   주소 이동과 **창 열기·ESC** 뿐이다. 저장·등록·삭제 같은 글자는 누르지 않는다
//   (아래 BANNED 가 한 번 더 막는다). 줄을 만들지 않으므로 뒷정리도 없다.
//   ⚠ tasks · lost_reasons · devices_delivery SQL 이 아직 적용되지 않아 **쓰기 길은
//     애초에 막혀 있다**(할 일 담기·실주 사유·납품 예정 장비). 그 셋은 적용 뒤에 잰다.
//
// ── 비밀 ────────────────────────────────────────────────────────────────────
//   .env.local 의 E2E_EMAIL / E2E_PASSWORD 를 쓴다. 값은 **어디에도 찍지 않는다**.

const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const BASE = process.env.PERF_URL ?? 'http://localhost:3100'
const OUT = path.join(ROOT, 'docs/screens-20261126')

// 누르는 걸음이 **없다** — 주소 이동과 캡처뿐이다. 그래서 금지어 목록도 두지 않는다
// (누르는 실측은 scripts/perf/measure.ts 가 제 목록으로 한다).

const env = (() => {
  const out = {}
  const p = path.join(ROOT, '.env.local')
  if (!fs.existsSync(p)) return out
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
})()

/** 화면 — 라벨 · 경로 · 열어 볼 창(글자로 누른다). */
const SCREENS = [
  { label: '홈 「내 오늘」', path: '/dashboard', expect: '할 일' },
  { label: '포캐스트 칸반', path: '/pipeline', expect: '포캐스트' },
  { label: '발주 목록', path: '/purchase', expect: '발주' },
  { label: '실적 현황', path: '/sales', expect: '실적' },
  { label: '활동 현황', path: '/activity', expect: '활동' },
  { label: '고객사', path: '/', expect: '' },
  { label: '리드', path: '/leads', expect: '리드' },
  { label: '견적서', path: '/quote', expect: '견적' },
  { label: '의뢰서', path: '/inquiries', expect: '의뢰' },
  { label: '쇼룸', path: '/showroom', expect: '쇼룸' },
  { label: '관리', path: '/admin', expect: '관리' },
  { label: '건의사항', path: '/suggestions', expect: '건의' },
]

const VIEWS = [
  { name: 'pc', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
]

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function main() {
  if (!env.E2E_EMAIL || !env.E2E_PASSWORD) {
    console.error('.env.local 에 E2E_EMAIL / E2E_PASSWORD 가 없다 — 실측을 건너뛴다')
    process.exit(2)
  }
  const alive = await fetch(BASE + '/login').then(r => r.ok).catch(() => false)
  if (!alive) {
    console.error(`서버가 없다: ${BASE}`)
    console.error('  NEXT_DIST_DIR=.next-perf npx next build && NEXT_DIST_DIR=.next-perf npx next start -p 3100')
    process.exit(2)
  }
  fs.mkdirSync(OUT, { recursive: true })

  const browser = await chromium.launch()
  const rows = []
  for (const view of VIEWS) {
    const ctx = await browser.newContext({ viewport: { width: view.width, height: view.height } })
    const page = await ctx.newPage()
    const errors = []
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)) })
    page.on('pageerror', e => errors.push(String(e).slice(0, 160)))

    // 로그인 — 값은 찍지 않는다. 칸은 **자리글**로 집는다(scripts/perf/login.ts 와 같은 방식).
    // 수화 전에 넣으면 React 상태가 비어 누르는 것이 아무 일도 하지 않는다 — 세 번까지 다시 넣는다.
    let ready = false
    for (let attempt = 1; attempt <= 3 && !ready; attempt++) {
      await page.goto(BASE + '/login', { waitUntil: 'load' })
      await sleep(700 * attempt)
      const id = page.getByPlaceholder('아이디')
      const pw = page.getByPlaceholder('비밀번호')
      await id.fill(env.E2E_EMAIL)
      await pw.fill(env.E2E_PASSWORD)
      ready = !!(await id.inputValue()) && !!(await pw.inputValue())
    }
    await page.getByRole('button', { name: /로그인/ }).click()
    await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30000 }).catch(() => {})
    console.log(`[${view.name}] 로그인 ${page.url().includes('/login') ? '실패' : '됨'}`)

    for (const s of SCREENS) {
      const before = errors.length
      const t0 = Date.now()
      await page.goto(BASE + s.path, { waitUntil: 'load' }).catch(() => {})
      await sleep(1400)
      const ms = Date.now() - t0
      const over = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth,
        win: window.innerWidth,
        // 가로로 넘치는 **자리**까지 집어 준다(화면 폭을 넘는 가장 넓은 것 다섯).
        worst: [...document.querySelectorAll('*')]
          .map(el => ({ w: Math.round(el.getBoundingClientRect().width), tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().slice(0, 30) }))
          .filter(x => x.w > window.innerWidth + 1)
          .sort((a, b) => b.w - a.w).slice(0, 5),
      }))
      const shot = `${s.path === '/' ? 'customers' : s.path.replace(/\//g, '-').replace(/^-/, '')}-${view.name}.png`
      await page.screenshot({ path: path.join(OUT, shot) }).catch(() => {})
      rows.push({
        view: view.name, label: s.label, path: s.path, ms,
        overflow: Math.max(0, over.doc - over.win),
        worst: over.worst,
        errors: errors.slice(before),
        shot,
      })
      console.log(`[${view.name}] ${s.label} ${ms}ms · 넘침 ${Math.max(0, over.doc - over.win)}px · 콘솔 ${errors.length - before}건`)
    }
    await ctx.close()
  }
  await browser.close()

  // ── 보고용 표 ──
  const md = []
  md.push('# 밤 작업 2부 실측 — 읽기 전용 (2026-11-26)')
  md.push('')
  md.push('`node scripts/night2-measure.js` · 운영 빌드(next start, :3100) · Playwright chromium.')
  md.push('줄을 만들지 않았다(주소 이동과 창 열기·ESC 만). 그래서 뒷정리도 없다.')
  md.push('')
  for (const view of VIEWS) {
    md.push(`## ${view.name === 'pc' ? `PC ${view.width}×${view.height}` : `폰 ${view.width}×${view.height}`}`)
    md.push('')
    md.push('| 화면 | 열림 | 가로 넘침 | 콘솔 오류 | 캡처 |')
    md.push('|---|---|---|---|---|')
    for (const r of rows.filter(r => r.view === view.name)) {
      md.push(`| ${r.label} | ${r.ms}ms | ${r.overflow === 0 ? '0' : `**${r.overflow}px**`} | ${r.errors.length === 0 ? '0' : `**${r.errors.length}**`} | \`${r.shot}\` |`)
    }
    md.push('')
  }
  const bad = rows.filter(r => r.overflow > 0 || r.errors.length > 0)
  md.push('## 걸린 것')
  md.push('')
  if (bad.length === 0) md.push('없다 — 넘침 0 · 콘솔 오류 0.')
  else for (const r of bad) {
    md.push(`### ${r.label} (${r.view})`)
    if (r.overflow > 0) md.push(`- 가로 넘침 **${r.overflow}px** — 넓은 것: ${r.worst.map(w => `${w.tag}.${w.cls}=${w.w}`).join(' · ')}`)
    for (const e of r.errors) md.push(`- 콘솔: \`${e}\``)
    md.push('')
  }
  fs.writeFileSync(path.join(ROOT, 'docs/night2-measure-20261126.md'), md.join('\n') + '\n')
  console.log('\n→ docs/night2-measure-20261126.md')
}

main().catch(e => { console.error(e); process.exit(1) })
