-- 실측 뒷정리 — **V8 회차에 내가 만든 줄만** (2026-11-25)
--
-- 사업장 화면 V8 · 장비 권한 개방 · 사진 크게 보기 실측으로 만든 [검증용] 줄이다.
-- 실측 계정(일반 member)은 **숨기기**까지만 할 수 있어 줄 자체는 남아 있다.
-- 적힌 id 만 지운다 — 이름·접두사로 지우는 문장은 없다.
--
--   customers       3126  [검증용] V8 실측회사 (회사 줄, is_parent)
--                   3127  [검증용] V8 실측회사 » [검증용] 본사 (사업장 줄 — 실측에서
--                         상태를 「이탈」로 바꾸고, 그 뒤 숨겼다. deleted_at 찍혀 있다)
--   contacts        1643 · 1644 · 1645   [검증용] 정동효 · 박수철 · 허원석
--                         (휴대폰 있음 / 이메일 없음 / 휴대폰 없음 — 담당자 카드의 세 경우)
--   devices         1651  [검증용] V8 장비 SURFCOM-V8 (S/N V8-VERIFY-001)
--   customer_events 201 · 202 · 203 · 204 · 207 · 219
--                         (장비 등록 2 · 장비 삭제 1 · 장비 복구 1 · 상태 이탈 1 · 사업장 삭제 1)
--
-- 함께 확인한 것(지울 것이 없다)
--   · service_history · sales_activities · quotes 에 이 두 업체를 가리키는 줄은 **0** 이다.
--   · 저장소 `device-images` 에 남은 파일 **없음** — 실측 중에 화면의 「사진 삭제」로
--     지웠다(그 버튼이 DB 칸과 파일을 함께 지운다). 버킷을 훑는 문장은 여기 없다.
--   · 장비 1650(첫 실측에서 만든 같은 장비)은 실측을 처음부터 다시 돌리려고 그 자리에서
--     id 하나로 지웠다 — 남아 있지 않다.
--
-- 지우기 전에 아래 select 로 지울 줄을 눈으로 본다.

-- 확인용
-- select customer_id, company_name, site_name, status, deleted_at
--   from public.customers where customer_id in (3126, 3127);
-- select contact_id, name from public.contacts where contact_id in (1643, 1644, 1645);
-- select device_id, device_name, device_name2, serial_number
--   from public.devices where device_id in (1651);
-- select id, event_type, payload from public.customer_events
--  where id in (201, 202, 203, 204, 207, 219);

begin;

delete from public.customer_events where id in (201, 202, 203, 204, 207, 219);
delete from public.devices        where device_id in (1651);
delete from public.contacts       where contact_id in (1643, 1644, 1645);
-- 사업장을 먼저, 회사를 나중에 — 사업장이 회사를 가리킨다(parent_customer_id).
delete from public.customers      where customer_id in (3127);
delete from public.customers      where customer_id in (3126);

commit;

-- ── 확인 ─────────────────────────────────────────────────────────────────
--   select count(*) from public.customers where customer_id in (3126, 3127);   → 0
--   select count(*) from public.contacts  where contact_id in (1643,1644,1645); → 0
--   select count(*) from public.devices   where device_id in (1651);            → 0
