/**
 * 가격표의 **장비 품명 594개**를 라인업·모델·구성으로 갈라 두 벌을 만든다 (2026-11-26).
 *
 *   node scripts/equipment-master-parse.js
 *     → docs/equipment-master-seed-20261126.md   (전량 표 · 규칙 · 애매한 줄)
 *     → db/equipment_master_20261126.sql 의 시드 부분(파일 안의 자리표시를 채운다)
 *
 * 읽는 것은 `price_list` 의 **CMM Main body · SFG Main** 두 시트이고, 세는 단위는
 * **품명(item_name_jp) 중복을 뺀 것**이다(1,229줄 → 594개. 같은 품명이 사양·지역별로
 * 여러 품번을 갖는다).
 *
 * service role 열쇠가 필요하다(.env.local) — 읽기만 한다. 그래서 npm run check 의
 * 하네스가 아니라 손으로 부르는 스크립트다.
 */
const fs = require('fs')
const path = require('path')
const Module = require('module')

const ROOT = path.join(__dirname, '..')
const ts = require(path.join(ROOT, 'node_modules/typescript'))
for (const ext of ['.ts']) {
  Module._extensions[ext] = (mod, filename) => {
    mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
      fileName: filename,
    }).outputText, filename)
  }
}
const { parseEquipmentName, brandOf, seriesOf } = require(path.join(ROOT, 'lib/equipmentName.ts'))

const SHEETS = ['CMM Main body', 'SFG Main']

const env = {}
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim())
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const U = env.NEXT_PUBLIC_SUPABASE_URL
const K = env.SUPABASE_SERVICE_ROLE_KEY

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

/** SQL 문자열 — 작은따옴표만 막으면 된다. */
const q = s => `'${String(s).replace(/'/g, "''")}'`

