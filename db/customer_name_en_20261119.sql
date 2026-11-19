-- db/customer_name_en_20261119.sql
--
-- 회사 **영문명** — `customers.name_en`.
--
-- ── 왜 필요한가 ───────────────────────────────────────────────────────────
--   고객이 영문으로 부르는 이름(「HYUNDAI TRANSYS」)으로 찾는 일이 있다. 지금은 한글
--   이름만 있어 그때 검색이 비어 돌아온다. 견적서의 E.U 칸에 쓸지는 **이번에 정하지
--   않는다** — 칸만 만들고, 화면은 「찾기」와 「적어 두기」에만 쓴다.
--
-- ── 어디에 붙는가 ────────────────────────────────────────────────────────
--   **회사 줄(is_parent)에만** 적는다. 사업장마다 영문명을 따로 두면 같은 회사가 또
--   여러 표기로 갈린다(대리점·회사명이 그랬다). 칸 자체는 customers 한 표에 있으므로
--   사업장 줄에도 들어갈 수는 있지만, 화면은 회사 줄에서만 받는다.
--
-- ⚠ **이 파일을 먼저 돌린다.** 코드가 이 칸을 select 에 넣으므로, 칸이 없으면 고객사
--   목록·검색 조회가 통째로 실패한다(PostgREST 는 모르는 칸을 400 으로 돌려보낸다).
--
-- 재실행 안전(add column if not exists).

alter table public.customers add column if not exists name_en text;

comment on column public.customers.name_en is
  '회사 영문명. 회사 줄(is_parent)에만 적는다. 검색(홈·목록·견적 고객사·E.U)이 한글 이름과 함께 본다.';

-- 찾기용 인덱스 — 검색이 ilike '%...%' 라 trigram 이 맞다. 확장이 없으면 이 두 줄은
-- 건너뛰어도 된다(1,400줄짜리 표라 인덱스가 없어도 느리지 않다).
-- create extension if not exists pg_trgm;
-- create index if not exists customers_name_en_trgm on public.customers using gin (name_en gin_trgm_ops);

-- 확인 — 칸이 생겼는지.
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'customers' and column_name = 'name_en';
