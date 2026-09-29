-- 전자결재 테이블 (1단계에서 DB 적용 완료). 기록용, 다시 실행하지 마라.
--
-- 아래 DDL 은 운영 DB 의 현재 스키마를 그대로 옮겨 적은 것이다. 열·타입·NOT NULL·기본값·FK 는
-- PostgREST 스키마에서 확인했고, CHECK 제약은 pg_constraint 조회로 확인해 2026-09-29 에
-- 이 파일에 채웠다(PostgREST 스키마에는 CHECK 가 드러나지 않아 처음에는 빠져 있었다).
-- 이 파일을 실행해서 만든 것이 아니라, 이미 있는 것을 적어 둔 기록이다.
-- 열·기본값·제약을 바꿀 일이 생기면 여기에도 같이 반영한다.
--
-- 설계 요점
--   · 결재 엔진은 원 문서(견적·쇼룸 사용·견적 삭제)를 모른다. 필요한 것은 상신 시점에
--     summary(jsonb) 로 받아 두고, 원 문서 위치는 target_table/target_id 로만 가리킨다.
--     유형마다 원 테이블이 달라 FK 는 걸지 않는다.
--   · 상태값은 한글 그대로 저장한다 — DB 값이 곧 화면 문구라 중간 번역표를 두지 않는다.
--   · 쓰기는 전부 service role 라우트(/api/approval)에서만 한다. RLS 는 읽기 정책만 둔다.
--   · 상태 전이는 조건부 UPDATE 로만 한다(동시 승인 시 먼저 누른 쪽만 반영).

-- ── 문서 ────────────────────────────────────────────────────────────────────
create table if not exists public.approval_documents (
  document_id   bigserial primary key,
  doc_type      text        not null
    constraint approval_documents_doc_type_check
    check (doc_type in ('quote', 'showroom_usage', 'quote_delete')),
  doc_no        text        not null,          -- 원 문서 번호(견적은 견적번호)
  title         text        not null,
  summary       jsonb       not null,          -- 목록·결재 화면에 보일 요약(유형별 항목)
  target_table  text        not null,          -- 원 문서 위치. FK 는 걸지 않는다
  target_id     bigint,
  -- 폐기: 반려·회수된 문서를 상신자가 치운 상태(2026-09-29 추가). 완전 삭제하지 않는 이유는
  -- 반려한 사람의 판단이 기결함에서 사라지면 안 되기 때문이다 — 결재선·이력은 그대로 남는다.
  status        text        not null default '임시저장'
    constraint approval_documents_status_check
    check (status in ('임시저장', '진행중', '완료', '반려', '회수', '폐기')),
  requester_id  integer     not null references public.engineers(engineer_id),
  division      text        not null default '계측',       -- 사업부. 지금은 계측 고정
  current_step  integer     not null default 0,
  submitted_at  timestamptz,
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- 상신한 문서에는 상신 시각이 있어야 한다(임시저장만 비어 있을 수 있다).
  constraint ad_submitted_fields check (status = '임시저장' or submitted_at is not null),
  -- 완료된 문서에는 완료 시각이 있어야 한다.
  constraint ad_completed_fields check (status <> '완료' or completed_at is not null)
);

-- ── 결재선 ──────────────────────────────────────────────────────────────────
-- 수신참조(cc)는 step 을 갖지 않고 순서에서 빠진다 → step 은 nullable.
create table if not exists public.approval_lines (
  line_id                bigserial primary key,
  document_id            bigint  not null references public.approval_documents(document_id) on delete cascade,
  step                   integer,                         -- 1,2,3… (cc 는 null)
  kind                   text    not null,                -- approve(결재) · agree(합의) · cc(수신참조)
  approver_id            integer not null references public.engineers(engineer_id),
  is_delegated_authority boolean not null default false,  -- 전결 지정 여부
  state                  text    not null default '대기', -- 대기·승인·반려·전결·생략·대결
  acted_by               integer references public.engineers(engineer_id),  -- 실제 처리자(대결이면 대리인)
  acted_at               timestamptz,
  comment                text
);

-- ── 이력 ────────────────────────────────────────────────────────────────────
-- approval_lines 가 현재 상태라면 이쪽은 흔적이다. 재상신하면 결재선 state 는 초기화되지만
-- 이력은 그대로 남는다.
create table if not exists public.approval_history (
  history_id  bigserial primary key,
  document_id bigint      not null references public.approval_documents(document_id),
  -- 폐기·대결은 2026-09-29 추가(대결은 대리인이 남의 차례를 처리했을 때 라우트가 남긴다).
  -- 동의·확인·취소는 뒤 단계에서 쓰려고 미리 열어 둔 값이다.
  action      text        not null
    constraint approval_history_action_check
    check (action in ('상신', '승인', '동의', '반려', '전결', '회수', '재상신', '확인', '취소', '폐기', '대결')),
  actor_id    integer     not null references public.engineers(engineer_id),
  step        integer,
  comment     text,
  created_at  timestamptz not null default now()
);

