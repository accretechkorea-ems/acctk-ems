// 고객사 전부 내보내기 — **실측**. 운영 DB 를 읽어 진짜 파일을 만들어 본다 (2026-11-22).
//
//   node scripts/customer-export-live.js [내보낼 파일 경로]
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
  const { buildCustomerSheets, customerExportFileName, sheetWidths } = load(path.join(ROOT, 'lib/customerExportSheets.ts'))

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
  const sheets = buildCustomerSheets(got.data)
  const ms = Date.now() - t0

  console.log('\n── 시트별 줄 수(머리줄 뺀 수) ──')
  for (const s of sheets) console.log(`     ${s.name.padEnd(4)} ${String(s.rows.length - 1).padStart(5)}줄 · ${s.rows[0].length}열`)
  ok('사업장 줄 수가 보낸 id 수와 같다', sheets[0].rows.length - 1 === siteIds.length,
    `${sheets[0].rows.length - 1} ≠ ${siteIds.length}`)
  ok('모든 시트에서 줄마다 열 수가 같다',
    sheets.every(s => s.rows.every(r => r.length === s.rows[0].length)))

  const contactCols = sheets[0].rows[0].length - 18
  console.log(`     사업장 담당자 열 ${contactCols}개 = 가장 많은 줄 ${contactCols / 5}명 × 5`)
  ok('담당자 열은 5의 배수', contactCols % 5 === 0)

  const wb = new ExcelJS.Workbook()
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name, { views: [{ state: 'frozen', ySplit: 1 }] })
    for (const row of sheet.rows) ws.addRow(row)
    const widths = sheetWidths(sheet.rows)
    ws.columns.forEach((col, i) => { col.width = widths[i] ?? 10 })
    ws.getRow(1).font = { bold: true }
    ws.eachRow((row, n) => {
      if (n === 1) return
      row.eachCell(cell => { if (cell.value instanceof Date) cell.numFmt = 'yyyy-mm-dd' })
    })
  }
  const out = process.argv[2] || path.join(ROOT, '.tmp-' + customerExportFileName())
  await wb.xlsx.writeFile(out)
  const size = fs.statSync(out).size
  console.log(`\n파일 ${out} · ${(size / 1024).toFixed(0)}KB · 모으고 만드는 데 ${ms}ms`)

  // 다시 읽어 본다 — 쓴 것이 읽히는지(서식이 깨지지 않았는지).
  const back = new ExcelJS.Workbook()
  await back.xlsx.readFile(out)
  ok('시트 넷이 그대로 읽힌다', back.worksheets.map(w => w.name).join(',') === '사업장,회사,대리점,장비',
    back.worksheets.map(w => w.name).join(','))
  const site = back.getWorksheet('사업장')
  ok('머리줄이 고정되어 있다', site.views?.[0]?.state === 'frozen' && site.views?.[0]?.ySplit === 1)
  ok('머리줄이 굵다', site.getRow(1).font?.bold === true)
  const dateCell = site.getRow(2).getCell(13).value
  console.log(`     보기 — 첫 줄: ${site.getRow(2).values.slice(1, 6).join(' · ')}`)
  console.log(`     최근 활동일 칸 형식: ${dateCell instanceof Date ? 'Date' : typeof dateCell} (${dateCell ?? '빈 칸'})`)

  console.log(fail === 0 ? '\n전부 통과' : `\n${fail}건 실패`)
  process.exit(fail === 0 ? 0 : 1)
})()
