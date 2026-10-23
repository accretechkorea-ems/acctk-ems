// 실제 브라우저로 화면·모달의 로딩을 잰다.
//
//   npm run perf        운영과 같은 1회 실행(next start, 기본). 서버가 없으면 띄우는 법을 알려 준다.
//   npm run perf:dev    개발 서버(localhost:3000)에 붙는다 — React Strict Mode 가 effect 를
//                       두 번 돌리므로 **조회 수가 부풀어** 보인다(보고서에 그 사실을 적는다).
//   npm run perf -- --login   화면 목록 대신 **로그인 직후 첫 로딩**만 구간별로 3회 잰다
//                       (찬 캐시·더운 캐시 각 3회 → docs/perf/login-flow.md). scripts/perf/login.ts
//
// ── 읽기 전용 ───────────────────────────────────────────────────────────────
//   할 수 있는 일: 주소 이동 · 보이는 글자 누르기 · 목록 첫 줄 누르기 · ESC.
//   목록(screens.ts)에 그 네 가지만 적을 수 있고, 누르기는 전부 safeClick 을 지난다 —
//   글자에 금지어(저장·등록·삭제·확정·승인·반려·상신·업로드·제출·전송·발주·요청…)가 있으면
//   **누르지 않고 건너뛴다**. 글자를 넣는 곳은 로그인 두 칸뿐이다.
//
// ── 비밀 ────────────────────────────────────────────────────────────────────
//   .env.local 의 E2E_EMAIL / E2E_PASSWORD 를 쓴다. 값은 **어디에도 찍지 않는다**
//   (로그·JSON·보고서 모두). 로그인 성공 여부만 남는다.

import { chromium, type Browser, type BrowserContext, type Page, type Request } from 'playwright'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ModalSpec, ScreenSpec, Step } from './screens.ts'
import { DETAIL_FROM_LIST, SCREENS, SKIPPED_MODALS } from './screens.ts'
import { loginMarkdown, measureLogin, type LoginSample } from './login.ts'

const ROOT = process.cwd()
const DEV = process.argv.includes('--dev')
/**
 * 한 화면만 재기 — npm run perf -- --only showroom
 * 라벨이나 경로에 이 글자가 들어가는 화면만 돈다. 전체 보고서(latest.md)는 **덮지 않고**
 * docs/perf/latest-only.md 에 따로 쓴다(기준선 비교용 표를 지우지 않게).
 */
const ONLY = (() => {
  const i = process.argv.indexOf('--only')
  return i > -1 ? (process.argv[i + 1] ?? '').toLowerCase() : ''
})()
/** 쉼표로 여럿 — --only dashboard,approval 처럼 쓴다. */
const ONLY_PARTS = ONLY.split(',').map(x => x.trim()).filter(Boolean)
/** 로그인 흐름만 재는 모드 — 화면 목록은 돌지 않는다. */
const LOGIN_ONLY = process.argv.includes('--login')
/** 로그인 흐름을 몇 번 재는가(찬 캐시·더운 캐시 각각). */
const LOGIN_RUNS = 3
const picked = <T extends { label: string; path?: string; from?: string }>(list: T[]): T[] =>
  ONLY_PARTS.length === 0
    ? list
    : list.filter(x => {
      const hay = (x.label + ' ' + (x.path ?? x.from ?? '')).toLowerCase()
      return ONLY_PARTS.some(p => hay.includes(p))
    })
const BASE = DEV ? 'http://localhost:3000' : (process.env.PERF_URL ?? 'http://localhost:3100')

/** 누르면 자료가 바뀔 수 있는 글자 — 하나라도 걸리면 누르지 않는다. */
const DENY = [
  '저장', '등록', '삭제', '확정', '승인', '반려', '회수', '상신', '제출', '전송', '발송',
  '업로드', '발주', '완료 처리', '요청', '적용', '초기화', '보내기', '내보내기', '수정',
  '로그아웃', '탈퇴', '승급', '초대', '재발송', '비밀번호',
]

