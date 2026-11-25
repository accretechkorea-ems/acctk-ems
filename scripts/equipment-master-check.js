// 장비 라인업 **마스터** — 가르는 규칙과 폼 (2026-11-26).
//
//   node scripts/equipment-master-check.js
//
// 지키는 약속
//   ① 품명을 가르는 규칙은 **한 곳**이다(lib/equipmentName.ts) — 파싱·대조·폼이 함께 쓴다.
//   ② 규칙은 차례대로 맞춰 보고, 애매하면 **애매하다고 말한다**(sure: false).
//   ③ 표가 없어도 화면은 돈다 — 마스터가 비면 세 칸이 자유 입력이다.
//   ④ 목록에 없는 값으로 저장하면 그 줄에 자국이 남는다(devices.master_pending).
//   ⑤ 라우트는 그 칸이 아직 없을 때 **빼고 담는다**(42703 폴백).
//   ⑥ SQL 은 표 셋 + unique + RLS(읽기 전원)와 시드를 담는다.

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

const N = load(path.join(ROOT, 'lib/equipmentName.ts'))

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
const cut = p => ({ lineup: p.lineup, model: p.model, config: p.config, sure: p.sure })

console.log('── ① 가르는 규칙 ──')
eq('SURFCOM NEX 040 DX2-12', cut(N.parseEquipmentName('SURFCOM NEX 040 DX2-12')),
  { lineup: 'SURFCOM NEX', model: '040', config: 'DX2-12', sure: true })
eq('XYZAX AXCEL 7/5/5 PH C2', cut(N.parseEquipmentName('XYZAX AXCEL 7/5/5 PH C2')),
  { lineup: 'XYZAX AXCEL', model: '7/5/5', config: 'PH C2', sure: true })
eq('XYZAX SVF NEX 4/4/3-C1', cut(N.parseEquipmentName('XYZAX SVF NEX 4/4/3-C1')),
  { lineup: 'XYZAX SVF NEX', model: '4/4/3', config: 'C1', sure: true })
eq('HANDYSURF+ 35', cut(N.parseEquipmentName('HANDYSURF+ 35')),
  { lineup: 'HANDYSURF+', model: '35', config: null, sure: true })
eq('SURFCOM 1400G-11 — 애매', cut(N.parseEquipmentName('SURFCOM 1400G-11')),
  { lineup: 'SURFCOM', model: '1400G', config: '11', sure: false })
eq('Opt-scope S NEX DX-12 — 규격이 없다', cut(N.parseEquipmentName('Opt-scope S NEX DX-12')),
  { lineup: 'Opt-scope S NEX', model: null, config: 'DX-12', sure: false })
eq('Opt-scope S+ — 끝낱말을 모델로', cut(N.parseEquipmentName('Opt-scope S+')),
  { lineup: 'Opt-scope', model: 'S+', config: null, sure: false })
eq('빈 값', cut(N.parseEquipmentName('')), { lineup: '', model: null, config: null, sure: false })
eq('앞뒤 공백·두 칸 공백을 다듬는다', N.parseEquipmentName('  SURFCOM   NEX  040 DX2-12 ').lineup, 'SURFCOM NEX')

console.log('\n── ①-2 브랜드·시리즈 ──')
eq('브랜드', N.brandOf('XYZAX SVF NEX'), 'XYZAX')
eq('시리즈', N.seriesOf('XYZAX SVF NEX'), 'SVF NEX')
eq('시리즈가 없는 라인업', N.seriesOf('CONTOURECORD'), '')
eq('대조 열쇠는 공백·기호·대소문자를 무시한다',
  [N.normKey('SURFCOM NEX'), N.normKey('surfcom-nex'), N.normKey('Surfcom  NEX')],
  ['surfcomnex', 'surfcomnex', 'surfcomnex'])

