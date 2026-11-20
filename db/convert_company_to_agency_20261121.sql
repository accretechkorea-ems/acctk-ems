-- db/convert_company_to_agency_20261121.sql
--
-- **회사 한 줄을 대리점으로 바꾼다.**
--
-- ── 왜 ───────────────────────────────────────────────────────────────────
--   CRM 정리(2026-11-19)에서 대리점을 customers 의 한 줄로 모았다. 그때 「회사 + 사업장
--   한 곳」으로 들어온 줄 중에, 사실은 우리 고객이 아니라 **대리점**인 곳이 섞여 있다
--   (거래는 그 회사를 거쳐 하지만 그 회사에 우리 장비가 있는 것은 아닌 자리).
--   화면에서 손으로 고치려면 칸 여섯 개를 건드리고 회사 줄을 닫아야 하는데, 중간에
--   끊기면 **회사도 아니고 대리점도 아닌 줄**이 남는다. 함수 한 번은 한 트랜잭션이다.
--
-- ── 무엇을 하는가 ────────────────────────────────────────────────────────
--   ① 검사
--        · 그 줄이 살아있는 **회사 줄**인가(is_parent).
--        · 살아있는 사업장이 **정확히 1곳**인가. 2곳 이상이면 어느 줄이 대리점인지
--          사람이 정해야 한다(2026-11-21 실측: 살아있는 회사 840 중 610곳이 1곳이다).
--        · 그 사업장이 **이미 대리점이 아닌가**(13곳은 이미 대리점이다 — 그 줄을 또
--          대리점으로 만들면 두 대리점이 한 줄로 겹친다).
--        · **회사 줄에 직접 붙은 참조가 없는가.** customers 를 가리키는 외래키를
--          pg_constraint 에서 그때그때 읽어 전수로 센다(표가 늘어도 이 파일을 고칠 일이
--          없다 — merge_customer_sites 와 같은 방식). 하나라도 있으면 **막고 목록을
--          돌려준다** — 회사 줄을 닫으면 그 참조가 닫힌 줄을 가리키게 되기 때문이다.
--          2026-11-21 실측: 1곳짜리 회사 610곳 중 참조가 있는 곳은 1곳(customers.
--          agency_customer_id 2줄)뿐이다.
--   ② 전환   그 **사업장 줄**을 대리점으로 바꾼다.
--              is_agency = true · is_parent = false · parent_customer_id = null ·
--              site_name = null · agency_customer_id = null ·
--              company_name = 회사의 이름(대리점 이름은 회사명이다)
--   ③ 닫음   **회사 줄**을 soft delete(deleted_at = now()).
--
--   담당자·장비·활동·견적·서비스는 **사업장 줄에 붙어 있으므로** 손대지 않는다 —
--   줄이 그대로 남아 대리점이 되므로 전부 따라간다. dry_run 이 그 건수를 세어 준다.
--
--   p_dry_run = true(기본) 면 ①만 하고 아무것도 바꾸지 않는다.
--
-- ── 되돌아오는 값(jsonb) ─────────────────────────────────────────────────
--   막혔을 때
--     { "ok": false, "dry_run": true, "company_id": 1638, "company_name": "...",
--       "site_id": 1639, "blockers": { "customers.agency_customer_id": 2 },
--       "blocker_total": 2 }
--   괜찮을 때
--     { "ok": true, "dry_run": true, "company_id": 2440, "company_name": "삼성정공",
--       "site_id": 2441, "site_name": "본사", "agency_name": "삼성정공",
--       "follows": { "devices.customer_id": 3, "quotes.customer_id": 1 },
--       "follows_total": 4 }
--   전환했을 때는 같은 모양에 "dry_run": false 다.
--
-- ── 되돌리기 ─────────────────────────────────────────────────────────────
--   자동으로는 없다. 손으로 되돌리려면(그 줄의 번호를 알고 있을 때):
--     update customers set deleted_at = null where customer_id = <company_id>;
--     update customers set is_agency = false, is_parent = false,
--            parent_customer_id = <company_id>, site_name = '<옛 사업장명>'
--      where customer_id = <site_id>;
--   ⚠ 옛 site_name 은 전환이 비우므로 **전환 전에 적어 두어야 한다**(dry_run 결과의
--     site_name 이 그 값이다).
--
-- ── 권한 ─────────────────────────────────────────────────────────────────
--   service_role 만 실행한다. 화면에서는 슈퍼관리자가 라우트를 거쳐 부른다.
--   authenticator 에게도 주어야 PostgREST 의 함수 목록에 보인다(2026-11-19 실측).
--
-- 적용 뒤 **반드시** 스키마 캐시를 다시 읽혀야 RPC 로 보인다:
--     notify pgrst, 'reload schema';
--
-- 재실행 안전(create or replace).

