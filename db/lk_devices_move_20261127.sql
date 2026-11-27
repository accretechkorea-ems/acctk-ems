-- (주)엘케이엔지니어링 **장비 재배치** (2026-11-27, 묶음5 9-2)
--
-- ── 무엇을 되돌리나 ──────────────────────────────────────────────────────
--   누군가 사업장 병합으로 장비 **21대를 「L1」 한 곳에 몰았다.** Kevin 이 제자리를 받을
--   사업장 틀(본딩1실·본딩2실·입고실·파이널실·표면가공실·수입검사실·실험실·검사실·
--   클린룸·소성실·가공실)을 만들어 두었고, S/N 과 가야 할 사업장을 적은 표를 주었다.
--
--   대조 결과는 **docs/lk-devices-20261127.md** 에 있다. 거기 「판단 필요」 넷에 먼저
--   답을 받아야 ②를 풀 수 있다.
--
-- ── 이 파일의 차례 ───────────────────────────────────────────────────────
--   [0단계] 조회   — 지금 수를 눈으로 본다. **아무것도 바꾸지 않는다.**
--   ①            S/N 이 맞는 장비를 제 사업장으로. 그 장비에 걸린 표도 함께.
--   ②            표에는 있는데 EMS 에 없는 12대를 새로 만든다 — **주석 처리**(판단 대기)
--   ③            L1 에 남은 것 전부 → L1-본딩1실
--   ④            L1 을 소프트 삭제(사유 「잘못된 병합 해체」) + 남은 FK 0건 확인
--
-- ── 지키는 것 ────────────────────────────────────────────────────────────
--   · 전부 **한 트랜잭션**이다. 가운데서 실패하면 아무것도 바뀌지 않는다.
--   · **재실행 안전** — 이미 옮긴 줄은 다시 옮겨도 같은 값이 된다(where 가 걸러 낸다).
--   · 담당자(contacts)는 **손대지 않는다**(지시 9-3).
--   · 옮긴 일은 customer_events 에 남긴다 — 나중에 「왜 여기 있지」를 물을 수 있게.
--
-- ⚠ **돌리기 전에 [0단계] 를 먼저 돌려 수를 확인한다.** 2026-11-27 의 수와 다르면
--   그 사이에 누가 또 옮긴 것이다 — 멈추고 docs 를 다시 만든다.


-- ════════════════════════════════════════════════════════════════════════
-- [0단계] 조회 — 바꾸기 전에 눈으로 본다
-- ════════════════════════════════════════════════════════════════════════

-- 0-1. 회사와 살아 있는 사업장 (2026-11-27: 회사 1640 · 사업장 12곳)
select customer_id, site_name, deleted_at
  from public.customers
 where parent_customer_id = 1640 and deleted_at is null
 order by site_name;

-- 0-2. 사업장별 장비 수 (2026-11-27: L1 21대 · L3-소성실 1 · L3-클린룸 1)
select c.customer_id, c.site_name, count(d.device_id) as devices
  from public.customers c
  left join public.devices d
         on d.customer_id = c.customer_id and d.deleted_at is null
 where c.parent_customer_id = 1640 and c.deleted_at is null
 group by c.customer_id, c.site_name
 order by devices desc;

