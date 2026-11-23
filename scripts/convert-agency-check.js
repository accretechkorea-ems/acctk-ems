/**
 * 회사 → **대리점 전환** (2026-11-21).
 *
 * 지키는 약속
 *   ① 판정과 바꾸기는 **DB 함수 한 번**이다(한 트랜잭션). SQL 파일에 권한·notify 가 있다.
 *   ② dry_run 이 **기본값**이다 — 실수로 부른 한 번이 줄을 바꾸지 않는다.
 *   ③ 라우트는 **superadmin** 문턱이다(회사 수준 작업 — 이름·병합·삭제와 같다).
 *   ④ 화면은 조건이 안 맞으면 **버튼을 잠그고 이유를 말한다**(사업장 수·권한).
 *   ⑤ 창은 열면서 dry_run 을 돌리고, 막는 것이 있으면 「전환」이 켜지지 않는다.
 *   ⑥ 전환 뒤에는 두 캐시를 비우고 **대리점 탭의 그 줄로** 옮겨 간다.
 *
 * ⚠ 이 하네스는 **글(코드·SQL)만** 본다 — 키 없이 어디서나 돌아야 하기 때문이다.
 *   운영 DB 에 붙어 dry_run 을 **실제로** 불러 보는 쪽은 scripts/convert-agency-dryrun.js
 *   다(손으로 돌린다). 돌아오는 칸 목록(SHAPES)은 그쪽에 한 벌만 두고 여기서도 쓴다 —
 *   두 군데에 적으면 한쪽만 고쳐지고 서로 다른 것을 지키게 된다.
 */
const load = module.require.bind(module)
const path = load('path')
const fs = load('fs')
const ROOT = path.resolve(__dirname, '..')
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')

const SQL = read(path.join('db', 'convert_company_to_agency_20261121.sql'))
const ROUTE = read(path.join('app', 'api', 'parent-company', 'route.ts'))
const PANE = read(path.join('components', 'home', 'list', 'CompanyPane.tsx'))
const MODAL = read(path.join('components', 'home', 'list', 'ConvertAgencyModal.tsx'))
const EDIT = read(path.join('components', 'home', 'list', 'CompanyEditModal.tsx'))
const HOME = read(path.join('app', 'page.tsx'))
const { SHAPES } = load(path.join(__dirname, 'convert-agency-dryrun.js'))

let fail = 0
const ok = (name, cond, hint) => {
  if (cond) console.log(`OK   ${name}`)
  else { fail++; console.error(`FAIL ${name}${hint ? `  — ${hint}` : ''}`) }
}

console.log('── ① DB 함수 ──')
ok('함수 이름·인자', /create or replace function public\.convert_company_to_agency\(\s*p_company_id bigint,\s*p_dry_run boolean default true\s*\)/.test(SQL))
ok('② dry_run 이 기본값이다', /p_dry_run boolean default true/.test(SQL))
ok('한 트랜잭션(plpgsql 함수 한 번)', /language plpgsql/.test(SQL) && /security definer/.test(SQL))
ok('search_path 를 고정한다', /set search_path = public/.test(SQL))
ok('회사 줄인지 본다', /is_parent/.test(SQL) && /회사 줄이 아닙니다/.test(SQL))
ok('살아있는 사업장이 정확히 1곳', /v_live <> 1/.test(SQL))
ok('이미 대리점인 사업장은 거부', /이미 대리점입니다/.test(SQL))
ok('회사 줄에 붙은 참조를 pg_constraint 로 전수 조사',
  /from pg_constraint con/.test(SQL) && /confrelid = 'public\.customers'::regclass/.test(SQL))
ok('스냅샷 표는 건너뛴다', /relname !~ '_20\[0-9\]\{6\}\$'/.test(SQL))
ok('바꾸는 칸 여섯 + 회사 줄 닫기',
  /is_agency\s+= true/.test(SQL) && /is_parent\s+= false/.test(SQL)
  && /parent_customer_id = null/.test(SQL) && /site_name\s+= null/.test(SQL)
  && /agency_customer_id = null/.test(SQL) && /company_name\s+= v_company\.company_name/.test(SQL)
  && /set deleted_at = now\(\)\s*\n\s*where customer_id = p_company_id/.test(SQL))
ok('권한 — service_role + authenticator',
  /grant execute on function public\.convert_company_to_agency\(bigint, boolean\) to service_role/.test(SQL)
  && /to authenticator/.test(SQL))
ok('anon·authenticated 에서는 뺀다', /revoke all on function public\.convert_company_to_agency\(bigint, boolean\) from anon, authenticated/.test(SQL))
ok('스키마 캐시 다시 읽기', /notify pgrst, 'reload schema'/.test(SQL))
ok('되돌리는 방법을 적어 두었다', /되돌리기/.test(SQL) && /update customers set deleted_at = null/.test(SQL))

