/**
 * 모달의 **공통 구조** — 머리줄 고정 / 본문 스크롤 / 바닥줄 고정 (2026-11-21).
 *
 * 지키는 약속
 *   ① 바탕은 ModalOverlay 한 곳이다(2026-11-02부터). 거기에 **속 카드**를 더했다 —
 *     ModalCard. 카드가 스스로 overflow: hidden 을 들고 본문만 구른다.
 *   ② 닫는 길 셋이 **한 함수**다 — Esc·바깥 클릭(ModalOverlay)과 ✕(ModalCard 가
 *     useRequestClose 로 받는다). ✕ 가 onClose 를 직접 부르면 confirmClose 를 지나친다.
 *   ③ 모션은 한 가지다 — `.ems-modal-card` (150ms fade + 살짝 커짐, app/globals.css).
 *   ④ 바탕을 **직접 그리는 세 곳**은 이 규칙 밖이다(ModalOverlay 를 쓰지 않는다):
 *     app/approval/doc/[id] · RouteMapView · XlsxPreviewModal.
 *
 * ⑤ 아직 옮기지 않은 모달은 **목록으로 못 박아 둔다**. 그 목록이 늘어나면 실패한다 —
 *   새 모달이 공용 카드를 지나치는 것을 막는다. 줄어들면(옮기면) 숫자를 고친다.
 */
const load = module.require.bind(module)
const path = load('path')
const fs = load('fs')
const ROOT = path.resolve(__dirname, '..')

const files = []
const walk = d => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) { if (!/node_modules|\.next/.test(p)) walk(p) }
    else if (e.name.endsWith('.tsx')) files.push(p)
  }
}
walk(path.join(ROOT, 'app'))
walk(path.join(ROOT, 'components'))

/**
 * 아직 공용 카드로 옮기지 않은 자리 — **머리·바닥 모양이 제각각**이라 손으로 옮긴다.
 * (스타일 객체로 된 머리줄, ✕ 가 없는 자리, 한 파일에 모달이 둘·셋인 자리)
 */
const PENDING_BESPOKE = []

/**
 * 이미 머리·바닥 구조가 갖춰져 있던 자리 — 2차 조사의 26개 **밖**이다.
 * 공용 카드로 옮기는 것은 겉모양이 바뀔 수 있어 따로 정해야 한다(보고에 적었다).
 */
// 2026-11-23: app/leads/page.tsx 가 빠졌다 — **회수 창 하나를** 공용 카드로 만들면서
// 「카드가 하나도 없는 파일」이 아니게 됐다. 그 파일의 다른 창(상태 변경 등)은 아직 옛 모양이다.
// 이 목록은 파일 단위 래칫이라 거기까지는 세지 못한다.
const PENDING_STRUCTURED = [
  'app/admin/page.tsx',
  'app/contact/semi/[projectId]/page.tsx',
  'app/inquiries/[id]/page.tsx',
  'app/inquiries/page.tsx',
  'app/inventory/page.tsx',
  'app/repair/page.tsx',
  'app/sales/page.tsx',
  'app/suggestions/page.tsx',
  'components/admin/ActivityTypeManager.tsx',
  'components/admin/QuoteCategoryManager.tsx',
  'components/admin/priceList/PriceListImportModal.tsx',
  'components/approval/DelegationModal.tsx',
  'components/approval/LinePickerModal.tsx',
  'components/common/NoticePopup.tsx',
  'components/customer/TimelineFilterModal.tsx',
  'components/customer/modals/HoldingModal.tsx',
  'components/customer/modals/OpportunityModal.tsx',
  'components/customer/modals/QuoteHistoryModal.tsx',
  'components/customer/modals/RecordAddModal.tsx',
  'components/customer/modals/ServiceAddModal.tsx',
  'components/customer/modals/ServiceEditModal.tsx',
  'components/dashboard/MyQuoteCard.tsx',
  'components/home/list/CompanySearchModal.tsx',
  'components/inquiry/DeskGuideModal.tsx',
  'components/quote/AssigneePicker.tsx',
  'components/repair/RepairEditModal.tsx',
  'components/sales/EngineerChartModal.tsx',
  'components/showroom/DeviceSettingsModal.tsx',
  'components/showroom/PeriodPickerModal.tsx',
  'components/showroom/UsageModal.tsx'
]

