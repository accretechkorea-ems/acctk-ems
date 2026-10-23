// 로그인 직후 첫 로딩을 구간별로 잰다.
//
//   npm run perf -- --login        운영 빌드(3100)에 붙어 찬 캐시·더운 캐시 각 3회
//
// 왜 따로 재는가 — 이미 로그인한 뒤의 화면 이동은 빠른데 **로그인 직후 첫 화면**만 느리다.
// 화면 하나를 재는 것(measure.ts 의 SCREENS)으로는 그 사이에 무슨 일이 몇 번 일어나는지
// 보이지 않는다. 그래서 「로그인 누름」을 0 으로 두고 아래 여섯 구간을 따로 적는다.
//
//   ① auth 토큰(/auth/v1/token)         로그인 그 자체
//   ② 리다이렉트                         문서 응답 사슬 — 몇 번, 어디로
//   ③ 홈 문서·JS                         문서 TTFB 와 새로 받은 스크립트
//   ④ 본인 확인 사슬                     auth/user → engineers?email → teams
//   ⑤ 화면 카드 조회 시작                 ④ 가 끝난 뒤에 시작하는가(직렬인가)
//   ⑥ 첫 그림(FCP)·껍데기·조용해짐        사람이 느끼는 시점
//
// ── 읽기 전용 ───────────────────────────────────────────────────────────────
//   하는 일은 /login 열기 · 두 칸 채우기 · 로그인 누르기 · 기다리기뿐이다.
//   measure.ts 와 같은 규칙이고, 자격은 .env.local 에서 읽어 **어디에도 찍지 않는다**.

import type { BrowserContext, Page, Request } from 'playwright'

/** 한 번의 로그인에서 건진 값. 시간은 모두 「로그인 누름」을 0 으로 한 ms 다. */
export type LoginSample = {
  ok: boolean
  note?: string
  cold: boolean
  /** ① */
  tokenStart: number | null
  tokenEnd: number | null
  /** ② 문서 응답 사슬 — 'POST /login 200' 꼴. */
  docChain: string[]
  redirects: number
  /** ③ */
  docTtfb: number | null
  jsKB: number
  jsDoneAt: number | null
  /** ④ 사슬의 각 칸 — 없으면 null(로그인 화면이 이미 읽어 둔 경우 등). */
  authUser: Span | null
  engineers: Span | null
  teams: Span | null
  teamPerms: Span | null
  chainStart: number | null
  chainEnd: number | null
  /** ⑤ 사슬에 들지 않는 첫 자료 조회. */
  firstCard: (Span & { short: string }) | null
  cardCount: number
  /** ⑥ */
  fcp: number | null
  navAt: number | null
  shellAt: number | null
  quietAt: number | null
  /** 참고 — 자료 조회 전체 수(supabase + /api). */
  dataReqs: number
  /** 같은 URL 이 두 번 이상 나간 것. */
  dups: { short: string; count: number }[]
  /** 인증·자료 요청을 시작한 순서대로. 어디가 앞의 끝을 기다렸는지 이것으로 본다. */
  timeline: { short: string; start: number; end: number; status: number }[]
}

export type Span = { start: number; end: number; ms: number }

type Row = {
  url: string
  short: string
  method: string
  type: string
  status: number
  /** 로그인 누름 기준(ms). 타이밍이 없으면 null. */
  start: number | null
  end: number | null
}

const QUIET_MS = 1500
const MAX_WAIT_MS = 30000

