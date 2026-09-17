-- 견적 저장 트랜잭션 함수 (2026-09-16)
-- 목적: quotes + quote_items + quote_expenses 를 한 트랜잭션으로 묶는다.
--   기존에는 브라우저에서 세 번 나눠 insert 해 중간 실패 시 품목 없는 견적이 남았다.
-- 부수 효과: 번호 유실 방지(예외 시 채번도 롤백), created_by 위조 방지,
--   초안 삭제 시점 딜레마 해소(성공 후 한 번만 지우면 된다).
-- 금액 합계는 클라이언트 계산값을 그대로 저장한다(함수가 재계산하지 않는다).
--
-- 적용은 Supabase SQL Editor 에서 한 번 실행한다. 함수 소유자는 postgres 여야 한다
-- (SECURITY DEFINER 가 우회하는 것이 RLS 이므로, 소유자가 곧 권한 기준이 된다).
-- 적용한 뒤 quote_schema_snapshot.sql 에도 이 함수의 존재를 적어 둔다.
--
-- 참고 — 이 함수가 하지 않는 것
--   · 견적번호 중복 재발급: quotes.quote_number 에는 유니크가 없고, 지금 화면 코드가
--     「받은 번호가 이미 있으면 최대 5회 다시 발급」하는 방어를 한다. 그 재시도는 함수로 옮기지 않았다
--     (이니셜이 겹치는 재직자가 없으면 번호는 (작성자, 날짜, 순번)으로 이미 유일하다).
--   · 금액 재계산: 환율·관세·할인 계산이 화면에 있고, 두 벌이 생기면 어긋난다.

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
  insert into public.quotes (
    quote_number, quote_date, created_by, engineer_id,
    customer_id, dealer_id, opportunity_id, delivery_info,
    recipient, note, quote_type, status,
    total_supply, total_tax, total_amount, total_cost, total_profit, profit_rate,
    pdf_url
  ) values (
    v_number, to_date(p_date, 'YYYYMMDD'), v_me, v_owner,
    v_q.customer_id, v_q.dealer_id, v_q.opportunity_id, v_q.delivery_info,
    v_q.recipient, v_q.note, v_q.quote_type, coalesce(v_q.status, '견적중'),
    coalesce(v_q.total_supply, 0), coalesce(v_q.total_tax, 0), coalesce(v_q.total_amount, 0),
    coalesce(v_q.total_cost, 0), coalesce(v_q.total_profit, 0), coalesce(v_q.profit_rate, 0),
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

-- 되돌리기: drop function if exists public.create_quote(text, jsonb, jsonb, jsonb, integer);
