// 포캐스트 **단계 이력** — 쓰는 곳 · 폴백 · 요약 글자 (2026-11-28, 야간4 4-1·4-2).
//
//   node scripts/forecast-stage-history-check.js
//
// 지키는 약속
//   ① 단계가 옮겨 간 **네 길**이 모두 한 줄을 남긴다: 생성 · 수정(단계가 바뀐 때) ·
//      단계만 바꾸기(칸반 드래그) · 실주. 그리고 서버의 **견적 자동 동기화**도.
//   ② 표가 아직 없으면(42P01/PGRST205) 사건으로 떨어지고 **본 일은 막지 않는다**.
//   ③ 요약은 「상담 9/4 → 견적제출 9/20 → 협상 10/15 → 실주 11/24」 한 줄이다.
//      같은 단계가 잇따르면 뒤엣것만 남는다(자동 동기화가 겹쳐 쓴 경우).
//   ④ 활동 이력의 **생성 줄 꼬리표**는 지금 단계가 아니라 **그때 단계**다.
//   ⑤ 잡 변경(금액·제목)은 이력에 담지 않는다.
//   ⑥ SQL 이 [0단계] 조회 · 트랜잭션 · RLS · 소급 · 스키마 재적재를 갖추었다.
//
// 키도 서버도 없이 돈다.

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

const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')
const code = s => s.split(/\r?\n/).filter(l => {
  const t = l.trim()
  return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
}).join('\n')

const H = load(path.join(ROOT, 'lib/opportunityStageHistory.ts'))
const { isForecastEvent } = load(path.join(ROOT, 'lib/customerEvents.ts'))