-- 0-3. S/N 이 맞아 옮길 장비 (2026-11-27: **13대** — 93 번은 이미 제자리다)
--      정규화: 대문자 + 공백·하이픈 제거.
with want(sn, site_name) as (values
  ('KC1405EJ','L1-본딩1실'), ('KC1411AA','L1-본딩1실'), ('KC1408KZ','L1-본딩2실'),
  ('KC1402FP','L1-입고실'),  ('KC1403FP','L1-파이널실'), ('KC1402HX','L1-파이널실'),
  ('KC1403GY','L1-입고실'),  ('KC1407AA','L1-파이널실'), ('KC1404AA','L1-입고실'),
  ('KC1405FF','L1-표면가공실'), ('KC1402CR','L1-표면가공실'), ('KC1402JX','L1-표면가공실'),
  ('KC1403FY','L1-표면가공실'), ('KC1407KZ','M1-가공실'), ('KC1405AA','L1-표면가공실'),
  ('KC1406AA','L1-표면가공실'), ('KC1402FL','L3-검사실'), ('KC1404MR','L3-검사실'),
  ('KC1408BX','L3-클린룸'),  ('KC1405GY','L3-검사실'), ('KC1402JY','L3-검사실'),
  ('KC1407GZ','L3-소성실'),  ('KC1401DV','L1-수입검사실'), ('KC1402ER','L2-실험실'),
  ('KC1410HY','L2-실험실')
)
select d.device_id, d.device_name, d.device_name2, d.serial_number,
       cur.site_name as now_site, w.site_name as go_site, tgt.customer_id as go_id
  from public.devices d
  join public.customers cur on cur.customer_id = d.customer_id
  join want w on upper(replace(replace(d.serial_number,' ',''),'-','')) = w.sn
  left join public.customers tgt
         on tgt.parent_customer_id = 1640 and tgt.site_name = w.site_name and tgt.deleted_at is null
 where cur.parent_customer_id = 1640 and d.deleted_at is null
 order by d.device_id;

-- 0-4. L1 에 **장비 말고** 걸린 것 (2026-11-27: 견적 8 · 활동 1 · 사건 3 · 담당자 25)
select 'quotes' as t, count(*) from public.quotes where customer_id = 1426
union all select 'sales_opportunities', count(*) from public.sales_opportunities where customer_id = 1426
union all select 'sales_activities', count(*) from public.sales_activities where customer_id = 1426
union all select 'inquiries', count(*) from public.inquiries where customer_id = 1426
union all select 'customer_events', count(*) from public.customer_events where customer_id = 1426
union all select 'repairs', count(*) from public.repairs where customer_id = 1426
union all select 'service_history', count(*) from public.service_history where customer_id = 1426
union all select 'contacts (손대지 않는다)', count(*) from public.contacts where customer_id = 1426;

-- 0-5. S/N 이 **겹치는** 줄 — 판단 필요 ①. 0건이 아니면 멈추고 사람이 본다.
select upper(replace(replace(d.serial_number,' ',''),'-','')) as sn, count(*), array_agg(d.device_id)
  from public.devices d
  join public.customers c on c.customer_id = d.customer_id
 where c.parent_customer_id = 1640 and d.deleted_at is null
   and coalesce(trim(d.serial_number),'') <> ''
 group by 1 having count(*) > 1;


-- ════════════════════════════════════════════════════════════════════════
-- 본문 — 한 트랜잭션
-- ════════════════════════════════════════════════════════════════════════
begin;

-- 가야 할 자리를 한 번만 만들어 둔다.
create temporary table lk_move on commit drop as
with want(sn, site_name) as (values
  ('KC1405EJ','L1-본딩1실'), ('KC1411AA','L1-본딩1실'), ('KC1408KZ','L1-본딩2실'),
  ('KC1402FP','L1-입고실'),  ('KC1403FP','L1-파이널실'), ('KC1402HX','L1-파이널실'),
  ('KC1403GY','L1-입고실'),  ('KC1407AA','L1-파이널실'), ('KC1404AA','L1-입고실'),
  ('KC1405FF','L1-표면가공실'), ('KC1402CR','L1-표면가공실'), ('KC1402JX','L1-표면가공실'),
  ('KC1403FY','L1-표면가공실'), ('KC1407KZ','M1-가공실'), ('KC1405AA','L1-표면가공실'),
  ('KC1406AA','L1-표면가공실'), ('KC1402FL','L3-검사실'), ('KC1404MR','L3-검사실'),
  ('KC1408BX','L3-클린룸'),  ('KC1405GY','L3-검사실'), ('KC1402JY','L3-검사실'),
  ('KC1407GZ','L3-소성실'),  ('KC1401DV','L1-수입검사실'), ('KC1402ER','L2-실험실'),
  ('KC1410HY','L2-실험실')
)
select d.device_id, d.customer_id as from_id, tgt.customer_id as to_id
  from public.devices d
  join public.customers cur on cur.customer_id = d.customer_id
  join want w on upper(replace(replace(d.serial_number,' ',''),'-','')) = w.sn
  join public.customers tgt
    on tgt.parent_customer_id = 1640 and tgt.site_name = w.site_name and tgt.deleted_at is null
 where cur.parent_customer_id = 1640
   and d.deleted_at is null
   -- **이미 제자리면 건드리지 않는다** — 재실행 안전의 핵심이다.
   and d.customer_id <> tgt.customer_id;