;(async () => {
  let rows = []
  for (const sh of SHEETS) {
    for (let off = 0; ; off += 500) {
      const got = await get(`price_list?select=item_code,item_name_jp,sheet_name&sheet_name=eq.${encodeURIComponent(sh)}&order=item_code&offset=${off}&limit=500`)
      if (!got || got.length === 0) break
      rows = rows.concat(got)
      if (got.length < 500) break
    }
  }
  if (rows.length === 0) { console.error('가격표를 읽지 못했다'); process.exit(1) }

  // 품명 하나에 품번 여럿 — 품번은 모아서 적는다(어느 줄에서 왔는지 보이게).
  const byName = new Map()
  for (const r of rows) {
    const name = String(r.item_name_jp ?? '').trim()
    if (!name) continue
    if (!byName.has(name)) byName.set(name, { name, codes: [], sheet: r.sheet_name })
    byName.get(name).codes.push(r.item_code)
  }
  const names = [...byName.values()]
  const parsed = names.map(n => ({ ...n, p: parseEquipmentName(n.name) }))
  parsed.sort((a, b) => a.p.lineup.localeCompare(b.p.lineup) || String(a.p.model).localeCompare(String(b.p.model)) || a.name.localeCompare(b.name))

  const lineups = [...new Set(parsed.map(x => x.p.lineup))].sort()
  const vague = parsed.filter(x => !x.p.sure)
  const byRule = {}
  for (const x of parsed) byRule[x.p.rule] = (byRule[x.p.rule] ?? 0) + 1

  // ── 문서 ────────────────────────────────────────────────────────────
  const doc = []
  doc.push('# 장비 라인업 마스터 — 가격표 파싱 전량 (2026-11-26)')
  doc.push('')
  doc.push('`price_list` 의 **CMM Main body · SFG Main** 두 시트에서 품명을 뽑아')
  doc.push('2026-11-19 규칙(라인업 = 브랜드+시리즈 / 모델 = 규격 / 구성 = 사양 코드)으로 갈랐다.')
  doc.push('')
  doc.push(`- 원문 줄 **${rows.length}** (같은 품명이 사양·지역별로 여러 품번을 갖는다)`)
  doc.push(`- 품명(중복 뺀) **${names.length}**  ← 이 문서의 표`)
  doc.push(`- 라인업 **${lineups.length}** · 확신 **${parsed.length - vague.length}** · **판단 필요 ${vague.length}**`)
  doc.push('')
  doc.push('## 규칙과 적용 수')
  doc.push('')
  doc.push('| 규칙 | 보기 | 수 |')
  doc.push('|---|---|---|')
  const RULE_EX = {
    'A 규격+구성': '`SURFCOM NEX 040 DX2-12` → NEX / 040 / DX2-12',
    'B 빗금규격+구성': '`XYZAX AXCEL 7/5/5 PH C2` → AXCEL / 7/5/5 / PH C2',
    'C 빗금규격-구성': '`XYZAX SVF NEX 4/4/3-C1` → SVF NEX / 4/4/3 / C1',
    'D 규격-코드': '`SURFCOM 1400G-11` → SURFCOM / 1400G / 11 — **코드가 구성인지 규격의 일부인지 모른다**',
    'E 규격만': '`HANDYSURF+ 35` → HANDYSURF+ / 35 / —',
    'F 구성만': '`Opt-scope S NEX DX-12` → Opt-scope S NEX / — / DX-12 — **규격이 없다**',
    'G 끝낱말=모델': '`Opt-scope S+` → Opt-scope / S+ / — — **끝 낱말을 모델로 본 것**',
    'G 한 낱말': '낱말 하나뿐',
  }
  for (const [rule, n] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) {
    doc.push(`| ${rule} | ${RULE_EX[rule] ?? ''} | ${n} |`)
  }
  doc.push('')
  doc.push('## 라인업 한눈에')
  doc.push('')
  doc.push('| 라인업 | 브랜드 | 시리즈 | 품명 수 | 모델 |')
  doc.push('|---|---|---|---|---|')
  for (const lu of lineups) {
    const mine = parsed.filter(x => x.p.lineup === lu)
    const models = [...new Set(mine.map(x => x.p.model).filter(Boolean))]
    doc.push(`| \`${lu}\` | ${brandOf(lu)} | ${seriesOf(lu) || '—'} | ${mine.length} | ${models.slice(0, 12).join(' · ')}${models.length > 12 ? ` … (${models.length})` : ''} |`)
  }
  doc.push('')
  doc.push(`## 판단 필요 ${vague.length}건`)
  doc.push('')
  doc.push('규칙으로 **가장 그럴듯하게** 넣어 두었다(시드에도 들어간다 — `pending = true`).')
  doc.push('아래 줄만 사람이 보고 고치면 된다.')
  doc.push('')
  doc.push('| 원문 품명 | 라인업 | 모델 | 구성 | 왜 애매한가 |')
  doc.push('|---|---|---|---|---|')
  for (const x of vague) {
    doc.push(`| \`${x.name}\` | ${x.p.lineup} | ${x.p.model ?? '—'} | ${x.p.config ?? '—'} | ${x.p.rule} |`)
  }
  doc.push('')
  doc.push('## 전량')
  doc.push('')
  doc.push('| # | 품번(첫 것) | 원문 품명 | 라인업 | 모델 | 구성 | 확신 |')
  doc.push('|---|---|---|---|---|---|---|')
  parsed.forEach((x, i) => {
    doc.push(`| ${i + 1} | \`${x.codes[0]}\`${x.codes.length > 1 ? ` 외 ${x.codes.length - 1}` : ''} | ${x.name} | ${x.p.lineup} | ${x.p.model ?? '—'} | ${x.p.config ?? '—'} | ${x.p.sure ? '높음' : '**판단 필요**'} |`)
  })
  doc.push('')
  fs.writeFileSync(path.join(ROOT, 'docs/equipment-master-seed-20261126.md'), doc.join('\n'), 'utf8')

  // ── 시드 SQL ────────────────────────────────────────────────────────
  const sql = []
  sql.push('-- ══ 시드 — scripts/equipment-master-parse.js 가 만든 줄(손으로 고치지 말 것) ══')
  sql.push('-- 품명 ' + names.length + '개 · 라인업 ' + lineups.length + '개 · 판단 필요 ' + vague.length + '개')
  sql.push('')
  lineups.forEach((lu, i) => {
    const mine = parsed.filter(x => x.p.lineup === lu)
    const pending = mine.some(x => !x.p.sure)
    sql.push(`insert into public.equipment_lineups (name, line, brand, series, sort, pending) values (${q(lu)}, '80', ${q(brandOf(lu))}, ${q(seriesOf(lu))}, ${(i + 1) * 10}, ${pending}) on conflict (name) do nothing;`)
  })
  sql.push('')
  const models = new Map()
  for (const x of parsed) {
    if (!x.p.model) continue
    const key = `${x.p.lineup}|${x.p.model}`
    if (!models.has(key)) models.set(key, { lineup: x.p.lineup, model: x.p.model, pending: false })
    if (!x.p.sure) models.get(key).pending = true
  }
  for (const m of models.values()) {
    sql.push(`insert into public.equipment_models (lineup_id, name, pending) select id, ${q(m.model)}, ${m.pending} from public.equipment_lineups where name = ${q(m.lineup)} on conflict (lineup_id, name) do nothing;`)
  }
  sql.push('')
  const configs = new Map()
  for (const x of parsed) {
    if (!x.p.config) continue
    const key = `${x.p.lineup}|${x.p.model ?? ''}|${x.p.config}`
    if (!configs.has(key)) configs.set(key, { lineup: x.p.lineup, model: x.p.model, config: x.p.config, pending: false })
    if (!x.p.sure) configs.get(key).pending = true
  }
  for (const c of configs.values()) {
    if (c.model) {
      sql.push(`insert into public.equipment_configs (model_id, name, pending) select m.id, ${q(c.config)}, ${c.pending} from public.equipment_models m join public.equipment_lineups l on l.id = m.lineup_id where l.name = ${q(c.lineup)} and m.name = ${q(c.model)} on conflict (model_id, name) do nothing;`)
    }
    // 모델이 없는 구성(규칙 F)은 모델 줄이 없어 넣지 않는다 — 문서의 「판단 필요」에 남는다.
  }
  sql.push('')
  const seedPath = path.join(ROOT, 'db/equipment_master_20261126.sql')
  const MARK_A = '-- <<SEED_START>>'
  const MARK_B = '-- <<SEED_END>>'
  let file = fs.readFileSync(seedPath, 'utf8')
  const a = file.indexOf(MARK_A), b = file.indexOf(MARK_B)
  if (a < 0 || b < 0) { console.error('SQL 파일에 시드 자리표시가 없다'); process.exit(1) }
  file = file.slice(0, a + MARK_A.length) + '\n' + sql.join('\n') + '\n' + file.slice(b)
  fs.writeFileSync(seedPath, file, 'utf8')

  console.log(`원문 ${rows.length} · 품명 ${names.length} · 라인업 ${lineups.length} · 모델 ${models.size} · 구성 ${configs.size} · 판단 필요 ${vague.length}`)
  console.log('→ docs/equipment-master-seed-20261126.md')
  console.log('→ db/equipment_master_20261126.sql (시드 채움)')
})()
