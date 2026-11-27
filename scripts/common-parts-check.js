// 공용 부품 셋 — **툴팁 · 아이콘 버튼 · 모달 바닥줄** (2026-11-27, 묶음5 1).
//
//   node scripts/common-parts-check.js
//
// 뒤 절이 전부 이 셋을 쓴다. 모양이 흔들리면 그 절들이 함께 흔들리므로 못으로 박는다.
// 키 없이 서버 없이 돈다 — 글자만 읽는다.

const load = module.require.bind(module)
const fs = load('fs')
const path = load('path')
const ROOT = path.join(__dirname, '..')
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')
/** 이 파일 자신의 주석이 「없어야 한다」에 걸리지 않게 몸통만 본다. CRLF 도 받는다. */
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

const TIP = read('components/common/Tooltip.tsx')
const BTN = read('components/common/IconButton.tsx')
const CARD = read('components/common/ModalCard.tsx')
const HEAD = read('components/common/HeaderWrapper.tsx')
const SIDE = read('components/layout/Sidebar.tsx')

console.log('── ① 툴팁 — 캔버스 E안 ──')
ok('바탕은 #1f2937', /const BG = '#1f2937'/.test(TIP))
ok('흰 글자 12px', /const FG = '#ffffff'/.test(TIP) && /fontSize: 12/.test(TIP))
ok('**알약**이다(네모 상자가 아니다)', /borderRadius: R\.pill/.test(TIP))
ok('패딩 7×12', /padding: '7px 12px'/.test(TIP))
ok('꼬리가 있다', /transform: 'rotate\(45deg\)'/.test(TIP))
ok('단축키는 알약 칩 — 흰 18% 바탕', /CHIP_BG = 'rgba\(255, 255, 255, 0\.18\)'/.test(TIP))
ok('300ms 뒤에 뜬다', /TOOLTIP_DELAY_MS = 300/.test(TIP))
ok('기본은 위, 자리가 없으면 아래', /prefer = 'top'/.test(TIP) && /flipped/.test(TIP))
ok('body 로 포털한다(모달 안에서도 안 잘린다)', /createPortal\(/.test(code(TIP)))
ok('Z.popover 에 띄운다', /zIndex: Z\.popover/.test(TIP))
// 터치에는 「올려 두기」가 없다 — 누른 것을 가린다.
ok('폰(터치)에서는 아예 그리지 않는다', /const isTouch = \(\)/.test(TIP) && /if \(isTouch\(\)\) return/.test(TIP))
ok('키보드로 닿아도 뜬다', /onFocus=\{show\}/.test(TIP))
ok('누르면 사라진다', /onPointerDown=\{hide\}/.test(TIP))
ok('읽어 주기와 이어진다(aria-describedby)', /aria-describedby=/.test(TIP))

console.log('\n── ② 아이콘 버튼 — 한 벌 ──')
ok('30×30', /ICON_BUTTON_SIZE = 30/.test(BTN))
ok('테두리 #d1d5db', /const BORDER = '#d1d5db'/.test(BTN))
ok('아이콘 16px · #374151', /const GLYPH = 16/.test(BTN) && /const FG = '#374151'/.test(BTN))
ok('radius 는 R 토큰', /borderRadius: R\.icon/.test(BTN))
ok('호버·포커스는 **공용 링**', /className=\{PICK_CLASS\}/.test(BTN))
ok('label 은 필수다(선택이 아니다)', /\n  label: string/.test(BTN))
ok('툴팁이 들어 있다', /<Tooltip label=\{label\} shortcut=\{shortcut\}>/.test(BTN))
ok('단축키 칩을 넘길 수 있다', /shortcut\?: string/.test(BTN))
// 일곱 가지가 한 파일에서 나온다 — 자리마다 다시 그리지 않는다.
for (const n of ['EditIconButton', 'AddIconButton', 'DeleteIconButton', 'CloseIconButton', 'CopyIconButton', 'RefreshIconButton']) {
  ok(`${n} 이 있다`, new RegExp(`export function ${n}`).test(BTN))
}
ok('삭제만 빨간 글자다', /danger \? DANGER : FG/.test(BTN))

console.log('\n── ②-ⓑ 호버해야 나타나는 버튼이 없다 ──')
// 폰에는 호버가 없어 아예 못 찾고, PC 에서도 거기에 무언가 있다는 것을 알 길이 없다.
for (const [f, re] of [
  ['components/customer/SiteInfoColumn.tsx', /\.card-edit, \.site-col \.ct-edit \{ opacity: 0/],
  ['components/customer/HeaderBand.tsx', /\.edit1, \.pane-band \.edit2 \{ opacity: 0/],
  ['components/customer/ContactList.tsx', /\.ctl-edit \{ opacity: 0/],
  ['components/home/list/CompanyPane.tsx', /\.site-edit \{ opacity: 0/],
  ['components/home/list/CompanyPane.tsx', /\.card-act \{ opacity: 0/],
]) ok(`${f.split('/').pop()} — 숨겼다 나타나는 규칙이 없다`, !re.test(read(f)))

console.log('\n── ③ 모달 바닥줄 — 자리가 뜻이다 ──')
ok('슬롯 둘을 받는다', /export type ModalFooterSlots = \{/.test(CARD) && /left\?: ReactNode/.test(CARD) && /right\?: ReactNode/.test(CARD))
ok('조각 하나를 넘기는 옛 길도 받는다', /footer\?: ReactNode \| ModalFooterSlots/.test(CARD))
ok('슬롯이면 양끝으로 가른다', /justifyContent: isSlots\(footer\) \? 'space-between' : 'flex-end'/.test(CARD))
ok('버튼 높이가 한 값이다', /MODAL_BTN_H = 34/.test(CARD))
ok('간격도 한 값', /MODAL_BTN_GAP = 8/.test(CARD))
ok('세 모양이 그 높이를 쓴다',
  (CARD.match(/height: MODAL_BTN_H/g) || []).length >= 2 && /\.\.\.modalGhostButton\(busy\)/.test(CARD))
// 바닥줄에서 가장 눈에 띄어야 하는 것은 **저장**이다 — 삭제가 아니다.
ok('삭제는 빨간 **글자**다(빨간 바탕이 아니다)', /color: '#ef4444', borderColor: '#fecaca'/.test(CARD))
ok('빨간 바탕이 주 버튼인 자리를 위한 길은 남겨 둔다', /modalDangerPrimaryButton/.test(CARD))

console.log('\n── ④ 사이드바 ──')
ok('접기 단추에 툴팁 + 단축키', /<Tooltip label="사이드바 접기" shortcut="Ctrl\+B"/.test(SIDE))
ok('펼치기 단추에도', /<Tooltip label="사이드바 펼치기" shortcut="Ctrl\+B"/.test(SIDE))
// 사이드바는 옮길 때만 쓴다 — 옮기고 나면 보고 있는 것이 넓어야 한다.
ok('화면을 옮길 때마다 접는다(전역)', /useEffect\(\(\) => \{\s*\r?\n\s*if \(firstPath\.current\) \{ firstPath\.current = false; return \}\s*\r?\n\s*setTempCollapsed\(true\)\s*\r?\n\s*\}, \[pathname\]\)/.test(HEAD))
ok('첫 그림은 건드리지 않는다(저장된 설정이 드러난다)', /const firstPath = useRef\(true\)/.test(HEAD))
ok('손으로 펴면 다음 이동까지 그대로다', /setTempCollapsed\(!shown\)/.test(HEAD))
ok('레일 화면에서는 저장값을 건드리지 않는다', /if \(wide\) return/.test(HEAD))

console.log(fails === 0 ? '\n전부 통과' : `\n실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