/** 네트워크가 이만큼 조용하면 「다 받았다」로 본다. */
const QUIET_MS = 2000
const MAX_WAIT_MS = 25000
/**
 * 한 화면을 **적어도** 이만큼 지켜본다.
 *
 * 「조용하면 끝」만으로는 느린 날에 측정이 모자란다 — 본인 확인(auth → engineers →
 * teams·team_permissions)이 4초 걸리면 그 사이 2초 침묵이 생기고, 카드 조회가 시작되기도
 * 전에 창이 닫혔다(홈이 5건으로 잡힌 실행). 그래서 침묵 조건과 **함께** 이 시간을 채운다.
 */
const MIN_WATCH_MS = 4000

type ReqRow = {
  url: string
  short: string
  method: string
  type: string
  kind: 'supabase' | 'api' | 'next' | 'other'
  status: number
  start: number
  end: number
  ms: number
  bytes: number
}

type Sample = {
  label: string
  ok: boolean
  note?: string
  /** 문서 응답 TTFB(ms). 클릭으로 이동한 경우에는 없다. */
  ttfb: number | null
  /** 화면이 받은 JS 전송량(KB). */
  jsKB: number
  /** 자료 요청 수(supabase + /api). */
  dataReqs: number
  /** 같은 URL·메서드가 두 번 이상 나간 것. */
  dups: { short: string; count: number }[]
  /** 자료 요청의 첫 시작 → 마지막 끝(ms). */
  networkMs: number
  /** 가장 오래 걸린 자료 요청. */
  slowest: { short: string; ms: number } | null
  /** 앞 요청이 끝난 뒤에 시작한 자료 요청 수(= 직렬 사슬 길이). */
  serial: number
  /** 모달·탭은 누른 순간부터 보일 때까지(ms). */
  openMs?: number
  requests: ReqRow[]
}

type ScreenResult = {
  label: string
  group: string
  path: string
  note?: string
  main: Sample | null
  extras: Sample[]
  modals: (Sample & { modal: string })[]
}

// ── .env.local ──────────────────────────────────────────────────────────────
function envLocal(): Record<string, string> {
  const f = join(ROOT, '.env.local')
  if (!existsSync(f)) throw new Error('.env.local 이 없다 — E2E_EMAIL / E2E_PASSWORD 가 필요하다')
  const out: Record<string, string> = {}
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim())
    if (!m) continue
    out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}

// ── 요청 모으기 ─────────────────────────────────────────────────────────────
class Collector {
  private pending: Request[] = []
  private lastActivity = Date.now()
  /** 이번 측정을 시작한 시각 — 최소 관찰 시간을 재는 기준이다. */
  private watchFrom = Date.now()
  private supabaseHost: string
  private page: Page

  // 매개변수 속성(private page: Page)은 node 의 「타입만 떼기」 모드가 못 읽는다 — 풀어 쓴다.
  constructor(page: Page, supabaseUrl: string) {
    this.page = page
    this.supabaseHost = (() => { try { return new URL(supabaseUrl).host } catch { return 'supabase.co' } })()
    page.on('request', () => { this.lastActivity = Date.now() })
    page.on('requestfinished', r => { this.pending.push(r); this.lastActivity = Date.now() })
    page.on('requestfailed', () => { this.lastActivity = Date.now() })
  }

  clear() { this.pending = []; this.lastActivity = Date.now(); this.watchFrom = Date.now() }

/** 네트워크가 조용해지고 **최소 시간**이 지날 때까지 기다린다(최대 MAX_WAIT_MS). */
  async quiet(): Promise<void> {
    const deadline = this.watchFrom + MAX_WAIT_MS
    for (;;) {
      const quietEnough = Date.now() - this.lastActivity > QUIET_MS
      const watchedEnough = Date.now() - this.watchFrom > MIN_WATCH_MS
      if (quietEnough && watchedEnough) return
      if (Date.now() > deadline) return
      await this.page.waitForTimeout(150)
    }
  }

  private kindOf(url: string): ReqRow['kind'] {
    if (url.includes(this.supabaseHost)) return 'supabase'
    if (url.startsWith(`${BASE}/api/`)) return 'api'
    if (url.includes('/_next/')) return 'next'
    return 'other'
  }

