-- 견적 품목의 **모델** 저장 (2026-10-21 작성). **2026-10-23 적용 확인 완료.**
--   확인 방법: quote_items.model_name 컬럼이 DB 에 있다.
--   적용일 미상(2026-10-21 ~ 2026-10-23 사이). 기록용, 다시 실행하지 마라 —
--   아래 「적용 순서」는 그때 무엇을 어떤 순서로 돌렸는지의 기록이다.
--
-- 무엇을 위한 칸인가
--   20 견적서에는 **모델 열**이 따로 있다. 가격표에서 고른 줄은 그 열을 price_list.model_jp 로
--   채우지만(app/quote/QuotePDFDoc.tsx 의 modelText), 「+ 수동입력」으로 직접 적은 줄은
--   채울 값이 없어 **칸이 늘 비어 있었다.** 그래서 화면에 모델 칸을 더했다
--   (QuoteRow.manual_model · app/quote/QuoteItemRow.tsx).
--
--   **그 값이 지금은 DB 에 들어가지 않는다.** create_quote 의 품목 칸 목록에 자리가 없다.
--   확정 직후 올라가는 PDF 는 화면 값으로 그리므로 모델이 제대로 나가지만, 「다시쓰기」로
--   되살린 견적에서는 모델 칸이 비어 있다(hooks/quote/useQuotePrefill.ts). 임시저장
--   (localStorage) 에는 남는다 — 그쪽은 화면 값을 그대로 담기 때문이다.
--
-- 저장 모양 — quote_items.model_name text
--   사람이 적은 글자 그대로. **null = 적지 않았다.** 빈 글자를 넣지 않는다.
--   가격표에서 고른 줄은 넣지 않는다 — 그 줄의 모델은 price_list_id 로 따라가고, 같은 값을
--   두 곳에 두면 가격표가 고쳐졌을 때 어느 쪽이 맞는지 알 수 없다.
--   (화면 쪽 규칙은 hooks/quote/useQuoteSubmit.tsx 의 model_name 한 줄에 있다 —
--    row_kind = 'manual_jpy' 이고 적은 값이 있을 때만 보낸다.)
--
-- **기존 견적은 backfill 하지 않는다.** null 이면 코드가 「적지 않았다」로 읽는다.
-- 금액·환율·조건 로직과는 무관하다 — 이 칸은 글자만 담는다.
--
-- ── 적용 순서 ────────────────────────────────────────────────────────────────
--   단계 1 (칸 추가)  — 아무 때나. **코드보다 먼저 해도 되고 나중에 해도 된다.**
--        지금 코드는 model_name 을 **select 하지 않는다**(다시쓰기의 select 목록에 없다).
--        그래서 칸이 없는 상태로 새 코드가 돌아도 깨지는 요청이 없다.
--        보낼 때도 예외가 나지 않는다 — create_quote 가 품목을
--        jsonb_populate_recordset 으로 받아 **쓰지 않는 키를 조용히 버린다.**
--   단계 2 (함수)     — 단계 1 뒤. 이것까지 해야 **값이 실제로 저장된다.**
--   단계 3 (코드)     — 단계 1·2 뒤. 다시쓰기가 그 값을 되살리게 하는 한 줄이다(아래).
--
-- 적용 후 확인 쿼리는 파일 맨 아래, 되돌리기는 그 다음에 적어 두었다.


-- ════════════════════════════════════════════════════════════════════════════
-- 단계 1. 칸 추가
-- ════════════════════════════════════════════════════════════════════════════
alter table public.quote_items
  add column if not exists model_name text;

comment on column public.quote_items.model_name is
  '직접 적은 줄(row_kind=manual_jpy)의 모델. 20 견적서의 모델 열에 찍힌다. null = 적지 않음. 가격표 품목은 price_list.model_jp 를 쓴다.';


