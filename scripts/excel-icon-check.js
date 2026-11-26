// 「엑셀로 받기」는 **한 모양**이다 — 공용 ⬇ 아이콘 (2026-11-26 묶음2 E).
//
//   node scripts/excel-icon-check.js
//
// ── 왜 ──────────────────────────────────────────────────────────────────────
//   같은 일이 화면마다 다르게 생겼다(2026-11-26 전수조사): 고객사 목록·명함은 ⬇ 아이콘,
//   포캐스트·접촉보고서 목록은 글자 버튼, 발주·실적 현황·내 견적은 「엑셀 내보내기 (3)」
//   처럼 건수까지 붙은 파란 글자 버튼, 접촉보고서 상세는 초록 XLS 문서 아이콘이었다.
//   누르는 자리가 매번 달라 보이면 그때그때 다시 찾는다.
//
// ── 무엇을 보나 ─────────────────────────────────────────────────────────────
//   ① 공용 부품이 **하나**이고 그 모양이 기준(고객사 목록 탭 줄)과 같다.
//   ② 내보내는 자리 여섯이 전부 그 부품을 쓴다.
//   ③ 옛 모양(글자 버튼·초록 XLS·손으로 그린 ⬇)이 **되돌아오지 않는다**.
//   ④ 동작·권한은 부품이 가져가지 않는다 — 누르면 onClick 뿐이다.

const load = module.require.bind(module)
const path = load('path')
const fs = load('fs')
const ROOT = path.join(__dirname, '..')

let fails = 0
const ok = (name, cond, hint) => {
  if (!cond) fails++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond || !hint ? '' : `  — ${hint}`}`)
}
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')
/** 주석을 뺀 코드 — 「이 글자가 없어야 한다」는 제 설명에 걸리지 않게 이것으로 본다. */
const code = p => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split(/\r?\n/).map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n')
  .replace(/\{\s+\}/g, ' ')

console.log('── ① 공용 부품 하나 ──')
const B = read('components/common/ExcelIconButton.tsx')
ok('부품이 있다', B.length > 0)
ok('기본 28×28 · radius R.icon', /size = 28/.test(B) && /borderRadius: R\.icon/.test(B))
ok('글리프는 아래로 받는 화살표다', /M12 3v12m0 0l-4-4m4 4l4-4M4 17v3h16v-3/.test(B))
ok('무엇을 하는지는 title 툴팁이 말한다', /title=\{tip\}/.test(B) && /aria-label=\{tip\}/.test(B))
ok('건수는 툴팁에 붙는다', /\$\{label\} \(\$\{count\}건\)/.test(B))
ok('내보내는 중이면 눌리지 않는다', /const off = disabled \|\| busy/.test(B))
ok('색은 토큰에서 온다(새 색을 만들지 않는다)', /from '@\/components\/common\/ui'/.test(B)
  && !/#[0-9a-fA-F]{6}/.test(B))

console.log('\n── ② 내보내는 자리가 전부 그 부품을 쓴다 ──')
for (const [where, file] of [
  ['고객사 목록 탭 줄(기준)', 'components/home/list/ListTabs.tsx'],
  ['명함 목록', 'app/cards/page.tsx'],
  ['포캐스트 판', 'app/pipeline/page.tsx'],
  ['접촉보고서 목록(전체 엑셀)', 'app/contact/semi/page.tsx'],
  ['접촉보고서 상세(Excel 출력)', 'app/contact/semi/[projectId]/page.tsx'],
  ['견적 이익률 분석표', 'components/quote/QuoteExcelButton.tsx'],
]) ok(`${where}`, /<ExcelIconButton/.test(read(file)), '공용 부품을 쓰지 않는다')
// 견적 쪽은 **한 부품이 세 화면**을 섬긴다 — 그 셋은 크기만 넘긴다.
for (const [where, file] of [
  ['발주', 'app/purchase/page.tsx'],
  ['실적 현황', 'app/sales/page.tsx'],
  ['내 견적', 'components/dashboard/MyQuotesPanel.tsx'],
]) ok(`${where} 는 크기만 넘긴다`, /<QuoteExcelButton/.test(read(file))
  && /size=\{\d+\}/.test(read(file)) && !/style=\{\{ padding[^}]*background: BLUE/.test(read(file)))

console.log('\n── ③ 옛 모양은 되돌아오지 않는다 ──')
ok('초록 XLS 문서 아이콘이 없다', !/EXCEL_GREEN/.test(code('app/contact/semi/[projectId]/page.tsx')))
ok('「전체 엑셀」 글자 버튼이 없다', !/전체 엑셀<\/button>/.test(code('app/contact/semi/page.tsx')))
ok('「엑셀 내보내기 (N)」 글자가 없다', !/엑셀 내보내기 \(\$\{quoteIds\.length\}\)/.test(read('components/quote/QuoteExcelButton.tsx')))
ok('포캐스트에 엑셀 글자 버튼이 없다', !/엑셀 내보내기\s*<\/button>/.test(code('app/pipeline/page.tsx')))
// 글리프를 **손으로 그린 자리**가 공용 부품 말고는 없어야 한다.
const GLYPH = 'M12 3v12m0 0l-4-4m4 4l4-4M4 17v3h16v-3'
const hand = []
const SKIP = new Set(['node_modules', '.next', '.next-perf', '.next-probe', '.git'])
const walk = d => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(path.join(d, e.name)); continue }
    if (!/\.tsx?$/.test(e.name)) continue
    const f = path.join(d, e.name)
    if (fs.readFileSync(f, 'utf8').includes(GLYPH)) hand.push(path.relative(ROOT, f).split(path.sep).join('/'))
  }
}
for (const d of ['app', 'components', 'lib']) walk(path.join(ROOT, d))
ok(`⬇ 글리프를 든 파일은 공용 부품과 내보내기 창 둘뿐이다 (${hand.join(' · ')})`,
  hand.length === 2
  && hand.includes('components/common/ExcelIconButton.tsx')
  && hand.includes('components/home/ExportModal.tsx'),
  '손으로 그린 자리가 늘었다 — 공용 부품을 쓰라')

console.log('\n── ④ 동작·권한은 부르는 쪽 그대로 ──')
ok('부품은 조회·권한을 모른다', !/supabase|permission|isSuperAdmin|fetch\(/.test(B))
ok('고객사 목록의 권한 판정은 그대로다', /disabled=\{!canExport\}/.test(read('components/home/list/ListTabs.tsx')))
ok('견적 쪽 기록(download_logs)도 그대로다', /download_logs/.test(read('components/quote/QuoteExcelButton.tsx')))

console.log('\n── ⑤ 바꾸지 않은 자리 ──')
// 뷰어 머리줄의 「다운로드」는 **파일 내려받기**다(인쇄·새 탭과 나란한 글자 단추 줄).
// 「엑셀 내보내기」와 성격이 달라 두었다 — 보고서에 판단 필요로 적었다.
ok('PDF 뷰어의 다운로드는 글자 그대로다', /download=\{doc\.name\} style=\{linkStyle\}>다운로드/.test(read('components/pdf/PdfViewerModal.tsx')))
ok('엑셀 미리보기의 다운로드도 그대로다', /style=\{linkStyle\}>다운로드/.test(read('components/xlsx/XlsxPreviewModal.tsx')))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
