/**
 * **묶음2 B 실측** — 버그 넷을 눈이 아니라 수로 본다 (2026-11-26).
 *
 *   node scripts/bundle2-measure.js --stage=B1        # 사후 실적 모달 깜빡임
 *   node scripts/bundle2-measure.js --stage=B3        # 견적 작성 포커스 차례
 *   node scripts/bundle2-measure.js --stage=B4        # 쪽 번호 버튼 자리
 *   node scripts/bundle2-measure.js --stage=all --tag=before
 *
 * ── 왜 따로 있나 ──────────────────────────────────────────────────────────
 *   `npm run check` 의 하네스는 **키도 서버도 없이** 도는 것이 규칙이다. 이 측정은
 *   둘 다 필요하다 — 그래서 손으로 부르는 명령으로 둔다(scripts/ios-overflow.js 와
 *   같은 자리다). 파일 이름이 `-check.js` 가 아니라서 run-checks.js 가 줍지도 않는다.
 *
 * ── 운영 자료를 **쓰지 않는다** ──────────────────────────────────────────
 *   세 단계 모두 **읽기와 포커스**만 한다. 저장 단추를 누르지 않고, 줄을 만들지도
 *   지우지도 않는다. 견적 작성은 사명 칸에서 대리점을 **고르기만** 한다(견적 번호는
 *   저장할 때 비로소 나간다). 그래서 지울 것이 없고 장부도 없다.
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const arg = (name, dflt) => {
  const hit = process.argv.slice(2).find(a => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : dflt
}
const BASE = arg('base', 'http://localhost:3100')
const STAGE = arg('stage', 'all')
const TAG = arg('tag', '')
const SHOTS = arg('shots', '')

const env = {}
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim())
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const { chromium } = require(path.join(ROOT, 'node_modules/playwright-core'))

const log = (...a) => console.log(...a)
const head = t => log(`\n── ${t} ──`)

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'load' })
  await page.getByPlaceholder('아이디').fill(env.E2E_EMAIL)
  await page.getByPlaceholder('비밀번호').fill(env.E2E_PASSWORD)
  await page.getByRole('button', { name: '로그인' }).click()
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30000 })
}

/** 떠 있는 공지를 먼저 닫는다 — 안 닫으면 그 바탕이 클릭을 삼킨다. */
async function dismissNotice(page) {
  for (let i = 0; i < 3; i++) {
    const btn = page.getByRole('button', { name: '확인' }).first()
    if (await btn.isVisible().catch(() => false)) { await btn.click().catch(() => {}) } else break
    await page.waitForTimeout(150)
  }
}

