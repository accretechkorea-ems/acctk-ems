-- 하나무역 — 사명이 대리점 자신으로 들어간 견적 5건을 제자리로 (2026-11-28, 야간4 8-3)
--
-- 근거: docs/hanamuyeok-quotes-20261128.md
--
-- ── 무엇을 고치나 ─────────────────────────────────────────────────────────
--   하나무역은 customers 에 두 줄이다.
--     2574  회사(is_parent)  — 껍데기다. 붙어 있는 것이 아무것도 없고 자식은 1767 하나뿐이다.
--     1767  대리점(is_agency) — 견적·담당자·사건이 여기 붙어 있다.
--
--   견적의 올바른 모습은(lib/quoteCustomerPick.ts, 2026-11-20부터)
--     직판    customer_id = 사업장        dealer_id = NULL
--     대리점  customer_id = **E.U 사업장**  dealer_id = 대리점
--
--   하나무역에 걸린 견적은 14건인데, 그 가운데
--     9건은 이미 「dealer_id = 1767 · customer_id = 실제 고객사」로 **맞게** 들어가 있다.
--     5건은 「customer_id = 1767 · dealer_id = NULL」이다 — 사명 칸에 대리점 자신이 들어갔다.
--   이 파일은 **그 5건만** 고친다. 9건을 함께 옮기면 맞는 줄의 사명을 지우는 일이 된다.
--
-- ── E.U 는 비워 둔다 ──────────────────────────────────────────────────────
--   5건의 수신인은 모두 하나무역 대표(김광옥)라 견적 안에 E.U 단서가 없다. 그래서
--   customer_id 를 NULL 로 둔다. quotes.customer_id 는 NULL 을 받는다(필수 칸은
--   quote_id·quote_number·quote_date·created_by 넷뿐이다).
--
--   화면은 그 동안 「E.U 미지정」으로 적는다(lib/quoteEuName.ts 의 EU_UNSET_LABEL).
--   견적 수정 모달을 열면 사명 칸에 하나무역(대리점)이 서고 E.U 칸이 빈 채로 열리며,
--   저장할 때 E.U 는 여전히 필수다 — 비어 있는 것이 **고치라는 표시**로 남는다.
--
-- 재실행해도 안전하다(이미 옮긴 줄은 WHERE 에 걸리지 않고, 사건은 같은 날 같은 종류를
-- 다시 쓰지 않는다).

-- ═══════════════════════════════════════════════════════════════════════════
-- [0단계] 적용 전에 **먼저 돌려 보고** 눈으로 확인한다. 아무것도 바꾸지 않는다.
-- ═══════════════════════════════════════════════════════════════════════════

-- 0-1. 고칠 5건 — 이 다섯 줄이 나와야 한다.
--      No.CMJ20261104-A/B/C/D · No.CMJ20261116-A (공급가 합 5,847,000)
select q.quote_id, q.quote_number, q.quote_date, q.status, q.total_supply,
       q.customer_id as 사명_id, q.dealer_id as 대리점_id, q.recipient, e.name as 작성자
  from quotes q
  left join engineers e on e.engineer_id = q.engineer_id
 where q.customer_id = 1767
   and q.dealer_id is null
 order by q.quote_date, q.quote_id;

-- 0-2. 손대지 않는 9건 — 이미 맞는 모습이다. 이 조회가 9건이어야 한다.
select q.quote_id, q.quote_number, q.quote_date, q.status,
       q.customer_id as 사명_id, c.company_name as 사명, q.dealer_id as 대리점_id
  from quotes q
  left join customers c on c.customer_id = q.customer_id
 where q.dealer_id = 1767
 order by q.quote_date, q.quote_id;

-- 0-3. 회사 2574 에 붙어 있는 것 — 전부 0 이어야 한다(견적·장비·활동·담당자·포캐스트·의뢰서).
select
  (select count(*) from quotes             where customer_id = 2574) as 견적,
  (select count(*) from devices            where customer_id = 2574) as 장비,
  (select count(*) from sales_activities   where customer_id = 2574) as 활동,
  (select count(*) from contacts           where customer_id = 2574) as 담당자,
  (select count(*) from sales_opportunities where customer_id = 2574) as 포캐스트,
  (select count(*) from inquiries          where customer_id = 2574) as 의뢰서,
  (select count(*) from customers
    where parent_customer_id = 2574 and deleted_at is null)          as 살아있는_자식;

-- 0-4. 두 줄의 지금 모습.
select customer_id, company_name, site_name, is_parent, is_agency,
       parent_customer_id, agency_customer_id, deleted_at
  from customers
 where customer_id in (1767, 2574)
 order by customer_id;

