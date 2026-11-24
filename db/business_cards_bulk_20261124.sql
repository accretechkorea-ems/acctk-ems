-- 명함 — **일괄 등록**과 「마지막 확인」 기본값 (2026-11-24)
--
-- ⚠ 칸 이름: 지시문의 `last_checked_at` 은 이 표에 없다. 실제 칸은 **`verified_at`** 이다
--   (db/business_cards_20261123.sql:43). 아래는 전부 그 칸을 가리킨다.
--
-- ── 무엇이 바뀌나 ─────────────────────────────────────────────────────────
--   ① input_method 에 'bulk' 를 허용한다 — 스캐너가 만든 PDF 를 몇백 장씩 넣는 길.
--   ② 한 장씩 담은 명함은 **담은 날이 곧 확인한 날**이다(verified_at = registered_at).
--      사람이 보고 넣은 값이니 「확인 전」으로 둘 까닭이 없다.
--      일괄로 담은 줄은 **null 로 둔다** — 아무도 눈으로 보지 않았다는 뜻이다.
--   ③ 지금까지 담긴 줄(전부 한 장씩 담은 것) 중 확인일이 빈 줄을 등록일로 채운다.
--
-- 재실행 안전 — 제약은 drop 후 add, update 는 같은 값을 다시 쓴다.

-- ── ① input_method 에 'bulk' ─────────────────────────────────────────────
-- 2026-11-23 의 제약은 camera · upload · manual 셋뿐이라, 그대로면 일괄 insert 가
-- 23514 로 막힌다. 이름이 같은 제약을 지우고 넷으로 다시 건다.
alter table public.business_cards
  drop constraint if exists business_cards_input_chk;

alter table public.business_cards
  add constraint business_cards_input_chk
  check (input_method in ('camera', 'upload', 'manual', 'bulk'));

comment on column public.business_cards.input_method is
  'camera · upload · manual · bulk(여러 장 한꺼번에 — 사람이 아직 확인하지 않았다).';

comment on column public.business_cards.verified_at is
  '「아직 그 자리에 있다」를 확인한 날. 한 장씩 담으면 등록일과 같고, 일괄로 담으면 비어 있다(= 확인 전). 등록일은 그대로 둔다.';

-- ── ② 지난 줄 채우기 ─────────────────────────────────────────────────────
-- **일괄로 담은 줄은 건드리지 않는다**(아직 아무도 보지 않았으므로 확인 전이 맞다).
-- 지금 표에 bulk 줄은 없지만, 이 파일을 나중에 다시 돌려도 안전하도록 조건에 적는다.
update public.business_cards
   set verified_at = registered_at
 where verified_at is null
   and input_method is distinct from 'bulk'
   and deleted_at is null;

-- 확인용(읽기만) —
--   select input_method, count(*) filter (where verified_at is null) as 확인전, count(*) as 전체
--     from public.business_cards where deleted_at is null group by input_method;
--   기대: bulk 가 아닌 줄의 「확인전」이 0.

notify pgrst, 'reload schema';

-- ── 되돌리기 ──────────────────────────────────────────────────────────────
--   alter table public.business_cards drop constraint if exists business_cards_input_chk;
--   alter table public.business_cards
--     add constraint business_cards_input_chk check (input_method in ('camera','upload','manual'));
--   -- ②는 되돌릴 수 없다(어떤 줄이 비어 있었는지 남기지 않는다). 되돌릴 일이 있으면
--   -- 돌리기 전에 아래를 떠 둔다:
--   --   create table business_cards_verified_backup_20261124 as
--   --     select card_id, verified_at from public.business_cards;
