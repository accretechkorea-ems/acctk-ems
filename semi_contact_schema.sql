-- 반도체 고객 접촉 보고 (2026-10-08 작성). **아직 DB 에 적용하지 않았다.**
-- 이 파일은 적용 대기 상태다 — 아래 「적용 순서」를 읽고 **한 문장씩 따로** 실행한다.
-- begin/commit 으로 묶지 않았다(Supabase SQL Editor 에서 문장 단위로 돌려도 순서만 지키면 같은 결과다).
--
-- 무엇을 위한 표인가
--   반도체사업부의 고객 접촉 보고. 구조는 Project → 접촉 보고서 → Action 이다.
--     semi_projects        고객사 × 구매안건 하나. 번호 PRJ-2026-001 (연도별로 1부터)
--     semi_contact_reports  접촉 한 번에 한 장. 같은 Project 의 새 보고서는 직전 보고의 현황을
--                           가져와 바뀐 것만 고친다(이어쓰기 — 규칙은 lib/semiContact/prefill.ts).
--     semi_actions          보고서마다 딸린 할 일 줄
--   계측은 나중에 별도 표로 만든다. 그래서 이름에 semi_ 를 붙여 처음부터 갈라 둔다.
--
-- 설계 요점
--   · 사업부 격리는 「팀 메뉴 권한」으로 한다. 팀 관리 화면에서 메뉴 'contact_semi' 를 체크한 팀만
--     읽는다. RLS 는 has_menu_perm('contact_semi') 하나로 판정한다(menu_perm_function.sql).
--     has_team_perm 을 쓰지 않는 이유: 그 함수는 teams.can_view_* 여섯 영역만 알아 새 메뉴 키를
--     판정하지 못하고, 기존 영역('customers' 등)을 빌리면 반도체 팀에 계측 데이터까지 열린다.
--   · 쓰기는 전부 service role 라우트에서만 한다. RLS 는 읽기 정책만 둔다
--     (inquiries_schema.sql · approval_schema.sql 과 같은 규칙). authenticated 에는 SELECT 만 준다.
--   · 채번은 DB 함수가 원자적으로 한다 — claim_inquiry_seq 와 같은
--     「insert … on conflict do update … returning」 방식이다(MAX()+1 은 동시 발급에서 겹친다).
--   · 선택지(접촉방법·Status·우선순위 등)에는 CHECK 를 걸지 않는다. 선택지는 코드 등록표
--     (lib/semiContact/fields.ts) 한 곳이 관리한다 — 선택지를 고칠 때 DB 를 건드리지 않게 하려는 것이다.
--   · 양식의 나머지 칸은 detail jsonb 한 칸에 영문 snake_case 키로 담는다. 어떤 키가 칸이고 어떤 키가
--     detail 인지도 등록표가 정한다(storage: 'column' · 'project' · 'detail').
--   · updated_at 은 트리거 없이 라우트가 찍는다(기존 규칙 — app/api/inquiry/route.ts:314,
--     app/api/approval/route.ts:298 이 update 때 updated_at 을 직접 넣는다). 그래서 단계 6 은 없다.
--   · 감사 트리거는 붙이지 않는다. service role 로 쓰면 트리거의 actor_email 이 NULL 이 된다
--     (inquiries_schema.sql 과 같은 이유).
--
-- engineers 참조 — engineers.engineer_id 는 integer 다. ON DELETE 를 두지 않는다(= NO ACTION).
--   퇴사자는 지우지 않고 resigned_date 로 표시하므로 실제로 걸릴 일이 없고, 걸린다면 그쪽이 잘못된 삭제다
--   (inquiries_schema.sql · inquiry_messages_schema.sql 과 같은 규칙).
--
-- ── 적용 순서 ────────────────────────────────────────────────────────────────
--   0. (선행) menu_perm_function.sql — 단계 5 의 정책이 has_menu_perm 을 부른다.
--   1. 단계 1  카운터 표 + claim 함수 + 권한           (문장 1~7)
--   2. 단계 2  semi_projects + 인덱스                  (문장 8~10)
--   3. 단계 3  semi_contact_reports + 인덱스           (문장 11~14)
--   4. 단계 4  semi_actions + 인덱스                   (문장 15~19)
--   5. 단계 5  RLS · 표 권한 · identity 시퀀스 권한     (문장 20~36)
--   표는 FK 순서대로 만든다(projects → reports → actions). 문장 번호 순서대로 한 문장씩 실행한다.
--
--   ※ 단계 2~4 와 단계 5 사이 — rls_auto_enable 이벤트 트리거(db_functions_snapshot.sql)가 표를 만드는
--     순간 RLS 를 켜고, 정책이 없으므로 그동안은 전면 차단이다. 트리거가 없더라도 표가 비어 있고 아직
--     이 표를 읽는 코드가 없으므로 노출될 것이 없다. 그래도 단계 5 까지 이어서 실행한다.
--
-- ── 되돌리기 (역순, 한 문장씩) ──────────────────────────────────────────────
--   drop table if exists public.semi_actions;
--   drop table if exists public.semi_contact_reports;
--   drop table if exists public.semi_projects;
--   drop function if exists public.claim_semi_project_seq(integer);
--   drop table if exists public.semi_project_sequence;
--   ※ 표를 지우면 그 표의 정책·인덱스·identity 시퀀스·권한도 함께 사라진다.
--   ※ 그다음 필요하면 menu_perm_function.sql 의 되돌리기(has_menu_perm drop)를 한다 — 이 파일이 먼저다.
--
-- 적용 후 확인 쿼리는 파일 맨 아래에 있다.


