-- leads 테이블 RLS 정책
--
-- 적용일: 2026-09-02
--
-- 적용 전 상태 (pg_policies 조회로 확인)
--   leads_anon_insert   {anon}           INSERT   with_check true
--   leads_auth_select   {authenticated}  SELECT   using true
--   leads_auth_update   {authenticated}  UPDATE   using true / with_check true
--   DELETE 정책 없음(이미 막혀 있음), FOR ALL 정책 없음
--
-- 변경 사유
--   1) 조회 — 로그인만 하면 누구나 모든 리드를 읽을 수 있었다. 리드에는 고객사 담당자의
--      이름·이메일·휴대폰이 들어 있다. 운영 규칙("관리자는 전체, 담당자는 자기 배정 건만")대로 좁힌다.
--   2) 수정 — 로그인 사용자가 남의 리드를 그대로 고칠 수 있었다(실측 확인). 회수한다.
--      쓰기는 전부 service role 을 쓰는 API 라우트(/api/lead-manage, /api/lead-delete)가 한다.
--      service role 은 RLS 를 우회하므로 라우트 동작에는 영향이 없다.
--   3) INSERT — 공개 폼(/lead)은 /api/lead 라우트가 service role 로 insert 한다. 즉 anon 정책은
--      폼 동작에 쓰이지 않는다. 반면 anon 키는 브라우저에 노출되므로 정책이 열려 있으면 누구나
--      PostgREST 로 직접 행을 넣어 허니팟·화이트리스트·길이 제한·회의록 30자 검증을 전부 우회할 수 있다.
--      회수한다.
--
-- 적용 순서: 쓰기 4종의 API 라우트 이관이 끝난 뒤에 실행할 것(기능이 조용히 실패하는 구간을 없애려고).
-- 재실행에 안전하다 — 함수는 create or replace, 정책은 drop if exists 후 create.


-- ════════════════════════════════════════════════════════════════
-- [1단계] 적용
-- ════════════════════════════════════════════════════════════════

-- ── 로그인 사용자의 engineer_id 헬퍼 ──────────────────────────────
-- is_superadmin() 과 같은 방식이다(JWT 이메일 → engineers 매칭).
-- SECURITY INVOKER: engineers 의 조회 정책이 로그인 사용자 전체에 열려 있어 DEFINER 가 필요 없다.
-- 이메일이 engineers 에 없으면 NULL 을 돌려주고, NULL 비교는 항상 false 라 아무 행도 안 보인다.
create or replace function public.current_engineer_id()
returns integer
language sql
security invoker
stable
set search_path = public
as $$
  select e.engineer_id
  from public.engineers e
  where e.email = (auth.jwt() ->> 'email')
  limit 1;
$$;

grant execute on function public.current_engineer_id() to authenticated;


-- ── RLS 활성화 (이미 켜져 있어도 안전) ────────────────────────────
alter table public.leads enable row level security;


-- ── 기존 정책 제거 ────────────────────────────────────────────────
-- 정책은 PERMISSIVE 라 OR 로 합쳐진다. 예전 정책을 남겨 두면 새 정책으로 좁혀도 소용이 없다.
drop policy if exists "leads_anon_insert" on public.leads;
drop policy if exists "leads_auth_select" on public.leads;
drop policy if exists "leads_auth_update" on public.leads;


-- ── SELECT: 관리자는 전체, 그 밖에는 자기 배정 건만 ───────────────
-- assigned_to 가 NULL 인 배정 전 리드는 관리자에게만 보인다(NULL = 어떤 값과도 같지 않음).
create policy "leads_select_admin_or_assignee"
on public.leads for select to authenticated
using (
  public.is_superadmin()
  or assigned_to = public.current_engineer_id()
);


-- ── INSERT / UPDATE / DELETE: 정책을 만들지 않는다 ────────────────
-- 정책이 없으면 그 동작은 거부된다. 거부 정책을 따로 만들 필요가 없다.
--   INSERT — 공개 폼은 /api/lead 가 service role 로 넣는다.
--   UPDATE — 배정·상태·메모·전환은 /api/lead-manage 가 service role 로 처리한다.
--   DELETE — /api/lead-delete 가 service role 로 처리한다(적용 전에도 정책이 없었다).


-- ════════════════════════════════════════════════════════════════
-- [2단계] 적용 후 확인
-- ════════════════════════════════════════════════════════════════

-- ① 정책이 의도대로 남았는지 — leads_select_admin_or_assignee 한 줄만 나와야 한다
-- select policyname, roles, cmd, qual, with_check
-- from pg_policies
-- where schemaname = 'public' and tablename = 'leads'
-- order by cmd, policyname;

-- ② 헬퍼 함수가 도는지 (SQL 편집기는 service role 이라 두 값 모두 NULL/false 가 정상)
-- select public.is_superadmin() as is_admin, public.current_engineer_id() as my_engineer_id;

-- ③ 공개 폼(/lead) 등록이 되는지
--    브라우저에서 /lead 를 열어 한 건 제출한 뒤 아래로 확인한다.
--    (/api/lead 는 service role 이라 RLS 와 무관하게 동작해야 한다)
-- select lead_id, lead_no, partner_company, customer_company, created_at
-- from public.leads order by lead_id desc limit 5;

-- ④ 로그인 사용자 조회 범위 — 앱에서 확인
--    관리자 → 전체 / 배정받은 담당자 → 자기 건만 / 배정 없는 계정 → 0건(접근 차단 화면)

-- ⑤ anon 직접 INSERT 가 막혔는지 — 터미널에서. 401 또는 403 이면 정상이다.
--    curl -s -o /dev/null -w '%{http_code}\n' -X POST '<SUPABASE_URL>/rest/v1/leads' \
--      -H 'apikey: <ANON_KEY>' -H 'Authorization: Bearer <ANON_KEY>' \
--      -H 'Content-Type: application/json' -d '{"partner_company":"x"}'


-- ════════════════════════════════════════════════════════════════
-- [되돌리기] 문제가 생기면 이것을 실행 — 적용 전 세 정책을 원래 정의 그대로 복구한다
-- ════════════════════════════════════════════════════════════════
--
-- drop policy if exists "leads_select_admin_or_assignee" on public.leads;
--
-- create policy "leads_anon_insert"
-- on public.leads for insert to anon
-- with check (true);
--
-- create policy "leads_auth_select"
-- on public.leads for select to authenticated
-- using (true);
--
-- create policy "leads_auth_update"
-- on public.leads for update to authenticated
-- using (true)
-- with check (true);
--
-- -- 헬퍼 함수는 남겨 둬도 무해하다. 굳이 지우려면:
-- -- drop function if exists public.current_engineer_id();
