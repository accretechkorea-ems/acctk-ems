-- ⚠ 정책을 갈아 끼우는 파일이다(drop policy → create policy). 두 번 돌리면 중간에
--   「정책이 없는 순간」이 생긴다 — 돌리기 전에 아래를 다 읽어라.
--
-- RLS 좁히기 묶음 2 (2026-10-08 작성). **적용 여부를 확인하지 못했다(2026-10-23).**
--   왜 — RLS 정책은 PostgREST 로 읽을 수 없다(pg_policies 가 노출돼 있지 않다).
--   이 파일이 만드는 함수 mark_log_restocked 는 DB 에 있지만 **그것은 증거가 아니다** —
--   같은 함수가 db_functions_snapshot.sql(2026-09-11)과 rls_backup_20261008.sql
--   (적용 직전 상태)에도 있어 이 파일보다 먼저 존재했다.
--   확인하려면 Supabase SQL Editor 에서 한 줄 읽으면 된다:
--     select tablename, policyname, cmd, qual from pg_policies
--      where schemaname='public' and tablename in ('price_list','download_logs','quote_sequence');
--   참고로 미로그인(anon) 은 어떤 표도 읽지 못한다(2026-10-23 확인 — 표 단위 권한부터 없다.
--   42501 permission denied). 그래서 지금 당장 새는 곳은 없다.
-- 적용 대기 상태로 둔다 — 아래 「적용 순서와 시험 메모」를 읽고 **한 문장씩 따로** 실행한다.
-- begin/commit 으로 묶지 않았다. 문장 하나를 실행하고, 그 문장의 시험을 하고, 다음으로 넘어간다.
--
-- 왜 하는가
--   반도체사업부 계정을 곧 만든다. 그 팀에는 접촉 보고서 메뉴(contact_semi)만 주므로 teams.can_view_* 가
--   모두 false 다. 그런데 아래 표·함수는 「로그인했는가」만 보거나 아예 검사가 없어, 그 계정도 계측의
--   견적 채번·원가·다운로드 기록을 읽거나 바꿀 수 있다. 조건을 has_team_perm(...)(계측 팀 권한)으로 좁힌다.
--   지금 계측 7개 팀은 모두 can_view_customers = true 라 customers 를 요구해도 계측 직원 화면은 그대로다.
--
-- 지키는 규칙
--   · 표의 GRANT 는 어느 표도 회수하지 않는다(B2-1 의 quote_sequence 쓰기 권한만 예외 — 아래 설명).
--     특히 price_list 는 견적 조회가 quote_items(…, price_list(model_jp)) 로 임베드한다. 정책으로 행이 걸러지면
--     그 칸이 null 로 오고 화면은 저장된 품명으로 넘어가지만, GRANT 를 회수하면 임베드한 조회 전체가
--     42501 로 실패해 홈 「내 견적」·고객사 상세 견적 목록이 통째로 깨진다.
--   · 같은 이름의 정책은 drop·create 하지 않고 `alter policy` 로 그 자리에서 바꾼다 — 바꾸는 사이에 빈틈이 없다.
--     alter policy 는 roles(to authenticated)·명령(for SELECT 등)은 그대로 두고 조건만 바꾼다.
--   · 함수는 (select …) 로 감싼다 — 행마다 다시 부르지 않고 문장마다 한 번만 평가된다(레포 관례).
--   · has_team_perm 은 superadmin 이면 true 다(db_functions_snapshot.sql:36). 관리자 화면은 영향이 없다.
--
-- 되돌리기
--   문장마다 바로 아래에 적었다. 원래 정책은 rls_backup_20261008.sql 의 DDL 을 그대로 옮겼다.
--   이미 같은 이름의 정책이 있으면 create policy 가 실패하므로, 되돌리기는 drop policy → 백업 DDL 두 줄이다.
--   두 줄 사이에는 정책이 없는 순간이 생긴다(그동안은 그 동작이 막힌다 — 열리지는 않는다). 이어서 바로 실행한다.
--
-- ── 적용 순서와 시험 메모 ────────────────────────────────────────────────────
--   · 점심처럼 사용자가 적은 시간에 한다. 문장 하나 → 그 문장의 「시험」 → 다음 문장.
--   · 시험이 이상하면 다음으로 가지 말고 **그 문장의 되돌리기**를 바로 실행한다.
--   · 시험은 계측 직원 계정(superadmin 이 아닌 사람)으로 한다. superadmin 은 모든 조건을 통과하므로 시험이 안 된다.
--   · 순서: B2-1 ①(읽기) → ② → ③ → ④ → ⑤ → B2-2 → B2-3 → B2-4 → B2-5
--     B2-1 의 순서가 중요하다 — RLS 를 켜기(④) 전에 본인 행 정책(②)이 있어야 견적 화면의 예상 번호가 0행이 되지 않는다.
--   · 이 파일 다음은 rls_tighten_batch3.sql 이다.
--
-- 적용 후 확인 쿼리와 「권한 없는 계정 시뮬레이션」은 파일 맨 아래에 있다.


