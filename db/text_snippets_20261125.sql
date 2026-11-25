-- 문구함 — 자주 쓰는 문구를 저장해 두고 끼워 넣는다 (2026-11-25)
--
-- ── 왜 ───────────────────────────────────────────────────────────────────
-- 서비스 레포트의 「정기 점검」 네 줄, 견적 메일의 인사말 — 사람마다 같은 글을 매번
-- 다시 친다. 한 번 담아 두고 **커서 자리에 끼워 넣는다**. 글에는 {수신인}·{장비} 같은
-- 자리표가 있고, 끼울 때 그 화면의 값으로 바뀐다(lib/snippets.ts 의 applyVars).
--
-- ── 개인용과 공용 ────────────────────────────────────────────────────────
--   private — 만든 사람만 본다.
--   shared  — 전원이 본다. 고치고 지우는 것은 **만든 사람과 admin 이상**뿐이다.
--
-- ── 쓰기는 라우트가 한다 ─────────────────────────────────────────────────
-- 이 저장소의 규칙대로 **쓰기는 app/api/snippets(service role)** 만 한다. 아래 쓰기 정책은
-- 그 라우트를 우회한 요청까지 DB 가 한 번 더 막게 두는 **이중 잠금**이다. authenticated
-- 에게는 select 만 grant 한다 — 정책이 있어도 grant 가 없으면 쓸 수 없다.
--
-- ── 정책의 (select auth.…) 감싸기 ────────────────────────────────────────
-- auth 함수는 줄마다 부르면 느리다. 괄호로 감싸 **한 번만** 부르게 한다(initplan).
--
-- 재실행 안전 — create table if not exists · do $$ 로 제약 · drop policy if exists ·
--               초기 문구는 없을 때만 넣는다.

