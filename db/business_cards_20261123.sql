-- 명함 등록 — 새 표 (2026-11-23)
--
-- ── 왜 ───────────────────────────────────────────────────────────────────
-- 받은 명함이 사람 서랍에만 있다. 그 사람이 자리를 옮기면 연락처가 통째로 사라진다.
-- 찍어서 올리면 글자를 읽어 칸에 넣고, 회사 전체가 같이 본다.
--
-- ── 고객사와 잇지 않는다 ─────────────────────────────────────────────────
-- customer_id 같은 연결 칸을 **두지 않는다**(사장님 지시, 2026-11-23). 명함은 사람의
-- 기록이고 고객사는 거래처의 기록이라 묶는 규칙을 아직 정하지 않았다. 나중에 따로 한다.
--
-- ── 등록자 스냅샷 ────────────────────────────────────────────────────────
-- 누가 등록했는지를 **id 와 글자 둘 다** 남긴다. 사람이 팀을 옮기거나 그만둬도
-- 「그때 누가, 어느 팀에서, 어느 사업부로 등록했나」가 변하지 않아야 하기 때문이다.
-- id 만 두면 지금 소속을 따라가 과거가 바뀐다.
--
-- ── 날짜 둘 ──────────────────────────────────────────────────────────────
--   registered_at — 등록한 날. **고칠 수 없다**(트리거가 막는다). 명함의 나이다.
--   verified_at   — 「아직 그 자리에 있다」를 확인한 날. 눌러서 갱신한다. 등록일은 그대로다.
--
-- 재실행 안전 — create table if not exists · add column if not exists · drop policy if exists.

create table if not exists public.business_cards (
  card_id          bigserial primary key,

  -- 명함에 적힌 것
  name             text not null,
  company          text,
  department       text,
  position         text,
  mobile           text,
  phone            text,
  fax              text,
  email            text,
  address          text,
  website          text,
  memo             text,

  -- 어느 사업부의 명함인가(계측·반도체). 폼의 기본값은 등록자 팀의 사업부다.
  division         text not null default '계측',

  -- 날짜 둘
  registered_at    timestamptz not null default now(),
  verified_at      timestamptz,

  -- 어떻게 넣었나 — camera(촬영) · upload(사진 올리기) · manual(직접 입력)
  input_method     text not null default 'manual',

  -- 등록자 — id 와 **그때의 글자**를 함께 남긴다(위 「등록자 스냅샷」)
  engineer_id      integer references public.engineers(engineer_id),
  registered_name  text,
  registered_team  text,
  registered_div   text,

  -- 지우기는 소프트다(고객사와 같은 규칙)
  deleted_at       timestamptz,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.business_cards is
  '명함. 고객사·사업장 연결 칸은 두지 않는다(2026-11-23 지시 — 나중에 따로). lib/businessCard.ts 가 규칙이다.';
comment on column public.business_cards.registered_at is '등록한 날. 고칠 수 없다(트리거가 막는다) — 명함의 나이다.';
comment on column public.business_cards.verified_at is '「아직 그 자리에 있다」를 확인한 날. 등록일은 그대로 둔다.';
comment on column public.business_cards.input_method is 'camera · upload · manual.';
comment on column public.business_cards.registered_name is '등록한 때의 이름. 사람이 팀을 옮겨도 과거가 바뀌지 않게 글자로 남긴다.';

-- 값 검사 — 화면을 우회한 값이 들어오지 않게.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'business_cards_division_chk') then
    alter table public.business_cards
      add constraint business_cards_division_chk check (division in ('계측', '반도체'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'business_cards_input_chk') then
    alter table public.business_cards
      add constraint business_cards_input_chk check (input_method in ('camera', 'upload', 'manual'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'business_cards_name_chk') then
    alter table public.business_cards
      add constraint business_cards_name_chk check (btrim(name) <> '');
  end if;
end $$;

-- ── 찾는 길 ──────────────────────────────────────────────────────────────
-- 목록은 늘 「안 지워진 것」만 본다. 사업부·등록자로 거르고 등록일 역순으로 센다.
create index if not exists business_cards_live_idx
  on public.business_cards (division, registered_at desc)
  where deleted_at is null;
create index if not exists business_cards_engineer_idx
  on public.business_cards (engineer_id)
  where deleted_at is null;
-- 같은 명함을 두 번 넣는 것을 찾을 때(이름+휴대폰 / 이메일). 유니크는 걸지 않는다 —
-- 같은 사람의 명함이 회사를 옮겨 두 장이 되는 일이 정상이기 때문이다. 경고만 한다.
create index if not exists business_cards_dup_idx
  on public.business_cards (lower(btrim(name)), mobile)
  where deleted_at is null;
create index if not exists business_cards_email_idx
  on public.business_cards (lower(btrim(email)))
  where deleted_at is null and email is not null;

-- ── 등록일은 고칠 수 없다 ────────────────────────────────────────────────
-- 명함의 나이가 꼬리표 색(초록·주황·빨강)을 정한다. 화면에서 고칠 길을 두지 않는 것으로는
-- 모자란다 — 라우트를 우회한 수정까지 여기서 막는다. updated_at 은 함께 올려 준다.
create or replace function public.business_cards_guard()
returns trigger
language plpgsql
as $$
begin
  new.registered_at := old.registered_at;   -- 등록일은 언제나 처음 값
  new.created_at    := old.created_at;
  new.updated_at    := now();
  return new;
end $$;

drop trigger if exists business_cards_guard_trg on public.business_cards;
create trigger business_cards_guard_trg
  before update on public.business_cards
  for each row execute function public.business_cards_guard();

-- ── 변경 기록 ────────────────────────────────────────────────────────────
-- 남이 등록한 명함도 누구나 고칠 수 있다. 그래서 **누가 무엇을 바꿨는지** 남긴다 —
-- 그것이 없으면 「언제부터 번호가 이렇게 돼 있었나」를 알 수 없다.
-- 고객사의 customer_events 와 같은 모양이다(쓰기는 service role 뿐).
create table if not exists public.business_card_events (
  event_id          bigserial primary key,
  card_id           bigint not null references public.business_cards(card_id) on delete cascade,
  -- card_created · card_edited · card_verified · card_deleted · card_restored
  event_type        text not null,
  occurred_at       timestamptz not null default now(),
  actor_engineer_id integer references public.engineers(engineer_id),
  payload           jsonb not null default '{}'::jsonb
);

create index if not exists business_card_events_card_idx
  on public.business_card_events (card_id, occurred_at desc);

comment on table public.business_card_events is
  '명함을 누가 언제 무엇으로 바꿨나. 쓰기는 /api/business-card(service role)뿐이다.';

-- ── RLS ──────────────────────────────────────────────────────────────────
-- 읽기는 로그인 전원. 쓰기는 **서버 라우트(service role)만** — service role 은 RLS 를
-- 지나가므로 authenticated 에게는 쓰기 정책을 주지 않는다(teams 와 같은 규칙).
alter table public.business_cards enable row level security;

drop policy if exists "business_cards_select_authenticated" on public.business_cards;
create policy "business_cards_select_authenticated"
on public.business_cards for select to authenticated
using (true);

-- INSERT·UPDATE·DELETE 정책은 두지 않는다 = authenticated 로는 쓸 수 없다.

alter table public.business_card_events enable row level security;

drop policy if exists "business_card_events_select_authenticated" on public.business_card_events;
create policy "business_card_events_select_authenticated"
on public.business_card_events for select to authenticated
using (true);

grant select on table public.business_cards to authenticated;
grant select on table public.business_card_events to authenticated;

notify pgrst, 'reload schema';
