// **명함 사진을 읽는 길** — 모델·라우트·치운 자리 (2026-11-23).
//
//   node scripts/card-ocr-check.js
//
// 2026-11-23, 브라우저에서 돌리던 공개 OCR 패키지를 Claude 비전으로 바꿨다.
// 실제 사진 4장에서 앞의 것이 쓸 수 없는 수준이었기 때문이다.
// 이 파일이 지키는 것은 넷이다.
//   ① 라우트가 있고, 로그인을 보고, 모델·열쇠를 바르게 부른다
//   ② 사진을 **저장하지 않는다** — 디스크·Storage·로그 어디에도
//   ③ 옛 엔진의 흔적이 저장소에 남아 있지 않다(docs/ 는 기록이라 뺀다)
//   ④ 열쇠가 없어도 화면이 멈추지 않는다(안내 + 직접 입력)
//
// ※ 이 파일은 **열쇠 없이** 돈다(하네스 규칙) — 글자만 읽는다. 모델을 부르지 않는다.

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
let fails = 0
const ok = (name, cond, hint) => {
  if (!cond) fails++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond || !hint ? '' : `  — ${hint}`}`)
}
const eq = (name, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want)
  if (!good) fails++
  console.log(`${good ? 'OK  ' : 'FAIL'} ${name}`)
  if (!good) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const has = (p) => fs.existsSync(path.join(ROOT, p))

const ROUTE_PATH = 'app/api/cards/ocr/route.ts'

console.log('\n── ① 읽는 라우트 ──')
ok('라우트가 있다', has(ROUTE_PATH))
const R = has(ROUTE_PATH) ? read(ROUTE_PATH) : ''
ok('POST 다', /export async function POST\(/.test(R))
ok('로그인한 사람만', /loadCaller\(\{ kind: 'login' \}/.test(R))
ok('모델은 claude-haiku-5-5', /const MODEL = 'claude-haiku-5-5'/.test(R))
ok('열쇠는 ANTHROPIC_API_KEY 에서', /process\.env\.ANTHROPIC_API_KEY/.test(R))
ok('공식 SDK 로 부른다', /from '@anthropic-ai\/sdk'/.test(R))
ok('max_tokens 600', /max_tokens: MAX_TOKENS/.test(R) && /const MAX_TOKENS = 600/.test(R))
ok('사진은 base64 로 넘긴다', /type: 'base64'/.test(R) && /type: 'image'/.test(R))
ok('10MB 를 넘으면 받지 않는다', /const MAX_BYTES = 10 \* 1024 \* 1024/.test(R) && /reason: 'too_big'/.test(R))
ok('이미지가 아니면 받지 않는다', /reason: 'bad_type'/.test(R))

// temperature 는 **보내면 안 된다** — 이 모델은 기본값이 아닌 temperature 를 400 으로 거절한다.
// 대신 사고를 꺼서 흔들림을 줄이고, 600 토큰을 전부 JSON 에 쓴다.
// 주석에는 까닭을 적어 둔다 — **코드 줄만** 본다.
const Rcode = R.split(/\r?\n/).filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
ok('temperature 를 보내지 않는다', !/temperature/.test(Rcode),
  'claude-haiku-5-5 는 기본값이 아닌 temperature 를 400 으로 거절한다')
ok('사고는 꺼 둔다(600 토큰을 JSON 에 쓴다)', /thinking: \{ type: 'disabled' \}/.test(R))

console.log('\n── ② JSON 으로 받는다 ──')
ok('안내문은 지시대로', R.includes('명함 이미지에서 정보를 추출해 JSON 만 반환한다. 추측하지 말고 없는 값은 null.'))
ok('칸 이름은 한 군데서(lib/businessCardOcr.ts)', /OCR_KEYS/.test(R))
ok('펜스를 벗겨 파싱한다', /parseOcrJson/.test(R))
ok('한 번만 더 묻는다', /attempt <= 2/.test(R))
ok('그래도 안 되면 reason:parse', /reason: 'parse'/.test(R))
ok('열쇠가 없으면 500 이 아니라 no_key', /reason: 'no_key'/.test(R) && !/no_key[\s\S]{0,80}status: 500/.test(R))

const LIB = read('lib/businessCardOcr.ts')
// 칸 이름 열둘 — business_cards 의 칸과 같다. memo_hint 는 2026-11-23 에 뺐다
// (담을 칸이 없고, 모델이 지어내기 쉬운 자리였다).
eq('칸 이름 열둘', (LIB.match(/OCR_KEYS = \[([\s\S]*?)\]/)?.[1].match(/'[a-z_]+'/g) || []).length, 12)
ok('memo_hint 가 라이브러리에 없다', !/memo_hint/.test(LIB))
ok('memo_hint 가 지시문에 없다', !/memo_hint/.test(R))
ok('영문 둘을 읽어 온다', /"name_en"/.test(R) && /"company_en"/.test(R))
ok('번호 다듬기가 라이브러리에 있다', /export function normalizePhone/.test(LIB))
ok('라우트가 그것을 쓴다', /fieldsFromJson/.test(R))

console.log('\n── ③ 사진은 남기지 않는다 ──')
ok('디스크에 쓰지 않는다', !/writeFile|createWriteStream|fs\./.test(R))
ok('Storage 에 올리지 않는다', !/storage\.|\.upload\(/.test(R))
// 로그는 토큰 수만. base64·파일 이름·읽은 값을 찍지 않는다.
const logs = (R.match(/console\.(log|warn|error)\([\s\S]*?\)\n/g) || []).join('\n')
ok('로그에 사진·값이 없다', !/base64|file\.name|fields\b(?!\.)/.test(logs),
  '로그에 사진이나 읽은 값이 들어갔다')
ok('로그에 토큰 수는 남는다', /input, output/.test(logs))
ok('그 사실을 코드에 적어 두었다', /PHOTO_IS_NEVER_STORED/.test(LIB))

console.log('\n── ④ 옛 엔진의 흔적 ──')
ok('public/ocr 가 없다', !has('public/ocr'))
ok('옮기는 스크립트가 없다', !has('scripts/copy-ocr-assets.js'))
const PKG = read('package.json')
ok('package.json 에 없다', !/tesseract/i.test(PKG))
ok('postinstall 이 없다', !/"postinstall"/.test(PKG))
ok('새 패키지는 @anthropic-ai/sdk 하나', /"@anthropic-ai\/sdk"/.test(PKG))
ok('package-lock 에도 없다', !/tesseract/i.test(read('package-lock.json')))

// 저장소 전체 — docs/ 는 그날의 기록이라 뺀다.
const SKIP_DIR = new Set(['node_modules', '.next', '.next-perf', '.git', 'docs', 'ems-backup'])
// 이 파일 자신은 뺀다 — 무엇을 찾는지 적어 두어야 하니 그 낱말이 들어 있다.
const SKIP_FILE = new Set(['package-lock.json', 'tsconfig.tsbuildinfo', 'card-ocr-check.js'])
const hits = []
const walk = (d) => {
  for (const e of fs.readdirSync(path.join(ROOT, d || '.'), { withFileTypes: true })) {
    const rel = d ? `${d}/${e.name}` : e.name
    if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) walk(rel); continue }
    if (SKIP_FILE.has(e.name)) continue
    if (!/\.(ts|tsx|js|mjs|json|md|css)$/.test(e.name)) continue
    if (/tesseract/i.test(fs.readFileSync(path.join(ROOT, rel), 'utf8'))) hits.push(rel)
  }
}
walk('')
eq('저장소에 남은 자리(docs 제외)', hits, [])

console.log('\n── ⑤ 화면은 멈추지 않는다 ──')
const HOOK = read('components/cards/useCardOcr.ts')
ok('라우트로 보낸다', /fetch\('\/api\/cards\/ocr'/.test(HOOK))
ok('보내기 전에 줄인다(긴 변 1,200 · jpg 80)',
  /const MAX_EDGE = 1200/.test(HOOK) && /const QUALITY = 0\.8/.test(HOOK))
ok('진행 문구 「명함을 읽는 중…」', /OCR_READING = '명함을 읽는 중…'/.test(LIB))
ok('열쇠가 없으면 안내', /OCR 설정이 안 되어 있습니다\. 관리자에게 문의/.test(HOOK))
ok('실패하면 직접 입력으로', /직접 입력/.test(HOOK) && /phase: 'error'/.test(HOOK))
ok('표에 없는 칸은 버린다(name_en 등)', /pickKnown/.test(HOOK))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