-- ════════════════════════════════════════════════════════════════════════════
-- B2-1. quote_sequence — 본인 행만 읽고, 쓰기는 함수만
--
--   목적: 지금은 RLS 가 꺼져 있고 ALL true 정책까지 있어, 로그인한(RLS 가 꺼져 있으니 GRANT 만 있으면 anon 도)
--         누구나 견적 채번 카운터를 읽고 바꿀 수 있다. 본인 행 읽기만 남긴다.
--   영향 화면: 견적 작성(/quote)의 「예상 견적번호」 미리보기 — app/quote/page.tsx:270-273 이 로그인한 사람의
--             engineer_id 로 그날 자기 행만 읽는다. 견적 확정(create_quote)은 아래 이유로 영향이 없다.
--   create_quote 가 깨지지 않는 이유:
--     create_quote → next_quote_seq 로 번호를 받는다. next_quote_seq 는 SECURITY DEFINER 이고 소유자가 postgres 이며,
--     quote_sequence 의 FORCE ROW LEVEL SECURITY 는 꺼져 있다. 표 소유자 권한으로 도는 함수에는 RLS 가 걸리지 않고,
--     ⑤ 에서 거두는 GRANT 도 authenticated·anon 의 것이라 함수(postgres)와 무관하다.
--
--   가정 — 본인 칸 이름은 engineer_id 다.
--     근거: quote_schema_snapshot.sql:39-40 의 고유 인덱스 (date_str, engineer_id),
--           app/quote/page.tsx:272 의 .eq('engineer_id', engineer.engineer_id),
--           create_quote 의 next_quote_seq(p_date, v_me) — v_me 가 current_engineer_id() 다(같은 사람).
--     ② 를 실행하기 전에 ① 로 확인한다. 칸 이름이 다르면 ② 의 engineer_id 를 그 이름으로 고친다.
-- ════════════════════════════════════════════════════════════════════════════

-- B2-1 ① (읽기 전용 — 사용자가 실행) 칸 이름·타입 확인. engineer_id(integer)와 date_str·seq 가 보여야 한다.
-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'quote_sequence'
-- order by ordinal_position;
--
-- (함께 확인) RLS 꺼짐·FORCE 꺼짐·소유자 postgres, next_quote_seq 소유자 postgres·definer
-- select c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) as owner
-- from pg_class c where c.oid = 'public.quote_sequence'::regclass;
-- select pg_get_userbyid(p.proowner) as owner, p.prosecdef
-- from pg_proc p where p.oid = 'public.next_quote_seq(text, integer)'::regprocedure;

-- B2-1 ② 본인 행 SELECT 정책. RLS 가 아직 꺼져 있어 이 문장만으로는 아무것도 바뀌지 않는다.
--   시험: 없음(④ 뒤에 한다).
--   되돌리기: drop policy if exists quote_sequence_select_own on public.quote_sequence;
create policy quote_sequence_select_own on public.quote_sequence
  as permissive for select to authenticated
  using (engineer_id = (select public.current_engineer_id()));

-- B2-1 ③ 옛 전면 허용 정책 삭제. RLS 가 아직 꺼져 있어 이 문장만으로는 아무것도 바뀌지 않는다.
--   시험: 없음(④ 뒤에 한다).
--   되돌리기(백업 DDL):
--     create policy authenticated_only on public.quote_sequence as PERMISSIVE for ALL to authenticated using (true) with check (true);
drop policy if exists authenticated_only on public.quote_sequence;