  /**
   * 짧은 이름 — 표에 들어갈 만큼만 남긴다.
   *
   * **값은 절대 넣지 않는다**(필터에 메일·이름이 섞여 들어온다). 대신 파라미터 **이름**을 적는다 —
   * 그러지 않으면 조건만 다른 두 조회(본인 하나 vs 목록 전체)가 표에서 같은 줄로 보여
   * 「중복」으로 잘못 세어진다.
   */
  private shortOf(url: string): string {
    try {
      const u = new URL(url)
      if (u.host.includes(this.supabaseHost)) {
        const table = u.pathname.replace('/rest/v1/', '').replace('/auth/v1/', 'auth:')
        const cols = u.searchParams.get('select')
        const keys = [...u.searchParams.keys()].filter(k => k !== 'select').sort()
        return [
          table,
          cols ? `(${cols.length > 24 ? cols.slice(0, 24) + '…' : cols})` : '',
          keys.length ? ` ?${keys.join('&')}` : '',
        ].join('')
      }
      if (u.pathname.startsWith('/api/')) {
        const keys = [...u.searchParams.keys()].sort()
        return u.pathname + (keys.length ? ` ?${keys.join('&')}` : '')
      }
      if (u.pathname.includes('/_next/')) return u.pathname.split('/').pop() ?? u.pathname
      return u.host + u.pathname
    } catch { return url.slice(0, 60) }
  }

  async take(label: string, opts: { docUrl?: string; openMs?: number; note?: string; ok?: boolean } = {}): Promise<Sample> {
    const rows: ReqRow[] = []
    for (const r of this.pending) {
      const t = r.timing()
      // 타이밍이 없는 요청(HEAD 건수 조회 등)도 **센다** — 빠뜨리면 요청 수가 실제보다 적게 나온다.
      const noTiming = t.startTime <= 0
      let bytes = 0
      try { const s = await r.sizes(); bytes = s.responseBodySize + s.responseHeadersSize } catch { bytes = 0 }
      const res = await r.response().catch(() => null)
      const start = noTiming ? 0 : t.startTime
      const end = noTiming ? 0 : (t.responseEnd >= 0 ? t.startTime + t.responseEnd : t.startTime)
      rows.push({
        url: r.url(), short: this.shortOf(r.url()), method: r.method(), type: r.resourceType(),
        kind: this.kindOf(r.url()), status: res?.status() ?? 0,
        start, end, ms: noTiming ? 0 : Math.max(0, Math.round(t.responseEnd >= 0 ? t.responseEnd : 0)), bytes,
      })
    }

    const data = rows.filter(r => r.kind === 'supabase' || r.kind === 'api').sort((a, b) => a.start - b.start)
    // 세는 것은 **URL 전체**다(보여 주는 이름은 짧게 줄이지만, 그 이름으로 세면 조건만 다른
    // 두 조회가 한 줄로 묶여 중복으로 잘못 잡힌다 — ?box=inbox 와 ?box=counts 처럼).
    const counts = new Map<string, { short: string; count: number }>()
    for (const r of data) {
      const key = `${r.method} ${r.url}`
      const hit = counts.get(key)
      if (hit) hit.count += 1
      else counts.set(key, { short: `${r.method} ${r.short}`, count: 1 })
    }
    const dups = [...counts.values()].filter(d => d.count > 1).sort((a, b) => b.count - a.count)

    // 시간 계산은 타이밍이 있는 것만 본다(HEAD 건수 조회처럼 타이밍이 없는 것은 세기만 한다).
    const timed = data.filter(r => r.start > 0)
    let serial = 0
    for (let i = 1; i < timed.length; i++) if (timed[i].start >= timed[i - 1].end) serial += 1

    const doc = rows.find(r => r.type === 'document')
    const docTiming = doc ? this.pending.find(p => p.url() === doc.url)?.timing() : undefined

    return {
      label,
      ok: opts.ok ?? true,
      note: opts.note,
      ttfb: docTiming && docTiming.responseStart >= 0 ? Math.round(docTiming.responseStart) : null,
      jsKB: Math.round(rows.filter(r => r.type === 'script').reduce((s, r) => s + r.bytes, 0) / 1024),
      dataReqs: data.length,
      dups,
      networkMs: timed.length ? Math.round(Math.max(...timed.map(r => r.end)) - Math.min(...timed.map(r => r.start))) : 0,
      slowest: timed.length ? timed.map(r => ({ short: r.short, ms: r.ms })).sort((a, b) => b.ms - a.ms)[0] : null,
      serial,
      openMs: opts.openMs,
      requests: rows,
    }
  }
}

