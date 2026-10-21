// 견적서 **하단 블록**(조건 네 줄 · 비고) 규칙 시험.
//
//   node scripts/quote-note-check.js
//
// 왜 따로 두는가 — 이 블록의 글자는 **고객에게 그대로 나간다.** 규칙이 조용히 틀어지면
// 엉뚱한 문구가 찍힌 견적서가 나간 뒤에 알게 된다. 화면을 그리지 않고 순수 함수만 돌린다.
//   defaultTermsFor       — 양식별 조건 기본 문구(20 견적서는 지불조건이 다르다)
//   promoteLegacyDelivery — 없앤 「납기」 칸의 옛 값을 납품일정으로 올리는 규칙
//   defaultRemarksFor     — 양식별 비고 기본 문구
//   managerNoteLine/noteBodyLines — PDF 비고 칸의 줄 순서(담당자 줄이 맨 위)

// eslint 의 no-require-imports 는 맨 require() 를 센다. 이 파일은 node 로 직접 돌리는
// CJS 스크립트라 모듈을 그렇게 불러올 수밖에 없다 — 한 번만 묶어 두고 그것만 쓴다.
const load = module.require.bind(module)
const path = load('path')
const Module = load('module')
const ROOT = path.join(__dirname, '..')
const ts = load(path.join(ROOT, 'node_modules/typescript'))

for (const ext of ['.ts', '.tsx']) {
  Module._extensions[ext] = (mod, filename) => {
    const src = load('fs').readFileSync(filename, 'utf8')
    const out = ts.transpileModule(src, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
        esModuleInterop: true, jsx: ts.JsxEmit.React,
      },
      fileName: filename,
    }).outputText
    mod._compile(out, filename)
  }
}
const origResolve = Module._resolveFilename
Module._resolveFilename = function (req, ...rest) {
  if (req.startsWith('@/')) req = path.join(ROOT, req.slice(2))
  return origResolve.call(this, req, ...rest)
}

const {
  DEFAULT_TERMS, TERM_MAX_LEN, promoteLegacyDelivery,
  defaultTermsFor, normalizeTerms, termsOf, changedTerms, termKeysFor,
} = load(path.join(ROOT, 'lib/quoteTerms.ts'))
const {
  DEFAULT_REMARKS_BY_FORM, defaultRemarksFor, isDefaultRemarks,
  managerNoteLine, noteBodyLines,
} = load(path.join(ROOT, 'lib/quoteRemarks.ts'))

let fails = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
}

// ── 양식별 조건 기본값 ────────────────────────────────────────────────────
console.log('── 20 견적서는 지불조건 기본 문구가 다르다 ──')
const base20 = defaultTermsFor('general20')
const keys20 = termKeysFor('general20')
eq('20 · 지불조건', base20.payment_terms, '납입 후 익월 말 현금 결제')
eq('20 · 나머지 세 줄은 공통값 그대로',
  [base20.delivery_schedule, base20.delivery_terms, base20.validity],
  [DEFAULT_TERMS.delivery_schedule, DEFAULT_TERMS.delivery_terms, DEFAULT_TERMS.validity])
eq('80 파츠는 공통값', defaultTermsFor('parts80').payment_terms, DEFAULT_TERMS.payment_terms)
eq('80 장비도 공통값', defaultTermsFor('equip80').payment_terms, DEFAULT_TERMS.payment_terms)
eq('양식을 모르면 공통값', defaultTermsFor('').payment_terms, DEFAULT_TERMS.payment_terms)
eq('공통 기본값은 그대로 둔다(옛 견적이 이 값으로 그려진다)',
  DEFAULT_TERMS.payment_terms, '익월말 현금 결제')