console.log('\n── ② 문서가 있다 ──')
const SEED = read('docs/equipment-master-seed-20261126.md')
ok('시드 문서 — 전량 표', /## 전량/.test(SEED) && /품명\(중복 뺀\) \*\*594\*\*/.test(SEED))
ok('규칙과 적용 수를 적었다', /## 규칙과 적용 수/.test(SEED))
ok('애매한 줄을 따로 모았다', /## 판단 필요 \d+건/.test(SEED))
const MATCH = read('docs/equipment-master-match-20261126.md')
ok('대조 문서 — 갈래 넷', /일치\(구성까지\)/.test(MATCH) && /부분일치/.test(MATCH) && /불일치/.test(MATCH))
ok('대조는 **갱신하지 않는다**고 적었다', /\*\*갱신하지 않는다\*\*/.test(MATCH))

console.log('\n── ③ 표와 시드(SQL) ──')
const SQL = read('db/equipment_master_20261126.sql')
for (const t of ['equipment_lineups', 'equipment_models', 'equipment_configs']) {
  ok(`${t} 표`, new RegExp(`create table if not exists public\\.${t}`).test(SQL))
}
ok('라인업 이름은 하나뿐(unique)', /create unique index if not exists equipment_lineups_name_idx/.test(SQL))
ok('모델·구성도 짝으로 unique',
  /equipment_models_key_idx on public\.equipment_models \(lineup_id, name\)/.test(SQL)
  && /equipment_configs_key_idx on public\.equipment_configs \(model_id, name\)/.test(SQL))
ok('RLS — 읽기는 전원', /create policy equipment_lineups_select[\s\S]{0,80}for select to authenticated using \(true\)/.test(SQL))
ok('쓰기 정책은 두지 않는다(service role 만)', !/for (insert|update|delete)/.test(SQL))
ok('line 은 80·20 둘뿐', /check \(line in \('80', '20'\)\)/.test(SQL))
ok('애매한 줄도 넣고 pending 으로 표시한다', /pending\s+boolean not null default false/.test(SQL))
ok('시드가 채워져 있다', /insert into public\.equipment_lineups \(name, line, brand, series, sort, pending\)/.test(SQL))
const lineupSeeds = (SQL.match(/insert into public\.equipment_lineups/g) || []).length
ok(`라인업 시드 ${lineupSeeds}줄`, lineupSeeds >= 15)
ok('장비 줄에 자국 칸을 더한다', /add column if not exists master_pending boolean not null default false/.test(SQL))
ok('스키마를 깨운다', /notify pgrst, 'reload schema'/.test(SQL))
ok('APPLIED.md 에 적어 두었다', /equipment_master_20261126\.sql/.test(read('db/APPLIED.md')))

console.log('\n── ④ 폼 — 고르되 가두지 않는다 ──')
const PICK = read('components/customer/modals/EquipmentPicker.tsx')
const ADD = read('components/customer/modals/DeviceAddModal.tsx')
const EDIT = read('components/customer/modals/DeviceEditModal.tsx')
ok('세 칸 모두 공용 콤보박스', (PICK.match(/<SearchSelect</g) || []).length === 3)
ok('등록·수정이 같은 부품을 쓴다', /<EquipmentPicker/.test(ADD) && /<EquipmentPicker/.test(EDIT))
ok('적은 그대로 저장된다고 알린다', /적은 그대로 저장됩니다/.test(PICK))
ok('라인업을 고르면 그 라인업의 모델만', /lu \? lu\.models : master\.lineups\.flatMap/.test(PICK))
ok('마스터가 없으면 자유 입력이라고 적는다', /마스터가 없어 자유 입력으로 받습니다/.test(PICK))

console.log('\n── ⑤ 자국과 폴백 ──')
const MASTER = read('lib/equipmentMaster.ts')
const CRUD = read('hooks/customer/useDeviceCrud.ts')
const ROUTE = read('app/api/customer-change/route.ts')
ok('마스터가 비면 자국을 남기지 않는다', /if \(master\.empty\) return false/.test(MASTER))
ok('표가 없으면 빈 마스터로 돈다', /EMPTY_MASTER/.test(MASTER) && /자유 입력으로 돈다/.test(MASTER))
ok('저장할 때 센다', /master_pending: isMasterPending\(master, form\.device_name, form\.device_name2, form\.option\)/.test(CRUD))
ok('라우트의 흰 목록에 있다', /master_pending: '마스터 밖'/.test(ROUTE))
ok('칸이 없으면 빼고 담는다(42703)', /dropMissingDeviceColumns/.test(ROUTE)
  && /DEVICE_NEW: readonly string\[\] = \['master_pending', 'install_due_month'\]/.test(ROUTE))

console.log(fails === 0 ? '\n전부 통과' : `\n${fails}건 실패`)
process.exit(fails === 0 ? 0 : 1)
