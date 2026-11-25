-- 명함 — **가져오기 묶음** (2026-11-25)
--
-- 여러 장 등록을 한 번 돌리면 수십 장이 한꺼번에 담긴다. 잘못 넣었을 때 **그 묶음만**
-- 통째로 되돌릴 수 있어야 한다. 묶음마다 uuid 하나를 새로 만들어 그 줄들에 적어 둔다.
--
-- ── 사건 FK 는 바꾸지 않는다 ─────────────────────────────────────────────
-- 지시에 「business_card_events 의 card_id FK 가 삭제를 막으면 on delete set null 로」
-- 라고 적혀 있었다. 확인해 보니 그 FK 는 이미 **on delete cascade** 다
-- (db/business_cards_20261123.sql:127) — 명함을 지우면 사건이 함께 지워지고,
-- 삭제를 막지 않는다. 그래서 이 파일에서는 FK 를 손대지 않는다.
--   · 되돌리기(묶음 삭제)는 **진짜 지우기**다 — 그 줄의 사건도 함께 사라진다.
--   · 목록의 선택 삭제는 **소프트**(deleted_at)다 — 사건이 그대로 남는다.
--
-- 재실행 안전 — add column if not exists · create index if not exists.

alter table public.business_cards
  add column if not exists import_batch_id uuid;

comment on column public.business_cards.import_batch_id is
  '여러 장 등록 한 번(묶음)의 id. 같은 묶음으로 담긴 줄은 한꺼번에 되돌릴 수 있다. 한 장씩 담은 줄과 합쳐진 줄은 비어 있다.';

-- 묶음으로 찾을 때만 쓰는 인덱스 — 빈 값은 담지 않는다(대부분의 줄이 비어 있다).
create index if not exists business_cards_import_batch_idx
  on public.business_cards (import_batch_id)
  where import_batch_id is not null;

-- 확인용(읽기만) —
--   select import_batch_id, count(*), min(registered_at)
--     from public.business_cards where import_batch_id is not null
--    group by 1 order by 3 desc;

notify pgrst, 'reload schema';

-- ── 되돌리기 ──────────────────────────────────────────────────────────────
--   drop index if exists business_cards_import_batch_idx;
--   alter table public.business_cards drop column if exists import_batch_id;
