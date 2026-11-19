-- db/company_industry_from_leads_20261119.sql
--
-- **리드에 적힌 산업군으로 회사의 분류를 채운다** — 분류가 빈 회사만.
--
-- ── 얼마나 채워지나 ──────────────────────────────────────────────────────
--   2026-11-19 실측: 회사 841곳 중 분류 없음 **838**곳. 리드 25건 중 `customer_id` 와
--   `industry` 가 둘 다 있는 것은 **4건**이고, 그것으로 채울 수 있는 회사는 **3곳**이다.
--     2924 명신정공 · 2657 디엠모티브 · 2611 MNC Solution  (셋 다 `3.자동차 - 기타`)
--
--   838곳 중 3곳이라 이 파일 하나로는 거의 달라지지 않는다. 나머지는 화면에서 채운다 —
--   고객사 목록 보기의 「분류 없음」 칩 + 트리 체크 + 「분류 일괄 지정」.
--   그래도 적어 두는 이유: 리드가 쌓이면 같은 SQL 을 다시 돌려 그만큼 덜 손대도 된다.
--
-- 재실행 안전(이미 분류가 있는 회사는 건드리지 않는다).

-- ① 돌리기 전에 몇 줄이 바뀔지 본다.
select p.customer_id, p.company_name, l.industry
from public.leads l
join public.customers s on s.customer_id = l.customer_id and s.deleted_at is null
join public.customers p
  on p.customer_id = (case when s.is_parent then s.customer_id else s.parent_customer_id end)
where l.industry is not null and btrim(l.industry) <> ''
  and p.is_parent and p.deleted_at is null
  and (p.industry is null or btrim(p.industry) = '')
order by p.customer_id;

-- ② 채운다. 한 회사에 리드가 여럿이면 **가장 최근 리드**의 산업군을 쓴다.
update public.customers c set industry = src.industry
from (
  select distinct on (p.customer_id) p.customer_id, btrim(l.industry) as industry
  from public.leads l
  join public.customers s on s.customer_id = l.customer_id and s.deleted_at is null
  join public.customers p
    on p.customer_id = (case when s.is_parent then s.customer_id else s.parent_customer_id end)
  where l.industry is not null and btrim(l.industry) <> ''
    and p.is_parent and p.deleted_at is null
    and (p.industry is null or btrim(p.industry) = '')
  order by p.customer_id, l.created_at desc
) src
where c.customer_id = src.customer_id;

-- ③ 확인 — ① 에 나왔던 회사의 분류가 채워졌는지, 그리고 남은 빈 회사 수.
select customer_id, company_name, industry
from public.customers
where customer_id in (2924, 2657, 2611);

select count(*) as 분류없는회사
from public.customers
where is_parent and deleted_at is null and (industry is null or btrim(industry) = '');
