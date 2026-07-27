-- ============================================================
-- 20수리 현황 (게이지/앰프 수리 접수·출고) 테이블 & 권한 설정
-- Supabase SQL Editor 에서 실행하세요.
-- ============================================================

-- 1) 테이블 생성 ------------------------------------------------
create table if not exists public.repairs (
  repair_id          bigint generated always as identity primary key,
  received_date      date        not null,                 -- 접수일
  customer_name      text        not null,                 -- 고객사 (자유 입력)
  item_type          text        not null,                 -- 품목: '게이지' | '앰프'
  quantity           integer     not null default 1 check (quantity >= 1),
  repair_content     text,                                 -- 수리 내용
  expected_done_date date,                                 -- 수리 완료 예정일
  status             text        not null default '수리중', -- '수리중' | '출고대기' | '출고완료'
  shipped_date       date,                                 -- 출고 완료일 (status='출고완료'일 때 기록)
  created_by         bigint references public.engineers(engineer_id),
  created_at         timestamptz not null default now(),
  constraint repairs_item_type_chk check (item_type in ('게이지','앰프')),
  constraint repairs_status_chk    check (status in ('수리중','출고대기','출고완료'))
);

-- 조회 성능용 인덱스
create index if not exists repairs_status_idx  on public.repairs (status);
create index if not exists repairs_recv_idx    on public.repairs (received_date);
create index if not exists repairs_shipped_idx on public.repairs (shipped_date);


-- 2) RLS(행 수준 보안) -----------------------------------------
--    클라이언트가 anon 키로 직접 접근하므로, 실제 접근 통제는 아래 정책이 강제합니다.
--    허용 대상: permission_level 이 'superadmin' / 'manager' 이거나, teams = '20' 인 직원.
alter table public.repairs enable row level security;

drop policy if exists repairs_team20_admin on public.repairs;

create policy repairs_team20_admin
on public.repairs
for all
to authenticated
using (
  exists (
    select 1 from public.engineers e
    where e.email = (auth.jwt() ->> 'email')
      and ( e.permission_level in ('superadmin','manager') or e.teams = '20' )
  )
)
with check (
  exists (
    select 1 from public.engineers e
    where e.email = (auth.jwt() ->> 'email')
      and ( e.permission_level in ('superadmin','manager') or e.teams = '20' )
  )
);
