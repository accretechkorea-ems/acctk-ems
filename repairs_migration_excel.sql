-- ============================================================
-- 20 수리 현황: 엑셀 구조로 전환 (제품 구분 · 시리얼번호 추가)
-- Supabase SQL Editor 에서 1회 실행하세요.
-- 기존 데이터는 보존하며, 새 컬럼만 추가하고 기존 NOT NULL 제약만 완화합니다.
-- ============================================================

alter table public.repairs
  add column if not exists product_type  text,   -- 제품 구분 (예: E-TS-4182-P6)
  add column if not exists serial_number text;    -- 시리얼번호 (예: 504962)

-- 새 접수 폼은 품목/수량/수리내용/완료예정일을 입력하지 않으므로 NOT NULL 완화.
-- (item_type check 제약은 NULL 입력을 통과시키므로 그대로 두어도 됩니다.)
alter table public.repairs alter column item_type drop not null;
alter table public.repairs alter column quantity  drop not null;