/** 표에 넣을 짧은 이름. 값은 넣지 않는다 — 파라미터 **이름**만 적는다(메일이 섞인다). */
function shortOf(url: string, supabaseHost: string): string {
  try {
    const u = new URL(url)
    if (u.host.includes(supabaseHost)) {
      const table = u.pathname.replace('/rest/v1/', '').replace('/auth/v1/', 'auth:')
      const keys = [...u.searchParams.keys()].filter(k => k !== 'select').sort()
      return table + (keys.length ? ` ?${keys.join('&')}` : '')
    }
    if (u.pathname.startsWith('/api/')) return u.pathname
    if (u.pathname.includes('/_next/')) return u.pathname.split('/').pop() ?? u.pathname
    return u.pathname + (u.searchParams.has('_rsc') ? ' ?_rsc' : '')
  } catch { return url.slice(0, 60) }
}

const spanOf = (r: Row | undefined): Span | null =>
  r && r.start != null && r.end != null ? { start: Math.round(r.start), end: Math.round(r.end), ms: Math.round(r.end - r.start) } : null

/**
 * 로그인 한 번을 잰다.
 *
 * cold=true  : 이 컨텍스트로 아무것도 받아 본 적이 없는 상태(첫 방문).
 * cold=false : 같은 컨텍스트에서 쿠키만 버린 상태(JS·문서는 캐시에 있고 세션만 없다).
 */
