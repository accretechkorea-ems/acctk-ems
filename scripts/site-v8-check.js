// 사업장 화면 **V8** — 좌 340 열 + 우 장비, 그리고 사진 (2026-11-25).
//
//   node scripts/site-v8-check.js
//
// 지키는 약속
//   ① PC(≥768)는 **2단**이다 — 좌 340px 열(sticky top 14) + 우 장비 그리드.
//     접는 기준이 두 벌이다: 상세 페이지는 화면 폭(@media), 분할 보기는 칸 폭(@container).
//     1366 에서도 분할 보기의 오른쪽 칸은 600px 인데, 화면 폭으로 접으면 2단을 고집한다.
//   ② 폰(≤767)은 **지난 회차 그대로**다 — 가로 띠(SiteHeaderBand)가 서고 열은 감춘다.
//     같은 내용을 두 모양으로 그리는 자리라, 한쪽만 고치면 여기서 걸린다.
//   ③ 왼쪽 열 = 사업장 정보 카드(회사 » 사업장 · 상태 / 주소·대리점·메모) + 담당자 카드.
//     담당자 한 사람은 **두 줄**이고 전부 펼친다(접지 않는다). ＋ 는 늘 보인다.
//   ④ 장비 카드 사진은 칸을 **채운다**(object-fit: fill). 누르면 크게 보기다 —
//     등록 창이 열리던 동작은 없다. 사진이 없는 칸은 눌러도 아무 일이 없다.
//   ⑤ 두 화면이 같은 부품을 쓴다 — 회사 링크·메모·아이콘 단추를 두 벌로 만들지 않는다.

const load = module.require.bind(module)
const path = load('path')
const fs = load('fs')
const ROOT = path.join(__dirname, '..')

let fails = 0
const ok = (name, cond, hint) => {
  if (!cond) fails++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond || !hint ? '' : `  — ${hint}`}`)
}
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')

const BODY = read('components/customer/CustomerDetailBody.tsx')
const COL = read('components/customer/SiteInfoColumn.tsx')
const BAND = read('components/customer/SiteHeaderBand.tsx')
const SECTION = read('components/customer/DeviceSection.tsx')
const PHOTO = read('components/customer/modals/DevicePhotoModal.tsx')
/** 띠의 두 파일 — 공용 틀과 좌 칸. 「같은 부품을 쓰나」는 둘을 합쳐 본다. */
const HEAD = read('components/customer/HeaderBand.tsx')
const BAND_ALL = BAND + HEAD
/** 주석을 뺀 코드만 — 「없어야 하는 것」은 주석의 설명에 걸리면 안 된다. */
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const COL_CODE = strip(COL)

console.log('\n── ① PC 는 2단 ──')
ok('열 폭은 340', /export const SITE_COL_W = 340/.test(COL))
// 2026-11-26: 카드만 320 으로 좁혔다(좌 열은 340 그대로) — 1440 에서 한 장 더 선다.
ok('장비 카드는 320', /const CARD_W = 320/.test(SECTION))
ok('상세 페이지는 화면 폭으로 접는다',
  /@media \(min-width: 768px\) \{\s*\n\s*\.site-page \.site-wrap \{ display: grid; grid-template-columns: \$\{SITE_COL_W\}px minmax\(0, 1fr\)/.test(BODY))
// 칸의 문턱은 1000 이다 — 열 340 + 카드 둘(320·320) + 여백이 들어가는 폭(2026-11-26).
// 768 로 두었더니 1280 화면의 분할 보기(칸 808)에서 카드가 한 줄에 한 장만 섰다.
ok('분할 보기는 칸 폭으로 접는다(문턱 1000)',
  /@container \(min-width: 1000px\) \{\s*\n\s*\.cust-embed \.site-wrap \{ display: grid; grid-template-columns: \$\{SITE_COL_W\}px minmax\(0, 1fr\)/.test(BODY))
ok('칸 폭을 재려면 container 가 켜져 있어야 한다', /\.cust-embed \{ container-type: inline-size; \}/.test(BODY))
ok('열은 따라 내려온다(sticky top 14)',
  (BODY.match(/\.site-col-wrap \{ display: block; position: sticky; top: 14px; \}/g) || []).length === 2)
ok('좁을 때 열은 감춰져 있다', /\.site-col-wrap \{ display: none; min-width: 0; \}/.test(BODY))

console.log('\n── ② 폰은 지난 회차 그대로 ──')
ok('가로 띠가 그대로 있다', /<SiteHeaderBand/.test(BODY) && /className="site-band-phone"/.test(BODY))
ok('넓어지면 띠를 감춘다',
  (BODY.match(/\.site-band-phone \{ display: none; \}/g) || []).length === 2)
ok('띠는 공용 틀(HeaderBand)을 그대로 쓴다', /<HeaderBand/.test(BAND))
for (const [what, re] of [
  ['담당자 세로 목록', /\.pane-band \.chip-list \{/],
  ['「＋ 담당자」 넓은 단추', /\.pane-band \.contact-add-wide \{ display: flex !important \}/],
  ['상태 뱃지가 연필을 피한다', /\.pane-band \.band-status \{ right: 40px !important \}/],
]) ok(`폰 규칙이 남아 있다 — ${what}`, re.test(read('components/customer/HeaderBand.tsx')))

console.log('\n── ③ 왼쪽 열의 두 카드 ──')
ok('회사 » 사업장 한 줄', /<CompanyLink name=\{title\} companyId=\{companyId\} onOpen=\{onOpenCompany\} fontSize=\{COMPANY_NAME_SIZE\} \/>/.test(COL)
  && /const COMPANY_NAME_SIZE = 18/.test(COL))
ok('구분자는 »', /»/.test(COL))
ok('상태는 같은 줄의 dot + 글자', /STATUS_DOT\[status\] \?\? MUTED/.test(COL))
ok('상태색은 한 벌을 나눠 쓴다(띠와 같은 표)',
  /import \{ STATUS_DOT \} from '@\/components\/customer\/HeaderBand'/.test(COL)
  && /export const STATUS_DOT/.test(read('components/customer/HeaderBand.tsx')))
ok('주소·대리점·메모가 **세로**로 쌓인다',
  /<InfoRow label="주소">/.test(COL) && /<InfoRow label="대리점">/.test(COL) && /<InfoRow label="메모">/.test(COL)
  && /flexDirection: 'column', gap: 7/.test(COL))
ok('주소는 복사할 수 있다', /navigator\.clipboard\.writeText\(customer\.address\)/.test(COL))
ok('메모는 공용 부품이다(MemoHoverText)', /<MemoHoverText/.test(COL))
ok('수정 연필은 호버에서만 보인다',
  /\.site-col \.site-info:hover \.card-edit/.test(COL) && /opacity: 0/.test(COL))

console.log('\n── ③-ⓑ 담당자 한 사람 = 두 줄 ──')
ok('머리는 「담당자 N ＋」', /담당자<\/b>/.test(COL) && /\{contacts\.length\}/.test(COL)
  && /<AddIconButton size=\{26\} label="담당자 추가"/.test(COL))
ok('＋ 는 호버와 무관하게 늘 보인다', !/chip-add|add-edit/.test(COL))
ok('윗줄은 이름 + 직급 · 부서', /\[c\.position, c\.department\]\.map/.test(COL))
ok('아랫줄은 전화 줄 · 이메일 줄', /href=\{`tel:\$\{tel\.replace/.test(COL) && /href=\{`mailto:\$\{email\}`\}/.test(COL))
ok('휴대폰이 없으면 회사 전화를 쓴다', /const tel = mobile \|\| office/.test(COL)
  && /mobile \? <SmartphoneGlyph \/> : <PhoneGlyph \/>/.test(COL))