// ── B1 — 사후 실적 모달 ─────────────────────────────────────────────────────
//
// 두 수를 센다.
//   ① **상자 크기가 바뀐 횟수** — 마우스를 모달 위에서 움직이며 20번 재고, 직전과
//     다른 크기가 나온 횟수를 센다. 「카드 크기 ↔ 전체 화면」 왕복이 곧 이 수다.
//   ② **모달이 DOM 에 다시 붙은 횟수** — MutationObserver 로 센다. 렌더 루프였다면
//     이 수가 1 보다 크다(= ModalCard 가 여러 번 마운트된다).
async function b1(page) {
  head('B1 사후 실적 모달')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3500)
  await dismissNotice(page)

  // 모달이 붙는 횟수를 세기 시작한다 — 렌더 루프였다면 1 보다 커진다.
  await page.evaluate(() => {
    const w = window
    w.__mounts = 0
    w.__obs = new MutationObserver(ms => {
      for (const m of ms) for (const n of m.addedNodes) {
        if (n.nodeType === 1 && (n.matches?.('.ems-modal-overlay') || n.querySelector?.('.ems-modal-overlay'))) w.__mounts++
      }
    })
    w.__obs.observe(document.body, { childList: true, subtree: true })
  })

  // ── ⓐ 기계 확인 — 카드 머리 안에 **바탕과 같은 상자**를 하나 넣어 재 본다 ──
  //
  // 「＋ 사후 실적」 단추는 슈퍼관리자에게만 선다. 실측 계정은 그 권한이 없어 창을
  // 직접 열 수 없다 — 그래서 **그 창이 들어가는 자리**(내 견적 카드의 머리)에 모달
  // 바탕과 똑같은 상자(position: fixed · inset: 0)를 꽂아 두고, 카드를 호버했을 때와
  // 아닐 때의 크기를 잰다. 호버에 따라 상자가 달라지면 그것이 곧 깜빡임의 정체다
  // (조상에 transform 이 걸리면 fixed 의 기준이 뷰포트에서 그 조상으로 바뀐다).
  const mech = await (async () => {
    const card = page.locator('section:has(> div > span:text-is("내 견적"))').first()
    if (!await card.isVisible().catch(() => false)) return { found: false }
    const vp = page.viewportSize()
    const measure = async () => page.evaluate(() => {
      const head = document.querySelector('[data-probe-head]')
      if (!head) return null
      let el = head.querySelector('[data-probe-box]')
      if (!el) {
        el = document.createElement('div')
        el.setAttribute('data-probe-box', '1')
        el.style.cssText = 'position:fixed;inset:0;pointer-events:none'
        head.appendChild(el)
      }
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(head.closest('section'))
      return { w: Math.round(r.width), h: Math.round(r.height), transform: cs.transform, overflow: cs.overflow }
    })
    // 카드 머리에 표식을 붙인다(머리가 headerRight 가 들어가는 그 줄이다).
    await page.evaluate(() => {
      const secs = [...document.querySelectorAll('section')]
      const card = secs.find(s => s.querySelector('span')?.textContent?.trim() === '내 견적')
      if (card) card.firstElementChild?.setAttribute('data-probe-head', '1')
    })
    await page.mouse.move(5, 5)
    await page.waitForTimeout(250)
    const off = await measure()
    await card.hover()
    await page.waitForTimeout(300)
    const on = await measure()
    await page.evaluate(() => { document.querySelector('[data-probe-box]')?.remove() })
    log(`ⓐ 카드 머리에 꽂은 「바탕과 같은 상자」 (창 ${vp.width}×${vp.height})`)
    log(`   호버 아님  ${off ? `${off.w}×${off.h}` : '못 재다'}  transform ${off?.transform} · overflow ${off?.overflow}`)
    log(`   호버 중    ${on ? `${on.w}×${on.h}` : '못 재다'}  transform ${on?.transform} · overflow ${on?.overflow}`)
    log(`   → 두 크기가 다르면 그만큼 모달이 왕복한다`)
    return { found: true, off, on, viewport: vp }
  })()

  const open = page.getByRole('button', { name: '＋ 사후 실적' })
  if (!await open.isVisible().catch(() => false)) {
    log('\nⓑ 실제 창 — 건너뜀. 「＋ 사후 실적」은 슈퍼관리자에게만 선다(실측 계정은 아니다).')
    log('   대신 **같은 공용 바탕**을 쓰는 창 하나로 부모를 본다 — 내 견적 카드를 누른다.')
    await page.locator('section:has(> div > span:text-is("내 견적"))').first().click()
    await page.waitForTimeout(1500)
    const info = await page.evaluate(() => {
      const el = document.querySelector('.ems-modal-overlay')
      if (!el) return null
      const p = el.parentElement
      return {
        parent: p === document.body ? 'body' : p.tagName + (p.className ? '.' + String(p.className).split(' ')[0] : ''),
        mounts: window.__mounts,
      }
    })
    log(`   모달 부모        ${info ? info.parent : '못 찾음'}`)
    log(`   모달이 붙은 횟수 ${info ? info.mounts : '-'}`)
    return { mech, overlayParent: info?.parent ?? null, mounts: info?.mounts ?? null, skippedReal: true }
  }

  await open.click()
  await page.waitForTimeout(1200)

  const card = await page.locator('.ems-modal-overlay').first().boundingBox().catch(() => null)
  if (!card) { log('FAIL — 모달이 열리지 않았다'); return { opened: false } }

  // 마우스를 모달 위에서 움직이며 크기를 20번 잰다.
  const sizes = []
  const vp = page.viewportSize()
  for (let i = 0; i < 20; i++) {
    await page.mouse.move(200 + (i % 4) * 180, 180 + ((i * 7) % 240))
    await page.waitForTimeout(60)
    const b = await page.locator('.ems-modal-overlay').first().boundingBox().catch(() => null)
    sizes.push(b ? `${Math.round(b.width)}x${Math.round(b.height)}` : 'none')
  }
  let changes = 0
  for (let i = 1; i < sizes.length; i++) if (sizes[i] !== sizes[i - 1]) changes++
  const mounts = await page.evaluate(() => window.__mounts)
  const parent = await page.evaluate(() => {
    const el = document.querySelector('.ems-modal-overlay')
    return el ? (el.parentElement === document.body ? 'body' : el.parentElement.tagName + (el.parentElement.className ? '.' + String(el.parentElement.className).split(' ')[0] : '')) : null
  })

  log(`창 ${vp.width}×${vp.height}`)
  log(`모달 부모          ${parent}`)
  log(`모달이 붙은 횟수   ${mounts}  (렌더 루프였다면 1 보다 크다)`)
  log(`상자 크기 바뀜     ${changes}회 / 20번 (0 이어야 한다)`)
  log(`본 크기들          ${[...new Set(sizes)].join(' · ')}`)
  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true })
    await page.screenshot({ path: path.join(SHOTS, `b1-backfill${TAG ? '-' + TAG : ''}.png`) })
  }
  return { mounts, changes, sizes: [...new Set(sizes)], parent }
}

