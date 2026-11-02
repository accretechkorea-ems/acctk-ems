// 쇼룸 사용 시간 겹침 판정 시험 — 기록 겹침 · 신청 겹침 · 안 겹침 · 경계 접촉.
//
//   node scripts/showroom-overlap-check.js
//
// 왜 따로 두는가 — 이 판정 하나가 네 자리를 가른다(사용 기록 등록 409 · 사후 신청 상신 409 ·
// **사전 신청 상신 경고** · 사전 신청 마지막 승인 직전 차단). 특히 두 가지가 쉽게 틀어진다.
//   · **경계 접촉**(09:00~12:00 과 12:00~15:00)은 겹침이 아니다 — 쇼룸은 앞사람이 끝낸
//     시각부터 이어 쓰는 일이 흔하다. 여기서 막으면 정상 예약이 전부 경고를 받는다.
//   · **사후 신청은 세지 않는다** — 그쪽은 상신 때 사용 기록을 이미 만들었다. 같이 세면
//     한 사용이 「기록 겹침 + 신청 겹침」 두 줄로 보인다.
// 또 남의 신청에서 **시간·이름·상태만** 나가는지도 문구로 못 박는다(목적·고객사는 남의
// 영업 정보다).

// eslint 의 no-require-imports 는 맨 require() 를 센다. 이 파일은 node 로 직접 돌리는
// CJS 스크립트라 모듈을 그렇게 불러올 수밖에 없다 — 한 번만 묶어 두고 그것만 쓴다.
const load = module.require.bind(module)
const path = load('path')
const Module = load('module')
const ROOT = path.join(__dirname, '..')
const ts = load(path.join(ROOT, 'node_modules/typescript'))