console.log('\n── ③ 라우트 ──')
ok('action 이 있다', /if \(action === 'convert-agency'\)/.test(ROUTE))
ok('dry_run 이 기본이다(명시적으로 false 일 때만 실행)', /const dryRun = body\?\.dryRun !== false/.test(ROUTE))
// 2026-11-23: 사업장 병합이 SITE_LEVEL 로 내려갔다. 대리점 전환은 **그대로 슈퍼관리자**다 —
// 그래서 목록 글자를 그대로 비교하지 않고 「전환이 그 목록에 없다」를 본다.
ok('superadmin 문턱 — SITE_LEVEL 에 넣지 않았다',
  /const SITE_LEVEL = new Set\(\[[^\]]*\]\)/.test(ROUTE)
  && !/const SITE_LEVEL = new Set\(\[[^\]]*convert-agency/.test(ROUTE))
ok('RPC 를 부른다', /rpc\('convert_company_to_agency', \{\s*p_company_id: parentId, p_dry_run: dryRun,/.test(ROUTE))
ok('함수가 아직 없으면 무엇을 해야 하는지 알려 준다',
  /PGRST202/.test(ROUTE) && /convert_company_to_agency_20261121\.sql 적용 필요/.test(ROUTE))
ok('함수가 막은 사유를 그대로 올린다', /return bad\(error\.message \|\| '전환하지 못했습니다', 400\)/.test(ROUTE))

console.log('\n── ④ 버튼 조건 ──')
ok('권한이 없으면 잠근다', /슈퍼관리자만 전환할 수 있습니다/.test(PANE))
ok('사업장이 1곳이 아니면 잠근다', /1곳일 때만 전환할 수 있습니다/.test(PANE))
ok('사업장이 없으면 잠근다', /사업장이 없는 회사는 전환할 수 없습니다/.test(PANE))
ok('창에서 이유를 툴팁으로 말한다', /title=\{convertBlockedReason \?\? '이 회사를 대리점 한 줄로 바꿉니다'\}/.test(EDIT))
ok('대리점 모드에서는 버튼을 두지 않는다', /\{!agency && onConvertAgency && \(/.test(EDIT))

console.log('\n── ⑤ 확인 창 ──')
ok('열면서 dry_run 을 돌린다', /const r = await onDryRun\(\)/.test(MODAL))
ok('막는 것이 있으면 「전환」이 꺼진다',
  /const can = !!report\?\.ok && blockers\.length === 0 && siteCount === 1/.test(MODAL)
  && /disabled=\{busy \|\| !can\}/.test(MODAL))
ok('막는 목록을 보여 준다', /회사 줄에 붙어 있어 먼저 옮겨야 하는 기록/.test(MODAL))
ok('따라가는 것도 보여 준다', /그대로 따라가는 기록/.test(MODAL))
ok('표 이름은 사업장 병합 창과 같은 표를 쓴다', /import \{ TABLE_LABEL \}/.test(MODAL))

console.log('\n── ⑦ 돌아오는 칸(응답 모양) ──')
// SQL 의 jsonb_build_object 세 덩이가 실측 도구와 **같은 칸**을 말하는지 본다.
const built = [...SQL.matchAll(/jsonb_build_object\(\n([\s\S]*?)\n\s*\);/g)].map(m => m[1])
ok('반환 덩이가 셋이다(막힘 · 검사만 · 전환 완료)', built.length === 3, `${built.length}덩이`)
const keysIn = txt => [...txt.matchAll(/'([a-z_]+)',/g)].map(m => m[1])
const blocked = built.find(t => /'blockers'/.test(t))
const okDry = built.find(t => /'agency_name'/.test(t) && /'dry_run', true/.test(t))
ok('막힘 응답의 칸이 실측 도구의 SHAPES.blocked 와 같다',
  blocked != null && [...keysIn(blocked)].sort().join(',') === [...SHAPES.blocked].sort().join(','),
  blocked ? keysIn(blocked).join(',') : '(못 찾음)')
ok('검사만(dry_run) 응답의 칸이 SHAPES.ok 와 같다',
  okDry != null && [...keysIn(okDry)].sort().join(',') === [...SHAPES.ok].sort().join(','),
  okDry ? keysIn(okDry).join(',') : '(못 찾음)')
ok('세는 값과 합이 짝으로 온다', /'blockers', v_refs, 'blocker_total', v_total/.test(SQL) && /'follows', v_follows, 'follows_total', v_follows_n/.test(SQL))
ok('자식 사업장은 막는 사유로 세지 않는다', /if r\.tbl = 'customers' and r\.col = 'parent_customer_id' then\s*\n\s*continue;/.test(SQL))

console.log('\n── ⑥ 전환 뒤 ──')
ok('두 캐시를 비운다', /invalidateParents\(\)[\s\S]{0,80}invalidateAgencies\(\)/.test(PANE))
ok('대리점 화면으로 옮겨 간다', /onConverted\?\.\(report\.site_id\)/.test(PANE)
  && /onConverted=\{agencyId => \{ setListTab\('agency'\); openAgency\(agencyId\) \}\}/.test(HOME))

console.log(fail === 0 ? '\n전부 통과' : `\n${fail}건 실패`)
process.exit(fail === 0 ? 0 : 1)
