-- 의뢰서 교신 기록 (2026-10-02 DB 적용 확인). 기록용, 다시 실행하지 마라.
--
-- 선행 조건
--   · inquiries_schema.sql 이 적용되어 inquiries · inquiry_attachments 가 있어야 한다.
--   · inquiry_attachments 에 행이 하나도 없어야 한다. 아래 1단계 가드가 확인하고, 행이 있으면
--     예외를 던져 멈춘다 — direction · file_date 를 지우는 마이그레이션이라 데이터가 있으면
--     그대로 날아가기 때문이다.
--   · 버킷 inquiry-attachments 는 이미 만들어져 있다. 이 파일은 스토리지를 건드리지 않는다.
--
-- ┌─ 실행 순서 ────────────────────────────────────────────────────────────────┐
-- │ 1. 가드 — inquiry_attachments 가 비어 있는지 확인(아니면 예외로 중단)        │
-- │ 2. inquiry_messages 표 + 인덱스 + RLS                                      │
-- │ 3. inquiry_messages 에 (id, inquiry_id) UNIQUE — 4단계 복합 FK 의 대상이다   │
-- │ 4. inquiry_attachments 수정 — message_id 추가, direction · file_date 삭제   │
-- │ 5. inquiry_attachments 인덱스 추가                                         │
-- │ 순서를 지켜야 한다: 2·3 이 없으면 4 의 FK 가 가리킬 곳이 없다.               │
-- └────────────────────────────────────────────────────────────────────────────┘
--
-- ┌─ 롤백 SQL (역순) ──────────────────────────────────────────────────────────┐
-- │ alter table public.inquiry_attachments                                     │
-- │   drop constraint if exists inquiry_attachments_message_fkey;              │
-- │ drop index if exists public.idx_inquiry_attachments_message;               │
-- │ alter table public.inquiry_attachments drop column if exists message_id;   │
-- │ alter table public.inquiry_attachments add  column if not exists direction text; │
-- │ alter table public.inquiry_attachments add  column if not exists file_date date; │
-- │ drop table if exists public.inquiry_messages;                              │
-- │                                                                            │
-- │ ※ 복합 FK 를 먼저 떼어야 inquiry_messages 를 지울 수 있다(순서 중요).        │
-- │ ※ 되살린 direction 에는 not null 을 다시 걸지 않는다 — 채울 값이 없다.       │
-- │                                                                            │
-- │ ★ 데이터를 잃는 지점                                                        │
-- │   · inquiry_messages 를 지우면 그때까지 쌓인 교신 기록이 전부 사라진다.       │
-- │     되살릴 방법이 없다(감사 기록에도 본문은 남기지 않는다).                   │
-- │   · message_id 를 지우면 「이 첨부가 어느 교신의 것인가」가 사라진다.          │
-- │     첨부 행 자체는 inquiry_id 로 의뢰서에는 계속 붙어 있지만, 교신과의 짝은    │
-- │     복구할 수 없다.                                                         │
-- │   · 되살린 direction · file_date 는 전부 NULL 이다. 마이그레이션 시점에는     │
-- │     표가 비어 있어 잃을 값이 없지만, 적용 뒤에 쌓인 첨부의 방향·날짜는         │
-- │     교신 기록(inquiry_messages)으로 옮겨져 있으므로 그쪽과 함께 사라진다.     │
-- │   · 스토리지 파일은 어느 쪽으로도 지워지지 않는다. 버킷에 그대로 남아         │
-- │     가리키는 행이 없는 고아가 된다.                                          │
-- └────────────────────────────────────────────────────────────────────────────┘
--
-- 왜 표를 새로 만드는가
--   한 의뢰서 번호로 일본 본사와 문답이 여러 번 오간다. 교신 한 건 = 방향 + 날짜 + 내용 +
--   첨부 여러 개다. 지금은 첨부에 direction · file_date 가 달려 있어 「같은 날 같은 방향으로
--   보낸 파일 세 개」가 한 건인지 세 건인지 구분되지 않고, 메일 본문을 둘 곳도 없다.
--   교신을 한 층 위에 두면 상세 화면에 날짜순으로 쌓아 보여 줄 수 있다.
--
-- 쓰기는 전부 service role 라우트에서만 한다. RLS 는 읽기 정책만 둔다
-- (inquiries_schema.sql · service_attachments_schema.sql 과 같은 규칙).
-- 감사 트리거는 붙이지 않는다 — 필요하면 라우트가 audit_log 에 직접 남긴다.