-- ── 개인 결재선 ─────────────────────────────────────────────────────────────
create table if not exists public.approval_line_presets (
  preset_id  bigserial primary key,
  owner_id   integer     not null references public.engineers(engineer_id),
  name       text        not null,
  doc_type   text,                     -- null 이면 모든 유형
  lines      jsonb       not null,      -- [{ step, kind, approverId, isDelegatedAuthority }]
  created_at timestamptz not null default now()
);

-- ── 위임(대결) ──────────────────────────────────────────────────────────────
-- 기간이 겹치는 위임은 하나만 허용한다(화면에서 막는다).
create table if not exists public.approval_delegations (
  delegation_id bigserial primary key,
  owner_id      integer     not null references public.engineers(engineer_id),
  delegate_id   integer     not null references public.engineers(engineer_id),
  start_date    date        not null,
  end_date      date        not null,
  doc_type      text,                   -- null 이면 모든 유형
  reason        text,
  created_at    timestamptz not null default now()
);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- 아래는 1단계에서 실제로 적용된 정책이다(3단계에서 DB 정본과 대조해 고쳐 적었다).
-- 다섯 표 모두 SELECT 정책만 있다 — insert·update·delete 정책이 없으므로 쓰기는
-- service role 라우트(/api/approval)만 할 수 있다.
--
-- 읽는 범위는 「그 문서에 관계된 사람」이다. 설계서의 「결재는 전원 공개」는 결재 기능을
-- 전 직원이 쓴다는 뜻이고, 남의 문서 내용까지 보인다는 뜻이 아니다.
--   · 문서   — 상신자 · 결재선에 있는 사람 · superadmin
--   · 결재선 — 그 줄의 결재자 본인 · 그 문서의 상신자 · superadmin
--   · 이력   — 그 문서의 상신자나 결재선 참여자 · superadmin
--   · 개인 결재선 — 본인만
--   · 위임   — 위임자 · 대리인 · superadmin
--
-- 정책 안의 함수는 전부 (select 함수()) 로 감싸져 있다. 감싸지 않으면 행마다 다시 실행된다.
--
-- alter table public.approval_documents    enable row level security;
-- alter table public.approval_lines        enable row level security;
-- alter table public.approval_history      enable row level security;
-- alter table public.approval_line_presets enable row level security;
-- alter table public.approval_delegations  enable row level security;
--
-- create policy ad_select on public.approval_documents for select using (
--   requester_id = (select current_engineer_id())
--   or (select is_superadmin())
--   or exists (
--     select 1 from public.approval_lines l
--     where l.document_id = approval_documents.document_id
--       and l.approver_id = (select current_engineer_id())));
--
-- create policy al_select on public.approval_lines for select using (
--   approver_id = (select current_engineer_id())
--   or (select is_superadmin())
--   or exists (
--     select 1 from public.approval_documents d
--     where d.document_id = approval_lines.document_id
--       and d.requester_id = (select current_engineer_id())));
--
-- create policy ah_select on public.approval_history for select using (
--   (select is_superadmin())
--   or exists (
--     select 1 from public.approval_documents d
--     where d.document_id = approval_history.document_id
--       and (d.requester_id = (select current_engineer_id())
--         or exists (
--           select 1 from public.approval_lines l
--           where l.document_id = d.document_id
--             and l.approver_id = (select current_engineer_id())))));
--
-- create policy alp_select on public.approval_line_presets for select using (
--   owner_id = (select current_engineer_id()));
--
-- create policy adg_select on public.approval_delegations for select using (
--   owner_id = (select current_engineer_id())
--   or delegate_id = (select current_engineer_id())
--   or (select is_superadmin()));

-- ── 인덱스 ──────────────────────────────────────────────────────────────────
-- 결재함 조회가 쓰는 길이다. 설계서 기준 그대로 적용되어 있다.
-- create index if not exists approval_documents_requester_idx on public.approval_documents (requester_id, created_at desc);
-- create index if not exists approval_documents_status_idx    on public.approval_documents (status, submitted_at);
-- create index if not exists approval_lines_document_idx      on public.approval_lines (document_id, step);
-- create index if not exists approval_lines_approver_idx      on public.approval_lines (approver_id, kind);
-- create index if not exists approval_history_document_idx    on public.approval_history (document_id, created_at);
-- create index if not exists approval_delegations_owner_idx   on public.approval_delegations (owner_id, start_date, end_date);