// ── 안전한 누르기 ───────────────────────────────────────────────────────────
function denied(text: string): string | null {
  const flat = text.replace(/\s+/g, ' ').trim()
  for (const w of DENY) if (flat.includes(w)) return w
  return null
}

/**
 * 누르기 — 여기를 지나지 않고 누르는 길은 없다.
 *
 *   clickText  : 보이는 글자로 찾는다. **그 글자에 금지어가 있으면 누르지 않는다.**
 *   clickFirst : 목록 줄·아이콘처럼 글자가 매번 다른 곳이다. 선택자를 사람이 적어 둔 것이므로
 *                글자 검사 대신 **submit 단추인지만** 본다(줄에 '요청' 같은 상태 글자가
 *                섞여 있다고 해서 줄을 못 누르면 상세 화면을 영원히 못 잰다).
 */
async function safeClick(page: Page, step: Step): Promise<{ ok: boolean; why?: string }> {
  const loc = step.kind === 'clickText'
    ? page.getByText(step.text, { exact: false }).first()
    : step.kind === 'clickFirst' ? page.locator(step.selector).first() : null
  if (!loc) return { ok: false, why: '누를 것이 없다' }
  if (!(await loc.count().catch(() => 0))) return { ok: false, why: '화면에 없다' }
  if (!(await loc.isVisible().catch(() => false))) return { ok: false, why: '보이지 않는다' }

  if (step.kind === 'clickText') {
    const text = (await loc.innerText().catch(() => '')) || (await loc.getAttribute('title').catch(() => '')) || ''
    const bad = denied(text.slice(0, 200))
    if (bad) return { ok: false, why: `금지어 「${bad}」 — 누르지 않는다` }
  } else {
    const type = (await loc.getAttribute('type').catch(() => null)) ?? ''
    if (type === 'submit') return { ok: false, why: 'submit 단추 — 누르지 않는다' }
  }

  await loc.click({ timeout: 5000, trial: false }).catch(() => {})
  return { ok: true }
}

// ── 한 화면 재기 ────────────────────────────────────────────────────────────
async function measureScreen(page: Page, c: Collector, s: ScreenSpec): Promise<ScreenResult> {
  const out: ScreenResult = { label: s.label, group: s.group, path: s.path, note: s.note, main: null, extras: [], modals: [] }

  c.clear()
  const url = BASE + s.path
  const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null)
  await c.quiet()
  const gate = await page.getByText('접근 권한이 없습니다').first().isVisible().catch(() => false)
  out.main = await c.take('화면 열기', {
    docUrl: url,
    ok: !!res && !gate,
    note: gate ? '접근 권한이 없습니다(권한 밖 화면)' : (!res ? '열지 못했다' : undefined),
  })
  if (gate) return out

  for (const extra of s.after ?? []) {
    c.clear()
    const t0 = Date.now()
    let ok = true
    let why: string | undefined
    for (const step of extra.steps) {
      const r = step.kind === 'escape' ? (await page.keyboard.press('Escape'), { ok: true }) : await safeClick(page, step)
      if (!r.ok) { ok = false; why = r.why }
    }
    await c.quiet()
    out.extras.push(await c.take(extra.label, { openMs: Date.now() - t0, ok, note: why }))
  }

  for (const m of s.modals ?? []) {
    const sample = await measureModal(page, c, m)
    out.modals.push(sample)
    // 다음 모달을 위해 화면을 되돌린다(열린 채로 두지 않는다). measureModal 이 이미
    // 닫고 사라짐까지 확인했으므로 여기서는 한 번 더 ESC 를 눌러 두는 정도다.
    await page.keyboard.press('Escape').catch(() => {})
    await page.waitForTimeout(300)
  }
  return out
}

