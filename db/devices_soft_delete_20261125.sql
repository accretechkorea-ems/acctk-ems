-- 장비 **숨기기(소프트 삭제)의 자국** — 누가·왜 (2026-11-25)
--
-- ── 왜 ───────────────────────────────────────────────────────────────────
-- 장비 삭제는 이미 **숨기기**다(`devices.deleted_at` 에 시각을 적고 목록·엑셀·통계가
-- 그 줄을 뺀다). 다만 **누가 왜** 지웠는지는 남지 않았다. 삭제를 슈퍼관리자에서
-- 로그인한 사람 전부로 여는 회차라(지시), 그 둘을 함께 남긴다.
--
--   deleted_by    지운 사람(engineers)
--   delete_reason 까닭 — 창에서 **반드시** 받는다
--
-- 같은 내용이 customer_events 에도 한 줄 남는다(사건 device_deleted). 표의 두 칸은
-- 「지금 이 줄이 왜 숨어 있나」를 그 줄만 보고 알 수 있게 하는 쪽이고, 사건은 이력이다.
--
-- 재실행 안전 — add column if not exists.

alter table public.devices
  add column if not exists deleted_by    integer references public.engineers(engineer_id),
  add column if not exists delete_reason text;

comment on column public.devices.deleted_at is '숨긴 시각. 목록·카드·엑셀·통계가 이 값이 있는 줄을 뺀다.';
comment on column public.devices.deleted_by is '숨긴 사람(engineers). /api/customer-delete 가 세션에서 넣는다.';
comment on column public.devices.delete_reason is '숨긴 까닭(필수). 창에서 받는다.';

-- 숨긴 줄만 따로 보는 자리(복구 목록)가 빠르게 읽도록.
create index if not exists devices_deleted_idx
  on public.devices (customer_id, deleted_at) where deleted_at is not null;

-- ── 확인 ─────────────────────────────────────────────────────────────────
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'devices'
--      and column_name in ('deleted_at', 'deleted_by', 'delete_reason');   → 3행
--   select device_id, device_name, deleted_at, deleted_by, delete_reason
--     from public.devices where deleted_at is not null order by deleted_at desc;

notify pgrst, 'reload schema';
