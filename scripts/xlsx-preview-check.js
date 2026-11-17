// 엑셀 미리보기 규칙 시험 — 어떤 파일을 미리 보여 주고 어떤 파일은 받게 하는가.
//
//   node scripts/xlsx-preview-check.js
//
// 왜 따로 두는가 — 미리보기는 **사본**이라, 보여 줄 수 없는 형식을 조용히 빈 화면으로
// 내놓으면 사람이 파일이 깨진 줄 안다. 어떤 형식을 막고 어디서 잘라 보여 주는지는
// 글로 적어 둔 약속이라 시험으로 고정한다(components/xlsx/XlsxPreviewModal.tsx).

// eslint 의 no-require-imports 는 맨 require() 를 센다. node 로 직접 돌리는 CJS 라
// 그렇게 부를 수밖에 없다 — 한 번만 묶어 두고 그것만 쓴다.
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
        esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX,
      }, fileName: filename,
    }).outputText, filename)
  }
}
const origResolve = Module._resolveFilename
Module._resolveFilename = function (req, ...rest) {
  if (req.startsWith('@/')) req = path.join(ROOT, req.slice(2))
  return origResolve.call(this, req, ...rest)
}

const X = load(path.join(ROOT, 'components/xlsx/XlsxPreviewModal.ts' + 'x'))

let fails = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
}

console.log('── 미리보기 되는 형식 ──')
eq('xlsx 는 본다', X.previewBlockReason('見積申込書.xlsx'), null)
eq('xlsm(매크로)도 본다', X.previewBlockReason('양식.xlsm'), null)
eq('대문자 확장자도 본다', X.previewBlockReason('FORM.XLSX'), null)

console.log('\n── 못 보는 형식은 **이유를 적는다** ──')
eq('구형 엑셀', X.previewBlockReason('옛양식.xls'), '구형 엑셀(.xls)은 미리보기할 수 없습니다.')
eq('CSV', X.previewBlockReason('목록.csv'), 'CSV 는 미리보기할 수 없습니다.')
eq('그 밖', X.previewBlockReason('메일.eml'), '이 형식은 미리보기할 수 없습니다.')
eq('이름이 없으면', X.previewBlockReason(''), '이 형식은 미리보기할 수 없습니다.')

console.log('\n── 자르는 기준 ──')
eq('큰 파일 기준은 5MB', X.XLSX_BIG_BYTES, 5 * 1024 * 1024)
eq('한 시트에서 그리는 줄', X.XLSX_MAX_ROWS, 1000)
eq('큰 파일은 더 적게', X.XLSX_BIG_MAX_ROWS, 200)
eq('큰 파일 기준이 더 적은 줄과 짝이 맞다', X.XLSX_BIG_MAX_ROWS < X.XLSX_MAX_ROWS, true)

console.log(fails === 0 ? '\n모두 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