-- B2-1 ④ RLS 켜기. 이제부터 authenticated 는 ② 의 본인 행만 읽는다.
--   시험: 계측 직원으로 /quote 를 연다 → 「예상 견적번호」가 오늘 자기 다음 번호로 보인다(오늘 이미 쓴 견적이 있으면 B·C…).
--         견적을 하나 확정한다 → 번호가 정상 발급되고, 미리보기가 다음 번호로 넘어간다.
--         (시험 견적은 확정 뒤 평소 방식대로 지운다.)
--   되돌리기: alter table public.quote_sequence disable row level security;
alter table public.quote_sequence enable row level security;

-- B2-1 ⑤ 쓰기 계열 GRANT 회수 — 이 파일에서 GRANT 를 거두는 유일한 곳이다.
--   select 는 남긴다(미리보기). 쓰기는 next_quote_seq(definer, postgres) 만 하므로 authenticated·anon 은 필요 없다.
--   RLS 와 겹치는 이중 잠금이다 — 나중에 누가 쓰기 정책을 잘못 더해도 쓰지 못한다.
--   시험: ④ 와 같다(미리보기·확정 발급).
--   되돌리기: grant insert, update, delete, truncate, references, trigger on public.quote_sequence to authenticated, anon;
revoke insert, update, delete, truncate, references, trigger on public.quote_sequence from authenticated, anon;


