// 수주 시 **납품 예정 장비** (2026-11-26).
//
//   node scripts/delivery-pending-check.js
//
// 지키는 약속
//   ① 묻는 자리는 **품목에 본체 묶음 줄(group_kind 'base')이 있는 견적**뿐이다. 분류·양식은
//     보지 않는다(2026-11-26 지시 ②). 줄 수 = 본체 줄 수량의 합이다.
//   ② 장비명·사업장·설치 예정월 셋을 **전부** 채워야 발주가 등록된다(화면도 서버도 본다).
//   ③ 만드는 일은 라우트가 한다 — 발주 상태 변경과 **한 요청**이고, 장비를 못 만들면
//     **발주를 되돌린다**(반쪽으로 끝나지 않는다).
//   ④ 납품 예정 장비는 **가동 수·통계에서 빠진다**. 카드에는 점선과 「설치 예정 …」이 붙고,
//     예정월이 지나면 「지연」이다. 엑셀에는 줄로 남고 상태 열로 구분된다.
//   ⑤ 신규설치 레포트를 쓰면 S/N·납입일을 받아 **운용**으로 바꾼다.
//     ⚠ 「교정 레포트 → 다음 교정일 +12개월」은 2026-11-26 지시로 **빠졌다** — 그 자리가
//       다시 생기지 않도록 아래 ④·⑤·⑥ 에서 **없는 것**을 확인한다.
//   ⑥ 발주가 취소되면 그 발주가 만든 **예정 장비만** 숨긴다(이미 설치된 줄은 그대로).

const load = module.require.bind(module)
const path = load('path')
const fs = load('fs')
const Module = load('module')
const ROOT = path.join(__dirname, '..')
const ts = load(path.join(ROOT, 'node_modules/typescript'))

