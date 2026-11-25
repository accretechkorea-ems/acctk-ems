// 실주 사유 **카테고리** (2026-11-26).
//
//   node scripts/lost-reason-check.js
//
// 지키는 약속
//   ① 사유는 **고르는 목록**이다(표 lost_reasons). 「기타」는 설명을, 「경쟁사」는 회사
//     이름을 함께 받는다. 「기간 만료」는 목록에 **없다** — 그것은 사유가 아니다.
//   ② 모자란 것은 **한 번에 하나만** 말한다.
//   ③ **사유가 비었다고 다른 일을 막지 않는다**(지시 L3). 실패인데 사유가 빈 건은
//     「실주 사유 입력 필요」 한 줄로 목록·할 일에 안내만 한다.
//   ④ 창은 **한 벌**이다 — 포캐스트 실주 · 포캐스트 종료 · 견적 실패가 같은 창을 쓴다.
//   ⑤ 칸이 아직 없어도 끝까지 된다 — 사유 글자는 옛 칸에 들어가고, 새 칸 셋만 빠진다.

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

const LR = load(path.join(ROOT, 'lib/lostReason.ts'))
const T = load(path.join(ROOT, 'lib/tasks.ts'))

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

const REASONS = LR.FALLBACK_REASONS
const TODAY = '2026-11-26'
const form = (over = {}) => ({ ...LR.emptyLostForm(TODAY), ...over })

console.log('── ① 목록 ──')
eq('여덟 줄이다', REASONS.length, 8)
eq('그 여덟', REASONS.map(r => r.label),
  ['가격', '경쟁사', '예산 없음·보류', '시기 안 맞음', '사양·요구 불일치', '무응답·연락 두절', '프로젝트 취소', '기타'])
ok('「기간 만료」는 목록에 없다', !REASONS.some(r => r.label.includes('만료')))
eq('「기타」는 설명 필수', LR.needsNote(REASONS, '기타'), true)
eq('「경쟁사」는 경쟁사 필수', LR.needsCompetitor(REASONS, '경쟁사'), true)
eq('다른 사유는 둘 다 아니다', [LR.needsNote(REASONS, '가격'), LR.needsCompetitor(REASONS, '가격')], [false, false])
ok('SQL 시드가 같은 여덟 줄이다',
  REASONS.every(r => read('db/lost_reasons_20261126.sql').includes(`'${r.label}'`)))

console.log('\n── ② 막는 까닭은 한 가지 ──')
eq('안 고르면', LR.lostBlockedReason(form(), REASONS), '실주 사유를 고르세요')
eq('목록에 없는 글자면', LR.lostBlockedReason(form({ label: '그냥' }), REASONS), '목록에 없는 사유입니다')
eq('기타인데 설명이 비면', LR.lostBlockedReason(form({ label: '기타' }), REASONS), '「기타」는 설명을 적어주세요')
eq('기타 + 설명이면 통과', LR.lostBlockedReason(form({ label: '기타', note: '내년 재접촉' }), REASONS), null)
eq('경쟁사인데 이름이 비면', LR.lostBlockedReason(form({ label: '경쟁사' }), REASONS), '어느 경쟁사인지 적어주세요')
eq('경쟁사 + 이름이면 통과', LR.lostBlockedReason(form({ label: '경쟁사', competitor: '미쓰토요' }), REASONS), null)
eq('실주일 모양이 틀리면', LR.lostBlockedReason(form({ label: '가격', lostAt: '2026-11' }), REASONS), '실주일을 고르세요')
eq('가격만 골라도 통과', LR.lostBlockedReason(form({ label: '가격' }), REASONS), null)

console.log('\n── ②-2 저장할 값 ──')
const patch = LR.lostPatch(form({ label: '경쟁사', competitor: '미쓰토요', note: '15% 저가' }), REASONS)
eq('글자·설명·경쟁사·날짜를 담는다',
  [patch.lost_reason, patch.lost_note, patch.competitor, patch.lost_at],
  ['경쟁사', '15% 저가', '미쓰토요', TODAY])
eq('표가 없으면 id 는 비운다(글자만 저장된다)', patch.lost_reason_id, null)
eq('경쟁사를 묻지 않는 사유면 그 칸은 비운다',
  LR.lostPatch(form({ label: '가격', competitor: '미쓰토요' }), REASONS).competitor, null)
const withId = LR.lostPatch(form({ label: '가격' }), [{ ...REASONS[0], reason_id: 3 }])
eq('표가 있으면 id 를 담는다', withId.lost_reason_id, 3)

console.log('\n── ③ 사유 대기 ──')
eq('사유가 비면 대기', LR.isReasonPending({ lost_reason: null }), true)
eq('자동 실주의 「유효기간 만료」도 대기다', LR.isReasonPending({ fail_reason: LR.NOT_A_REASON }), true)
eq('그 글자는 사유가 아니다', LR.NOT_A_REASON, '유효기간 만료')
eq('사람이 적은 글자가 있으면 대기가 아니다', LR.isReasonPending({ fail_reason: '가격' }), false)
eq('id 가 있으면 대기가 아니다', LR.isReasonPending({ lost_reason_id: 2, fail_reason: LR.NOT_A_REASON }), false)
eq('보여 줄 글자 — 대기', LR.reasonLabelOf({ fail_reason: LR.NOT_A_REASON }), LR.PENDING_LABEL)
eq('그 글자', LR.PENDING_LABEL, '실주 사유 입력 필요')
eq('보여 줄 글자 — 경쟁사까지', LR.reasonLabelOf({ lost_reason: '경쟁사', competitor: '미쓰토요' }), '경쟁사 · 미쓰토요')
eq('id 가 있으면 표의 글자를 쓴다',
  LR.reasonLabelOf({ lost_reason_id: 5, lost_reason: '옛 글자' }, [{ ...REASONS[0], reason_id: 5, label: '가격' }]), '가격')

