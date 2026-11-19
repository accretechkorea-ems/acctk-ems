/**
 * lib/nameEn.ts — 영문명 칸이 없는 DB 에서도 검색이 죽지 않는가.
 *
 * 재는 것:
 *   ① searchOr 가 영문명을 볼 때/안 볼 때 조건을 바르게 만든다.
 *   ② isMissingNameEn 이 「그런 칸 없다」만 골라낸다(다른 오류를 삼키면 안 된다).
 *   ③ withNameEnFallback 이 그 오류에서만, **딱 한 번** 다시 돌린다.
 */
const path = require('path')
const Module = require('module')
const ts = require('typescript')
const load = module.require.bind(module)
const ROOT = path.resolve(__dirname, '..')

// '@/...' 를 프로젝트 뿌리로 돌린다.
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith('@/')) request = path.join(ROOT, request.slice(2))
  return origResolve.call(this, request, ...rest)
}

// ts 파일을 그 자리에서 옮겨 읽는다.
require.extensions['.ts'] = (mod, filename) => {
  const src = require('fs').readFileSync(filename, 'utf8')
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  }).outputText
  mod._compile(out, filename)
}

const { searchOr, colsWithNameEn, isMissingNameEn, withNameEnFallback } = load(path.join(ROOT, 'lib/nameEn.ts'))

let fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) { fail++; console.error(`  ✗ ${name}\n      얻음: ${JSON.stringify(got)}\n      기대: ${JSON.stringify(want)}`) }
  else console.log(`  ✓ ${name}`)
}

console.log('[name-en] ① 검색 조건')
eq('영문명을 본다', searchOr('현대', true), 'company_name.ilike.%현대%,site_name.ilike.%현대%,name_en.ilike.%현대%')
eq('영문명을 뺀다', searchOr('현대', false), 'company_name.ilike.%현대%,site_name.ilike.%현대%')
eq('select 에 붙인다', colsWithNameEn('customer_id, company_name', true), 'customer_id, company_name, name_en')
eq('select 에서 뺀다', colsWithNameEn('customer_id, company_name', false), 'customer_id, company_name')

console.log('[name-en] ② 오류 가려내기')
eq('칸 없음(코드)', isMissingNameEn({ code: '42703', message: 'column customers.name_en does not exist' }), true)
eq('칸 없음(본문만)', isMissingNameEn({ message: 'column "name_en" does not exist' }), true)
eq('다른 오류는 아니다', isMissingNameEn({ code: '42501', message: 'permission denied' }), false)
eq('오류 없음', isMissingNameEn(null), false)

console.log('[name-en] ③ 되돌이길')
;(async () => {
  {
    const seen = []
    const r = await withNameEnFallback(useEn => {
      seen.push(useEn)
      return Promise.resolve(useEn
        ? { data: null, error: { code: '42703', message: 'column customers.name_en does not exist' } }
        : { data: [{ customer_id: 1 }], error: null })
    })
    eq('칸이 없으면 한 번 더, 영문명 없이', seen, [true, false])
    eq('두 번째 결과를 돌려준다', r.data, [{ customer_id: 1 }])
  }
  {
    const seen = []
    const r = await withNameEnFallback(useEn => {
      seen.push(useEn)
      return Promise.resolve({ data: [{ customer_id: 2 }], error: null })
    })
    eq('칸이 있으면 한 번만', seen, [true])
    eq('첫 결과를 돌려준다', r.data, [{ customer_id: 2 }])
  }
  {
    const seen = []
    const r = await withNameEnFallback(useEn => {
      seen.push(useEn)
      return Promise.resolve({ data: null, error: { code: '42501', message: 'permission denied' } })
    })
    eq('다른 오류는 다시 돌리지 않는다', seen, [true])
    eq('그 오류를 그대로 올린다', r.error.code, '42501')
  }

  if (fail > 0) { console.error(`\n[name-en] 실패 ${fail}건`); process.exit(1) }
  console.log('\n[name-en] 전부 통과')
})()
