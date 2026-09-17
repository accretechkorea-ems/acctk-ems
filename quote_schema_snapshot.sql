-- 견적 스키마 스냅샷 (2026-09-16, 실제 DB 에서 추출)
-- 목적: 레포에 정의가 없어 코드와 DB 의 전제가 어긋나던 문제를 막기 위한 기준 문서.
-- 이 파일을 실행하지 마라. 현재 DB 상태의 기록이다.
-- 스키마를 바꾸면 이 파일도 함께 갱신한다.

-- ===== quotes =====
-- PK: quote_id (identity)
-- NOT NULL 이고 기본값 없음: quote_number, quote_date, created_by
-- 기본값: status '견적중', total_* 0, created_at now()
-- FK: customer_id→customers, dealer_id→customers, engineer_id→engineers,
--     created_by→engineers, opportunity_id→sales_opportunities
-- UNIQUE: 없음  ← quote_number 에 유니크가 없다. 코드가 중복 방어를 직접 한다.
-- CHECK: 없음   ← status 는 어떤 문자열이든 저장된다.

-- ===== quote_items =====
-- PK: item_id (identity)
-- FK: quote_id→quotes ON DELETE CASCADE, price_list_id→price_list
-- NOT NULL: item_id 뿐. 나머지는 전부 nullable
-- 기본값: quantity 1

-- ===== quote_expenses =====
-- PK: expense_id (serial)
-- FK: quote_id→quotes ON DELETE CASCADE
-- NOT NULL 이고 기본값 없음: quote_id, item_name, unit_price, amount
-- 기본값: headcount 0, days 0, created_at now()

-- ===== quote_sequence =====
-- PK: id (serial)
-- UNIQUE INDEX: quote_sequence_date_engineer_key (date_str, engineer_id)
--   ← next_quote_seq 의 on conflict 이 이 인덱스를 쓴다. 지우면 42P10 으로 저장 전면 실패.
-- 기본값: seq 1

-- ===== quotes 를 참조하는 FK =====
-- quote_items.quote_id       ON DELETE CASCADE
-- quote_expenses.quote_id    ON DELETE CASCADE
-- download_logs.quote_id     ON DELETE SET NULL
-- showroom_usage.quote_id    ON DELETE SET NULL  (2026-09-16 변경, 이전에는 NO ACTION)
--   → quotes 만 삭제하면 품목·부대비용은 자동 삭제되고 나머지는 연결만 끊긴다.

-- ===== RLS 정책 (현재 상태) =====
-- quotes
create policy quotes_select on public.quotes for select to authenticated
  using (exists (select 1 from engineers me
    where me.email = (auth.jwt() ->> 'email')
      and (me.permission_level = 'superadmin'
        or has_team_perm('quote') or has_team_perm('sales_mgmt')
        or quotes.engineer_id = me.engineer_id)));
create policy quotes_update on public.quotes for update to authenticated
  with check (exists (select 1 from engineers me
    where me.email = (auth.jwt() ->> 'email')
      and (me.permission_level = 'superadmin' or quotes.engineer_id = me.engineer_id)));
create policy quotes_delete on public.quotes for delete to authenticated
  using (exists (select 1 from engineers me
    where me.email = (auth.jwt() ->> 'email')
      and (me.permission_level = 'superadmin' or quotes.engineer_id = me.engineer_id)));
-- quotes INSERT 정책 3개(quotes_insert, quotes_insert_on_behalf,
-- quotes_insert_author_is_self)는 with_check 가 null 이다 = 제한 없음.

-- quote_items — 부모 견적이 존재하기만 하면 허용한다.
-- ⚠ quotes SELECT 가 견적 권한자 전체에게 열려 있어, 사실상 로그인 사용자면
--   남의 견적 품목도 조회·수정·삭제할 수 있다. 화면 가드에만 의존하는 상태.
create policy quote_items_select_via_parent on public.quote_items for select to authenticated
  using (exists (select 1 from quotes q where q.quote_id = quote_items.quote_id));
create policy quote_items_insert_via_parent on public.quote_items for insert to authenticated
  with check (exists (select 1 from quotes q where q.quote_id = quote_items.quote_id));
create policy quote_items_update_via_parent on public.quote_items for update to authenticated
  using (exists (select 1 from quotes q where q.quote_id = quote_items.quote_id));
create policy quote_items_delete_via_parent on public.quote_items for delete to authenticated
  using (exists (select 1 from quotes q where q.quote_id = quote_items.quote_id));

-- quote_expenses — 견적 권한만 본다. 남의 견적 부대비용도 수정·삭제 가능.
create policy quote_expenses_select on public.quote_expenses for select to authenticated
  using (has_team_perm('quote'));
create policy quote_expenses_insert on public.quote_expenses for insert to authenticated
  with check (has_team_perm('quote'));
create policy quote_expenses_update on public.quote_expenses for update to authenticated
  using (has_team_perm('quote')) with check (has_team_perm('quote'));
create policy quote_expenses_delete_superadmin on public.quote_expenses for delete to authenticated
  using (is_superadmin());
-- ⚠ DELETE 는 superadmin 만인데, 삭제 코드는 브라우저에서 quote_expenses 를 먼저 지운다.
--   실제로는 quotes 삭제 시 CASCADE 로 지워지므로 이 정책과 무관하게 동작한다.

-- quote_sequence — 전면 허용. 로그인 사용자면 카운터를 직접 조작할 수 있다.
create policy authenticated_only on public.quote_sequence for all to authenticated
  using (true) with check (true);

-- download_logs
create policy download_logs_select on public.download_logs for select to authenticated
  using (current_engineer_id() is not null);
create policy download_logs_insert on public.download_logs for insert to authenticated
  with check (current_engineer_id() is not null);
