-- 발주 메모 두 칸 (2026-09-22 DB 적용 완료). 기록용, 다시 실행하지 마라.
--
-- 한 견적에 메모가 두 개다. 성격도 쓰는 사람도 달라 칸을 나눴다.
--   order_memo          — 영업관리가 처리하며 남긴다(주문완료·일정 수정).
--                         /api/purchase-order 의 complete_order·update_schedule 이 쓴다.
--   order_request_memo  — 견적 작성자가 발주서를 올리며 남긴다(고객 요청·특이사항).
--                         /api/purchase-order 의 upload 만 쓴다.
--
-- 한 칸을 같이 쓰면 안 되는 이유: 두 action 모두 메모를 통째로 덮어쓴다(이어붙이지 않는다).
-- 영업관리가 주문완료를 누르는 순간 작성자 메모가 사라지고, 작성자가 발주서를 다시 올리면
-- 영업관리 메모가 사라진다.

alter table public.quotes
  add column if not exists order_request_memo text;

comment on column public.quotes.order_request_memo is
  '발주서 등록 시 견적 작성자가 남긴 요청 메모(최대 500자). 영업관리가 쓰는 order_memo 와 구분한다.';

-- RLS 는 기존 quotes 정책을 그대로 쓴다. 행 단위 정책이라 새 컬럼에 자동 적용된다.
-- 쓰기는 /api/purchase-order(service role)만 한다 — 화면은 읽기만 한다.
