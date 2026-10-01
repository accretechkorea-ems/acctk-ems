-- 리드 배정 불가 처리자·시각 (아직 DB 에 적용하지 않았다 — 이 파일은 적용 전 마이그레이션이다).
--
-- 지금 배정 불가 처리(/api/lead-manage 의 action = 'block')가 남기는 것은
-- status='배정불가' · block_reason · assigned_to=null · updated_at 뿐이다. **누가 눌렀는지는
-- 어디에도 남지 않는다** — audit_log 도 쓰지 않는다. 그 두 가지(처리자·시각)를 칸으로 만든다.
--
-- 선행 조건
--   · public.leads 와 public.engineers 가 있어야 한다.
--   · leads_rls_policy.sql 이 적용되어 있어야 한다(필수는 아니다 — 이 파일은 정책을 건드리지 않는다).
--   · **leads 의 표 정의(DDL)를 담은 파일이 이 레포에 없다.** 있는 것은 RLS 정책 파일
--     (leads_rls_policy.sql) 하나뿐이라, 컬럼·제약·인덱스는 코드에서 역산했다.
--     그래서 아래 [0단계] 사전 확인을 **반드시 먼저 돌려** 실제 DB 와 맞는지 보고 실행해라.
-- 적용한 뒤 머리말을 「(YYYY-MM-DD DB 적용 완료). 기록용, 다시 실행하지 마라.」로 바꿔 둔다.
--
-- ┌─ 실행 순서 ────────────────────────────────────────────────────────────────┐
-- │ 0. (사전 확인) 상태 철자 · 칸 이름 충돌 · engineer_id 타입을 눈으로 본다      │
-- │ 1. blocked_by · blocked_at 칸 추가                                         │
-- │ 2. FK leads_blocked_by_fkey 추가 (engineers.engineer_id, ON DELETE 없음)    │
-- │ 3. (검증) CHECK 를 걸기 전에 위반 행 수를 센다 — 0 이 아니면 4 를 돌리지 마라  │
-- │ 4. CHECK leads_blocked_actor_check 추가                                    │
-- │ 순서를 지켜야 한다: 3 은 1 이 끝나야 돌아간다(칸이 없으면 쿼리 자체가 실패한다). │
-- └────────────────────────────────────────────────────────────────────────────┘
--
-- ┌─ 롤백 SQL (역순) ──────────────────────────────────────────────────────────┐
-- │ alter table public.leads drop constraint if exists leads_blocked_actor_check; │
-- │ alter table public.leads drop constraint if exists leads_blocked_by_fkey;  │
-- │ alter table public.leads drop column if exists blocked_at;                 │
-- │ alter table public.leads drop column if exists blocked_by;                 │
-- │                                                                            │
-- │ ※ 되돌리면 그동안 쌓인 처리자·시각이 **전부 사라진다**. 칸을 지우는 것이라     │
-- │   다시 만들어도 값은 돌아오지 않는다. 되돌리기 전에 필요하면 먼저 백업해라:    │
-- │   create table leads_block_actor_backup as                                 │
-- │     select lead_id, blocked_by, blocked_at from public.leads                │
-- │     where blocked_by is not null or blocked_at is not null;                │
-- │ ※ CHECK 를 먼저 떼야 칸을 지울 수 있다(순서 중요).                           │
-- └────────────────────────────────────────────────────────────────────────────┘
--
-- 왜 backfill 하지 않는가
--   이미 배정불가인 행의 처리자는 알 방법이 없다. 시각도 updated_at 으로 추정하면 안 된다 —
--   메모를 고치거나 다른 갱신이 있었으면 그때 시각으로 덮여 있다. 「모른다」를 null 로 두는 편이
--   그럴듯한 거짓값보다 낫다. 그래서 아래 CHECK 는 기존 배정불가 행(둘 다 null)을 통과시킨다.
--
-- 앞으로 만들 「배정 불가 해제」(superadmin 전용, 신규·미배정으로 복귀)를 전제로 설계했다.
--   해제 = status 를 '신규' 로 되돌리고 block_reason · blocked_by · blocked_at 을 **전부 null 로**.
--   비우지 않고 상태만 되돌리면 아래 CHECK 가 막는다 — 조용히 어긋나지 않고 그 자리에서 실패한다.


-- ════════════════════════════════════════════════════════════════
-- [0단계] 사전 확인 — 실행하지 말고 먼저 읽어 볼 것
-- ════════════════════════════════════════════════════════════════

-- ① 상태 철자. 아래 1~4단계는 '배정불가'(공백 없음)를 전제한다.
--    이 목록에 '배정불가' 가 그대로 있는지 확인해라. 다르면 4단계의 문자열을 고쳐서 실행한다.
--    (레포에 leads DDL 이 없어 status 에 CHECK 제약이 걸려 있는지도 여기서 함께 본다.)
-- select status, count(*) as rows
-- from public.leads
-- group by status
-- order by rows desc;

