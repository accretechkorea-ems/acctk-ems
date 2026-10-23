// 프로필 사진 경로 판정 시험 — 옛 공개 URL 이 섞여 있어도 경로를 뽑아내는가.
//
//   node scripts/profile-image-check.js
//
// 왜 따로 두는가 — 이 변환 하나가 「사진이 보이는가」를 가른다. 비공개 버킷에 공개 URL 을
// 저장해 두어 1년 가까이 깨져 있었고(2026-10-23 확인: HTTP 400), 옛 행을 DB 에서 고치지 않고
// **읽을 때** 변환하기로 했으므로 그 변환이 틀리면 같은 증상이 조용히 돌아온다.

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
  PROFILE_BUCKET, AVATAR_WIDTHS, avatarWidthFor,
  profileImagePath, isSafeProfileImageName, profileImageFileName,
} = load(path.join(ROOT, 'lib/profileImage.ts'))

let fails = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`)
  if (!ok) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}

const BASE = 'https://abcdefgh.supabase.co/storage/v1'
const FILE = 'profile-20-1790139458648.jpg'

console.log('── 저장된 값 → 경로 ──')
eq('경로만 들어오면 그대로', profileImagePath(FILE), FILE)
eq('옛 공개 URL 에서 뽑아낸다', profileImagePath(`${BASE}/object/public/${PROFILE_BUCKET}/${FILE}`), FILE)
eq('서명 URL 에서도 뽑아낸다(토큰은 뗀다)',
  profileImagePath(`${BASE}/object/sign/${PROFILE_BUCKET}/${FILE}?token=eyJhbGciOi.abc`), FILE)
eq('변환 서명 URL 에서도', profileImagePath(`${BASE}/render/image/sign/${PROFILE_BUCKET}/${FILE}?width=80&token=x`), FILE)
eq('질의 문자열만 붙은 경로', profileImagePath(`${FILE}?v=2`), FILE)
eq('퍼센트 인코딩을 되돌린다', profileImagePath(`${BASE}/object/public/${PROFILE_BUCKET}/profile%2D20.jpg`), 'profile-20.jpg')
eq('폴더가 섞여 있으면 마지막 조각', profileImagePath(`${BASE}/object/public/${PROFILE_BUCKET}/2026/${FILE}`), FILE)

console.log('\n── 없는 값·쓸 수 없는 값 ──')
eq('null', profileImagePath(null), null)
eq('undefined', profileImagePath(undefined), null)
eq('빈 문자열', profileImagePath(''), null)
eq('공백만', profileImagePath('   '), null)
eq('우리 버킷이 아닌 주소는 버린다', profileImagePath('https://example.com/someone.jpg'), null)
eq('버킷 뒤가 비어 있으면 버린다', profileImagePath(`${BASE}/object/public/${PROFILE_BUCKET}/`), null)

console.log('\n── 라우트가 받아도 되는 이름인가 ──')
eq('보통 이름', isSafeProfileImageName(FILE), true)
eq('상위 경로는 막는다', isSafeProfileImageName('../secret.jpg'), false)
eq('슬래시는 막는다', isSafeProfileImageName('a/b.jpg'), false)
eq('한글·공백은 막는다', [isSafeProfileImageName('사진.jpg'), isSafeProfileImageName('a b.jpg')], [false, false])
eq('빈 이름은 막는다', isSafeProfileImageName(''), false)

console.log('\n── 올릴 파일 이름 ──')
eq('확장자를 살린다', profileImageFileName(20, 'my photo.PNG', 1790139458648), 'profile-20-1790139458648.png')
eq('모르는 확장자는 jpg', profileImageFileName(7, 'noext', 1), 'profile-7-1.jpg')
eq('이상한 글자가 섞인 확장자도 jpg', profileImageFileName(7, 'x.j%pg', 1), 'profile-7-1.jpg')
eq('만든 이름은 라우트를 통과한다', isSafeProfileImageName(profileImageFileName(20, 'a.webp', 2)), true)

console.log('\n── 변환 폭 ──')
eq('목록', [...AVATAR_WIDTHS], [80, 160, 320])
eq('40px 자리 → 80', avatarWidthFor(40), 80)
eq('72px 자리 → 160', avatarWidthFor(72), 160)
eq('24px 자리 → 80', avatarWidthFor(24), 80)
eq('아주 큰 자리는 가장 큰 값', avatarWidthFor(400), 320)

console.log(fails === 0 ? '\n모두 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
