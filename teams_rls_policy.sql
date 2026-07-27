-- teams 테이블 RLS 정책
--
-- 적용일: 2026-07-27
-- 변경 사유:
--   기존 정책은 authenticated(로그인 사용자) 전체에게 SELECT/INSERT/UPDATE/DELETE 를
--   모두 허용(using(true))했다. teams 는 engineers.teams 가 문자열로 참조하는 기준
--   데이터이므로, 일반 팀원이 anon 키로 팀을 생성·수정·삭제하면 참조 무결성이 깨질 수
--   있었다(관리 UI는 superadmin/manager 로 제한하지만 UI 게이트일 뿐 RLS 는 열려 있었음).
--   → 조회는 로그인 사용자 전체에 유지하되, 쓰기(INSERT/UPDATE/DELETE)는 superadmin 만
--     가능하도록 강화한다.
--
-- 재실행에 안전하도록 함수는 create or replace, 정책은 drop 후 create (idempotent).

-- ── superadmin 판별 헬퍼 ──────────────────────────────────────────
-- 현재 로그인 사용자(JWT 이메일)가 engineers 에서 permission_level='superadmin' 인지 확인.
-- SECURITY INVOKER: engineers 의 조회 정책(engineers_select_authenticated)이 using(true)라
--   호출자 권한으로도 조회 가능하므로 DEFINER 가 필요 없다.
create or replace function public.is_superadmin()
returns boolean
language sql
security invoker
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.engineers e
    where e.email = (auth.jwt() ->> 'email')
      and e.permission_level = 'superadmin'
  );
$$;

grant execute on function public.is_superadmin() to authenticated;

-- ── RLS 활성화 ────────────────────────────────────────────────────
alter table public.teams enable row level security;

-- ── SELECT: 로그인 사용자 전체 ────────────────────────────────────
drop policy if exists "teams_select_authenticated" on public.teams;
drop policy if exists "teams authenticated select" on public.teams;
create policy "teams_select_authenticated"
on public.teams for select to authenticated
using (true);

-- ── INSERT: superadmin 만 ─────────────────────────────────────────
drop policy if exists "teams_insert_superadmin" on public.teams;
drop policy if exists "teams authenticated insert" on public.teams;
drop policy if exists "teams superadmin insert" on public.teams;
create policy "teams_insert_superadmin"
on public.teams for insert to authenticated
with check (public.is_superadmin());

-- ── UPDATE: superadmin 만 ─────────────────────────────────────────
drop policy if exists "teams_update_superadmin" on public.teams;
drop policy if exists "teams authenticated update" on public.teams;
drop policy if exists "teams superadmin update" on public.teams;
create policy "teams_update_superadmin"
on public.teams for update to authenticated
using (public.is_superadmin())
with check (public.is_superadmin());

-- ── DELETE: superadmin 만 ─────────────────────────────────────────
drop policy if exists "teams_delete_superadmin" on public.teams;
drop policy if exists "teams authenticated delete" on public.teams;
drop policy if exists "teams superadmin delete" on public.teams;
create policy "teams_delete_superadmin"
on public.teams for delete to authenticated
using (public.is_superadmin());
