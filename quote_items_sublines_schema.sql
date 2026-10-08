-- 견적 품목의 설명 줄 저장 (2026-10-08 작성). **아직 DB 에 적용하지 않았다.**
-- 이 파일은 적용 대기 상태다 — 아래 「적용 순서」를 읽고 **한 문장씩 따로** 실행한다.
--
-- 무엇을 위한 칸인가
--   견적 품목의 품명 아래에 붙는 설명 줄이다(화면의 「줄 추가」, 코드 이름 subLines).
--   시리얼 번호·옵션·부속 내역을 적고, PDF 에서 품명 바로 아래 작은 글씨로 줄마다 한 행씩 나간다
--   (app/quote/QuotePDFDoc.tsx 의 품목 루프).
--
--   **그 줄이 지금까지 DB 에 들어가지 않았다.** create_quote 의 품목 칸 목록에 자리가 없었다.
--   그래서 확정 직후 올라가는 PDF(화면 값으로 그린다)에는 줄이 보이지만, 결재 대상 견적의 PDF 는
--   저장값으로 다시 그리므로(lib/quotePdfData.ts) 결재 화면·승인 뒤 PDF 에서 줄이 통째로 사라졌다.
--   고객에게 나가는 문서가 확정 때와 달라지는 문제다.
--
-- 저장 모양 — quote_items.sub_lines jsonb
--   문자열 배열. 예: ["S/N: 1234", "- Leaf Spring 교체"]
--   **null = 설명 줄 없음.** 빈 배열을 적어 두지 않는다(「없다」는 뜻이 둘이 되면 읽는 쪽이 갈린다).
--   코드 쪽 규칙은 lib/quoteSubLines.ts 한 곳에 있다(줄 10개·한 줄 80자 상한, 빈 줄 제거).
--
-- **기존 견적은 backfill 하지 않는다.** sub_lines 가 null 이면 코드가 「줄 없음」으로 읽는다
-- (subLinesOf). 그래서 이 변경은 옛 견적의 PDF·검토표에 아무 영향이 없다.
--
-- 금액·환율·조건(terms) 로직과는 무관하다 — 이 칸은 글자만 담는다.
--
-- ── 적용 순서 ────────────────────────────────────────────────────────────────
--   단계 1 (칸 추가)  — **코드 배포보다 먼저** 실행한다.
--        코드가 quote_items.sub_lines 를 select 한다(검토표 'review'·PDF 저장값 'pdf-data'·
--        다시쓰기 /api/quote-duplicate). 칸이 없는 상태에서 새 코드가 올라가면 그 요청들이
--        PostgREST 오류로 떨어져 결재 문서의 검토표·PDF 버튼과 「다시쓰기」가 깨진다.
--   단계 2 (check)    — 단계 1 뒤 아무 때나. 모양을 배열로 못박는다.
--   단계 3 (함수)     — 단계 1 뒤, 코드 배포 **전후 아무 때나**.
--        이 함수가 바뀌기 전에 새 코드가 sub_lines 를 보내도 조용히 버려질 뿐
--        (jsonb_populate_recordset 이 쓰지 않는 키를 버린다) 저장만 안 된다 — 예외는 나지 않는다.
--
-- 적용 후 확인 쿼리는 파일 맨 아래, 되돌리기는 그 다음에 적어 두었다.


-- ════════════════════════════════════════════════════════════════════════════
-- 단계 1. 칸 추가
-- ════════════════════════════════════════════════════════════════════════════
alter table public.quote_items
  add column if not exists sub_lines jsonb;

comment on column public.quote_items.sub_lines is
  '품명 아래 설명 줄(문자열 배열). 시리얼 번호·옵션 등. null = 줄 없음. 규칙은 lib/quoteSubLines.ts.';


-- ════════════════════════════════════════════════════════════════════════════
-- 단계 2. 모양 제약 — null 이거나 배열이어야 한다
--   객체·숫자·문자열이 들어오면 코드가 「줄 없음」으로 떨어지지만(subLinesOf 가 방어한다),
--   애초에 들어오지 못하게 막아 둔다. 줄 수·글자 수는 보지 않는다 — 그 검증은 화면·코드가 한다
--   (DB 제약으로 상한을 막으면 상한을 바꿀 때 DB 를 또 건드려야 한다).
-- ════════════════════════════════════════════════════════════════════════════
alter table public.quote_items
  add constraint quote_items_sub_lines_is_array
  check (sub_lines is null or jsonb_typeof(sub_lines) = 'array');