async function measureModal(page: Page, c: Collector, m: ModalSpec): Promise<Sample & { modal: string }> {
  c.clear()
  const t0 = Date.now()
  let ok = true
  let why: string | undefined
  for (const step of m.open) {
    const r = step.kind === 'escape' ? (await page.keyboard.press('Escape'), { ok: true }) : await safeClick(page, step)
    if (!r.ok) { ok = false; why = r.why }
  }
  if (ok) {
    const seen = await page.getByText(m.expect, { exact: false }).first().waitFor({ state: 'visible', timeout: 8000 })
      .then(() => true).catch(() => false)
    if (!seen) { ok = false; why = `「${m.expect}」가 보이지 않았다(열리지 않음)` }
  }
  const openMs = Date.now() - t0
  await c.quiet()
  const sample = await c.take(m.label, { openMs, ok, note: why })
  for (const step of m.close ?? [{ kind: 'escape' } as Step]) {
    if (step.kind === 'escape') await page.keyboard.press('Escape').catch(() => {})
    else await safeClick(page, step)
  }
  // **사라질 때까지** 기다린다. 덮개가 남아 있으면 다음 모달을 여는 클릭이 그것에 먹힌다
  // (홈의 월별 그래프가 8초를 기다리다 「열리지 않음」으로 적힌 이유다).
  await page.getByText(m.expect, { exact: false }).first()
    .waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(400)
  return { ...sample, modal: m.label }
}

// ── 보고서 ──────────────────────────────────────────────────────────────────
const n = (v: number) => v.toLocaleString('ko-KR')

