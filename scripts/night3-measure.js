/**
 * **야간 3부 실측** (2026-11-27). 절마다 한 단계씩.
 *
 *   node scripts/night3-measure.js --stage=0     # 칸반 카드 — 띠·차례·흐림
 *   node scripts/night3-measure.js --stage=1     # 실적 현황 — 1366×768 스크롤·수치
 *   node scripts/night3-measure.js --stage=8a    # 전 화면 콘솔 오류
 *   node scripts/night3-measure.js --stage=8c    # 화면별 Supabase 요청 수
 *
 * ── 규칙 ────────────────────────────────────────────────────────────────────
 *   읽기만 한다. 줄을 만들지도 지우지도 않는다(만드는 절은 따로 적는다).
 *   .env.local 의 값은 어디에도 찍지 않는다.
 *   이 파일은 `-check.js` 가 아니라 scripts/run-checks.js 가 줍지 않는다(서버·키가 필요하다).
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const arg = (name, dflt) => {
  const hit = process.argv.slice(2).find(a => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : dflt
}
const BASE = arg('base', 'http://localhost:3100')
const STAGE = arg('stage', '0')
const SHOTS = arg('shots', '')
const TAG = arg('tag', '')

const env = {}
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim())
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

let fails = 0
const ok = (name, cond, hint) => {
  if (!cond) fails++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond || !hint ? '' : `  — ${hint}`}`)
}
const say = (n, v) => console.log(`··   ${n}: ${v}`)
const head = t => console.log(`\n── ${t} ──`)

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
const shot = async (page, name, clip) => {
  if (!SHOTS) return
  fs.mkdirSync(path.join(ROOT, SHOTS), { recursive: true })
  await page.screenshot({ path: path.join(ROOT, SHOTS, `${name}${TAG ? '-' + TAG : ''}.png`), ...(clip ? { clip } : {}) }).catch(() => {})
}

// ── 0. 칸반 카드 ────────────────────────────────────────────────────────────
async function stage0(page) {
  head('0. 칸반 카드 — 흐림 제거 · 이번 달 마감 띠 · 열 안 차례')
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto(`${BASE}/pipeline`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(8000)
  await dismissNotice(page)

  const r = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.pl-card')]
    const txt = el => (el.textContent ?? '').replace(/\s+/g, ' ')
    const dueCards = cards.filter(c => txt(c).includes('이번 달 마감'))
    const dim = cards.filter(c => Number(getComputedStyle(c).opacity) < 1)
    // 머리 띠의 「이번 달 마감 N건」
    const band = (document.body.textContent ?? '').replace(/\s+/g, ' ')
    const n = Number((band.match(/이번 달 마감 (\d+)건/) ?? [])[1] ?? -1)
    // 빨간 「N일 전」 글자
    const redIdle = cards.filter(c => [...c.querySelectorAll('span')]
      .some(s => /(\d+일 전|활동 없음)/.test(s.textContent ?? '')
        && getComputedStyle(s).color === 'rgb(185, 28, 28)')).length
    // 열 안 차례 — **열마다 따로** 본다(DOM 차례는 열을 가로질러 흐른다).
    const rankOf = c => {
      if (txt(c).includes('이번 달 마감')) return 0
      return c.querySelector('svg path[d^="M10.3"]') ? 1 : 2
    }
    const cols = new Map()
    for (const c of cards) {
      const owner = c.closest('div[style*="overflow"]') ?? c.parentElement
      if (!cols.has(owner)) cols.set(owner, [])
      cols.get(owner).push(rankOf(c))
    }
    const order = [...cols.values()]
    return { cards: cards.length, due: dueCards.length, dim: dim.length, bandN: n, redIdle, order }
  })

  say('카드 수', r.cards)
  ok('흐린 카드가 없다(0-1)', r.dim === 0, `${r.dim}장이 아직 흐리다`)
  say('「N일 전」이 빨간 카드', `${r.redIdle}장`)
  say('머리 띠 「이번 달 마감」', `${r.bandN}건`)
  say('노란 띠가 선 카드', `${r.due}장`)
  ok('머리 띠의 수와 띠 달린 카드 수가 같다(0-3)', r.bandN === r.due,
    `띠 ${r.bandN}건 ≠ 카드 ${r.due}장`)
  const sorted = r.order.every(col => col.every((v, i) => i === 0 || col[i - 1] <= v))
  say('열별 등급', r.order.map(c => c.join('')).join(' | '))
  ok('열마다 차례가 등급 순이다(이번 달 마감 → 지난 할 일 → 나머지)', sorted)
  await shot(page, 'night3-0-kanban')
  return r
}

;(async () => {
  const { chromium } = require(path.join(ROOT, 'node_modules/playwright-core'))
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await ctx.newPage()
  const errs = []
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)) })
  try {
    await login(page)
    if (STAGE === '0') await stage0(page)
  } catch (e) {
    console.log('\n오류 —', e.message)
    fails++
  } finally {
    head('콘솔 오류')
    console.log(errs.length === 0 ? '0건' : errs.slice(0, 8).join('\n'))
    await browser.close()
  }
  console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
  process.exit(fails === 0 ? 0 : 1)
})()