// ── B2 — 활동 현황의 A/S ────────────────────────────────────────────────────
//
// 'A/S' 는 **두 곳**에서 온다 — 서비스 레포트(service_history.service_type)와 영업활동
// (sales_activities.activity_type. 20 수리의 수리 완료가 자동으로 남긴다). 카드에
// 「A/S」 줄이 **몇 개** 서는지, 그 수가 두 출처의 합인지를 눈이 아니라 수로 본다.
async function b2(page) {
  head('B2 활동 현황 — A/S 이중 출처')
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto(`${BASE}/activity`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(6000)
  await dismissNotice(page)

  const got = await page.evaluate(() => {
    // 사람 카드 하나 = ActivityCard 의 뿌리. 그 뿌리는 **호버 전환**을 인라인으로 들고 있다.
    const cards = [...document.querySelectorAll('div')].filter(d => {
      const cs = getComputedStyle(d)
      return cs.transitionProperty.includes('border-color') && cs.transitionProperty.includes('transform')
        && d.querySelector('span')
    })
    const per = cards.map(c => {
      const rows = [...c.querySelectorAll('span')].map(s => s.textContent.trim())
      const i = rows.indexOf('A/S')
      return {
        // 이름은 span 이 아니라 div 에 있다(카드 머리) — 그 글자를 바로 집는다.
        name: c.querySelector('div > div')?.textContent?.trim()?.slice(0, 12) ?? '?',
        as: rows.filter(t => t === 'A/S').length,
        // 그 줄 바로 뒤의 숫자가 건수다(점 · 이름 · 건수 순).
        count: i >= 0 ? (rows.slice(i + 1).find(t => /^\d+$/.test(t)) ?? null) : null,
      }
    })
    return {
      cards: cards.length,
      withAs: per.filter(p => p.as > 0).length,
      maxPerCard: per.reduce((m, p) => Math.max(m, p.as), 0),
      rows: per.filter(p => p.as > 0).slice(0, 6),
    }
  })
  log(`사람 카드 ${got.cards}개 · 그중 A/S 줄이 있는 카드 ${got.withAs}개`)
  log(`한 카드 안의 「A/S」 줄 최대  ${got.maxPerCard}개   ← 1 이어야 한다(두 출처가 한 줄로 합산)`)
  for (const r of got.rows) log(`   ${r.name} — A/S ${r.count}건`)
  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true })
    await page.screenshot({ path: path.join(SHOTS, `b2-activity${TAG ? '-' + TAG : ''}.png`), fullPage: false })
  }
  return got
}

