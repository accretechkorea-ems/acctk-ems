// 명함 — 화면·조건·엑셀·OCR 자리 (2026-11-23).
//
//   node scripts/business-card-ui-check.js
//
// 규칙(표·권한·OCR 칸 배치)은 scripts/business-card-check.js 가 본다.
// 여기서는 **보드대로 만들어졌는가**와 **바깥으로 새는 것이 없는가**를 지킨다.
//   ① 조건이 주소에 남는다 · 볼 수 있는 사업부가 조건보다 먼저 걸린다
//   ② 엑셀 열에 등록자 이름·팀·사업부가 있다
//   ③ 폰은 카드 · PC 는 표 열 열 개 · 폰 우하단 고정 버튼 · 입력칸 44
//   ④ 워커·코어·언어 데이터를 **우리 서버**가 내준다(바깥 CDN 0건)

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

const Q = load(path.join(ROOT, 'lib/businessCardQuery.ts'))
const X = load(path.join(ROOT, 'lib/businessCardExcel.ts'))

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
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

console.log('\n── ① 조건은 주소에 남는다 ──')
eq('기본값은 주소에 적지 않는다', Q.queryFromFilter(Q.EMPTY_FILTER), '')
eq('걸린 것만 적는다',
  Q.queryFromFilter({ ...Q.EMPTY_FILTER, q: '홍길동', division: '반도체', engineerId: 7 }),
  '?q=%ED%99%8D%EA%B8%B8%EB%8F%99&div=%EB%B0%98%EB%8F%84%EC%B2%B4&by=7')
eq('주소를 다시 읽으면 같은 조건',
  Q.filterFromQuery(new URLSearchParams('q=a&div=계측&by=3&team=80CS&from=2026-01-01&to=2026-12-31')),
  { q: 'a', division: '계측', engineerId: 3, team: '80CS', from: '2026-01-01', to: '2026-12-31', batch: '' })
eq('깨진 값은 기본값으로 떨어진다',
  Q.filterFromQuery(new URLSearchParams('div=물류&by=abc')),
  { q: '', division: '', engineerId: 0, team: '', from: '', to: '', batch: '' })
eq('조건이 걸렸는지', [Q.hasFilter(Q.EMPTY_FILTER), Q.hasFilter({ ...Q.EMPTY_FILTER, q: 'a' })], [false, true])

const CARDS = [
  { card_id: 1, name: '홍길동', company: '가나정밀', division: '계측', registered_at: '2026-11-20T00:00:00Z', engineer_id: 7, registered_team: '80CS' },
  { card_id: 2, name: '김철수', company: '대한기계', division: '반도체', registered_at: '2026-05-01T00:00:00Z', engineer_id: 8, registered_team: '임원' },
  { card_id: 3, name: '박민수', company: '젠트', division: '계측', registered_at: '2024-01-01T00:00:00Z', engineer_id: 7, registered_team: '80CS', deleted_at: '2026-11-01' },
]
eq('볼 수 있는 사업부가 **조건보다 먼저** 걸린다',
  Q.applyCardFilter(CARDS, Q.EMPTY_FILTER, ['계측']).map(c => c.card_id), [1])
eq('양쪽을 보면 둘 다', Q.applyCardFilter(CARDS, Q.EMPTY_FILTER, ['계측', '반도체']).map(c => c.card_id), [1, 2])
ok('주소를 손으로 고쳐도 남의 사업부는 안 보인다',
  Q.applyCardFilter(CARDS, { ...Q.EMPTY_FILTER, division: '반도체' }, ['계측']).length === 0)
eq('지워진 줄은 안 보인다',
  Q.applyCardFilter(CARDS, Q.EMPTY_FILTER, ['계측', '반도체']).some(c => c.card_id === 3), false)
eq('등록자로 거른다',
  Q.applyCardFilter(CARDS, { ...Q.EMPTY_FILTER, engineerId: 8 }, ['계측', '반도체']).map(c => c.card_id), [2])
eq('팀으로 거른다',
  Q.applyCardFilter(CARDS, { ...Q.EMPTY_FILTER, team: '임원' }, ['계측', '반도체']).map(c => c.card_id), [2])
eq('기간으로 거른다',
  Q.applyCardFilter(CARDS, { ...Q.EMPTY_FILTER, from: '2026-11-01' }, ['계측', '반도체']).map(c => c.card_id), [1])
eq('검색어로 거른다',
  Q.applyCardFilter(CARDS, { ...Q.EMPTY_FILTER, q: '대한' }, ['계측', '반도체']).map(c => c.card_id), [2])

console.log('\n── ② 엑셀 ──')
const aoa = X.cardRowsAoA([CARDS[0]], '2026-11-23T00:00:00Z')
// 2026-11-25 — 목록과 같은 차례, 「지난 기간」·등록자 팀·사업부는 뺐다.
eq('머리글 차례', aoa[0], [
  '등록일', '회사', '부서', '이름', '직급', '휴대폰', '전화', '이메일', '사업부', '등록자',
  '영문 이름', '영문 회사명', '팩스', '홈페이지', '주소', '메모',
])
eq('줄 수 = 머리글 + 명함', aoa.length, 2)
eq('등록일은 yy-mm-dd', aoa[1][0], '26-11-20')
eq('파일 이름', X.cardExcelFileName('2026-11-23T00:00:00Z'), '명함목록_20261123.xlsx')
ok('열 너비를 낸다', X.columnWidths(aoa).length === aoa[0].length)

