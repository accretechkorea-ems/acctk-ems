/**
 * 기존 장비를 **마스터와 대조**한다 — 갱신은 하지 않는다 (2026-11-26).
 *
 *   node scripts/equipment-master-match.js
 *     → docs/equipment-master-match-20261126.md
 *
 * 세 갈래로 나눈다.
 *   일치     라인업·모델이 마스터에 **그대로** 있다(구성까지 맞으면 「구성까지」).
 *   부분일치 라인업은 있는데 모델이 없다(또는 띄어쓰기·대소문자만 다르다).
 *   불일치   라인업조차 없다 — 옛 기종이거나 적는 법이 아주 다르다.
 *
 * 마스터 표가 아직 없으면(SQL 전) **가격표에서 그 자리에서 만들어** 대조한다 —
 * 그래야 SQL 을 돌리기 전에도 「얼마나 맞을지」를 볼 수 있다.
 *
 * 읽기만 한다(service role). 하네스가 아니라 손으로 부르는 스크립트다.
 */
const fs = require('fs')
const path = require('path')
const Module = require('module')

const ROOT = path.join(__dirname, '..')
const ts = require(path.join(ROOT, 'node_modules/typescript'))
Module._extensions['.ts'] = (mod, filename) => {
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
  }).outputText, filename)
}
const { parseEquipmentName, normKey } = require(path.join(ROOT, 'lib/equipmentName.ts'))

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
      if (!r.ok) return null
      return await r.json()
    } catch { /* 다시 */ }
  }
  return null
}
const page = async (p) => {
  let out = []
  for (let off = 0; ; off += 500) {
    const got = await get(`${p}&offset=${off}&limit=500`)
    if (!got || got.length === 0) break
    out = out.concat(got)
    if (got.length < 500) break
  }
  return out
}

;(async () => {
  // ── 마스터 ──
  let lineups = await get('equipment_lineups?select=id,name')
  let models = []
  let configs = []
  let source = '표(equipment_lineups)'
  if (lineups) {
    models = await page('equipment_models?select=id,lineup_id,name&order=id')
    configs = await page('equipment_configs?select=model_id,name&order=id')
  } else {
    // 표가 아직 없다 — 가격표에서 그 자리에서 만든다.
    source = '가격표(price_list — 표가 아직 없다)'
    const rows = []
    for (const sh of ['CMM Main body', 'SFG Main']) {
      rows.push(...await page(`price_list?select=item_name_jp&sheet_name=eq.${encodeURIComponent(sh)}&order=item_code`))
    }
    const names = [...new Set(rows.map(r => String(r.item_name_jp ?? '').trim()).filter(Boolean))]
    const luMap = new Map(); const moMap = new Map(); let id = 1
    for (const n of names) {
      const p = parseEquipmentName(n)
      if (!luMap.has(p.lineup)) luMap.set(p.lineup, id++)
      if (p.model) {
        const key = `${p.lineup}|${p.model}`
        if (!moMap.has(key)) moMap.set(key, { id: id++, lineup_id: luMap.get(p.lineup), name: p.model })
      }
      if (p.model && p.config) {
        configs.push({ model_id: moMap.get(`${p.lineup}|${p.model}`).id, name: p.config })
      }
    }
    lineups = [...luMap.entries()].map(([name, lid]) => ({ id: lid, name }))
    models = [...moMap.values()]
  }

  const luByKey = new Map(lineups.map(l => [normKey(l.name), l]))
  const moByKey = new Map(models.map(m => [`${m.lineup_id}|${normKey(m.name)}`, m]))
  const cfByKey = new Set(configs.map(c => `${c.model_id}|${normKey(c.name)}`))

  // ── 장비 ──
  const devices = await page('devices?select=device_id,device_name,device_name2,option,customer_id,deleted_at&order=device_id')
  const live = devices.filter(d => !d.deleted_at)

  const rows = live.map(d => {
    const lineup = String(d.device_name ?? '').trim()
    const model = String(d.device_name2 ?? '').trim()
    const config = String(d.option ?? '').trim()
    const lu = luByKey.get(normKey(lineup)) ?? null
    const mo = lu ? moByKey.get(`${lu.id}|${normKey(model)}`) ?? null : null
    const cfOk = mo ? (!config || cfByKey.has(`${mo.id}|${normKey(config)}`)) : false
    const grade = !lu ? '불일치' : (!mo ? '부분일치' : (cfOk ? '일치(구성까지)' : '일치(구성 다름)'))
    return { ...d, lineup, model, config, grade, luName: lu?.name ?? null, moName: mo?.name ?? null }
  })

  const count = g => rows.filter(r => r.grade === g).length
  const grades = ['일치(구성까지)', '일치(구성 다름)', '부분일치', '불일치']

  const doc = []
  doc.push('# 기존 장비 ↔ 라인업 마스터 대조 (2026-11-26)')
  doc.push('')
  doc.push('**갱신하지 않는다** — 지금 얼마나 맞는지만 센다. 고치는 일은 사람이 정한다.')
  doc.push('')
  doc.push(`- 마스터 출처: ${source} — 라인업 ${lineups.length} · 모델 ${models.length} · 구성 ${configs.length}`)
  doc.push(`- 장비(숨긴 줄 제외) **${live.length}** / 전체 ${devices.length}`)
  doc.push('')
  doc.push('| 갈래 | 수 | 비율 |')
  doc.push('|---|---|---|')
  for (const g of grades) doc.push(`| ${g} | ${count(g)} | ${(count(g) / Math.max(1, live.length) * 100).toFixed(1)}% |`)
  doc.push('')

  // 라인업 글자별로 묶어 본다 — 고칠 때는 줄 하나가 아니라 **그 이름 전부**를 고친다.
  const byLineup = new Map()
  for (const r of rows) {
    const k = r.lineup || '(빈 값)'
    if (!byLineup.has(k)) byLineup.set(k, { name: k, n: 0, grade: r.grade, luName: r.luName })
    byLineup.get(k).n++
  }
  doc.push('## 장비에 적힌 라인업 글자 — 많은 순')
  doc.push('')
  doc.push('| 장비에 적힌 라인업 | 대수 | 갈래 | 마스터의 이름 |')
  doc.push('|---|---|---|---|')
  for (const v of [...byLineup.values()].sort((a, b) => b.n - a.n)) {
    doc.push(`| \`${v.name}\` | ${v.n} | ${v.grade} | ${v.luName ?? '—'} |`)
  }
  doc.push('')
  doc.push('## 불일치·부분일치 전량')
  doc.push('')
  doc.push('| device_id | 사업장 | 라인업 | 모델 | 구성 | 갈래 |')
  doc.push('|---|---|---|---|---|---|')
  for (const r of rows.filter(r => r.grade === '불일치' || r.grade === '부분일치')) {
    doc.push(`| ${r.device_id} | ${r.customer_id ?? '—'} | ${r.lineup || '—'} | ${r.model || '—'} | ${r.config || '—'} | ${r.grade} |`)
  }
  doc.push('')
  fs.writeFileSync(path.join(ROOT, 'docs/equipment-master-match-20261126.md'), doc.join('\n'), 'utf8')

  console.log(`장비 ${live.length}대 · ` + grades.map(g => `${g} ${count(g)}`).join(' · '))
  console.log('→ docs/equipment-master-match-20261126.md')
})()
