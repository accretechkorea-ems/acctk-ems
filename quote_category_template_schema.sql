-- 견적 분류·양식·장비 구성 템플릿 스키마 (2026-10-19 작성). **아직 DB 에 적용하지 않았다.**
-- 이 파일은 적용 대기 상태다 — 아래 「적용 순서」를 읽고 **한 문장씩 따로** 실행한다.
--
-- ════════════════════════════════════════════════════════════════════════════
-- 무엇을 위한 것인가
-- ════════════════════════════════════════════════════════════════════════════
--   견적서 개편 4~7단계가 쓸 칸과 표를 미리 만든다. 네 가지다.
--
--   ① 견적 분류 — BCT·CMM·KOLAS·Measuring Service·Roundness·SBS·Surface·TSE 여덟 개.
--      견적 작성 첫 화면에서 **필수로 고르는 값**이고, 관리 화면에서 추가·수정·비활성할 수 있어야
--      하므로 코드 상수가 아니라 **마스터 표**(quote_categories)로 둔다.
--      줄별로 다르게 지정할 수 있어야 해서 quotes 와 quote_items 양쪽에 칸이 있다
--      (통계는 줄 분류를 먼저 보고, 없으면 견적 분류로 떨어진다 — 그 판정은 코드가 한다).
--
--   ② 견적 양식 — 20 견적서 / 80 파츠 / 80 장비 세 가지(quotes.form_kind).
--      **지금 코드에는 이 축이 아예 없다.** 세 양식이 PDF 뼈대를 공유하면서 세부가 갈린다.
--
--   ③ 장비 구성 그룹 — 본체+기본구성 / 옵션 / 포함사항(quote_items.group_kind).
--      PDF 의 계층번호(1-1, 2-1)는 **저장하지 않는다** — 그리는 자리에서 순서대로 센다.
--      번호를 저장하면 줄을 지웠을 때 빈 번호가 남고, 저장값과 그린 값이 어긋난다.
--
--   ④ 장비 구성 템플릿 — 기종별 구성 묶음을 저장해 두고 불러 쓴다
--      (quote_templates · quote_template_items).
--
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠ form_kind 는 quote_type 과 **다른 축**이다 — 재사용 금지
-- ════════════════════════════════════════════════════════════════════════════
--   quotes.quote_type 은 이미 있지만 값이 null / 'repair_hq' / 'repair_domestic' 셋뿐이고,
--   **수리 라우팅 전용**이다. 아래 네 곳이 그 값으로 분기한다 —
--     app/api/auto-fail/route.ts:28,41          (repair_domestic 은 자동 실주에서 제외)
--     app/sales/page.tsx:1107,1113              (발주서 등록 버튼 표시/숨김)
--     components/dashboard/MyQuotesPanel.tsx:833,839,847  (같은 분기)
--     lib/approval/quoteApproval.ts:105         (결재 summary 에 담아 후처리에 쓴다)
--   여기에 'parts80' 같은 값을 더하면 그 분기가 전부 틀어진다. 그래서 **새 칸**을 쓴다.
--
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠ create_quote 의 조용한 누락 — 칸만 추가하면 저장되지 않는다
-- ════════════════════════════════════════════════════════════════════════════
--   create_quote 는 jsonb_populate_record / jsonb_populate_recordset 로 값을 받지만
--   **insert 컬럼 목록이 명시되어 있다.** 목록에 없는 칸은 예외 없이 **조용히 버려진다**
--   (jsonb_populate_recordset 이 쓰지 않는 키를 버린다). 오류도 경고도 나지 않는다.
--   그래서 단계 6 의 함수 교체를 빠뜨리면, 화면이 분류를 보내도 DB 에는 null 만 남는다.
--
-- ════════════════════════════════════════════════════════════════════════════
-- 적용 순서 — 이 순서를 지켜야 한다
-- ════════════════════════════════════════════════════════════════════════════
--   단계 0 (읽기)  — **먼저 실행한다.** 타입과 이름 충돌을 눈으로 확인한다.
--                    여기서 예상과 다른 값이 나오면 **멈추고 이 파일을 고친 뒤** 다시 시작한다.
--   단계 1~5 (칸·표 추가) — **코드 배포보다 먼저.** 코드가 이 칸들을 select 하게 되므로,
--                    칸이 없는 상태에서 새 코드가 올라가면 PostgREST 오류로 조회가 떨어진다.
--   단계 6 (함수 교체)   — 단계 2·3 뒤, 코드 배포 **전후 아무 때나.**
--                    교체 전에 새 코드가 분류를 보내도 조용히 버려질 뿐 예외는 나지 않는다
--                    (저장만 안 된다 — 위 경고 참조).
--   단계 7 (코드 배포)   — 4~7단계 작업물.
--
--   순서를 어기면:
--     코드 먼저 배포 → 견적 목록·검토표·다시쓰기 조회가 **깨진다**(없는 칸을 select 한다).
--     함수 교체 빠뜨림 → 저장이 **조용히 누락된다**(분류가 늘 null 로 남는다).
--
-- ════════════════════════════════════════════════════════════════════════════
-- backfill 하지 않는다
-- ════════════════════════════════════════════════════════════════════════════
--   옛 견적은 category·form_kind·group_kind 가 **null 로 남는다.**
--     null category   = 「미분류」. 통계·목록이 1급 값으로 받아야 한다(코드가 할 일).
--     null form_kind  = 「기존 양식」. 지금 PDF 한 벌이 그 뜻이다.
--     null group_kind = 「구성 그룹 없음」(장비 양식이 아닌 줄).
--   quote_items 는 생성 뒤 update 되는 코드가 레포에 하나도 없다(쓰는 곳은 create_quote 뿐).
--   그래서 옛 견적의 분류는 영구히 null 이다 — 그것이 맞는 상태다.
--   terms·sub_lines 가 쓴 규칙과 같다(quotes_terms_schema.sql · quote_items_sublines_schema.sql).
--
-- ════════════════════════════════════════════════════════════════════════════
-- 금액·결재와 무관하다
-- ════════════════════════════════════════════════════════════════════════════
--   이 파일은 **글자와 분류만** 담는다. 금액·환율·관세·이익률 계산, 승인 게이트, 삭제 판정
--   (lib/quoteDeletePolicy.ts), 견적번호 채번은 한 줄도 건드리지 않는다.
--   템플릿에 **가격(구입가)을 저장하지 않는 것**도 같은 이유다 — 열 때 가격표와 그날 환율로
--   다시 계산한다. 저장해 두면 가격표가 개정될 때 템플릿만 옛 값으로 굳는다.
--
-- 적용 후 확인 쿼리는 각 단계 바로 아래에, 되돌리기는 파일 맨 아래에 모아 두었다.


