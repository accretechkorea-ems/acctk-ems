-- db/merge_customer_sites_20261119.sql
--
-- 사업장(또는 회사) **두 줄 이상을 한 줄로 합치는** 함수.
--
-- ── 왜 DB 함수인가 ───────────────────────────────────────────────────────
--   customers 를 가리키는 표가 12개다(견적·장비·담당자·서비스·영업활동·홀딩·리드·
--   수리·쇼룸…). 화면에서 표를 하나씩 UPDATE 하면 중간에 끊겼을 때 **절반만 옮겨진
--   상태**가 남는다. 함수 한 번은 한 트랜잭션이라 전부 되거나 전부 안 된다.
--
-- ── 어떻게 전수조사하는가 ────────────────────────────────────────────────
--   표 이름을 여기 적어 두지 않는다. `pg_constraint` 에서 **customers 를 가리키는 외래키**
--   를 그때그때 읽어 그 칸을 전부 옮긴다. 나중에 표가 하나 늘어도 이 파일을 고칠 일이 없다.
--   (날짜가 붙은 스냅샷 표 — customers_backup_20261118 같은 것 — 는 건드리지 않는다.
--    그것들은 그 시점을 그대로 두어야 비교가 된다.)
--
-- ── 하는 일 ──────────────────────────────────────────────────────────────
--   ① 검사   남길 줄(keep)과 합칠 줄(from)이 **같은 성격·같은 소속**인가.
--              · 사업장끼리  … 같은 회사(parent_customer_id)에 속해야 한다.
--              · 회사끼리    … 둘 다 회사 줄(is_parent)이고 소속이 없다.
--              keep 이 from 에 들어 있으면 거부한다.
--   ② 이동   customers 를 가리키는 모든 외래키의 from → keep.
--              customers 자신도 포함이다 — from 의 **자식 사업장**(parent_customer_id)과
--              from 을 대리점으로 쓰던 줄(agency_customer_id)이 keep 을 가리키게 된다.
--              (회사 병합이 이 함수 하나로 끝나는 이유다.)
--   ③ 채움   keep 의 사업장명·주소·지역·좌표·대리점·메모·분류·영문명이 **비어 있을 때만**
--              from 의 값을 가져온다. 살아 있는 값은 덮지 않는다.
--   ④ 닫음   from 줄을 soft delete(deleted_at). 되돌리기는 없다.
--
--   dry_run = true 면 ①만 하고 ②의 **건수만** 세어 돌려준다(아무것도 바꾸지 않는다).
--
-- ── 되돌아오는 값(jsonb) ─────────────────────────────────────────────────
--   {
--     "keep_id": 123, "from_ids": [124,125], "dry_run": true, "total": 37,
--     "moved":  { "quotes.customer_id": 12, "devices.customer_id": 4, ... },
--     "dropped":{ "showroom_sites.customer_id": 1 },   -- 아래 ⚠ 참고
--     "filled": ["site_name","address"]
--   }
--
-- ⚠ showroom_sites 처럼 customer_id 자체가 기본키인 표는 keep 에 이미 줄이 있으면 옮길 수
--   없다. 그때는 from 쪽 줄을 지우고 "dropped" 에 적어 돌려준다(남길 줄의 설정을 살린다).
--
-- ── 권한 ─────────────────────────────────────────────────────────────────
--   service_role 만 실행한다. 화면에서는 /api/parent-company 라우트(슈퍼관리자)가 부른다.
--
-- 적용 뒤 **반드시** 스키마 캐시를 다시 읽혀야 RPC 로 보인다:
--     notify pgrst, 'reload schema';