/**
 * **라이트박스** — 사진 한 장만 띄우는 창이다(2026-11-25).
 *
 * 머리줄·본문·바닥줄이 없어 공용 카드(ModalCard)를 두를 자리가 없다. 카드 껍데기를
 * 씌우면 흰 테가 사진을 가둬 「크게 보기」가 아니게 된다. 바탕·Esc·겹친 창의 차례는
 * 공용 오버레이(ModalOverlay)가 그대로 맡으므로 ④의 「제 바탕을 직접 그리는 셋」과도
 * 다르다. 아래 ⑥-나 가 **이 창들이 정말 사진만 띄우는지** 다시 본다.
 */
const LIGHTBOX = [
  'components/customer/modals/DevicePhotoModal.tsx',
]

const PENDING = [...PENDING_BESPOKE, ...PENDING_STRUCTURED, ...LIGHTBOX]

let fail = 0
const ok = (name, cond, hint) => {
  if (cond) console.log(`OK   ${name}`)
  else { fail++; console.error(`FAIL ${name}${hint ? `  — ${hint}` : ''}`) }
}

const rel = f => path.relative(ROOT, f).split(path.sep).join('/')
const users = []      // ModalOverlay 를 쓰는 파일
const onCard = []     // 공용 카드로 옮긴 파일
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8')
  if (!/<ModalOverlay/.test(s)) continue
  users.push(rel(f))
  if (/<ModalCard/.test(s)) onCard.push(rel(f))
}

console.log(`── 모달 ${users.length}파일 · 공용 카드 ${onCard.length} · 남은 ${users.length - onCard.length} ──`)

console.log('\n── ① 공용 카드의 구조 ──')
const CARD = fs.readFileSync(path.join(ROOT, 'components', 'common', 'ModalCard.tsx'), 'utf8')
ok('카드가 스스로 구르지 않는다(overflow: hidden)', /overflow: 'hidden',/.test(CARD),
  '이 줄이 없으면 공용 CSS 가 카드를 구르게 해 머리·바닥이 흘러간다')
ok('세로 flex · 본문만 구른다',
  /flexDirection: 'column'/.test(CARD) && /flex: 1, minHeight: 0, overflowY: 'auto'/.test(CARD))
ok('머리줄·바닥줄은 줄지 않는다', (CARD.match(/flexShrink: 0/g) || []).length >= 2)

console.log('\n── ② 닫는 길 셋이 한 함수 ──')
const OVERLAY = fs.readFileSync(path.join(ROOT, 'components', 'common', 'ModalOverlay.tsx'), 'utf8')
ok('오버레이가 닫기 요청을 내려 준다', /RequestCloseContext\.Provider value=\{\(\) => \{ void requestClose\(\) \}\}/.test(OVERLAY))
ok('Esc·바깥 클릭이 그 함수를 지난다',
  /useOverlayEsc\(closeOn === 'both', \(\) => \{ void requestClose\(\) \}\)/.test(OVERLAY)
  && /if \(onBg && backdropOk\) void requestClose\(\)/.test(OVERLAY))
ok('✕ 가 같은 함수를 쓴다', /const requestClose = useRequestClose\(\)/.test(CARD)
  && /const close = onClose \?\? requestClose \?\? undefined/.test(CARD))

console.log('\n── ③ 모션은 한 가지 ──')
const CSS = fs.readFileSync(path.join(ROOT, 'app', 'globals.css'), 'utf8')
ok('공용 키프레임이 있다', /@keyframes ems-modal-in/.test(CSS) && /\.ems-modal-card \{ animation: ems-modal-in 0\.15s ease; \}/.test(CSS))
ok('모션을 줄이길 원하는 사용자에게는 끈다', /prefers-reduced-motion: reduce[\s\S]{0,80}\.ems-modal-card \{ animation: none; \}/.test(CSS))
ok('카드가 그 class 를 붙인다', /className=\{className \? `ems-modal-card \$\{className\}` : 'ems-modal-card'\}/.test(CARD))

console.log('\n── ④ 바탕을 직접 그리는 세 곳은 규칙 밖 ──')
for (const f of ['app/approval/doc/[id]/page.tsx', 'components/sales/RouteMapView.tsx', 'components/common/XlsxPreviewModal.tsx']) {
  const full = path.join(ROOT, f)
  const exists = fs.existsSync(full)
  ok(`${f} — ModalOverlay 를 쓰지 않는다(예외)`,
    !exists || !/<ModalOverlay/.test(fs.readFileSync(full, 'utf8')),
    '이 셋은 제 바탕을 직접 그린다 — 공용 규칙을 걸지 않는다')
}