// ── B3 — 견적 작성 포커스 차례 ──────────────────────────────────────────────
async function b3(page) {
  head('B3 견적 작성 포커스 — 대리점 → E.U')
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto(`${BASE}/quote`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3500)
  await dismissNotice(page)

  // 분류·양식을 먼저 고른다(그 전에는 사명 아래가 잠겨 있다).
  const sels = page.locator('select')
  const n = await sels.count()
  for (let i = 0; i < Math.min(n, 4); i++) {
    const opts = await sels.nth(i).locator('option').allTextContents().catch(() => [])
    if (opts.length > 1) await sels.nth(i).selectOption({ index: 1 }).catch(() => {})
  }
  await page.waitForTimeout(800)

  const box = page.getByPlaceholder('업체·대리점 검색 (사전 등록 필요)')
  if (!await box.isVisible().catch(() => false)) {
    log('건너뜀 — 사명 칸이 잠겨 있다(분류·양식을 고르지 못했다)')
    return { skipped: true }
  }

  /** 두 길을 따로 잰다 — 마우스로 고르는 길과 **키보드(↓·Enter)** 로 고르는 길. */
  const WAY = arg('way', 'click')
  // 대리점 줄이 나오는 글자를 넣는다. 「대리점」 꼬리표가 붙은 줄을 고른다.
  const out = { way: WAY }
  for (const q of ['한', '대', '이', '테']) {
    await box.fill('')
    await box.type(q, { delay: 60 })
    await page.waitForTimeout(1200)
    const dealer = page.locator('div:has(> div > span:text-is("대리점"))')
    const cnt = await dealer.count().catch(() => 0)
    if (cnt === 0) continue
    if (WAY === 'keys') {
      // 키보드로 고른다 — 「대리점」 줄이 몇 번째인지 세어 그만큼 ↓ 를 누른 뒤 Enter.
      const idx = await page.evaluate(() => {
        const list = document.querySelectorAll('div[style*="position: absolute"] > div')
        for (let i = 0; i < list.length; i++) {
          if ([...list[i].querySelectorAll('span')].some(s => s.textContent.trim() === '대리점')) return i
        }
        return -1
      })
      out.rowIndex = idx
      for (let k = 0; k <= Math.max(0, idx); k++) await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Enter')
    } else {
      await dealer.first().click()
    }
    await page.waitForTimeout(1500)
    const info = await page.evaluate(() => {
      const el = document.activeElement
      const eu = document.querySelector('input[placeholder*="최종 사용 업체"]')
      return {
        active: el ? `${el.tagName.toLowerCase()}${el.getAttribute('placeholder') ? `[${el.getAttribute('placeholder')}]` : ''}${el.className ? '.' + String(el.className).split(' ')[0] : ''}` : 'none',
        euExists: !!eu,
        euFocused: !!eu && document.activeElement === eu,
        euDisabled: eu ? eu.disabled : null,
      }
    })
    out.query = q
    Object.assign(out, info)
    break
  }
  if (!out.query) { log('건너뜀 — 검색에서 대리점 줄을 찾지 못했다'); return { skipped: true } }
  log(`고르는 길          ${WAY === 'keys' ? '키보드(↓·Enter)' : '마우스 클릭'} · 검색어 "${out.query}"`)
  log(`① 사명(대리점) → E.U`)
  log(`   E.U 칸이 생겼나 ${out.euExists} · 커서 ${out.active}`)
  log(`   E.U 칸에 커서   ${out.euFocused}   ← 참이어야 한다`)

  // ── ② E.U → 수신인 (드롭다운이 **열리기까지** 본다) ──────────────────────
  //
  // 커서가 어디로 갔는지만 보면 「누가 보냈나」를 알 수 없다 — focusin 을 차례대로 적어
  // 둔다(어느 칸으로, 몇 ms 에). 그 줄이 곧 범인을 가리킨다.
  await page.evaluate(() => {
    const w = window
    w.__focus = []
    w.__t0 = performance.now()
    const note = (el, how) => {
      w.__focus.push({
        at: Math.round(performance.now() - w.__t0),
        how,
        tag: el.tagName?.toLowerCase?.() ?? '?',
        ph: el.getAttribute?.('placeholder') ?? null,
        box: el.closest?.('.q-box')?.querySelector('.q-box-label')?.textContent ?? null,
        // 누가 불렀나 — 앱 코드 줄만 남긴다(playwright·브라우저 내부는 뺀다).
        from: how === 'focus()' ? (new Error().stack ?? '').split('\n').slice(2, 6)
          .map(l => l.trim().replace(/^at\s+/, '').replace(/\?.*$/, '')).join(' ← ') : null,
      })
    }
    document.addEventListener('focusin', e => note(e.target, 'focusin'), true)
    const orig = HTMLElement.prototype.focus
    HTMLElement.prototype.focus = function (...a) { note(this, 'focus()'); return orig.apply(this, a) }
  })
  const eu = page.getByPlaceholder('최종 사용 업체 검색 (사전 등록 필요)')
  for (const q of ['한', '이', '삼', '대']) {
    await eu.fill('')
    await eu.type(q, { delay: 60 })
    await page.waitForTimeout(1200)
    const rows = page.locator('div[style*="position: absolute"] > div').filter({ hasText: /./ })
    if (await rows.count().catch(() => 0) === 0) continue
    await rows.first().click().catch(() => {})
    await page.waitForTimeout(1800)
    break
  }
  const step2 = await page.evaluate(() => {
    const el = document.activeElement
    // 수신인 칸은 **라벨이 「수신인」인 상자 안의 select** 다 — 다른 상자의 select 를
    // 잘못 집으면 「담당자 N명」이 엉뚱한 수가 되어 측정이 거짓말을 한다(2026-11-26).
    const box = [...document.querySelectorAll('.q-box')]
      .find(b => b.querySelector('.q-box-label')?.textContent?.trim() === '수신인')
    const rcp = box ? box.querySelector('select') : null
    return {
      recipientValue: rcp ? rcp.value : null,
      recipientText: rcp && rcp.selectedIndex >= 0 ? rcp.options[rcp.selectedIndex].textContent.trim() : null,
      active: el ? `${el.tagName.toLowerCase()}${el.getAttribute?.('placeholder') ? `[${el.getAttribute('placeholder')}]` : ''}${el.className ? '.' + String(el.className).split(' ')[0] : ''}` : 'none',
      activeBox: el ? (el.closest('.q-box')?.querySelector('.q-box-label')?.textContent ?? '(상자 밖)') : null,
      contactsCount: rcp ? [...rcp.options].filter(o => o.value !== '').length : null,
      recipientFocused: !!rcp && document.activeElement === rcp,
      recipientDisabled: rcp ? rcp.disabled : null,
      recipientOptions: rcp ? rcp.options.length : null,
    }
  })
  const trail = await page.evaluate(() => window.__focus)
  Object.assign(out, { step2, trail })
  log(`② E.U → 수신인`)
  log(`   커서가 지난 길`)
  for (const f of (trail ?? [])) log(`     ${String(f.at).padStart(5)}ms ${f.how.padEnd(8)} ${f.box ? `「${f.box}」` : f.ph ? `[${f.ph}]` : f.tag}${f.from ? `
              ← ${f.from}` : ''}`)
  if ((trail ?? []).length === 0) log('     (없다)')
  log(`   수신인 칸 잠김  ${step2.recipientDisabled} · 후보 ${step2.contactsCount}명 · 고른 값 ${step2.recipientValue || "(없음)"} 「${step2.recipientText ?? ""}」`)
  log(`   커서            ${step2.active} (상자 「${step2.activeBox}」)`)
  // 후보가 **한 사람뿐이면** 고를 것이 없다 — 설계대로 저절로 채우고 가격표로 간다.
  log(step2.contactsCount === 1
    ? `   수신인에 커서   건너뜀 — 후보가 한 사람이라 저절로 채운다(설계대로). 값이 들어갔나 ${!!step2.recipientValue}`
    : `   수신인에 커서   ${step2.recipientFocused}   ← 참이어야 한다`)

  // ── ③ 수신인 → 가격표 검색 ───────────────────────────────────────────────
  const picked = await page.evaluate(() => {
    const sels = [...document.querySelectorAll('select')]
    const rcp = sels.find(s => s.closest('.q-box') && s.options.length > 1
      && [...s.options].some(o => /담당자|수신인|선택/.test(o.textContent)))
    if (!rcp || rcp.disabled || rcp.options.length < 2) return false
    rcp.value = rcp.options[1].value
    rcp.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })
  await page.waitForTimeout(1800)
  const step3 = await page.evaluate(() => {
    const el = document.activeElement
    return {
      active: el ? `${el.tagName.toLowerCase()}${el.getAttribute('placeholder') ? `[${el.getAttribute('placeholder')}]` : ''}` : 'none',
    }
  })
  Object.assign(out, { recipientPicked: picked, step3 })
  log(`③ 수신인 → 가격표 검색`)
  log(`   수신인을 골랐나 ${picked} · 커서 ${step3.active}`)
  log(`   가격표 칸에 커서 ${/품번|품명|가격|검색/.test(step3.active)}   ← 참이어야 한다`)

  // ── ④ 직판(대리점 아님) — 사명 → **수신인**(E.U 칸이 없는 길) ────────────
  //
  // 위 ②는 후보가 한 사람인 쌍이 걸리면 설계대로 건너뛴다. 「수신인으로 간다」 자체는
  // 직판으로 재는 편이 확실하다 — 사명 다음이 곧 수신인이다(nextFocusStep).
  const step4 = await (async () => {
    await page.goto(`${BASE}/quote`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3000)
    await dismissNotice(page)
    const s2 = page.locator('select')
    for (let i = 0; i < Math.min(await s2.count(), 4); i++) {
      if ((await s2.nth(i).locator('option').count().catch(() => 0)) > 1) await s2.nth(i).selectOption({ index: 1 }).catch(() => {})
    }
    await page.waitForTimeout(700)
    const b2 = page.getByPlaceholder('업체·대리점 검색 (사전 등록 필요)')
    if (!await b2.isVisible().catch(() => false)) return { skipped: '사명 칸이 잠겼다' }
    let last = null
    for (const q of ['한', '이', '대', '삼', '현', '신', '동']) {
      await b2.fill('')
      await b2.type(q, { delay: 60 })
      await page.waitForTimeout(1200)
      // 「대리점」 꼬리표가 **없는** 줄을 고른다.
      const idx = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('div[style*="position: absolute"] > div')]
        for (let i = 0; i < rows.length; i++) {
          if (![...rows[i].querySelectorAll('span')].some(s => s.textContent.trim() === '대리점')) return i
        }
        return -1
      })
      if (idx < 0) continue
      await page.locator('div[style*="position: absolute"] > div').nth(idx).click().catch(() => {})
      await page.waitForTimeout(1800)
      const got = await page.evaluate(() => {
        const box = [...document.querySelectorAll('.q-box')]
          .find(b => b.querySelector('.q-box-label')?.textContent?.trim() === '수신인')
        const rcp = box ? box.querySelector('select') : null
        const el = document.activeElement
        return {
          query: null,
          euBox: !![...document.querySelectorAll('.q-box-label')].find(l => l.textContent.trim() === 'E.U'),
          contacts: rcp ? [...rcp.options].filter(o => o.value !== '').length : null,
          focused: !!rcp && el === rcp,
          value: rcp ? rcp.value : null,
          active: el ? `${el.tagName.toLowerCase()}${el.getAttribute?.('placeholder') ? `[${el.getAttribute('placeholder')}]` : ''}` : 'none',
        }
      })
      got.query = q
      last = got
      // 후보가 **둘 이상**인 업체를 찾을 때까지 다음 글자로 넘어간다 — 한 사람이거나
      // 아무도 없으면 수신인으로 커서가 가지 않는 것이 **설계대로**라(한 사람은 저절로
      // 채우고, 없으면 칸이 잠긴다) 그 경우로는 「수신인으로 간다」를 확인할 수 없다.
      if ((got.contacts ?? 0) >= 2) return got
      // 다음 후보를 보려면 고른 업체를 먼저 비운다(× 단추).
      await page.evaluate(() => {
        const box = [...document.querySelectorAll('.q-box')]
          .find(b => b.querySelector('.q-box-label')?.textContent?.trim() === '사명')
        box?.querySelector('.q-box-tail button')?.click()
      })
      await page.waitForTimeout(600)
    }
    return last ?? { skipped: '직판 줄을 찾지 못했다' }
  })()
  Object.assign(out, { step4 })
  log(`④ 직판 — 사명 → 수신인`)
  if (step4.skipped) log(`   건너뜀 — ${step4.skipped}`)
  else {
    log(`   E.U 칸이 섰나  ${step4.euBox}  ← 직판이면 거짓이어야 한다`)
    log(`   후보 ${step4.contacts}명 · 커서 ${step4.active} · 고른 값 ${step4.value || '(없음)'}`)
    log(step4.contacts === 1
      ? `   수신인에 커서   건너뜀 — 후보가 한 사람이라 저절로 채운다(설계대로)`
      : step4.contacts === 0
        ? `   수신인에 커서   건너뜀 — 등록된 담당자가 없어 칸이 잠겨 있다(잠긴 칸은 빼앗지 않는다)`
        : `   수신인에 커서   ${step4.focused}   ← 참이어야 한다`)
  }
  return out
}

