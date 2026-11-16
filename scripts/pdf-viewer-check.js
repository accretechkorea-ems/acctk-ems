// PDF 모달 뷰어 **창 치수** 시험 — A4 비율·세로 96%·가로 상한 95%.
//
//   node scripts/pdf-viewer-check.js
//
// 왜 따로 두는가 — 창을 넓게 잡으면 브라우저 PDF 뷰어가 쪽 좌우를 제 배경색으로 채워
// 검은 띠가 생긴다. 그 띠를 없애는 유일한 방법이 **창을 문서 비율로 잡는 것**이라,
// 숫자 하나가 틀어지면 조용히 띠가 돌아온다. 그리지 않고 규칙 함수만 돌린다.

// eslint 의 no-require-imports 는 맨 require() 를 센다. node 로 직접 돌리는 CJS 라
// 그렇게 부를 수밖에 없다 — 한 번만 묶어 두고 그것만 쓴다.
const load = module.require.bind(module)
const path = load('path')
const Module = load('module')
const ROOT = path.join(__dirname, '..')
const ts = load(path.join(ROOT, 'node_modules/typescript'))

Module._extensions['.ts'] = (mod, filename) => {
  mod._compile(ts.transpileModule(load('fs').readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
  }).outputText, filename)
}

const V = load(path.join(ROOT, 'lib/pdfViewer.ts'))

let fails = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
}
/** 본문이 A4 비율인가 — 가로에서 스크롤바를 뺀 값과 세로의 비(소수 둘째 자리까지). */
const ratio = box => Math.round(((box.width - V.SCROLLBAR_W) / box.bodyHeight) * 100) / 100
const A4 = Math.round(V.A4_RATIO * 100) / 100

console.log('── 창 치수 ──')
for (const [vw, vh] of [[1920, 1080], [1366, 768], [2560, 1440], [1280, 1024]]) {
  const box = V.pdfViewerBox(vw, vh)
  eq(`${vw}×${vh} — 세로는 화면의 96%`, box.height, Math.round(vh * V.VIEWER_VH))
  eq(`${vw}×${vh} — 본문이 A4 비율`, ratio(box), A4)
  eq(`${vw}×${vh} — 가로 상한 안`, box.width <= Math.round(vw * V.VIEWER_MAX_VW), true)
}

console.log('\n── 좁은 화면(가로 상한에 걸릴 때) ──')
const narrow = V.pdfViewerBox(420, 900)
eq('가로를 상한에 맞춘다', narrow.width, Math.round(420 * V.VIEWER_MAX_VW))
eq('세로를 비율대로 줄인다', ratio(narrow), A4)
eq('세로가 화면 96% 보다 낮아진다', narrow.height < Math.round(900 * V.VIEWER_VH), true)

console.log('\n── 뷰어에 주는 설정 ──')
eq('툴바·쪽 목록을 감추고 가로 맞춤',
  V.PDF_VIEW_PARAMS, '#toolbar=0&navpanes=0&scrollbar=1&view=FitH')
eq('창 바탕 = 뷰어 배경색', V.VIEWER_BG, '#e6e6e6')

console.log(fails === 0 ? '\n모두 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