-- ── 1. 가드 ─────────────────────────────────────────────────────────────────
-- 이 마이그레이션은 inquiry_attachments 의 direction · file_date 를 지운다.
-- 행이 하나라도 있으면 그 값들이 그대로 사라지므로, 적용하기 전에 멈춘다.
-- (교신 기록으로 옮기는 이관 SQL 을 따로 써야 한다.)
do $$
declare
  v_n bigint;
begin
  select count(*) into v_n from public.inquiry_attachments;
  if v_n > 0 then
    raise exception
      'inquiry_attachments 에 행이 % 개 있습니다. direction·file_date 를 지우는 마이그레이션이라 그대로 적용할 수 없습니다. 교신 기록으로 옮기는 이관 SQL 을 먼저 작성하세요.', v_n;
  end if;
end;
$$;


-- ── 2. 교신 기록 ────────────────────────────────────────────────────────────
create table if not exists public.inquiry_messages (
  id            bigint generated always as identity primary key,

  -- 의뢰서가 지워지면 교신도 함께 지운다.
  inquiry_id    uuid not null references public.inquiries(id) on delete cascade,

  -- 보냄인지 받음인지. 첨부가 아니라 교신에 달린다 — 「이번에 보낸 것」이 한 건이고
  -- 거기 파일이 여럿 붙는 구조라야 화면에 날짜순으로 쌓을 수 있다.
  direction     text not null
    constraint inquiry_messages_direction_check
    check (direction in ('sent', 'received')),

  -- 그 교신의 날짜. created_at 과 다르다 — 지난 교신을 나중에 입력할 수 있다.
  entry_date    date not null,

  -- 메일 본문이나 메모. 비어 있어도 된다(파일만 주고받는 경우).
  -- 상한을 둔 이유는 본문을 통째로 붙여 넣는 습관 때문이다 — 20000자면 메일 한 통은 넉넉하고,
  -- 첨부를 본문에 base64 로 밀어 넣는 사고는 막는다.
  body          text not null default ''
    constraint inquiry_messages_body_check
    check (char_length(body) <= 20000),

  -- engineers.engineer_id 는 integer 다(inquiries · service_attachments 와 같다).
  -- ON DELETE 를 두지 않는다 = NO ACTION. 퇴사자는 지우지 않고 resigned_date 로 표시하므로
  -- 실제로 걸릴 일은 없고, 걸린다면 그쪽이 잘못된 삭제다.
  created_by    integer,
  constraint inquiry_messages_created_by_fkey
    foreign key (created_by) references public.engineers(engineer_id),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 상세 화면이 「이 의뢰서의 교신을 날짜순으로」 읽는 길이다.
-- id 를 뒤에 붙여 같은 날 여러 건의 순서도 이 인덱스로 정해진다(입력 순서 = id 순서).
create index if not exists idx_inquiry_messages_inquiry_date
  on public.inquiry_messages (inquiry_id, entry_date, id);

alter table public.inquiry_messages enable row level security;

-- 읽기 — 고객사 열람 권한이 있는 팀.
--
-- ※ has_team_perm('inquiries') 가 아니다. 그 함수는 teams.can_view_* 컬럼을 보는데
--   'inquiries' 에 해당하는 컬럼이 없어 superadmin 말고는 전부 false 가 된다.
--   메뉴 권한 'inquiries' 는 lib/menuPerms.ts 의 DERIVED_PERMS 에서 'customers' 영역으로
--   파생되고, RLS 는 그 파생된 컬럼을 보는 이 정책이 담당한다(inquiries_schema.sql 과 같다).
--
-- 함수는 (select ...) 로 감싼다 — 행마다 다시 부르지 않고 한 번만 평가된다(레포 관례).
create policy inquiry_messages_select on public.inquiry_messages
  for select to authenticated
  using ((select public.has_team_perm('customers')));

-- INSERT/UPDATE/DELETE 정책은 만들지 않는다. 쓰기는 service role 라우트만 한다.


-- ── 3. 복합 FK 의 대상 ──────────────────────────────────────────────────────
-- id 가 이미 PK 라 이 UNIQUE 는 겹쳐 보이지만, 4단계의 복합 FK 가 (id, inquiry_id) 쌍을
-- 가리키려면 그 쌍에 UNIQUE 가 있어야 한다(Postgres 의 FK 요구 조건이다).
-- 이것을 두는 대가로 「첨부의 inquiry_id 와 그 첨부가 달린 교신의 inquiry_id 가 다를 수 있는」
-- 구멍이 DB 차원에서 막힌다. 라우트 규칙에만 기대지 않는다.
alter table public.inquiry_messages
  add constraint inquiry_messages_id_inquiry_key unique (id, inquiry_id);


-- ── 4. 첨부 — 교신에 붙인다 ─────────────────────────────────────────────────
-- 표가 비어 있으므로(1단계 가드) not null 컬럼을 기본값 없이 바로 더할 수 있다.
alter table public.inquiry_attachments
  add column message_id bigint not null;

-- 복합 FK — message_id 뿐 아니라 inquiry_id 까지 함께 맞춘다.
-- 이 제약이 있으면 「A 의뢰서의 첨부인데 B 의뢰서의 교신에 달린」 행을 만들 수 없다.
-- ON UPDATE 는 기본값(NO ACTION)이다 — 교신의 inquiry_id 를 바꾸는 일은 없어야 하고,
-- 시도하면 막히는 편이 맞다.
alter table public.inquiry_attachments
  add constraint inquiry_attachments_message_fkey
  foreign key (message_id, inquiry_id)
  references public.inquiry_messages (id, inquiry_id)
  on delete cascade;

-- 방향은 교신으로 올라갔다. 컬럼을 지우면 그 컬럼에 걸린 CHECK 도 함께 사라지지만,
-- 이름을 남기지 않으려고 먼저 명시적으로 뗀다.
alter table public.inquiry_attachments
  drop constraint if exists inquiry_attachments_direction_check;
alter table public.inquiry_attachments
  drop column if exists direction;

-- 파일 날짜도 교신 날짜(entry_date)로 대체한다. 같은 교신의 파일은 같은 날짜다.
alter table public.inquiry_attachments
  drop column if exists file_date;

-- inquiry_id 는 남긴다. 두 가지 쓰임이 있다.
--   · 의뢰서 단위 첨부 조회 — 교신을 거치지 않고 한 번에 읽는다.
--   · 취소 시 스토리지 정리 — /api/inquiry 의 cancel 이 inquiry_id 로 file_path 를 모아
--     버킷에서 먼저 지운다. 행이 사라진 뒤에는 경로를 알 길이 없어 이 조회가 꼭 필요하다.
--     (그 라우트는 지금도 inquiry_id 로 읽으므로 코드를 고치지 않아도 그대로 동작한다.)


-- ── 5. 인덱스 ───────────────────────────────────────────────────────────────
-- 교신 하나를 펼칠 때 그 첨부만 읽는 길.
create index if not exists idx_inquiry_attachments_message
  on public.inquiry_attachments (message_id);
-- 기존 idx_inquiry_attachments_inquiry (inquiry_id) 는 그대로 둔다 — 위의 두 쓰임이 쓴다.


-- ── 취소(cancel_inquiry)와의 관계 ───────────────────────────────────────────
-- inquiries_cancel_function.sql 은 고치지 않는다. 아래 FK 경로 때문에 그대로 동작한다.
--
-- 의뢰서 한 행을 지울 때(취소가 '반환'으로 끝나는 경우 — delete from public.inquiries):
--
--   inquiries.id
--     ├─ inquiry_messages.inquiry_id            ON DELETE CASCADE  → 교신이 지워진다
--     │    └─ inquiry_attachments.(message_id, inquiry_id)
--     │                                          ON DELETE CASCADE → 첨부가 지워진다
--     └─ inquiry_attachments.inquiry_id          ON DELETE CASCADE → 첨부가 지워진다
--
-- 첨부에 닿는 길이 둘이지만 결과는 같다. Postgres 는 한 번 지운 행을 다시 지우려 하지 않으므로
-- 어느 쪽이 먼저 돌든 오류가 나지 않는다. 즉 의뢰서 한 줄만 지우면 교신·첨부가 전부 따라 사라진다.
--
-- ※ 스토리지 파일은 어느 CASCADE 로도 지워지지 않는다. 지금처럼 라우트가 행을 지우기 전에
--   버킷에서 먼저 지운다(/api/inquiry 의 cancel). 순서를 바꾸면 경로를 잃고 고아 파일이 남는다.
-- ※ 취소가 '버림'으로 끝나면(status='cancelled') 행을 지우지 않으므로 교신·첨부도 그대로 남는다.
