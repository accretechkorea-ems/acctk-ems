-- 메뉴 권한 판정 함수 has_menu_perm (2026-10-08 작성). **아직 DB 에 적용하지 않았다.**
-- 이 파일은 적용 대기 상태다 — 아래 「적용 순서」를 읽고 **한 문장씩 따로** 실행한다.
-- begin/commit 으로 묶지 않았다(Supabase SQL Editor 에서 문장 단위로 돌려도 순서만 지키면 같은 결과다).
--
-- 왜 새 함수인가
--   RLS 가 지금 쓰는 has_team_perm(perm) 은 메뉴 키를 판정하지 못한다. 그 함수는 teams.can_view_*
--   컬럼 여섯 개(customers·dashboard·quote·pipeline·sales_mgmt·admin)만 보고, 그 밖의 값이 오면
--   superadmin 말고는 전부 false 다(db_functions_snapshot.sql:25-45). 의뢰서는 그래서 메뉴 키 대신
--   'customers' 영역을 빌려 썼다(inquiries_schema.sql 의 inquiries_select 주석).
--
--   반도체 접촉 보고서(semi_*)는 계측 데이터와 완전히 갈라야 하므로 기존 영역을 빌릴 수 없다 —
--   'customers' 를 빌리면 반도체 팀에 계측 고객사·의뢰서까지 열린다. 그래서 팀 관리 화면이 저장하는
--   team_permissions(팀 × 메뉴 키) 행을 **직접** 보는 함수를 따로 둔다.
--
--   **has_team_perm 은 한 글자도 바꾸지 않는다.** 기존 정책이 모두 그 함수에 기대고 있다.
--   이 함수는 앞으로 다른 새 메뉴(계측 접촉 보고서 등)도 함께 쓰는 범용 함수다.
--
-- 판정 규칙 — has_team_perm 과 같은 길로 사용자를 찾는다
--   1. JWT 의 email → engineers.email (engineers.teams 는 팀 이름 문자열이다)
--   2. engineers.teams → teams.name → teams.id
--   3. team_permissions.team_id = teams.id 이고 perm_key = p_key 인 행이 있으면 true
--   · permission_level = 'superadmin' 이면 팀과 무관하게 true(has_team_perm 과 같다).
--   · engineers 에 없는 사용자, 팀이 비었거나 teams 에 없는 팀 이름, p_key 가 null → false.
--   · 퇴사자(resigned_date)는 보지 않는다 — has_team_perm 도 보지 않는다. 퇴사자는 Auth 계정을
--     지우거나 막는 것으로 처리한다(이 함수만 다르게 굴면 화면 판정과 RLS 가 어긋난다).
--
-- 화면 판정과의 관계
--   화면(lib/permissions.ts 의 canViewMenu)도 같은 team_permissions 를 읽는다(lib/teamPerms.ts,
--   lib/teamPermsServer.ts). 그래서 이 함수를 쓰면 「메뉴가 보이는 팀 = RLS 가 열리는 팀」이 한 자료로
--   맞춰진다. teams.can_view_* 파생(DERIVED_PERMS)을 거치지 않는다.
--
-- 확인하지 못한 가정 — 적용 전에 맨 아래 「적용 전 확인」 쿼리로 본다
--   · team_permissions 의 칸 이름이 team_id(→ teams.id) · perm_key 다.
--     근거: 코드가 그 이름으로 읽고 쓴다(lib/teamPerms.ts:17·33, app/api/team-permissions/route.ts:29-34).
--     표 DDL 은 레포에 없다.
--   · engineers.teams 는 팀 이름 한 개를 담은 문자열이다(has_team_perm 의 t.name = e.teams).
--
-- ── 적용 순서 ────────────────────────────────────────────────────────────────
--   이 파일을 **semi_contact_schema.sql 보다 먼저** 적용한다. 그 파일의 RLS 정책이 이 함수를 부르고,
--   정책을 만들 때 함수가 있어야 한다.
--   문장 1 → 2 → 3 → 4 순서로 한 문장씩.
--
-- ── 되돌리기 ─────────────────────────────────────────────────────────────────
--   **semi_contact_schema.sql 을 먼저 되돌린 뒤** 지운다(그 파일의 정책이 이 함수에 기댄다 —
--   정책이 남은 채로 drop 하면 의존 오류로 막힌다).
--   drop function if exists public.has_menu_perm(text);
--
-- 적용 후 확인 쿼리는 파일 맨 아래에 있다.