-- ════════════════════════════════════════════════════════════════════════════
-- 단계 1. Project 번호 카운터 — 연도 하나에 한 줄
--
--   period_year(2026) 하나에 카운터 한 줄. 해가 바뀌면 새 행이 생겨 자연히 1부터 시작한다.
--   seq 기본값이 0 인 것은 inquiry_sequence 와 같다 — 미리 만든 행이든 함수가 만든 행이든 첫 번호가 1.
--   연도는 서버가 KST 기준으로 정해 넘긴다(todayKST() — UTC 로 정하면 1월 1일 0~9시에 전년도가 된다).
-- ════════════════════════════════════════════════════════════════════════════

-- 문장 1. 카운터 표
--   연도 범위 CHECK 는 inquiry_sequence 에 없는 것이다. 연도를 두 자리(26)로 잘못 넘기면 엉뚱한 카운터가
--   1부터 다시 시작해 번호가 겹치므로 그 실수만 막는다.
create table if not exists public.semi_project_sequence (
  period_year  integer not null primary key,
  seq          integer not null default 0,
  constraint semi_project_sequence_year_check check (period_year between 2000 and 2999)
);

-- 문장 2. RLS — 켜고 정책은 하나도 만들지 않는다 = service role 만 접근한다.
--   quote_sequence 는 authenticated 전면 허용이라 로그인 사용자가 카운터를 조작할 수 있다
--   (quote_schema_snapshot.sql:94-96). 같은 실수를 되풀이하지 않는다.
alter table public.semi_project_sequence enable row level security;

-- 문장 3. 표 권한 — anon·authenticated 에서 모두 거둔다(RLS 와 겹치는 이중 잠금).
--   inquiry_sequence 에는 없던 문장이다. Supabase 는 public 의 새 표에 anon·authenticated 권한을
--   기본으로 주는데, 정책이 없어 막히긴 하지만 권한 자체를 없애 둔다.
revoke all on table public.semi_project_sequence from anon, authenticated;

-- 문장 4. 표 권한 — service_role 은 전부(기본 권한과 같지만 명시해 둔다).
grant all on table public.semi_project_sequence to service_role;