function markdown(all: ScreenResult[], meta: Record<string, string>): string {
  const L: string[] = []
  L.push(`# 브라우저 실측 — ${meta.when}`, '')
  L.push(`모드 **${meta.mode}** · 주소 ${meta.base} · 브라우저 Chromium(playwright ${meta.pw})`, '')
  if (meta.mode.startsWith('dev')) {
    L.push('> ⚠ 개발 서버다. React Strict Mode 가 effect 를 두 번 돌리므로 **조회 수가 실제보다 많다**.', '')
  }
  L.push('재는 값: ① 문서 TTFB ② 새로 받은 JS ③ 자료 요청 수(supabase+/api)와 중복 ④ 가장 느린 요청',
    '⑤ 자료 요청 첫 시작→마지막 끝 ⑥ 직렬(앞 요청이 끝난 뒤 시작한 것) 수.', '',
    '「새 JS」는 **그 화면에서 처음 받은** 스크립트만이다 — 공통 덩어리는 먼저 열어 본 화면에서',
    '이미 받아 브라우저 캐시에 있다(그래서 0KB 인 화면이 있다). 「중복」은 같은 조회가 두 번 이상',
    '나간 횟수의 합이고, URL 은 **파라미터 이름까지** 같아야 같은 것으로 센다(값은 적지 않는다).', '')

  L.push('## 화면', '')
  L.push('| 묶음 | 화면 | 경로 | TTFB | 새 JS | 자료 요청 | 중복 | 네트워크 완료 | 직렬 | 가장 느린 요청 |')
  L.push('|---|---|---|---|---|---|---|---|---|---|')
  for (const s of all) {
    const m = s.main
    if (!m) { L.push(`| ${s.group} | ${s.label} | \`${s.path}\` | — | — | — | — | — | — | 열지 못했다 |`); continue }
    const dup = m.dups.reduce((a, d) => a + (d.count - 1), 0)
    L.push(`| ${s.group} | ${s.label}${m.ok ? '' : ' ⚠'} | \`${s.path}\` | ${m.ttfb ?? '—'}ms | ${n(m.jsKB)}KB | ${m.dataReqs} | ${dup || '—'} | ${n(m.networkMs)}ms | ${m.serial} | ${m.slowest ? `${m.slowest.short} ${m.slowest.ms}ms` : '—'} |`)
  }
  L.push('')

  const extras = all.flatMap(s => s.extras.map(e => ({ screen: s.label, e })))
  if (extras.length) {
    L.push('## 탭 전환', '', '| 화면 | 동작 | 걸린 시간 | 자료 요청 | 중복 | 네트워크 | 비고 |', '|---|---|---|---|---|---|---|')
    for (const { screen, e } of extras) {
      // 요청이 없으면 걸린 시간은 **내가 기다린 시간**이다 — 적지 않는다.
      const t = e.dataReqs === 0 ? '요청 없음(화면에서만 거른다)' : `${e.openMs ?? '—'}ms`
      L.push(`| ${screen} | ${e.label} | ${t} | ${e.dataReqs} | ${e.dups.reduce((a, d) => a + d.count - 1, 0) || '—'} | ${n(e.networkMs)}ms | ${e.ok ? '' : e.note ?? ''} |`)
    }
    L.push('')
  }

  const modals = all.flatMap(s => s.modals.map(m => ({ screen: s.label, m })))
  if (modals.length) {
    L.push('## 모달', '', '| 화면 | 모달 | 열리기까지 | 자료 요청 | 중복 | 네트워크 | 비고 |', '|---|---|---|---|---|---|---|')
    for (const { screen, m } of modals) {
      L.push(`| ${screen} | ${m.modal} | ${m.openMs ?? '—'}ms | ${m.dataReqs} | ${m.dups.reduce((a, d) => a + d.count - 1, 0) || '—'} | ${n(m.networkMs)}ms | ${m.ok ? '' : m.note ?? ''} |`)
    }
    L.push('')
  }

  // 중복 요청 목록
  L.push('## 중복 요청 (같은 URL·메서드가 한 화면에서 두 번 이상)', '')
  const dupRows = all.flatMap(s => (s.main?.dups ?? []).map(d => ({ screen: s.label, ...d })))
    .sort((a, b) => b.count - a.count)
  if (dupRows.length === 0) L.push('없다.', '')
  else {
    L.push('| 화면 | 요청 | 횟수 |', '|---|---|---|')
    for (const d of dupRows) L.push(`| ${d.screen} | ${d.short} | ${d.count} |`)
    L.push('')
  }

  // 가장 느린 요청 10개
  L.push('## 가장 느린 요청 10개', '', '| 화면 | 요청 | 시간 | 종류 |', '|---|---|---|---|')
  const slow = all.flatMap(s => (s.main?.requests ?? [])
    .filter(r => r.kind === 'supabase' || r.kind === 'api')
    .map(r => ({ screen: s.label, ...r })))
    .sort((a, b) => b.ms - a.ms).slice(0, 10)
  for (const r of slow) L.push(`| ${r.screen} | ${r.short} | ${r.ms}ms | ${r.kind} |`)
  L.push('')

  if (SKIPPED_MODALS.length) {
    L.push('## 일부러 열지 않은 모달 (읽기 전용 규칙)', '', '| 화면 | 모달 | 이유 |', '|---|---|---|')
    for (const s of SKIPPED_MODALS) L.push(`| ${s.screen} | ${s.modal} | ${s.why} |`)
    L.push('')
  }
  return L.join('\n')
}

// ── 저장해 둔 원자료로 보고서만 다시 쓰기 ──────────────────────────────────
//   node scripts/perf/measure.ts --from docs/perf/2026-10-22-1651.json
// 측정은 운영 DB 에 붙어 돌아가므로 함부로 다시 돌리지 않는다 — 표의 말만 고칠 때 쓴다.
function rewriteFrom(file: string): void {
  const saved = JSON.parse(readFileSync(file, 'utf8')) as {
    meta: Record<string, string>
    results?: ScreenResult[]
    cold?: LoginSample[]
    warm?: LoginSample[]
  }
  // 로그인 흐름 원자료(cold·warm)와 화면 원자료(results)는 보고서가 다르다.
  if (saved.cold && saved.warm) {
    writeFileSync(join(ROOT, 'docs', 'perf', 'login-flow.md'), loginMarkdown(saved.cold, saved.warm, saved.meta))
    console.log(`보고서를 다시 썼다: docs/perf/login-flow.md (원자료 ${file})`)
    return
  }
  writeFileSync(join(ROOT, 'docs', 'perf', 'latest.md'), markdown(saved.results ?? [], saved.meta))
  console.log(`보고서를 다시 썼다: docs/perf/latest.md (원자료 ${file})`)
}