create or replace function public.convert_company_to_agency(
  p_company_id bigint,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company   customers;
  v_site      customers;
  v_site_id   bigint;
  v_live      int;
  v_refs      jsonb := '{}'::jsonb;
  v_total     int := 0;
  v_follows   jsonb := '{}'::jsonb;
  v_follows_n int := 0;
  v_cnt       int;
  r           record;
begin
  -- ── ① 검사 ──────────────────────────────────────────────────────────
  select * into v_company from customers where customer_id = p_company_id;
  if not found then
    raise exception '회사를 찾을 수 없습니다 (id=%)', p_company_id;
  end if;
  if v_company.deleted_at is not null then
    raise exception '이미 닫힌 줄입니다 (id=%)', p_company_id;
  end if;
  if not coalesce(v_company.is_parent, false) then
    raise exception '회사 줄이 아닙니다 — 사업장·대리점 줄은 전환할 수 없습니다 (id=%)', p_company_id;
  end if;

  select count(*) into v_live
    from customers
   where parent_customer_id = p_company_id and deleted_at is null;
  if v_live <> 1 then
    raise exception '살아있는 사업장이 정확히 1곳이어야 합니다 (지금 %곳)', v_live;
  end if;

  select * into v_site
    from customers
   where parent_customer_id = p_company_id and deleted_at is null;
  v_site_id := v_site.customer_id;

  if coalesce(v_site.is_agency, false) then
    raise exception '그 사업장은 이미 대리점입니다 (site_id=%)', v_site_id;
  end if;

  -- 회사 줄에 **직접** 붙은 참조 — 하나라도 있으면 막는다.
  for r in
    select cl.relname as tbl, att.attname as col
      from pg_constraint con
      join pg_class cl on cl.oid = con.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
     where con.contype = 'f'
       and con.confrelid = 'public.customers'::regclass
       and ns.nspname = 'public'
       -- 날짜가 붙은 스냅샷 표는 그 시점을 그대로 둔다(비교용이다).
       and cl.relname !~ '_20[0-9]{6}$'
     order by 1, 2
  loop
    -- 자식 사업장(parent_customer_id)은 전환이 정리하는 칸이라 세지 않는다.
    if r.tbl = 'customers' and r.col = 'parent_customer_id' then
      continue;
    end if;
    execute format('select count(*) from public.%I where %I = $1', r.tbl, r.col)
       into v_cnt using p_company_id;
    if v_cnt > 0 then
      v_refs := v_refs || jsonb_build_object(r.tbl || '.' || r.col, v_cnt);
      v_total := v_total + v_cnt;
    end if;
    -- 사업장 줄에 붙어 **그대로 따라가는** 것도 함께 센다(사람에게 보여 줄 값이다).
    execute format('select count(*) from public.%I where %I = $1', r.tbl, r.col)
       into v_cnt using v_site_id;
    if v_cnt > 0 then
      v_follows := v_follows || jsonb_build_object(r.tbl || '.' || r.col, v_cnt);
      v_follows_n := v_follows_n + v_cnt;
    end if;
  end loop;

  if v_total > 0 then
    return jsonb_build_object(
      'ok', false, 'dry_run', p_dry_run,
      'company_id', p_company_id, 'company_name', v_company.company_name,
      'site_id', v_site_id, 'site_name', v_site.site_name,
      'blockers', v_refs, 'blocker_total', v_total
    );
  end if;

  if p_dry_run then
    return jsonb_build_object(
      'ok', true, 'dry_run', true,
      'company_id', p_company_id, 'company_name', v_company.company_name,
      'site_id', v_site_id, 'site_name', v_site.site_name,
      'agency_name', v_company.company_name,
      'follows', v_follows, 'follows_total', v_follows_n
    );
  end if;

  -- ── ② 전환 ──────────────────────────────────────────────────────────
  update customers
     set is_agency          = true,
         is_parent          = false,
         parent_customer_id = null,
         site_name          = null,
         agency_customer_id = null,
         company_name       = v_company.company_name
   where customer_id = v_site_id;

  -- ── ③ 회사 줄 닫음 ──────────────────────────────────────────────────
  update customers
     set deleted_at = now()
   where customer_id = p_company_id;

  return jsonb_build_object(
    'ok', true, 'dry_run', false,
    'company_id', p_company_id, 'company_name', v_company.company_name,
    'site_id', v_site_id, 'site_name', v_site.site_name,
    'agency_name', v_company.company_name,
    'follows', v_follows, 'follows_total', v_follows_n
  );
end
$$;

comment on function public.convert_company_to_agency(bigint, boolean) is
  '회사 한 줄을 대리점으로 바꾼다. 살아있는 사업장이 정확히 1곳이고 회사 줄에 직접 붙은 참조가 없을 때만. 그 사업장 줄을 대리점으로 바꾸고 회사 줄을 닫는다(soft delete). dry_run=true(기본) 면 검사만 한다. 되돌리기는 파일 머리말의 수동 절차뿐.';

-- 권한 — 화면(anon·authenticated)에서 직접 부를 수 없다. 라우트(service_role)만 부른다.
revoke all on function public.convert_company_to_agency(bigint, boolean) from public;
revoke all on function public.convert_company_to_agency(bigint, boolean) from anon, authenticated;
grant execute on function public.convert_company_to_agency(bigint, boolean) to service_role;
-- authenticator 에게도 준다 — PostgREST 가 **스키마 목록을 만들 때** 쓰는 역할이라,
-- 여기에 권한이 없으면 함수가 목록에서 통째로 빠진다(PGRST202).
grant execute on function public.convert_company_to_agency(bigint, boolean) to authenticator;

-- PostgREST 가 새 함수를 알아보게 한다(이 줄을 빼면 RPC 가 404 다).
notify pgrst, 'reload schema';

-- ── 확인(적용 뒤) ───────────────────────────────────────────────────────
-- ⒜ 함수가 보인다:
--      select public.convert_company_to_agency(2440, true);
-- ⒝ 막히는 쪽도 본다(회사 줄에 참조가 있는 자리 — 2026-11-21 실측 1638):
--      select public.convert_company_to_agency(1638, true);
--    → {"ok": false, "blockers": {"customers.agency_customer_id": 2}, ...}
-- ⒞ 사업장이 여럿인 회사는 거부한다:
--      select public.convert_company_to_agency(1729, true);   -- 현대자동차(47곳)
--    → ERROR: 살아있는 사업장이 정확히 1곳이어야 합니다 (지금 47곳)
