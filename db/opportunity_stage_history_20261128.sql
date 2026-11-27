-- 포캐스트 **단계 이력** 표 (2026-11-28, 야간4 4-1)
--
-- ── 무엇을 담나 ───────────────────────────────────────────────────────────
--   포캐스트 한 건이 「상담 → 사양검토 → 견적제출 → 협상 → 수주/실주」로 가는 동안,
--   지금 남는 것은 **마지막 단계 하나**뿐이다(sales_opportunities.stage). 그래서
--   「이 건이 견적제출까지 갔다가 되돌아온 건가」, 「협상에 몇 주 서 있었나」를 물을 수
--   없고, 활동 이력도 **지금 단계**를 적어 지난 줄의 뜻이 날마다 달라졌다(4-2 가 고친다).
--
--   이 표는 **옮긴 자국**만 담는다. 금액·제목이 바뀐 것은 담지 않는다(그 쪽은 잡 변경이다).
--
--     생성       to_stage = 처음 단계, from_stage = null
--     단계 변경   from_stage → to_stage   (견적 상태가 끌고 간 자동 동기화도 한 줄)
--     종료       to_stage = '수주' 또는 '실주'
--
-- ── 코드 쪽 ───────────────────────────────────────────────────────────────
--   이 파일이 적용되기 전에도 화면은 돈다 — 쓰기는 **42P01 폴백**으로 customer_events 에
--   남기고(lib/opportunityStageHistory.ts), 읽기는 빈 목록으로 받는다.
--
-- 재실행해도 안전하다(create if not exists · 소급도 한 번만 들어간다).

-- ═══════════════════════════════════════════════════════════════════════════
-- [0단계] 적용 전에 **먼저 돌려 보고** 눈으로 확인한다. 아무것도 바꾸지 않는다.
-- ═══════════════════════════════════════════════════════════════════════════

-- 0-1. 표가 이미 있나. (없으면 0줄)
select table_name
  from information_schema.tables
 where table_schema = 'public' and table_name = 'opportunity_stage_history';

-- 0-2. 소급해 넣을 건수 — 지금 포캐스트 전체. 이만큼 첫 줄이 생긴다.
select count(*) as 포캐스트_건수 from sales_opportunities;

-- 0-3. 단계별 건수 — 소급 뒤 to_stage 분포가 이것과 같아야 한다.
select stage, count(*) as 건수
  from sales_opportunities
 group by stage
 order by 건수 desc;

-- ═══════════════════════════════════════════════════════════════════════════
-- [본문]
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. 표 ─────────────────────────────────────────────────────────────────
create table if not exists public.opportunity_stage_history (
  id              bigserial primary key,
  opportunity_id  bigint      not null
                    references public.sales_opportunities(opportunity_id) on delete cascade,
  -- 생성 줄은 null 이다(어디에서 온 것이 아니다).
  from_stage      text,
  to_stage        text        not null,
  changed_at      timestamptz not null default now(),
  -- 서버가 쓴 줄(견적 자동 동기화·소급)은 null 이다.
  changed_by      bigint      references public.engineers(engineer_id) on delete set null
);

-- 한 건의 이력을 시간 순으로 읽는 것이 거의 전부다.
create index if not exists opportunity_stage_history_opp_idx
  on public.opportunity_stage_history (opportunity_id, changed_at);

comment on table public.opportunity_stage_history is
  '포캐스트 단계가 옮겨 간 자국. 금액·제목 같은 잡 변경은 담지 않는다(2026-11-28, 야간4 4-1).';

-- ── 2. RLS — 읽기는 로그인 전원, 쓰기는 서버/본인 ────────────────────────
alter table public.opportunity_stage_history enable row level security;

drop policy if exists osh_select on public.opportunity_stage_history;
create policy osh_select on public.opportunity_stage_history
  for select to authenticated
  using (true);

-- 쓰기는 **제 건에만**. 서버(service_role)는 RLS 를 지나지 않으므로 자동 동기화는 늘 된다.
drop policy if exists osh_insert on public.opportunity_stage_history;
create policy osh_insert on public.opportunity_stage_history
  for insert to authenticated
  with check (
    exists (
      select 1
        from public.sales_opportunities o
        join public.engineers e on e.engineer_id = o.engineer_id
       where o.opportunity_id = opportunity_stage_history.opportunity_id
         and e.email = auth.jwt() ->> 'email'
    )
  );

-- 고치거나 지우는 길은 두지 않는다 — **자국**이라서다.

-- ── 3. 소급 — 기존 건마다 「만든 날 · 지금 단계」 한 줄 ────────────────────
--   지난 자국은 어디에도 없으므로 **만들어 내지 않는다**. 지금 아는 것 하나만 적는다:
--   그 건이 created_at 에 생겼고 지금 이 단계라는 것. 이력 요약은 그래서 기존 건에서
--   「상담 9/4」 한 칸으로 보이고, 오늘 이후의 이동부터 줄이 늘어난다.
insert into public.opportunity_stage_history (opportunity_id, from_stage, to_stage, changed_at, changed_by)
select o.opportunity_id, null, o.stage, o.created_at, null
  from public.sales_opportunities o
 where not exists (
   select 1 from public.opportunity_stage_history h
    where h.opportunity_id = o.opportunity_id
 );

commit;

-- PostgREST 가 새 표를 알아보게 한다.
notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- [확인] 적용 뒤에 돌린다.
-- ═══════════════════════════════════════════════════════════════════════════

-- 포캐스트 건수와 이력 줄 수가 같아야 한다(소급 직후).
select
  (select count(*) from sales_opportunities)          as 포캐스트,
  (select count(*) from opportunity_stage_history)    as 이력줄,
  (select count(distinct opportunity_id) from opportunity_stage_history) as 이력이_있는_건;

-- to_stage 분포가 [0단계] 0-3 과 같아야 한다.
select to_stage, count(*) as 건수
  from opportunity_stage_history
 group by to_stage
 order by 건수 desc;

-- RLS 가 켜져 있나.
select relname, relrowsecurity
  from pg_class
 where relname = 'opportunity_stage_history';