// 「조건 변경」을 켜지 않은 20 견적 — 기본 문구로 그리고, **저장은 하지 않는다**(stored null).
{
  const r = normalizeTerms(null, keys20, base20)
  eq('20 · 조건을 안 건드리면 그려지는 값', r.ok && r.terms.payment_terms, '납입 후 익월 말 현금 결제')
  eq('20 · 그래도 저장하지는 않는다(= 기본값)', r.ok && r.stored, null)
}
// 20 기본값을 그대로 적어 두어도 「바뀐 조건」이 아니다.
{
  const r = normalizeTerms({ ...base20 }, keys20, base20)
  eq('20 · 기본 문구를 적어도 저장하지 않는다', r.ok && r.stored, null)
}
// 80 문구를 20 견적에 적으면 **바꾼 것**이다.
{
  const r = normalizeTerms({ ...base20, payment_terms: DEFAULT_TERMS.payment_terms }, keys20, base20)
  eq('20 · 공통 문구로 고치면 저장한다', r.ok && r.stored !== null, true)
  eq('그 경우에만 검토표의 「조건 변경」에 오른다',
    changedTerms(r.ok ? r.stored : null, base20).map(c => c.key), ['payment_terms'])
}
eq('저장값이 없으면 양식의 기본값으로 푼다', termsOf(null, base20).payment_terms, '납입 후 익월 말 현금 결제')

// ── 옛 납기 값 올리기 ──────────────────────────────────────────────────────
console.log('\n── 없앤 납기 칸의 값을 납품일정으로 올린다 ──')
const base = { ...DEFAULT_TERMS }
const schedule = t => t.delivery_schedule

eq('납기만 있으면 올린다', schedule(promoteLegacyDelivery(base, '10주')), '10주')
eq('다른 칸은 건드리지 않는다',
  promoteLegacyDelivery(base, '10주').payment_terms, DEFAULT_TERMS.payment_terms)
eq('앞뒤 공백·연속 공백은 접는다',
  schedule(promoteLegacyDelivery(base, '  발주 후   10주 ')), '발주 후 10주')
eq('빈 값이면 기본값 그대로', schedule(promoteLegacyDelivery(base, '')), DEFAULT_TERMS.delivery_schedule)
eq('null 이어도 기본값 그대로', schedule(promoteLegacyDelivery(base, null)), DEFAULT_TERMS.delivery_schedule)

// 납품일정을 이미 적어 둔 견적 — 조건 쪽이 정본이다.
const written = { ...DEFAULT_TERMS, delivery_schedule: '12월 3주' }
eq('납품일정이 이미 있으면 덮지 않는다', schedule(promoteLegacyDelivery(written, '10주')), '12월 3주')

// 발주 요청이 같은 칸(delivery_info)을 배송 주소로 덮어쓴다 — 그 주소가 올라가면 안 된다.
eq('줄바꿈이 있는 값(발주 배송 정보)은 올리지 않는다',
  schedule(promoteLegacyDelivery(base, '수령인: 홍길동\n주소: 경기도 …')), DEFAULT_TERMS.delivery_schedule)
eq(`${TERM_MAX_LEN}자를 넘는 값은 올리지 않는다(그 줄은 PDF 에서 한 행이다)`,
  schedule(promoteLegacyDelivery(base, '가'.repeat(TERM_MAX_LEN + 1))), DEFAULT_TERMS.delivery_schedule)
eq(`${TERM_MAX_LEN}자까지는 올린다`,
  schedule(promoteLegacyDelivery(base, '가'.repeat(TERM_MAX_LEN))), '가'.repeat(TERM_MAX_LEN))