-- ════════════════════════════════════════════════════════════════════════════
-- 단계 0 (읽기). 타입·이름 충돌 사전 확인 — **가장 먼저 실행한다**
--
--   이 파일은 DB 를 조회하지 않고 레포의 기록만 보고 썼다. 아래 네 가지가 예상과 같아야 한다.
--   하나라도 다르면 **멈추고** 이 파일의 해당 타입을 고친 뒤 단계 1 로 간다.
-- ════════════════════════════════════════════════════════════════════════════

-- ① engineers.engineer_id · quotes.engineer_id · quotes.created_by 의 타입
--    기대: 셋 다 integer. 템플릿 표의 owner_id·updated_by·deleted_by 를 integer 로 잡은 근거다.
--    (근거 — current_engineer_id() returns integer: leads_rls_policy.sql:36
--            next_quote_seq(p_date text, p_engineer_id integer): db_functions_snapshot.sql:58
--            create_quote 의 v_me·v_owner integer: quote_items_sublines_schema.sql:97,99)
select table_name, column_name, data_type, numeric_precision
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'engineers' and column_name = 'engineer_id')
    or (table_name = 'quotes' and column_name in ('engineer_id', 'created_by'))
  )
order by table_name, column_name;

-- ② quote_items.category 의 타입과 쓰임
--    기대: data_type = 'text', 그리고 **값이 전부 null**(with_category = 0).
--    이 칸을 줄 분류로 재사용하고 quote_categories(code) 로 FK 를 건다. text 가 아니면 FK 가
--    만들어지지 않고, null 아닌 값이 있으면 FK 가 그 값 때문에 거부된다.
select data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'quote_items' and column_name = 'category';

select count(*) as total, count(category) as with_category
from public.quote_items;

-- ③ 만들려는 이름이 이미 있는지 — 기대: 0행
--    quotes.category / quotes.form_kind / quote_items.group_kind 칸,
--    quote_categories / quote_templates / quote_template_items 표.
select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'quotes' and column_name in ('category', 'form_kind'))
    or (table_name = 'quote_items' and column_name = 'group_kind')
  );

select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('quote_categories', 'quote_templates', 'quote_template_items');

-- ④ uuid 기본값에 쓸 함수 — 기대: uuid 한 개가 나온다(PG13+ 코어 함수).
select gen_random_uuid();

-- ⑤ RLS 헬퍼가 있는지 — 기대: is_superadmin · has_team_perm 두 행
--    (teams_rls_policy.sql:18 · db_functions_snapshot.sql:25)
select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('is_superadmin', 'has_team_perm')
order by p.proname;


