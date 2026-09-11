-- DB 함수 정의 스냅샷 (2026-09-11, pg_get_functiondef 로 추출)
-- 목적: DB 에만 있던 함수의 원본 보관. 복구 시 참고용.
-- 이 파일을 통째로 실행하지 마라. 필요한 함수만 골라 실행한다.
-- rls_auto_enable: public 에 새 테이블 생성 시 RLS 자동 활성화.
--   → 새 테이블은 정책을 만들지 않으면 전면 차단된다.

-- ===== handle_new_user =====
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.engineers (name, email)
  values (
    split_part(new.email, '@', 1),
    new.email
  );
  return new;
end;
$function$;

-- ===== has_team_perm =====
CREATE OR REPLACE FUNCTION public.has_team_perm(perm text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from engineers e
    left join teams t on t.name = e.teams
    where e.email = auth.jwt() ->> 'email'
      and (
        e.permission_level = 'superadmin'
        or (perm = 'customers'  and t.can_view_customers)
        or (perm = 'dashboard'  and t.can_view_dashboard)
        or (perm = 'quote'      and t.can_view_quote)
        or (perm = 'pipeline'   and t.can_view_pipeline)
        or (perm = 'sales_mgmt' and t.can_view_sales_mgmt)
        or (perm = 'admin'      and t.can_view_admin)
      )
  );
$function$;

-- ===== mark_log_restocked =====
CREATE OR REPLACE FUNCTION public.mark_log_restocked(p_log_id integer)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update public.inventory_logs set is_restocked = true where log_id = p_log_id;
$function$;

-- ===== next_quote_seq =====
CREATE OR REPLACE FUNCTION public.next_quote_seq(p_date text, p_engineer_id integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_seq integer;
begin
  insert into quote_sequence (date_str, engineer_id, seq)
  values (p_date, p_engineer_id, 1)
  on conflict (date_str, engineer_id)
  do update set seq = quote_sequence.seq + 1
  returning seq into v_seq;
  return v_seq;
end;
$function$;

-- ===== rls_auto_enable =====
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;
