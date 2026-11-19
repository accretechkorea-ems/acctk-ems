-- db/region1_normalize_20261119.sql
--
-- **지역1 을 정본 17개 시도 약칭으로 통일한다.**
--
-- ── 지금 무엇이 섞여 있나(2026-11-19 실측) ───────────────────────────────
--   `customers.region1` 자체는 12종뿐이다:
--     경남 379 · 경기 346 · 경북 282 · 충남 81 · 충북 78 · 전남 22 · 전북 12 · 강원 11
--     **남부 37 · 중부 24** ← 시도가 아니라 사내 구역이다
--     null 961(회사 841 전부 + 사업장 120) · 빈 문자열 4
--
--   화면 필터에 「경기도」·「강원특별자치도」·「갈산리」가 떴던 것은 저장된 값이 아니라,
--   목록 화면이 **region1 이 비면 주소 첫 토큰을 그대로** 썼기 때문이다. 코드 쪽은
--   lib/region.ts 의 normalizeRegion() 으로 고쳤고(이 파일과 같은 매핑표를 쓴다),
--   이 파일은 **저장된 값**을 맞춘다.
--
-- ── 누가 region1 을 채우나 ───────────────────────────────────────────────
--   등록·수정 폼은 지금까지 이 칸을 **아예 쓰지 않았다**(그래서 새 줄은 늘 null 이었다).
--   이번 회차부터 저장할 때 주소에서 뽑아 normalizeRegion() 을 통과시킨다.
--   리드 전환(/api/lead-manage)은 `leads.city` 를 그대로 넣는다 — 그쪽도 같은 함수를 탄다.
--
-- ── 이 파일이 고치는 범위 ────────────────────────────────────────────────
--   사업장 1,396곳 기준: 이미 정본 1,211 · **주소로 고칠 수 있음 143** · 못 잡음 42.
--   못 잡는 42 중 **29곳은 새 대리점 줄**(1849~1877)로 주소가 없다 — 대리점은 지역이
--   없어도 된다. 나머지 13곳은 주소가 시도로 시작하지 않거나(갈산리·진영읍·녹동·산동면)
--   해외(946 서한오토멕시코)이거나 주소가 없다.
--
-- 재실행 안전(이미 정본인 줄은 건드리지 않는다).

-- ⓞ 되돌리기용 백업.
create table if not exists public.customers_region_backup_20261119 as
  select customer_id, region1, region2, address from public.customers;

select count(*) as 백업줄 from public.customers_region_backup_20261119;

-- ① 돌리기 전 분포.
select coalesce(nullif(btrim(region1), ''), '(빈값)') as region1, count(*)
from public.customers
where deleted_at is null and not is_parent
group by 1 order by 2 desc;

-- ② 주소 첫 토큰으로 정본 약칭을 다시 만든다. **이미 그 값인 줄은 건드리지 않는다.**
--    매핑표는 lib/region.ts 의 SIDO_MAP 과 같은 값이다 — 한쪽만 고치면 조용히 갈린다.
with m(token, short) as (values
  ('서울특별시','서울'),('서울시','서울'),('서울','서울'),
  ('부산광역시','부산'),('부산시','부산'),('부산','부산'),
  ('대구광역시','대구'),('대구시','대구'),('대구','대구'),
  ('인천광역시','인천'),('인천시','인천'),('인천','인천'),
  ('광주광역시','광주'),('광주시','광주'),('광주','광주'),
  ('대전광역시','대전'),('대전시','대전'),('대전','대전'),
  ('울산광역시','울산'),('울산시','울산'),('울산','울산'),
  ('세종특별자치시','세종'),('세종시','세종'),('세종','세종'),
  ('경기도','경기'),('경기','경기'),
  ('강원특별자치도','강원'),('강원도','강원'),('강원','강원'),
  ('충청북도','충북'),('충북','충북'),
  ('충청남도','충남'),('충남','충남'),
  ('전북특별자치도','전북'),('전라북도','전북'),('전북','전북'),
  ('전라남도','전남'),('전남','전남'),
  ('경상북도','경북'),('경북','경북'),
  ('경상남도','경남'),('경남','경남'),
  ('제주특별자치도','제주'),('제주도','제주'),('제주','제주')
)
update public.customers c set region1 = m.short
from m
where c.deleted_at is null and not c.is_parent
  and split_part(btrim(c.address), ' ', 1) = m.token
  and coalesce(btrim(c.region1), '') <> m.short;
-- 기대: 143줄

-- ③ 남은 비정본 값 — 42줄이 나와야 한다(대리점 29 + 주소가 시도로 시작하지 않는 13).
select customer_id, company_name, coalesce(nullif(btrim(region1), ''), '(빈값)') as region1,
       left(coalesce(address, ''), 30) as addr
from public.customers
where deleted_at is null and not is_parent
  and coalesce(btrim(region1), '') not in
      ('서울','부산','대구','인천','광주','대전','울산','세종','경기','강원','충북','충남','전북','전남','경북','경남','제주')
order by region1 nulls last, customer_id;

-- ④ 「남부」·「중부」 를 비운다 — 시도가 아니라 사내 구역이고, ② 가 못 잡은 줄은
--    주소가 없어 어느 시도인지 알 길이 없다. 틀린 값을 남겨 두는 것보다 비우는 쪽이 낫다
--    (화면 필터는 「없음」으로 묶어 보여 준다).
update public.customers set region1 = null
where deleted_at is null and btrim(coalesce(region1, '')) in ('남부', '중부');

-- ⑤ 끝난 뒤 분포 — 정본 17개 + (빈값) 만 남아야 한다.
select coalesce(nullif(btrim(region1), ''), '(빈값)') as region1, count(*)
from public.customers
where deleted_at is null and not is_parent
group by 1 order by 2 desc;

-- 되돌리기
-- update public.customers c set region1 = b.region1
--   from public.customers_region_backup_20261119 b where b.customer_id = c.customer_id;
-- drop table public.customers_region_backup_20261119;
