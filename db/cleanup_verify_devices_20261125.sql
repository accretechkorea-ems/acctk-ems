-- 실측 뒷정리 — **내가 만든 장비 두 줄만** (2026-11-25)
--
-- 장비 삭제 확인창(E) 실측으로 사업장 593 에 만든 [검증용] 장비다. 실측 계정이
-- 슈퍼관리자가 아니라 화면·라우트로는 지울 수 없었다(지우기는 슈퍼관리자만).
--
--   devices 1648 · 1649 — 「[검증용] 삭제확인 장비 DEL-TEST」 · S/N VERIFY-DEL-001
--
-- 적힌 id 만 지운다. 이름·접두사로 지우는 문장은 없다.
-- 지우기 전에 아래 select 로 그 두 줄을 눈으로 본다.

-- 확인용
-- select device_id, device_name, device_name2, serial_number, customer_id
--   from public.devices where device_id in (1648, 1649);

begin;

-- 장비에 딸린 기록이 없어야 한다(실측 장비라 서비스 이력이 없다).
delete from public.devices where device_id in (1648, 1649);

commit;

-- 화면에서 숨기기만 하려면(되돌릴 수 있는 쪽):
--   update public.devices set deleted_at = now() where device_id in (1648, 1649);
