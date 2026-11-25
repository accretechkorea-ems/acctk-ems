// 장비 — **누가 할 수 있나**와 **지우기는 숨기기다** (2026-11-25).
//
//   node scripts/device-perm-check.js
//
// 지키는 약속
//   ① 등록·수정·삭제·폐기·폐기취소를 **로그인한 사람 전부**가 한다. 버튼이 보이는데
//     눌러서 403 이 나는 자리를 만들지 않는다 — 화면과 라우트가 같은 말을 한다.
//   ② 쓰기는 **service role 라우트**가 한다(/api/customer-change · /api/customer-delete).
//     브라우저가 devices 를 직접 고치면 사건을 적을 수 없고 열 권한에 걸린다.
//   ③ 삭제는 소프트다 — deleted_at·deleted_by·delete_reason. 하드 DELETE 는 어디에도 없다.
//   ④ deleted_at 이 있는 줄은 **목록·카드·엑셀·통계 전부**에서 빠진다.
//   ⑤ 등록·수정·삭제·폐기·복구가 customer_events 에 남는다.
//   ⑥ 되살리는 자리는 장비 그리드 끝이고, 문턱은 관리 메뉴다.

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

const CHANGE = read('app/api/customer-change/route.ts')
const DELETE = read('app/api/customer-delete/route.ts')
const CRUD = read('hooks/customer/useDeviceCrud.ts')
const BODY = read('components/customer/CustomerDetailBody.tsx')
const SECTION = read('components/customer/DeviceSection.tsx')
const EDIT = read('components/customer/modals/DeviceEditModal.tsx')

console.log('\n── ① 문턱 — 로그인한 사람 전부 ──')
ok('바꾸기 라우트는 로그인만 본다',
  /loadCaller\(\{ kind: 'login' \}, \{ tag: TAG, req, method: 'POST' \}\)/.test(CHANGE))
ok('지우기는 고객사 메뉴로 내려왔다', /'counts', 'delete'/.test(DELETE))
ok('화면의 「삭제」도 모두에게 선다', /onDelete=\{device\.openDeleteDevice\}/.test(BODY))
ok('폐기·폐기취소에 권한 판정이 없다',
  /onDispose=\{device\.handleDisposeDevice\}/.test(BODY) && /onRestore=\{device\.handleRestoreDevice\}/.test(BODY))
ok('장비 추가·수정 단추에도 판정이 없다',
  /onAddDevice=\{\(\) => device\.setIsAddDeviceModalOpen\(true\)\}/.test(BODY)
  && /onEditDevice=\{device\.setSelectedDevice\}/.test(BODY))
ok('슈퍼관리자 판정이 장비 자리에 남아 있지 않다',
  !/isSuperAdmin\(\{ permission_level: currentUserRole \}\)/.test(BODY))