-- 문장 5. 다음 번호를 발급한다.
--   같은 연도로 동시에 들어와도 한 번에 하나씩만 나간다 — on conflict do update 가 그 행에 잠금을 건다.
--   SECURITY DEFINER 인 이유는 claim_inquiry_seq 와 같다: RLS 가 켜져 있고 정책이 없어, 호출자 권한으로
--   돌면 service role 이 아닌 경로에서 0행이 된다. 대신 아래에서 EXECUTE 를 service_role 로만 좁힌다.
--   번호 문자열(PRJ-2026-001)은 여기서 만들지 않는다 — 라우트가 연도·순번으로 조립하고,
--   semi_projects 에 period_year·seq 를 따로 저장해 되파싱하지 않는다.
create or replace function public.claim_semi_project_seq(p_year integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seq integer;
begin
  insert into public.semi_project_sequence (period_year, seq)
  values (p_year, 1)
  on conflict (period_year)
  do update set seq = public.semi_project_sequence.seq + 1
  returning seq into v_seq;
  return v_seq;
end;
$$;

-- 문장 6. 실행 권한 회수 — 브라우저에서 rpc 로 부를 수 있으면 카운터를 마음대로 올릴 수 있다.
revoke execute on function public.claim_semi_project_seq(integer) from public, anon, authenticated;

-- 문장 7. 실행 권한 부여 — 서버(service role)만 부른다.
grant execute on function public.claim_semi_project_seq(integer) to service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- 단계 2. Project — 고객사 × 구매안건
-- ════════════════════════════════════════════════════════════════════════════

-- 문장 8. 표
create table if not exists public.semi_projects (
  project_id    bigint generated always as identity primary key,

  -- 사람에게 보이는 번호(PRJ-2026-001). 유일해야 한다. 채번이 원자적이므로 이 제약에 걸릴 일은
  -- 거의 없고, 걸리면 라우트가 23505 를 받아 번호를 다시 받는다(app/api/inquiry/route.ts 의 재시도).
  project_no    text    not null,
  constraint semi_projects_project_no_key unique (project_no),

  -- 번호를 만든 근거. project_no 를 되파싱하지 않으려고 따로 둔다. 목록 정렬도 이 두 칸으로 한다 —
  -- 1000번째부터 순번이 네 자리가 되어 문자열 정렬이 어긋나기 때문이다.
  period_year   integer not null,
  seq           integer not null,
  constraint semi_projects_period_seq_key unique (period_year, seq),

  customer_name text    not null,          -- 고객사
  site_dept     text,                      -- 사업장/부서
  title         text    not null,          -- Project/구매안건

  -- 만든 사람. 라우트가 세션의 호출자로 채운다(클라이언트 값을 믿지 않는다).
  created_by    integer not null,
  constraint semi_projects_created_by_fkey
    foreign key (created_by) references public.engineers(engineer_id),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 문장 9. 고객사로 묶기·찾기. 같은 고객사의 Project 를 모아 보는 길이다.
--   부분 일치 검색(ilike '%…%')은 btree 를 타지 못한다 — 행 수가 적은 동안은 순차 탐색으로 충분하고,
--   느려지면 그때 pg_trgm(gin) 을 검토한다(레포에 아직 pg_trgm 을 쓰는 곳이 없다).
create index if not exists idx_semi_projects_customer_name
  on public.semi_projects (customer_name);

-- 문장 10. 최근 Project 순 목록
create index if not exists idx_semi_projects_created_at
  on public.semi_projects (created_at desc);


-- ════════════════════════════════════════════════════════════════════════════
-- 단계 3. 접촉 보고서 — 접촉 한 번에 한 장
--
--   「직전 보고」는 같은 Project 에서 (contact_date desc, report_id desc) 로 첫 번째 행이다.
--   같은 날 두 번 만났으면 나중에 쓴 보고(report_id 가 큰 쪽)가 직전이다. 문장 12 의 인덱스가 그 길이다.
-- ════════════════════════════════════════════════════════════════════════════

-- 문장 11. 표
create table if not exists public.semi_contact_reports (
  report_id         bigint generated always as identity primary key,

  -- Project 가 지워지려 하면 막는다 — 보고서가 남은 Project 를 지우는 것은 사고다.
  project_id        bigint  not null,
  constraint semi_contact_reports_project_fkey
    foreign key (project_id) references public.semi_projects(project_id) on delete restrict,

  contact_date      date    not null,      -- 접촉일
  contact_method    text    not null,      -- 접촉방법. 선택지는 코드 등록표가 관리한다(CHECK 없음)

  -- 작성자. 라우트가 세션의 호출자로 채운다. 화면 입력 칸이 없다.
  author_id         integer not null,
  constraint semi_contact_reports_author_fkey
    foreign key (author_id) references public.engineers(engineer_id),

  customer_contact  text,                  -- 고객 담당자(이어쓰기 때 가져온다)
  purpose           text,                  -- 미팅/접촉 목적(필수 여부는 코드가 검증한다)
  fact              text,                  -- FACT(필수 여부는 코드가 검증한다)
  next_contact_date date,                  -- 다음 Contact 예정일

  -- 양식의 나머지 칸. 키는 영문 snake_case, 어떤 키가 들어가는지는 lib/semiContact/fields.ts 가 정한다.
  -- 빈 값은 키째 넣지 않는다(코드 규칙). 모양만 객체로 못박는다 — 키·값 검증은 코드가 한다.
  detail            jsonb   not null default '{}'::jsonb,
  constraint semi_contact_reports_detail_is_object check (jsonb_typeof(detail) = 'object'),

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- 마지막으로 고친 사람. 새로 쓸 때는 비워 두고, 고칠 때 라우트가 채운다.
  updated_by        integer,
  constraint semi_contact_reports_updated_by_fkey
    foreign key (updated_by) references public.engineers(engineer_id),

  -- 복합 FK 의 대상(단계 4). report_id 가 이미 PK 라 겹쳐 보이지만, semi_actions 가
  -- (report_id, project_id) 쌍을 가리키려면 그 쌍에 UNIQUE 가 있어야 한다(inquiry_messages 와 같은 방식).
  constraint semi_contact_reports_report_project_key unique (report_id, project_id)
);

-- 문장 12. Project 의 보고서 목록과 「직전 보고」 찾기. project_id FK 의 인덱스도 겸한다.
create index if not exists idx_semi_contact_reports_project_date
  on public.semi_contact_reports (project_id, contact_date desc, report_id desc);

-- 문장 13. 작성자별 목록
create index if not exists idx_semi_contact_reports_author
  on public.semi_contact_reports (author_id);

-- 문장 14. 최근 접촉순 전체 목록·기간 필터
create index if not exists idx_semi_contact_reports_contact_date
  on public.semi_contact_reports (contact_date desc);


-- ════════════════════════════════════════════════════════════════════════════
-- 단계 4. Action — 보고서에 딸린 할 일 줄
-- ════════════════════════════════════════════════════════════════════════════

-- 문장 15. 표
create table if not exists public.semi_actions (
  action_id   bigint generated always as identity primary key,

  report_id   bigint  not null,
  project_id  bigint  not null,

  -- Project 가 지워지려 하면 막는다(보고서와 같은 규칙).
  constraint semi_actions_project_fkey
    foreign key (project_id) references public.semi_projects(project_id) on delete restrict,

  -- 보고서를 가리키는 FK 를 (report_id, project_id) 쌍으로 건다 — report_id 만 거는 대신이다.
  -- 보고서가 지워지면 그 Action 도 함께 지운다(on delete cascade).
  -- 쌍으로 거는 까닭: 「A Project 의 Action 인데 B Project 의 보고서에 달린」 행을 DB 가 막는다.
  -- project_id 를 따로 두는 것은 Project 별 미완료 Action 을 보고서를 거치지 않고 바로 세려는 것인데,
  -- 그 값이 보고서 쪽과 어긋나면 집계가 틀린다(inquiry_attachments_message_fkey 와 같은 방식).
  constraint semi_actions_report_fkey
    foreign key (report_id, project_id)
    references public.semi_contact_reports (report_id, project_id)
    on delete cascade,

  action      text    not null,            -- 할 일(what)
  owner_name  text    not null,            -- 담당(고객 측 사람일 수도 있어 글자로 둔다)
  -- 담당이 우리 직원이면 그 engineer_id. 고객 측 담당이면 비운다.
  owner_id    integer,
  constraint semi_actions_owner_fkey
    foreign key (owner_id) references public.engineers(engineer_id),

  due_date    date    not null,
  -- 선택지는 코드 등록표가 관리한다(CHECK 없음). 단 'Done' 은 문장 17 의 부분 인덱스가 쓰는 값이라
  -- 등록표에서 이름을 바꾸면 그 인덱스도 함께 바꿔야 한다.
  status      text    not null default 'Open',
  priority    text    not null default 'Medium',
  note        text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 문장 16. Project 별 상태 집계(미완료 Action 수 등)
create index if not exists idx_semi_actions_project_status
  on public.semi_actions (project_id, status);

-- 문장 17. 기한 임박·지난 미완료 Action
create index if not exists idx_semi_actions_due_open
  on public.semi_actions (due_date)
  where status <> 'Done';

-- 문장 18. 담당 직원별 목록
create index if not exists idx_semi_actions_owner
  on public.semi_actions (owner_id);

-- 문장 19. 보고서의 Action 읽기·보고서 삭제 시 cascade 찾기(semi_actions_report_fkey 의 앞 칸)
create index if not exists idx_semi_actions_report
  on public.semi_actions (report_id);


-- ════════════════════════════════════════════════════════════════════════════
-- 단계 5. RLS · 표 권한
--
--   세 표 모두 같은 모양이다.
--     · RLS 를 켜고, SELECT 정책 하나만 둔다: (select public.has_menu_perm('contact_semi'))
--       함수는 (select …) 로 감싼다 — 행마다 다시 부르지 않고 문장마다 한 번만 평가된다(레포 관례,
--       inquiries_schema.sql 의 inquiries_select).
--     · INSERT·UPDATE·DELETE 정책은 만들지 않는다. 쓰기는 service role 라우트만 한다.
--     · 표 권한도 맞춘다: anon·authenticated 에서 전부 거두고 authenticated 에 SELECT 만 다시 준다.
--       정책이 없어 쓰기가 막히긴 하지만, 권한 자체를 없애 두면 나중에 누가 쓰기 정책을 잘못 더해도
--       authenticated 는 쓰지 못한다.
--   정책 이름은 레포 관례(<표>_select)를 따른다.
-- ════════════════════════════════════════════════════════════════════════════

-- ── semi_projects ──
-- 문장 20
alter table public.semi_projects enable row level security;
-- 문장 21
revoke all on table public.semi_projects from anon, authenticated;
-- 문장 22
grant select on table public.semi_projects to authenticated;
-- 문장 23
grant all on table public.semi_projects to service_role;
-- 문장 24
create policy semi_projects_select on public.semi_projects
  for select to authenticated
  using ((select public.has_menu_perm('contact_semi')));

-- ── semi_contact_reports ──
-- 문장 25
alter table public.semi_contact_reports enable row level security;
-- 문장 26
revoke all on table public.semi_contact_reports from anon, authenticated;
-- 문장 27
grant select on table public.semi_contact_reports to authenticated;
-- 문장 28
grant all on table public.semi_contact_reports to service_role;
-- 문장 29
create policy semi_contact_reports_select on public.semi_contact_reports
  for select to authenticated
  using ((select public.has_menu_perm('contact_semi')));

-- ── semi_actions ──
-- 문장 30
alter table public.semi_actions enable row level security;
-- 문장 31
revoke all on table public.semi_actions from anon, authenticated;
-- 문장 32
grant select on table public.semi_actions to authenticated;
-- 문장 33
grant all on table public.semi_actions to service_role;
-- 문장 34
create policy semi_actions_select on public.semi_actions
  for select to authenticated
  using ((select public.has_menu_perm('contact_semi')));

-- ── identity 시퀀스 ──
--   레포에 시퀀스 권한을 따로 다룬 선례는 없다(기존 identity 표는 Supabase 기본 권한에 맡겼다).
--   여기서는 표 권한과 맞춘다: anon·authenticated 는 insert 를 못 하므로 시퀀스도 거두고,
--   insert 하는 service_role 에는 usage·select 를 명시한다.
--   시퀀스 이름은 Postgres 기본 이름(<표>_<칸>_seq)이다 — 다르면 이 두 문장이 「relation does not exist」로
--   실패하고 다른 것은 바뀌지 않는다. 그때는 맨 아래 확인 쿼리의 pg_get_serial_sequence 로 이름을 보고 고친다.
-- 문장 35
revoke all on sequence public.semi_projects_project_id_seq,
                       public.semi_contact_reports_report_id_seq,
                       public.semi_actions_action_id_seq
  from anon, authenticated;
-- 문장 36
grant usage, select on sequence public.semi_projects_project_id_seq,
                                public.semi_contact_reports_report_id_seq,
                                public.semi_actions_action_id_seq
  to service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- 단계 6. updated_at 트리거 — 두지 않는다
--   기존 규칙이 트리거가 아니라 라우트가 update 때 updated_at 을 직접 넣는 방식이다
--   (app/api/inquiry/route.ts:314, app/api/approval/route.ts:298·327). 이 표만 트리거를 두면
--   같은 칸을 두 곳이 찍게 된다. 라우트를 만들 때 update 마다 updated_at(보고서는 updated_by 도)을 넣는다.
-- ════════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════════
-- 적용 후 확인 (읽기 전용)
-- ════════════════════════════════════════════════════════════════════════════
-- 표 네 개가 생겼고 RLS 가 켜졌는가(4행, relrowsecurity = true)
-- select c.relname, c.relrowsecurity
-- from pg_class c join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public'
--   and c.relname in ('semi_project_sequence', 'semi_projects', 'semi_contact_reports', 'semi_actions')
-- order by c.relname;

-- 정책 — 세 표에 SELECT 하나씩(3행), semi_project_sequence 는 0행
-- select tablename, policyname, cmd, roles, qual
-- from pg_policies
-- where schemaname = 'public' and tablename like 'semi\_%'
-- order by tablename, policyname;

-- 표 권한 — authenticated 는 세 표에 SELECT 만, anon 은 없음, semi_project_sequence 에는 둘 다 없음
-- select grantee, table_name, string_agg(privilege_type, ',' order by privilege_type) as privs
-- from information_schema.role_table_grants
-- where table_schema = 'public' and table_name like 'semi\_%'
--   and grantee in ('anon', 'authenticated', 'service_role')
-- group by grantee, table_name
-- order by table_name, grantee;

-- identity 시퀀스 이름(문장 35·36 이 가리킨 이름과 같아야 한다)
-- select pg_get_serial_sequence('public.semi_projects', 'project_id')         as projects_seq,
--        pg_get_serial_sequence('public.semi_contact_reports', 'report_id')   as reports_seq,
--        pg_get_serial_sequence('public.semi_actions', 'action_id')           as actions_seq;

-- 시퀀스 권한 — service_role 만 usage
-- select has_sequence_privilege('service_role',  'public.semi_projects_project_id_seq', 'USAGE') as sr_usage,
--        has_sequence_privilege('authenticated', 'public.semi_projects_project_id_seq', 'USAGE') as auth_usage;

-- claim 함수 — security definer, service_role 만 실행
-- select p.proname, p.prosecdef,
--        has_function_privilege('service_role',  p.oid, 'EXECUTE') as sr_exec,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
--        has_function_privilege('anon',          p.oid, 'EXECUTE') as anon_exec
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'claim_semi_project_seq';

-- 제약 — FK 의 ON DELETE(confdeltype: r = restrict, c = cascade, a = no action)와 CHECK·UNIQUE
-- select conrelid::regclass as tbl, conname, contype, confdeltype, pg_get_constraintdef(oid)
-- from pg_constraint
-- where conrelid in ('public.semi_projects'::regclass, 'public.semi_contact_reports'::regclass,
--                    'public.semi_actions'::regclass, 'public.semi_project_sequence'::regclass)
-- order by tbl, conname;

-- 인덱스
-- select tablename, indexname, indexdef
-- from pg_indexes
-- where schemaname = 'public' and tablename like 'semi\_%'
-- order by tablename, indexname;
