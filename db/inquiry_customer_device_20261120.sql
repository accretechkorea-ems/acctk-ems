-- db/inquiry_customer_device_20261120.sql
--
-- **의뢰서를 사업장·장비에 건다.**
--
-- ── 왜 ───────────────────────────────────────────────────────────────────
--   지금 `inquiries` 에는 어느 업체의 일인지 적는 칸이 **없다**(2026-11-20 확인:
--   id · inquiry_type · inquiry_no · period_key · seq · equipment_series · title ·
--   status · created_by · issued_date · is_backfill · cancelled_at · created_at ·
--   updated_at — 열넷뿐이다). 그래서 고객사 화면에서는 그 업체로 나간 의뢰서를
--   볼 길이 없고, 반대로 의뢰서에서 어느 장비 건인지도 알 수 없다.
--
-- ── 무엇을 더하나 ────────────────────────────────────────────────────────
--   customer_id  어느 **사업장**인가(customers.customer_id — 회사가 아니라 사업장 줄)
--   device_id    어느 **장비**인가(devices.device_id). 장비가 정해지지 않은 의뢰도 있다.
--   둘 다 **nullable** 이다 — 지금까지 쌓인 의뢰서에는 이 값이 없고, 앞으로도
--   업체가 정해지지 않은 채 번호부터 받는 일이 있다.
--
-- ── 기존 줄은 손대지 않는다 ──────────────────────────────────────────────
--   이름이 비슷하다고 맞춰 넣지 않는다(백필 금지). 연결되지 않은 과거 건은
--   고객사 화면에 그냥 안 보일 뿐이고, 의뢰서 화면에서는 지금처럼 다 보인다.
--
-- 재실행 안전(add column if not exists · create index if not exists).

begin;

alter table public.inquiries
  add column if not exists customer_id bigint references public.customers(customer_id),
  add column if not exists device_id   bigint references public.devices(device_id);

comment on column public.inquiries.customer_id is
  '어느 사업장의 의뢰인가(customers). 사업장 줄을 가리킨다 — 회사 줄이 아니다. 비어 있을 수 있다(2026-11-20).';
comment on column public.inquiries.device_id is
  '어느 장비의 의뢰인가(devices). 장비가 정해지지 않은 의뢰도 있어 비어 있을 수 있다(2026-11-20).';

-- 고객사 화면이 「이 사업장의 의뢰서」를 읽는 길. 값이 있는 줄만 담는다
-- (지금은 거의 전부 null 이라 부분 인덱스가 훨씬 작다).
create index if not exists inquiries_customer_id_idx
  on public.inquiries (customer_id) where customer_id is not null;
create index if not exists inquiries_device_id_idx
  on public.inquiries (device_id) where device_id is not null;

commit;

-- ── 적용 뒤 **반드시** ───────────────────────────────────────────────────
--   PostgREST 는 스키마를 캐시한다. 다시 읽히지 않으면 새 칸이 `42703` 으로 안 보인다
--   (name_en 때 그대로 겪었다 — db/APPLIED.md).
notify pgrst, 'reload schema';

-- ── 확인 ─────────────────────────────────────────────────────────────────
-- select column_name, is_nullable, data_type
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'inquiries'
--    and column_name in ('customer_id', 'device_id');
-- → 두 줄이 나오고 is_nullable 이 YES 면 됐다.
