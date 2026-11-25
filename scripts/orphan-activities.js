/**
 * **고아 활동 점검** — 리드 번호를 품었는데 그 리드가 없는 영업활동 (2026-11-26).
 *
 *   node scripts/orphan-activities.js            목록만 보여 준다
 *   node scripts/orphan-activities.js --all      리드가 살아 있는 줄까지 전부
 *
 * ── 무엇을 보나 ──────────────────────────────────────────────────────────
 *   sales_activities 의 내용 첫 줄에 「[리드 LD-26-0xx]」 꼴의 번호를 적어 둔 줄이 있다.
 *   그 번호의 리드가 지워졌거나 번호가 바뀌었으면 그 활동은 **갈 곳을 잃는다** —
 *   화면에서는 그냥 글자라 아무도 눈치채지 못한다. 그 줄을 찾아 적어 둔다.
 *
 * ── 지우지 않는다 ────────────────────────────────────────────────────────
 *   사람이 쓴 영업활동일 수 있다(실제로 운영의 그 줄들은 **방문미팅**이고 내용도 사람이
 *   쓴 상담 기록이다). 번호만 남은 것을 보고 지우면 영업 기록이 사라진다 —
 *   **목록만** 내고, 지우는 일은 사람이 판단한다.
 *
 * 읽기 전용이고 **service role 열쇠가 필요하다**(.env.local). 그래서 npm run check 의
 * 하네스가 아니라 손으로 부르는 점검 스크립트다(이름이 -check.js 가 아니다).
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const ALL = process.argv.includes('--all')

const env = {}
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim())
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const U = env.NEXT_PUBLIC_SUPABASE_URL
const K = env.SUPABASE_SERVICE_ROLE_KEY
if (!U || !K) { console.error('.env.local 에 주소·열쇠가 없다'); process.exit(1) }

/** 몇 번씩 끊긴다 — 세 번까지 다시 묻는다. */
const get = async (p) => {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`${U}/rest/v1/${p}`, { headers: { apikey: K, Authorization: `Bearer ${K}` } })
      if (!r.ok) throw new Error(String(r.status))
      return await r.json()
    } catch { /* 다시 */ }
  }
  return null
}

/** 내용에서 리드 번호를 꺼낸다 — 「[리드 LD-26-024]」·「LD-26-024」 둘 다 본다. */
const leadNoOf = (text) => (/\b(LD-\d{2}-\d{3,})\b/.exec(String(text ?? '')) || [])[1] ?? null

;(async () => {
  const acts = await get('sales_activities?select=activity_id,activity_type,activity_date,customer_id,engineer_id,content&content=ilike.*LD-*&order=activity_date.desc&limit=500')
  if (!acts) { console.error('영업활동을 읽지 못했다'); process.exit(1) }
  const leads = await get('leads?select=lead_id,lead_no,status&limit=2000')
  if (!leads) { console.error('리드를 읽지 못했다'); process.exit(1) }
  const live = new Map(leads.map(l => [String(l.lead_no), l]))

  const rows = acts.map(a => ({ ...a, leadNo: leadNoOf(a.content) })).filter(a => a.leadNo)
  const orphans = rows.filter(a => !live.has(a.leadNo))
  const kept = rows.filter(a => live.has(a.leadNo))

  console.log(`\n── 리드 번호를 품은 영업활동 ${rows.length}건 ──`)
  console.log(`   리드가 살아 있는 줄 ${kept.length} · **고아 ${orphans.length}**`)

  const line = a => [
    `#${a.activity_id}`,
    a.activity_date ?? '날짜 없음',
    a.activity_type ?? '종류 없음',
    a.leadNo,
    `고객사 ${a.customer_id ?? '-'}`,
    String(a.content ?? '').replace(/\s+/g, ' ').slice(0, 50),
  ].join(' · ')

  if (orphans.length > 0) {
    console.log('\n   ── 고아(그 번호의 리드가 없다) ──')
    for (const a of orphans) console.log(`   ${line(a)}`)
    console.log('\n   ⚠ **지우지 않는다.** 사람이 쓴 상담 기록일 수 있다 — 위 목록을 보고 사람이 정한다.')
  } else {
    console.log('\n   고아 없음.')
  }

  if (ALL && kept.length > 0) {
    console.log('\n   ── 리드가 살아 있는 줄 ──')
    for (const a of kept) console.log(`   ${line(a)} (리드 ${live.get(a.leadNo).status})`)
  }

  // 종류별로도 세어 둔다 — 자동으로 만들던 「리드 등록」이 남아 있는지 한눈에 본다.
  const byType = {}
  for (const a of rows) byType[a.activity_type ?? '(없음)'] = (byType[a.activity_type ?? '(없음)'] ?? 0) + 1
  console.log('\n   종류별: ' + (Object.entries(byType).map(([k, v]) => `${k} ${v}`).join(' · ') || '없음'))
  const autoLeft = await get('sales_activities?select=activity_id&activity_type=eq.' + encodeURIComponent('리드 등록'))
  console.log(`   「리드 등록」 종류의 자동 줄: ${autoLeft ? autoLeft.length : '읽지 못함'}건`)
})()
