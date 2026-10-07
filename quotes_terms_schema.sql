-- 견적서 조건 네 줄 저장 (2026-10-07 작성). **아직 DB 에 적용하지 않았다.**
-- 이 파일은 적용 대기 상태다 — 아래 「적용 순서」를 읽고 **한 문장씩 따로** 실행한다.
--
-- 무엇을 위한 칸인가
--   견적서 PDF 아래의 조건 네 줄이 코드에 글자로 박혀 있었다(app/quote/QuotePDFDoc.tsx).
--     1.납품일정 : 담당자와 협의      2.지불조건 : 익월말 현금 결제
--     3.인도조건 : 지정장소           4.견적유효 : 작성일로부터 1개월
--   작성자가 건마다 고칠 수 있게 하려면 **견적에 저장돼야 한다.** 결재 대상 견적서는 저장된
--   파일을 열지 않고 저장값으로 다시 그리기 때문에(lib/quotePdfData.ts), 저장하지 않으면
--   확정 때 고객에게 나간 PDF 와 결재·승인 뒤 PDF 가 달라진다.
--
-- 저장 모양 — quotes.terms jsonb
--   { "delivery_schedule": "…", "payment_terms": "…", "delivery_terms": "…", "validity": "…" }
--   **null = 네 줄 모두 기본값.** 기본값과 같은 값을 적어 두지 않는다 — 그러면 나중에 기본 문구를
--   고칠 때 옛 견적만 옛 문구로 굳는다. 코드 쪽 규칙은 lib/quoteTerms.ts 한 곳에 있다.
--
-- **기존 견적은 backfill 하지 않는다.** terms 가 null 이면 코드가 기본값으로 그린다(termsOf).
-- 그래서 이 변경은 옛 견적의 PDF·검토표에 아무 영향이 없다.
--
-- 유효기간 판정과는 무관하다 — 「4.견적유효」는 **문구일 뿐**이고, 자동 실주·D-day 는 그대로
-- 작성일 + 1개월 기준이다(lib/quoteStatus.ts 의 quoteExpiry). 이 칸은 그 판정을 건드리지 않는다.
--
-- ── 적용 순서 ────────────────────────────────────────────────────────────────
--   단계 1 (칸 추가)  — **코드 배포보다 먼저** 실행한다.
--        코드가 quotes.terms 를 select 한다(검토표 'review'·PDF 저장값 'pdf-data').
--        칸이 없는 상태에서 새 코드가 올라가면 그 두 요청이 PostgREST 오류로 떨어져
--        결재 문서 상세의 견적 검토표와 PDF 버튼이 깨진다.
--   단계 2 (check)    — 단계 1 뒤 아무 때나. 모양을 객체로 못박는다.
--   단계 3 (함수)     — 단계 1 뒤, 코드 배포 **전후 아무 때나**.
--        이 함수가 바뀌기 전에 새 코드가 terms 를 보내도 조용히 버려질 뿐(jsonb_populate_record 가
--        쓰지 않는 키를 버린다) 저장만 안 된다 — 저장이 막히거나 예외가 나지는 않는다.
--
-- 적용 후 확인 쿼리는 파일 맨 아래, 되돌리기는 그 다음에 적어 두었다.


-- ════════════════════════════════════════════════════════════════════════════
-- 단계 1. 칸 추가
-- ════════════════════════════════════════════════════════════════════════════
alter table public.quotes
  add column if not exists terms jsonb;

comment on column public.quotes.terms is
  '견적서 PDF 조건 네 줄(delivery_schedule·payment_terms·delivery_terms·validity). null = 모두 기본값. 규칙은 lib/quoteTerms.ts.';


-- ════════════════════════════════════════════════════════════════════════════
-- 단계 2. 모양 제약 — null 이거나 객체여야 한다
--   배열·숫자·문자열이 들어오면 코드가 기본값으로 떨어지지만(termsOf 가 방어한다),
--   애초에 들어오지 못하게 막아 둔다. 칸 이름·길이는 보지 않는다 — 그 검증은 화면·코드가 한다
--   (DB 제약으로 길이를 막으면 문구 상한을 바꿀 때 DB 를 또 건드려야 한다).
-- ════════════════════════════════════════════════════════════════════════════
alter table public.quotes
  add constraint quotes_terms_is_object
  check (terms is null or jsonb_typeof(terms) = 'object');


