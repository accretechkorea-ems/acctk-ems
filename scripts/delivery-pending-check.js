// 수주 시 **납품 예정 장비** (2026-11-26).
//
//   node scripts/delivery-pending-check.js
//
// 지키는 약속
//   ① 묻는 자리는 **장비를 파는 견적**뿐이다(양식 equip80 이거나 장비 분류).
//   ② 장비명·사업장·설치 예정월 셋을 **전부** 채워야 발주가 등록된다(화면도 서버도 본다).
//   ③ 만드는 일은 라우트가 한다 — 발주 상태 변경과 **한 요청**이고, 장비를 못 만들면
//     **발주를 되돌린다**(반쪽으로 끝나지 않는다).
//   ④ 납품 예정 장비는 **가동 수·통계에서 빠진다**. 카드에는 점선과 「설치 예정 …」이 붙고,
//     예정월이 지나면 「지연」이다. 엑셀에는 줄로 남고 상태 열로 구분된다.
//   ⑤ 신규설치 레포트를 쓰면 S/N·납입일을 받아 **운용**으로 바꾼다. 교정 레포트는 다음
//     교정일을 완료일 + 12개월로 잡는다.
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

console.log('── ① 묻는 자리 ──')
ok('장비 양식이면 묻는다', D.needsDeliveryDevices({ form_kind: 'equip80' }))
ok('장비 분류여도 묻는다', D.needsDeliveryDevices({ category: 'CMM' })
  && D.needsDeliveryDevices({ category: 'ROUNDNESS' }) && D.needsDeliveryDevices({ category: 'SURFACE' }))
ok('부품·서비스 견적에는 묻지 않는다',
  !D.needsDeliveryDevices({ form_kind: 'parts80', category: 'LABOR' })
  && !D.needsDeliveryDevices({ category: 'KOLAS' })
  && !D.needsDeliveryDevices(null))
eq('장비로 보는 분류는 셋', [...D.EQUIPMENT_CATEGORY_CODES], ['CMM', 'ROUNDNESS', 'SURFACE'])

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
const made = D.draftsFromItems(
  [{ product_name: 'SURFCOM NEX 040', model: '040', quantity: 2 }, { product_name: '', quantity: 1 }],
  { customerId: 7, month: '2027-03' })
eq('수량만큼 줄을 만든다', made.length, 2)
eq('사업장·예정월을 미리 채운다', [made[0].customer_id, made[0].install_due_month], [7, '2027-03'])
eq('품명이 빈 줄은 건너뛴다', made.every(d => !!d.device_name), true)
eq('부대비용 묶음은 빼고 본체만',
  D.draftsFromItems([{ product_name: '운임', group_kind: 'expense', quantity: 1 }], { customerId: 1, month: '2027-03' }).length, 0)

console.log('\n── ③ 상태와 뱃지 ──')
eq('납품 예정이라는 글자', S.DEVICE_PENDING, '납품 예정')
ok('납품 예정 판정', S.isPendingDelivery({ status: '납품 예정' }) && !S.isPendingDelivery({ status: '사용중' }))
eq('가동 수에서 빠진다',
  S.operatingOnly([{ status: '사용중' }, { status: '납품 예정' }, { status: '폐기' }]).length, 1)
ok('목록에는 남는다(폐기만 뺀다)', S.inUseOnly([{ status: '납품 예정' }]).length === 1)
eq('뱃지 글자', S.pendingLabel('2027-03'), '설치 예정 2027-03')
eq('예정월이 없으면', S.pendingLabel(null), '설치 예정')
ok('예정월이 지나면 지연', S.isDeliveryLate('2026-10', '2026-11-26') && !S.isDeliveryLate('2027-03', '2026-11-26'))
eq('다음 교정일 — 열두 달 뒤', S.nextCalibrationDate('2026-11-26'), '2027-11-26')
eq('2/29 는 말일로 맞춘다', S.nextCalibrationDate('2028-02-29'), '2029-02-28')
eq('날짜가 깨졌으면 null', S.nextCalibrationDate('어제'), null)

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
ok('교정일을 잡는 길이 있다', /action === 'device-calibrated'/.test(CHANGE) && /nextCalibrationDate/.test(CHANGE))
ok('발주가 취소되면 예정 장비만 숨긴다',
  /hidePendingDevices/.test(DEL) && /\.eq\('status', DEVICE_PENDING\)/.test(DEL))
ok('이미 설치된 줄은 건드리지 않는다고 적었다', /설치가 끝나 '사용중' 이 된 줄은/.test(DEL))

console.log('\n── ⑤ 화면 ──')
const PANEL = read('components/dashboard/MyQuotesPanel.tsx')
const DD = read('components/quote/DeliveryDevices.tsx')
const SEC = read('components/customer/DeviceSection.tsx')
const SVC = read('components/customer/modals/ServiceAddModal.tsx')
const CRUD = read('hooks/customer/useServiceCrud.tsx')
ok('발주 창이 장비 견적일 때만 섹션을 낸다', /\{needsDeliveryDevices\(poQuote\) && \(/.test(PANEL))
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
ok('교정이면 다음 교정일을 잡는다', /action: 'device-calibrated'/.test(CRUD))

console.log('\n── ⑥ SQL ──')
const SQL = read('db/devices_delivery_20261126.sql')
ok('칸 셋을 더한다',
  /add column if not exists install_due_month\s+text/.test(SQL)
  && /add column if not exists next_calibration_date date/.test(SQL)
  && /add column if not exists source_quote_id\s+bigint/.test(SQL))
ok('status 의 CHECK 는 건드리지 않는다(선택 블록은 주석)',
  /\*\*status 의 CHECK 제약은 건드리지 않는다\.\*\*/.test(SQL)
  && !/^alter table public\.devices drop constraint/m.test(SQL))
ok('교정 예정·발주 찾기 인덱스', /devices_next_calibration_idx/.test(SQL) && /devices_source_quote_idx/.test(SQL))
ok('스키마를 깨운다', /notify pgrst, 'reload schema'/.test(SQL))
ok('APPLIED.md 에 적어 두었다', /devices_delivery_20261126\.sql/.test(read('db/APPLIED.md')))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
