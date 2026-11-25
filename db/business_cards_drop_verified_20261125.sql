-- 명함 — **「마지막 확인」을 걷는다** (2026-11-25)
--
-- 2026-11-23 에 「아직 그 자리에 있나」를 눌러 적는 칸으로 넣었다. 쓰는 사람이
-- 없었고, 한 장씩 담으면 등록일과 늘 같은 값이라 목록에서 날짜만 두 번 보였다.
-- 기능을 걷기로 해 칸도 함께 지운다.
--
-- ⚠ **되돌릴 수 없다** — 지금 찍혀 있는 확인 날짜는 사라진다.
--    남겨 두고 싶으면 돌리기 전에 떠 둔다:
--      create table business_cards_verified_backup_20261125 as
--        select card_id, verified_at from public.business_cards where verified_at is not null;
--
-- 코드는 **이 SQL 전에 이미 그 칸을 읽지도 쓰지도 않는다**(같은 날 배포).
-- 그래서 돌리는 차례는 상관없다.
--
-- 재실행 안전 — drop column if exists.

alter table public.business_cards
  drop column if exists verified_at;

notify pgrst, 'reload schema';

-- 확인용(읽기만) —
--   select column_name from information_schema.columns
--    where table_name = 'business_cards' order by ordinal_position;
--   기대: verified_at 이 없다.