for (const ext of ['.ts', '.tsx']) {
  Module._extensions[ext] = (mod, filename) => {
    mod._compile(ts.transpileModule(load('fs').readFileSync(filename, 'utf8'), {
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

const {
  hhmm, timesOverlap, recordClashes, requestClashes, sortClashes, clashLabel, warningLines,
} = load(path.join(ROOT, 'lib/showroomOverlap.ts'))

let fails = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
}

// 신규 신청 — 11월 2일, 장비 7번, 10:00~14:00.
const T = { deviceId: 7, date: '2026-11-02', start: '10:00', end: '14:00' }
const rec = (s, e) => ({ start_time: s, end_time: e })
const doc = (id, s, e, who, over = {}) => ({
  document_id: id,
  status: '진행중',
  summary: {
    payload: {
      device_id: 7, usage_date: '2026-11-02', start_time: s, end_time: e, requester_name: who,
      // 목적·고객사도 문서에는 들어 있다 — 경고 문구로 새 나가지 않는지 아래에서 본다.
      purpose: '데모', customer_name: '한국반도체',
      ...over,
    },
    ...(over.is_retroactive === true ? { is_retroactive: true } : {}),
  },
})

console.log('── 시간 모양 눕히기 ──')
eq("'HH:MM:SS' → 'HH:MM'", hhmm('09:30:00'), '09:30')
eq("'HH:MM' 은 그대로", hhmm('09:30'), '09:30')
eq('빈 값·null 은 빈 문자', [hhmm(''), hhmm(null), hhmm(undefined)], ['', '', ''])

console.log('\n── 겹침의 바닥 규칙 ──')
eq('완전히 포개짐', timesOverlap('10:00', '14:00', '10:00', '14:00'), true)
eq('기존이 신규를 품음', timesOverlap('09:00', '18:00', '10:00', '14:00'), true)
eq('신규가 기존을 품음', timesOverlap('11:00', '12:00', '10:00', '14:00'), true)
eq('앞을 1분 물음', timesOverlap('09:00', '10:01', '10:00', '14:00'), true)
eq('뒤를 1분 물음', timesOverlap('13:59', '18:00', '10:00', '14:00'), true)
eq('초 단위가 섞여도 같다', timesOverlap('13:59:00', '18:00:00', '10:00', '14:00'), true)
eq('시간이 비면 판정하지 않는다', [
  timesOverlap('', '14:00', '10:00', '14:00'), timesOverlap('10:00', '', '10:00', '14:00'),
], [false, false])

console.log('\n── 경계 접촉은 겹침이 아니다(이어 쓰기) ──')
eq('앞사람이 10:00 에 끝남', timesOverlap('07:00', '10:00', '10:00', '14:00'), false)
eq('뒷사람이 14:00 에 시작', timesOverlap('14:00', '17:00', '10:00', '14:00'), false)
eq('초까지 붙여도(10:00:00) 겹침 아님', timesOverlap('07:00:00', '10:00:00', '10:00', '14:00'), false)
eq('앞뒤로 딱 붙은 기록 둘 → 경고 없음', recordClashes([rec('07:00:00', '10:00:00'), rec('14:00:00', '17:00:00')], T), [])
eq('앞뒤로 딱 붙은 신청 둘 → 경고 없음', requestClashes([doc(1, '07:00', '10:00', '김선임'), doc(2, '14:00', '17:00', '박책임')], T), [])

console.log('\n── 안 겹침 ──')
eq('아침에 끝난 기록', recordClashes([rec('08:00:00', '09:30:00')], T), [])
eq('다른 날 신청', requestClashes([doc(1, '10:00', '14:00', '김선임', { usage_date: '2026-11-03' })], T), [])
eq('다른 장비 신청', requestClashes([doc(1, '10:00', '14:00', '김선임', { device_id: 9 })], T), [])
eq('빈 목록', [recordClashes([], T), requestClashes([], T)], [[], []])

console.log('\n── 기록 겹침(확정된 사용 기록) ──')
eq('한 건 — 사람·상태는 비운다', recordClashes([rec('09:00:00', '12:00:00')], T),
  [{ kind: 'record', start: '09:00', end: '12:00', who: null, status: null }])
eq('겹치는 것만 골라낸다', recordClashes([rec('08:00:00', '09:00:00'), rec('11:00:00', '13:00:00'), rec('14:00:00', '15:00:00')], T),
  [{ kind: 'record', start: '11:00', end: '13:00', who: null, status: null }])

console.log('\n── 신청 겹침(결재 진행중인 다른 사전 신청) ──')
eq('한 건 — 이름·상태를 싣는다', requestClashes([doc(11, '13:00', '15:00', '홍길동 책임')], T),
  [{ kind: 'request', start: '13:00', end: '15:00', who: '홍길동 책임', status: '진행중' }])
eq('사후 신청은 세지 않는다(기록으로 이미 잡힌다)',
  requestClashes([doc(12, '10:00', '14:00', '홍길동 책임', { is_retroactive: true })], T), [])
eq('자기 문서는 뺀다(재상신)',
  requestClashes([doc(13, '10:00', '14:00', '나')], { ...T, excludeDocumentId: 13 }), [])
eq('자기 문서만 빼고 남은 것은 잡는다',
  requestClashes([doc(13, '10:00', '14:00', '나'), doc(14, '11:00', '12:00', '김선임')], { ...T, excludeDocumentId: 13 }),
  [{ kind: 'request', start: '11:00', end: '12:00', who: '김선임', status: '진행중' }])
eq('summary 모양이 아닌 옛 문서는 건너뛴다',
  requestClashes([{ document_id: 15, status: '진행중', summary: null }, { document_id: 16, status: '진행중', summary: { payload: null } }], T), [])
eq('이름이 없는 문서도 판정은 한다',
  requestClashes([doc(17, '11:00', '12:00', undefined)], T),
  [{ kind: 'request', start: '11:00', end: '12:00', who: null, status: '진행중' }])

console.log('\n── 둘이 섞였을 때의 순서(이른 시간 · 같으면 기록 먼저) ──')
const mixed = [
  ...recordClashes([rec('13:00:00', '16:00:00'), rec('10:00:00', '11:00:00')], T),
  ...requestClashes([doc(21, '10:00', '12:00', '김선임'), doc(22, '11:30', '13:30', '박책임')], T),
]
eq('시작 시간 순', sortClashes(mixed).map(c => `${c.kind} ${c.start}`),
  ['record 10:00', 'request 10:00', 'request 11:30', 'record 13:00'])
eq('원본을 뒤집지 않는다', mixed.map(c => `${c.kind} ${c.start}`),
  ['record 13:00', 'record 10:00', 'request 10:00', 'request 11:30'])

console.log('\n── 확인창에 나가는 문구(시간·이름·상태만) ──')
eq('기록 겹침 한 줄', clashLabel({ kind: 'record', start: '09:00', end: '12:00', who: null, status: null }),
  '09:00~12:00 (확정된 사용 기록)')
eq('신청 겹침 한 줄', clashLabel({ kind: 'request', start: '09:00', end: '12:00', who: '홍길동 책임', status: '진행중' }),
  '09:00~12:00 (홍길동 책임, 결재중)')
eq('이름이 없으면 상태만', clashLabel({ kind: 'request', start: '09:00', end: '12:00', who: null, status: '진행중' }),
  '09:00~12:00 (결재중)')
eq('상태를 못 읽어도 결재중으로 적는다', clashLabel({ kind: 'request', start: '09:00', end: '12:00', who: '김선임', status: null }),
  '09:00~12:00 (김선임, 결재중)')
eq('줄 목록은 정렬까지 해서 돌려준다', warningLines(mixed),
  ['10:00~11:00 (확정된 사용 기록)', '10:00~12:00 (김선임, 결재중)', '11:30~13:30 (박책임, 결재중)', '13:00~16:00 (확정된 사용 기록)'])
eq('겹치는 것이 없으면 빈 배열', warningLines([]), [])
// 목적·고객사는 문서에 들어 있어도 문구로 새 나가서는 안 된다.
eq('남의 신청 세부 내용은 새지 않는다',
  warningLines(requestClashes([doc(31, '11:00', '12:00', '홍길동 책임')], T)).join(' ').match(/데모|한국반도체/) === null, true)

console.log(fails === 0 ? '\n모두 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