export async function measureLogin(
  ctx: BrowserContext,
  args: { email: string; password: string; base: string; supabaseUrl: string; cold: boolean },
): Promise<LoginSample> {
  const supabaseHost = (() => { try { return new URL(args.supabaseUrl).host } catch { return 'supabase.co' } })()
  const page: Page = await ctx.newPage()

  const finished: Request[] = []
  const docChain: string[] = []
  let lastActivity = Date.now()
  page.on('request', () => { lastActivity = Date.now() })
  page.on('requestfailed', () => { lastActivity = Date.now() })
  page.on('requestfinished', r => { finished.push(r); lastActivity = Date.now() })
  page.on('response', res => {
    const r = res.request()
    if (r.resourceType() !== 'document') return
    try {
      const u = new URL(res.url())
      docChain.push(`${r.method()} ${u.pathname} ${res.status()}`)
    } catch { /* 주소를 못 읽으면 적지 않는다 */ }
  })

  const fail = (note: string): LoginSample => ({
    ok: false, note, cold: args.cold,
    tokenStart: null, tokenEnd: null, docChain, redirects: 0,
    docTtfb: null, jsKB: 0, jsDoneAt: null,
    authUser: null, engineers: null, teams: null, teamPerms: null, chainStart: null, chainEnd: null,
    firstCard: null, cardCount: 0,
    fcp: null, navAt: null, shellAt: null, quietAt: null, dataReqs: 0, dups: [], timeline: [],
  })

  try {
    // ── 로그인 화면을 띄우고 수화를 기다린다 ─────────────────────────────────
    // 수화 전에 값을 넣으면 React 상태가 비어 누르는 것이 아무 일도 하지 않는다
    // (measure.ts 와 같은 이유로 값이 남았는지 확인하고 세 번까지 다시 넣는다).
    let ready = false
    for (let attempt = 1; attempt <= 3 && !ready; attempt++) {
      await page.goto(args.base + '/login', { waitUntil: 'load', timeout: 30000 })
      await page.waitForTimeout(700 * attempt)
      const id = page.getByPlaceholder('아이디')
      const pw = page.getByPlaceholder('비밀번호')
      await id.fill(args.email)
      await pw.fill(args.password)
      ready = !!(await id.inputValue()) && !!(await pw.inputValue())
    }
    if (!ready) return fail('로그인 칸을 채우지 못했다(수화 전)')

    // ── 여기부터가 측정 구간이다 ────────────────────────────────────────────
    finished.length = 0
    docChain.length = 0
    const t0 = Date.now()
    lastActivity = t0
    await page.getByRole('button', { name: /로그인/ }).click()

    const moved = await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 25000 })
      .then(() => true).catch(() => false)
    const navAt = moved ? Date.now() - t0 : null
    if (!moved) return { ...fail('로그인 뒤 화면이 바뀌지 않았다'), navAt: null }

    // 앱 껍데기(사이드바)가 보이는 시점 — 본인 확인이 끝나야 그려진다.
    const shellSeen = await page.locator('.ems-sidebar').first()
      .waitFor({ state: 'attached', timeout: 15000 }).then(() => true).catch(() => false)
    const shellAt = shellSeen ? Date.now() - t0 : null

    // 네트워크가 조용해질 때까지.
    for (;;) {
      if (Date.now() - lastActivity > QUIET_MS) break
      if (Date.now() - t0 > MAX_WAIT_MS) break
      await page.waitForTimeout(100)
    }
    const quietAt = Date.now() - t0

    const fcp = await page.evaluate(() => {
      const e = performance.getEntriesByName('first-contentful-paint')[0]
      return e ? Math.round(e.startTime) : null
    }).catch(() => null)

    // ── 요청을 구간으로 가른다 ──────────────────────────────────────────────
    const rows: Row[] = []
    for (const r of finished) {
      const t = r.timing()
      const res = await r.response().catch(() => null)
      const hasTiming = t.startTime > 0 && t.responseEnd >= 0
      rows.push({
        url: r.url(),
        short: shortOf(r.url(), supabaseHost),
        method: r.method(),
        type: r.resourceType(),
        status: res?.status() ?? 0,
        start: hasTiming ? t.startTime - t0 : null,
        end: hasTiming ? t.startTime + t.responseEnd - t0 : null,
      })
    }
    rows.sort((a, b) => (a.start ?? 0) - (b.start ?? 0))

    const find = (pred: (r: Row) => boolean) => rows.find(pred)
    const token = find(r => r.url.includes('/auth/v1/token'))
    const authUser = find(r => r.url.includes('/auth/v1/user'))
    const engineers = find(r => r.url.includes('/rest/v1/engineers') && r.url.includes('email='))
    const teams = find(r => r.url.includes('/rest/v1/teams'))
    const teamPerms = find(r => r.url.includes('/rest/v1/team_permissions'))

    // JS — 받은 스크립트의 양과 마지막 스크립트가 끝난 시각.
    let jsBytes = 0
    for (const r of finished) {
      if (r.resourceType() !== 'script') continue
      try { const s = await r.sizes(); jsBytes += s.responseBodySize } catch { /* 크기를 못 재면 센다 */ }
    }
    const scripts = rows.filter(r => r.type === 'script' && r.end != null)
    const jsDoneAt = scripts.length ? Math.round(Math.max(...scripts.map(r => r.end as number))) : null

    // 문서 TTFB — 로그인 뒤 **처음 받은 문서**(소프트 이동이면 없다).
    const docReq = finished.find(r => r.resourceType() === 'document')
    const docT = docReq?.timing()
    const docTtfb = docT && docT.responseStart >= 0 ? Math.round(docT.responseStart) : null

    // 자료 조회 — 사슬(auth/user·engineers?email·teams·team_permissions) 밖의 것.
    const isData = (r: Row) => r.url.includes(`${supabaseHost}/rest/v1/`) || r.url.includes(`${args.base}/api/`)
    const chainUrls = new Set([engineers?.url, teams?.url, teamPerms?.url].filter(Boolean) as string[])
    const cards = rows.filter(r => isData(r) && !chainUrls.has(r.url) && r.start != null)
    const data = rows.filter(r => isData(r) || r.url.includes('/auth/v1/'))

    const counts = new Map<string, { short: string; count: number }>()
    for (const r of data) {
      const key = `${r.method} ${r.url}`
      const hit = counts.get(key)
      if (hit) hit.count += 1
      else counts.set(key, { short: `${r.method} ${r.short}`, count: 1 })
    }

    const chainSpans = [spanOf(authUser), spanOf(engineers), spanOf(teams), spanOf(teamPerms)]
      .filter(Boolean) as Span[]
    const firstCardRow = cards[0]

    return {
      ok: true,
      cold: args.cold,
      tokenStart: spanOf(token)?.start ?? null,
      tokenEnd: spanOf(token)?.end ?? null,
      docChain: [...docChain],
      // 문서 응답이 둘 이상이면 그 사이가 리다이렉트다(200 하나는 리다이렉트 0 번).
      redirects: Math.max(0, docChain.length - 1),
      docTtfb,
      jsKB: Math.round(jsBytes / 1024),
      jsDoneAt,
      authUser: spanOf(authUser),
      engineers: spanOf(engineers),
      teams: spanOf(teams),
      teamPerms: spanOf(teamPerms),
      chainStart: chainSpans.length ? Math.min(...chainSpans.map(s => s.start)) : null,
      chainEnd: chainSpans.length ? Math.max(...chainSpans.map(s => s.end)) : null,
      firstCard: firstCardRow
        ? { ...(spanOf(firstCardRow) as Span), short: firstCardRow.short }
        : null,
      cardCount: cards.length,
      fcp,
      navAt,
      shellAt,
      quietAt,
      dataReqs: data.length,
      dups: [...counts.values()].filter(d => d.count > 1).sort((a, b) => b.count - a.count),
      timeline: rows
        .filter(r => isData(r) || r.url.includes('/auth/v1/') || r.url.includes('_rsc=') || r.type === 'document')
        .filter(r => r.start != null && r.end != null)
        .map(r => ({ short: r.short, start: Math.round(r.start as number), end: Math.round(r.end as number), status: r.status })),
    }
  } catch (e) {
    return fail(String(e).slice(0, 140))
  } finally {
    await page.close().catch(() => {})
  }
}

