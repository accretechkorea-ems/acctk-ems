// 장비 사진 경로 판정 시험 — 공개 버킷을 비공개로 돌려도 사진이 뜨는가.
//
//   node scripts/device-image-check.js
//
// 왜 따로 두는가 — device-images 버킷은 공개였고(인증 없이 열렸다) 저장된 값 34행이 전부
// 공개 주소다. 비공개로 돌리는 순간 그 주소는 다 깨지므로, **읽을 때 경로로 바꾸는 변환**이
// 유일한 안전장치다. 프로필 사진에서 같은 모양으로 한 번 깨진 적이 있다(docs/audit-2026-10.md).

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

const { storageObjectPath, isSafeStorageName } = load(path.join(ROOT, 'lib/storagePath.ts'))
const {
  DEVICE_BUCKET, DEVICE_IMAGE_WIDTHS, deviceImageWidthFor, deviceImagePath,
  isDefaultDeviceImage, deviceImageFileName,
} = load(path.join(ROOT, 'lib/deviceImage.ts'))
const { PROFILE_BUCKET, profileImagePath } = load(path.join(ROOT, 'lib/profileImage.ts'))

let fails = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`)
  if (!ok) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}

const BASE = 'https://abcdefgh.supabase.co/storage/v1'
const FILE = 'device-110-1792465305624.jpg'

console.log('── 공통 변환(버킷마다 쓴다) ──')
eq('경로만 들어오면 그대로', storageObjectPath(FILE, DEVICE_BUCKET), FILE)
eq('옛 공개 주소에서 뽑아낸다', storageObjectPath(`${BASE}/object/public/${DEVICE_BUCKET}/${FILE}`, DEVICE_BUCKET), FILE)
eq('서명 주소에서도(토큰은 뗀다)', storageObjectPath(`${BASE}/object/sign/${DEVICE_BUCKET}/${FILE}?token=abc`, DEVICE_BUCKET), FILE)
eq('변환 서명 주소에서도', storageObjectPath(`${BASE}/render/image/sign/${DEVICE_BUCKET}/${FILE}?width=240&token=x`, DEVICE_BUCKET), FILE)
eq('변환 공개 주소에서도(thumbUrl 이 만들던 꼴)', storageObjectPath(`${BASE}/render/image/public/${DEVICE_BUCKET}/${FILE}?width=240&quality=70`, DEVICE_BUCKET), FILE)
eq('다른 버킷 주소는 버린다', storageObjectPath(`${BASE}/object/public/profile-images/x.jpg`, DEVICE_BUCKET), null)
eq('우리 것이 아닌 주소도 버린다', storageObjectPath('https://example.com/a.jpg', DEVICE_BUCKET), null)
eq('빈 값', [storageObjectPath(null, DEVICE_BUCKET), storageObjectPath('', DEVICE_BUCKET), storageObjectPath('  ', DEVICE_BUCKET)], [null, null, null])
eq('버킷 뒤가 비면 버린다', storageObjectPath(`${BASE}/object/public/${DEVICE_BUCKET}/`, DEVICE_BUCKET), null)
eq('퍼센트 인코딩을 되돌린다', storageObjectPath(`${BASE}/object/public/${DEVICE_BUCKET}/a%2Db.jpg`, DEVICE_BUCKET), 'a-b.jpg')

console.log('\n── 프로필 사진도 같은 함수를 쓴다(뜻이 바뀌지 않았다) ──')
eq('프로필 공개 주소', profileImagePath(`${BASE}/object/public/${PROFILE_BUCKET}/profile-20-1.jpg`), 'profile-20-1.jpg')
eq('프로필 버킷이 아니면 null', profileImagePath(`${BASE}/object/public/${DEVICE_BUCKET}/${FILE}`), null)

console.log('\n── 장비 사진 전용 ──')
eq('버킷 이름', DEVICE_BUCKET, 'device-images')
eq('장비 사진 경로', deviceImagePath(`${BASE}/object/public/${DEVICE_BUCKET}/${FILE}`), FILE)
eq('받아도 되는 이름', isSafeStorageName(FILE), true)
eq('상위 경로는 막는다', isSafeStorageName('../secret.jpg'), false)
eq('슬래시도 막는다', isSafeStorageName('a/b.jpg'), false)

console.log('\n── 카탈로그 사진(default_*) ──')
eq('default_SNEX040.png', isDefaultDeviceImage('default_SNEX040.png'), true)
eq('default_AXCEL.jpg', isDefaultDeviceImage('default_AXCEL.jpg'), true)
eq('대소문자 섞여도', isDefaultDeviceImage('Default_R60A.PNG'), true)
eq('올린 장비 사진은 아니다', isDefaultDeviceImage(FILE), false)
eq('default 로 시작해도 그림이 아니면 아니다', isDefaultDeviceImage('default_x.txt'), false)
eq('경로를 섞어 넣는 수는 막는다', isDefaultDeviceImage('../default_x.png'), false)
eq('빈 이름', isDefaultDeviceImage(''), false)

console.log('\n── 변환 폭 ──')
eq('목록', [...DEVICE_IMAGE_WIDTHS], [240, 480])
eq('120px 카드 → 240', deviceImageWidthFor(120), 240)
eq('240px 카드 → 480', deviceImageWidthFor(240), 480)
eq('아주 큰 자리는 가장 큰 값', deviceImageWidthFor(900), 480)

console.log('\n── 올릴 파일 이름 ──')
eq('확장자를 살린다', deviceImageFileName(110, 'photo.PNG', 1792465305624), 'device-110-1792465305624.png')
eq('모르는 확장자는 jpg', deviceImageFileName(7, 'noext', 1), 'device-7-1.jpg')
eq('만든 이름은 라우트를 통과한다', isSafeStorageName(deviceImageFileName(7, 'a.webp', 2)), true)
eq('만든 이름은 카탈로그로 오인되지 않는다', isDefaultDeviceImage(deviceImageFileName(7, 'a.png', 2)), false)

console.log(fails === 0 ? '\n모두 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
