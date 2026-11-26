-- 실주 사유 — **옛 CHECK 제약을 뗀다** (2026-11-26)
--
-- ── 무엇이 막혀 있었나 ───────────────────────────────────────────────────
--   db/lost_reasons_20261126.sql 을 적용한 뒤, 포캐스트에서 「경쟁사」를 사유로 골라
--   실주 처리를 누르면 저장이 **23514 로 전부 막혔다**(2026-11-26 실측).
--
--     [opportunity] mark lost failed
--     { code: 23514, message: new row for relation "sales_opportunities"
--       violates check constraint "sales_opportunities_lost_reason_check" }
--
--   까닭: `sales_opportunities.lost_reason`(옛 **글자** 칸)에 값 목록을 못 박은 CHECK 가
--   그대로 남아 있다. 지금 쓰고 있는 값은 셋뿐이다 — 「사양·기술」·「경쟁사 선정」·「가격」
--   (2026-11-26 조회). 새 사유 목록(lost_reasons 표)의 이름은 그 셋과 다르므로
--   **표를 적용해도 실주가 되지 않는다.**
--
-- ── 왜 제약을 떼는 것이 맞나 ─────────────────────────────────────────────
--   사유 목록을 표로 옮긴 까닭이 바로 「코드·SQL 을 고치지 않고 사유를 더하는 것」이다.
--   글자 칸에 값 목록을 못 박아 두면 표를 둔 뜻이 사라진다 — 관리 화면에서 사유를 하나
--   더할 때마다 이 제약을 손으로 또 고쳐야 한다(그래서 한 번 고쳤고, 또 막혔다).
--   값을 지키는 일은 이제 **FK** 가 한다: `lost_reason_id → lost_reasons(reason_id)`.
--   글자 칸은 **지난 줄의 기록**으로만 남는다(지우지 않는다 — 옛 세 값이 거기 있다).
--
-- ── 적용 전에도 화면은 돈다 ───────────────────────────────────────────────
--   hooks/customer/useOpportunityCrud.ts 의 markLost 가 **23514 를 받으면 글자 칸을 빼고
--   다시 쓴다**(42703 폴백과 같은 모양이다). 그래서 적용 전에는 사유가 **id 로만** 남고
--   옛 글자 칸은 비어 있다. 적용하면 글자도 함께 들어간다(목록·엑셀이 그 글자를 읽는다).
--
-- 재실행 안전 — 없으면 아무 일도 하지 않는다.


-- ── [0단계] 무엇이 걸려 있는지 **눈으로 먼저 본다** ──────────────────────
--
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid = 'public.sales_opportunities'::regclass
--      and contype = 'c';
--
--   → lost_reason 이 들어 있는 정의가 보이면 그것이 범인이다.
--     이름이 아래와 다르면 **그 이름으로 바꿔** 돌린다.
--
--   지금 들어 있는 값도 함께 본다(지울 값은 없다 — 제약만 뗀다):
--
--   select lost_reason, count(*) from public.sales_opportunities
--    where lost_reason is not null group by lost_reason order by 2 desc;


-- ── [1단계] 제약을 뗀다 ──────────────────────────────────────────────────
alter table public.sales_opportunities
  drop constraint if exists sales_opportunities_lost_reason_check;

comment on column public.sales_opportunities.lost_reason is
  '실주 사유의 **글자**(지난 기록). 값 목록은 lost_reasons 표가 쥐고 lost_reason_id 로 건다 — 2026-11-26 에 CHECK 를 뗐다.';


-- ── [확인] ───────────────────────────────────────────────────────────────
--   select count(*) from pg_constraint
--    where conrelid = 'public.sales_opportunities'::regclass
--      and conname = 'sales_opportunities_lost_reason_check';   → 0
--
--   그 뒤 화면에서 포캐스트 하나를 「경쟁사」로 실주 처리해 본다 —
--   lost_reason · lost_reason_id · competitor · lost_at 넷이 함께 찍혀야 한다.

notify pgrst, 'reload schema';