-- ════════════════════════════════════════════════════════════════════════════
-- 단계 3. create_quote — 품목에 sub_lines 한 칸만 더 저장한다
--
--   **현재 정의(quotes_terms_schema.sql 의 함수)를 파일에서 그대로 옮겼다.**
--   시그니처·반환·언어·security definer·search_path·권한(revoke/grant)·채번·대필 검증·
--   견적 insert(terms 포함)·부대비용·수리 연결은 **한 글자도 바뀌지 않았다.**
--
--   바뀐 줄은 품목 insert 의 두 자리뿐이다(+ 주석 1줄):
--     @@ 칸 목록
--     -      cost_amount, profit_amount, profit_rate, exchange_rate, tariff_rate
--     +      cost_amount, profit_amount, profit_rate, exchange_rate, tariff_rate,
--     +      sub_lines
--     @@ select 목록
--     -            x.cost_amount, x.profit_amount, x.profit_rate, x.exchange_rate, x.tariff_rate
--     +            x.cost_amount, x.profit_amount, x.profit_rate, x.exchange_rate, x.tariff_rate,
--     +            x.sub_lines
--
--   품목은 `jsonb_populate_recordset(null::public.quote_items, p_items)` 로 받는다. 그래서
--   단계 1 이 끝나면 p_items 의 sub_lines 가 x.sub_lines 로 **자동으로** 담긴다 — 읽는 코드를
--   따로 더하지 않았다. coalesce 를 쓰지 않는 이유: null 이 「줄 없음」이라는 뜻이라 그대로 넣어야 한다.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.create_quote(
  p_date      text,                      -- 'YYYYMMDD' (KST). 채번 키이자 quote_date 의 근거
  p_quote     jsonb,                     -- 견적 본문(quotes 컬럼 이름과 같은 키만 쓴다)
  p_items     jsonb,                     -- 품목 배열(quote_items 컬럼 이름)
  p_expenses  jsonb,                     -- 부대비용 배열(quote_expenses 컬럼 이름)
  p_repair_id integer default null        -- 수리 건에서 넘어온 견적이면 그 repair_id
)
returns table (quote_id bigint, quote_number text, seq integer, repair_linked boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me       integer;
  v_initials text;
  v_owner    integer;                    -- 실적 귀속자. 대필이면 v_me 와 다르다
  v_q        public.quotes%rowtype;
  v_seq      integer;
  v_n        integer;
  v_letters  text := '';
  v_number   text;
  v_quote_id bigint;
  v_rows     integer;
  -- 수리 건 연결 결과 — true 연결됨 / false 대상 행이 없음 / null 연결 시도 자체가 없었음.
  -- 화면은 false 일 때만 「수동으로 연결해주세요」를 띄운다(지금 동작을 그대로 유지하는 값이다).
  v_linked   boolean;
begin
  -- 1. 로그인 사용자 — JWT 이메일로 engineers 를 찾는다(current_engineer_id 는 STABLE·DEFINER).
  v_me := public.current_engineer_id();
  if v_me is null then
    raise exception '로그인이 필요합니다';
  end if;

  -- 2. 견적 작성 권한 — 지금까지 화면 가드만 하던 검사를 DB 로 옮긴다.
  if not public.has_team_perm('quote') then
    raise exception '견적 작성 권한이 없습니다';
  end if;

  -- 3. 이니셜 — 번호를 만들 수 없으면 순번을 쓰기 전에 멈춘다.
  select nullif(btrim(e.initials), '') into v_initials
  from public.engineers e
  where e.engineer_id = v_me;
  if v_initials is null then
    raise exception '이니셜이 등록되지 않았습니다';
  end if;

  -- 날짜 형식 — 'YYYYMMDD' 여덟 자리만 받는다.
  if p_date !~ '^\d{8}$' then
    raise exception '날짜 형식이 올바르지 않습니다';
  end if;

  -- 견적 본문을 quotes 행 모양으로 받는다. quotes 에 없는 키는 조용히 버려진다.
  v_q := jsonb_populate_record(null::public.quotes, coalesce(p_quote, '{}'::jsonb));

  -- 4. 대필 — 실적 귀속자가 호출자와 다르면 영업관리 권한이 있어야 하고, 대상이 재직 중이어야 한다.
  --    (지금은 /api/quote-on-behalf 가 하던 판정이다. 화면을 거치지 않는 호출도 막으려고 여기서 다시 본다.)
  v_owner := coalesce(v_q.engineer_id, v_me);
  if v_owner <> v_me then
    if not public.has_team_perm('sales_mgmt') then
      raise exception '대필 권한이 없습니다';
    end if;
    if not exists (
      select 1 from public.engineers e
      where e.engineer_id = v_owner
        and e.resigned_date is null
    ) then
      raise exception '대상 엔지니어를 찾을 수 없습니다';
    end if;
  end if;

  -- 5. 순번 — (날짜, 작성자) 카운터를 원자적으로 올린다.
  --    아래에서 예외가 나면 이 증가도 함께 롤백된다(지금은 번호만 소비되고 사라진다).
  v_seq := public.next_quote_seq(p_date, v_me);
  if v_seq is null or v_seq < 1 then
    raise exception '견적번호 순번을 발급하지 못했습니다';
  end if;

  -- 6. 번호 글자 — 1→A … 26→Z, 27→AA, 28→AB (엑셀 열 이름 방식).
  --    app/quote/page.tsx 의 seqToLetters 와 같은 식이다: r = (n-1) % 26, n = (n-1) / 26.
  v_n := v_seq;
  while v_n > 0 loop
    v_letters := chr(65 + ((v_n - 1) % 26)) || v_letters;
    v_n := (v_n - 1) / 26;
  end loop;
  v_number := 'No.' || upper(v_initials) || p_date || '-' || v_letters;

  -- 7. 견적 — created_by 는 p_quote 값을 쓰지 않고 호출자로 강제한다(위조 방지).
  --    pdf_url 은 비워 둔다. PDF 를 올린 뒤 화면이 실제 파일 이름으로 채운다.
  --    returning 은 테이블 이름으로 한정한다 — 이 함수의 반환 칸 이름이 quote_id 라 그냥 쓰면 모호해진다.
  --    terms 는 받은 값을 그대로 넣는다 — null 이 「조건 네 줄 모두 기본값」이라는 뜻이다.
  insert into public.quotes (
    quote_number, quote_date, created_by, engineer_id,
    customer_id, dealer_id, opportunity_id, delivery_info,
    recipient, note, quote_type, status,
    total_supply, total_tax, total_amount, total_cost, total_profit, profit_rate,
    terms,
    pdf_url
  ) values (
    v_number, to_date(p_date, 'YYYYMMDD'), v_me, v_owner,
    v_q.customer_id, v_q.dealer_id, v_q.opportunity_id, v_q.delivery_info,
    v_q.recipient, v_q.note, v_q.quote_type, coalesce(v_q.status, '견적중'),
    coalesce(v_q.total_supply, 0), coalesce(v_q.total_tax, 0), coalesce(v_q.total_amount, 0),
    coalesce(v_q.total_cost, 0), coalesce(v_q.total_profit, 0), coalesce(v_q.profit_rate, 0),
    v_q.terms,
    null
  )
  returning quotes.quote_id into v_quote_id;

  -- 8. 품목 — 클라이언트가 보낸 quote_id 는 믿지 않고 방금 만든 견적에 붙인다.
  --    item_id 는 컬럼 목록에 넣지 않는다(identity 가 채운다).
  --    sub_lines 는 받은 값을 그대로 넣는다 — null 이 「설명 줄 없음」이라는 뜻이다.
  if jsonb_typeof(coalesce(p_items, 'null'::jsonb)) = 'array' and jsonb_array_length(p_items) > 0 then
    insert into public.quote_items (
      quote_id, price_list_id, part_code, row_kind, product_name, quantity,
      unit_price_jpy, unit_price_krw, supply_amount, tax_amount, category,
      cost_amount, profit_amount, profit_rate, exchange_rate, tariff_rate,
      sub_lines
    )
    select v_quote_id, x.price_list_id, x.part_code, x.row_kind, x.product_name, x.quantity,
           x.unit_price_jpy, x.unit_price_krw, x.supply_amount, x.tax_amount, x.category,
           x.cost_amount, x.profit_amount, x.profit_rate, x.exchange_rate, x.tariff_rate,
           x.sub_lines
    from jsonb_populate_recordset(null::public.quote_items, p_items) x;
  end if;

  -- 9. 부대비용 — 같은 방식. expense_id 는 serial 이 채운다.
  --    NOT NULL(item_name·unit_price·amount)이 비면 여기서 예외가 나고 견적까지 통째로 롤백된다.
  if jsonb_typeof(coalesce(p_expenses, 'null'::jsonb)) = 'array' and jsonb_array_length(p_expenses) > 0 then
    insert into public.quote_expenses (
      quote_id, item_name, unit_price, headcount, days, amount
    )
    select v_quote_id, x.item_name, x.unit_price,
           coalesce(x.headcount, 0), coalesce(x.days, 0), x.amount
    from jsonb_populate_recordset(null::public.quote_expenses, p_expenses) x;
  end if;

  -- 10. 수리 건 연결 — 같은 트랜잭션에 둔다. 해당 수리 건이 없어도 견적 저장을 되돌리지는 않는다
  --     (수리 건이 지워졌다고 견적을 버릴 이유는 없다). 대신 연결됐는지를 돌려줘 화면이 안내한다.
  if p_repair_id is not null then
    update public.repairs r
    set quote_id = v_quote_id
    where r.repair_id = p_repair_id;
    get diagnostics v_rows = row_count;
    v_linked := v_rows > 0;
  end if;

  -- 11. 화면이 PDF 생성·다음 미리보기 번호·수리 연결 안내에 쓰는 값.
  return query select v_quote_id, v_number, v_seq, v_linked;
end;
$$;

revoke execute on function public.create_quote(text, jsonb, jsonb, jsonb, integer) from public, anon;
grant execute on function public.create_quote(text, jsonb, jsonb, jsonb, integer) to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- 적용 후 확인
-- ════════════════════════════════════════════════════════════════════════════
-- 칸이 생겼는가(1행, jsonb, is_nullable = YES)
-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'quote_items' and column_name = 'sub_lines';

-- 제약이 걸렸는가(1행)
-- select conname, pg_get_constraintdef(oid)
-- from pg_constraint
-- where conrelid = 'public.quote_items'::regclass and conname = 'quote_items_sub_lines_is_array';

-- 함수에 sub_lines 가 들어갔는가(두 자리 → 2 이상)
-- select
--   (select count(*) from regexp_matches(pg_get_functiondef(p.oid), '\msub_lines\M', 'g')) as hits
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'create_quote';

-- 기존 품목은 전부 null 이어야 한다(backfill 하지 않았다)
-- select count(*) as total, count(sub_lines) as with_sub_lines from public.quote_items;

-- 들어간 값 훑어보기(적용 뒤 새 견적 몇 건)
-- select quote_id, item_id, product_name, sub_lines
-- from public.quote_items
-- where sub_lines is not null
-- order by item_id desc
-- limit 20;


-- ════════════════════════════════════════════════════════════════════════════
-- 되돌리기 — 역순으로 한 문장씩
-- ════════════════════════════════════════════════════════════════════════════
-- 단계 3 되돌리기: quotes_terms_schema.sql 의 함수 정의를 그대로 다시 실행한다
--   (그 파일이 sub_lines 없는 현재 함수의 정본이다. drop 하지 마라 — 화면 저장이 즉시 멈춘다).
--
-- 단계 2 되돌리기:
-- alter table public.quote_items drop constraint if exists quote_items_sub_lines_is_array;
--
-- 단계 1 되돌리기: **코드를 먼저 되돌린 뒤** 지운다(코드가 sub_lines 를 select 한다).
-- alter table public.quote_items drop column if exists sub_lines;
