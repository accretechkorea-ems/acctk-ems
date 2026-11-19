-- db/activity_types_rls.sql
--
-- `public.activity_types` 의 **쓰기 정책과 GRANT**. 관리 화면(「영업활동 종류 관리」)이
-- 돌아가려면 이 파일이 필요하다.
--
-- ── 왜 따로 있나 ──────────────────────────────────────────────────────────
--   db/crm_cleanup_20261118.sql ⑥ 은 표를 만들고 **읽기 정책 하나만** 걸었다
--   (`activity_types_read`). 쓰기 정책은 「quote_categories 의 superadmin 정책을 그대로
--   옮긴다」고 주석으로만 적어 두었고, 그래서 실제로는 아무 쓰기 정책도 없다.
--   RLS 가 켜진 표에 정책이 없으면 **superadmin 도 막힌다**(42501) — 2026-11-19 확인.
--
-- ── 무엇을 하나 ───────────────────────────────────────────────────────────
--   조회: 로그인 사용자 전체(기존 `activity_types_read` 를 역할 지정된 것으로 갈아탄다).
--   쓰기: superadmin 만(추가·이름 변경·활성·삭제). 종류는 sales_activities 가 이름으로
--         참조하는 기준 자료라,
--         일반 사용자가 anon 키로 고치면 참조 무결성과 과거 집계가 함께 깨진다.
--
--   모양은 quote_category_template_schema.sql:188-224 를 그대로 따른다.
--   ※ 함수를 (select …) 로 감싼다 — 줄마다 다시 부르지 않고 문장마다 한 번만 평가된다
--     (레포 관례: rls_tighten_batch2.sql:18).
--
-- 재실행 안전(drop policy if exists). 적용 뒤 /admin 의 「영업활동 종류 관리」에서
-- 종류 하나를 더해 보면 확인된다 — 막히면 42501 을 한글로 알린다(lib/activityTypes.ts).

alter table public.activity_types enable row level security;

-- 적용본의 읽기 정책은 역할을 지정하지 않았다(모든 역할 대상). 로그인 사용자용으로 바꾼다.
drop policy if exists "activity_types_read" on public.activity_types;

drop policy if exists "activity_types_select_authenticated" on public.activity_types;
create policy "activity_types_select_authenticated"
on public.activity_types for select to authenticated
using (true);

drop policy if exists "activity_types_insert_superadmin" on public.activity_types;
create policy "activity_types_insert_superadmin"
on public.activity_types for insert to authenticated
with check ((select public.is_superadmin()));

drop policy if exists "activity_types_update_superadmin" on public.activity_types;
create policy "activity_types_update_superadmin"
on public.activity_types for update to authenticated
using ((select public.is_superadmin()))
with check ((select public.is_superadmin()));

-- 삭제 — **superadmin 만**. 쓰는 활동이 있으면 FK 가 막는다(23503), 그래서 지워지는 것은
-- 아무 활동도 쓰지 않는 종류뿐이다(잘못 만든 종류를 되돌리는 길). 관리 화면도 쓰임새를
-- 세어 0건일 때만 버튼을 낸다 — 이 정책은 그 뒤의 마지막 문턱이다.
--   ※ 2026-11-19 에 **나중에 더했다.** 이 파일을 먼저 돌린 뒤라면 다시 한 번 돌린다
--     (전부 drop … if exists 라 재실행에 안전하다).
drop policy if exists "activity_types_delete_superadmin" on public.activity_types;
create policy "activity_types_delete_superadmin"
on public.activity_types for delete to authenticated
using ((select public.is_superadmin()));

grant select on public.activity_types to authenticated;
grant insert, update, delete on public.activity_types to authenticated;
-- ↑ 쓰기 GRANT 를 주는 이유: 관리 화면이 anon 키(authenticated 역할)로 고친다. 실제 통제는
--   위 정책(superadmin 만)이 한다. GRANT 를 빼면 superadmin 도 42501 로 막힌다.

-- 확인 — 정책 4개(select·insert·update·delete)가 나와야 한다.
select policyname, cmd, roles
from pg_policies
where schemaname = 'public' and tablename = 'activity_types'
order by cmd, policyname;

-- 확인 — 읽기는 지금도 되어야 한다(5줄).
select code, label, is_active, is_system, is_remote
from public.activity_types order by sort_order;