-- ════════════════════════════════════════════════════════════════════════════
-- 단계 3. create_quote — terms 한 칸만 더 저장한다
--
--   quote_create_function.sql 의 현재 정의를 **그대로** 가져왔다.
--   시그니처·반환·언어·security definer·search_path·권한(revoke/grant)·채번·대필 검증·
--   품목·부대비용·수리 연결은 **한 글자도 바뀌지 않았다.**
--
--   바뀐 줄은 둘뿐이다(insert 의 칸 목록과 values 목록에 terms 하나씩):
--     @@ 칸 목록
--     -    total_supply, total_tax, total_amount, total_cost, total_profit, profit_rate,
--     -    pdf_url
--     +    total_supply, total_tax, total_amount, total_cost, total_profit, profit_rate,
--     +    terms,
--     +    pdf_url
--     @@ values 목록
--     -    coalesce(v_q.total_cost, 0), coalesce(v_q.total_profit, 0), coalesce(v_q.profit_rate, 0),
--     -    null
--     +    coalesce(v_q.total_cost, 0), coalesce(v_q.total_profit, 0), coalesce(v_q.profit_rate, 0),
--     +    v_q.terms,
--     +    null
--
--   v_q 는 이미 `jsonb_populate_record(null::public.quotes, p_quote)` 로 만든 quotes 행이다
--   (69-70행). 그래서 단계 1 이 끝나면 p_quote.terms 가 v_q.terms 로 **자동으로** 담긴다 —
--   읽는 코드를 따로 더하지 않았다. coalesce 를 쓰지 않는 이유: null 이 「모두 기본값」이라는
--   뜻이라 그대로 넣어야 한다.
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
  if jsonb_typeof(coalesce(p_items, 'null'::jsonb)) = 'array' and jsonb_array_length(p_items) > 0 then
    insert into public.quote_items (
      quote_id, price_list_id, part_code, row_kind, product_name, quantity,
      unit_price_jpy, unit_price_krw, supply_amount, tax_amount, category,
      cost_amount, profit_amount, profit_rate, exchange_rate, tariff_rate
    )
    select v_quote_id, x.price_list_id, x.part_code, x.row_kind, x.product_name, x.quantity,
           x.unit_price_jpy, x.unit_price_krw, x.supply_amount, x.tax_amount, x.category,
           x.cost_amount, x.profit_amount, x.profit_rate, x.exchange_rate, x.tariff_rate
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
-- where table_schema = 'public' and table_name = 'quotes' and column_name = 'terms';

-- 제약이 걸렸는가(1행)
-- select conname, pg_get_constraintdef(oid)
-- from pg_constraint
-- where conrelid = 'public.quotes'::regclass and conname = 'quotes_terms_is_object';

-- 함수에 terms 가 들어갔는가(두 자리에서 각각 1 이상)
-- select
--   (select count(*) from regexp_matches(pg_get_functiondef(p.oid), '\mterms\M', 'g')) as terms_hits
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'create_quote';

-- 기존 견적은 전부 null 이어야 한다(backfill 하지 않았다)
-- select count(*) as total, count(terms) as with_terms from public.quotes;

-- 들어간 값 훑어보기(적용 뒤 새 견적 몇 건)
-- select quote_id, quote_number, terms
-- from public.quotes
-- where terms is not null
-- order by quote_id desc
-- limit 20;


-- ════════════════════════════════════════════════════════════════════════════
-- 되돌리기 — 역순으로 한 문장씩
-- ════════════════════════════════════════════════════════════════════════════
-- 단계 3 되돌리기: quote_create_function.sql 의 정의를 그대로 다시 실행한다
--   (그 파일이 terms 없는 원래 함수의 정본이다. drop 하지 마라 — 화면 저장이 즉시 멈춘다).
--
-- 단계 2 되돌리기:
-- alter table public.quotes drop constraint if exists quotes_terms_is_object;
--
-- 단계 1 되돌리기: **코드를 먼저 되돌린 뒤** 지운다(코드가 terms 를 select 한다).
-- alter table public.quotes drop column if exists terms;