const fails = []
let total = 0
const ok = (name, got, want = true) => {
  total += 1
  const same = JSON.stringify(got) === JSON.stringify(want)
  console.log(`${same ? 'OK  ' : 'FAIL'} ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
  if (!same) fails.push(name)
}

console.log('── ① 요약 한 줄 ──')
const row = (to, at, from = null) => ({ opportunity_id: 1, from_stage: from, to_stage: to, changed_at: at })
ok('네 칸이 화살표로 이어진다',
  H.summarizeStageHistory([
    row('상담', '2026-09-04T01:00:00Z'),
    row('견적제출', '2026-09-20T01:00:00Z', '상담'),
    row('협상', '2026-10-15T01:00:00Z', '견적제출'),
    row('실주', '2026-11-24T01:00:00Z', '협상'),
  ]),
  '상담 9/4 → 견적제출 9/20 → 협상 10/15 → 실주 11/24')
ok('줄이 하나면 한 칸', H.summarizeStageHistory([row('상담', '2026-09-04T01:00:00Z')]), '상담 9/4')
ok('줄이 없으면 빈 글자', H.summarizeStageHistory([]), '')
ok('시간 순이 아니어도 시간 순으로 세운다',
  H.summarizeStageHistory([row('협상', '2026-10-15T01:00:00Z'), row('상담', '2026-09-04T01:00:00Z')]),
  '상담 9/4 → 협상 10/15')
ok('같은 단계가 잇따르면 뒤엣것만',
  H.summarizeStageHistory([
    row('상담', '2026-09-04T01:00:00Z'),
    row('견적제출', '2026-09-20T01:00:00Z'),
    row('견적제출', '2026-09-21T01:00:00Z'),
    row('협상', '2026-10-15T01:00:00Z'),
  ]),
  '상담 9/4 → 견적제출 9/20 → 협상 10/15')
ok('날짜가 없으면 단계만', H.summarizeStageHistory([row('상담', '')]), '상담')
ok('9/4 — 앞의 0 을 떼고 해는 적지 않는다', [H.shortDate('2026-09-04T01:00:00Z'), H.shortDate('2026-11-24')], ['9/4', '11/24'])
ok('날짜가 아니면 빈 글자', H.shortDate(null), '')

console.log('── ② 표가 없을 때 ──')
ok('42P01 은 표 없음', H.stageTableMissing({ code: '42P01' }))
ok('PGRST205 도 표 없음', H.stageTableMissing({ code: 'PGRST205' }))
ok('그 밖의 오류는 아니다', H.stageTableMissing({ code: '23505' }), false)
ok('오류가 없으면 아니다', H.stageTableMissing(null), false)
ok('폴백 사건 종류는 forecast_stage_changed', H.STAGE_FALLBACK_EVENT, 'forecast_stage_changed')
ok('표 이름을 한 곳에서 적는다', H.STAGE_HISTORY_TABLE, 'opportunity_stage_history')

// 표가 없는 supabase 를 흉내 내어 **본 일이 막히지 않는지** 본다.
const fakeMissing = {
  from: () => ({ insert: async () => ({ error: { code: '42P01', message: 'relation does not exist' } }) }),
}
const fakeOk = { from: () => ({ insert: async () => ({ error: null }) }) }
;(async () => {
  const logged = []
  const r1 = await H.recordStageChange(fakeMissing, {
    opportunityId: 7, fromStage: '상담', toStage: '협상', customerId: 42,
    logEvent: row => logged.push(row),
  })
  ok('표가 없으면 false 를 돌려주되 던지지 않는다', r1, false)
  ok('그때 사건 한 줄이 남는다', logged.length, 1)
  ok('그 사건이 단계 둘을 담는다',
    [logged[0]?.type, logged[0]?.payload?.from_stage, logged[0]?.payload?.to_stage, logged[0]?.customerId],
    ['forecast_stage_changed', '상담', '협상', 42])
  const logged2 = []
  const r2 = await H.recordStageChange(fakeMissing, {
    opportunityId: 7, fromStage: null, toStage: '상담', customerId: null,
    logEvent: row => logged2.push(row),
  })
  ok('사업장을 모르면 사건도 건너뛴다(던지지 않는다)', [r2, logged2.length], [false, 0])
  const r3 = await H.recordStageChange(fakeOk, { opportunityId: 7, toStage: '상담' })
  ok('표가 있으면 true', r3, true)

  console.log('── ③ 쓰는 곳 넷 + 서버 하나 ──')
  const CRUD = code(read('hooks/customer/useOpportunityCrud.ts'))
  ok('한 길(logStage)로 모은다', /const logStage = \(/.test(CRUD))
  ok('생성 — 첫 단계 한 줄', /if \(!wasEditing\) logStage\(row, null, payload\.stage\)/.test(CRUD))
  ok('수정 — 단계가 **바뀐 때만**', /editingOpp\.stage !== payload\.stage\) logStage\(row, editingOpp\.stage, payload\.stage\)/.test(CRUD))
  ok('단계만 바꾸기(칸반 드래그)', /logStage\(o, o\.stage, next\)/.test(CRUD))
  ok('실주 — 옮긴 때만(종료만 찍기는 아니다)',
    /!opts\.closeOnly && opts\.stage && opts\.stage !== o\.stage\) logStage\(o, o\.stage, opts\.stage\)/.test(CRUD))
  const ROUTE = code(read('app/api/customer-change/route.ts'))
  ok('서버의 견적 자동 동기화도 한 줄', /recordStageChange\(sb, \{/.test(ROUTE))
  ok('그 줄은 사람이 아니다(changedBy 를 비운다)', /changedBy: null,/.test(ROUTE))
  ok('단계가 **정말 바뀐 때만**', /typeof patch\.stage === 'string' && patch\.stage !== opp\.stage/.test(ROUTE))

  console.log('── ④ 활동 이력 — 그때 단계 ──')
  const TL = code(read('components/customer/ActivityTimeline.tsx'))
  ok('이력의 첫 줄을 쓴다', /const bornStage = hist\.length > 0 \? hist\[0\]\.to_stage : null/.test(TL))
  ok('꼬리표가 **그때 단계**다', /labelSuffix: bornStage \?\? o\.stage,/.test(TL))
  ok('모르면 그렇다고 알린다', /labelSuffixTitle: bornStage \? undefined :/.test(TL))
  ok('지금 단계를 그대로 적던 줄이 없다', /labelSuffix: o\.stage,/.test(TL), false)
  ok('포캐스트 사건 셋은 **포캐스트 종류**로 선다', /isForecastEvent\(e\.event_type\) \? \('포캐스트' as const\)/.test(TL))
  ok('단계 사건의 글자가 있다', /case 'forecast_stage_changed':/.test(read('lib/customerEventView.ts')))
  ok('그 글자는 화살표다', /body: arrow\(p\.from_stage, p\.to_stage\)/.test(read('lib/customerEventView.ts')))
  ok('포캐스트 셋 판정', [isForecastEvent('forecast_created'), isForecastEvent('forecast_stage_changed'), isForecastEvent('forecast_closed'), isForecastEvent('site_edited')],
    [true, true, true, false])

  console.log('── ⑤ 읽어 오는 길 ──')
  const HOOK = code(read('hooks/useCompanyTimeline.ts'))
  ok('이력을 함께 읽는다', /fetchStageHistories\(supabase,/.test(HOOK))
  ok('표가 없으면 빈 Map 이라 화면이 기다리지 않는다', /stageHistories: new Map<number, StageHistoryRow\[\]>\(\),/.test(HOOK))
  ok('화면에 넘긴다', /stageHistories=\{timeline\.stageHistories\}/.test(read('components/home/list/CompanyPane.tsx')))

  console.log('── ⑥ SQL ──')
  const SQL = read('db/opportunity_stage_history_20261128.sql')
  ok('머리에 0단계 조회가 먼저', SQL.indexOf('[0' + '단계]') < SQL.indexOf('begin;'))
  ok('트랜잭션이다', /\bbegin;/.test(SQL) && /\bcommit;/.test(SQL))
  ok('재실행 안전하다(create if not exists)', /create table if not exists public\.opportunity_stage_history/.test(SQL))
  ok('칸 여섯을 갖추었다',
    ['id', 'opportunity_id', 'from_stage', 'to_stage', 'changed_at', 'changed_by'].every(c => new RegExp(`^\\s+${c}\\s`, 'm').test(SQL)))
  ok('RLS 를 켠다', /alter table public\.opportunity_stage_history enable row level security/.test(SQL))
  ok('읽기는 로그인 전원', /create policy osh_select[\s\S]{0,120}using \(true\)/.test(SQL))
  ok('쓰기는 제 건에만', /create policy osh_insert[\s\S]{0,400}auth\.jwt\(\) ->> 'email'/.test(SQL))
  ok('소급도 한 번만 들어간다', /where not exists \([\s\S]{0,200}opportunity_stage_history h/.test(SQL))
  ok('스키마를 다시 읽힌다', /notify pgrst, 'reload schema';/.test(SQL))

  if (fails.length > 0) {
    console.error('\n실패:')
    for (const f of fails) console.error('  · ' + f)
    process.exit(1)
  }
  console.log(`\n통과 — 포캐스트 단계 이력(검사 ${total}개 · 실패 0)`)
})().catch(e => { console.error(e); process.exit(1) })
