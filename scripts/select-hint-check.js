/**
 * 드롭다운의 **안내 option** — 열면 실제 선택지만 보인다 (2026-11-21).
 *
 * ── 규칙 ──────────────────────────────────────────────────────────────────
 *   안내 option(「고르기」·「선택하세요」·「분류 선택 (필수)」류)은 `disabled hidden` 이다.
 *   값이 비었을 때 **닫힌 상태에서만** 보이고, 열면 목록에 끼지 않는다.
 *   전에는 「양식 선택 (필수)」가 양식 넷과 나란히 서 있어, 그것도 고를 수 있는 양식처럼
 *   보였다.
 *
 * ── 안내가 아닌 빈 option 은 그대로 둔다 ──────────────────────────────────
 *   ⒜ 빈 값이 **뜻이 있는 값**인 자리: 「연결 안 함」·「선택 안 함」·「전체」·「미지정」·
 *     「묶음 없음」·「(없음)」. 고르면 그 뜻으로 저장된다.
 *   ⒝ **선택 사항**인 칸: 한 번 고른 뒤 다시 비울 길이 그 option 뿐이다. 감추면
 *     고른 것을 풀 수 없어진다(아래 OPTIONAL 목록 — 자리마다 이유를 적어 둔다).
 *
 * 이 하네스는 app·components 의 모든 .tsx 를 읽어 그 둘을 가른다.
 */
const load = module.require.bind(module)
const path = load('path')
const fs = load('fs')
const ROOT = path.resolve(__dirname, '..')

/** 안내 문구로 보는 글자 — 이 글자가 붙은 빈 option 은 `disabled hidden` 이어야 한다. */
const HINT = [
  '고르기', '선택', '선택하세요', '선택해주세요', '계열을 골라주세요', '계열', '종류', '이동',
  '항목 선택', '사유 선택', '장비 선택', '팀 선택', '분류', '분류 선택', '분류 선택 (필수)',
  '양식 선택 (필수)', '분류 일괄 지정', '대리점 더하기…', '개인 결재선 불러오기', '팀으로 참조 추가',
]

/**
 * 안내처럼 읽히지만 **열어 둬야 하는** 자리. [파일, 글자, 이유]
 * 선택 사항인 칸이라, 이 줄을 감추면 한 번 고른 값을 다시 비울 수 없다.
 */
const OPTIONAL = [
  ['components/customer/modals/RecordAddModal.tsx', '고르기', '포캐스트의 담당자 — 선택 사항이다(비울 수 있어야 한다)'],
  ['components/customer/modals/ServiceAddModal.tsx', '고객 담당자 선택', '서비스 기록의 담당자 — 선택 사항'],
  ['components/customer/modals/ServiceEditModal.tsx', '고객 담당자 선택', '서비스 기록의 담당자 — 선택 사항'],
  ['app/contact/semi/[projectId]/write/page.tsx', '선택', '칸 정의(def)마다 필수 여부가 달라 한 줄로 가를 수 없다'],
]

const files = []
const walk = d => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) { if (!/node_modules|\.next/.test(p)) walk(p) }
    else if (e.name.endsWith('.tsx')) files.push(p)
  }
}
walk(path.join(ROOT, 'app'))
walk(path.join(ROOT, 'components'))

let fail = 0
const ok = (name, cond, hint) => {
  if (cond) console.log(`OK   ${name}`)
  else { fail++; console.error(`FAIL ${name}${hint ? `  — ${hint}` : ''}`) }
}

