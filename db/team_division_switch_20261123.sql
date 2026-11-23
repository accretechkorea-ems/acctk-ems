-- 사업부 전환 권한을 **팀 속성**으로 (2026-11-23)
--
-- 지금까지 계측 ↔ 반도체 전환은 **사람에게** 붙어 있었다(engineers.can_switch_division).
-- 켜 줄 화면이 없어 SQL 로만 넣었고, 그래서 두 사람(이상철·권재원)만 가진 채 굳어 있었다.
-- 앞으로는 **팀**이 가진다 — 팀 관리 모달에서 체크 하나로 켜고 끈다.
--
-- 왜 팀인가
--   · 권한은 이미 전부 팀이 가진다(team_permissions · teams.can_view_* · teams.division).
--     전환만 사람에게 붙어 있으면 켜 주는 자리가 두 군데가 된다.
--   · 사람이 들어오고 나가도 팀은 남는다. 인수인계에서 빠뜨리지 않는다.
--
-- ⚠ 이 파일을 돌리기 전에는 **아무도** 사업부를 바꿀 수 없다(칸이 없으면 로더가 false 로 읽는다).
--    돌린 뒤에는 ③의 두 팀이 종전처럼 바꿀 수 있다.
--
-- 재실행 안전 — add column if not exists · update 는 같은 값을 다시 쓴다.

-- ── ① 칸 ──────────────────────────────────────────────────────────────────
alter table public.teams
  add column if not exists can_switch_division boolean not null default false;

comment on column public.teams.can_switch_division is
  '사업부 전환 가능 — 이 팀 사람은 사이드바에서 계측/반도체를 고르고, 어느 사업부에 있든 관리·실적 메뉴를 본다(lib/division.ts canSwitchDivision).';

-- ── ② 지금 쓰는 사람이 끊기지 않게 ────────────────────────────────────────
-- 지금 전환 권한을 가진 **재직자**가 속한 팀을 켠다. 2026-11-23 기준 두 팀이다 —
--   임원(이상철) · 80CS(권재원).
-- 이름을 박지 않고 지금 값에서 뽑는다 — 그 사이에 바뀌었어도 끊기지 않게.
update public.teams t
   set can_switch_division = true
 where exists (
   select 1 from public.engineers e
    where e.teams = t.name
      and e.can_switch_division = true
      and e.resigned_date is null
 );

-- 확인용(읽기만) — 켜진 팀을 보고 싶으면:
--   select name, division, can_switch_division from public.teams order by display_order;

notify pgrst, 'reload schema';


-- ══════════════════════════════════════════════════════════════════════════
--  여기부터는 **라우트 배포 후 실행**
-- ══════════════════════════════════════════════════════════════════════════
-- 아래 두 줄은 위와 **같이 돌리면 안 된다.** 팀 추가·삭제가 서버 라우트(/api/team)로
-- 옮겨간 코드가 배포된 **뒤에** 돌린다. 먼저 돌리면 배포 전까지 팀 추가가 막힌다.
--
-- 왜 — 오늘 팀 추가에서 「permission denied for table teams」가 났고, 급한 대로
-- authenticated 에게 표 권한을 열어 두었다. 쓰기가 service role 라우트로 옮겨갔으니
-- 브라우저 열쇠(anon/authenticated)는 더 이상 teams 에 쓸 일이 없다.
-- (RLS 정책 자체는 teams_rls_policy.sql 이 이미 superadmin 으로 조여 두었다 —
--  이것은 그 앞단의 **표 권한**을 되돌리는 일이다.)
--
--   revoke insert, delete on table public.teams from authenticated;
--
-- UPDATE 도 더는 브라우저에서 쓰지 않는다(「실적 집계 대상」 저장이 라우트로 갔다).
-- 같이 걷고 싶으면 이 줄도 함께 — 걷어도 조회(select)는 그대로다.
--
--   revoke update on table public.teams from authenticated;


-- ══════════════════════════════════════════════════════════════════════════
--  engineers.can_switch_division — **이번에는 지우지 않는다**
-- ══════════════════════════════════════════════════════════════════════════
-- 코드는 이제 이 칸을 읽지 않는다(어느 조회의 열 목록에도 없다). 값은 ②가 팀으로 옮겨
-- 담았으니 남아 있어도 아무 일을 하지 않는다. 한참 지나 아무도 찾지 않으면 지운다 —
-- 지금 지우면 ②를 다시 돌릴 수 없다(어느 팀이었는지가 이 칸에만 있다).
--
--   alter table public.engineers drop column can_switch_division;
