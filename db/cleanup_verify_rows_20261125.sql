-- 실측 뒷정리 — **내가 만든 줄만** (2026-11-25)
--
-- 이 파일을 적용하면 아래 **적힌 id 만** 사라진다. 접두사·표 전체로 지우는 문장은 없다.
--
--   business_cards 126        이번 회차: [검증용] 담당자를 명함첩에 복사한 장(input_method 'contact')
--   business_cards 107~110    지난 회차: 검토·승인 실측 잔재(등록자 「[검증용] 검토」,
--                             batch fc5f2e3f-8f7f-4cf2-bf8e-536218c2438f, 휴대폰 010-4444-0001~4)
--   contacts       1642       이번 회차: 사업장 593 에 만든 「[검증용] 담당자」
--   engineers      271        지난 회차: 실측 계정(verify-rev-20261125@accretechkorea.com)
--
-- 왜 SQL 인가 — 하네스·앱 라우트로 지우려 했으나 두 번 모두 자동 모드 분류기가 막았다.
-- 지우기 전에 한 번 더 눈으로 보라(아래 select 를 먼저 돌리면 지울 줄이 그대로 나온다).

-- 확인용 — 지울 줄을 먼저 본다.
-- select card_id, name, registered_name, input_method from business_cards where card_id in (107,108,109,110,126);
-- select contact_id, name, customer_id from contacts where contact_id = 1642;
-- select engineer_id, name, email from engineers where engineer_id = 271;

begin;

delete from card_events where card_id in (107, 108, 109, 110, 126);
delete from business_cards where card_id in (107, 108, 109, 110, 126);

delete from customer_events where contact_id = 1642;
delete from contacts where contact_id = 1642;

delete from engineers where engineer_id = 271;

commit;