console.log('\n── ⑤ 남은 자리는 목록 그대로 ──')
const pendingNow = users.filter(f => !onCard.includes(f)).sort()
const extra = pendingNow.filter(f => !PENDING.includes(f))
const gone = PENDING.filter(f => !pendingNow.includes(f))
ok('목록에 없는 모달이 공용 카드를 지나치지 않았다', extra.length === 0,
  extra.join(' · ') + ' — 새 모달은 ModalCard 를 쓴다')
ok('옮긴 것은 목록에서 빠졌다', gone.length === 0,
  gone.join(' · ') + ' — 이 파일은 옮겼으니 PENDING 에서 지워라')
console.log(`   남은 ${pendingNow.length}파일: ${pendingNow.join(', ')}`)

// ── ⑥ 중첩 확인창은 **위층**에 뜬다(2026-11-25) ──────────────────────────
// 모달 위에서 열리는 창이 기본 층(Z.modal)이면 같은 층의 창과 **DOM 차례**로 가려진다.
// 장비 삭제 확인창이 수정 창 뒤에 깔려 누를 수 없던 자리다.
console.log('\n── ⑥ 중첩 확인창은 확인 층(Z.confirm) ──')
const NESTED = [
  'components/home/list/DeleteCustomerModal.tsx',
  'components/home/list/DeleteRequestModal.tsx',
  'components/quote/QuoteReviveModal.tsx',
  'components/common/ConfirmDialog.tsx',
]
for (const f of NESTED) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8')
  ok(`${f} — zIndex: Z.confirm`, /zIndex: Z\.confirm/.test(src),
    '다른 창 위에서 열리는 창은 확인 층에 둔다')
}
// 지우기 확인창은 **그 수정 창보다 위**여야 한다 — 두 창을 나란히 그리는 화면에서 확인한다.
const BODY_SRC = fs.readFileSync(path.join(ROOT, 'components/customer/CustomerDetailBody.tsx'), 'utf8')
ok('사업장 화면이 지우기 창과 수정 창을 함께 그린다',
  /<DeleteCustomerModal/.test(BODY_SRC) && /<DeviceEditModal/.test(BODY_SRC))
ok('지우면 수정 창도 닫힌다(고른 장비를 비운다)',
  /setSelectedDevice\(null\)/.test(fs.readFileSync(path.join(ROOT, 'hooks/customer/useDeviceCrud.ts'), 'utf8')))

// ── ⑥-나 라이트박스는 **사진만** 띄운다(2026-11-25) ──────────────────────
// 목록에 들었다고 아무 창이나 카드를 지나칠 수는 없다 — 사진 한 장뿐인지 본다.
console.log('\n── ⑥-나 라이트박스는 사진만 ──')
for (const f of LIGHTBOX) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8')
  ok(`${f} — 머리줄·바닥줄이 없다`, !/title=|footer=/.test(src), '글이 붙으면 공용 카드를 써라')
  ok(`${f} — 사진 한 장이다(img 하나)`, (src.match(/<img /g) || []).length === 1)
  ok(`${f} — 화면 안에 비율대로 담는다(contain)`, /objectFit: 'contain'/.test(src) && /maxHeight/.test(src))
  ok(`${f} — 닫는 길은 공용 오버레이가 맡는다`, /<ModalOverlay/.test(src) && /onClose=\{onClose\}/.test(src))
}

// ── ⑦ 사이드바의 떠오르는 판은 **body 에** 띄운다(2026-11-25) ────────────
// 사이드바는 overflow: hidden 이라 안에 두면 접힌 폭(64) 밖이 잘린다.
console.log('\n── ⑦ 사이드바 팝오버는 portal ──')
const SIDE = fs.readFileSync(path.join(ROOT, 'components/layout/Sidebar.tsx'), 'utf8')
ok('아바타 메뉴가 Popover 로 뜬다', /<Popover anchorRef=\{meRef\}/.test(SIDE))
ok('사이드바 안의 absolute 메뉴를 걷었다',
  !/position: 'absolute', bottom: '100%'/.test(SIDE), '잘리는 자리로 되돌아가지 않게')
ok('층은 사이드바 위·모달 아래', /anchorRef=\{meRef\}[\s\S]{0,400}zIndex: Z\.sidebarPanel/.test(SIDE))
ok('사업부 패널도 같은 길', /<Popover anchorRef=\{anchor\}/.test(SIDE))
ok('Popover 는 body 로 보낸다(portal)',
  /createPortal/.test(fs.readFileSync(path.join(ROOT, 'components/common/Popover.tsx'), 'utf8')))

console.log(fail === 0 ? '\n전부 통과' : `\n${fail}건 실패`)
process.exit(fail === 0 ? 0 : 1)
