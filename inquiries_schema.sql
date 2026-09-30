-- 의뢰서 (아직 DB 에 적용하지 않았다 — 이 파일은 적용 전 마이그레이션이다).
--
-- 다른 스키마 파일 대부분은 「이미 적용된 것을 적어 둔 기록」이라 머리말에 「다시 실행하지 마라」가
-- 붙어 있다. 이 파일은 반대다. 아래 실행 순서대로 Supabase SQL Editor 에서 한 번 돌린 뒤,
-- 머리말을 「(YYYY-MM-DD DB 적용 완료). 기록용, 다시 실행하지 마라.」로 바꿔 둔다.
--
-- ┌─ 실행 순서 ────────────────────────────────────────────────────────────────┐
-- │ 1. inquiry_sequence 표 + 초기 행 6종                                        │
-- │ 2. claim_inquiry_seq / bump_inquiry_seq 함수 + EXECUTE 권한                 │
-- │ 3. inquiries 표 + 인덱스 + RLS                                             │
-- │ 4. inquiry_attachments 표 + 인덱스 + RLS                                   │
-- │ 전부 한 트랜잭션으로 돌려도 된다(아래는 일부러 begin/commit 을 넣지 않았다 —  │
-- │ Supabase SQL Editor 가 문장 단위로 돌려도 순서만 지키면 같은 결과다).        │
-- └────────────────────────────────────────────────────────────────────────────┘
--
-- ┌─ 롤백 SQL (역순) ──────────────────────────────────────────────────────────┐
-- │ drop table if exists public.inquiry_attachments;                           │
-- │ drop table if exists public.inquiries;                                     │
-- │ drop function if exists public.bump_inquiry_seq(text, text, integer);      │
-- │ drop function if exists public.claim_inquiry_seq(text, text);              │
-- │ drop table if exists public.inquiry_sequence;                              │
-- │                                                                            │
-- │ ※ inquiry_attachments 를 먼저 지운다 — inquiries 를 FK 로 참조한다.         │
-- │ ※ 스토리지 버킷(inquiry-attachments)은 이 파일이 만들지 않으므로 롤백에도    │
-- │   없다. Dashboard 에서 따로 지운다. 표를 지워도 버킷 파일은 남는다.          │
-- └────────────────────────────────────────────────────────────────────────────┘
--
-- 설계 요점
--   · 쓰기는 전부 service role 라우트에서만 한다. RLS 는 읽기 정책만 둔다
--     (approval_schema.sql · service_attachments_schema.sql 과 같은 규칙).
--   · 감사 트리거는 붙이지 않는다. 필요한 기록은 라우트가 audit_log 에 직접 한 줄 넣는다
--     (service role 로 쓰면 트리거의 actor_email 이 NULL 이 되므로 트리거를 붙여도 소용없다).
--   · 채번은 DB 함수가 원자적으로 한다. next_quote_seq 와 같은
--     「insert … on conflict do update … returning」 방식이다.


-- ── 1. 채번 카운터 ──────────────────────────────────────────────────────────
-- 유형(type_code) × 기간(period_key) 하나에 카운터 한 줄.
--
-- period_key 는 연도 4자리 문자열('2026')이다. 해가 바뀌면 새 행이 생겨 자연히 1부터 시작한다.
-- 다만 hq_repair(본사 수리)는 연도 리셋이 없어 'ALL' 한 줄만 쓴다 — 키를 따로 만들지 않고
-- 같은 칸에 고정값을 넣는 이유는, 그래야 두 함수가 유형을 가리지 않고 똑같이 동작하기 때문이다
-- (함수 안에 if (type = 'hq_repair') 같은 분기를 두지 않는다).
--
-- seq 기본값이 0 인 것에 주의 — claim 이 +1 한 값을 돌려주므로 첫 번호가 1 이 된다.
-- quote_sequence 는 첫 insert 에 1 을 넣고 그 값을 그대로 돌려주는데, 여기서는 미리 만들어 둔
-- 행(아래 insert)과 함수가 만드는 행의 첫 번호를 같게 하려고 0 에서 시작한다.
create table if not exists public.inquiry_sequence (
  type_code   text    not null,
  period_key  text    not null,
  seq         integer not null default 0,
  primary key (type_code, period_key)
);

-- 유형 6종의 올해 카운터를 미리 만들어 둔다. 없어도 함수가 만들지만, 있으면 운영 중에
-- 「어느 유형이 몇 번까지 나갔는지」를 한눈에 본다. hq_repair 만 'ALL'.
insert into public.inquiry_sequence (type_code, period_key, seq) values
  ('spare80',     to_char(now() at time zone 'Asia/Seoul', 'YYYY'), 0),
  ('req80',       to_char(now() at time zone 'Asia/Seoul', 'YYYY'), 0),
  ('req20',       to_char(now() at time zone 'Asia/Seoul', 'YYYY'), 0),
  ('claim',       to_char(now() at time zone 'Asia/Seoul', 'YYYY'), 0),
  ('domestic_po', to_char(now() at time zone 'Asia/Seoul', 'YYYY'), 0),
  ('hq_repair',   'ALL',                                            0)
