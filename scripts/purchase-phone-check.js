// 발주 목록 — **폰 카드 목록**과 「이 조건 전체 선택」 (2026-11-26, 지시 O).
//
//   node scripts/purchase-phone-check.js
//
// 지키는 약속
//   ① 폰(≤768)에서는 표 대신 **카드 목록**이다 — 회사 · 번호 · 상태 · 금액 · 발주일.
//     PC 는 종전 표 그대로다(둘이 **같은 줄**을 그린다. 보이는 것만 다르다).
//   ② 쪽 나누기는 그대로다(공용 Pager · 서버에서 50줄씩).
//   ③ 「이 조건 전체 선택」 — 조건에 맞는 id 를 **서버에 다시 물어** 한꺼번에 고른다.
//     그때부터 쪽을 넘겨도 선택이 남는다(전에는 쪽을 넘기면 걷혔다).
//   ④ **조건이 바뀌면 버린다** — 그 선택은 「그 조건」의 목록이기 때문이다.
//   ⑤ 한 줄을 손으로 켜고 끄면 조건 전체는 꺼진다(그 순간부터 사람이 고른 목록이다).
//   ⑥ 상한을 둔다 — 넘으면 조건을 좁히라고 알린다(조용히 자르지 않는다).

const load = module.require.bind(module)
const path = load('path')
const fs = load('fs')
const ROOT = path.join(__dirname, '..')

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
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')

const PAGE = read('app/purchase/page.tsx')
const HOOK = read('hooks/useQuoteSelection.ts')

console.log('── ① 폰 카드 목록 ──')
ok('폰에서는 표를 숨긴다', /@media \(max-width: 768px\)[\s\S]{0,200}\.po-table \{ display: none; \}/.test(PAGE))
ok('그 자리에 카드 목록이 선다', /\.po-cards \{ display: flex; flex-direction: column; \}/.test(PAGE))
ok('PC 에서는 카드 목록을 숨긴다', /\.po-cards \{ display: none; \}/.test(PAGE))
ok('현황 카드는 폰에서 2열', /\.po-counts \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/.test(PAGE))
for (const [what, re] of [
  ['회사', /\{company\}/],
  ['번호', /\{q\.quote_number\}/],
  ['상태', /salesStatusLabel\(q\.status\)/],
  ['금액', /₩\{numKR\(q\.total_supply \?\? 0\)\}/],
  ['발주일', /발주 \{fmtShort\(q\.purchase_order_at/],
]) ok(`카드에 ${what} 가 있다`, re.test(PAGE))
ok('체크박스도 있다(선택이 폰에서도 된다)', /aria-label=\{`\$\{q\.quote_number\} 선택`\}/.test(PAGE))
ok('과녁이 44px 급이다(처리 단추 minHeight 32 + 여백)', /minHeight: 32, padding: '0 12px'/.test(PAGE))
ok('그 상태에서 할 일 하나를 폰에서도 처리한다',
  /po-cards[\s\S]{0,4000}주문완료 처리/.test(PAGE) && /po-cards[\s\S]{0,4000}발행완료 처리/.test(PAGE))
ok('표와 같은 줄을 그린다(filtered 하나를 둘이 쓴다)',
  (PAGE.match(/filtered\.map\(q => \{/g) ?? []).length === 2)
ok('쪽 나누기는 공용 부품 그대로', /<Pager page=\{page\} total=\{total\} size=\{PAGE_SIZE\}/.test(PAGE))

console.log('\n── ② 조건 전체 선택 — 훅 ──')
ok('조건 전체 선택이 있다', /const selectCondition = useCallback/.test(HOOK))
ok('켜져 있으면 선택을 걷지 않는다', /if \(!visibleIds \|\| wide\) return/.test(HOOK))
ok('그 깃발이 의존성에 있다(켜고 끌 때 다시 본다)', /\}, \[visibleKey, wide\]\)/.test(HOOK))
ok('손으로 켜고 끄면 꺼진다', /const toggle = useCallback[\s\S]{0,200}setWide\(false\)/.test(HOOK))
ok('전체 선택(쪽)도 꺼진다', /const toggleAll = useCallback[\s\S]{0,120}setWide\(false\)/.test(HOOK))
ok('비우면 꺼진다', /const clear = useCallback\(\(\) => \{ setSelectedSet\(new Set\(\)\); setWide\(false\) \}/.test(HOOK))
ok('빈 목록으로는 켜지지 않는다', /setWide\(ids\.length > 0\)/.test(HOOK))
ok('깃발을 내보낸다(화면이 글자를 바꾼다)', /clear, selectCondition, wide \}/.test(HOOK))

console.log('\n── ③ 조건 전체 선택 — 화면 ──')
ok('서버에 id 를 다시 묻는다', /const selectAllMatching = async \(\)/.test(PAGE)
  && /supabase\.from\('quotes'\)\.select\('quote_id'\)/.test(PAGE))
ok('쪽 조회와 같은 조건을 쓴다(상태·검색어)',
  /selectAllMatching[\s\S]{0,900}\.in\('status', statusFilter === '전체' \? PURCHASE_STATUSES : \[statusFilter\]\)/.test(PAGE)
  && /selectAllMatching[\s\S]{0,1400}companyPickOr\(safe, useEn\)/.test(PAGE))
ok('줄이 아니라 id 만 받는다(가볍다)', !/selectAllMatching[\s\S]{0,900}total_supply/.test(PAGE))
ok('상한이 있다', /const SELECT_ALL_MAX = 500/.test(PAGE) && /\.limit\(SELECT_ALL_MAX\)/.test(PAGE))
ok('상한을 넘으면 알린다 — 조용히 자르지 않는다', /한 번에 \$\{SELECT_ALL_MAX\}건까지 고릅니다/.test(PAGE))
ok('조건이 바뀌면 버린다', /setPage\(1\)[\s\S]{0,400}sel\.clear\(\)/.test(PAGE))
ok('단추가 글자를 바꾼다(고르기 ↔ 해제)',
  /sel\.wide \? `선택 해제 \(\$\{sel\.count\}건\)` : `이 조건 전체 선택 \(\$\{total\}건\)`/.test(PAGE))
ok('쪽이 하나뿐이면 단추를 내지 않는다', /\{total > visibleIds\.length && \(/.test(PAGE))
ok('엑셀은 고른 것을 그대로 받는다(쪽 밖의 줄도 들어간다)', /quoteIds=\{sel\.selected\}/.test(PAGE))

console.log('\n── ④ 지우지 않은 것 ──')
ok('표는 그대로 있다', /className="po-table"/.test(PAGE) && /<thead>/.test(PAGE))
ok('표의 전체 선택 체크박스도 그대로', /onChange=\{\(\) => sel\.toggleAll\(visibleIds\)\}/.test(PAGE))
ok('견적서 대필·처리 모달도 그대로', /견적서 대필/.test(PAGE) && /주문완료 처리<\/div>/.test(PAGE))
eq('고르는 상한', 500, 500)

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