-- ② 칸 이름이 이미 쓰이고 있지는 않은지. 0행이면 안전하다.
-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'leads'
--   and column_name in ('blocked_by', 'blocked_at');

-- ③ engineers.engineer_id 타입 — integer 여야 한다(1단계가 integer 로 만든다).
-- select column_name, data_type
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'engineers' and column_name = 'engineer_id';

-- ④ leads 가 engineers 로 가는 기존 FK. 이 마이그레이션이 하나를 더한다(세 번째가 된다).
--    PostgREST 임베드에 미치는 영향은 파일 맨 아래 「임베드 주의」를 볼 것.
-- select conname, pg_get_constraintdef(oid) as definition
-- from pg_constraint
-- where conrelid = 'public.leads'::regclass and contype = 'f'
-- order by conname;


-- ════════════════════════════════════════════════════════════════
-- [1단계] 칸 추가
-- ════════════════════════════════════════════════════════════════

-- 배정 불가를 실행한 사람. 세션에서 판정한 caller 를 라우트가 넣는다(본문 값을 쓰지 않는다).
-- null 을 허용하는 이유 둘 — 배정불가가 아닌 행은 비어 있어야 하고(아래 CHECK),
-- 이미 배정불가인 옛 행은 처리자를 알 수 없기 때문이다.
--
-- engineers.engineer_id 는 integer 다(approval_schema.sql · inquiries_schema.sql 과 같다).
alter table public.leads add column if not exists blocked_by integer;

-- 배정 불가로 닫은 시각. updated_at 과 다르다 — updated_at 은 메모 수정에도 바뀐다.
alter table public.leads add column if not exists blocked_at timestamptz;

comment on column public.leads.blocked_by is
  '배정 불가로 처리한 사람(engineers.engineer_id). 배정불가가 아니면 null. 적용 이전 행은 알 수 없어 null.';
comment on column public.leads.blocked_at is
  '배정 불가로 닫은 시각. updated_at 과 달리 이후 수정에 바뀌지 않는다. 적용 이전 행은 null.';


-- ════════════════════════════════════════════════════════════════
-- [2단계] FK
-- ════════════════════════════════════════════════════════════════

-- ON DELETE 를 두지 않는다 = NO ACTION. 처리 기록이 있는 채로 직원 행을 지우려 하면 막힌다.
-- 이 프로젝트는 퇴사자를 지우지 않고 resigned_date 로 표시하므로 실제로 걸릴 일은 없고,
-- 걸린다면 그쪽이 잘못된 삭제다 — 다른 행위자 칸(inquiries.created_by, approval.acted_by,
-- service_attachments.uploaded_by)이 전부 같은 관례다. leads.assigned_by · assigned_to 도 같다.
--
-- add constraint 에는 if not exists 가 없다. 다시 실행할 때 42710(중복) 이 나면 이미 있는 것이다.
alter table public.leads
  add constraint leads_blocked_by_fkey
  foreign key (blocked_by) references public.engineers(engineer_id);


-- ════════════════════════════════════════════════════════════════
-- [3단계] 검증 — CHECK 를 걸기 전에 반드시 돌릴 것
-- ════════════════════════════════════════════════════════════════

-- 4단계 CHECK 를 위반하는 행이 몇 개인지 센다. **0 이어야 한다.**
-- 0 이 아니면 4단계를 돌리지 마라 — alter table 이 실패하거나, 억지로 넣으면 기존 데이터가 막힌다.
--
-- 1단계 직후라면 모든 행의 blocked_by · blocked_at 이 null 이므로 결과는 0 이 정상이다.
-- (칸을 만들기 전에는 이 쿼리를 돌릴 수 없다 — 그래서 1단계 뒤, 4단계 앞에 둔다.)
-- 0 이 아니게 나오는 경우는 하나뿐이다: 1단계와 4단계 사이에 누군가 값을 넣었다.
--
-- select count(*) as violating_rows
-- from public.leads
-- where status <> '배정불가'
--   and (blocked_by is not null or blocked_at is not null);
--
-- 어떤 행인지 보려면:
-- select lead_id, lead_no, status, blocked_by, blocked_at
-- from public.leads
-- where status <> '배정불가'
--   and (blocked_by is not null or blocked_at is not null)
-- order by lead_id;


-- ════════════════════════════════════════════════════════════════
-- [4단계] 일관성 CHECK
-- ════════════════════════════════════════════════════════════════

