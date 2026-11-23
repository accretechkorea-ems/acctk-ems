// 명함 OCR 파일을 **우리 서버에서** 내주려고 node_modules 에서 public/ocr/ 로 옮긴다.
//
//   node scripts/copy-ocr-assets.js
//
// ── 왜 CDN 을 쓰지 않나 ──────────────────────────────────────────────────
// tesseract.js 는 기본값으로 워커·코어·언어 데이터를 바깥 CDN 에서 받아 온다. 명함을
// 읽는 일은 **개인정보를 다루는 자리**라, 어떤 바깥 서버도 끼지 않게 전부 우리가 내준다.
// (사진 자체는 어디에도 올라가지 않는다 — lib/businessCardOcr.ts)
//
// ── 무엇이 어디서 오나 ───────────────────────────────────────────────────
//   워커·코어  — node_modules 에 있다. package.json 에 적혀 있으니 **git 에 두지 않고**
//                이 스크립트가 설치 뒤에 복사한다(.gitignore 에 적어 두었다).
//   언어 데이터 — 어느 패키지에도 없다. public/ocr/ 에 **넣어 두고 git 으로 간다**
//                (kor·eng, tessdata_fast — 둘이 3MB 다. best 판은 18MB 라 쓰지 않는다).
//
// 설치 뒤 자동으로 돈다(package.json 의 postinstall). 빌드 전에 한 번 더 돌아도 안전하다.

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, 'public', 'ocr')

/** node_modules 에서 가져오는 것 — 없으면 알리고 넘어간다(설치 전일 수 있다). */
const FROM_MODULES = [
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
]

/** git 에 들어 있어야 하는 것 — 없으면 **알린다**(OCR 이 돌지 않는다). */
const MUST_EXIST = ['kor.traineddata.gz', 'eng.traineddata.gz']

fs.mkdirSync(OUT, { recursive: true })

let copied = 0
let missing = 0
for (const [from, to] of FROM_MODULES) {
  const src = path.join(ROOT, 'node_modules', from)
  const dst = path.join(OUT, to)
  if (!fs.existsSync(src)) {
    console.warn(`  (없음) ${from} — npm install 뒤에 다시 돌려라`)
    missing++
    continue
  }
  // 같은 크기면 건너뛴다 — 설치마다 8MB 를 다시 쓰지 않는다.
  if (fs.existsSync(dst) && fs.statSync(dst).size === fs.statSync(src).size) continue
  fs.copyFileSync(src, dst)
  copied++
}

const lost = MUST_EXIST.filter(f => !fs.existsSync(path.join(OUT, f)))
if (lost.length > 0) {
  console.warn(`  ⚠ 언어 데이터가 없다: ${lost.join(' · ')} — 명함 OCR 이 돌지 않는다.`)
  console.warn('    tessdata_fast(4.0.0_fast)의 kor·eng 를 public/ocr/ 에 넣어라.')
}

console.log(`OCR 파일 — 복사 ${copied}개${missing ? ` · 못 찾음 ${missing}개` : ''}${lost.length ? ` · 언어 데이터 없음 ${lost.length}개` : ' · 언어 데이터 있음'}`)
