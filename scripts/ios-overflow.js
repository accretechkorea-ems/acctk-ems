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
/** 캡처를 남길 자리. `--shots=` 로 비우면 찍지 않는다(기본은 찍지 않는다 — 부를 때 고른다). */
const SHOTS = arg('shots', '')

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
    // ── 앱바 (2026-11-26) ──────────────────────────────────────────────
    //   f207d63 이 폰 규칙만 머리 스타일시트로 옮기고 PC 기본값(display:none)을 본문
    //   <style> 에 남겨, 뒤에 오는 본문이 이겨 **모든 폭에서 앱바가 사라졌다**.
    //   눈으로 보이는가를 직접 센다 — 규칙을 읽는 것으로는 캐스케이드를 알 수 없다.
    앱바: (() => {
      const el = document.querySelector('.ems-topbar')
      if (!el) return '없다(마크업)'
      const cs = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      return `display=${cs.display} 높이=${Math.round(r.height)} 보임=${cs.display !== 'none' && r.height > 0}`
    })(),
    // ── 하단 흰 공백 ──────────────────────────────────────────────────
    //   문서가 보이는 높이보다 길면서 **내용이 그만큼 없으면** 아래가 빈다.
    //   내용 끝(body 안에서 가장 아래에 있는 것)과 문서 끝의 차이를 적는다.
    //   ⚠ **떠 있는 것 안의 것은 세지 않는다.** fixed 요소 자신뿐 아니라 그 **자손**도
    //     빼야 한다 — 모달이 열려 있으면 .ems-modal-card(static)가 「가장 아래 내용」으로
    //     잡혀, 뒤 화면이 짧은 것을 공백으로 잘못 읽는다(2026-11-26 에 /cards 가 그랬다).
    하단공백: (() => {
      const floating = el => {
        for (let a = el; a && a !== document.body; a = a.parentElement) {
          if (getComputedStyle(a).position === 'fixed') return true
        }
        return false
      }
      let bottom = 0
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        if (floating(el)) continue
        bottom = Math.max(bottom, r.bottom + window.scrollY)
      }
      return Math.max(0, Math.round(document.documentElement.scrollHeight - bottom))
    })(),
    //   틈이 있는 것 자체는 흠이 아니다 — 내용이 화면보다 짧으면 늘 생긴다. 흠은 **그 틈이
    //   눈에 띄는 것**(흰 띠)이다. 그래서 틈의 바탕(body)과 화면이 깐 바탕을 견주어,
    //   **색이 다를 때만** 걸린 것으로 센다.
    하단틈색: (() => {
      const bodyBg = getComputedStyle(document.body).backgroundColor
      // 화면이 깐 바탕 — 본문 칸(.ems-main) 안에서 가장 넓고 위에 있는 칸의 바탕.
      let pageBg = bodyBg
      const main = document.querySelector('.ems-main')
      for (const el of main ? main.querySelectorAll(':scope > *, :scope > * > *') : []) {
        const r = el.getBoundingClientRect()
        if (r.width < window.innerWidth * 0.9 || r.height < 40) continue
        const bg = getComputedStyle(el).backgroundColor
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') { pageBg = bg; break }
      }
      return { body: bodyBg, 화면: pageBg, 같다: bodyBg === pageBg }
    })(),
    // ── 입력칸 글자 크기 ─────────────────────────────────────────────
    //   16px 미만이면 iOS 가 포커스 때 화면을 키운다(그리고 되돌려 주지 않는다).
    작은입력칸: (() => {
      const bad = []
      for (const el of document.querySelectorAll('input, select, textarea, [contenteditable]')) {
        const t = (el.getAttribute('type') || '').toLowerCase()
        if (['checkbox', 'radio', 'range', 'color', 'hidden', 'submit', 'button'].includes(t)) continue
        if (el.getAttribute('contenteditable') === 'false') continue
        const cs = getComputedStyle(el)
        if (cs.display === 'none' || cs.visibility === 'hidden') continue
        const px = parseFloat(cs.fontSize)
        if (px >= 16) continue
        bad.push(`${el.tagName.toLowerCase()}${t ? `[${t}]` : ''}.${String(el.className || '').slice(0, 20)}=${px}`)
      }
      return bad
    })(),
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
    if (SHOTS) {
      const dir = path.join(ROOT, SHOTS)
      fs.mkdirSync(dir, { recursive: true })
      const name = `${engineName}-${p === '/' ? 'home' : p.replace(/\//g, '-').replace(/^-/, '')}.png`
      await page.screenshot({ path: path.join(dir, name) }).catch(() => {})
    }
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
      // 앱바·하단 공백·작은 입력칸도 함께 본다(2026-11-26) — 셋 다 넘침과 같은 신고에서 왔다.
      const seam = r.하단공백 > 2 && !r.하단틈색.같다
      const sick = over > 0 || r.넘친수 > 0 || !/보임=true/.test(String(r.앱바)) || seam || r.작은입력칸.length > 0
      if (sick) bad++
      console.log(`${sick ? '걸림' : '정상'} ${r.path}  문서 ${r.문서폭} / 창 ${r.창폭} (${over > 0 ? `+${over}` : '0'}) · body ${r.body폭} · overflow-x html:${r.html넘침} body:${r.body넘침} · 삐져나온 요소 ${r.넘친수}${r.구르는통수 ? ` · (구르는 통 안 ${r.구르는통수}: ${r.구르는통.join(' · ')})` : ''}`)
      console.log(`      앱바 ${r.앱바} · 하단 틈 ${r.하단공백}px(${seam ? `**보인다** body ${r.하단틈색.body} ≠ 화면 ${r.하단틈색.화면}` : '색이 같아 안 보인다'}) · 16px 미만 입력칸 ${r.작은입력칸.length}${r.작은입력칸.length ? ` → ${r.작은입력칸.slice(0, 5).join(' · ')}` : ''}`)
      for (const e of r.넘친것) {
        console.log(`      ${e.tag}.${e.cls}  left ${e.left} right ${e.right} (w ${e.w}) ${e.pos} · ${e.넓이규칙}`)
      }
    }
  }
  console.log(bad === 0 ? '\n걸린 화면 없음' : `\n${bad}건 걸림`)
  process.exit(bad === 0 ? 0 : 1)
})()