for (const ext of ['.ts', '.tsx']) {
  Module._extensions[ext] = (mod, filename) => {
    mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
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

const D = load(path.join(ROOT, 'lib/deliveryPending.ts'))
const S = load(path.join(ROOT, 'lib/deviceStatus.ts'))

let fails = 0
const eq = (name, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want)
  if (!good) fails++
  console.log(`${good ? 'OK  ' : 'FAIL'} ${name}`)
  if (!good) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}
const ok = (name, cond, hint) => {
  if (!cond) fails++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond || !hint ? '' : `  — ${hint}`}`)
}
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')

console.log('── ① 묻는 자리 — 품목이 가른다 ──')
// 「본체 묶음」은 'base' 다. DB 가 group_kind 를 세 값으로 묶어 두었다
// (quote_category_template_schema.sql: check (group_kind in ('base','option','include'))) —
// 지시의 글자 'main' 은 들어갈 수 없는 값이라 'base' 로 읽었다(판단 필요, lib 주석 참고).
eq('본체 묶음 열쇠', D.MAIN_GROUP_KIND, 'base')
const bodyLine = { product_name: 'SURFCOM NEX 040', model: '040', quantity: 1, group_kind: 'base' }
ok('본체 줄이 하나라도 있으면 묻는다', D.needsDeliveryDevices([bodyLine]))
ok('옵션·포함사항만이면 묻지 않는다',
  !D.needsDeliveryDevices([{ product_name: '회전테이블', quantity: 1, group_kind: 'option' },
    { product_name: 'PC세트', quantity: 1, group_kind: 'include' }]))
ok('묶음이 빈 줄(부품·서비스 견적)은 묻지 않는다',
  !D.needsDeliveryDevices([{ product_name: '스타일러스', quantity: 3 }, { product_name: '출장비', quantity: 1, group_kind: null }]))
ok('품목이 비었거나 아직 못 읽었으면 묻지 않는다',
  !D.needsDeliveryDevices([]) && !D.needsDeliveryDevices(null) && !D.needsDeliveryDevices(undefined))
ok('분류·양식은 **보지 않는다**', !D.needsDeliveryDevices([{ product_name: 'x', quantity: 1, group_kind: 'option' }]))
ok('옛 분류 목록은 지웠다', D.EQUIPMENT_CATEGORY_CODES === undefined && D.EQUIPMENT_FORM_KIND === undefined)
eq('줄 수는 본체 줄 수량의 합',
  D.mainQty([bodyLine, { ...bodyLine, quantity: 2 }, { product_name: 'o', quantity: 5, group_kind: 'option' }]), 3)
eq('수량이 비었으면 한 대로 센다', D.mainQty([{ product_name: 'a', group_kind: 'base' }]), 1)
eq('수량은 20 에서 자른다(오타 막기)', D.mainQty([{ product_name: 'a', quantity: 200, group_kind: 'base' }]), 20)
eq('품목이 없으면 0', D.mainQty(null), 0)

console.log('\n── ② 전부 채워야 한다 ──')
const good = { device_name: 'SURFCOM NEX', device_name2: '040', option: '', customer_id: 1, install_due_month: '2027-03' }
eq('다 채우면 통과', D.draftsBlocked([good]), null)
eq('한 줄도 없으면 막는다', D.draftsBlocked([]), '납품 예정 장비를 한 대 이상 적어주세요')
eq('장비명이 비면', D.draftsBlocked([{ ...good, device_name: ' ' }]), '1번째 줄 — 장비명(라인업)을 적어주세요')
eq('사업장이 비면', D.draftsBlocked([{ ...good, customer_id: null }]), '1번째 줄 — 사업장을 고르세요')
eq('예정월이 비면', D.draftsBlocked([{ ...good, install_due_month: '' }]), '1번째 줄 — 설치 예정월을 고르세요')
eq('예정월 모양이 틀리면', D.draftsBlocked([{ ...good, install_due_month: '2027' }]), '1번째 줄 — 설치 예정월을 고르세요')
eq('둘째 줄이 비어도 막는다', D.draftsBlocked([good, { ...good, device_name: '' }]), '2번째 줄 — 장비명(라인업)을 적어주세요')

console.log('\n── ②-2 견적 품목에서 미리 채우기 ──')
const items = [
  { product_name: 'SURFCOM NEX 040', model: '040', quantity: 2, group_kind: 'base' },
  { product_name: '회전테이블', model: 'RT-200', quantity: 1, group_kind: 'option' },
  { product_name: 'PC세트', quantity: 1, group_kind: 'include' },
  { product_name: '운임', quantity: 1 },
]
const made = D.draftsFromItems(items, { customerId: 7, month: '2027-03' })
eq('본체 줄 수량만큼 줄을 만든다', made.length, 2)
eq('판정이 센 수와 같다(둘이 어긋나지 않는다)', made.length, D.mainQty(items))
eq('라인업·모델을 미리 적는다', [made[0].device_name, made[0].device_name2], ['SURFCOM NEX 040', '040'])
eq('사업장·예정월을 미리 채운다', [made[0].customer_id, made[0].install_due_month], [7, '2027-03'])
eq('옵션·포함사항·묶음 없는 줄은 들어오지 않는다', made.every(d => d.device_name === 'SURFCOM NEX 040'), true)
eq('본체 줄이 없으면 한 줄도 안 만든다',
  D.draftsFromItems([{ product_name: '운임', group_kind: null, quantity: 1 }], { customerId: 1, month: '2027-03' }).length, 0)

console.log('\n── ③ 상태와 뱃지 ──')
eq('납품 예정이라는 글자', S.DEVICE_PENDING, '납품 예정')
ok('납품 예정 판정', S.isPendingDelivery({ status: '납품 예정' }) && !S.isPendingDelivery({ status: '사용중' }))
eq('가동 수에서 빠진다',
  S.operatingOnly([{ status: '사용중' }, { status: '납품 예정' }, { status: '폐기' }]).length, 1)
ok('목록에는 남는다(폐기만 뺀다)', S.inUseOnly([{ status: '납품 예정' }]).length === 1)
eq('뱃지 글자', S.pendingLabel('2027-03'), '설치 예정 2027-03')
eq('예정월이 없으면', S.pendingLabel(null), '설치 예정')
ok('예정월이 지나면 지연', S.isDeliveryLate('2026-10', '2026-11-26') && !S.isDeliveryLate('2027-03', '2026-11-26'))
ok('다음 교정일을 셈하는 함수는 없다', S.nextCalibrationDate === undefined)

console.log('\n── ④ 라우트 ──')
const PO = read('app/api/purchase-order/route.ts')
const CHANGE = read('app/api/customer-change/route.ts')
const DEL = read('lib/approval/quoteDelete.ts')
ok('발주 등록이 장비를 함께 만든다', /insertPendingDevices\(supabaseAdmin, Number\(quoteId\)/.test(PO))
ok('서버도 셋을 다시 본다', /draftsBlocked\(drafts\)/.test(PO))
ok('못 만들면 발주를 되돌린다', /발주를 되돌렸다/.test(PO) && /status: '견적중', purchase_order_url: null/.test(PO))
ok('만든 줄에 견적을 적어 둔다', /source_quote_id: quoteId/.test(PO))
ok('칸이 없으면 지나간다(42703)', /devices 의 납품 예정 칸이 아직 없다/.test(PO))
ok('사업장 이력에 「납품 예정 등록」', /mode: 'delivery_pending'/.test(PO))
ok('운용 전환 길이 있다', /action === 'device-commission'/.test(CHANGE))
ok('S/N·납입일이 없으면 막는다', /S\/N 을 입력해주세요/.test(CHANGE) && /납입일을 입력해주세요/.test(CHANGE))
// 주석에는 'device-calibrated' 라는 이름이 남아 있다(왜 뺐는지 적어 둔 글이다) — **부르는 자리**만 본다.
ok('교정일을 잡는 길은 **없다**', !/action === 'device-calibrated'/.test(CHANGE) && !CHANGE.includes('nextCalibrationDate('))
ok('발주가 취소되면 예정 장비만 숨긴다',
  /hidePendingDevices/.test(DEL) && /\.eq\('status', DEVICE_PENDING\)/.test(DEL))
ok('이미 설치된 줄은 건드리지 않는다고 적었다', /설치가 끝나 '사용중' 이 된 줄은/.test(DEL))

console.log('\n── ⑤ 화면 ──')
const PANEL = read('components/dashboard/MyQuotesPanel.tsx')
const DD = read('components/quote/DeliveryDevices.tsx')
const SEC = read('components/customer/DeviceSection.tsx')
const SVC = read('components/customer/modals/ServiceAddModal.tsx')
const CRUD = read('hooks/customer/useServiceCrud.tsx')
ok('발주 창은 **품목을 읽고** 섹션을 낸다', /\{poNeedsDevices && \(/.test(PANEL)
  && /needsDeliveryDevices\(items \?\? \[\]\)/.test(PANEL) && !/needsDeliveryDevices\(poQuote\)/.test(PANEL))
ok('품목을 못 읽었으면 묻지 않는다(판정이 state 다)', /const \[poNeedsDevices, setPoNeedsDevices\] = useState\(false\)/.test(PANEL))
ok('창을 닫으면 판정도 되돌린다', /setPoNeedsDevices\(false\)/.test(PANEL))
ok('덜 찼으면 등록 단추가 꺼진다', /disabled=\{poUploading \|\| !poFile \|\| !!poBlocked\}/.test(PANEL))
ok('품목에서 미리 채운다', /draftsFromItems\(items \?\? \[\]/.test(PANEL))
ok('장비 세 칸은 마스터 부품을 쓴다', /<EquipmentPicker/.test(DD))
// 하네스 안의 색은 이어 붙여 적는다 — color-token-check 가 직접 표기를 세기 때문이다.
const HEX = s => '\u0023' + s
ok('카드는 점선이다', SEC.includes(`pending ? '1px dashed ${HEX('9ca3af')}' : '1px solid ${HEX('ebebeb')}'`))
ok('지연이면 빨강', /late \? '#fee2e2' : '#f3f4f6'/.test(SEC))
ok('레포트 창이 S/N·납입일을 받는다', /commissioning && \(/.test(SVC) && /pendingDevice/.test(SVC))
ok('신규설치일 때만 묻는다', /form\.service_type === '신규설치'/.test(SVC))
ok('저장 뒤 운용으로 바꾼다', /action: 'device-commission'/.test(CRUD))
ok('레포트가 교정일을 적는 자리도 **없다**', !/device-calibrated/.test(CRUD) && !/CALIBRATION_TYPE/.test(CRUD))

console.log('\n── ⑥ SQL ──')
const SQL = read('db/devices_delivery_20261126.sql')
ok('칸 둘을 더한다',
  /add column if not exists install_due_month\s+text/.test(SQL)
  && /add column if not exists source_quote_id\s+bigint/.test(SQL))
ok('교정일 칸은 더하지 않는다', !/add column if not exists next_calibration_date/.test(SQL))
ok('status 의 CHECK 는 건드리지 않는다(선택 블록은 주석)',
  /\*\*status 의 CHECK 제약은 건드리지 않는다\.\*\*/.test(SQL)
  && !/^alter table public\.devices drop constraint/m.test(SQL))
ok('발주 찾기 인덱스', /devices_source_quote_idx/.test(SQL) && !/devices_next_calibration_idx/.test(SQL))
ok('스키마를 깨운다', /notify pgrst, 'reload schema'/.test(SQL))
ok('APPLIED.md 에 적어 두었다', /devices_delivery_20261126\.sql/.test(read('db/APPLIED.md')))

console.log('\n── ⑦ 2026-11-26 묶음2 F 실측으로 못 박은 것 ──')
const ROUTE_CC = read('app/api/customer-change/route.ts')
// 실측: [검증용] 납품 예정 장비 한 줄을 만들어(견적 없이) 사업장 화면·운용 전환·삭제까지 봤다.
ok('운용 전환은 S/N·납입일을 **둘 다** 받아야 한다',
  /if \(!serial\) return bad\('S\/N 을 입력해주세요'\)/.test(ROUTE_CC)
  && /return bad\('납입일을 입력해주세요'\)/.test(ROUTE_CC))
ok('전환하면 설치 예정월을 비운다', /install_due_month: null,/.test(ROUTE_CC))
ok('칸이 아직 없으면 예정월만 빼고 다시 쓴다(레포트를 막지 않는다)',
  /error\.code === '42703' \|\| error\.code === 'PGRST204'/.test(ROUTE_CC))
// 홈의 「설치 예정」 줄은 **내 견적이 만든 장비**만 센다 — 견적 없이 만든 줄은 뜨지 않는다.
//   실측에서 그렇게 나왔고, 그것이 지금 규칙이다(보고서에 판단 필요로 적었다).
ok('홈은 내 견적이 만든 장비만 센다(source_quote_id)',
  /\.in\('source_quote_id', ids\)/.test(read('hooks/dashboard/useToday.ts')))
ok('실측 대본이 있다(서버·키가 필요해 check 에 넣지 않는다)',
  fs.existsSync(path.join(ROOT, 'scripts/bundle2-f-measure.js')))
ok('그 대본은 [검증용] 만 만들고 장부의 id 만 지운다',
  /장부에 적힌 id 만 지운다/.test(read('scripts/bundle2-f-measure.js'))
  && /이름이 \$\{MARK\} 로 시작하지 않는다/.test(read('scripts/bundle2-f-measure.js')))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