-- 가야 할 사업장을 못 찾은 줄이 있으면 **멈춘다**(틀이 아직 없다는 뜻이다).
do $$
declare missing int;
begin
  select count(*) into missing from lk_move where to_id is null;
  if missing > 0 then
    raise exception '가야 할 사업장을 못 찾은 장비가 % 대 있다 — 사업장 틀을 먼저 확인하라', missing;
  end if;
end $$;

-- ── ① 장비를 제자리로 ──────────────────────────────────────────────────
update public.devices d
   set customer_id = m.to_id
  from lk_move m
 where d.device_id = m.device_id;

-- 그 장비에 걸린 표도 **함께** 옮긴다(docs 의 ⑤ 전수 표 그대로).
update public.service_history s
   set customer_id = m.to_id
  from lk_move m
 where s.device_id = m.device_id and s.customer_id is distinct from m.to_id;

update public.inquiries i
   set customer_id = m.to_id
  from lk_move m
 where i.device_id = m.device_id and i.customer_id is distinct from m.to_id;

update public.showroom_usage u
   set customer_id = m.to_id
  from lk_move m
 where u.device_id = m.device_id and u.customer_id is distinct from m.to_id;

-- 옮긴 일을 **그 사업장의 이력**에 남긴다.
insert into public.customer_events (customer_id, event_type, payload)
select m.to_id, 'device_edited',
       jsonb_build_object(
         'mode', 'moved',
         'device_id', m.device_id,
         'from_customer_id', m.from_id,
         'note', '장비 이동 L1 → ' || coalesce(c.site_name, '?') || ' (잘못된 병합 해체, 2026-11-27)'
       )
  from lk_move m
  join public.customers c on c.customer_id = m.to_id;


-- ── ② 표에는 있는데 EMS 에 없는 12대 — **주석 처리**(판단 대기) ─────────
--
--   docs 의 「판단 필요 ④」 — 라인업 이름을 「조도/형상 측정기」로 할지, 지금 EMS 의 같은
--   기종처럼 「SURFCOM1400G-64」 꼴로 할지 먼저 정해야 한다. 정해지면 아래 주석을 푼다.
--   master_pending 은 **마스터 밖 이름**이라는 자국이다(db/equipment_master_20261126.sql).
--
-- insert into public.devices (customer_id, device_name, device_name2, option, serial_number, status, memo, master_pending)
-- select tgt.customer_id, '조도/형상 측정기', null, null, v.sn, '사용중',
--        '관리번호 ' || v.mgmt || ' (2026-11-27 재배치 때 신규 등록)', true
--   from (values
--     ('KC1405EJ','L1-본딩1실','LK-A-007'), ('KC1411AA','L1-본딩1실','LK-A-059'),
--     ('KC1402HX','L1-파이널실','LK-I-081'), ('KC1407AA','L1-파이널실','LK-I-277'),
--     ('KC1404AA','L1-입고실','LK-I-278'),  ('KC1402CR','L1-표면가공실','LK-M-026'),
--     ('KC1402JX','L1-표면가공실','LK-M-047'), ('KC1405AA','L1-표면가공실','LK-M-079'),
--     ('KC1406AA','L1-표면가공실','LK-M-080'), ('KC1402JY','L3-검사실','LK-P-162'),
--     ('KC1401DV','L1-수입검사실','LK-Q-009'), ('KC1402ER','L2-실험실','LK-R-015')
--   ) as v(sn, site_name, mgmt)
--   join public.customers tgt
--     on tgt.parent_customer_id = 1640 and tgt.site_name = v.site_name and tgt.deleted_at is null
--  -- 재실행 안전 — 그 S/N 이 이미 있으면 만들지 않는다.
--  where not exists (
--    select 1 from public.devices d
--     where upper(replace(replace(d.serial_number,' ',''),'-','')) = v.sn and d.deleted_at is null
--  );


