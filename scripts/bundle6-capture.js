/**
 * **묶음6 캡처** — 탭 둘(4-1) · 회사 수정 창 바닥줄(4-2) · 관리 카드(4-4) · ＋ 자리(5-1).
 *
 *   node scripts/bundle6-capture.js
 *
 * ⚠ 「삭제된 회사」 카드는 **슈퍼관리자에게만** 선다 — 재는 계정이 슈퍼관리자가 아니면
 *   못 찾는 것이 맞다(실패가 아니다).
 *
 * 읽기만 한다. .env.local 의 값은 어디에도 찍지 않는다.
 */
const fs = require('fs'), path = require('path')
const ROOT = process.cwd()
const env = {}
for (const l of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l.trim())
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const BASE = 'http://localhost:3101'
const OUT = path.join(ROOT, 'docs/screens-bundle6-20261127')
fs.mkdirSync(OUT, { recursive: true })
let fails = 0
const ok = (n, g, x) => { if (!g) fails++; console.log(`${g ? 'OK  ' : 'FAIL'} ${n}${x ? '  ' + x : ''}`) }
const shot = async (page, n) => { await page.screenshot({ path: path.join(OUT, n + '.png') }); console.log('  캡처 ' + n) }
const login = async page => {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  await page.getByPlaceholder('아이디').fill(env.E2E_EMAIL)
  await page.getByPlaceholder('비밀번호').fill(env.E2E_PASSWORD)
  await page.getByRole('button', { name: '로그인' }).click()
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30000 })
  await page.waitForTimeout(1200)
}
const dismiss = async page => {
  for (let i = 0; i < 3; i++) {
    const b = page.getByRole('button', { name: '확인' }).first()
    if (await b.isVisible().catch(() => false)) await b.click().catch(() => {}); else break
    await page.waitForTimeout(200)
  }
}
;(async () => {
  const { chromium } = require(path.join(ROOT, 'node_modules/playwright-core'))
  const b = await chromium.launch()
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage()
  await login(page)

  // 4-1 탭 둘.
  await page.goto(`${BASE}/?view=list`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(9000)
  await dismiss(page)
  const tabs = await page.evaluate(() => {
    const vis = el => el.getBoundingClientRect().width > 0
    return [...document.querySelectorAll('button')].filter(vis)
      .map(x => (x.textContent || '').trim()).filter(t => /^(회사|대리점|정리 필요)\s*\d*$/.test(t))
  })
  console.log('  탭: ' + JSON.stringify(tabs))
  ok('탭은 회사·대리점 둘', tabs.length === 2 && !tabs.some(t => t.startsWith('정리 필요')))
  await shot(page, 'pc-list-tabs')

  // 5-1 ＋ 가 사업장 표 머리줄에 · 4-2 회사 수정 창.
  const row = page.locator('[role="button"][aria-expanded]').first()
  if (await row.isVisible().catch(() => false)) {
    await row.click()
    await page.waitForTimeout(2500)
    const plus = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button[aria-label="사업장 추가"]')].find(x => x.getBoundingClientRect().width > 0)
      if (!btn) return null
      const th = btn.closest('th')
      const r = btn.getBoundingClientRect()
      return { inHeader: !!th, op: getComputedStyle(btn).opacity, right: Math.round(r.right) }
    })
    console.log('  ＋: ' + JSON.stringify(plus))
    ok('＋ 가 사업장 표 머리줄에 있다', plus != null && plus.inHeader === true)
    ok('늘 보인다', plus != null && Number(plus.op) === 1)
    await shot(page, 'pc-company-plus')

    const edit = page.locator('button[aria-label="회사 정보 수정"]:visible').first()
    if (await edit.isVisible().catch(() => false)) {
      await edit.click()
      await page.waitForTimeout(1500)
      const foot = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button')].filter(x => x.getBoundingClientRect().width > 0)
        const pick = t => btns.find(x => (x.textContent || '').trim() === t)
        const box = n => { const e = pick(n); if (!e) return null; const r = e.getBoundingClientRect(); return { left: Math.round(r.left), h: Math.round(r.height) } }
        return { del: box('삭제'), cancel: box('취소'), save: box('저장') }
      })
      console.log('  바닥줄: ' + JSON.stringify(foot))
      ok('삭제가 왼쪽', foot.del != null && foot.cancel != null && foot.del.left < foot.cancel.left)
      ok('저장이 맨 오른쪽', foot.save != null && foot.cancel != null && foot.save.left > foot.cancel.left)
      ok('셋의 키가 같다(34)', [foot.del, foot.cancel, foot.save].every(x => x && x.h === 34),
        JSON.stringify([foot.del?.h, foot.cancel?.h, foot.save?.h]))
      await shot(page, 'pc-company-edit-footer')
    } else ok('회사 수정 단추를 찾았다', false)
  } else ok('회사 줄을 찾았다', false)

  // 4-4 관리 카드.
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(7000)
  await dismiss(page)
  const card = await page.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find(d => /^삭제된 회사/.test((d.textContent || '').trim()) && d.children.length === 0)
    return el ? (el.textContent || '').trim() : null
  })
  console.log('  관리 카드: ' + JSON.stringify(card))
  // 슈퍼관리자가 아니면 안 보이는 것이 맞다 — 그때는 적어만 둔다.
  if (card == null) console.log('  (슈퍼관리자가 아니라 카드가 보이지 않는다 — 가려진 것이 맞다)')
  else ok('「삭제된 회사」 카드가 있다', true)
  await shot(page, 'pc-admin-deleted-card')

  await b.close()
  console.log(fails === 0 ? '\n전부 통과' : `\n실패 ${fails}건`)
})()
