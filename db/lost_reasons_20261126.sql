-- 실주 사유 **카테고리** (2026-11-26)
--
-- ── 왜 ───────────────────────────────────────────────────────────────────
-- 지금 실주 사유는 글자 일곱 개가 **코드에 박혀** 있고(components/customer/opportunity.ts
-- 의 LOST_REASONS), 견적 쪽은 자유 입력(quotes.fail_reason)이다. 그래서 「왜 졌나」를
-- 묶어 세지 못한다 — 같은 뜻이 「가격」·「가격 차이」·「단가」로 흩어진다. 자동 실주가
-- 넣는 「유효기간 만료」가 사유의 1위로 올라오는 것도 그 때문이다(그것은 사유가 아니다).
--
-- 그래서 **고르는 목록을 표로** 옮긴다. 목록은 여덟 줄로 시작하고, 「기타」는 설명을
-- 받아야 하며, 「경쟁사」는 어느 회사인지까지 받는다.
--
-- ── 「기간 만료」는 목록에 없다 ───────────────────────────────────────────
-- 유효기간이 지나 자동으로 실패가 된 건은 **사유가 아직 없는 건**이다. 그 건은
-- 「사유 대기」로 두고 목록·할 일에 한 줄로 안내만 한다. **사유가 비었다고 다른 일을
-- 막지 않는다**(지시 L3) — 막으면 사람들은 아무 사유나 골라 통계를 더 망친다.
--
-- ── 쓰기는 라우트가 한다 ─────────────────────────────────────────────────
-- 이 표는 **읽기 전용**으로 내려 준다. 사유를 더하고 고치는 관리 화면은 리뉴얼 뒤다
-- (지시 L4) — 그때까지 목록을 바꾸는 일은 이 파일에 줄을 더해 돌린다.
--
-- 재실행 안전 — create table if not exists · add column if not exists ·
--               시드는 label 이 없을 때만 넣는다.

create table if not exists public.lost_reasons (
  reason_id           serial primary key,
  -- 화면에 보이는 글자. 이 값이 곧 열쇠다(같은 글자를 두 줄 두지 않는다).
  label               text not null unique,
  sort                integer not null default 0,
  active              boolean not null default true,
  -- 고르면 **설명을 받아야** 하는가(「기타」).
  requires_note       boolean not null default false,
  -- 고르면 **경쟁사 이름을 받아야** 하는가(「경쟁사」).
  -- 지시의 칸 목록에는 없지만 시안이 그 칸을 요구한다 — 글자(label = '경쟁사')로 판정하면
  -- 나중에 이름만 다듬어도 조용히 깨지므로 깃발로 둔다.
  requires_competitor boolean not null default false,
  created_at          timestamptz not null default now()
);

comment on table public.lost_reasons is
  '실주 사유 목록. 규칙은 lib/lostReason.ts 다. 「기간 만료」는 사유가 아니라 「사유 대기」로 둔다.';
comment on column public.lost_reasons.requires_note is '고르면 설명을 받아야 한다(기타).';
comment on column public.lost_reasons.requires_competitor is '고르면 경쟁사 이름을 받아야 한다(경쟁사).';

create index if not exists lost_reasons_active_idx
  on public.lost_reasons (active, sort);

-- ── 포캐스트가 가리키는 칸 ───────────────────────────────────────────────
-- lost_reason(글자)은 **그대로 둔다** — 지난 줄의 사유가 거기 있다. 새 줄은 id 로 걸고,
-- 화면은 id 가 있으면 그 글자를, 없으면 옛 글자를 보여 준다(lib/lostReason.ts).
alter table public.sales_opportunities
  add column if not exists lost_reason_id integer references public.lost_reasons(reason_id),
  add column if not exists competitor     text,
  add column if not exists lost_at        date;

comment on column public.sales_opportunities.lost_reason_id is
  '실주 사유(lost_reasons). 옛 줄은 비어 있고 lost_reason(글자)만 있다.';
comment on column public.sales_opportunities.competitor is '「경쟁사」를 골랐을 때의 회사 이름.';
comment on column public.sales_opportunities.lost_at is '실주로 처리한 날. closed_at(시각)과 달리 사람이 고친다.';

-- ── 견적도 같은 사유를 쓴다 ──────────────────────────────────────────────
-- fail_reason(글자)은 그대로 둔다 — 자동 실주가 「유효기간 만료」를 거기 넣고, 되돌리기가
-- 그 값을 본다(lib/quoteRevive.ts). 사람이 고른 사유는 새 칸에 담는다.
alter table public.quotes
  add column if not exists lost_reason_id integer references public.lost_reasons(reason_id),
  add column if not exists competitor     text,
  add column if not exists lost_at        date;

comment on column public.quotes.lost_reason_id is
  '실패 사유(lost_reasons). 비어 있고 상태가 실패면 「사유 대기」다 — 안내만 하고 막지 않는다.';

create index if not exists quotes_reason_pending_idx
  on public.quotes (engineer_id)
  where status = '실패' and lost_reason_id is null;

-- ── RLS ──────────────────────────────────────────────────────────────────
-- 목록은 전원이 읽는다. 쓰기 정책은 두지 않는다 = service role 만 쓴다.
alter table public.lost_reasons enable row level security;

drop policy if exists lost_reasons_select on public.lost_reasons;
create policy lost_reasons_select on public.lost_reasons
  for select to authenticated using (true);

grant select on table public.lost_reasons to authenticated;

-- ── 시드 여덟 줄 ─────────────────────────────────────────────────────────
-- 같은 글자가 이미 있으면 넣지 않는다(재실행 안전).
insert into public.lost_reasons (label, sort, requires_note, requires_competitor)
select v.label, v.sort, v.note, v.comp
  from (values
    ('가격',            10, false, false),
    ('경쟁사',          20, false, true ),
    ('예산 없음·보류',  30, false, false),
    ('시기 안 맞음',    40, false, false),
    ('사양·요구 불일치', 50, false, false),
    ('무응답·연락 두절', 60, false, false),
    ('프로젝트 취소',   70, false, false),
    ('기타',            80, true,  false)
  ) as v(label, sort, note, comp)
 where not exists (select 1 from public.lost_reasons r where r.label = v.label);

-- ── 확인 ─────────────────────────────────────────────────────────────────
--   select reason_id, label, sort, requires_note, requires_competitor
--     from public.lost_reasons order by sort;                                   → 8행
--   select count(*) from public.quotes
--    where status = '실패' and lost_reason_id is null;                          → 사유 대기 건수

notify pgrst, 'reload schema';