// ── 실행 ────────────────────────────────────────────────────────────────────
async function main() {
  const fromIdx = process.argv.indexOf('--from')
  if (fromIdx > -1 && process.argv[fromIdx + 1]) { rewriteFrom(process.argv[fromIdx + 1]); return }
  const env = envLocal()
  const email = env.E2E_EMAIL
  const password = env.E2E_PASSWORD
  if (!email || !password) throw new Error('.env.local 에 E2E_EMAIL / E2E_PASSWORD 가 없다')

  // 서버가 떠 있는가
  const alive = await fetch(BASE + '/login').then(r => r.ok || r.status < 500).catch(() => false)
  if (!alive) {
    console.error(`서버가 없다: ${BASE}`)
    if (!DEV) {
      console.error('운영과 같은 1회 실행으로 재려면 먼저 두 줄을 돌려라(개발 서버와 폴더가 섞이지 않는다):')
      console.error('  NEXT_DIST_DIR=.next-perf npx next build')
      console.error('  NEXT_DIST_DIR=.next-perf npx next start -p 3100')
      console.error('개발 서버로 재려면: npm run perf:dev  (Strict Mode 때문에 조회 수가 부풀어 보인다)')
    }
    process.exit(1)
  }

  const stampNow = () => {
    const now = new Date()
    const pad = (x: number) => String(x).padStart(2, '0')
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
  }
  const pwVersion = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).devDependencies.playwright

  // ── 로그인 흐름만 재는 길 ────────────────────────────────────────────────
  if (LOGIN_ONLY) {
    const browser = await chromium.launch()
    const cold: LoginSample[] = []
    const warm: LoginSample[] = []
    try {
      for (let i = 1; i <= LOGIN_RUNS; i++) {
        // 회차마다 새 컨텍스트 = 받아 둔 것이 아무것도 없는 첫 방문.
        const c = await browser.newContext({ viewport: { width: 1440, height: 900 } })
        process.stdout.write(`· 찬 캐시 ${i}/${LOGIN_RUNS} … `)
        const a = await measureLogin(c, { email, password, base: BASE, supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL ?? '', cold: true })
        cold.push(a)
        console.log(a.ok ? `조용해짐 ${a.quietAt}ms` : `실패(${a.note})`)
        // 쿠키만 버린다 — JS·문서는 캐시에 남아 있고 세션만 없는 상태.
        await c.clearCookies()
        process.stdout.write(`· 더운 캐시 ${i}/${LOGIN_RUNS} … `)
        const b = await measureLogin(c, { email, password, base: BASE, supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL ?? '', cold: false })
        warm.push(b)
        console.log(b.ok ? `조용해짐 ${b.quietAt}ms` : `실패(${b.note})`)
        await c.close().catch(() => {})
      }
    } finally {
      await browser.close().catch(() => {})
    }
    const stamp = stampNow()
    const dir = join(ROOT, 'docs', 'perf')
    mkdirSync(dir, { recursive: true })
    const meta = { when: stamp.replace(/-(\d{2})(\d{2})$/, ' $1:$2'), mode: DEV ? 'dev (next dev)' : 'start (next start)', base: BASE, pw: pwVersion }
    writeFileSync(join(dir, stamp + '-login.json'), JSON.stringify({ meta, cold, warm }, null, 1))
    writeFileSync(join(dir, 'login-flow.md'), loginMarkdown(cold, warm, meta))
    console.log('\n보고서: docs/perf/login-flow.md · 원자료: docs/perf/' + stamp + '-login.json')
    return
  }

  let browser: Browser | null = null
  let ctx: BrowserContext | null = null
  try {
    browser = await chromium.launch()
    ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    const collector = new Collector(page, env.NEXT_PUBLIC_SUPABASE_URL ?? '')

    // 로그인 — 글자를 넣는 **유일한** 자리다. 값은 찍지 않는다.
    //
    // 수화(hydration)가 끝나기 전에 넣으면 값이 DOM 에만 남고 React 상태는 비어 있다 —
    // 그 상태로 누르면 아무 일도 일어나지 않는다(요청조차 나가지 않는다). 그래서 넣은 뒤
    // **값이 남아 있는지 확인하고**, 비면 다시 넣는다. 세 번까지 해 본다.
    let loggedIn = false
    for (let attempt = 1; attempt <= 3 && !loggedIn; attempt++) {
      await page.goto(BASE + '/login', { waitUntil: 'load' })
      await page.waitForTimeout(800 * attempt)   // 수화를 기다린다(갈수록 넉넉히)
      const id = page.getByPlaceholder('아이디')
      const pw = page.getByPlaceholder('비밀번호')
      await id.fill(email)
      await pw.fill(password)
      if (!(await id.inputValue()) || !(await pw.inputValue())) continue
      await page.getByRole('button', { name: /로그인/ }).click()
      loggedIn = await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 20000 })
        .then(() => true).catch(() => false)
    }
    if (!loggedIn) throw new Error('로그인하지 못했다(서버 상태·계정을 확인하라 — 값은 찍지 않는다). 빌드를 새로 했다면 측정 서버를 다시 띄워라')
    console.log('로그인 성공')
    await collector.quiet()

    const results: ScreenResult[] = []
    for (const s of picked(SCREENS)) {
      process.stdout.write(`· ${s.label} (${s.path}) … `)
      const r = await measureScreen(page, collector, s).catch(err => {
        console.log('실패')
        return { label: s.label, group: s.group, path: s.path, note: String(err).slice(0, 120), main: null, extras: [], modals: [] } as ScreenResult
      })
      results.push(r)
      console.log(r.main ? `요청 ${r.main.dataReqs} · ${r.main.networkMs}ms${r.main.ok ? '' : ' (' + (r.main.note ?? '') + ')'}` : '못 열었다')
    }

    // 목록에서 눌러 들어가는 상세 화면
    for (const d of picked(DETAIL_FROM_LIST)) {
      process.stdout.write(`· ${d.label} … `)
      await page.goto(BASE + d.from, { waitUntil: 'domcontentloaded' }).catch(() => {})
      await collector.quiet()
      // 줄은 자료가 온 뒤에 그려진다 — 네트워크가 조용해진 뒤에도 한 번 더 기다린다.
      if (d.click.kind === 'clickFirst') {
        await page.locator(d.click.selector).first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {})
      }
      collector.clear()
      const before = page.url()
      const click = await safeClick(page, d.click)
      const moved = click.ok
        ? await page.waitForURL(u => d.expectPath.test(u.pathname), { timeout: 10000 }).then(() => true).catch(() => false)
        : false
      await collector.quiet()
      const sample = await collector.take('화면 열기', {
        ok: moved,
        note: moved ? undefined : (click.why ?? `목록에서 상세로 들어가지 못했다(${before} 에 머물렀다)`),
      })
      results.push({ label: d.label, group: d.group, path: moved ? new URL(page.url()).pathname : d.from, note: d.note, main: sample, extras: [], modals: [] })
      console.log(moved ? `요청 ${sample.dataReqs} · ${sample.networkMs}ms` : '못 들어갔다')
    }

    // 파일로
    const now = new Date()
    const pad = (x: number) => String(x).padStart(2, '0')
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
    const dir = join(ROOT, 'docs', 'perf')
    mkdirSync(dir, { recursive: true })
    const pw = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).devDependencies.playwright
    const meta = { when: stamp.replace(/-(\d{2})(\d{2})$/, ' $1:$2'), mode: DEV ? 'dev (next dev)' : 'start (next start)', base: BASE, pw }
    // --only 로 한 화면만 재면 전체 보고서를 덮지 않는다(기준선 비교표가 지워지지 않게).
    const tag = ONLY ? '-only-' + ONLY.replace(/[^a-z0-9가-힣]+/g, '') : ''
    const report = ONLY ? 'latest-only.md' : 'latest.md'
    writeFileSync(join(dir, stamp + tag + '.json'), JSON.stringify({ meta, results }, null, 1))
    writeFileSync(join(dir, report), markdown(results, meta))
    console.log('\n보고서: docs/perf/' + report + ' · 원자료: docs/perf/' + stamp + tag + '.json')
  } finally {
    await ctx?.close().catch(() => {})
    await browser?.close().catch(() => {})
  }
}

main().catch(err => { console.error(String(err)); process.exit(1) })
