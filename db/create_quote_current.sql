CREATE OR REPLACE FUNCTION public.create_quote(p_date text, p_quote jsonb, p_items jsonb, p_expenses jsonb, p_repair_id integer DEFAULT NULL::integer)
 RETURNS TABLE(quote_id bigint, quote_number text, seq integer, repair_linked boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me       integer;
  v_initials text;
  v_owner    integer;
  v_q        public.quotes%rowtype;
  v_seq      integer;
  v_n        integer;
  v_letters  text := '';
  v_number   text;
  v_quote_id bigint;
  v_rows     integer;
  v_linked   boolean;
begin
  v_me := public.current_engineer_id();
  if v_me is null then
    raise exception '로그인이 필요합니다';
  end if;

  if not public.has_team_perm('quote') then
    raise exception '견적 작성 권한이 없습니다';
  end if;

  select nullif(btrim(e.initials), '') into v_initials
  from public.engineers e
  where e.engineer_id = v_me;
  if v_initials is null then
    raise exception '이니셜이 등록되지 않았습니다';
  end if;

  if p_date !~ '^\d{8}$' then
    raise exception '날짜 형식이 올바르지 않습니다';
  end if;

  v_q := jsonb_populate_record(null::public.quotes, coalesce(p_quote, '{}'::jsonb));

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

  v_seq := public.next_quote_seq(p_date, v_me);
  if v_seq is null or v_seq < 1 then
    raise exception '견적번호 순번을 발급하지 못했습니다';
  end if;

  v_n := v_seq;
  while v_n > 0 loop
    v_letters := chr(65 + ((v_n - 1) % 26)) || v_letters;
    v_n := (v_n - 1) / 26;
  end loop;
  v_number := 'No.' || upper(v_initials) || p_date || '-' || v_letters;

  insert into public.quotes (
    quote_number, quote_date, created_by, engineer_id,
    customer_id, dealer_id, opportunity_id, delivery_info,
    recipient, note, quote_type, status,
    total_supply, total_tax, total_amount, total_cost, total_profit, profit_rate,
    terms,
    category, form_kind,
    pdf_url
  ) values (
    v_number, to_date(p_date, 'YYYYMMDD'), v_me, v_owner,
    v_q.customer_id, v_q.dealer_id, v_q.opportunity_id, v_q.delivery_info,
    v_q.recipient, v_q.note, v_q.quote_type, coalesce(v_q.status, '견적중'),
    coalesce(v_q.total_supply, 0), coalesce(v_q.total_tax, 0), coalesce(v_q.total_amount, 0),
    coalesce(v_q.total_cost, 0), coalesce(v_q.total_profit, 0), coalesce(v_q.profit_rate, 0),
    v_q.terms,
    v_q.category, v_q.form_kind,
    null
  )
  returning quotes.quote_id into v_quote_id;

  if jsonb_typeof(coalesce(p_items, 'null'::jsonb)) = 'array' and jsonb_array_length(p_items) > 0 then
    insert into public.quote_items (
      quote_id, price_list_id, part_code, row_kind, product_name, quantity,
      unit_price_jpy, unit_price_krw, supply_amount, tax_amount, category,
      cost_amount, profit_amount, profit_rate, exchange_rate, tariff_rate,
      sub_lines, group_kind, model_name
    )
    select v_quote_id, x.price_list_id, x.part_code, x.row_kind, x.product_name, x.quantity,
           x.unit_price_jpy, x.unit_price_krw, x.supply_amount, x.tax_amount, x.category,
           x.cost_amount, x.profit_amount, x.profit_rate, x.exchange_rate, x.tariff_rate,
           x.sub_lines, x.group_kind, x.model_name
    from jsonb_populate_recordset(null::public.quote_items, p_items) x;
  end if;

  if jsonb_typeof(coalesce(p_expenses, 'null'::jsonb)) = 'array' and jsonb_array_length(p_expenses) > 0 then
    insert into public.quote_expenses (
      quote_id, item_name, unit_price, headcount, days, amount
    )
    select v_quote_id, x.item_name, x.unit_price,
           coalesce(x.headcount, 0), coalesce(x.days, 0), x.amount
    from jsonb_populate_recordset(null::public.quote_expenses, p_expenses) x;
  end if;

  if p_repair_id is not null then
    update public.repairs r
    set quote_id = v_quote_id
    where r.repair_id = p_repair_id;
    get diagnostics v_rows = row_count;
    v_linked := v_rows > 0;
  end if;

  return query select v_quote_id, v_number, v_seq, v_linked;
end;
$function$
