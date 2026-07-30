-- ============================================================
-- 20 수리 현황: 상태 4단계 + 단계별 시각 기록
--   상태: 입고 → 수리중 → 출고대기(수리완료) → 출고완료
-- Supabase SQL Editor 에서 1회 실행하세요. (repairs_migration_excel.sql 이후)
-- ============================================================

-- 단계별 전환 시각 (통계용)
alter table public.repairs
  add column if not exists repair_started_at timestamptz,  -- '수리 시작' 누른 시각
  add column if not exists repair_done_at    timestamptz,  -- '수리 완료'(출고대기) 누른 시각
  add column if not exists shipped_at        timestamptz;  -- '출고' 누른 시각

-- 상태 체크 제약에 '입고' 추가
alter table public.repairs drop constraint if exists repairs_status_chk;
alter table public.repairs add constraint repairs_status_chk
  check (status in ('입고','수리중','출고대기','출고완료'));

-- 신규 접수 기본 상태를 '입고'로
alter table public.repairs alter column status set default '입고';