ok('이메일이 없으면 —', /<MailGlyph \/><\/span>—/.test(COL))
ok('전부 펼친다(더보기·접기가 없다)',
  !/더보기/.test(COL_CODE) && !/maxHeight/.test(COL_CODE) && !/openContacts/.test(COL_CODE))
ok('칸에 손을 올리면 바탕이 든다', /background: hover \? NEUTRAL_BG : 'transparent'/.test(COL))
ok('아이콘은 인라인 SVG 다(이모지가 아니다)',
  /<svg /.test(COL) && !/[📱✉☎✎]/.test(COL_CODE), '이모지를 UI 아이콘으로 쓰지 않는다')

console.log('\n── ④ 사진 ──')
ok('칸을 채운다(fill)', /objectFit: 'fill'/.test(SECTION) && !/objectFit: 'cover'/.test(SECTION))
ok('누르면 크게 보기', /onViewPhoto\(d\.image_url \?\? defaultImg \?\? '', shownSrc\)/.test(SECTION))
ok('등록 창을 부르던 자리가 없다',
  !/onImageUpload/.test(SECTION) && !/DeviceImageModal/.test(BODY))
ok('사진 없는 칸은 단추가 아니다', /사진 등록<\/span>\s*\n\s*<\/div>/.test(SECTION))
ok('「사진 등록」은 안내색', /color: SUB, fontWeight: 600 \}\}>사진 등록/.test(SECTION))
ok('크게 보기는 화면 90% 안에 비율대로',
  /const FIT = '90'/.test(PHOTO) && /maxWidth: `\$\{FIT\}vw`, maxHeight: `\$\{FIT\}vh`, objectFit: 'contain'/.test(PHOTO))
ok('층은 모달', /zIndex: Z\.modal/.test(PHOTO))
ok('바깥 클릭·Esc 로 닫는다(공용 오버레이)', /<ModalOverlay onClose=\{onClose\}/.test(PHOTO))
ok('화면이 그 창을 걸어 두었다', /<DevicePhotoModal photo=\{photo\} onClose=/.test(BODY))
// 카드가 든 주소는 폭 480 썸네일이다 — 창은 **원본**을 따로 받는다(그대로 띄우면 작게 놓인다).
ok('크게 보기는 원본 주소를 따로 받는다',
  /useDeviceImageUrls\(photo \? \[photo\.path\] : \[\]\)/.test(PHOTO)
  && /const src = full\(photo\.path\) \?\? photo\.preview/.test(PHOTO))

console.log('\n── ⑤ 한 부품을 나눠 쓴다 ──')
for (const [what, re] of [
  ['회사 링크', /CompanyLink/],
  ['메모', /MemoHoverText/],
  ['아이콘 단추', /from '@\/components\/common\/IconButton'/],
  ['← 단추', /BackIconButton/],
  ['대리점 이름', /agencyLabelOf/],
]) ok(`${what} 는 띠와 열이 같은 것을 쓴다`, re.test(COL) && re.test(BAND_ALL))
ok('모서리·글자색은 토큰만 쓴다',
  /from '@\/lib\/radius'/.test(COL) && /from '@\/lib\/textTokens'/.test(COL)
  && !/#[0-9a-fA-F]{6}/.test(COL), '새 색·숫자를 적지 않는다')

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
