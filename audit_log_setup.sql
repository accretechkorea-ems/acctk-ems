-- ============================================================
-- 감사 로그(audit_log): 민감 테이블의 변경(INSERT/UPDATE/DELETE)을
-- "누가·언제·무엇을" 자동 기록. 조회/다운로드는 앱 서버 라우트에서 READ로 적재.
--
-- 설계 원칙 (기능 무영향 보장):
--  - AFTER 트리거 + 예외 무시(fail-open) → 로그 적재 실패가 실제 작업을 절대 막지 않음
--  - append-only: 일반 사용자는 조회 불가(superadmin만), 수정/삭제 정책 없음
--  - SECURITY DEFINER 함수는 audit_log INSERT 전용 → 데이터 열람 통로가 아님
-- Supabase SQL Editor에서 1회 실행.
-- ============================================================

create table if not exists audit_log (
  id           bigint generated always as identity primary key,
  occurred_at  timestamptz not null default now(),
  actor_uid    uuid,
  actor_email  text,
  action       text not null,          -- INSERT | UPDATE | DELETE | READ
  table_name   text not null,
  row_id       text,
  old_data     jsonb,
  new_data     jsonb
);

create index if not exists audit_log_table_time_idx on audit_log (table_name, occurred_at desc);
create index if not exists audit_log_actor_idx on audit_log (actor_email, occurred_at desc);

alter table audit_log enable row level security;

-- 조회는 superadmin만 (감사 로그 열람 통제)
drop policy if exists "audit_log superadmin read" on audit_log;
create policy "audit_log superadmin read" on audit_log
  for select to authenticated
  using (exists (
    select 1 from engineers e
    where e.email = (auth.jwt() ->> 'email') and e.permission_level = 'superadmin'
  ));

-- READ(열람/다운로드) 기록은 서버(service_role)에서만 적재 → 클라이언트 INSERT 정책은 두지 않음.
-- (service_role 은 RLS 를 우회하므로 별도 insert 정책 불필요)

-- 변경 기록 트리거 함수
create or replace function audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid;
  v_email text;
begin
  begin
    v_uid   := auth.uid();
    v_email := auth.jwt() ->> 'email';
  exception when others then
    v_uid := null; v_email := null;
  end;

  begin
    if (tg_op = 'DELETE') then
      insert into audit_log(actor_uid, actor_email, action, table_name, row_id, old_data)
      values (v_uid, v_email, tg_op, tg_table_name, (to_jsonb(old) ->> (tg_argv[0])), to_jsonb(old));
      return old;
    elsif (tg_op = 'UPDATE') then
      insert into audit_log(actor_uid, actor_email, action, table_name, row_id, old_data, new_data)
      values (v_uid, v_email, tg_op, tg_table_name, (to_jsonb(new) ->> (tg_argv[0])), to_jsonb(old), to_jsonb(new));
      return new;
    else
      insert into audit_log(actor_uid, actor_email, action, table_name, row_id, new_data)
      values (v_uid, v_email, tg_op, tg_table_name, (to_jsonb(new) ->> (tg_argv[0])), to_jsonb(new));
      return new;
    end if;
  exception when others then
    -- 감사 적재 실패가 실제 작업을 막지 않도록 무시 (fail-open)
    return coalesce(new, old);
  end;
end;
$$;

-- 민감 테이블에 트리거 부착 (인자 = 각 테이블의 기본키 컬럼명)
drop trigger if exists audit_customers on customers;
create trigger audit_customers after insert or update or delete on customers
  for each row execute function audit_row_change('customer_id');

drop trigger if exists audit_quotes on quotes;
create trigger audit_quotes after insert or update or delete on quotes
  for each row execute function audit_row_change('quote_id');

drop trigger if exists audit_quote_items on quote_items;
create trigger audit_quote_items after insert or update or delete on quote_items
  for each row execute function audit_row_change('id');

drop trigger if exists audit_devices on devices;
create trigger audit_devices after insert or update or delete on devices
  for each row execute function audit_row_change('device_id');

drop trigger if exists audit_contacts on contacts;
create trigger audit_contacts after insert or update or delete on contacts
  for each row execute function audit_row_change('contact_id');

drop trigger if exists audit_service_history on service_history;
create trigger audit_service_history after insert or update or delete on service_history
  for each row execute function audit_row_change('service_id');

drop trigger if exists audit_engineers on engineers;
create trigger audit_engineers after insert or update or delete on engineers
  for each row execute function audit_row_change('engineer_id');

drop trigger if exists audit_teams on teams;
create trigger audit_teams after insert or update or delete on teams
  for each row execute function audit_row_change('id');
