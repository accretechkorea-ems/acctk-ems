// 폰에서 **고르는 자리**가 다시 좁아지지 않게 (2026-11-27).
//
// 2026-11-26 에 장비 라인업·모델·옵션을 마스터 검색(SearchSelect)으로 바꾸면서,
// 세 칸이 1fr 셋으로 나란히 섰다. 390 짜리 화면에서 한 칸은 **109px** 이다 —
// 「라인업 (ex. SURFCOM NEX)」 가 「라인업 (ex.」 에서 잘려 **빈 상자 셋**으로 보였고,
// 칸에 붙는 목록도 109px 이라 「CONTOURECORD」 가 「CONTOURECO…」 로 잘렸다.
//
// 두 가지를 못으로 박는다:
//   ① 세 칸은 좁은 화면에서 **세로 석 줄**이다(부품이 스스로 한다 — 부르는 쪽이 또 감싸면 안 된다).
//   ② 목록은 좁은 화면에서 **아래에서 올라오는 시트**다(공용 SearchSelect 가 한다).
//
// 키 없이 서버 없이 돈다 — 글자만 읽는다.

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')

// 이 파일 자신의 주석이 검사에 걸리지 않게, 글자를 찾을 때는 주석을 걷어낸 몸통만 본다.
const code = src => src
  .split(/\r?\n/)
  .map(l => l.replace(/(^|[^:])\/\/.*$/, '$1'))
  .join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')

let fails = 0
const ok = (name, good, extra) => {
  if (!good) fails++
  console.log(`${good ? 'OK  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`)
}

const PICKER = read('components/customer/modals/EquipmentPicker.tsx')
const SELECT = read('components/common/SearchSelect.tsx')
const EDIT = code(read('components/customer/modals/DeviceEditModal.tsx'))
const ADD = code(read('components/customer/modals/DeviceAddModal.tsx'))
const DELIV = code(read('components/quote/DeliveryDevices.tsx'))

console.log('── ① 장비 세 칸은 좁은 화면에서 세로로 선다 ──')

// PC 는 글자 길이대로 2 : 1 : 1.5 다 — 똑같이 셋으로 나누면 라인업이 가장 먼저 잘린다(묶음4 A).
ok('부품이 자기 격자를 들고 있다', /\.eqp-grid\s*\{[^}]*grid-template-columns:\s*2fr 1fr 1\.5fr/.test(PICKER))
ok('격자가 모달 폭을 다 쓴다', /\.eqp-grid\s*\{[^}]*width:\s*100%/.test(PICKER))
ok('긴 값은 말줄임으로 자른다', /textOverflow: 'ellipsis'/.test(PICKER))
ok('잘린 값은 title 로 끝까지 읽는다', /title=\{lineup \|\| undefined\}/.test(PICKER) && /title=\{model \|\| undefined\}/.test(PICKER) && /title=\{config \|\| undefined\}/.test(PICKER))
ok('좁은 화면에서는 한 열이다', /@media \(max-width: 768px\)[\s\S]{0,200}\.eqp-grid\s*\{\s*grid-template-columns:\s*1fr\b/.test(PICKER))
ok('칸마다 min-width: 0 이 있다(글자가 길어도 칸을 밀지 않는다)', /\.eqp-cell\s*\{\s*min-width:\s*0/.test(PICKER))
ok('그 min-width 는 폰 단 밖에 있다(PC 에서도 든다)', PICKER.indexOf('.eqp-cell { min-width: 0; }') < PICKER.indexOf('@media (max-width: 768px)'))

// 세로로 서면 「라인업 / 모델명 / 옵션」 한 줄 제목만으로는 어느 칸인지 알 수 없다.
for (const label of ['라인업', '모델명', '옵션']) {
  ok(`세로일 때 「${label}」 이름이 붙는다`, new RegExp(`className="eqp-label"[^>]*>${label}<`).test(PICKER))
}
ok('그 이름은 PC 에서는 숨는다', /\.eqp-label\s*\{\s*display:\s*none/.test(PICKER))

// 부르는 쪽이 3열 격자를 **또** 두면, 세 칸이 1fr 한 칸 안에 다시 갇힌다(2026-11-27 의 수정 창 결함).
const WRAPPED = /gridTemplateColumns:\s*'1fr 1fr 1fr'[\s\S]{0,400}<EquipmentPicker/
ok('장비 수정 창이 부품을 3열로 또 감싸지 않는다', !WRAPPED.test(EDIT))
ok('장비 등록 창도 그렇다', !WRAPPED.test(ADD))
ok('견적 납품 예정 줄도 그렇다', !WRAPPED.test(DELIV))

console.log('\n── ② 목록은 좁은 화면에서 아래 시트로 뜬다 ──')

ok('mobileSheet 가 공용 부품에 있다', /mobileSheet\?:\s*boolean/.test(SELECT))
ok('기본으로 켜져 있다(모든 SearchSelect 가 함께 혜택)', /mobileSheet = true/.test(SELECT))
ok('폰 폭은 768 로 가른다', /max-width:\s*\$\{SHEET_MAX_W\}px/.test(SELECT) && /SHEET_MAX_W = 768/.test(SELECT))
ok('창 크기가 바뀌면 따라 바뀐다', /matchMedia[\s\S]{0,300}addEventListener\('change'/.test(SELECT))

ok('시트는 body 로 포털한다(모달 안에서도 안 잘린다)', /createPortal\(/.test(code(SELECT)))
ok('좌우 꽉 찬다', /position: 'fixed', left: 0, right: 0, bottom: 0/.test(SELECT))
ok('높이는 최대 70dvh', /maxHeight: '70dvh'/.test(SELECT))
ok('속에서 구른다', /overflowY: 'auto', flex: '1 1 auto'/.test(SELECT))
ok('맨 위에 검색칸이 그대로 있다', /autoFocus[\s\S]{0,400}placeholder=\{placeholder\}/.test(SELECT))
ok('그 검색칸은 16px 이다(iOS 가 확대하지 않는다)', /fontSize: 16/.test(SELECT))
ok('바닥에 safe-area 여백을 둔다', /env\(safe-area-inset-bottom/.test(SELECT))
ok('바깥을 누르면 닫힌다', /onMouseDown=\{onClose\}[\s\S]{0,80}onTouchStart=\{onClose\}/.test(SELECT))
ok('Esc 로도 닫힌다(쌓임이 받는다)', /useOverlayEsc\(true, \(\) => setOpen\(false\), isOpen\)/.test(SELECT))
ok('시트는 모달보다 위 층이다', /zIndex: Z\.popover \+ 1/.test(SELECT))

// 고르는 **동작과 값**은 그대로여야 한다 — 모양만 다른 것이다.
ok('목록의 속은 한 벌만 짠다(시트와 칸 붙이기가 같은 조각)', /const listBody = showEmpty/.test(SELECT))
ok('고르는 동작은 전과 같은 run() 이다', /onMouseDown=\{e => \{ e\.preventDefault\(\); r\.run\(\) \}\}/.test(SELECT))
ok('칸에 붙는 길(Popover)도 그대로 남아 있다', /<Popover/.test(SELECT) && /matchAnchorWidth/.test(SELECT))

console.log(fails === 0 ? '\n전부 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
