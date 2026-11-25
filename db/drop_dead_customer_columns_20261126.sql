-- customers 의 **죽은 칸** — 조사 결과와 지우는 문장 (2026-11-26)
--
-- ⚠ **판단 필요 — 돌리기 전에 사람이 정한다.** 코드에서 읽지도 쓰지도 않는 것은
--    확인했지만, 지우면 **값이 사라진다**(되돌릴 수 없다). 옛 자료를 남겨 둘 까닭이
--    있는지는 사람이 안다. 지우지 않고 그냥 두어도 화면은 아무 영향이 없다.
--
-- ── 조사(2026-11-26, 코드 전수) ───────────────────────────────────────────
--   읽는 곳 = select 목록·`.칸이름` 접근 · 쓰는 곳 = insert/update 의 키.
--
--   칸              읽기  쓰기  메모
--   ───────────────────────────────────────────────────────────────────────
--   agency          0     0    대리점을 글자로 적던 옛 칸. 2026-11-19 의 CRM 정리
--                              (db/crm_cleanup_20261118.sql)로 `agency_customer_id`
--                              (대리점 줄 FK)로 옮겼다. 엑셀의 「대리점」 열도 그 FK 로
--                              이름을 찾는다(lib/customerExportData.ts 198줄).
--   category        0     0    고객사 분류의 옛 칸. 지금 쓰는 것은 `industry` 다.
--                              (코드의 category 190건은 전부 **장비·견적**의 칸이다)
--   total_revenue   0     0    업체별 매출 합계를 들고 있던 칸. 지금은 quotes 에서
--                              그때그때 센다(lib/salesStats.ts).
--   division        0     0    고객사의 사업부. 사업부는 **팀·직원·명함**이 들고 있고
--                              고객사 줄에서는 아무도 읽지 않는다.
--
--   함께 본 것(살아 있다 — 지우지 않는다): region1·region2·latitude·longitude·
--   created_at·name_en·industry·note·status·is_agency·agency_customer_id·
--   parent_customer_id·is_parent·site_name·deleted_at.
--
-- ── 돌리기 전에 ──────────────────────────────────────────────────────────
--   ① 값이 남아 있는 줄이 몇인지 본다(아래 [0단계]).
--   ② 남겨야 할 값이 있으면 백업표를 먼저 뜬다([1단계] 주석).
--   ③ 그 뒤에 [2단계] 를 돌린다. **재실행 안전**(drop column if exists).


-- ════════════════════════════════════════════════════════════════
-- [0단계] 값이 든 줄 세기
-- ════════════════════════════════════════════════════════════════
--
--   select count(*) filter (where agency is not null and btrim(agency) <> '')        as agency,
--          count(*) filter (where category is not null and btrim(category) <> '')    as category,
--          count(*) filter (where total_revenue is not null and total_revenue <> 0)  as total_revenue,
--          count(*) filter (where division is not null and btrim(division) <> '')    as division,
--          count(*)                                                                  as 전체
--     from public.customers;


-- ════════════════════════════════════════════════════════════════
-- [1단계] 백업(값을 남기고 싶을 때만)
-- ════════════════════════════════════════════════════════════════
--
--   create table public.customers_dead_cols_backup_20261126 as
--   select customer_id, agency, category, total_revenue, division
--     from public.customers
--    where agency is not null or category is not null
--       or total_revenue is not null or division is not null;


-- ════════════════════════════════════════════════════════════════
-- [2단계] 지우기 — **사람이 정한 뒤에**
-- ════════════════════════════════════════════════════════════════

-- alter table public.customers
--   drop column if exists agency,
--   drop column if exists category,
--   drop column if exists total_revenue,
--   drop column if exists division;

-- notify pgrst, 'reload schema';