// 파일 안의 빈 option 을 모은다. 글자가 중괄호로 시작하면 「동적」이다(여기서 가리지 않는다).
const found = []
const re = /<option value=""([^>]*)>([^<{]*)/g
for (const f of files) {
  const rel = path.relative(ROOT, f).split(path.sep).join('/')
  const s = fs.readFileSync(f, 'utf8')
  let m
  while ((m = re.exec(s))) {
    found.push({ file: rel, attrs: m[1].trim(), label: m[2].trim(), hidden: m[1].includes('disabled hidden') })
  }
}

console.log(`── 빈 option ${found.length}자리 ──`)
const isOptional = (file, label) => OPTIONAL.some(([f, l]) => f === file && l === label)
const bad = found.filter(o => o.label && HINT.includes(o.label) && !o.hidden && !isOptional(o.file, o.label))
ok('안내 option 은 전부 disabled hidden 이다', bad.length === 0,
  bad.map(o => `${o.file} 「${o.label}」`).join(' · '))

const hinted = found.filter(o => o.hidden)
console.log(`   disabled hidden ${hinted.length}자리 · 열어 둔 자리 ${found.length - hinted.length}`)
// 2026-11-23: 일괄 작업 바의 드롭다운 셋을 걷어 38 → 35 가 됐다(버튼 + 적용 모달로 바꿨다).
// 2026-11-23: 사후 실적 입력 창의 셋(양식·담당자·상태)이 늘어 35 → 38.
ok('손으로 센 수와 맞는다(38자리)', hinted.length === 38,
  `지금 ${hinted.length} — 자리를 더하거나 줄였으면 이 숫자를 고쳐라`)

console.log('\n── 사용자가 짚은 두 자리 ──')
const card = fs.readFileSync(path.join(ROOT, 'components', 'quote', 'CustomerCard.tsx'), 'utf8')
ok('견적 작성 — 분류', /<option value="" disabled hidden>\{categoriesLoading/.test(card))
ok('견적 작성 — 양식', /<option value="" disabled hidden>양식 선택 \(필수\)<\/option>/.test(card))
ok('견적 작성 — 수신인', (card.match(/<option value="" disabled hidden>/g) || []).length >= 3)

// 2026-11-26 — 견적의 포캐스트 칸은 <select> 가 아니라 **공용 콤보박스**(SearchSelect)다.
// 「연결 안 함」은 목록 맨 위의 줄(extras)이라 option 검사로는 잡히지 않는다 — 글자로 본다.
console.log('\n── 견적의 포캐스트 칸은 공용 콤보박스 ──')
ok('SearchSelect 로 고른다', /<SearchSelect<SalesOpportunity>/.test(card))
ok('목록 맨 위에 「연결 안 함」', /key: 'none', where: 'top'[\s\S]{0,140}연결 안 함/.test(card))
ok('맨 아래에 「새 포캐스트 만들기」', /＋ 새 포캐스트 만들기/.test(card))

console.log('\n── 뜻이 있는 빈 값은 그대로다 ──')
for (const [file, label] of [
  ['components/customer/modals/SalesActivityModal.tsx', '연결 안 함'],
  ['app/quote/QuoteItemRow.tsx', '묶음 없음'],
  ['components/repair/RepairEditModal.tsx', '(없음)'],
  ['app/inquiries/page.tsx', '상태 전체'],
  ['app/admin/page.tsx', '사무실 미지정'],
  ['components/showroom/UsageTab.tsx', '전체 목적'],
]) {
  const hit = found.find(o => o.file === file && o.label === label)
  ok(`${label} — 고를 수 있다`, !!hit && !hit.hidden, hit ? '감춰졌다' : '그 자리가 없다')
}

console.log('\n── 선택 사항인 칸은 비울 수 있다 ──')
for (const [file, label, why] of OPTIONAL) {
  // 같은 글자가 한 파일에 둘 있을 수 있다(RecordAddModal 의 「고르기」는 사업장·담당자 둘이다).
  // 그 중 **열려 있는 자리가 하나라도** 있으면 선택 사항 칸이 살아 있다는 뜻이다.
  const open = found.some(o => o.file === file && o.label === label && !o.hidden)
  ok(`${file.split('/').pop()} 「${label}」 — ${why}`, open,
    '감춰졌다 — 고른 값을 풀 길이 없어진다(또는 그 자리가 없어졌다)')
}

console.log(fail === 0 ? '\n전부 통과' : `\n${fail}건 실패`)
process.exit(fail === 0 ? 0 : 1)
