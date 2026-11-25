-- 할 일 — 홈 「내 오늘」이 보는 한 줄짜리 메모 (2026-11-26)
--
-- ── 왜 ───────────────────────────────────────────────────────────────────
-- 「이 건은 목요일에 전화」 같은 약속이 지금은 사람 머리와 수첩에만 있다. 포캐스트 단계도,
-- 견적 상태도 그것을 적어 두는 자리가 아니다. 그래서 홈이 아침에 「오늘 무엇을 하나」를
-- 말해 주지 못했다. 이 표가 그 자리다 — 제목 한 줄 · 기한 · 무엇에 딸린 일인지.
--
-- ── 손으로 적는 줄만 담는다 ──────────────────────────────────────────────
-- 홈의 할 일 목록에는 **자동 줄**도 섞여 보인다(견적 유효기간 만료 · 미배정 리드 · 결재
-- 대기 · 설치 예정 장비 · 실주 사유 미입력). 그 줄은 **이 표에 쓰지 않는다** — 조회할 때
-- 합성한다(lib/tasks.ts 의 synthRows). 이유가 둘이다.
--   ① 원본이 바뀌면 줄도 바뀌어야 한다. 발주가 나면 「유효기간 만료」 줄은 그 자리에서
--      사라져야 하는데, 표에 박아 두면 지우는 일을 또 누군가 해야 한다.
--   ② 지우는 일을 놓치면 **없는 일이 남는다**. 할 일 목록은 믿을 수 있어야 쓴다.
-- kind 에 'quote_expiry' 따위를 남겨 둔 것은 **손으로 만든 줄을 그 종류로 분류**할 수
-- 있게 둔 것이다(예: 만료 건을 보고 「재견적 회신」 할 일을 그 종류로 적어 둘 때).
--
-- ── 누가 보나 ────────────────────────────────────────────────────────────
-- 내 것만 본다(engineer_id). admin 이상은 전부 본다 — 팀의 일이 비어 있는지 보려면
-- 필요하다. 쓰기는 **라우트(service role)** 가 한다. 아래 정책은 이중 잠금이다.
--
-- 재실행 안전 — create table if not exists · do $$ 로 제약 · drop policy if exists.