-- ════════════════════════════════════════════════════════════════════════════
-- 단계 1. 분류 마스터 표 quote_categories
--
--   offices(lib/offices.ts) · expense_presets 와 같은 마스터 표 모양이다 —
--   code / label / sort_order / is_active. 코드가 아니라 DB 가 정본이고, 관리 화면에서 고친다.
--
--   **code 가 PK 다**(serial 대리 키를 두지 않는다). quotes.category · quote_items.category ·
--   quote_templates.category 가 이 글자를 그대로 참조하므로, 숫자 id 를 두면 세 곳에서 조인을
--   해야 보이는 값이 나온다. code 는 **바꾸지 않는 열쇠**이고 label 만 고친다.
--   그래서 code 는 영문 대문자 스네이크, label 은 화면 표기 그대로다.
--
--   is_active 를 끄면 **새 견적에서 고를 수 없을 뿐** 옛 견적의 분류는 그대로 보인다
--   (행을 지우지 않는다 — FK 가 막고, 지우면 과거 통계가 사라진다).
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.quote_categories (
  code       text primary key,
  label      text not null,
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.quote_categories is
  '견적 분류 마스터(BCT·CMM·KOLAS …). 관리 화면에서 추가·수정·비활성한다. code 는 바꾸지 않는 열쇠.';
comment on column public.quote_categories.code is
  '참조 열쇠. quotes.category · quote_items.category · quote_templates.category 가 이 값을 쓴다. 바꾸지 마라.';
comment on column public.quote_categories.label is '화면·PDF 표기. 이쪽만 고친다.';
comment on column public.quote_categories.is_active is
  'false 면 새 견적에서 고를 수 없다. 옛 견적의 분류 표기는 그대로 남는다(행을 지우지 않는다).';


-- 시드 여덟 개. 다시 실행해도 안전하다(on conflict do nothing — label·순서를 덮지 않는다).
-- sort_order 는 10 단위로 띄웠다 — 나중에 사이에 끼울 수 있게.
insert into public.quote_categories (code, label, sort_order) values
  ('BCT',               'BCT',               10),
  ('CMM',               'CMM',               20),
  ('KOLAS',             'KOLAS',             30),
  ('MEASURING_SERVICE', 'Measuring Service', 40),
  ('ROUNDNESS',         'Roundness',         50),
  ('SBS',               'SBS',               60),
  ('SURFACE',           'Surface',           70),
  ('TSE',               'TSE',               80)
on conflict (code) do nothing;


-- RLS — teams_rls_policy.sql 과 같은 모양이다(마스터 표 선례).
--   조회: 로그인 사용자 전체. 견적 목록·통계·관리 화면이 모두 라벨을 읽어야 한다.
--   쓰기: superadmin 만. 분류는 quotes·quote_items 가 참조하는 기준 데이터라, 일반 사용자가
--         anon 키로 고치면 참조 무결성과 과거 통계가 함께 깨진다.
--
--   ※ 함수를 (select …) 로 감싼다 — 행마다 다시 부르지 않고 문장마다 한 번만 평가된다
--     (레포 관례: rls_tighten_batch2.sql:18). teams_rls_policy.sql 은 감싸지 않은 옛 모양이다.
--   ※ public 에 새 표를 만들면 이벤트 트리거 rls_auto_enable 이 RLS 를 켠다
--     (db_functions_snapshot.sql:76). 아래 문장은 그래도 명시한다 — 켜져 있어도 안전하다.
alter table public.quote_categories enable row level security;

drop policy if exists "quote_categories_select_authenticated" on public.quote_categories;
create policy "quote_categories_select_authenticated"
on public.quote_categories for select to authenticated
using (true);

drop policy if exists "quote_categories_insert_superadmin" on public.quote_categories;
create policy "quote_categories_insert_superadmin"
on public.quote_categories for insert to authenticated
with check ((select public.is_superadmin()));

drop policy if exists "quote_categories_update_superadmin" on public.quote_categories;
create policy "quote_categories_update_superadmin"
on public.quote_categories for update to authenticated
using ((select public.is_superadmin()))
with check ((select public.is_superadmin()));

drop policy if exists "quote_categories_delete_superadmin" on public.quote_categories;
create policy "quote_categories_delete_superadmin"
on public.quote_categories for delete to authenticated
using ((select public.is_superadmin()));

grant select on public.quote_categories to authenticated;
grant insert, update, delete on public.quote_categories to authenticated;
-- ↑ 쓰기 GRANT 를 주는 이유: 관리 화면이 anon 키(authenticated 역할)로 고친다. 실제 통제는
--   위 정책(superadmin 만)이 한다. GRANT 를 빼면 superadmin 도 42501 로 막힌다.
--   레포 규칙대로 **어느 표의 GRANT 도 회수하지 않는다**(rls_tighten_batch2.sql:11).

-- ── 적용 확인 (읽기) ──
-- 칸 다섯 개가 기대한 타입인가
-- select column_name, data_type, is_nullable, column_default
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'quote_categories'
-- order by ordinal_position;

-- PK 가 code 인가(1행: PRIMARY KEY (code))
-- select conname, pg_get_constraintdef(oid)
-- from pg_constraint
-- where conrelid = 'public.quote_categories'::regclass and contype = 'p';

-- 시드 여덟 행이 들어갔는가(8행, 순서 10~80)
-- select code, label, sort_order, is_active from public.quote_categories order by sort_order;

-- 정책 네 개가 기대한 조건인가(select 는 true, 나머지는 is_superadmin)
-- select policyname, cmd, qual, with_check
-- from pg_policies
-- where schemaname = 'public' and tablename = 'quote_categories'
-- order by cmd, policyname;


-- ════════════════════════════════════════════════════════════════════════════
-- 단계 2. quotes 에 칸 둘 — category(견적 분류) · form_kind(양식)
--
--   둘 다 nullable 이고 **기본값을 두지 않는다.** 기본값을 주면 옛 견적까지 그 값으로 읽혀
--   「미분류」와 「분류가 그 값인 견적」을 구분할 수 없다.
--   FK·CHECK 는 칸 추가와 **따로** 건다 — 되돌릴 때 하나씩 떼어낼 수 있게.
-- ════════════════════════════════════════════════════════════════════════════
alter table public.quotes
  add column if not exists category text;

alter table public.quotes
  add column if not exists form_kind text;

-- FK — 없는 분류 코드가 들어가지 못하게. 삭제·갱신 동작은 기본값(NO ACTION)이다:
-- 쓰이고 있는 분류는 지울 수 없다(그것이 맞는 동작이다 — 과거 견적의 분류가 사라지면 안 된다).
alter table public.quotes
  add constraint quotes_category_fkey
  foreign key (category) references public.quote_categories(code);

-- CHECK — 양식 세 가지만. null 은 「기존 양식」이라 통과한다(null 비교는 unknown → 제약 통과).
alter table public.quotes
  add constraint quotes_form_kind_check
  check (form_kind in ('general20', 'parts80', 'equip80'));

comment on column public.quotes.category is
  '견적 분류(quote_categories.code). null = 미분류(결재·개편 전 견적). 줄별 분류는 quote_items.category.';
comment on column public.quotes.form_kind is
  '견적 양식: general20(20 견적서) / parts80(80 파츠) / equip80(80 장비). null = 기존 양식. '
  '⚠ quote_type 과 다른 축이다 — quote_type 은 수리 라우팅 전용(null/repair_hq/repair_domestic)이고 '
  '그 값으로 분기하는 코드가 네 곳 있다. 절대 섞어 쓰지 마라.';

-- ── 적용 확인 (읽기) ──
-- 칸 둘이 생겼는가(2행, text, YES, 기본값 없음)
-- select column_name, data_type, is_nullable, column_default
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'quotes'
--   and column_name in ('category', 'form_kind')
-- order by column_name;

-- 제약 둘이 걸렸는가(2행)
-- select conname, pg_get_constraintdef(oid)
-- from pg_constraint
-- where conrelid = 'public.quotes'::regclass
--   and conname in ('quotes_category_fkey', 'quotes_form_kind_check');

-- 기존 견적은 전부 null 이어야 한다(backfill 하지 않았다)
-- select count(*) as total, count(category) as with_category, count(form_kind) as with_form
-- from public.quotes;


-- ════════════════════════════════════════════════════════════════════════════
-- 단계 3. quote_items — 기존 category 를 줄 분류로 재사용 + group_kind 추가
--
--   quote_items.category 는 **칸이 이미 있다.** create_quote 의 insert 목록에도 들어 있고
--   (quote_items_sublines_schema.sql:193), 화면은 늘 null 을 넣는다(app/quote/page.tsx 의
--   handleSaveQuote — `category: null`). **읽는 코드는 레포에 하나도 없다.**
--   그래서 칸을 새로 만들지 않고 이 자리를 줄 분류로 쓴다 — 함수의 insert 목록도 그대로다.
--
--   ⚠ 단계 0 ② 에서 with_category = 0 을 확인했어야 한다. null 아닌 값이 하나라도 있으면
--     아래 FK 가 그 값 때문에 거부된다(데이터는 바뀌지 않는다 — 문장만 실패한다).
--
--   group_kind 는 장비 양식의 구성 그룹이다. **계층번호(1-1, 2-1)는 저장하지 않는다** —
--   PDF 가 그리면서 순서대로 센다.
-- ════════════════════════════════════════════════════════════════════════════
alter table public.quote_items
  add constraint quote_items_category_fkey
  foreign key (category) references public.quote_categories(code);

comment on column public.quote_items.category is
  '줄 단위 견적 분류(quote_categories.code). null = 줄 분류 없음 → 견적 분류(quotes.category)를 따른다. '
  '⚠ 81/83/84 장비계열(lib/constants.ts 의 CATEGORY_OPTIONS, 고객사·기기 분류)과는 **무관하다**. '
  '2026-10-19 이전에는 이 칸에 늘 null 만 들어갔고 읽는 코드가 없었다.';

alter table public.quote_items
  add column if not exists group_kind text;

alter table public.quote_items
  add constraint quote_items_group_kind_check
  check (group_kind in ('base', 'option', 'include'));

comment on column public.quote_items.group_kind is
  '장비 양식의 구성 그룹: base(본체+기본구성) / option(옵션) / include(포함사항). '
  'null = 구성 그룹 없음(장비 양식이 아닌 줄). PDF 의 계층번호(1-1, 2-1)는 저장하지 않고 그릴 때 센다.';

-- ── 적용 확인 (읽기) ──
-- group_kind 칸이 생겼는가(1행, text, YES)
-- select column_name, data_type, is_nullable, column_default
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'quote_items' and column_name = 'group_kind';

-- 제약 둘이 걸렸는가(2행)
-- select conname, pg_get_constraintdef(oid)
-- from pg_constraint
-- where conrelid = 'public.quote_items'::regclass
--   and conname in ('quote_items_category_fkey', 'quote_items_group_kind_check');

-- 기존 품목은 전부 null 이어야 한다
-- select count(*) as total, count(category) as with_category, count(group_kind) as with_group
-- from public.quote_items;


-- ════════════════════════════════════════════════════════════════════════════
-- 단계 4. 장비 구성 템플릿 — quote_templates
--
--   기종(model_key) 별 구성 묶음. 「누가 만든 것인지」를 화면에 보여야 해서 owner_name 을
--   **글자로 함께 저장한다** — 만든 사람이 퇴사해 engineers 에서 안 보이게 되어도 이름이 남아야
--   하고, 목록을 그릴 때 조인을 한 번 덜 한다. owner_id 는 판정용(남의 것인지)이다.
--
--   owner_id · updated_by · deleted_by 는 **integer** 다(quotes.engineer_id 와 같은 타입).
--   근거는 단계 0 ① 에 적어 두었다. FK 는 걸지 않는다 — 퇴사자 행이 지워져도 템플릿은 남아야
--   하고, owner_name 이 이미 사람 이름을 들고 있다.
--
--   삭제는 **soft delete** 다(is_deleted). 「남의 것은 복사해서 저장」이 기본이라 원본을 지워도
--   복사본의 출처를 되짚을 수 있어야 하고, 실수로 지운 것을 되살려야 한다.
--
--   ⚠ **감사 트리거(audit_row_change)를 붙이지 않는다.** 그 함수는 auth.uid() / auth.jwt() 로
--     행위자를 잡는데(audit_log_setup.sql:52-58), 이 표는 service role 라우트가 쓰므로 사용자
--     JWT 가 없다 — actor_uid·actor_email 이 **null 로 남아 「누가 바꿨나」가 안 남는다.**
--     그래서 updated_by / deleted_by 칸으로 행위자를 남긴다. 그 값은 **라우트가 세션에서 강제로**
--     넣는다(본문 값을 믿지 않는다 — created_by 를 함수가 강제하는 것과 같은 규칙).
--     updated_at 도 트리거 없이 라우트가 넣는다.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.quote_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  owner_id    integer,                  -- 만든 사람(engineers.engineer_id). FK 없음 — 위 설명 참조
  owner_name  text not null,            -- 만든 사람 이름 스냅샷. 퇴사해도 목록에 남는다
  form_kind   text not null default 'equip80',
  category    text references public.quote_categories(code),
  model_key   text,                     -- 기종 대표 품번. 같은 기종의 템플릿을 모아 보는 열쇠
  used_count  integer not null default 0,
  last_used_at timestamptz,
  is_deleted  boolean not null default false,
  deleted_at  timestamptz,
  deleted_by  integer,
  updated_by  integer,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.quote_templates is
  '장비 구성 템플릿 머리. 삭제는 soft delete(is_deleted). 감사 트리거를 붙이지 않는다 — '
  'service role 라우트가 쓰므로 행위자가 안 남는다. updated_by/deleted_by 를 라우트가 세션에서 강제한다.';
comment on column public.quote_templates.owner_name is
  '만든 사람 이름 스냅샷. 퇴사해 engineers 에서 안 보이게 되어도 목록에 남아야 한다.';
comment on column public.quote_templates.form_kind is
  'quotes.form_kind 와 같은 값. 장비 구성 템플릿이라 기본은 equip80 이다(CHECK 는 두지 않는다 — '
  '양식이 늘어날 때 두 곳을 고치지 않게. 값 검증은 라우트가 한다).';
comment on column public.quote_templates.model_key is
  '기종 대표 품번. 견적 화면이 「이 기종의 템플릿」을 찾는 열쇠다. 가격표(price_list)로 FK 는 걸지 않는다 '
  '— 가격표는 통째로 갈리는 표다(upload_price_list.js).';
comment on column public.quote_templates.used_count is '불러 쓴 횟수. 목록 정렬에 쓴다. 라우트가 올린다.';

create index if not exists quote_templates_model_idx
  on public.quote_templates (model_key, is_deleted);
create index if not exists quote_templates_owner_idx
  on public.quote_templates (owner_id);

-- RLS — **SELECT 정책만 둔다.**
--   조회: superadmin 또는 견적 권한. 기존 견적 SELECT 정책이 쓰는 판정과 같은 갈래다
--         (quote_schema_snapshot.sql:52-57 의 quotes_select).
--         ※ has_team_perm 은 superadmin 이면 이미 true 다(db_functions_snapshot.sql:36).
--           그래도 is_superadmin 을 함께 적는다 — 뜻이 드러나고, 나중에 has_team_perm 의
--           superadmin 처리가 바뀌어도 관리자가 잠기지 않는다.
--   쓰기: **정책을 만들지 않는다.** 그러면 authenticated 는 정책이 없어 전면 차단되고,
--         service role 은 RLS 를 우회하므로 서버 라우트만 쓸 수 있다.
--         「로그인한 견적 권한자는 누구나 수정·삭제」라는 규칙은 **라우트에서** 구현한다
--         (남의 것은 복사 저장이 기본, 등).
--
--   ⚠ quote_items 의 느슨한 정책을 베끼지 않는다. 그 표는 네 정책이 모두 「부모 견적이
--     존재하기만 하면 허용」이라, 사실상 로그인 사용자면 남의 견적 품목도 고치고 지울 수 있다
--     (quote_schema_snapshot.sql:70-82 가 그 사실을 ⚠ 로 적어 두었다). 같은 구멍을 새로 만들지 않는다.
alter table public.quote_templates enable row level security;

drop policy if exists "quote_templates_select_quote_perm" on public.quote_templates;
create policy "quote_templates_select_quote_perm"
on public.quote_templates for select to authenticated
using ((select public.is_superadmin()) or (select public.has_team_perm('quote')));

grant select on public.quote_templates to authenticated;
-- insert/update/delete GRANT 는 주지 않는다 — 정책도 없고 권한도 없어 두 겹으로 막힌다.
-- 서버 라우트(service role)는 둘 다 우회한다.

-- ── 적용 확인 (읽기) ──
-- 칸 열다섯 개가 기대한 타입인가(owner_id·updated_by·deleted_by 가 integer 인지 특히 확인)
-- select column_name, data_type, is_nullable, column_default
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'quote_templates'
-- order by ordinal_position;

-- PK·FK 가 걸렸는가(PK uuid, FK category → quote_categories)
-- select conname, contype, pg_get_constraintdef(oid)
-- from pg_constraint
-- where conrelid = 'public.quote_templates'::regclass
-- order by contype, conname;

-- 인덱스 둘이 생겼는가(PK 포함 3행)
-- select indexname, indexdef from pg_indexes
-- where schemaname = 'public' and tablename = 'quote_templates' order by indexname;

-- 정책이 **SELECT 하나뿐**인가(1행. insert/update/delete 가 보이면 잘못됐다)
-- select policyname, cmd, qual, with_check from pg_policies
-- where schemaname = 'public' and tablename = 'quote_templates' order by cmd;

-- authenticated 에게 준 권한이 SELECT 뿐인가(1행)
-- select privilege_type from information_schema.role_table_grants
-- where table_schema = 'public' and table_name = 'quote_templates' and grantee = 'authenticated'
-- order by privilege_type;


-- ════════════════════════════════════════════════════════════════════════════
-- 단계 5. 템플릿 줄 — quote_template_items
--
--   **가격(구입가)을 저장하지 않는다.** 열 때 가격표(price_list.cost_jpy)와 그날 환율로 다시
--   계산한다 — 저장하면 가격표 개정 뒤 템플릿만 옛 값으로 굳는다.
--   default_sell_price 는 **판매단가**다(사람이 정한 값이라 다시 계산할 수 없다). 비어 있으면
--   화면이 이익률 모드로 역산한다.
--
--   group_kind 는 quote_items.group_kind 의 세 값 + domestic(국내조달품) 네 가지다 —
--   구성 선택 모달의 네 묶음이 그대로 들어온다. 견적으로 옮길 때 domestic 줄은
--   row_kind='domestic' 인 품목이 되고 group_kind 는 비운다(그 판정은 코드가 한다).
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.quote_template_items (
  id                 uuid primary key default gen_random_uuid(),
  template_id        uuid not null references public.quote_templates(id) on delete cascade,
  group_kind         text not null check (group_kind in ('base', 'option', 'include', 'domestic')),
  row_kind           text not null default 'price_list',
  part_code          text,
  item_name          text,
  qty_per_unit       numeric not null default 1,
  default_checked    boolean not null default true,
  default_sell_price numeric,
  sort_order         integer not null default 0
);

comment on table public.quote_template_items is
  '템플릿의 구성 줄. **구입가를 저장하지 않는다** — 열 때 price_list.cost_jpy 와 그날 환율로 다시 계산한다.';
comment on column public.quote_template_items.group_kind is
  'base/option/include 는 quote_items.group_kind 와 같은 값이고, domestic 은 국내조달품 묶음이다 '
  '(견적으로 옮길 때 row_kind=domestic 품목이 되고 group_kind 는 비운다).';
comment on column public.quote_template_items.row_kind is
  'app/quote/types.ts 의 RowKind. 기본 price_list. CHECK 를 두지 않는다 — 종류가 늘 때 두 곳을 고치지 않게.';
comment on column public.quote_template_items.qty_per_unit is '본체 1대당 수량. 대수를 곱해 줄 수량이 된다.';
comment on column public.quote_template_items.default_checked is
  '구성 선택 모달을 열 때 기본으로 체크될지. 기본구성은 true, 옵션은 보통 false 로 저장한다.';
comment on column public.quote_template_items.default_sell_price is
  '판매단가 기본값(원). 사람이 정한 값이라 다시 계산할 수 없어 저장한다. null 이면 화면이 이익률로 역산한다.';

create index if not exists quote_template_items_tpl_idx
  on public.quote_template_items (template_id, sort_order);

-- RLS — 머리(quote_templates)와 같은 규칙이다. SELECT 만, 쓰기는 service role.
alter table public.quote_template_items enable row level security;

drop policy if exists "quote_template_items_select_quote_perm" on public.quote_template_items;
create policy "quote_template_items_select_quote_perm"
on public.quote_template_items for select to authenticated
using ((select public.is_superadmin()) or (select public.has_team_perm('quote')));

grant select on public.quote_template_items to authenticated;

-- ── 적용 확인 (읽기) ──
-- 칸 열 개가 기대한 타입인가
-- select column_name, data_type, is_nullable, column_default
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'quote_template_items'
-- order by ordinal_position;

-- FK 가 ON DELETE CASCADE 인가(머리를 지우면 줄도 지워진다)
-- select conname, pg_get_constraintdef(oid)
-- from pg_constraint
-- where conrelid = 'public.quote_template_items'::regclass and contype = 'f';

-- 인덱스가 생겼는가(PK 포함 2행)
-- select indexname, indexdef from pg_indexes
-- where schemaname = 'public' and tablename = 'quote_template_items' order by indexname;

-- 정책이 SELECT 하나뿐인가(1행)
-- select policyname, cmd, qual from pg_policies
-- where schemaname = 'public' and tablename = 'quote_template_items';


-- ════════════════════════════════════════════════════════════════════════════
-- 단계 6. create_quote 교체 — 새 칸 셋을 insert 목록에 넣는다
--
--   **단계 2·3 을 먼저 실행해야 한다.** 칸이 없으면 이 함수 생성이 실패한다.
--
--   **현재 정의(quote_items_sublines_schema.sql 의 함수)를 파일에서 그대로 옮겼다.**
--   시그니처·반환·언어·security definer·search_path·권한(revoke/grant)·채번·대필 검증·
--   견적 insert(terms 포함)·품목 insert(sub_lines 포함)·부대비용·수리 연결은
--   **한 글자도 바뀌지 않았다.**
--
--   바뀐 줄은 세 자리뿐이다(+ 주석 1줄):
--     @@ quotes 칸 목록
--     -     terms,
--     +     terms,
--     +     category, form_kind,
--           pdf_url
--     @@ quotes 값 목록
--     -     v_q.terms,
--     +     v_q.terms,
--     +     v_q.category, v_q.form_kind,
--           null
--     @@ quote_items 칸 목록 · select 목록
--     -       sub_lines
--     +       sub_lines, group_kind
--     -            x.sub_lines
--     +            x.sub_lines, x.group_kind
--
--   견적 본문은 `jsonb_populate_record(null::public.quotes, …)`, 품목은
--   `jsonb_populate_recordset(null::public.quote_items, p_items)` 로 받는다. 그래서 단계 2·3 이
--   끝나면 p_quote 의 category·form_kind 와 p_items 의 group_kind 가 **자동으로** v_q·x 에
--   담긴다 — 읽는 코드를 따로 더하지 않았다.
--   coalesce 를 쓰지 않는 이유: null 이 「미분류」·「기존 양식」·「구성 그룹 없음」이라는 뜻이라
--   그대로 넣어야 한다.
--
--   quote_items 의 category 는 **이미 목록에 있었다**(quote_items_sublines_schema.sql:193).
--   그래서 줄 분류는 이 교체 없이도 저장된다 — 그래도 단계 3 의 FK 가 있어야 값이 검증된다.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.create_quote(
  p_date      text,                      -- 'YYYYMMDD' (KST). 채번 키이자 quote_date 의 근거
  p_quote     jsonb,                     -- 견적 본문(quotes 컬럼 이름과 같은 키만 쓴다)
  p_items     jsonb,                     -- 품목 배열(quote_items 컬럼 이름)
  p_expenses  jsonb,                     -- 부대비용 배열(quote_expenses 컬럼 이름)
  p_repair_id integer default null        -- 수리 건에서 넘어온 견적이면 그 repair_id
)
returns table (quote_id bigint, quote_number text, seq integer, repair_linked boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me       integer;
  v_initials text;
  v_owner    integer;                    -- 실적 귀속자. 대필이면 v_me 와 다르다
  v_q        public.quotes%rowtype;
  v_seq      integer;
  v_n        integer;
  v_letters  text := '';
  v_number   text;
  v_quote_id bigint;
  v_rows     integer;
  -- 수리 건 연결 결과 — true 연결됨 / false 대상 행이 없음 / null 연결 시도 자체가 없었음.
  -- 화면은 false 일 때만 「수동으로 연결해주세요」를 띄운다(지금 동작을 그대로 유지하는 값이다).
  v_linked   boolean;
begin
  -- 1. 로그인 사용자 — JWT 이메일로 engineers 를 찾는다(current_engineer_id 는 STABLE·DEFINER).
  v_me := public.current_engineer_id();
  if v_me is null then
    raise exception '로그인이 필요합니다';
  end if;

  -- 2. 견적 작성 권한 — 지금까지 화면 가드만 하던 검사를 DB 로 옮긴다.
  if not public.has_team_perm('quote') then
    raise exception '견적 작성 권한이 없습니다';
  end if;

  -- 3. 이니셜 — 번호를 만들 수 없으면 순번을 쓰기 전에 멈춘다.
  select nullif(btrim(e.initials), '') into v_initials
  from public.engineers e
  where e.engineer_id = v_me;
  if v_initials is null then
    raise exception '이니셜이 등록되지 않았습니다';
  end if;

  -- 날짜 형식 — 'YYYYMMDD' 여덟 자리만 받는다.
  if p_date !~ '^\d{8}$' then
    raise exception '날짜 형식이 올바르지 않습니다';
  end if;

  -- 견적 본문을 quotes 행 모양으로 받는다. quotes 에 없는 키는 조용히 버려진다.
  v_q := jsonb_populate_record(null::public.quotes, coalesce(p_quote, '{}'::jsonb));

  -- 4. 대필 — 실적 귀속자가 호출자와 다르면 영업관리 권한이 있어야 하고, 대상이 재직 중이어야 한다.
  --    (지금은 /api/quote-on-behalf 가 하던 판정이다. 화면을 거치지 않는 호출도 막으려고 여기서 다시 본다.)
  v_owner := coalesce(v_q.engineer_id, v_me);
  if v_owner <> v_me then
    if not public.has_team_perm('sales_mgmt') then
      raise exception '대필 권한이 없습니다';
    end if;
    if not exists (
      select 1 from public.engineers e
      where e.engineer_id = v_owner
        and e.resigned_date is null
    ) then
      raise exception '대상 엔지니어를 찾을 수 없습니다';
    end if;
  end if;

  -- 5. 순번 — (날짜, 작성자) 카운터를 원자적으로 올린다.
  --    아래에서 예외가 나면 이 증가도 함께 롤백된다(지금은 번호만 소비되고 사라진다).
  v_seq := public.next_quote_seq(p_date, v_me);
  if v_seq is null or v_seq < 1 then
    raise exception '견적번호 순번을 발급하지 못했습니다';
  end if;

  -- 6. 번호 글자 — 1→A … 26→Z, 27→AA, 28→AB (엑셀 열 이름 방식).
  --    app/quote/page.tsx 의 seqToLetters 와 같은 식이다: r = (n-1) % 26, n = (n-1) / 26.
  v_n := v_seq;
  while v_n > 0 loop
    v_letters := chr(65 + ((v_n - 1) % 26)) || v_letters;
    v_n := (v_n - 1) / 26;
  end loop;
  v_number := 'No.' || upper(v_initials) || p_date || '-' || v_letters;

  -- 7. 견적 — created_by 는 p_quote 값을 쓰지 않고 호출자로 강제한다(위조 방지).
  --    pdf_url 은 비워 둔다. PDF 를 올린 뒤 화면이 실제 파일 이름으로 채운다.
  --    returning 은 테이블 이름으로 한정한다 — 이 함수의 반환 칸 이름이 quote_id 라 그냥 쓰면 모호해진다.
  --    terms 는 받은 값을 그대로 넣는다 — null 이 「조건 네 줄 모두 기본값」이라는 뜻이다.
  insert into public.quotes (
    quote_number, quote_date, created_by, engineer_id,
    customer_id, dealer_id, opportunity_id, delivery_info,
    recipient, note, quote_type, status,
    total_supply, total_tax, total_amount, total_cost, total_profit, profit_rate,
    terms,
    category, form_kind,
    pdf_url
  ) values (
    v_number, to_date(p_date, 'YYYYMMDD'), v_me, v_owner,
    v_q.customer_id, v_q.dealer_id, v_q.opportunity_id, v_q.delivery_info,
    v_q.recipient, v_q.note, v_q.quote_type, coalesce(v_q.status, '견적중'),
    coalesce(v_q.total_supply, 0), coalesce(v_q.total_tax, 0), coalesce(v_q.total_amount, 0),
    coalesce(v_q.total_cost, 0), coalesce(v_q.total_profit, 0), coalesce(v_q.profit_rate, 0),
    v_q.terms,
    v_q.category, v_q.form_kind,
    null
  )
  returning quotes.quote_id into v_quote_id;

  -- 8. 품목 — 클라이언트가 보낸 quote_id 는 믿지 않고 방금 만든 견적에 붙인다.
  --    item_id 는 컬럼 목록에 넣지 않는다(identity 가 채운다).
  --    sub_lines 는 받은 값을 그대로 넣는다 — null 이 「설명 줄 없음」이라는 뜻이다.
  --    category·group_kind 도 그대로 넣는다 — null 이 「줄 분류 없음」·「구성 그룹 없음」이다.
  if jsonb_typeof(coalesce(p_items, 'null'::jsonb)) = 'array' and jsonb_array_length(p_items) > 0 then
    insert into public.quote_items (
      quote_id, price_list_id, part_code, row_kind, product_name, quantity,
      unit_price_jpy, unit_price_krw, supply_amount, tax_amount, category,
      cost_amount, profit_amount, profit_rate, exchange_rate, tariff_rate,
      sub_lines, group_kind
    )
    select v_quote_id, x.price_list_id, x.part_code, x.row_kind, x.product_name, x.quantity,
           x.unit_price_jpy, x.unit_price_krw, x.supply_amount, x.tax_amount, x.category,
           x.cost_amount, x.profit_amount, x.profit_rate, x.exchange_rate, x.tariff_rate,
           x.sub_lines, x.group_kind
    from jsonb_populate_recordset(null::public.quote_items, p_items) x;
  end if;

  -- 9. 부대비용 — 같은 방식. expense_id 는 serial 이 채운다.
  --    NOT NULL(item_name·unit_price·amount)이 비면 여기서 예외가 나고 견적까지 통째로 롤백된다.
  if jsonb_typeof(coalesce(p_expenses, 'null'::jsonb)) = 'array' and jsonb_array_length(p_expenses) > 0 then
    insert into public.quote_expenses (
      quote_id, item_name, unit_price, headcount, days, amount
    )
    select v_quote_id, x.item_name, x.unit_price,
           coalesce(x.headcount, 0), coalesce(x.days, 0), x.amount
    from jsonb_populate_recordset(null::public.quote_expenses, p_expenses) x;
  end if;

  -- 10. 수리 건 연결 — 같은 트랜잭션에 둔다. 해당 수리 건이 없어도 견적 저장을 되돌리지는 않는다
  --     (수리 건이 지워졌다고 견적을 버릴 이유는 없다). 대신 연결됐는지를 돌려줘 화면이 안내한다.
  if p_repair_id is not null then
    update public.repairs r
    set quote_id = v_quote_id
    where r.repair_id = p_repair_id;
    get diagnostics v_rows = row_count;
    v_linked := v_rows > 0;
  end if;

  -- 11. 화면이 PDF 생성·다음 미리보기 번호·수리 연결 안내에 쓰는 값.
  return query select v_quote_id, v_number, v_seq, v_linked;
end;
$$;

revoke execute on function public.create_quote(text, jsonb, jsonb, jsonb, integer) from public, anon;
grant execute on function public.create_quote(text, jsonb, jsonb, jsonb, integer) to authenticated;

-- ── 적용 확인 (읽기) ──
-- 함수에 새 칸 셋이 들어갔는가
--   기대: category 4 이상(quotes 칸·값, quote_items 칸·값), form_kind 2, group_kind 2
-- select
--   (select count(*) from regexp_matches(pg_get_functiondef(p.oid), '\mcategory\M', 'g'))   as category_hits,
--   (select count(*) from regexp_matches(pg_get_functiondef(p.oid), '\mform_kind\M', 'g'))  as form_kind_hits,
--   (select count(*) from regexp_matches(pg_get_functiondef(p.oid), '\mgroup_kind\M', 'g')) as group_kind_hits,
--   (select count(*) from regexp_matches(pg_get_functiondef(p.oid), '\msub_lines\M', 'g'))  as sub_lines_hits
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'create_quote';

-- 권한이 그대로인가(authenticated 에 EXECUTE 1행, public·anon 없음)
-- select r.rolname, has_function_privilege(r.rolname, p.oid, 'EXECUTE') as can_execute
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- cross join (select rolname from pg_roles where rolname in ('anon', 'authenticated', 'service_role')) r
-- where n.nspname = 'public' and p.proname = 'create_quote';

-- 교체 뒤 실제 저장 한 건으로 확인(앱에서 분류를 고르고 확정한 다음)
-- select quote_id, quote_number, category, form_kind from public.quotes
-- order by quote_id desc limit 5;
-- select quote_id, item_id, product_name, category, group_kind from public.quote_items
-- order by item_id desc limit 10;


-- ════════════════════════════════════════════════════════════════════════════
-- 되돌리기 — **역순으로 한 문장씩**
--
--   앱 코드를 먼저 되돌린다(새 코드가 이 칸들을 select 한다). 그 다음 아래를 역순으로.
-- ════════════════════════════════════════════════════════════════════════════
--
-- 단계 6 되돌리기 — quote_items_sublines_schema.sql 의 함수 정의를 **그대로 다시 실행**한다.
--   그 파일이 새 칸 없는 현재 함수의 정본이다.
--   ⚠ drop function 하지 마라 — 화면 저장이 즉시 멈춘다(견적을 아예 만들 수 없다).
--
-- 단계 5 되돌리기:
-- drop table if exists public.quote_template_items;
--
-- 단계 4 되돌리기(줄을 먼저 지운 뒤 머리):
-- drop table if exists public.quote_templates;
--   ※ 템플릿을 이미 쓰고 있다면 지우기 전에 내용을 떠 두어라:
--     select * from public.quote_templates;
--     select * from public.quote_template_items order by template_id, sort_order;
--
-- 단계 3 되돌리기:
-- alter table public.quote_items drop constraint if exists quote_items_group_kind_check;
-- alter table public.quote_items drop column if exists group_kind;
-- alter table public.quote_items drop constraint if exists quote_items_category_fkey;
-- comment on column public.quote_items.category is null;
--   ※ category 칸 자체는 **지우지 마라** — 개편 전부터 있던 칸이고 create_quote 의 insert
--     목록에 들어 있다. 지우면 함수 생성이 실패한다.
--
-- 단계 2 되돌리기:
-- alter table public.quotes drop constraint if exists quotes_form_kind_check;
-- alter table public.quotes drop constraint if exists quotes_category_fkey;
-- alter table public.quotes drop column if exists form_kind;
-- alter table public.quotes drop column if exists category;
--
-- 단계 1 되돌리기(quotes·quote_items·quote_templates 의 FK 를 모두 떼어낸 뒤에만 된다):
-- drop policy if exists "quote_categories_delete_superadmin" on public.quote_categories;
-- drop policy if exists "quote_categories_update_superadmin" on public.quote_categories;
-- drop policy if exists "quote_categories_insert_superadmin" on public.quote_categories;
-- drop policy if exists "quote_categories_select_authenticated" on public.quote_categories;
-- drop table if exists public.quote_categories;
--
--   ※ is_superadmin() · has_team_perm() 는 **되돌리지 않는다** — 다른 표의 정책이 쓴다.