-- ═══════════════════════════════════════════════════════════════════════════
-- [본문] 트랜잭션 하나. 위 조회가 예상과 다르면 **돌리지 말고** 보고한다.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. 5건을 제자리로 ─────────────────────────────────────────────────────
--   사명(customer_id) 을 비우고 대리점(dealer_id) 에 하나무역을 넣는다.
with moved as (
  update quotes
     set customer_id = null,
         dealer_id   = 1767
   where customer_id = 1767
     and dealer_id is null
  returning quote_id, quote_number
)
select count(*) as 옮긴_견적, string_agg(quote_number, ', ' order by quote_number) as 번호
  from moved;
-- 기대: 옮긴_견적 = 5 (재실행 때는 0)

-- ── 2. 사건으로 남긴다 ────────────────────────────────────────────────────
--   활동 이력이 읽는 표다. event_type 은 새 값(quote_dealer_moved)이고 payload 가 무엇을
--   옮겼는지 담는다. 같은 날 같은 종류가 이미 있으면 다시 쓰지 않는다(재실행 안전).
insert into customer_events (customer_id, event_type, occurred_at, actor_engineer_id, payload)
select 1767,
       'quote_dealer_moved',
       now(),
       null,
       jsonb_build_object(
         'reason',  '사명 칸에 대리점 자신이 들어가 있던 견적을 대리점 칸으로 옮김',
         'doc',     'docs/hanamuyeok-quotes-20261128.md',
         'dealer_id', 1767,
         'eu',      null,
         'quotes',  (select coalesce(jsonb_agg(jsonb_build_object('quote_id', quote_id, 'quote_number', quote_number)
                                               order by quote_number), '[]'::jsonb)
                       from quotes where dealer_id = 1767 and customer_id is null)
       )
 where not exists (
   select 1 from customer_events
    where customer_id = 1767
      and event_type = 'quote_dealer_moved'
      and occurred_at::date = now()::date
 );

-- ── 3. 껍데기 회사 2574 ───────────────────────────────────────────────────
--   2574 에는 견적·장비·활동·담당자·포캐스트·의뢰서가 **모두 0건**이다. 지울 수 있는
--   줄이다. 그런데 **1767 이 2574 를 부모로 두고 있어서**, 화면의 회사 삭제는 이 상태를
--   막는다(app/api/customer-delete/route.ts:240 — 「회사 줄은 묶인 사업장이 없을 때만 지운다」).
--
--   1767 의 parent_customer_id 를 비우면 2574 를 지울 수 있다. 그런데 그 값은 1767 이
--   **고객사 목록에 보이는 유일한 이유**다 — lib/customerAgency.ts 의
--     NOT_AGENCY_ONLY = 'is_agency.eq.false,parent_customer_id.not.is.null'
--   가 「대리점이 아니거나, 대리점이어도 어느 회사에 묶여 있는 줄」만 목록에 세운다.
--   1767 은 is_agency = true 이므로 부모를 떼면 **고객사 목록에서 사라진다**(대리점 화면에는
--   그대로 남는다).
--
--   ⇒ **판단 필요**. 하나무역이 우리 고객사 목록에 있어야 하는지는 데이터가 답해 주지 않는다
--     (장비 0대 · 활동 0건). 아래 두 줄은 **주석으로 둔다** — Kevin 이 고른 뒤에 푼다.
--
--   ㉮ 그대로 둔다      : 아무것도 풀지 않는다. 껍데기 2574 한 줄이 남는다.
--   ㉯ 접는다          : 아래 두 문장을 함께 푼다. 하나무역은 대리점 화면에만 보인다.
--
-- update customers
--    set parent_customer_id = null
--  where customer_id = 1767;
--
-- update customers
--    set deleted_at    = now(),
--        delete_reason = '대리점과 중복 등록 — 견적은 대리점 1767 로 옮겼다(야간4 8-3)'
--  where customer_id = 2574
--    and deleted_at is null
--    and not exists (select 1 from customers
--                     where parent_customer_id = 2574 and deleted_at is null
--                       and customer_id <> 1767);

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- [확인] 적용 뒤에 돌린다.
-- ═══════════════════════════════════════════════════════════════════════════

-- 사명이 빈 하나무역 대리점 건 5줄 + 사명이 있는 9줄 = 14줄.
select q.quote_id, q.quote_number, q.quote_date, q.status,
       coalesce(c.company_name, '(E.U 미지정)') as 사명,
       q.dealer_id as 대리점_id
  from quotes q
  left join customers c on c.customer_id = q.customer_id
 where q.dealer_id = 1767
 order by q.quote_date, q.quote_id;

-- 사명이 1767 인 견적은 0건이어야 한다.
select count(*) as 남은_잘못된_줄 from quotes where customer_id = 1767;

-- 사건 한 줄.
select id, customer_id, event_type, occurred_at, payload
  from customer_events
 where customer_id = 1767 and event_type = 'quote_dealer_moved'
 order by id desc;

-- 칸을 새로 만들지 않았으므로 스키마 재적재는 필요 없다. 그래도 한 번 치는 것은 해롭지 않다.
notify pgrst, 'reload schema';