-- ── ③ L1 에 남은 것 전부 → L1-본딩1실 ─────────────────────────────────
--
--   ⚠ **L1(1426) 에 있는 것만** 옮긴다. 이미 다른 사업장에 있는 잔여 장비(78 — L3-클린룸)는
--     건드리지 않는다. docs 의 「판단 필요 ②」 — 제자리에 두는 쪽이 보수적이다.

create temporary table lk_bond1 on commit drop as
select customer_id as id from public.customers
 where parent_customer_id = 1640 and site_name = 'L1-본딩1실' and deleted_at is null
 limit 1;

do $$
begin
  if not exists (select 1 from lk_bond1) then
    raise exception 'L1-본딩1실 사업장을 찾지 못했다 — 틀을 먼저 만들라';
  end if;
end $$;

update public.devices             set customer_id = (select id from lk_bond1) where customer_id = 1426;
update public.quotes              set customer_id = (select id from lk_bond1) where customer_id = 1426;
update public.sales_opportunities set customer_id = (select id from lk_bond1) where customer_id = 1426;
update public.sales_activities    set customer_id = (select id from lk_bond1) where customer_id = 1426;
update public.inquiries           set customer_id = (select id from lk_bond1) where customer_id = 1426;
update public.repairs             set customer_id = (select id from lk_bond1) where customer_id = 1426;
update public.customer_events     set customer_id = (select id from lk_bond1) where customer_id = 1426;
-- 장비 없는 서비스 기록 — 0건을 기대한다(docs ④). 있으면 함께 간다.
update public.service_history     set customer_id = (select id from lk_bond1) where customer_id = 1426;
-- ⚠ contacts 는 **손대지 않는다**(지시 9-3).


-- ── ④ L1 을 소프트 삭제 ───────────────────────────────────────────────
update public.customers
   set deleted_at = now(),
       delete_reason = '잘못된 병합 해체 (2026-11-27)'
 where customer_id = 1426 and deleted_at is null;

-- 남은 FK 가 **0건**인지 본다. 하나라도 남으면 통째로 되돌린다.
do $$
declare left_over int;
begin
  select
      (select count(*) from public.devices             where customer_id = 1426)
    + (select count(*) from public.quotes              where customer_id = 1426)
    + (select count(*) from public.sales_opportunities where customer_id = 1426)
    + (select count(*) from public.sales_activities    where customer_id = 1426)
    + (select count(*) from public.inquiries           where customer_id = 1426)
    + (select count(*) from public.repairs             where customer_id = 1426)
    + (select count(*) from public.customer_events     where customer_id = 1426)
    + (select count(*) from public.service_history     where customer_id = 1426)
    into left_over;
  if left_over > 0 then
    raise exception 'L1 에 아직 % 건이 걸려 있다 — 되돌린다', left_over;
  end if;
end $$;

commit;

notify pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════════
-- 돌린 뒤 — 눈으로 확인
-- ════════════════════════════════════════════════════════════════════════
-- select c.site_name, count(d.device_id)
--   from public.customers c
--   left join public.devices d on d.customer_id = c.customer_id and d.deleted_at is null
--  where c.parent_customer_id = 1640 and c.deleted_at is null
--  group by c.site_name order by c.site_name;
--
-- 기대(판단 필요 ②를 「제자리에 둔다」로 답했을 때):
--   L1-본딩1실 9 · L1-본딩2실 1 · L1-입고실 2 · L1-파이널실 1 · L1-표면가공실 2
--   L2-실험실 1 · L3-검사실 3 · L3-클린룸 2 · L3-소성실 2 · M1-가공실 1   (합 23)