console.log('\n── ③-2 할 일 목록의 한 줄 ──')
const rows = T.reasonPendingItems([{ quote_id: 7, quote_number: 'KJW261020A', company: '네오오토' }])
eq('글자', rows[0].title, '네오오토 » KJW261020A — 실주 사유 입력 필요')
eq('기한을 매기지 않는다(재촉하면 아무 사유나 고른다)', rows[0].due, null)
eq('태그는 견적', T.KIND_LABEL[rows[0].kind], '견적')
eq('체크할 수 없다(사유를 채워야 사라진다)', rows[0].real, false)
ok('합성 줄에 함께 들어간다',
  T.synthItems({ today: TODAY, reasonPending: [{ quote_id: 7, quote_number: 'A' }] }).some(i => i.key === 'quote-reason:7'))

console.log('\n── ④ 창 하나, 들어오는 자리 셋 ──')
const MODAL = read('components/forecast/LostModal.tsx')
const BOARD = read('app/pipeline/page.tsx')
const PANEL = read('components/dashboard/MyQuotesPanel.tsx')
ok('공용 부품을 쓴다(ModalCard·SearchSelect)', /<ModalCard/.test(MODAL) && /<SearchSelect<LostReason>/.test(MODAL))
ok('닫을 때 묻는다', /confirmClose dirty=\{dirty\}/.test(MODAL))
ok('경쟁사 칸은 그 사유일 때만 뜬다', /\{askCompetitor && \(/.test(MODAL))
ok('모자란 것은 눌러 본 뒤 한 줄로', /\{tried && blocked && <div/.test(MODAL))
ok('판정은 lib 가 한다', /lostBlockedReason\(form, reasons\)/.test(MODAL))
ok('포캐스트 실주가 이 창을 쓴다', /setLostTarget\(\{ opp: o, what: '실주' \}\)/.test(BOARD))
ok('포캐스트 종료도 이 창을 쓴다', /setLostTarget\(\{ opp: o, what: '종료' \}\)/.test(BOARD))
ok('종료는 단계를 바꾸지 않는다', /\{ closeOnly: true \}/.test(BOARD))
ok('견적 실패도 이 창을 쓴다', /what="실패"/.test(PANEL) && /사유 고르기/.test(PANEL))
ok('삭제 사유는 그대로 자유 입력이다', /삭제 요청 사유를 입력하세요/.test(PANEL))

console.log('\n── ⑤ 막지 않는다 ──')
ok('목록의 안내는 **단추**다(막는 것이 아니라 채우는 길)',
  /q\.status === FAIL_STATUS && isReasonPending\(q\)/.test(PANEL) && /setReasonQuote\(q\)/.test(PANEL))
ok('사유를 안 골라도 실패 처리가 된다', /비워 두어도 처리됩니다/.test(PANEL))
ok('사유만 채울 때 상태는 그대로다', /status: reasonQuote\.status/.test(PANEL))
ok('그 뜻을 SQL 에도 적어 두었다', /막지 않는다/.test(read('db/lost_reasons_20261126.sql')))

console.log('\n── ⑥ 칸이 없어도 끝까지 ──')
const CRUD = read('hooks/customer/useOpportunityCrud.ts')
const MUT = read('lib/quoteMutations.ts')
ok('포캐스트 — 셋을 빼고 다시 쓴다', /42703/.test(CRUD) && /update\(base\)/.test(CRUD))
ok('견적 — 셋을 빼고 다시 쓴다', /42703/.test(MUT) && /await run\(base\)/.test(MUT))
ok('목록을 못 읽으면 기본 여덟 줄로 돈다', /FALLBACK_REASONS, fallback: true/.test(read('lib/lostReasonList.ts')))
ok('창이 그 사실을 한 줄로 알린다', /LOST_SCHEMA_NOTE/.test(MODAL))

console.log('\n── ⑦ SQL ──')
const SQL = read('db/lost_reasons_20261126.sql')
ok('표를 만든다', /create table if not exists public\.lost_reasons/.test(SQL))
ok('칸 — label·sort·active·requires_note', /label\s+text not null unique/.test(SQL)
  && /sort\s+integer/.test(SQL) && /active\s+boolean/.test(SQL) && /requires_note\s+boolean/.test(SQL))
ok('경쟁사 깃발도 둔다(글자로 판정하지 않는다)', /requires_competitor boolean/.test(SQL))
ok('포캐스트에 칸 셋', /add column if not exists lost_reason_id/.test(SQL)
  && /add column if not exists competitor/.test(SQL) && /add column if not exists lost_at/.test(SQL))
ok('견적에도 같은 셋', /alter table public\.quotes[\s\S]{0,300}lost_reason_id/.test(SQL))
ok('옛 글자 칸은 그대로 둔다', /lost_reason\(글자\)은 \*\*그대로 둔다\*\*/.test(SQL))
ok('읽기만 내려 준다', /grant select on table public\.lost_reasons to authenticated/.test(SQL)
  && !/grant (insert|update|delete)[^\n]*lost_reasons/.test(SQL))
ok('스키마를 깨운다', /notify pgrst, 'reload schema'/.test(SQL))
ok('APPLIED.md 에 적어 두었다', /lost_reasons_20261126\.sql/.test(read('db/APPLIED.md')))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