-- ════════════════════════════════════════════════════════════════════════════
-- 문장 1. 함수
--   language sql · stable — has_team_perm 과 같다. 한 문장 안에서 값이 바뀌지 않으므로
--   정책에서 (select public.has_menu_perm('...')) 로 감싸면 한 번만 평가된다.
--   security definer — engineers·teams·team_permissions 의 RLS 를 조여도 판정이 무너지지 않게
--   소유자(postgres) 권한으로 읽는다. 그래서 search_path 를 반드시 고정한다.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.has_menu_perm(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.engineers e
    left join public.teams t on t.name = e.teams
    where e.email = (auth.jwt() ->> 'email')
      and (
        e.permission_level = 'superadmin'
        or exists (
          select 1
          from public.team_permissions tp
          where tp.team_id = t.id
            and tp.perm_key = p_key
        )
      )
  );
$$;


-- ════════════════════════════════════════════════════════════════════════════
-- 문장 2. 설명
-- ════════════════════════════════════════════════════════════════════════════
comment on function public.has_menu_perm(text) is
  '로그인 사용자의 팀이 메뉴 권한(team_permissions.perm_key = p_key)을 가졌는지. superadmin 은 true. RLS 전용 범용 함수 — has_team_perm(teams.can_view_*)과 별개다.';


-- ════════════════════════════════════════════════════════════════════════════
-- 문장 3. 실행 권한 회수 — public(기본 부여)·anon
--   비로그인(anon)은 부를 일이 없다. 불러도 JWT 가 없어 false 지만, 열어 둘 이유가 없다.
-- ════════════════════════════════════════════════════════════════════════════
revoke execute on function public.has_menu_perm(text) from public, anon;


-- ════════════════════════════════════════════════════════════════════════════
-- 문장 4. 실행 권한 부여 — authenticated
--   RLS 정책은 조회하는 사람의 역할로 평가되므로 authenticated 가 EXECUTE 를 가져야 한다.
--   (service_role 은 RLS 를 건너뛰므로 이 함수를 부를 일이 없다. Supabase 기본 권한은 그대로 둔다.)
-- ════════════════════════════════════════════════════════════════════════════
grant execute on function public.has_menu_perm(text) to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- 적용 전 확인 (읽기 전용) — 위 「확인하지 못한 가정」
-- ════════════════════════════════════════════════════════════════════════════
-- team_permissions 칸 이름·타입 — team_id, perm_key 가 있어야 한다
-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'team_permissions'
-- order by ordinal_position;

-- team_permissions 의 제약(FK 대상이 teams.id 인지, perm_key 에 CHECK 가 있는지)
-- select conname, contype, pg_get_constraintdef(oid)
-- from pg_constraint
-- where conrelid = 'public.team_permissions'::regclass;

-- engineers.teams 가 문자열 한 칸인지(text/varchar, 배열 아님)
-- select column_name, data_type, udt_name
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'engineers' and column_name in ('teams', 'email', 'permission_level');

-- teams 이름에 없는 engineers.teams 값(있으면 그 사람은 팀 권한이 없는 것으로 판정된다)
-- select e.teams, count(*)
-- from public.engineers e
-- left join public.teams t on t.name = e.teams
-- where e.teams is not null and t.id is null
-- group by e.teams;


-- ════════════════════════════════════════════════════════════════════════════
-- 적용 후 확인 (읽기 전용)
-- ════════════════════════════════════════════════════════════════════════════
-- 함수 정의 — security definer · stable · search_path=public 이 보여야 한다
-- select pg_get_functiondef('public.has_menu_perm(text)'::regprocedure);

-- 속성 — prosecdef = true, provolatile = 's'
-- select p.proname, p.prosecdef, p.provolatile, p.proconfig
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'has_menu_perm';

-- 실행 권한 — authenticated = true, anon = false
-- select has_function_privilege('authenticated', 'public.has_menu_perm(text)', 'EXECUTE') as auth_exec,
--        has_function_privilege('anon',          'public.has_menu_perm(text)', 'EXECUTE') as anon_exec;

-- 팀별 판정 미리보기 — 함수를 부르지 않고 같은 조인으로 「어느 팀이 contact_semi 를 가졌나」를 본다
-- (SQL Editor 는 JWT 가 없어 함수를 불러도 false 만 나온다)
-- select t.name, exists (
--   select 1 from public.team_permissions tp where tp.team_id = t.id and tp.perm_key = 'contact_semi'
-- ) as has_contact_semi
-- from public.teams t
-- order by t.name;