create table if not exists public.tasks (
  task_id       serial primary key,

  title         text not null,
  -- 기한(날짜만). 비워 둘 수 있다 — 「언젠가」도 할 일이다. 비면 목록의 '이후' 에 붙는다.
  due_date      date,
  -- 끝낸 시각. null 이면 아직 할 일이다(지우지 않고 이 칸을 찍는다 — 한 일도 기록이다).
  done_at       timestamptz,

  -- 누구의 일인가. 보통 만든 사람과 같지만, 남에게 적어 줄 수 있어 둘을 갈라 둔다.
  engineer_id   integer not null references public.engineers(engineer_id),
  created_by    integer references public.engineers(engineer_id),

  -- 무슨 종류의 일인가 — 목록의 태그가 이 값으로 정해진다.
  kind          text not null default 'manual',

  -- 무엇에 딸린 일인가(둘 다 비워 둘 수 있다). 표 이름을 글자로 적는다 — FK 를 걸면
  -- 대상이 다섯 표라 칸이 다섯 개가 된다(그 줄이 지워질 때 연쇄 규칙도 제각각이다).
  -- 지워진 대상을 가리키는 줄은 목록에서 **제목만** 보여 준다(링크를 걸지 않는다).
  ref_type      text,
  ref_id        bigint,

  memo          text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.tasks is
  '할 일. 홈 「내 오늘」이 본다. 자동 줄(견적 만료·리드·결재…)은 여기 쓰지 않고 조회 때 합성한다 — lib/tasks.ts.';
comment on column public.tasks.kind is
  'manual · quote_expiry · lead · forecast · approval · service. 목록 태그가 이 값으로 정해진다.';
comment on column public.tasks.ref_type is
  'forecast · quote · lead · customer · device. ref_id 와 짝이다(FK 를 걸지 않는다 — 대상이 다섯 표다).';
comment on column public.tasks.done_at is '끝낸 시각. 지우지 않고 이 칸을 찍는다 — 한 일도 기록이다.';

-- ── 값 검사 — 화면을 우회한 값이 들어오지 않게 ───────────────────────────
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_kind_chk') then
    alter table public.tasks add constraint tasks_kind_chk
      check (kind in ('manual', 'quote_expiry', 'lead', 'forecast', 'approval', 'service'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_ref_type_chk') then
    alter table public.tasks add constraint tasks_ref_type_chk
      check (ref_type is null or ref_type in ('forecast', 'quote', 'lead', 'customer', 'device'));
  end if;
  -- 제목이 공백뿐인 줄은 목록에서 빈 줄로 보인다.
  if not exists (select 1 from pg_constraint where conname = 'tasks_title_chk') then
    alter table public.tasks add constraint tasks_title_chk
      check (btrim(title) <> '');
  end if;
end $$;

-- ── 인덱스 ───────────────────────────────────────────────────────────────
-- 홈이 읽는 길 하나 — 「내 것 중 아직 안 끝낸 것, 기한 순」.
create index if not exists tasks_mine_open_idx
  on public.tasks (engineer_id, due_date)
  where done_at is null;
-- 대상에서 되짚는 길(포캐스트 카드·견적 상세가 「이 건에 걸린 할 일」을 센다).
create index if not exists tasks_ref_idx
  on public.tasks (ref_type, ref_id)
  where ref_type is not null;

-- ── RLS ──────────────────────────────────────────────────────────────────
alter table public.tasks enable row level security;

-- 내 일, 또는 내가 적어 준 일. admin 이상은 전부 본다.
-- auth 함수는 (select …) 로 감싸 **한 번만** 부르게 한다(initplan).
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select to authenticated
  using (
    exists (
      select 1 from public.engineers me
       where me.email = (select auth.jwt() ->> 'email')
         and (me.engineer_id = tasks.engineer_id
           or me.engineer_id = tasks.created_by
           or me.permission_level in ('admin', 'superadmin'))
    )
  );

-- 담기 — **내가 만든 것으로만** 담는다(남의 이름으로 적을 수 없다. 받는 사람은 남이어도 된다).
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (
    created_by in (
      select e.engineer_id from public.engineers e
       where e.email = (select auth.jwt() ->> 'email')
    )
  );

-- 고치기(완료 체크도 이 길이다) — 내 일이거나 내가 적어 준 일, 또는 admin 이상.
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update to authenticated
  using (
    exists (
      select 1 from public.engineers me
       where me.email = (select auth.jwt() ->> 'email')
         and (me.engineer_id = tasks.engineer_id
           or me.engineer_id = tasks.created_by
           or me.permission_level in ('admin', 'superadmin'))
    )
  )
  with check (
    exists (
      select 1 from public.engineers me
       where me.email = (select auth.jwt() ->> 'email')
         and (me.engineer_id = tasks.engineer_id
           or me.engineer_id = tasks.created_by
           or me.permission_level in ('admin', 'superadmin'))
    )
  );

-- 지우기 — 고치기와 같은 조건.
drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks
  for delete to authenticated
  using (
    exists (
      select 1 from public.engineers me
       where me.email = (select auth.jwt() ->> 'email')
         and (me.engineer_id = tasks.engineer_id
           or me.engineer_id = tasks.created_by
           or me.permission_level in ('admin', 'superadmin'))
    )
  );

-- 읽기만 내려 준다 — 쓰기는 /api/task(service role)가 한다.
grant select on table public.tasks to authenticated;

-- ── 확인 ─────────────────────────────────────────────────────────────────
--   select policyname, cmd from pg_policies
--    where schemaname = 'public' and tablename = 'tasks' order by policyname;   → 4행
--   select count(*) from public.tasks;                                          → 0행

notify pgrst, 'reload schema';