-- ════════════════════════════════════════════════════════════════════════════
-- B2-2. next_quote_seq — 브라우저에서 직접 부르지 못하게
--
--   목적: 지금은 로그인한 누구나 rpc('next_quote_seq', { p_date, p_engineer_id }) 로 아무 직원의 카운터를 올리고
--         그 값을 읽을 수 있다(직원별 견적 수 노출 + 채번 오염). 권한 검사가 함수 안에 없다.
--   영향 화면: 없음. 브라우저가 이 함수를 rpc 로 부르는 곳이 없고(전체 rpc 호출 확인), 유일한 호출자인
--             create_quote 는 SECURITY DEFINER 라 함수 소유자(postgres) 권한으로 next_quote_seq 를 부른다.
--             EXECUTE 검사는 그 시점의 사용자(postgres) 기준이라 authenticated 에서 거둬도 견적 발급은 그대로다.
--   시험: 계측 직원으로 견적 하나를 확정 → 번호가 정상 발급된다.
--   되돌리기: grant execute on function public.next_quote_seq(text, integer) to authenticated;
--   ※ anon·public 에도 실행 권한이 남아 있을 수 있다(적용 후 확인 쿼리로 본다). 이 파일은 지시받은 authenticated 만 거둔다.
-- ════════════════════════════════════════════════════════════════════════════
revoke execute on function public.next_quote_seq(text, integer) from authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- B2-3. mark_log_restocked — 재고 권한이 있는 사람만
--
--   목적: 지금은 로그인한 누구나 아무 log_id 의 재고 기록을 「재입고 처리됨」으로 바꿀 수 있다(검사 없음).
--         시작에서 has_team_perm('sales_mgmt') 를 보고, 통과하면 기존과 똑같은 update 를 한다.
--   영향 화면: 재고(/inventory)의 재입고 처리 — app/inventory/page.tsx:335 한 곳. inventory 메뉴는 sales_mgmt 영역을
--             파생하므로(lib/menuPerms.ts 의 DERIVED_PERMS) 그 화면에 들어오는 사람은 통과한다. 서버 쪽 호출은 없다.
--   바뀌지 않는 것: 시그니처(p_log_id integer)·반환(void)·SECURITY DEFINER·search_path. create or replace 는
--                  기존 EXECUTE 권한을 그대로 둔다. 언어만 sql → plpgsql(if 를 쓰려고).
--   시험: 재고 담당 계측 직원으로 /inventory 에서 재입고 처리 하나 → 성공하고 그 기록에 재입고 표시가 붙는다.
--   되돌리기(백업의 원래 정의):
--     CREATE OR REPLACE FUNCTION public.mark_log_restocked(p_log_id integer)
--      RETURNS void
--      LANGUAGE sql
--      SECURITY DEFINER
--      SET search_path TO 'public'
--     AS $function$
--       update public.inventory_logs set is_restocked = true where log_id = p_log_id;
--     $function$;
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.mark_log_restocked(p_log_id integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.has_team_perm('sales_mgmt') then
    raise exception '권한이 없습니다';
  end if;
  update public.inventory_logs set is_restocked = true where log_id = p_log_id;
end;
$function$;


-- ════════════════════════════════════════════════════════════════════════════
-- B2-4. price_list — 견적·고객사 권한이 있는 팀만
--
--   목적: 가격표(원가 cost_jpy 포함)를 로그인한 누구나 읽는다. 계측 견적·고객사 권한으로 좁힌다.
--   영향 화면:
--     · 견적 작성(/quote) 품목 검색 — app/quote/page.tsx:1141. 유일한 직접 조회. quote 메뉴 → quote 영역 → 통과.
--     · 홈 「내 견적」(components/dashboard/MyQuotesPanel.tsx:211)·고객사 상세 견적(hooks/customer/useCustomerDetail.ts:16)·
--       실적 현황(app/sales/page.tsx:1394)의 price_list(model_jp) 임베드 — 계측 팀은 모두 customers 라 그대로다.
--       권한이 없는 사람에게는 모델명이 null 로 와서 저장된 품명이 대신 보인다(깨지지 않음).
--     · 다시쓰기(/api/quote-duplicate)는 service role 이라 무관하다.
--   GRANT 는 바꾸지 않는다(위 「지키는 규칙」).
--   ※ upload_price_list.js 는 anon 키로 price_list 를 지우고 넣는다. 이 문장은 select 정책만 바꾸므로 그 스크립트의
--     쓰기에는 영향이 없지만, 그 스크립트가 지금 동작한다는 것 자체가 다른 쓰기 정책이 열려 있다는 뜻일 수 있다
--     (적용 후 확인 쿼리의 「price_list 전체 정책」으로 본다).
--   시험: 계측 직원으로 /quote 품목 검색 → 결과가 나온다. 홈 「내 견적」 품목 이름이 그대로 보인다.
--   되돌리기:
--     drop policy if exists price_list_select_authenticated on public.price_list;
--     create policy price_list_select_authenticated on public.price_list as PERMISSIVE for SELECT to authenticated using (true);
-- ════════════════════════════════════════════════════════════════════════════
alter policy price_list_select_authenticated on public.price_list
  using ((select public.has_team_perm('quote')) or (select public.has_team_perm('customers')));


-- ════════════════════════════════════════════════════════════════════════════
-- B2-5. download_logs — 읽기는 관리 권한만
--
--   목적: 다운로드 기록(견적번호·고객사명·직원)을 로그인한 누구나 읽는다. 읽는 화면은 관리 화면 하나뿐이다.
--   영향 화면: 관리(/admin)의 다운로드 기록 조회 — app/admin/page.tsx:278-283. admin 메뉴 → admin 영역 → 통과.
--   insert 정책은 건드리지 않는다 — 홈·전자결재 검토표처럼 메뉴 권한이 없는 화면에서도 PDF·엑셀 기록을 남긴다
--   (lib/openQuotePdf.tsx:51-60, components/quote/QuoteExcelButton.tsx:62-70). 좁히면 기록만 조용히 사라진다.
--   시험: admin 메뉴가 있는 계측 직원으로 /admin 다운로드 기록 「조회하기」 → 최근 7일 기록이 보인다.
--         아무 견적 PDF 를 열어 본 뒤 다시 조회 → 그 기록이 늘어난다(insert 가 그대로인지).
--   되돌리기:
--     drop policy if exists download_logs_select on public.download_logs;
--     create policy download_logs_select on public.download_logs as PERMISSIVE for SELECT to authenticated using ((( SELECT current_engineer_id() AS current_engineer_id) IS NOT NULL));
-- ════════════════════════════════════════════════════════════════════════════
alter policy download_logs_select on public.download_logs
  using ((select public.has_team_perm('admin')));


-- ════════════════════════════════════════════════════════════════════════════
-- 적용 후 확인 (읽기 전용)
-- ════════════════════════════════════════════════════════════════════════════
-- 바꾼 정책의 조건 — 기대: quote_sequence_select_own(SELECT, engineer_id = …), authenticated_only 없음,
--   price_list_select_authenticated 에 has_team_perm('quote') or has_team_perm('customers'),
--   download_logs_select 에 has_team_perm('admin'), download_logs 의 insert 정책은 그대로
-- select tablename, policyname, permissive, cmd, roles, qual, with_check
-- from pg_policies
-- where schemaname = 'public' and tablename in ('quote_sequence', 'price_list', 'download_logs')
-- order by tablename, cmd, policyname;

-- 표별 정책 수 — 기대: quote_sequence 1, price_list·download_logs 는 적용 전과 같은 수
-- select tablename, count(*) as n_policies
-- from pg_policies
-- where schemaname = 'public' and tablename in ('quote_sequence', 'price_list', 'download_logs')
-- group by tablename order by tablename;

-- quote_sequence RLS — 기대: relrowsecurity = true, relforcerowsecurity = false
-- select relrowsecurity, relforcerowsecurity from pg_class where oid = 'public.quote_sequence'::regclass;

-- quote_sequence GRANT — 기대: authenticated·anon 은 SELECT 만
-- select grantee, string_agg(privilege_type, ',' order by privilege_type) as privs
-- from information_schema.role_table_grants
-- where table_schema = 'public' and table_name = 'quote_sequence' and grantee in ('anon', 'authenticated')
-- group by grantee;

-- 함수 — 기대: next_quote_seq auth_exec = false. mark_log_restocked 는 plpgsql·definer, 본문에 has_team_perm
-- select p.proname, p.prosecdef, l.lanname,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
--        has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec
-- from pg_proc p join pg_language l on l.oid = p.prolang
-- where p.oid in ('public.next_quote_seq(text, integer)'::regprocedure, 'public.mark_log_restocked(integer)'::regprocedure);
-- select pg_get_functiondef('public.mark_log_restocked(integer)'::regprocedure);

-- price_list 전체 정책(쓰기 정책이 열려 있는지 — upload_price_list.js 가 anon 키로 쓴다)
-- select policyname, cmd, roles, qual, with_check from pg_policies
-- where schemaname = 'public' and tablename = 'price_list' order by cmd, policyname;


-- ════════════════════════════════════════════════════════════════════════════
-- 권한 없는 계정 시뮬레이션 (반도체 계정이 생긴 뒤에 쓴다)
--   SQL Editor 에서 그 계정인 것처럼 돌려 본다. begin … rollback 이라 아무것도 남지 않는다.
--   <테스트 계정 이메일> 을 반도체 계정 이메일로 바꾼다. has_team_perm·current_engineer_id 는 JWT 의 email 을 본다.
--   기대 결과는 줄마다 적었다. 한 문장이 오류로 끝나면 그 뒤는 실행되지 않으므로, 「거부」를 기대하는 문장은
--   각각 따로 begin … rollback 으로 돌린다.
-- ════════════════════════════════════════════════════════════════════════════
-- begin;
-- set local role authenticated;
-- select set_config('request.jwt.claims',
--   json_build_object('sub', '00000000-0000-0000-0000-000000000000',
--                     'email', '<테스트 계정 이메일>', 'role', 'authenticated')::text, true);
-- select public.has_team_perm('quote') as quote, public.has_team_perm('customers') as customers,
--        public.has_team_perm('admin') as admin, public.has_team_perm('sales_mgmt') as sales_mgmt;  -- 기대: 모두 false
-- select count(*) from public.quote_sequence;   -- 기대: 0 (그 계정은 견적을 쓴 적이 없다)
-- select count(*) from public.price_list;       -- 기대: 0
-- select count(*) from public.download_logs;    -- 기대: 0
-- rollback;
--
-- begin;
-- set local role authenticated;
-- select set_config('request.jwt.claims',
--   json_build_object('sub', '00000000-0000-0000-0000-000000000000',
--                     'email', '<테스트 계정 이메일>', 'role', 'authenticated')::text, true);
-- insert into public.quote_sequence (date_str, engineer_id, seq) values ('99991231', 0, 1);  -- 기대: permission denied
-- rollback;
--
-- begin;
-- set local role authenticated;
-- select set_config('request.jwt.claims',
--   json_build_object('sub', '00000000-0000-0000-0000-000000000000',
--                     'email', '<테스트 계정 이메일>', 'role', 'authenticated')::text, true);
-- select public.next_quote_seq('99991231', 0);  -- 기대: permission denied for function
-- rollback;
--
-- begin;
-- set local role authenticated;
-- select set_config('request.jwt.claims',
--   json_build_object('sub', '00000000-0000-0000-0000-000000000000',
--                     'email', '<테스트 계정 이메일>', 'role', 'authenticated')::text, true);
-- select public.mark_log_restocked(-1);  -- 기대: 오류 「권한이 없습니다」
-- rollback;
