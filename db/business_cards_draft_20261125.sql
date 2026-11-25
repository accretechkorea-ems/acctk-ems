-- 명함 — **검토 대기(draft)** (2026-11-25)
--
-- 지금은 읽자마자 명함첩에 들어간다. 44쪽을 돌리면 잘못 읽은 줄까지 그대로 섞인다.
-- 앞으로는 「읽기 → 검토 대기 → 담당자가 쪽 이미지와 대조해 승인 → 등록」이다.
-- 승인한 것만 목록·검색·엑셀에 나온다.
--
--   status      — 'draft'(검토 대기) · 'active'(등록됨). 기본은 active 다.
--                 지금까지 담긴 줄은 전부 사람이 보고 넣은 것이라 active 가 맞다.
--   import_page — 그 줄이 **PDF 몇 쪽**이었나(0부터). 검토 화면이 쪽 이미지를 맞춰 보여 준다.
--
-- 재실행 안전 — add column if not exists · 제약은 drop 후 add.

alter table public.business_cards
  add column if not exists status      text not null default 'active',
  add column if not exists import_page int;

alter table public.business_cards
  drop constraint if exists business_cards_status_chk;

alter table public.business_cards
  add constraint business_cards_status_chk
  check (status in ('draft', 'active'));

comment on column public.business_cards.status is
  'draft = 검토 대기(목록·검색·엑셀에 나오지 않는다) · active = 등록됨. 여러 장 등록은 draft 로 담고, 사람이 승인하면 active 가 된다.';
comment on column public.business_cards.import_page is
  '여러 장 등록에서 **몇 쪽**이었나(0부터). 검토 화면이 그 쪽 이미지를 맞춰 보여 준다.';

-- 검토 화면이 「이 묶음의 대기 줄」을 찾는 길.
create index if not exists business_cards_draft_idx
  on public.business_cards (status, import_batch_id);

notify pgrst, 'reload schema';

-- 확인용(읽기만) —
--   select status, count(*) from public.business_cards where deleted_at is null group by 1;
--   기대: 지금 담긴 줄은 전부 active.

-- ── 되돌리기 ──────────────────────────────────────────────────────────────
--   drop index if exists business_cards_draft_idx;
--   alter table public.business_cards drop constraint if exists business_cards_status_chk;
--   alter table public.business_cards drop column if exists status;
--   alter table public.business_cards drop column if exists import_page;
