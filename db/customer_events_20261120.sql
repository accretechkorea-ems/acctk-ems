-- db/customer_events_20261120.sql
--
-- **고객 사건 로그** — 한 고객사(회사 또는 사업장)에 「무슨 일이 있었는가」를 한 줄씩 적는다.
--
-- ── 왜 필요한가 ───────────────────────────────────────────────────────────
--   지금까지 「리드가 등록됐다」·「담당이 배정됐다」를 sales_activities 에 끼워 넣었다.
--   그 표는 **사람이 적는 영업 활동**이라, 자동으로 만든 줄이 섞이면
--     · 활동 건수·종류 통계가 부풀고(실제로 만난 적 없는 방문미팅처럼 보인다),
--     · 사람이 그 줄을 고치거나 지울 수 있고,
--     · 활동 종류 표(activity_types)에 쓰지도 않는 종류가 늘어난다.
--   사건은 사건대로 따로 적는다. **사람이 쓰지 않고, 고치지 않고, 지우지 않는다.**
--
-- ── 무엇을 적는가 ────────────────────────────────────────────────────────
--   event_type            언제
--   lead_registered       리드가 처음 들어온 때(occurred_at = leads.created_at — 소급 날짜)
--   lead_assigned         리드 담당을 처음 배정한 때(occurred_at = 배정한 시각)
--   lead_reassigned       담당을 바꾼 때(payload 에 전·후)
--   새 종류가 생기면 이 표에 줄만 더 쌓는다 — 스키마는 그대로다(payload 가 jsonb).
--
-- ── 누가 쓰는가 ──────────────────────────────────────────────────────────
--   **service role 라우트만** 쓴다(/api/lead-manage). 화면은 읽기만 한다.
--   RLS 를 켜고 읽기 정책만 둔다 — 쓰기 정책이 없으면 service role 말고는 아무도 못 쓴다.
--
-- ── 소급(백필)은 하지 않는다 ─────────────────────────────────────────────
--   지난 리드까지 거슬러 만들지 않는다. 오늘부터 쌓인다.
--
-- 적용 뒤 **반드시**:  notify pgrst, 'reload schema';  (이 파일 끝에 들어 있다)

create table if not exists public.customer_events (
  id                bigint generated always as identity primary key,
  -- 사업장 줄일 수도, 회사 줄일 수도 있다(둘 다 customers 의 한 줄이다).
  customer_id       bigint not null references public.customers(customer_id),
  event_type        text   not null,
  -- **일이 벌어진 때**. 리드 최초 등록처럼 지난 날짜를 적는 경우가 있어 created_at 과 따로 둔다.
  occurred_at       timestamptz not null default now(),
  -- 그 일을 한 사람(우리 쪽). 자동으로 생긴 줄이면 비어 있을 수 있다.
  actor_engineer_id integer references public.engineers(engineer_id),
  -- 종류마다 다른 값(리드번호·산업군·담당자 이름 등). 화면은 이 안을 읽어 한 줄로 만든다.
  payload           jsonb  not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

comment on table public.customer_events is
  '고객 사건 로그. 사람이 적는 sales_activities 와 달리 **자동으로만** 쌓인다(service role 라우트). 화면은 읽기 전용.';
comment on column public.customer_events.occurred_at is
  '일이 벌어진 때. 리드 최초 등록은 leads.created_at 을 그대로 적는다(소급 날짜).';
comment on column public.customer_events.payload is
  '종류별 부속 값. lead_registered: {lead_id, lead_no, industry, note}. lead_assigned/reassigned: {lead_id, lead_no, to_engineer_id, to_name, from_engineer_id, from_name}.';

-- 타임라인은 「이 고객사의 사건을 최근 순으로」 읽는다.
create index if not exists customer_events_customer_idx
  on public.customer_events (customer_id, occurred_at desc);
create index if not exists customer_events_type_idx
  on public.customer_events (event_type);

-- **같은 리드의 최초 등록은 한 번만.** 담당을 다시 배정해도 lead_registered 가 또 생기지 않게
-- DB 가 막는다(코드도 먼저 확인하지만, 두 사람이 동시에 눌렀을 때는 이 제약이 마지막 문이다).
create unique index if not exists customer_events_lead_registered_once
  on public.customer_events ((payload->>'lead_id'))
  where event_type = 'lead_registered';

-- ── RLS — 읽기는 로그인한 사람, 쓰기는 없음(= service role 만) ───────────
alter table public.customer_events enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'customer_events' and policyname = 'customer_events_read'
  ) then
    create policy customer_events_read on public.customer_events
      for select to authenticated using (true);
  end if;
end $$;

-- 쓰기 정책은 **일부러 두지 않는다**. RLS 가 켜진 표에 쓰기 정책이 없으면
-- superadmin 이어도 화면에서는 쓰지 못하고, service role 만 쓸 수 있다.
grant select on public.customer_events to authenticated;
revoke insert, update, delete on public.customer_events from authenticated, anon;

-- ── 「리드 등록」 자동 활동 종류를 접는다 ────────────────────────────────
--   지금까지 sales_activities 에 넣던 자동 줄은 더 이상 만들지 않는다.
--   **과거 줄은 그대로 둔다** — 타임라인에 계속 보여야 한다. 그래서 지우지 않고
--   종류만 비활성으로 돌려 새로 고를 수 없게 한다(lib/activityTypes.ts 가 그 규칙을 본다).
update public.activity_types
   set is_active = false
 where code = 'LEAD_REG' and is_active;

-- PostgREST 가 새 표를 알아보게 한다(이 줄을 빼면 조회가 404 다).
notify pgrst, 'reload schema';

-- ── 확인 ────────────────────────────────────────────────────────────────
-- select count(*) from public.customer_events;                       -- 0 이어야 한다
-- select code, label, is_active from public.activity_types order by sort_order;