console.log('\n── ② 쓰기는 라우트가 한다 ──')
for (const [what, re] of [
  ['등록', /customerChange\(\{ action: 'device-add'/],
  ['수정', /customerChange\(\{ action: 'device-edit'/],
  ['삭제', /customerDelete\(\{ action: 'delete', target: 'device'/],
  ['폐기', /customerChange\(\{ action: 'device-dispose'/],
  ['폐기취소', /customerChange\(\{ action: 'device-restore'/],
]) ok(`${what} 는 라우트를 부른다`, re.test(CRUD))
// 2026-11-26 — **예외가 없어졌다.** 사진·패킹리스트의 경로 칸도 라우트가 쓴다.
// 파일 자체는 브라우저가 저장소에 올리고, devices 의 칸은 device-photo·device-packing 이 쓴다.
ok('브라우저가 devices 를 직접 고치지 않는다',
  !/from\('devices'\)/.test(CRUD),
  '칸을 쓰는 일은 전부 /api/customer-change 로 보낸다(사건을 함께 남긴다)')
for (const [what, re] of [
  ['사진 등록·변경', /customerChange\(\{ action: 'device-photo', id: device\.device_id, path: fileName \}\)/],
  ['사진 삭제', /customerChange\(\{ action: 'device-photo', id: device\.device_id, path: null \}\)/],
  ['패킹리스트', /customerChange\(\{ action: 'device-packing'/],
]) ok(`${what} 도 라우트를 부른다`, re.test(CRUD))
ok('라우트가 그 두 칸만 쓴다',
  /const column = photo \? 'image_url' : 'packing_list_url'/.test(CHANGE)
  && /\.update\(\{ \[column\]: path \}\)/.test(CHANGE))
ok('패킹리스트는 비우지 않는다(사진만 null 을 받는다)',
  /if \(path === null && !photo\) return bad/.test(CHANGE))
ok('사건은 경로가 아니라 있다·없다로 적는다',
  /before: had \? '있음' : null, after: path \? '있음' : null/.test(CHANGE))

console.log('\n── ②-ⓑ 죽은 코드는 남기지 않는다 ──')
// 카드 클릭이 **크게 보기**로 바뀌면서 사진 등록 창을 여는 길이 하나도 없어졌다.
ok('DeviceImageModal 은 지웠다',
  !fs.existsSync(path.join(ROOT, 'components/customer/modals/DeviceImageModal.tsx')))
ok('그 창의 상태도 훅에 남아 있지 않다',
  !/selectedImageDevice|isSavingDeviceImage|handleUploadDeviceImage/.test(CRUD))
ok('올리는 함수 자체는 남는다(장비 수정 창이 쓴다)',
  /export async function uploadDeviceImage/.test(CRUD) && /export async function removeDeviceImage/.test(CRUD))

console.log('\n── ③ 삭제는 숨기기다 ──')
// 2026-11-26 — customer-change 에 `.delete()` 가 하나 생겼다: **수리 완료가 만든
// 영업활동 줄**을 지우는 자리다(sales_activities, 자국 [수리 #N] 로 집는다).
// 장비·고객사 쪽에는 여전히 하드 DELETE 가 없다 — 그것만 본다.
ok('하드 DELETE 가 없다', !/\.delete\(\)/.test(CRUD) && !/\.delete\(\)/.test(DELETE))
ok('바꾸기 라우트의 delete 는 영업활동 한 자리뿐이다',
  (CHANGE.match(/\.delete\(\)/g) || []).length === 1
  && /from\('sales_activities'\)\s*\n?\s*\.delete\(\)\.eq\('activity_type', REPAIR_ACTIVITY_TYPE\)/.test(CHANGE),
  'devices·customers 를 하드로 지우는 길을 만들지 않는다')
ok('누가·왜를 그 줄에 적는다',
  /deleted_by: caller\.engineer_id, delete_reason: reason/.test(DELETE))
ok('까닭이 없으면 400', /지우는 까닭을 적어주세요/.test(DELETE))
const SQL = read('db/devices_soft_delete_20261125.sql')
ok('SQL 이 두 칸을 더한다',
  /add column if not exists deleted_by\s+integer references public\.engineers/.test(SQL)
  && /add column if not exists delete_reason text/.test(SQL))
ok('숨긴 줄만 보는 인덱스가 있다',
  /create index if not exists devices_deleted_idx[\s\S]{0,120}where deleted_at is not null/.test(SQL))
ok('스키마를 깨운다', /notify pgrst, 'reload schema'/.test(SQL))
ok('APPLIED.md 에 적어 두었다', /devices_soft_delete_20261125\.sql/.test(read('db/APPLIED.md')))
ok('그 칸이 없어도 지워진다(42703 때는 시각만)',
  /error\.code === '42703' \|\| error\.code === 'PGRST204'/.test(DELETE))

console.log('\n── ④ 숨긴 줄은 어디에도 끼지 않는다 ──')
const HIDDEN = [
  ['사업장 상세', 'hooks/customer/useCustomerDetail.ts'],
  ['고객사 현황', 'hooks/useHomeData.ts'],
  ['회사 타임라인', 'hooks/useCompanyTimeline.ts'],
  ['엑셀 내보내기', 'lib/customerExportData.ts'],
  ['의뢰서의 사업장 고르기', 'components/inquiry/SitePicker.tsx'],
]
for (const [what, file] of HIDDEN) {
  const src = read(file)
  // 그 파일의 devices 조회 한 토막만 본다 — 다른 표의 .is('deleted_at', null) 에 속지 않게.
  const at = src.indexOf("from('devices')")
  const dev = at < 0 ? '' : src.slice(at, at + 400)
  ok(`${what} 가 숨긴 장비를 뺀다`, /is\('deleted_at', null\)/.test(dev), `${file} 의 devices 조회`)
}
// 쇼룸 통계는 칸을 받아 와 코드에서 거른다(한 번에 여러 표를 묶어 읽는 자리다).
const SHOW = read('app/api/showroom/stats/route.ts')
ok('쇼룸 통계도 뺀다', /deleted_at/.test(SHOW))
// 세는 쪽도 같다 — 「장비 2대가 함께 숨겨집니다」에 이미 숨은 장비를 세지 않는다.
ok('함께 숨는 장비 수에서도 뺀다',
  /from\('devices'\)\.select\('device_id', \{ count: 'exact', head: true \}\)\.eq\('customer_id', id\)\.is\('deleted_at', null\)/.test(DELETE))

console.log('\n── ⑤ 사건으로 남는다 ──')
// 등록·수정은 **한 종류**(device_edited)이고 payload.mode 가 가른다 — 활동 이력이 그 값으로
// 「장비 등록」·「장비 수정」을 적는다. 종류를 늘리지 않는 쪽이 기존 규칙이다.
ok('등록·수정은 바뀐 칸을 적는다',
  /mode: 'add', device_id: made\.device_id/.test(CHANGE)
  && /mode: 'edit', device_id: id/.test(CHANGE)
  && /changes: trimChanges\(changes\)/.test(CHANGE))
ok('폐기·폐기취소도 같은 종류에 mode 로 남는다',
  /mode: dispose \? 'dispose' : 'undispose'/.test(CHANGE))
ok('삭제는 payload.kind 로 장비를 가린다',
  /event_type: 'customer_deleted'/.test(DELETE) && /kind: target/.test(DELETE))
ok('복구도 사건이다', /event_type: 'customer_restored'/.test(DELETE))
const EV = read('lib/customerEvents.ts')
ok('활동 이력이 그 종류를 안다',
  /'device_edited'/.test(EV) && /'customer_deleted'/.test(EV) && /'customer_restored'/.test(EV))

console.log('\n── ⑥ 되살리는 자리 ──')
const DEL = read('components/customer/DeletedDevices.tsx')
ok('장비 그리드 끝에 선다', /<DeletedDevices customerId=\{customerId\}/.test(BODY))
ok('문턱은 관리 메뉴다',
  /const canRestoreDevice = canViewMenu\(me, 'admin'\)/.test(BODY)
  && /canRestore=\{canRestoreDevice\}/.test(BODY))
ok('권한이 없으면 아무것도 그리지 않는다', /if \(!canRestore \|\| rows\.length === 0\) return null/.test(DEL))
ok('접힌 채로도 몇 대인지 적는다', /삭제된 장비 <span className="num">\{rows\.length\}<\/span>대/.test(DEL))
ok('목록·복구는 라우트가 한다',
  /action: 'list-deleted', target: 'device', customerId/.test(DEL)
  && /action: 'restore', target: 'device', id: row\.device_id/.test(DEL))
ok('라우트가 그 사업장의 숨긴 장비만 읽는다',
  /\.eq\('customer_id', customerId\)\s*\n\s*\.not\('deleted_at', 'is', null\)/.test(DELETE))

console.log('\n── ⑦ 사진 — 보는 길과 올리는 길이 다르다 ──')
ok('카드 사진은 **크게 보기**다', /onViewPhoto\(d\.image_url/.test(SECTION) && /사진 크게 보기/.test(SECTION))
ok('카드에서 등록 창이 열리지 않는다', !/onImageUpload/.test(SECTION) && !/onImageUpload/.test(BODY))
ok('사진 없는 칸은 눌러도 아무 일이 없다',
  /<div\s*\n\s*style=\{\{\s*\n\s*width: '100%', height: '100%',/.test(SECTION),
  '단추가 아니라 글자만 둔다')
ok('올리고 바꾸고 지우는 일은 장비 수정 창에 있다',
  /사진 변경/.test(EDIT) && /사진 삭제/.test(EDIT))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