console.log('\n── ③ 화면이 보드대로인가 ──')
const PAGE = read('app/cards/page.tsx')
const FORM = read('components/cards/CardFormModal.tsx')
ok('폰은 카드, 넓으면 표', /narrow \? \(/.test(PAGE) && /<table/.test(PAGE))
// 2026-11-25 — 열을 다시 세웠다: 등록일·회사·부서·이름·직급·전화번호·이메일·사업부·등록자.
eq('PC 표의 열 아홉 개(+체크칸)', (PAGE.match(/<th style={th}>/g) || []).length, 9)
eq('열 차례', (PAGE.match(/<th style={th}>([^<]+)</g) || []).map(s => s.replace(/.*>/, '').replace('<', '')),
  ['등록일', '회사', '부서', '이름', '직급', '전화번호', '이메일', '사업부', '등록자'])
ok('폰 우하단에 고정 버튼', /position: 'fixed', right: 16, bottom: 16[\s\S]{0,400}＋ 명함 등록/.test(PAGE))
ok('전화·이메일은 바로 걸고 보낸다', PAGE.includes('tel:') && PAGE.includes('mailto:'))
// 나이 꼬리표(● 오늘)는 2026-11-25에 걷었다 — 표에도, 폰 카드에도 없다.
ok('나이 꼬리표가 없다', !/AgeTag/.test(PAGE))
ok('방식 셋', ['사진 촬영', '사진 올리기', '직접 입력'].every(t => FORM.includes(t)))
// 디자인 규칙 — 이모지를 아이콘으로 쓰지 않는다. 셋 다 인라인 SVG 다.
ok('방식 아이콘은 이모지가 아니라 인라인 SVG',
  /ICON = \{/.test(FORM) && /<svg /.test(FORM) && !/[\u{1F300}-\u{1FAFF}\u{2700}-\u{27BF}\u{2600}-\u{26FF}]/u.test(FORM),
  '이모지가 남아 있다')
ok('폰에서는 촬영이 바로 카메라', /capture="environment"/.test(FORM))
eq('입력 칸 높이 44', /const INPUT_H = (\d+)/.exec(FORM)?.[1], '44')
ok('자동으로 채운 칸만 파랗다', /field\(autoFilled\.has\(f\)\)/.test(FORM))
ok('「사진에서 읽음 · 확인 필요」 띠', FORM.includes('OCR_NOTICE'))
ok('읽는 중 진행률을 보여 준다', /ocr\.message/.test(FORM))
ok('뒷면 추가로 읽기', FORM.includes('뒷면 추가로 읽기') && FORM.includes('mergeBack'))
ok('중복이면 물어본다', FORM.includes('DUPLICATE_TITLE') && FORM.includes('DUPLICATE_SAVE'))
ok('등록일은 고칠 수 없다(자동)', FORM.includes('(자동)'))
ok('사업부 기본값은 등록자 팀의 사업부', /defaultDivision=\{defaultDivision\(me\)\}/.test(PAGE))
// 2026-11-25 — 행의 버튼을 걷었다. 지우기는 **열람 창**과 **선택 띠** 둘뿐이다.
ok('행에 확인·삭제 버튼이 없다', !/void verify\(c\)/.test(PAGE) && !/void remove\(c\)/.test(PAGE))
ok('열람 창이 권한을 보고 삭제를 둔다',
  /canDelete=\{editing \? canDeleteCard\(me, editing\) : false\}/.test(PAGE))

// 읽는 쪽(모델·라우트)은 scripts/card-ocr-check.js 가 본다. 여기서는 **화면 흐름**만.
console.log('\n── ④ 사진은 줄여서 우리 라우트로 ──')
const HOOK = read('components/cards/useCardOcr.ts')
ok('우리 라우트로 보낸다', /fetch\('\/api\/cards\/ocr'/.test(HOOK))
// 주석에는 설명이 있을 수 있다 — 코드 줄만 본다.
const hookCode = HOOK.split(/\r?\n/).filter(l => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n')
ok('바깥 주소를 부르지 않는다', !/https?:\/\//.test(hookCode), '바깥 주소가 남아 있다')
ok('보내기 전에 줄인다(긴 변 1,200 · jpg 80)',
  /const MAX_EDGE = 1200/.test(HOOK) && /const QUALITY = 0\.8/.test(HOOK) && /toBlob\(res, 'image\/jpeg', QUALITY\)/.test(HOOK))
ok('진행 문구는 한 군데서', /message: OCR_READING/.test(HOOK) && /OCR_READING = '명함을 읽는 중…'/.test(read('lib/businessCardOcr.ts')))
ok('열쇠가 없으면 안내하고 직접 입력으로', /no_key: 'OCR 설정이 안 되어 있습니다/.test(HOOK))
ok('실패해도 직접 입력이 남는다', /phase: 'error'/.test(HOOK) && /직접 입력/.test(HOOK))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
