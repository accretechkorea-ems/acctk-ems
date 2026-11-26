-- 실측 뒷정리 — **지난 회차가 남긴 사건 세 줄** (2026-11-26)
--
-- 2026-11-25 회차의 정리 파일이 적용됐는데(장비·담당자·회사·사업장·실측 계정 전부 지워졌다 —
-- 2026-11-26 조회로 확인), `customer_events` 세 줄이 남았다. 두 가지 까닭이다.
--
--   ① `db/cleanup_verify_rows_20261125.sql` 의 한 줄이 **없는 칸**을 가리킨다:
--
--        delete from customer_events where contact_id = 1642;
--
--      `customer_events` 에는 `contact_id` 칸이 **없다**(칸은 id · customer_id · event_type ·
--      occurred_at · actor_engineer_id · payload · created_at 일곱이다). 그래서 그 문장은
--      42703 으로 떨어지고, 담당자 사건(174)이 남았다.
--      ⚠ 그 파일은 **고치지 않았다** — 이미 적용된 파일이라 기록으로 둔다. 남은 줄만 여기서 지운다.
--
--   ② `db/cleanup_verify_devices_20261125.sql` 은 장비 두 줄(1648·1649)만 지우고
--      **그 장비가 남긴 사건**(195·196)은 적지 않았다.
--
-- 지울 줄 — **적힌 id 셋뿐**이다. 이름·접두사·범위로 지우는 문장은 없다.
--
--   customer_events 174 — 사업장 593 · contact_edited · 「[검증용] 담당자」 추가
--   customer_events 195 — 사업장 593 · device_edited · 「[검증용] 삭제확인 장비 DEL-TEST」 추가
--   customer_events 196 — 사업장 593 · device_edited · 「[검증용] 삭제확인 장비 DEL-TEST」 추가
--
-- 세 줄이 가리키던 담당자(contacts 1642)와 장비(devices 1648·1649)는 **이미 없다**.
-- 사업장 593 은 **운영 사업장**이다 — 그 줄은 건드리지 않는다. 여기서 지우는 것은 사건뿐이다.


-- ── [0단계] 지울 줄을 눈으로 먼저 본다 ───────────────────────────────────
--
-- select id, customer_id, event_type, occurred_at, actor_engineer_id, payload
--   from public.customer_events
--  where id in (174, 195, 196)
--  order by id;
--
--   → 셋 다 payload 에 「[검증용]」 이 들어 있어야 한다. 없으면 **돌리지 말고** 알려 달라.


-- ── [1단계] 지운다 ───────────────────────────────────────────────────────
delete from public.customer_events where id in (174, 195, 196);


-- ── [확인] ───────────────────────────────────────────────────────────────
-- select count(*) from public.customer_events where id in (174, 195, 196);   → 0
--
-- 사업장 593 에 남는 사건이 운영 자료뿐인지도 함께 본다:
-- select id, event_type, occurred_at from public.customer_events
--  where customer_id = 593 order by id;                                      → 0행
