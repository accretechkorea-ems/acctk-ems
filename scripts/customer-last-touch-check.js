// 「마지막 접점」 판정 시험 — 목록 정렬과 상세 요약이 같은 값을 써야 한다.
//
//   node scripts/customer-last-touch-check.js
//
// 왜 따로 두는가 — 예전 정렬은 서비스 리포트·장비 설치일만 봐서, 영업활동·견적·수리만
// 있는 업체가 목록 아래로 깔렸다. 어느 갈래 하나가 빠지면 그 증상이 조용히 돌아온다.

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

const T = load(path.join(ROOT, 'lib/customerLastTouch.ts'))

let fails = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
}

console.log('── 날짜 다듬기 ──')
eq('시각이 붙어 와도 날짜만', T.touchDate('2026-11-17T05:40:23+00:00'), '2026-11-17')
eq('빈 값은 null', [T.touchDate(null), T.touchDate(''), T.touchDate('  ')], [null, null, null])
eq('날짜가 아니면 null', T.touchDate('미정'), null)

console.log('\n── 네 갈래 중 최신 ──')
eq('가장 최근 것을 고른다',
  T.pickLastTouch({ activity: ['2026-01-02'], service: ['2026-03-04'], quote: ['2026-02-02'] }),
  { date: '2026-03-04', source: '서비스', actorId: null })
eq('영업활동만 있어도 잡힌다',
  T.pickLastTouch({ activity: ['2026-05-06'] }), { date: '2026-05-06', source: '영업활동', actorId: null })
eq('견적만 있어도 잡힌다 — 예전 정렬이 놓치던 자리',
  T.pickLastTouch({ quote: ['2026-07-08'] }), { date: '2026-07-08', source: '견적', actorId: null })
eq('수리만 있어도 잡힌다',
  T.pickLastTouch({ repair: ['2026-09-10'] }), { date: '2026-09-10', source: '수리', actorId: null })
eq('같은 날이면 사람이 적은 기록이 먼저',
  T.pickLastTouch({ activity: ['2026-06-01'], quote: ['2026-06-01'] }),
  { date: '2026-06-01', source: '영업활동', actorId: null })
eq('아무것도 없으면 null', T.pickLastTouch({}), null)
eq('빈 날짜만 있으면 null', T.pickLastTouch({ service: [null, '', '미정'] }), null)

console.log('\n── 작성자(그 일을 한 우리 쪽 사람) ──')
// 목록 보기의 「최근 활동 · 작성자」 칸이 쓴다. 날짜만 넘기던 옛 호출도 그대로 돈다.
eq('{date, actorId} 를 넘기면 사람이 함께 나온다',
  T.pickLastTouch({ activity: [{ date: '2026-05-06', actorId: 7 }] }),
  { date: '2026-05-06', source: '영업활동', actorId: 7 })
eq('이긴 갈래의 사람이 나온다',
  T.pickLastTouch({ activity: [{ date: '2026-01-02', actorId: 7 }], quote: [{ date: '2026-03-04', actorId: 9 }] }),
  { date: '2026-03-04', source: '견적', actorId: 9 })
eq('날짜 문자열과 섞여 있어도 된다',
  T.pickLastTouch({ service: ['2026-02-01', { date: '2026-04-01', actorId: 3 }] }),
  { date: '2026-04-01', source: '서비스', actorId: 3 })
eq('사람을 모르면 null',
  T.pickLastTouch({ repair: [{ date: '2026-09-10' }] }),
  { date: '2026-09-10', source: '수리', actorId: null })
eq('같은 날이면 앞선 갈래의 사람이 이긴다',
  T.pickLastTouch({ activity: [{ date: '2026-06-01', actorId: 7 }], quote: [{ date: '2026-06-01', actorId: 9 }] }),
  { date: '2026-06-01', source: '영업활동', actorId: 7 })

console.log('\n── 정렬 값 ──')
const a = T.pickLastTouch({ activity: ['2026-11-17'] })
const b = T.pickLastTouch({ service: ['2026-11-16'] })
eq('최신이 더 큰 값', T.touchValue(a) > T.touchValue(b), true)
eq('없으면 0', T.touchValue(null), 0)

console.log(fails === 0 ? '\n모두 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
