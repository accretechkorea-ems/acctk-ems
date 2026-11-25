-- 미수주(실패) 견적을 **「견적중」으로 되돌린 자국** (2026-11-25)
--
-- ── 왜 ───────────────────────────────────────────────────────────────────
-- 발주서 등록을 놓쳐 유효기간이 지나면 자동 실주(/api/auto-fail)가 그 견적을 '실패' 로
-- 바꾼다. 그 건을 SQL 로 '견적중' 으로 되돌려 놓으면 **다음 날 다시 실패가 된다** —
-- 만료 기준이 작성일이라, 작성일이 이미 한 달을 넘긴 건은 되돌리는 순간 또 만료다.
--
-- 그래서 「언제 되돌렸나」를 적는다. 만료 기준일을 **coalesce(revived_at, quote_date)**
-- 로 바꾸면 되돌린 날부터 다시 1개월이 산다(기간 상수는 그대로 — 작성일 + 1개월 − 1일).
-- 그 기간이 또 지나면 다시 실패가 되는 것은 정상이다.
--
-- ── 누가 ─────────────────────────────────────────────────────────────────
-- 되돌리기는 **관리 메뉴를 가진 사람**(+ superadmin)만 한다. 쓰기는 라우트
-- (/api/quote-revive, service role)가 하고, 등급은 서버에서 다시 센다.
-- 이 저장소에 'admin' 등급은 없다(engineers.permission_level 은 superadmin · member).
-- 그래서 「admin 이상」은 **관리 메뉴 권한**으로 읽는다 — lib/permissions 의 canViewMenu.
--
-- ── 되돌린 까닭 ──────────────────────────────────────────────────────────
-- 사유는 필수다. 사건 표가 없는 자리라 revive_reason 칸에 담고, quotes.note 끝에
-- 「[되돌림 yy-mm-dd 이름: 사유]」 한 줄을 덧붙여 목록에서도 보이게 한다.
--
-- 재실행 안전 — add column if not exists.

alter table public.quotes
  add column if not exists revived_at    timestamptz,
  add column if not exists revived_by    integer references public.engineers(engineer_id),
  add column if not exists revive_reason text;

comment on column public.quotes.revived_at is
  '미수주에서 견적중으로 되돌린 시각. 유효기간 기준일 = coalesce(revived_at, quote_date) — lib/quoteRevive.ts';
comment on column public.quotes.revived_by is '되돌린 사람(engineers).';
comment on column public.quotes.revive_reason is '되돌린 까닭(필수). 예: 발주서 등록 누락.';

-- ── 확인 ─────────────────────────────────────────────────────────────────
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'quotes'
--      and column_name in ('revived_at', 'revived_by', 'revive_reason');   → 3행
--   select quote_id, quote_number, status, revived_at, revive_reason
--     from public.quotes where revived_at is not null order by revived_at desc;

notify pgrst, 'reload schema';
