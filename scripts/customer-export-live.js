// 고객사 전부 내보내기 — **실측**. 운영 DB 를 읽어 진짜 파일을 만들어 본다 (2026-11-22).
//
//   node scripts/customer-export-live.js [파일을 둘 폴더]
//
// ── 이름이 `-check.js` 가 아닌 이유 ────────────────────────────────────────
//   운영 DB 에 붙는다(service role 키가 필요하다). scripts/run-checks.js 는 키 없이 도는
//   하네스만 돌린다는 약속이 있다(그 파일 머리말). 양식 자체는
//   scripts/customer-export-check.js 가 키 없이 지킨다.
//
// 라우트와 **같은 함수**(lib/customerExportData.ts · lib/customerExportSheets.ts)를 쓴다 —
// 여기서 통과한 것이 사람이 받는 파일과 달라지지 않게.
// 읽기만 한다.

const load = module.require.bind(module)
const path = load('path')
const fs = load('fs')
const Module = load('module')
const ROOT = path.join(__dirname, '..')
const ts = load(path.join(ROOT, 'node_modules/typescript'))

for (const ext of ['.ts', '.tsx']) {
  Module._extensions[ext] = (mod, filename) => {
    mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
        esModuleInterop: true, jsx: ts.JsxEmit.React,
      }, fileName: filename,
    }).outputText, filename)
  }
}
const origResolve = Module._resolveFilename
Module._resolveFilename = function (req, ...rest) {
  if (req.startsWith('@/')) req = path.join(ROOT, req.slice(2))
  return origResolve.call(this, req, ...rest)
}

const pickEnv = (key) => {
  const p = path.join(ROOT, '.env.local')
  if (!fs.existsSync(p)) return null
  const m = fs.readFileSync(p, 'utf8').match(new RegExp('^' + key + '=(.*)$', 'm'))
  return m ? m[1].trim() : null
}

let fail = 0
const ok = (name, cond, hint) => {
  if (cond) console.log(`OK   ${name}`)
  else { fail++; console.error(`FAIL ${name}${hint ? `  — ${hint}` : ''}`) }
}

;(async () => {
  const url = pickEnv('NEXT_PUBLIC_SUPABASE_URL')
  const key = pickEnv('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) { console.log('SKIP — .env.local 에 키가 없다(이 도구는 운영 DB 에 붙는다)'); process.exit(0) }

  const { createClient } = await import('file://' + path.join(ROOT, 'node_modules/@supabase/supabase-js/dist/index.mjs').split(path.sep).join('/'))
  const ExcelJS = load(path.join(ROOT, 'node_modules/exceljs'))
  const { gatherCustomerExport } = load(path.join(ROOT, 'lib/customerExportData.ts'))
  const { EXPORT_UNITS, UNIT_LABEL, buildCustomerSheet, customerExportFileName, rowCountOf, sheetWidths } = load(path.join(ROOT, 'lib/customerExportSheets.ts'))

  const sb = createClient(url, key)

  // 화면이 보내는 것과 같은 범위 — 필터 없이 전체를 보는 경우다(목록 보기의 사업장 줄).
  const { data: rows, error } = await sb
    .from('customers')
    .select('customer_id, is_parent, is_agency, parent_customer_id')
    .is('deleted_at', null).range(0, 10000)
  if (error) { console.error('고객 표를 읽지 못했다:', error.message); process.exit(1) }
  // 목록 보기에 서는 줄 = 회사 줄이 아니고, **대리점 전용 줄**도 아니다(lib/customerAgency.ts).
  const siteIds = rows
    .filter(r => !r.is_parent && !(r.is_agency && r.parent_customer_id == null))
    .map(r => Number(r.customer_id))
  console.log(`\n내보낼 사업장 ${siteIds.length}곳(필터 없음 = 전체)`)

  const t0 = Date.now()
  const got = await gatherCustomerExport(sb, siteIds)
  if ('error' in got) { console.error('모으지 못했다:', got.error); process.exit(1) }
  const ms = Date.now() - t0
  console.log(`모으는 데 ${ms}ms — 사업장 ${got.data.sites.length} · 회사 ${got.data.companies.length} · 대리점 ${got.data.agencies.length}`)

  const withDev = got.data.sites.filter(x => x.devices.length > 0).length
  const devTotal = got.data.sites.reduce((n, x) => n + x.devices.length, 0)
  console.log(`장비 있는 사업장 ${withDev}곳 · 장비 ${devTotal}대 · 장비 없는 사업장 ${got.data.sites.length - withDev}곳`)

  console.log('\n── 단위별 줄 수·열 수 ──')
  console.log('     단위          예상   실제   열(담당자 켬)  열(담당자 끔)  파일 이름')
  const outDir = process.argv[2] || path.join(ROOT, '.tmp-export')
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })

  for (const unit of EXPORT_UNITS) {
    const want = rowCountOf(got.data, unit)
    const on = buildCustomerSheet(got.data, unit, true)
    const off = buildCustomerSheet(got.data, unit, false)
    const name = customerExportFileName(unit)
    console.log(`     ${UNIT_LABEL[unit].padEnd(10)} ${String(want).padStart(5)} ${String(on.rows.length - 1).padStart(6)} ${String(on.rows[0].length).padStart(13)} ${String(off.rows[0].length).padStart(13)}  ${name}`)
    ok(`${UNIT_LABEL[unit]} — 예상 줄 수와 실제가 같다`, want === on.rows.length - 1, `${want} ≠ ${on.rows.length - 1}`)
    ok(`${UNIT_LABEL[unit]} — 담당자를 꺼도 줄 수는 같다`, off.rows.length === on.rows.length)
    ok(`${UNIT_LABEL[unit]} — 줄마다 열 수가 같다(켬)`, on.rows.every(r => r.length === on.rows[0].length))
    ok(`${UNIT_LABEL[unit]} — 줄마다 열 수가 같다(끔)`, off.rows.every(r => r.length === off.rows[0].length))

    // 진짜 파일을 만들어 다시 읽어 본다(서식이 깨지지 않았는지).
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet(on.name, { views: [{ state: 'frozen', ySplit: 1 }] })
    for (const row of on.rows) ws.addRow(row)
    const widths = sheetWidths(on.rows)
    ws.columns.forEach((col, i) => { col.width = widths[i] ?? 10 })
    ws.getRow(1).font = { bold: true }
    ws.eachRow((row, n) => {
      if (n === 1) return
      row.eachCell(cell => { if (cell.value instanceof Date) cell.numFmt = 'yyyy-mm-dd' })
    })
    const file = path.join(outDir, name)
    await wb.xlsx.writeFile(file)
    const back = new ExcelJS.Workbook()
    await back.xlsx.readFile(file)
    const sheet = back.worksheets[0]
    ok(`${UNIT_LABEL[unit]} — 시트 하나로 읽힌다(${sheet.name})`,
      back.worksheets.length === 1 && sheet.name === UNIT_LABEL[unit])
    ok(`${UNIT_LABEL[unit]} — 머리줄 고정·굵게`,
      sheet.views?.[0]?.state === 'frozen' && sheet.getRow(1).font?.bold === true)
    console.log(`       ${(fs.statSync(file).size / 1024).toFixed(0)}KB · 머리줄: ${sheet.getRow(1).values.slice(1, 7).join(' | ')}…`)
  }


  console.log(fail === 0 ? '\n전부 통과' : `\n${fail}건 실패`)
  process.exit(fail === 0 ? 0 : 1)
})()
