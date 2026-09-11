-- 쇼룸 관리 + 통합 요청함 스키마 (2026-09-11 DB 적용 완료)
-- 이 파일은 기록용이다. DB 에는 이미 적용되어 있으므로 다시 실행하지 마라.
-- 쓰기는 전부 service role API 라우트에서만 한다. RLS 는 읽기 정책만 둔다.
-- rls_auto_enable 때문에 새 테이블은 정책 없이는 전면 차단된다.
-- engineers FK 가 2개(requester_id, approver_id)라 임베딩 시 FK 이름을 반드시 명시한다.

begin;

create table public.approval_requests (
  request_id    bigint generated always as identity primary key,
  request_type  text not null check (request_type in ('showroom_demo')),
  status        text not null default '대기중'
                check (status in ('대기중','승인','반려','취소')),
  requester_id  integer not null references public.engineers(engineer_id),
  approver_id   integer references public.engineers(engineer_id),
  payload       jsonb not null default '{}'::jsonb,
  reason        text,
  comment       text,
  decided_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint ar_reject_needs_comment
    check (status <> '반려' or (comment is not null and length(trim(comment)) > 0)),
  constraint ar_no_self_approve
    check (approver_id is null or approver_id <> requester_id),
  constraint ar_decided_fields
    check (status not in ('승인','반려') or (approver_id is not null and decided_at is not null))
);
create index idx_ar_status_created on public.approval_requests (status, created_at desc);
create index idx_ar_requester      on public.approval_requests (requester_id);

create table public.showroom_devices (
  device_id    bigint primary key references public.devices(device_id),
  is_active    boolean not null default true,
  daily_hours  numeric(4,1) not null default 8 check (daily_hours > 0 and daily_hours <= 24),
  sort_order   integer not null default 0,
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.showroom_usage (
  usage_id     bigint generated always as identity primary key,
  device_id    bigint not null references public.showroom_devices(device_id),
  usage_date   date not null,
  start_time   time not null,
  end_time     time not null,
  work_hours   numeric(4,1) not null check (work_hours >= 0),
  purpose      text not null
               check (purpose in ('고객 데모','측정대행','내부 시험','교육','유지보수','기타')),
  customer_id  bigint references public.customers(customer_id),
  request_id   bigint references public.approval_requests(request_id),
  content      text,
  result       text,
  created_by   integer not null references public.engineers(engineer_id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  constraint su_time_order check (end_time > start_time),
  constraint su_customer_required
    check (purpose not in ('고객 데모','측정대행') or customer_id is not null)
);
create index idx_su_device_date on public.showroom_usage (device_id, usage_date) where deleted_at is null;
create index idx_su_customer    on public.showroom_usage (customer_id);
create index idx_su_request     on public.showroom_usage (request_id);

create table public.showroom_usage_engineers (
  usage_id     bigint  not null references public.showroom_usage(usage_id) on delete cascade,
  engineer_id  integer not null references public.engineers(engineer_id),
  primary key (usage_id, engineer_id)
);
create index idx_sue_engineer on public.showroom_usage_engineers (engineer_id);

alter table public.approval_requests        enable row level security;
alter table public.showroom_devices         enable row level security;
alter table public.showroom_usage           enable row level security;
alter table public.showroom_usage_engineers enable row level security;

create policy ar_select on public.approval_requests
  for select to authenticated
  using (requester_id = public.current_engineer_id() or public.is_superadmin());

create policy sd_select on public.showroom_devices
  for select to authenticated using (true);

create policy su_select on public.showroom_usage
  for select to authenticated using (deleted_at is null);

create policy sue_select on public.showroom_usage_engineers
  for select to authenticated using (true);

commit;

-- ===== 되돌리기 (필요 시에만) =====
-- begin;
-- drop table if exists public.showroom_usage_engineers;
-- drop table if exists public.showroom_usage;
-- drop table if exists public.showroom_devices;
-- drop table if exists public.approval_requests;
-- commit;
