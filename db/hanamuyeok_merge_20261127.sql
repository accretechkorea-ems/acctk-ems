-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  사용 안 함 — 폐기됨 (2026-11-28, 야간4 8-3)                             ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
--   **이 파일은 적용하지 않는다.** 대신 db/hanamuyeok_quotes_move_20261128.sql 을 쓴다.
--
--   여기서는 1767 과 2574 를 「합치는/떼어내는」 쪽으로 짰다. 그 뒤 견적을 다시 세어 보니
--   하나무역에 걸린 견적은 5건이 아니라 **14건**이고, 그 가운데
--     9건은 이미 「대리점 = 1767 · 사명 = 실제 고객사」로 **맞게** 들어가 있고
--     5건만  「사명 = 1767 · 대리점 = 빈칸」으로 **잘못** 들어가 있다.
--   할 일은 줄을 합치는 것이 아니라 **그 5건의 사명·대리점 칸을 바로잡는 것**이다.
--   껍데기 회사 2574 를 접는 일은 새 파일에서 **판단 필요**로 남겨 두었다
--   (1767 의 부모를 떼면 고객사 목록에서 사라진다 — docs/hanamuyeok-quotes-20261128.md).
--
--   아래 본문은 **그대로 두되 돌리지 않는다**. 조사 기록으로 남긴다.
--
-- 하나무역 **회사 → 대리점 정리** (2026-11-27, 묶음5 10-2)
--
-- ⚠⚠ **본문은 전부 주석이다.** docs/hanamuyeok-20261127.md 의 ③ 표에 Kevin 이 E.U 를
--     채우고, ⑤ 의 물음 넷에 답한 뒤에 푼다. 지금 돌리면 [0단계] 조회만 나온다.
--
-- ── 조사에서 나온 것 — 지시문이 본 모습과 **다르다** ────────────────────
--   지시는 「회사와 대리점 둘 다 등록돼 견적이 흩어짐」이었는데, 실제로는
--   **두 줄이 부모·자식**이다:
--
--     2574  회사   하나무역          (주소·담당자·사건 **아무것도 없다** — 껍데기)
--     1767  대리점 하나무역  부모=2574  (주소·담당자 있음. 견적 5건이 **여기** 붙어 있다)
--
--   즉 옮길 견적이 흩어져 있지 않다. 할 일은 **껍데기 회사를 떼어 내는 것**에 가깝다.
--   그래서 아래 본문도 「옮기기」보다 「떼어내기」 쪽이 크다. **판단 필요**(docs ⑤).
--
-- ── 지키는 것 ────────────────────────────────────────────────────────────
--   · 전부 한 트랜잭션. 가운데서 실패하면 아무것도 바뀌지 않는다.
--   · 재실행 안전 — where 가 이미 끝난 줄을 거른다.
--   · **E.U 가 비면 그대로 둔다**(지시). 코드가 빈 customer_id 를 받아 준다는 것은
--     docs 의 ④ 에서 확인했다 — 화면·집계 어디도 터지지 않는다.


-- ════════════════════════════════════════════════════════════════════════
-- [0단계] 조회 — 바꾸기 전에 눈으로 본다
-- ════════════════════════════════════════════════════════════════════════

-- 0-1. 두 줄이 아직 그대로인가 (2026-11-27: 회사 2574 · 대리점 1767, 부모 2574)
select customer_id, company_name, is_parent, is_agency, parent_customer_id, deleted_at, address
  from public.customers
 where company_name ilike '%하나무역%'
 order by customer_id;

-- 0-2. 옮길 견적 (2026-11-27: **5건** — CMJ20261104-A~D · CMJ20261116-A, 전부 작성자 43 조민준)
select q.quote_id, q.quote_number, q.quote_date, q.status, q.total_amount,
       q.customer_id, q.dealer_id, e.name as writer
  from public.quotes q
  left join public.engineers e on e.engineer_id = q.engineer_id
 where q.customer_id in (2574, 1767)
 order by q.quote_date, q.quote_number;

-- 0-3. 대리점 **본업** — 건드리지 않는 것 (2026-11-27: 견적 9건 · 사업장 50곳)
select 'dealer_id = 1767 인 견적' as what, count(*) from public.quotes where dealer_id = 1767
union all
select 'agency_customer_id = 1767 인 사업장', count(*) from public.customers where agency_customer_id = 1767 and deleted_at is null;

