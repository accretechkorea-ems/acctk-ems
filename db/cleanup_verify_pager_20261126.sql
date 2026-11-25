-- 실측 뒷정리 — **이 회차(iOS·발주 쪽나누기·V8 후속)에 내가 만든 줄만** (2026-11-26)
--
-- 장비 사진·패킹리스트의 쓰기가 라우트를 거치는지 보려고 만든 [검증용] 줄이다.
-- 실측 계정(일반 member)은 **숨기기**까지만 할 수 있어 줄 자체는 남아 있다.
-- 적힌 id 만 지운다 — 이름·접두사로 지우는 문장은 없다.
--
--   customers       3130  [검증용] V8 실측회사 (회사 줄, is_parent)
--                   3131  [검증용] V8 실측회사 » [검증용] 본사 (사업장 줄)
--   contacts        1647 · 1648 · 1649   [검증용] 정동효 · 박수철 · 허원석
--   devices         1652  [검증용] C3 장비 C3-TEST
--   customer_events 220 · 221 · 222 · 223
--                         (장비 등록 · 사진 등록 · 패킹리스트 등록 · 사진 삭제)
--
-- 저장소(Storage)
--   device-images   남은 파일 **없음** — 실측 중에 화면의 「사진 삭제」로 지웠다
--                   (그 버튼이 칸과 파일을 함께 지운다. 2026-11-26 목록으로 확인).
--   packing-lists   `packing-1652-1795613573576.png` **한 개**가 남는다 —
--                   패킹리스트는 화면에 지우는 길이 없다. 대시보드에서 그 **파일 이름
--                   하나**를 지운다(버킷을 훑는 문장은 여기 없다).
--
-- 함께 확인한 것: service_history · sales_activities · quotes 에 이 두 업체를 가리키는
-- 줄은 **0** 이다.
--
-- 지우기 전에 아래 select 로 지울 줄을 눈으로 본다.

-- 확인용
-- select customer_id, company_name, site_name, deleted_at
--   from public.customers where customer_id in (3130, 3131);
-- select contact_id, name from public.contacts where contact_id in (1647, 1648, 1649);
-- select device_id, device_name, device_name2, packing_list_url
--   from public.devices where device_id in (1652);
-- select id, event_type, payload from public.customer_events
--  where id in (220, 221, 222, 223);

begin;

delete from public.customer_events where id in (220, 221, 222, 223);
delete from public.devices        where device_id in (1652);
delete from public.contacts       where contact_id in (1647, 1648, 1649);
-- 사업장을 먼저, 회사를 나중에 — 사업장이 회사를 가리킨다(parent_customer_id).
delete from public.customers      where customer_id in (3131);
delete from public.customers      where customer_id in (3130);

commit;

-- ── 확인 ─────────────────────────────────────────────────────────────────
--   select count(*) from public.customers where customer_id in (3130, 3131);    → 0
--   select count(*) from public.contacts  where contact_id in (1647,1648,1649); → 0
--   select count(*) from public.devices   where device_id in (1652);            → 0