create or replace function public.merge_customer_sites(
  keep_id bigint,
  from_ids bigint[],
  dry_run boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  keep      customers%rowtype;
  srcs      bigint[];
  bad_count int;
  rec       record;
  n         bigint;
  total     bigint := 0;
  moved     jsonb := '{}'::jsonb;
  dropped   jsonb := '{}'::jsonb;
  filled    text[] := '{}';
  col_name  text;
  val       text;
begin
  -- ── ① 검사 ───────────────────────────────────────────────────────────
  srcs := array(select distinct x from unnest(coalesce(from_ids, '{}'::bigint[])) x where x is not null);
  if coalesce(array_length(srcs, 1), 0) = 0 then
    raise exception '합칠 줄을 한 곳 이상 지정해주세요';
  end if;
  if keep_id = any(srcs) then
    raise exception '남길 줄이 합칠 줄 안에 들어 있습니다';
  end if;

  select * into keep from customers where customer_id = keep_id and deleted_at is null;
  if not found then
    raise exception '남길 줄을 찾을 수 없습니다 (customer_id=%)', keep_id;
  end if;

  select count(*) into bad_count
    from customers c
   where c.customer_id = any(srcs)
     and (c.deleted_at is not null
          or coalesce(c.is_parent, false) is distinct from coalesce(keep.is_parent, false)
          or c.parent_customer_id is distinct from keep.parent_customer_id);
  if bad_count > 0 then
    raise exception '같은 회사에 속한 같은 성격의 줄끼리만 합칠 수 있습니다 (어긋나는 줄 %건)', bad_count;
  end if;

  if (select count(*) from customers where customer_id = any(srcs) and deleted_at is null) <> array_length(srcs, 1) then
    raise exception '합칠 줄 중에 없는 줄이 있습니다';
  end if;

  -- ── ② 이동 ───────────────────────────────────────────────────────────
  for rec in
    select cl.relname::text as tbl, att.attname::text as col
      from pg_constraint con
      join pg_class cl      on cl.oid = con.conrelid
      join pg_namespace ns  on ns.oid = cl.relnamespace
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
     where con.contype = 'f'
       and con.confrelid = 'public.customers'::regclass
       and array_length(con.conkey, 1) = 1
       and ns.nspname = 'public'
       -- 날짜가 붙은 스냅샷·이관 기록 표는 그 시점 그대로 둔다.
       and cl.relname !~ '_20[0-9]{6}$'
     order by 1, 2
  loop
    execute format('select count(*) from public.%I where %I = any($1)', rec.tbl, rec.col)
      into n using srcs;
    if n > 0 then
      moved := moved || jsonb_build_object(rec.tbl || '.' || rec.col, n);
      total := total + n;
      if not dry_run then
        begin
          execute format('update public.%I set %I = $1 where %I = any($2)', rec.tbl, rec.col, rec.col)
            using keep_id, srcs;
        exception when unique_violation then
          -- 남길 줄에 이미 같은 짝이 있다(customer_id 가 기본키인 표). from 쪽 줄을 지운다.
          execute format('delete from public.%I where %I = any($1)', rec.tbl, rec.col) using srcs;
          get diagnostics n = row_count;
          dropped := dropped || jsonb_build_object(rec.tbl || '.' || rec.col, n);
          moved := moved - (rec.tbl || '.' || rec.col);
        end;
      end if;
    end if;
  end loop;

  if dry_run then
    return jsonb_build_object(
      'keep_id', keep_id, 'from_ids', to_jsonb(srcs), 'dry_run', true,
      'moved', moved, 'dropped', dropped, 'total', total
    );
  end if;

  -- ── ③ 채움 — keep 이 비어 있는 칸만 ──────────────────────────────────
  foreach col_name in array array['site_name','address','region1','note','industry','name_en']
  loop
    execute format(
      'select nullif(btrim(coalesce(%I::text, '''')), '''') from customers where customer_id = $1',
      col_name) into val using keep_id;
    if val is null then
      execute format(
        'select nullif(btrim(coalesce(%I::text, '''')), '''')
           from customers
          where customer_id = any($1) and nullif(btrim(coalesce(%I::text, '''')), '''') is not null
          order by customer_id limit 1',
        col_name, col_name) into val using srcs;
      if val is not null then
        execute format('update customers set %I = $1 where customer_id = $2', col_name)
          using val, keep_id;
        filled := filled || col_name;
      end if;
    end if;
  end loop;

  -- 숫자·FK 칸은 따로(문자로 바꿔 다루지 않는다).
  if keep.agency_customer_id is null then
    update customers k
       set agency_customer_id = f.agency_customer_id
      from (select agency_customer_id from customers
             where customer_id = any(srcs) and agency_customer_id is not null
             order by customer_id limit 1) f
     where k.customer_id = keep_id;
    if found then filled := filled || 'agency_customer_id'; end if;
  end if;

  if keep.latitude is null or keep.longitude is null then
    update customers k
       set latitude = f.latitude, longitude = f.longitude
      from (select latitude, longitude from customers
             where customer_id = any(srcs) and latitude is not null and longitude is not null
             order by customer_id limit 1) f
     where k.customer_id = keep_id;
    if found then filled := filled || 'latitude/longitude'; end if;
  end if;

  -- ── ④ 닫음 ───────────────────────────────────────────────────────────
  update customers set deleted_at = now() where customer_id = any(srcs);

  return jsonb_build_object(
    'keep_id', keep_id, 'from_ids', to_jsonb(srcs), 'dry_run', false,
    'moved', moved, 'dropped', dropped, 'filled', to_jsonb(filled), 'total', total
  );
end;
$$;

comment on function public.merge_customer_sites(bigint, bigint[], boolean) is
  '사업장·회사 줄 합치기. customers 를 가리키는 모든 외래키를 keep 으로 옮기고, 빈 칸을 채우고, from 줄을 닫는다(soft delete). dry_run=true 면 건수만 센다. 되돌리기 없음.';

-- 권한 — 화면(anon·authenticated)에서 직접 부를 수 없다. 라우트(service_role)만 부른다.
revoke all on function public.merge_customer_sites(bigint, bigint[], boolean) from public;
revoke all on function public.merge_customer_sites(bigint, bigint[], boolean) from anon, authenticated;
grant execute on function public.merge_customer_sites(bigint, bigint[], boolean) to service_role;
-- authenticator 에게도 준다. 요청은 anon·authenticated·service_role 로 **바꿔 탄 뒤** 실행되므로
-- 이 권한으로 화면이 직접 부를 수 있게 되지는 않는다. PostgREST 가 **스키마 목록을 만들 때**
-- 쓰는 역할이 authenticator 라, 여기에 권한이 없으면 함수가 목록에서 통째로 빠진다
-- (2026-11-19 실측: 적용 뒤에도 PGRST202 였다).
grant execute on function public.merge_customer_sites(bigint, bigint[], boolean) to authenticator;

-- PostgREST 가 새 함수를 알아보게 한다(이 줄을 빼면 RPC 가 404 다).
notify pgrst, 'reload schema';

-- ── 확인 ────────────────────────────────────────────────────────────────
-- 함수가 보는 외래키 목록(= 옮기는 칸 전부):
--   select cl.relname, att.attname
--     from pg_constraint con
--     join pg_class cl on cl.oid = con.conrelid
--     join pg_namespace ns on ns.oid = cl.relnamespace
--     join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
--    where con.contype='f' and con.confrelid='public.customers'::regclass
--      and ns.nspname='public' and cl.relname !~ '_20[0-9]{6}$'
--    order by 1,2;