// ── B4 — 쪽 번호 버튼 ───────────────────────────────────────────────────────
//
// 글리프 상자와 버튼 상자를 함께 재서 **가로·세로로 얼마나 비껴 있나**를 px 로 적는다.
async function b4(page) {
  head('B4 쪽 번호 버튼')
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto(`${BASE}/purchase`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)
  await dismissNotice(page)

  const got = await page.evaluate(() => {
    const bar = document.querySelector('.ems-pager')
    if (!bar) return { bar: false }
    const btns = [...bar.querySelectorAll('button')].filter(b => /^\d+$/.test(b.textContent.trim()))
    if (btns.length === 0) return { bar: true, numbers: 0 }
    const out = btns.slice(0, 3).map(b => {
      const r = b.getBoundingClientRect()
      const range = document.createRange()
      range.selectNodeContents(b)
      const g = range.getBoundingClientRect()
      const cs = getComputedStyle(b)
      return {
        text: b.textContent.trim(),
        btn: { w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
        glyph: { w: +g.width.toFixed(1), h: +g.height.toFixed(1) },
        dx: +((g.left - r.left) - (r.right - g.right)).toFixed(2),
        dy: +((g.top - r.top) - (r.bottom - g.bottom)).toFixed(2),
        display: cs.display, align: cs.textAlign, line: cs.lineHeight, box: cs.boxSizing,
      }
    })
    const group = bar.querySelector('div')
    const gr = group ? group.getBoundingClientRect() : null
    const br = bar.getBoundingClientRect()
    return {
      bar: true, numbers: btns.length, out,
      groupLeftGap: gr ? +(gr.left - br.left).toFixed(1) : null,
      groupRightGap: gr ? +(br.right - gr.right).toFixed(1) : null,
    }
  })

  if (!got.bar) { log('건너뜀 — 쪽 줄(.ems-pager)이 없다'); return { skipped: true } }
  if (!got.numbers) { log(`쪽 줄은 있는데 번호 버튼이 없다(한 쪽뿐이다)`); return got }
  log(`번호 버튼 ${got.numbers}개`)
  for (const o of got.out) {
    log(`  「${o.text}」 버튼 ${o.btn.w}×${o.btn.h} · 글자 ${o.glyph.w}×${o.glyph.h}`
      + ` · 가로 치우침 ${o.dx}px · 세로 치우침 ${o.dy}px · display ${o.display} · box ${o.box}`)
  }
  log(`번호 묶음 — 왼쪽 여백 ${got.groupLeftGap}px · 오른쪽 여백 ${got.groupRightGap}px`)
  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true })
    const bar = page.locator('.ems-pager').first()
    await bar.screenshot({ path: path.join(SHOTS, `b4-pager${TAG ? '-' + TAG : ''}.png`) }).catch(() => {})
  }
  return got
}

;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const errs = []
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)) })
  const result = {}
  try {
    await login(page)
    if (STAGE === 'all' || STAGE === 'B1') result.B1 = await b1(page)
    if (STAGE === 'all' || STAGE === 'B2') result.B2 = await b2(page)
    if (STAGE === 'all' || STAGE === 'B3') result.B3 = await b3(page)
    if (STAGE === 'all' || STAGE === 'B4') result.B4 = await b4(page)
  } catch (e) {
    log('\n오류 —', e.message)
  } finally {
    head('콘솔 오류')
    log(errs.length === 0 ? '0건' : errs.slice(0, 8).join('\n'))
    await browser.close()
  }
  if (TAG) {
    const out = path.join(ROOT, 'docs', `bundle2-b-${TAG}.json`)
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, JSON.stringify(result, null, 2))
    log(`\n적었다 — ${out}`)
  }
})()