-- ════════════════════════════════════════════════════════════════════════════
-- 단계 2. create_quote — 품목 insert 에 model_name 한 칸을 더한다
--
--   ⚠ **이 파일에 함수 전문을 옮겨 적지 않았다.** 이유를 적어 둔다.
--     저장소에서 가장 새 정의는 quote_category_template_schema.sql 의 단계 6 인데, 그 파일
--     머리말은 「아직 적용하지 않았다」로 남아 있다. 반면 화면은 분류·양식·구성 묶음·템플릿을
--     이미 쓰고 있어, 파일의 머리말과 DB 가 어긋나 있다. 어느 쪽이 DB 의 실제 본문인지
--     **확인하지 않은 채** 전문을 replace 하면 sub_lines·category·group_kind 가 조용히
--     사라질 수 있다(저장은 성공하고 값만 안 남는다 — 가장 늦게 들통나는 사고다).
--
--   그래서 **실제 본문에서 시작한다.** 아래 ①로 DB 의 정의를 뽑고, ②의 두 자리만 고쳐
--   그대로 다시 실행한다(시그니처·권한·채번·대필 검증은 한 글자도 건드리지 않는다).
--
--   ① 지금 DB 에 있는 정의를 뽑는다
--      select pg_get_functiondef(p.oid)
--      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public' and p.proname = 'create_quote';
--
--   ② 그 본문에서 품목 insert 두 자리에 model_name 을 더한다(끝에 붙인다)
--      @@ 칸 목록
--      -      cost_amount, profit_amount, profit_rate, exchange_rate, tariff_rate, sub_lines
--      +      cost_amount, profit_amount, profit_rate, exchange_rate, tariff_rate, sub_lines,
--      +      model_name
--      @@ select 목록
--      -            x.cost_amount, …, x.tariff_rate, x.sub_lines
--      +            x.cost_amount, …, x.tariff_rate, x.sub_lines,
--      +            x.model_name
--      (칸 목록의 끝 이름은 DB 정의에 있는 그대로를 기준으로 삼는다. group_kind·category 가
--       이미 들어 있으면 그 뒤에 붙이면 된다 — 순서는 두 목록이 서로 같기만 하면 된다.)
--
--   품목은 jsonb_populate_recordset(null::public.quote_items, p_items) 로 받는다. 그래서
--   단계 1 이 끝나면 p_items 의 model_name 이 x.model_name 으로 **자동으로** 담긴다 —
--   읽는 코드를 따로 더할 필요가 없다. coalesce 는 쓰지 않는다(null 이 「적지 않음」이다).
-- ════════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════════
-- 단계 3. 코드 — 다시쓰기가 모델을 되살리게 한다(단계 1 뒤에만 배포한다)
--
--   ⚠ 단계 1 **전에** 이 두 줄을 배포하면 안 된다. 없는 칸을 select 하면 PostgREST 가
--     그 요청을 떨어뜨려 「다시쓰기」 자체가 깨진다(sub_lines 때 겪은 일이다).
--
--   ① app/api/quote-duplicate/route.ts — select 목록에 model_name 을 더한다
--        … sub_lines, category, group_kind, price_list(*)
--      → … sub_lines, category, group_kind, model_name, price_list(*)
--
--   ② hooks/quote/useQuotePrefill.ts — 지금 주석만 있는 자리에서 값을 받는다
--      manual_model: kind === 'manual_jpy' ? (it.model_name ?? '') : '',
--      (DuplicateItem 타입에 model_name?: string | null 을 더한다.)
-- ════════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════════
-- 적용 후 확인
-- ════════════════════════════════════════════════════════════════════════════
-- 칸이 생겼는가(1행, text, is_nullable = YES)
-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'quote_items' and column_name = 'model_name';

-- 함수에 model_name 이 들어갔는가(두 자리 → 2 이상)
-- select
--   (select count(*) from regexp_matches(pg_get_functiondef(p.oid), '\mmodel_name\M', 'g')) as hits
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'create_quote';

-- 함수가 **다른 칸을 잃지 않았는가** — 단계 2 를 하고 나서 꼭 본다(전부 1 이상이어야 한다)
-- select
--   (select count(*) from regexp_matches(pg_get_functiondef(p.oid), '\msub_lines\M', 'g'))  as sub_lines,
--   (select count(*) from regexp_matches(pg_get_functiondef(p.oid), '\mgroup_kind\M', 'g')) as group_kind,
--   (select count(*) from regexp_matches(pg_get_functiondef(p.oid), '\mcategory\M', 'g'))   as category
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'create_quote';

-- 기존 품목은 전부 null 이어야 한다(backfill 하지 않았다)
-- select count(*) as total, count(model_name) as with_model from public.quote_items;

-- 들어간 값 훑어보기(적용 뒤 새 견적 몇 건) — 직접 적은 줄에만 값이 있어야 한다
-- select quote_id, item_id, row_kind, product_name, model_name
-- from public.quote_items
-- where model_name is not null
-- order by item_id desc
-- limit 20;


-- ════════════════════════════════════════════════════════════════════════════
-- 되돌리기 — 역순으로 한 문장씩
-- ════════════════════════════════════════════════════════════════════════════
-- 단계 3 되돌리기: 그 두 줄을 뺀 코드를 배포한다(화면은 모델 칸을 그대로 둬도 된다 —
--   저장만 안 될 뿐 화면·확정 PDF 는 멀쩡히 돈다).
--
-- 단계 2 되돌리기: 단계 2 ①로 뽑아 둔 **고치기 전 정의**를 그대로 다시 실행한다.
--   (그래서 ① 의 결과를 고치기 전에 따로 저장해 둔다. drop 하지 마라 — 견적 저장이 즉시 멈춘다.)
--
-- 단계 1 되돌리기: **코드를 먼저 되돌린 뒤** 지운다.
-- alter table public.quote_items drop column if exists model_name;