// ── 보고서 ──────────────────────────────────────────────────────────────────
const med = (xs: (number | null)[]): number | null => {
  const v = xs.filter((x): x is number => x != null).sort((a, b) => a - b)
  return v.length ? v[Math.floor(v.length / 2)] : null
}
const ms = (v: number | null) => (v == null ? '—' : `${v.toLocaleString('ko-KR')}ms`)

/** 한 묶음(찬 캐시 또는 더운 캐시)의 중간값 표. */
function group(name: string, xs: LoginSample[]): string[] {
  const L: string[] = []
  const ok = xs.filter(s => s.ok)
  L.push(`### ${name} — ${ok.length}/${xs.length}회 성공`, '')
  if (ok.length === 0) {
    L.push('재지 못했다: ' + (xs.map(s => s.note).find(Boolean) ?? '이유 없음'), '')
    return L
  }
  L.push('| 구간 | 시작 | 끝 | 걸린 시간 |', '|---|---|---|---|')
  const row = (label: string, start: (s: LoginSample) => number | null, end: (s: LoginSample) => number | null) => {
    const a = med(ok.map(start))
    const b = med(ok.map(end))
    L.push(`| ${label} | ${ms(a)} | ${ms(b)} | ${a != null && b != null ? ms(b - a) : '—'} |`)
  }
  row('① auth 토큰', s => s.tokenStart, s => s.tokenEnd)
  row('④-a auth/user', s => s.authUser?.start ?? null, s => s.authUser?.end ?? null)
  row('④-b engineers?email', s => s.engineers?.start ?? null, s => s.engineers?.end ?? null)
  row('④-c teams', s => s.teams?.start ?? null, s => s.teams?.end ?? null)
  row('④-d team_permissions', s => s.teamPerms?.start ?? null, s => s.teamPerms?.end ?? null)
  row('④ 본인 확인 사슬 전체', s => s.chainStart, s => s.chainEnd)
  row('⑤ 첫 카드 조회', s => s.firstCard?.start ?? null, s => s.firstCard?.end ?? null)
  L.push('')
  L.push('| 지점 | 중간값 | 각 회차 |', '|---|---|---|')
  const point = (label: string, pick: (s: LoginSample) => number | null) => {
    L.push(`| ${label} | ${ms(med(ok.map(pick)))} | ${ok.map(s => ms(pick(s))).join(' · ')} |`)
  }
  point('② 주소가 바뀐 때', s => s.navAt)
  point('③ 문서 TTFB', s => s.docTtfb)
  point('③ JS 다 받은 때', s => s.jsDoneAt)
  point('⑥ 첫 그림(FCP)', s => s.fcp)
  point('⑥ 껍데기(사이드바)', s => s.shellAt)
  point('⑥ 네트워크 조용해짐', s => s.quietAt)
  L.push('')
  const first = ok[0]
  L.push(`문서 사슬(1회차): ${first.docChain.length ? first.docChain.join(' → ') : '없음(소프트 이동)'} · 리다이렉트 ${med(ok.map(s => s.redirects))}번`, '')
  L.push(`자료 요청 ${med(ok.map(s => s.dataReqs))}건(카드 ${med(ok.map(s => s.cardCount))}건) · 새 JS ${med(ok.map(s => s.jsKB))}KB` +
    (first.firstCard ? ` · 첫 카드 조회는 \`${first.firstCard.short}\`` : ''), '')
  // 타임라인은 중간값을 낼 수 없다(회차마다 순서가 조금씩 다르다) — 대표로 **중간 회차** 하나를 적는다.
  const rep0 = [...ok].sort((a, b) => (a.quietAt ?? 0) - (b.quietAt ?? 0))[Math.floor(ok.length / 2)]
  if (rep0.timeline.length) {
    L.push(`대표 회차(조용해짐 ${ms(rep0.quietAt)}) 의 요청 순서 — 「대기」는 앞 요청이 끝난 뒤 이것이 시작할 때까지다.`, '')
    L.push('| # | 요청 | 시작 | 끝 | 걸린 시간 | 대기 |', '|---|---|---|---|---|---|')
    let prevEnd = 0
    rep0.timeline.forEach((t, i) => {
      const wait = t.start - prevEnd
      L.push(`| ${i + 1} | \`${t.short}\` | ${ms(t.start)} | ${ms(t.end)} | ${ms(t.end - t.start)} | ${wait > 20 ? ms(wait) : '—'} |`)
      prevEnd = Math.max(prevEnd, t.end)
    })
    L.push('')
  }

  const dups = ok.flatMap(s => s.dups)
  if (dups.length) {
    const byShort = new Map<string, number>()
    for (const d of dups) byShort.set(d.short, Math.max(byShort.get(d.short) ?? 0, d.count))
    L.push('같은 요청이 두 번 이상: ' + [...byShort].map(([s, c]) => `${s} ×${c}`).join(' · '), '')
  }
  return L
}

export function loginMarkdown(cold: LoginSample[], warm: LoginSample[], meta: Record<string, string>): string {
  const L: string[] = []
  L.push(`# 로그인 흐름 실측 — ${meta.when}`, '')
  L.push(`모드 **${meta.mode}** · 주소 ${meta.base} · Chromium(playwright ${meta.pw})`, '')
  L.push('모든 시간은 **「로그인」을 누른 순간을 0** 으로 한 ms 다. 회차마다 새 브라우저',
    '컨텍스트를 쓰고(찬 캐시), 같은 컨텍스트에서 쿠키만 버려 한 번 더 잰다(더운 캐시 —',
    'JS·문서는 받아 둔 상태로 세션만 없는 「두 번째 로그인」).', '')
  L.push('구간: ① auth 토큰 ② 리다이렉트 ③ 홈 문서·JS ④ 본인 확인 사슬(auth/user → engineers → teams)',
    '⑤ 화면 카드 조회 ⑥ 첫 그림·껍데기·조용해짐.', '')
  L.push(...group('찬 캐시(첫 방문)', cold))
  L.push(...group('더운 캐시(두 번째 로그인)', warm))
  return L.join('\n')
}
