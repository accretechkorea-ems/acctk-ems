// 홈 화면 앱 아이콘을 **레포에 있는 로고로** 만든다 (2026-11-26).
//
//   node scripts/make-app-icons.js
//
// ── 왜 스크립트인가 ─────────────────────────────────────────────────────────
//   아이콘은 세 벌이 필요하다(180 · 192 · 512). 손으로 만들면 어느 것이 어느 원본에서
//   나왔는지 알 수 없고, 로고가 바뀌면 다시 만들 길이 없다. 한 번에 다시 만들 수 있게 둔다.
//
// ── 새 패키지를 넣지 않았다 ────────────────────────────────────────────────
//   `sharp` 는 이미 node_modules 에 있다(next 가 데려온다). package.json 에 더하지 않고
//   **있는 것만** 쓴다 — 없으면 아무것도 만들지 않고 「무엇이 필요한지」만 적고 끝낸다.
//
// ── 원본 ───────────────────────────────────────────────────────────────────
//   public/logo-mark.png — 256×256, 네 귀퉁이까지 찬 파란 바탕에 마크가 들어 있다.
//   그래서 바탕을 따로 깔지 않는다. iOS 는 apple-touch-icon 의 투명을 **검정**으로
//   메우므로 바탕이 찬 원본이 오히려 맞다.
//   512 는 2배 확대다 — 마크가 부드러운 그라데이션이라 확대 자국이 눈에 띄지 않는다.
//   더 큰 원본이 생기면 SRC 만 바꾸면 된다.

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const SRC = path.join(ROOT, 'public/logo-mark.png')
/** 투명을 메울 바탕 — manifest 의 theme_color 가 정본이다. */
const THEME = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/manifest.webmanifest'), 'utf8')).theme_color
const OUT = path.join(ROOT, 'public')
/** 만들 것 — 파일 이름과 한 변. */
const SIZES = [
  ['apple-touch-icon.png', 180],   // iOS 홈 화면
  ['icon-192.png', 192],           // manifest
  ['icon-512.png', 512],           // manifest · 스플래시
]

let sharp
try {
  sharp = require(path.join(ROOT, 'node_modules/sharp'))
} catch {
  console.error('sharp 가 없다 — 아이콘을 만들지 않는다.')
  console.error('필요한 파일 세 개(public/ 에 넣으면 된다):')
  for (const [name, n] of SIZES) console.error(`  ${name} — ${n}×${n} PNG, 투명 없이(바탕 채움)`)
  process.exit(2)
}

if (!fs.existsSync(SRC)) {
  console.error(`원본이 없다: ${path.relative(ROOT, SRC)}`)
  process.exit(2)
}

;(async () => {
  const meta = await sharp(SRC).metadata()
  console.log(`원본 ${path.relative(ROOT, SRC).replace(/\\/g, '/')} — ${meta.width}×${meta.height}`)
  for (const [name, n] of SIZES) {
    const dest = path.join(OUT, name)
    await sharp(SRC)
      .resize(n, n, { fit: 'cover', kernel: 'lanczos3' })
      // 투명을 없앤다 — iOS 는 apple-touch-icon 의 투명을 검정으로 메운다.
      // 바탕색은 **manifest 한 곳**에서 읽는다 — 두 곳에 적어 두면 한쪽만 바뀐다.
      .flatten({ background: THEME })
      .png({ compressionLevel: 9 })
      .toFile(dest)
    const { size } = fs.statSync(dest)
    console.log(`  ${name} — ${n}×${n} · ${size}B`)
  }
  console.log('끝')
})().catch(e => { console.error(e); process.exit(1) })
