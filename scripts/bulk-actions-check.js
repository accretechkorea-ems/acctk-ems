// 일괄 작업 바 — 버튼이 언제 켜지고, 무엇을 말하는가 (2026-11-23).
//
//   node scripts/bulk-actions-check.js
//
// 지키는 약속
//   ① 바에는 **버튼만** 있다 — 어두운 바탕 위 native select 는 흰 글자 흰 바탕이 된다.
//   ② 못 누르는 버튼도 **남는다**. 지우지 않고 잠그고, 왜 안 되는지 title 로 말한다.
//   ③ 켜지는 조건: 분류=회사 선택 · 대리점/상태/이동=사업장 선택 · 병합=같은 회사 2곳 이상.
//   ④ 적용 모달은 「선택한 N곳 · 지금 값 → 바꿀 값」을 보여 주고, 값을 고르기 전에는 잠긴다.

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

const B = load(path.join(ROOT, 'lib/bulkActions.ts'))

let fails = 0
const eq = (name, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want)
  if (!good) fails++
  console.log(`${good ? 'OK  ' : 'FAIL'} ${name}`)
  if (!good) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}
const ok = (name, cond, hint) => {
  if (!cond) fails++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond || !hint ? '' : `  — ${hint}`}`)
}

console.log('\n── ① 버튼 목록 ──')
eq('다섯 가지, 보드 순서 그대로', B.BULK_ACTIONS.map(a => a.label),
  ['분류 지정', '대리점 변경', '상태 변경', '다른 회사로 이동', '사업장 병합'])
eq('분류만 회사 단위', B.BULK_ACTIONS.filter(a => a.scope === 'company').map(a => a.key), ['industry'])

console.log('\n── ② 켜지는 조건 ──')
const site = (over) => ({ scope: 'site', count: 1, sameCompany: true, ...over })
const company = (over) => ({ scope: 'company', count: 1, ...over })
eq('사업장 선택 — 분류는 잠긴다', B.bulkDisabledReason('industry', site()),
  '분류는 회사 단위입니다 — 왼쪽 목록에서 회사를 고르세요')
eq('회사 선택 — 분류는 켜진다', B.bulkDisabledReason('industry', company()), null)
eq('회사 선택 — 상태는 잠긴다', B.bulkDisabledReason('status', company()), '사업장을 고른 뒤에 할 수 있습니다')
eq('사업장 선택 — 대리점·상태·이동은 켜진다',
  ['agency', 'status', 'move'].map(k => B.bulkDisabledReason(k, site())), [null, null, null])
eq('병합 — 1곳이면 잠긴다', B.bulkDisabledReason('merge', site({ count: 1 })),
  '사업장을 2곳 이상 골라야 합칠 수 있습니다')
eq('병합 — 2곳이면 켜진다', B.bulkDisabledReason('merge', site({ count: 2 })), null)
eq('병합 — 회사가 다르면 잠긴다', B.bulkDisabledReason('merge', site({ count: 2, sameCompany: false })),
  '같은 회사의 사업장끼리만 합칠 수 있습니다')
eq('병합 — 권한이 없으면 그 이유가 먼저다',
  B.bulkDisabledReason('merge', site({ count: 2, canMergeSites: false })),
  '사업장 병합은 슈퍼관리자만 할 수 있습니다')
eq('아무것도 고르지 않으면 전부 잠긴다',
  B.BULK_ACTIONS.map(a => B.bulkDisabledReason(a.key, site({ count: 0 }))).filter(r => r === null).length, 0)
ok('못 누르는 버튼도 목록에 남는다(지우지 않는다)',
  B.bulkActionsFor(company({ count: 2 })).length === B.BULK_ACTIONS.length)
ok('잠긴 버튼마다 이유가 있다',
  B.bulkActionsFor(company({ count: 2 })).every(x => x.reason === null || x.reason.length > 5))

console.log('\n── ③ 글자 ──')
eq('바 왼쪽 — 사업장', B.bulkBarTitle('site', 3), '사업장 3곳 선택')
eq('바 왼쪽 — 회사', B.bulkBarTitle('company', 2), '회사 2곳 선택')
eq('푸터 요약', B.bulkFooterText(3, '활성'), '3곳 → 활성')
eq('값을 고르기 전', B.bulkFooterText(3, null), '3곳 선택됨')
eq('끝난 뒤 토스트', B.bulkDoneText(3), '3곳 변경됨')
eq('직판 항목은 뜻을 풀어 적는다', B.DIRECT_SALE_OPTION_LABEL, 'ACCT-K(직판 — 대리점 없음)')

console.log('\n── ④ 지금 값 묶기 ──')
eq('많은 것부터', B.currentValueCounts(['활성', '잠재', '활성']), [{ label: '활성', n: 2 }, { label: '잠재', n: 1 }])
eq('빈 값은 이름을 준다', B.currentValueCounts([null, '']), [{ label: '없음', n: 2 }])
eq('이름을 바꿔 줄 수 있다', B.currentValueCounts([null], '분류 없음'), [{ label: '분류 없음', n: 1 }])
eq('같은 수면 이름순', B.currentValueCounts(['나', '가']), [{ label: '가', n: 1 }, { label: '나', n: 1 }])
eq('한 가지뿐이면 수를 적지 않는다', B.currentValueText([{ label: '활성', n: 3 }]), '활성')
eq('여럿이면 수를 적는다', B.currentValueText([{ label: '활성', n: 2 }, { label: '잠재', n: 1 }]), '활성 2 · 잠재 1')
eq('아무것도 없으면 -', B.currentValueText([]), '-')

console.log('\n── ⑤ 화면이 같은 약속을 지키는가(글자 검사) ──')
const BAR = fs.readFileSync(path.join(ROOT, 'components/home/list/BulkBar.tsx'), 'utf8')
const MODAL = fs.readFileSync(path.join(ROOT, 'components/home/list/BulkApplyModal.tsx'), 'utf8')
const PANE = fs.readFileSync(path.join(ROOT, 'components/home/list/CompanyPane.tsx'), 'utf8')
const PANEL = fs.readFileSync(path.join(ROOT, 'components/home/list/CustomerListPanel.tsx'), 'utf8')
const CSS = fs.readFileSync(path.join(ROOT, 'app/globals.css'), 'utf8')

ok('바에 select 가 없다', !/<select/.test(BAR))
ok('두 패널에 native select 가 하나도 없다(어두운 바 위의 마지막 셋을 걷었다)',
  [PANE, PANEL].every(src => !/<select/.test(src)),
  '검은 바 안에 native select 가 남아 있다')
ok('버튼은 색을 직접 적는다(물려받지 않는다)', /color: off \? MUTED : CARD_BG/.test(BAR))
ok('잠긴 버튼은 이유를 title 로 말한다', /title=\{reason \?\? action\.label\}/.test(BAR))
ok('두 패널이 같은 부품을 쓴다',
  PANE.includes('<BulkBar') && PANEL.includes('<BulkBar'))
ok('적용 모달은 공용 카드 440 이다', /<ModalCard[\s\S]{0,80}width=\{440\}/.test(MODAL))
ok('적용 모달이 지금 값을 보여 준다', MODAL.includes('currentValueText(current)'))
ok('값을 고르기 전에는 적용이 잠긴다', /disabled=\{busy \|\| !picked\}/.test(MODAL))
ok('폰에서는 아래 고정 시트다', /@media \(max-width: 640px\)[\s\S]{0,400}\.ems-bulk-bar[\s\S]{0,200}position: fixed/.test(CSS))
ok('안전 영역을 더한다', /env\(safe-area-inset-bottom/.test(CSS))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
