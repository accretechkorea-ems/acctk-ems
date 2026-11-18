// 메모 팝오버 규칙 시험 — 아이콘 색·높이·권한 분기.
//
//   node scripts/memo-popover-check.js
//
// 왜 따로 두는가 — 메모는 열여섯 자리에 흩어져 있고 자리마다 「누가 고칠 수 있나」가
// 다르다. 그 판정이 화면 조각마다 흩어지면 또 갈린다. 색·높이·권한을 글로 못 박는다.

// eslint 의 no-require-imports 는 맨 require() 를 센다. node 로 직접 돌리는 CJS 라
// 그렇게 부를 수밖에 없다 — 한 번만 묶어 두고 그것만 쓴다.
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
        esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX,
      }, fileName: filename,
    }).outputText, filename)
  }
}
const origResolve = Module._resolveFilename
Module._resolveFilename = function (req, ...rest) {
  if (req.startsWith('@/')) req = path.join(ROOT, req.slice(2))
  return origResolve.call(this, req, ...rest)
}

const M = load(path.join(ROOT, 'components/common/MemoPopover.ts' + 'x'))
const P = load(path.join(ROOT, 'lib/memoPerm.ts'))

let fails = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
}

console.log('── 아이콘 색 ──')
eq('메모가 있으면 파랑', M.memoIconColor('부품 재고 확인 필요'), '#234ea2')
eq('없으면 흐린 회색', M.memoIconColor(null), '#c0c4cc')
eq('공백뿐이면 없는 것', [M.memoIconColor('   '), M.memoIconColor('\n')], ['#c0c4cc', '#c0c4cc'])
eq('있는가 판정', [M.hasMemo('가'), M.hasMemo(''), M.hasMemo(undefined)], [true, false, false])

console.log('\n── 치수 ──')
eq('길이 상한', M.MEMO_MAX, 1000)
eq('팝오버 최대 높이(넘으면 그 안에서 구른다)', M.MEMO_MAX_HEIGHT, 320)

console.log('\n── 권한 — 발주 요청 메모(작성자 본인 + 영업관리) ──')
const author = { engineerId: 7, isPurchaseTeam: false }
const other = { engineerId: 9, isPurchaseTeam: false }
const manager = { engineerId: 9, isPurchaseTeam: true }
eq('작성자 본인은 고칠 수 있다', P.canEditRequestMemo(author, 7), true)
eq('영업관리도 고칠 수 있다', P.canEditRequestMemo(manager, 7), true)
eq('그 밖은 못 고친다', P.canEditRequestMemo(other, 7), false)

console.log('\n── 권한 — 영업관리 메모(영업관리만) ──')
eq('영업관리만', P.canEditOrderMemo(manager), true)
eq('작성자여도 안 된다', P.canEditOrderMemo(author), false)

console.log('\n── 권한 — 수리 메모(수리 목록을 보는 사람) ──')
eq('목록을 볼 수 있으면 고친다', P.canEditRepairMemo(true), true)
eq('못 보면 못 고친다', P.canEditRepairMemo(false), false)

// 서버 판정 — 라우트(/api/purchase-order, action=save_memo)가 그대로 쓰는 함수다.
// 실측으로는 발주 권한이 없는 계정이 있어야 403 두 갈래를 볼 수 있어, 그 분기를 여기서 고정한다.
console.log('\n── 서버 판정(save_memo) ──')
const v = (p) => P.memoSaveVerdict({ privileged: false, isOwner: false, hasRequestMemo: false, hasOrderMemo: false, ...p })
eq('보낸 메모가 없으면 400', v({}), { ok: false, status: 400, reason: '저장할 메모가 없습니다.' })
eq('남의 견적 + 권한 없음 → 403',
  v({ hasRequestMemo: true }), { ok: false, status: 403, reason: 'Forbidden' })
eq('본인 견적의 요청 메모 → 통과',
  v({ isOwner: true, hasRequestMemo: true }), { ok: true })
eq('본인 견적이어도 영업관리 메모는 403',
  v({ isOwner: true, hasOrderMemo: true }),
  { ok: false, status: 403, reason: '영업관리 메모는 발주 담당자만 고칠 수 있습니다.' })
eq('발주 담당자는 남의 견적의 영업관리 메모도 통과',
  v({ privileged: true, hasOrderMemo: true }), { ok: true })
eq('발주 담당자는 요청 메모도 통과',
  v({ privileged: true, hasRequestMemo: true }), { ok: true })
eq('두 칸을 함께 보내면 더 엄한 쪽을 본다(권한 없으면 403)',
  v({ isOwner: true, hasRequestMemo: true, hasOrderMemo: true }),
  { ok: false, status: 403, reason: '영업관리 메모는 발주 담당자만 고칠 수 있습니다.' })

console.log(fails === 0 ? '\n모두 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
