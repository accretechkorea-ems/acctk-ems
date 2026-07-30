-- ============================================================
-- 20 수리 현황: 게이지 / 앰프 구분
--   기존 item_type 컬럼(원래 '게이지'|'앰프'용)을 재사용합니다.
-- Supabase SQL Editor 에서 1회 실행하세요.
-- ============================================================

-- 지금까지 엑셀로 들어간 데이터는 전부 '게이지'로 분류
update public.repairs set item_type = '게이지' where item_type is null;

-- 기본값 '게이지' + NOT NULL 복원
-- (체크 제약 repairs_item_type_chk: item_type in ('게이지','앰프')은 기존 그대로 유지)
alter table public.repairs alter column item_type set default '게이지';
alter table public.repairs alter column item_type set not null;
