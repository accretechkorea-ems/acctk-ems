-- 관리자 행위 기록표 — **누가 무엇을 바꿨나** (2026-11-27 야간3 4)
--
-- ── 왜 필요한가 ─────────────────────────────────────────────────────────────
--   비밀번호를 초기화하고, 역할을 바꾸고, 지운 줄을 되살리는 일은 **되돌아볼 수 있어야**
--   한다. 지금은 그 자국이 서버 콘솔 한 줄뿐이라, 배포본에서는 며칠 지나면 사라진다.
--   고객 사건(customer_events)과 **다른 표**다 — 그쪽은 「이 사업장에 무슨 일이」이고
--   이쪽은 「시스템을 누가 어떻게 만졌나」다. 섞으면 고객 이력이 관리 로그로 덮인다.
--
-- ── 무엇을 적는가 (지금 있는 것만) ─────────────────────────────────────────
--   password_reset       비밀번호 초기화 — ⚠ **값은 절대 적지 않는다**(누구에게, 언제만)
--   engineer_updated     역할·팀·직책·집계 대상 플래그 변경
--   division_switched    사업부 전환 플래그 변경
--   customer_restored    소프트 삭제 복구
--   team_created/deleted 팀 추가·삭제
--   quote_revived        미수주 → 견적중 되돌리기
--
-- ── 화면은 만들지 않는다 ───────────────────────────────────────────────────
--   관리 화면 리뉴얼 때 붙인다(2026-11-27 지시 4-3). 지금은 쌓아 두기만 한다.
--
-- 재실행 안전(if not exists · drop policy if exists). 끝에 notify 가 있다.

create table if not exists public.admin_events (
  id                 bigserial primary key,
  -- 누가. 서버 라우트가 세션에서 박는다(본문 값을 쓰지 않는다).
  actor_engineer_id  integer references public.engineers(engineer_id) on delete set null,
  -- 무엇을. 위 머리말의 낱말 그대로(코드가 정본이다 — lib/adminEvents.ts).
  action             text not null,
  -- 누구/무엇에게. 'engineer' · 'customer' · 'quote' · 'team' …
  target_type        text,
  -- 그 대상의 id. 표마다 타입이 달라(정수·uuid·팀 이름) **글자**로 둔다.
  target_id          text,
  -- 자세한 것. 바뀐 칸·이유 따위. ⚠ **비밀번호·토큰은 넣지 않는다.**
  detail             jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

comment on table public.admin_events is
  '관리자 행위 기록 — 누가 무엇을 바꿨나. 비밀번호 값은 절대 담지 않는다(2026-11-27).';

-- 최근 것부터 보는 표라 그 차례로 인덱스를 둔다.
create index if not exists admin_events_created_idx on public.admin_events (created_at desc);
create index if not exists admin_events_actor_idx   on public.admin_events (actor_engineer_id, created_at desc);
create index if not exists admin_events_action_idx  on public.admin_events (action, created_at desc);

-- ── RLS — **슈퍼관리자만 읽는다. 쓰기는 service role 만.** ─────────────────
--
-- 쓰기 정책을 **아예 만들지 않는다**. RLS 가 켜진 표에 정책이 없으면 그 동작은 막힌다 —
-- service role 은 RLS 를 지나가므로 서버 라우트만 쓸 수 있다. 「관리자도 못 고치는
-- 기록」이라야 기록으로 쓸 수 있다.
alter table public.admin_events enable row level security;

drop policy if exists admin_events_select on public.admin_events;
create policy admin_events_select on public.admin_events
  for select to authenticated
  using (
    exists (
      select 1 from public.engineers e
      where e.email = auth.jwt() ->> 'email'
        and e.permission_level = 'superadmin'
    )
  );

-- authenticated 에는 **읽기만** 내려 준다(쓰기 권한 자체가 없어야 정책 실수에도 안전하다).
grant select on table public.admin_events to authenticated;
revoke insert, update, delete on table public.admin_events from authenticated;
grant usage, select on sequence public.admin_events_id_seq to authenticated;

notify pgrst, 'reload schema';