const has = (name, hay, needle) => {
  const ok = String(hay).includes(needle)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}  「${needle}」 ${ok ? '있음' : '없음 — 실제: ' + hay}`)
}

// ── 양식별 비고 기본 문구 ──────────────────────────────────────────────────
console.log('\n── 비고 기본 문구는 양식마다 다르다 ──')
const r20 = defaultRemarksFor('general20')
const r80p = defaultRemarksFor('parts80')
const r80e = defaultRemarksFor('equip80')

has('20 · 취소 위약금', r20, '발주 후 주문 취소 시 발주 금액의 30%의 위약금이 발생합니다.')
has('20 · 당사 외 수리 금지', r20, '당사 외 수리를 일체 금지함을 알려드립니다.')
eq('20 · 세 줄이다(긴 문구를 접어 두 줄로 적는다)', r20.split('\n').length, 3)
eq('20 · 이어지는 줄은 「*」로 시작하지 않고 공백 둘로 시작한다',
  [r20.split('\n')[2].startsWith('  '), r20.split('\n')[2].trimStart().startsWith('*')], [true, false])

has('80 장비 · 취소 위약금', r80e, '발주 금액의 30%의 위약금')
has('80 장비 · 설치·KOLAS 교정 일정', r80e, '설치 및 KOLAS 교정 일정은 담당자와 협의합니다.')
eq('80 장비 · 두 줄이다', r80e.split('\n').length, 2)

eq('80 파츠 · 지금 문구를 그대로 둔다(한 줄)',
  r80p, '* 발주 진행 시 팩스 또는 메일로 발주서 회신 요망 (FAX : 031-786-4090)')

eq('양식을 아직 고르지 않았으면 파츠 문구', defaultRemarksFor(''), r80p)
eq('모르는 값도 파츠 문구', defaultRemarksFor('무엇인가'), r80p)
eq('null 도 파츠 문구', defaultRemarksFor(null), r80p)

// 담당자 줄은 **비고 본문에 없다** — PDF 가 그릴 때 붙인다(다시쓰기로 남의 이름이 따라붙지 않게).
eq('어느 양식에도 담당자 줄이 없다',
  Object.values(DEFAULT_REMARKS_BY_FORM).some(v => /담당\s*:/.test(v)), false)

eq('손댔는지 판정 — 기본 문구 그대로', isDefaultRemarks(r20, 'general20'), true)
eq('손댔는지 판정 — 다른 양식의 문구는 「손댔다」', isDefaultRemarks(r80p, 'general20'), false)
eq('손댔는지 판정 — 한 글자 더하면 「손댔다」', isDefaultRemarks(r20 + ' 추가', 'general20'), false)

// ── PDF 비고 칸의 줄 ──────────────────────────────────────────────────────
console.log('\n── PDF 비고 — 담당자 줄이 문구 맨 위 ──')
eq('담당자 줄 모양', managerNoteLine('권재원 선임', '031-786-4080'), '* 담당 : 권재원 선임 (031-786-4080)')
eq('전화번호가 없으면 괄호도 없다', managerNoteLine('권재원 선임', ''), '* 담당 : 권재원 선임')
eq('앞뒤 공백은 지운다', managerNoteLine(' 권재원 선임 ', ' 031-786-4080 '), '* 담당 : 권재원 선임 (031-786-4080)')
eq('이름이 없으면 줄을 내지 않는다', managerNoteLine('', '031-786-4080'), '')

const who = managerNoteLine('권재원 선임', '031-786-4080')
eq('담당자 줄이 맨 위, 그 뒤에 비고 문구',
  noteBodyLines(who, defaultRemarksFor('equip80')),
  [who, ...DEFAULT_REMARKS_BY_FORM.equip80.split('\n')])
eq('이름이 없으면 비고 문구만', noteBodyLines('', '* 가'), ['* 가'])
eq('대리점 줄(E.U)은 비고 본문에 들어와 담당자 줄 **아래**에 온다',
  noteBodyLines(who, '* E.U  : 어떤 회사\n* 가')[1], '* E.U  : 어떤 회사')
// 제목 「비고」는 이 줄들에 들어 있지 않다 — 칸 맨 위에 따로 그린다(문구만 바닥에서 올라온다).
eq('제목은 문구 줄에 없다', noteBodyLines(who, '* 가').includes('비고'), false)

console.log(fails === 0 ? '\n모두 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
