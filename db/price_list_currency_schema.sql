-- 가격표 통화 칸 (2026-11-03 작성). **적용됨 — 2026-11-03, Kevin.**
--   같은 날 Kevin 이 exchange_rate.currency · quote_items.currency 도 함께 더했다
--   (그 둘은 파일이 없다 — db/APPLIED.md 「파일 없이 더한 칸」에 적어 두었다).
--   아래 「무엇을 정해야 하나」의 답은 **(가)** 로 정해졌다 — 지금 SBS 15행은 본사(엔)
--   경유품이라 JPY 그대로 둔다. 값을 UPDATE 하는 문장은 db/price_list_sbs_usd_update.sql
--   에 따로 있고 **그 파일은 돌리지 않는다**(이 파일은 칸만 만든다).
--
-- ════════════════════════════════════════════════════════════════
-- 왜 필요한가
-- ════════════════════════════════════════════════════════════════
--   price_list 는 금액 칸이 둘뿐이고 이름에 통화가 박혀 있다 — price_jpy · cost_jpy.
--   SBS 품목을 **달러로 매입**하기 시작하면 그 두 칸에 달러 숫자가 들어가는데, 코드·엑셀·
--   PDF 는 전부 그 값을 엔으로 읽는다(원가 = 값 × 원/엔 환율 × 관세). 그러면 원가가
--   100배 넘게 틀어진다. 칸 이름을 바꾸는 대신 **통화를 적는 칸**을 더해, 읽는 쪽이
--   「이 줄은 어느 통화인가」를 보고 환율을 고르게 한다.
--
-- ════════════════════════════════════════════════════════════════
-- 무엇을 정해야 하나 — 돌리기 전에 사람이 답해야 한다
-- ════════════════════════════════════════════════════════════════
--   2026-11-03 읽기 전용 조사 결과:
--     · sheet_name='SBS' 행은 **15개**(line='20').
--     · 그 15행의 값은 **엔 숫자 크기**다 — 구입가 1,460~252,000(중앙 18,500),
--       정가 2,600~450,000(중앙 33,000). 같은 품목을 달러로 보면 비현실적이다
--       (예: LAN cable 1m 구입가 9,300 → $9,300).
--     · 2026-10-23 대조 기록이 lib/quoteProfit.ts 에 남아 있다 — 참고 엑셀 「단가표」 시트의
--       SBS 묶음 머리글이 **LIST PRICE (JPY)** 이고 그 값이 지금 price_list 와 한 원도
--       다르지 않다(100056171A 450,000/252,000 등 7건).
--     · 같은 기록에 이런 줄도 있다 — 「견적서 시트의 SBS 칸에는 **환율 1,550**이 적혀 있다.
--       Schmitt 에서 달러로 사 오는 다른 경로로 보인다.」
--
--   그래서 가능한 그림이 둘이다.
--     (가) 지금 15행은 **본사(엔) 경유 매입**이고, 달러 매입은 **그 15행이 아닌 다른 품목**이다.
--          → 이 칸을 더하고 **새로 들여오는 달러 품목에만** 'USD' 를 적는다.
--            기존 15행은 'JPY' 로 둔다(= UPDATE 할 것이 없다).
--     (나) 지금 15행이 실제로는 달러 매입인데 **누군가 엔으로 환산해 넣었다**.
--          → 칸을 더하고 15행을 'USD' 로 바꾸되, **값도 달러 원본으로 되돌려야** 한다
--            (엔 환산값을 그대로 두고 통화만 USD 로 바꾸면 원가가 150배가 된다).
--            그 원본은 DB 에 없다 — 가격표 엑셀을 다시 받아야 한다.
--
--   **(나) 라면 이 파일만 돌려서는 안 된다.** 값을 함께 고치는 문장이 필요하고,
--   그것은 db/price_list_sbs_usd_update.sql 의 [2단계]에 틀만 적어 두었다(값은 비어 있다).

-- ════════════════════════════════════════════════════════════════
-- [1단계] 칸 추가 — 기본값 'JPY' (지금 들어 있는 모든 줄의 뜻이 그것이다)
-- ════════════════════════════════════════════════════════════════

alter table public.price_list
  add column if not exists currency text not null default 'JPY';

-- 아는 통화만 들어가게 묶는다. 늘릴 때 이 제약을 함께 고친다(EUR 등).
--   ⚠ 제약 이름이 이미 있으면 add 가 실패한다 — 재실행 때는 아래 drop 을 함께 돌린다.
-- alter table public.price_list drop constraint if exists price_list_currency_check;
alter table public.price_list
  add constraint price_list_currency_check check (currency in ('JPY', 'USD'));

comment on column public.price_list.currency is
  '구입가·정가의 통화. 기본 JPY. 읽는 쪽이 이 값으로 환율을 고른다(lib/quoteCurrency 예정).';

-- 검색·필터가 통화로 가르는 일은 없으므로 인덱스는 두지 않는다(15행 규모).

-- ════════════════════════════════════════════════════════════════
-- [2단계] 확인
-- ════════════════════════════════════════════════════════════════
--
-- 칸과 제약이 생겼는지.
--   select column_name, data_type, column_default, is_nullable
--     from information_schema.columns
--    where table_schema='public' and table_name='price_list' and column_name='currency';
--
-- 통화별 줄 수 — 이 단계에서는 전부 JPY 여야 한다.
--   select currency, count(*) from public.price_list group by currency order by 2 desc;
--
-- ⚠ price_list 가 **열 단위 GRANT** 표라면 새 칸의 권한을 함께 줘야 화면이 읽는다
--   (engineers 가 그런 표다 — db/APPLIED.md 2026-10-28). 확인:
--   select grantee, column_name, privilege_type from information_schema.column_privileges
--    where table_schema='public' and table_name='price_list' and grantee='authenticated';
--   필요하면: grant select (currency) on public.price_list to authenticated;
--
-- 가격표 등록(/api/price-list-import)은 이 칸을 쓰지 않으므로 **지금 그대로 돈다** —
-- 새 줄은 기본값 JPY 로 들어간다. 달러 시트를 받으려면 라우트·파서에 통화를 더해야 한다
-- (구현 순서 2단계).