on conflict (type_code, period_key) do nothing;

alter table public.inquiry_sequence enable row level security;
-- 정책을 하나도 만들지 않는다 = service role 만 접근할 수 있다.
-- quote_sequence 는 authenticated 전면 허용이라 로그인 사용자가 카운터를 직접 조작할 수 있는데
-- (quote_schema_snapshot.sql:94-96 에 그 위험이 적혀 있다), 같은 실수를 되풀이하지 않는다.


-- ── 2. 채번 함수 ────────────────────────────────────────────────────────────

-- 다음 번호를 발급한다. 같은 (유형, 기간)으로 동시에 들어와도 한 번에 하나씩만 나간다 —
-- on conflict do update 가 그 행에 잠금을 걸기 때문이다. next_quote_seq 와 같은 방식이다.
--
-- SECURITY DEFINER 인 이유: 이 표에 RLS 는 켜져 있고 정책이 없다. 함수가 호출자 권한으로 돌면
-- service role 이 아닌 경로에서는 0행이 된다. 소유자(postgres) 권한으로 돌려 확실하게 만든다.
-- 그래도 아무나 부르지 못하도록 아래에서 EXECUTE 를 service_role 로만 좁힌다.
create or replace function public.claim_inquiry_seq(p_type text, p_period text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seq integer;
begin
  insert into public.inquiry_sequence (type_code, period_key, seq)
  values (p_type, p_period, 1)
  on conflict (type_code, period_key)
  do update set seq = public.inquiry_sequence.seq + 1
  returning seq into v_seq;
  return v_seq;
end;
$$;

-- 카운터를 p_seq 까지 끌어올린다(이미 그보다 크면 그대로 둔다).
--
-- 쓰임새는 소급 등록(is_backfill)이다. 종이로 이미 나간 의뢰서를 나중에 넣을 때 번호를 직접
-- 지정하는데, 그 번호가 카운터보다 크면 다음 발급이 그 번호와 겹친다. greatest 로 밀어 둔다.
-- 낮추지 않는 이유는 분명하다 — 이미 발급된 번호를 다시 내주면 안 된다.
create or replace function public.bump_inquiry_seq(p_type text, p_period text, p_seq integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.inquiry_sequence (type_code, period_key, seq)
  values (p_type, p_period, p_seq)
  on conflict (type_code, period_key)
  do update set seq = greatest(public.inquiry_sequence.seq, p_seq);
end;
$$;

-- 두 함수 모두 서버(service role)에서만 부른다. 브라우저에서 rpc 로 부를 수 있으면
-- 카운터를 마음대로 올릴 수 있다.
revoke execute on function public.claim_inquiry_seq(text, text) from public, anon, authenticated;
revoke execute on function public.bump_inquiry_seq(text, text, integer) from public, anon, authenticated;
grant  execute on function public.claim_inquiry_seq(text, text) to service_role;
grant  execute on function public.bump_inquiry_seq(text, text, integer) to service_role;


-- ── 3. 의뢰서 ───────────────────────────────────────────────────────────────
create table if not exists public.inquiries (
  id                uuid primary key default gen_random_uuid(),

  inquiry_type      text not null
    constraint inquiries_inquiry_type_check
    check (inquiry_type in ('spare80', 'req80', 'req20', 'hq_repair', 'claim', 'domestic_po')),

  -- 사람에게 보이는 번호. 유일해야 한다 — 견적번호(유니크 없음, 화면이 5회 재시도로 방어)의
  -- 전철을 밟지 않는다. 채번이 원자적이므로 이 제약에 걸릴 일은 소급 등록 충돌뿐이고,
  -- 그때는 라우트가 23505 를 받아 사람에게 알린다.
  inquiry_no        text not null,
  constraint inquiries_inquiry_no_key unique (inquiry_no),

  -- 번호를 만든 근거. inquiry_no 를 되파싱하지 않으려고 따로 둔다.
  -- hq_repair 는 'ALL', 나머지는 연도 4자리.
  period_key        text    not null,
  seq               integer not null,

  -- 장비 계열. 유형에 따라 없을 수 있어 null 을 허용한다.
  equipment_series  text
    constraint inquiries_equipment_series_check
    check (equipment_series is null or equipment_series in ('20', '81', '83', '84')),

  title             text not null default '',

  status            text not null default 'drafting'
    constraint inquiries_status_check
    check (status in ('drafting', 'sent', 'waiting', 'done', 'cancelled')),

  -- engineers.engineer_id 는 integer 다(approval_schema.sql · service_attachments_schema.sql 과 같다).
  -- ON DELETE 를 두지 않는다 = NO ACTION. 의뢰서를 남긴 채 직원 행을 지우려 하면 막힌다.
  -- 이 프로젝트는 퇴사자를 지우지 않고 resigned_date 로 표시하므로 실제로 걸릴 일은 없고,
  -- 걸린다면 그쪽이 잘못된 삭제다.
  created_by        integer,
  constraint inquiries_created_by_fkey
    foreign key (created_by) references public.engineers(engineer_id),

  -- 의뢰서에 찍히는 날짜. created_at 과 다르다 — 소급 등록이면 과거 날짜가 들어간다.
  issued_date       date not null,

  -- 종이로 이미 나간 건을 나중에 넣은 것인지. 번호를 직접 지정하는 경로라 따로 표시해 둔다.
  is_backfill       boolean not null default false,

  -- 취소 시각. status = 'cancelled' 와 짝이다. 행을 지우지 않는 이유는 번호가 비면 안 되기 때문이다.
  cancelled_at      timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- 「이 유형의 이 기간에 몇 번까지 나갔나」를 바로 본다. 목록 정렬도 이 길을 쓴다.
create index if not exists idx_inquiries_type_period_seq
  on public.inquiries (inquiry_type, period_key, seq);
create index if not exists idx_inquiries_status  on public.inquiries (status);
create index if not exists idx_inquiries_created_by on public.inquiries (created_by);

alter table public.inquiries enable row level security;

-- 읽기 — 고객사 열람 권한이 있는 팀.
--
-- ※ has_team_perm('inquiries') 가 아니다. 그 함수는 teams.can_view_* 컬럼을 보는데
--   'inquiries' 에 해당하는 컬럼이 없어 superadmin 말고는 전부 false 가 된다
--   (db_functions_snapshot.sql:25-45 — 받는 값은 customers·dashboard·quote·pipeline·
--   sales_mgmt·admin 여섯 뿐이다).
--   메뉴 권한 'inquiries' 는 lib/menuPerms.ts 의 DERIVED_PERMS 에서 'customers' 영역으로
--   파생시키고, RLS 는 그 파생된 컬럼을 보는 이 정책이 담당한다.
--   service_attachments 가 쓰는 방식과 같다.
--
-- 함수는 (select ...) 로 감싼다 — 행마다 다시 부르지 않고 한 번만 평가된다(레포 관례).
create policy inquiries_select on public.inquiries
  for select to authenticated
  using ((select public.has_team_perm('customers')));

-- INSERT/UPDATE/DELETE 정책은 만들지 않는다. 쓰기는 service role 라우트만 한다.


-- ── 4. 첨부파일 ─────────────────────────────────────────────────────────────
-- service_attachments 를 그대로 본떴다(service_attachments_schema.sql).
-- 파일은 버킷 안 파일명만 저장한다(전체 URL 이 아니다). 열 때마다 서명 URL 을 발급한다.
create table if not exists public.inquiry_attachments (
  id            bigint generated always as identity primary key,

  -- 의뢰서가 지워지면 행도 함께 지운다. 스토리지 파일은 CASCADE 로 지워지지 않으므로
  -- 라우트가 먼저 파일을 지운다(service_attachments 와 같은 규칙).
  inquiry_id    uuid not null references public.inquiries(id) on delete cascade,

  -- 보낸 문서인지 받은 문서인지. 한 의뢰서에 두 방향이 섞인다.
  direction     text not null
    constraint inquiry_attachments_direction_check
    check (direction in ('sent', 'received')),

  -- inquiry-attachments 버킷 안의 파일명. 서버가 정한다(클라이언트 이름을 경로로 쓰지 않는다).
  file_path     text not null,
  constraint inquiry_attachments_file_path_key unique (file_path),

  -- 올린 사람이 보던 원래 이름. 표시에만 쓰고 경로로는 쓰지 않는다.
  file_name     text not null,
  content_type  text,
  byte_size     bigint,

  -- 그 문서 자체의 날짜(발송일·수신일). created_at 과 다르다 — 지난 문서를 나중에 올릴 수 있다.
  file_date     date,

  sort_order    integer not null default 0,

  uploaded_by   integer,
  constraint inquiry_attachments_uploaded_by_fkey
    foreign key (uploaded_by) references public.engineers(engineer_id),

  created_at    timestamptz not null default now()
);

create index if not exists idx_inquiry_attachments_inquiry
  on public.inquiry_attachments (inquiry_id);

alter table public.inquiry_attachments enable row level security;

-- 읽기만. 본체(inquiries)와 같은 기준으로 연다.
create policy inquiry_attachments_select on public.inquiry_attachments
  for select to authenticated
  using ((select public.has_team_perm('customers')));

-- 버킷: inquiry-attachments (Public 체크 해제, 파일 크기 제한 20MB) — Dashboard 에서 따로 만든다.
-- storage.objects 에 정책을 만들지 않는다 — 정책이 없으면 service role 만 접근할 수 있다.