-- 0-4. 두 줄에 걸린 나머지 (2026-11-27: 담당자 1명·사건 2건, 나머지 0)
select 'devices' as t, count(*) from public.devices where customer_id in (2574, 1767)
union all select 'sales_activities', count(*) from public.sales_activities where customer_id in (2574, 1767)
union all select 'sales_opportunities', count(*) from public.sales_opportunities where customer_id in (2574, 1767)
union all select 'inquiries', count(*) from public.inquiries where customer_id in (2574, 1767)
union all select 'repairs', count(*) from public.repairs where customer_id in (2574, 1767)
union all select 'contacts', count(*) from public.contacts where customer_id in (2574, 1767)
union all select 'customer_events', count(*) from public.customer_events where customer_id in (2574, 1767);

-- 0-5. 회사 2574 아래에 **대리점 말고** 다른 사업장이 있는가 (있으면 ④ 를 돌리면 안 된다)
select customer_id, company_name, site_name, is_agency, deleted_at
  from public.customers where parent_customer_id = 2574;


-- ════════════════════════════════════════════════════════════════════════
-- 본문 — **전부 주석**. docs 의 표를 채운 뒤 푼다.
-- ════════════════════════════════════════════════════════════════════════

-- begin;

-- ── ① 견적 다섯의 **E.U(실제 수요처)** 를 채운다 ───────────────────────
--
--   docs/hanamuyeok-20261127.md ① 표의 「E.U (Kevin 기입)」 칸을 그대로 옮겨 적는다.
--   아래는 **자리표시**다 — 사업장 id 를 넣어야 돈다.
--   비워 둔 줄은 **그대로 둔다**(건너뛴다) — 틀린 회사에 붙이는 것보다 비는 쪽이 낫다.
--
-- update public.quotes q
--    set customer_id = v.eu_customer_id,     -- ← E.U 사업장 id
--        dealer_id   = 1767                  -- ← 하나무역을 **대리점으로** 세운다
--   from (values
--     -- (견적번호,                E.U 사업장 id)
--     ('No.CMJ20261104-A', NULL::bigint),   -- TODO Kevin
--     ('No.CMJ20261104-B', NULL::bigint),   -- TODO Kevin
--     ('No.CMJ20261104-C', NULL::bigint),   -- TODO Kevin
--     ('No.CMJ20261104-D', NULL::bigint),   -- TODO Kevin
--     ('No.CMJ20261116-A', NULL::bigint)    -- TODO Kevin
--   ) as v(quote_number, eu_customer_id)
--  where q.quote_number = v.quote_number
--    and v.eu_customer_id is not null;      -- **빈 칸은 건너뛴다**(지시)

-- ── ② 장비·활동 등이 있으면 어디로 ─────────────────────────────────────
--
--   2026-11-27 조사에서는 **전부 0건**이었다(docs ③). 그 사이에 생겼으면 0단계 0-4 가
--   잡아낸다 — 그때 이 자리에 옮기는 문장을 적는다.
--
-- update public.devices          set customer_id = NULL::bigint where customer_id = 2574;  -- TODO 대상 없음
-- update public.sales_activities set customer_id = NULL::bigint where customer_id = 2574;  -- TODO 대상 없음

-- ── ③ 담당자·사건은 **그대로 둔다** ────────────────────────────────────
--   김광옥 사장은 **대리점의 사람**이다. 1767 에 그대로 있는 것이 맞다.

-- ── ④ 회사 껍데기 2574 를 소프트 삭제 ──────────────────────────────────
--
--   ⚠ 먼저 정해야 한다(docs ⑤-1): 대리점 줄 1767 을 회사에서 **떼어** 독립시킬 것인가.
--     떼지 않고 회사만 지우면 1767 의 parent_customer_id 가 **지워진 줄**을 가리킨다.
--     아래 두 줄은 **한 쌍**이다 — 함께 풀거나 함께 둔다.
--
-- update public.customers set parent_customer_id = null where customer_id = 1767;
-- update public.customers
--    set deleted_at = now(), delete_reason = '회사/대리점 중복 정리 — 껍데기 회사 (2026-11-27)'
--  where customer_id = 2574 and deleted_at is null;

-- ── ⑤ 남은 FK 0건 확인 — 하나라도 남으면 되돌린다 ──────────────────────
--
-- do $$
-- declare left_over int;
-- begin
--   select (select count(*) from public.quotes   where customer_id = 2574)
--        + (select count(*) from public.devices  where customer_id = 2574)
--        + (select count(*) from public.contacts where customer_id = 2574)
--        + (select count(*) from public.customers where parent_customer_id = 2574 and deleted_at is null)
--     into left_over;
--   if left_over > 0 then
--     raise exception '회사 2574 에 아직 % 건이 걸려 있다 — 되돌린다', left_over;
--   end if;
-- end $$;

-- commit;

-- notify pgrst, 'reload schema';