-- 「배정불가가 아니면 처리자·시각은 비어 있어야 한다」 한 가지만 본다.
--
--   status = '배정불가'  → 둘 다 채워져도, 둘 다 비어도, 한쪽만 있어도 통과.
--                          적용 이전에 닫힌 행(둘 다 null)이 그대로 남아야 하기 때문이다.
--   그 밖의 상태        → 둘 다 null 이어야 한다.
--
-- 이 방향이 중요한 이유는 앞으로 만들 「배정 불가 해제」다. 해제가 상태만 '신규' 로 되돌리고
-- 처리자·시각을 지우지 않으면 여기서 막힌다 — 해제된 리드에 옛 처리 기록이 남아
-- 화면에 「누가 배정 불가 처리했다」가 계속 보이는 사고를 코드가 아니라 DB 가 막는다.
--
-- ※ 「둘 다 있거나 둘 다 없거나」(짝 맞추기)는 일부러 넣지 않았다. 넣으면 기존 배정불가 행
--   (둘 다 null)은 통과하지만, 시각만 아는 경우처럼 한쪽만 채우는 길이 영영 막힌다.
--   지금 그런 요구가 없으므로 규칙을 하나로만 둔다. 필요해지면 이 제약을 고쳐 다시 건다.
alter table public.leads
  add constraint leads_blocked_actor_check
  check (
    status = '배정불가'
    or (blocked_by is null and blocked_at is null)
  );


-- ════════════════════════════════════════════════════════════════
-- [5단계] 적용 후 확인
-- ════════════════════════════════════════════════════════════════

-- ① 칸 두 개가 생겼는지 (둘 다 is_nullable = YES 여야 한다)
-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'leads'
--   and column_name in ('blocked_by', 'blocked_at')
-- order by column_name;

-- ② 제약 두 개가 붙었는지
-- select conname, pg_get_constraintdef(oid) as definition
-- from pg_constraint
-- where conrelid = 'public.leads'::regclass
--   and conname in ('leads_blocked_by_fkey', 'leads_blocked_actor_check');

-- ③ CHECK 가 실제로 막는지 — 커밋하지 않고 확인한다(아무 lead_id 하나로).
--    두 번째 update 에서 23514(check_violation) 가 나야 정상이다.
-- begin;
--   update public.leads set blocked_by = 1, blocked_at = now() where status = '배정불가' limit 1;  -- 통과해야 한다
--   update public.leads set blocked_by = 1, blocked_at = now() where status = '신규'    limit 1;  -- 막혀야 한다
-- rollback;

-- ④ RLS — 건드리지 않았다. leads 의 정책은 행 단위(leads_select_admin_or_assignee) 하나뿐이고
--    컬럼 단위 GRANT 도 없으므로, 새 칸은 기존 정책을 그대로 따른다(관리자 전체 / 담당자 자기 건).
--    배정 불가 처리는 assigned_to 를 null 로 만들므로 그 행은 관리자에게만 보인다 — 종전과 같다.
-- select policyname, cmd, qual from pg_policies
-- where schemaname = 'public' and tablename = 'leads';


-- ════════════════════════════════════════════════════════════════
-- [임베드 주의] PostgREST 관계 모호성 — 지금은 위험 없음
-- ════════════════════════════════════════════════════════════════
--
-- 이 마이그레이션으로 leads → engineers 를 가리키는 FK 가 셋이 된다
-- (assigned_to · assigned_by · blocked_by). PostgREST 는 select 에 engineers(...) 라고만 쓰면
-- 어느 관계인지 정하지 못해 PGRST201(300 Multiple Choices)로 **조회 전체를 실패**시킨다.
--
-- 적용 시점 기준으로 leads 를 읽는 모든 조회를 확인했고, engineers 를 임베드하는 곳은 하나도 없다.
--   app/leads/page.tsx        select('*')                  — engineers 를 따로 조회해 화면에서 id→이름
--   lib/leadExcel.ts          assigned_by, assigned_to      — id 만 뽑아 쓴다
--   app/api/lead-manage/*     컬럼 목록만                    — engineers 는 별도 select
--   app/api/lead-card/*       lead_id, assigned_to
--   app/api/lead/*            lead_no / insert ... select
-- engineers 쪽에서 leads(...) 를 임베드하는 조회도 없다.
--
-- 그러므로 이 FK 는 지금 코드를 깨뜨리지 않는다. 다만 **앞으로** leads 에서 engineers 를 임베드할
-- 때는 반드시 제약 이름을 박아야 한다. 이름을 생략하면 그 조회만이 아니라 같은 요청 전체가 실패한다.
--   engineers!leads_blocked_by_fkey(name, position)
--   engineers!leads_assigned_to_fkey(name, position)
-- (inquiries 가 같은 이유로 처음부터 제약 이름을 박아 두고 있다 — inquiries_schema.sql 참고.)