create table if not exists public.text_snippets (
  snippet_id        serial primary key,

  title             text not null,
  body              text not null,

  -- 어디에 끼우는 글인가 — mail_body · mail_subject · service_content · service_note · common
  kind              text not null,
  -- 누가 보나 — private(나만) · shared(전원)
  scope             text not null,

  owner_engineer_id integer not null references public.engineers(engineer_id),
  -- 사업부를 가려 보여 줄 때 쓴다. 지금 화면은 가리지 않는다(비워 둔다).
  division          text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.text_snippets is
  '문구함. 자주 쓰는 글을 담아 두고 커서 자리에 끼워 넣는다. 규칙은 lib/snippets.ts 다.';
comment on column public.text_snippets.kind is
  'mail_body · mail_subject · service_content · service_note · common(어디서나).';
comment on column public.text_snippets.scope is 'private(나만) · shared(전원, 고치기는 만든 사람·admin 이상).';
comment on column public.text_snippets.body is '{수신인}·{직급}·{회사}·{사업장}·{장비}·{품명}·{견적번호}·{작성자}·{오늘} 자리표를 쓸 수 있다.';

-- ── 값 검사 — 화면을 우회한 값이 들어오지 않게 ───────────────────────────
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'text_snippets_kind_chk') then
    alter table public.text_snippets add constraint text_snippets_kind_chk
      check (kind in ('mail_body', 'mail_subject', 'service_content', 'service_note', 'common'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'text_snippets_scope_chk') then
    alter table public.text_snippets add constraint text_snippets_scope_chk
      check (scope in ('private', 'shared'));
  end if;
end $$;

-- ── 인덱스 ───────────────────────────────────────────────────────────────
-- 목록은 「공용 + 내 것」을 용도별로 읽는다. 그 두 길에 각각 하나.
create index if not exists text_snippets_scope_kind_idx
  on public.text_snippets (scope, kind);
create index if not exists text_snippets_owner_idx
  on public.text_snippets (owner_engineer_id);

-- ── RLS ──────────────────────────────────────────────────────────────────
alter table public.text_snippets enable row level security;

-- 읽기 — 내 것이거나 공용.
drop policy if exists text_snippets_select on public.text_snippets;
create policy text_snippets_select on public.text_snippets
  for select to authenticated
  using (
    scope = 'shared'
    or owner_engineer_id in (
      select e.engineer_id from public.engineers e
       where e.email = (select auth.jwt() ->> 'email')
    )
  );

-- 담기 — **내 것으로만** 담는다. 남의 이름으로 담을 수 없다.
drop policy if exists text_snippets_insert on public.text_snippets;
create policy text_snippets_insert on public.text_snippets
  for insert to authenticated
  with check (
    owner_engineer_id in (
      select e.engineer_id from public.engineers e
       where e.email = (select auth.jwt() ->> 'email')
    )
  );

-- 고치기 — 내 것, 또는 공용인데 내가 admin 이상일 때.
--   using     : 어느 줄을 고칠 수 있나
--   with check: 고친 뒤의 줄도 그 조건을 지켜야 한다(주인을 바꿔치기하지 못하게)
drop policy if exists text_snippets_update on public.text_snippets;
create policy text_snippets_update on public.text_snippets
  for update to authenticated
  using (
    exists (
      select 1 from public.engineers me
       where me.email = (select auth.jwt() ->> 'email')
         and (me.engineer_id = text_snippets.owner_engineer_id
           or (text_snippets.scope = 'shared' and me.permission_level in ('admin', 'superadmin')))
    )
  )
  with check (
    exists (
      select 1 from public.engineers me
       where me.email = (select auth.jwt() ->> 'email')
         and (me.engineer_id = text_snippets.owner_engineer_id
           or (text_snippets.scope = 'shared' and me.permission_level in ('admin', 'superadmin')))
    )
  );

-- 지우기 — 고치기와 같은 조건.
drop policy if exists text_snippets_delete on public.text_snippets;
create policy text_snippets_delete on public.text_snippets
  for delete to authenticated
  using (
    exists (
      select 1 from public.engineers me
       where me.email = (select auth.jwt() ->> 'email')
         and (me.engineer_id = text_snippets.owner_engineer_id
           or (text_snippets.scope = 'shared' and me.permission_level in ('admin', 'superadmin')))
    )
  );

-- 읽기만 내려 준다 — 쓰기는 라우트(service role)가 한다(위 「쓰기는 라우트가 한다」).
grant select on table public.text_snippets to authenticated;

-- ── 공용 초기 문구 둘 ────────────────────────────────────────────────────
-- 주인은 권재원(engineer_id 4). 같은 제목·용도가 이미 있으면 넣지 않는다(재실행 안전).
insert into public.text_snippets (title, body, kind, scope, owner_engineer_id)
select '견적서 송부',
       '{수신인} {직급}님, 안녕하세요.' || chr(10) ||
       '요청하신 {품명} 견적서를 송부드립니다.' || chr(10) ||
       '첨부 파일 확인 부탁드립니다.',
       'mail_body', 'shared', 4
 where not exists (
   select 1 from public.text_snippets where title = '견적서 송부' and kind = 'mail_body'
 );

insert into public.text_snippets (title, body, kind, scope, owner_engineer_id)
select '정기 점검 기본',
       '1. 장비 외관 및 구동부 점검' || chr(10) ||
       '2. 프로브 교정 및 측정 정확도 확인' || chr(10) ||
       '3. 소프트웨어 백업' || chr(10) ||
       '4. 고객 요청 사항 확인',
       'service_content', 'shared', 4
 where not exists (
   select 1 from public.text_snippets where title = '정기 점검 기본' and kind = 'service_content'
 );

-- ── 확인 ─────────────────────────────────────────────────────────────────
--   select policyname, cmd from pg_policies
--    where schemaname = 'public' and tablename = 'text_snippets' order by policyname;   → 4행
--   select snippet_id, title, kind, scope from public.text_snippets order by snippet_id; → 2행

notify pgrst, 'reload schema';
