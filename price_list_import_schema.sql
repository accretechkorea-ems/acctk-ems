-- 가격표 등록(엑셀 업로드) 스키마 (2026-10-19 작성 · **2026-10-20 적용 완료**).
-- 단계 1 · 1b · 2 · 3 · 4 가 모두 DB 에 들어갔다. 이 파일은 이제 **적용 기록**이다 —
-- 다시 실행하지 마라(모두 멱등하게 써 두었지만 함수는 재생성된다).
-- 적용된 결과가 코드의 전제다: lib/priceListKinds.ts · lib/priceListParse.ts ·
-- app/api/price-list-import/route.ts 가 이 모양에 기대어 있다.
--
-- ════════════════════════════════════════════════════════════════════════════
-- 무엇을 위한 것인가
-- ════════════════════════════════════════════════════════════════════════════
--   일본 본사 가격표가 반년마다 새로 온다. 지금은 레포 루트의 upload_price_list.js 를
--   사람이 터미널에서 돌리는데, 그 스크립트는 **price_list 를 통째로 지우고 다시 넣는다**
--   (upload_price_list.js:131 `DELETE price_list?id=gte.0`).
--   이 파일은 그 방식을 버리고 **종류별 덮어쓰기**로 바꾸기 위한 DB 쪽 준비다.
--
--   담는 것은 셋이다.
--     단계 1  price_list.variant — 같은 품번을 두 줄로 저장하기 위한 구분 칸(CMM Jig 포함/제외)
--     단계 2  price_list_imports — 등록 이력 표
--     단계 3  apply_price_list_import() — 한 트랜잭션으로 반영하는 함수(RPC)
--
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠ price_list 의 행을 **지우지 마라** — 지난 견적이 그 행을 참조한다
-- ════════════════════════════════════════════════════════════════════════════
--   quote_items.price_list_id → price_list (quote_schema_snapshot.sql:17).
--   ON DELETE 가 적혀 있지 않으니 NO ACTION 이다 — 참조된 행을 지우려 하면 **오류가 난다.**
--   즉 upload_price_list.js 의 전체 삭제는 지금 DB 에서 실패하거나(FK 위반),
--   성공한다면 그만큼 견적-가격표 연결이 끊어진다는 뜻이다.
--   그래서 이 파일의 함수는 **지우지 않는다.** 덮어쓰거나 새로 넣기만 한다
--   (확정 정책 4: 파일에 없는 기존 품목은 유지한다).
--
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠ 덮어쓰기는 **지난 견적의 화면 표시 글자**를 바꾼다 (금액은 안 바뀐다)
-- ════════════════════════════════════════════════════════════════════════════
--   금액은 안전하다 — quote_items 가 저장 시점의 값을 **자기 칸에 복사**해 둔다
--   (part_code · unit_price_jpy · unit_price_krw · supply_amount · cost_amount ·
--    exchange_rate · tariff_rate · profit_amount · profit_rate. 쓰는 곳은 create_quote 뿐이고
--    생성 뒤 update 하는 코드가 레포에 없다). 가격표를 고쳐도 지난 견적의 금액·PDF 는 그대로다.
--
--   다만 **품목 이름**은 다르다. 실적 현황·대시보드 목록이 품목명을 이렇게 읽는다 —
--     app/sales/page.tsx:1433        quote_items(product_name, row_kind, price_list(model_jp))
--     app/sales/page.tsx:979         i.price_list?.model_jp || i.product_name
--     components/dashboard/MyQuotesPanel.tsx:211,79  (같은 방식)
--   **가격표의 현재 글자를 먼저** 쓰고 없을 때만 저장된 product_name 으로 떨어진다.
--   그래서 model_jp 를 덮어쓰면 **지난 견적 목록에 보이는 품목명도 함께 바뀐다.**
--   이것은 이 파일이 아니라 저 화면들의 읽기 방식 문제다. 이번 단계에서는 고치지 않고
--   사실만 적어 둔다(고치려면 저 세 자리를 product_name 우선으로 바꾸면 된다).
--
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠ 사람이 손으로 채운 칸은 덮지 않는다
-- ════════════════════════════════════════════════════════════════════════════
--   delivery_time(납기) 과 stock_quantity(재고) 는 엑셀에 없는 값이다.
--   납기는 delivery_time_update.sql 이 품번 450여 개에 손으로 넣어 둔 값이고,
--   재고도 화면에서 쓰는 운영값이다(app/quote/QuoteItemRow.tsx:177-192 가 둘을 읽어
--   「재고 N개」·「발주 후 N주」·「담당자 납기 문의」 배지를 고른다).
--   단계 3 의 함수는 이 두 칸과 item_name_en · model_en · note*_en 을 **건드리지 않는다.**
--   엑셀에서 온 칸만 덮는다: plnt · grp · item_name_jp · model_jp · note1~3_jp ·
--   price_jpy · cost_jpy · updated_at.
--
-- ════════════════════════════════════════════════════════════════════════════
-- 적용 순서
-- ════════════════════════════════════════════════════════════════════════════
--   단계 0 (읽기)  — **먼저 실행한다.** 일곱 가지를 눈으로 확인한다.
--                    예상과 다르면 **멈추고** 이 파일을 고친 뒤 단계 1 로 간다.
--                    이 파일은 DB 를 조회하지 않고 레포의 기록(스냅샷·스크립트·화면 코드)만
--                    보고 썼다. price_list 의 DDL 은 레포에 없어서 **추정한 부분이 있다.**
--   단계 1 (칸 추가)      — 코드 배포보다 먼저. 화면·함수가 variant 를 쓴다.
--   단계 1b (유일 인덱스)  — 단계 0 ⑤ 가 0행이라 걸었다.
--   단계 2 (이력 표)      — 아무 때나.
--   단계 3 (함수)         — 단계 1 뒤.
--   단계 4 (템플릿 칸)     — 장비 템플릿이 Jig 구분을 잃지 않게. 아무 때나.
--   단계 5 (코드 배포)    — 가격표 2단계의 화면·API. **단계 1~4 뒤에** 올린다.
--
--   순서를 어기면:
--     단계 1 없이 단계 3 → 함수가 variant 를 몰라 **생성에서 실패한다**(오류가 나니 안전하다).
--     단계 1 없이 코드 배포 → 등록 화면이 variant 를 보내도 저장되지 않는다.
--
-- 적용 후 확인 쿼리는 각 단계 바로 아래에, 되돌리기는 파일 맨 아래에 모아 두었다.


-- ════════════════════════════════════════════════════════════════════════════
-- 단계 0 (읽기). 전제 확인 — 실행 결과 요약 (2026-10-20)
--
--   아래 쿼리를 돌려 확인한 결과다. **코드가 이 값을 전제로 쓰여 있다.**
--     ① variant 칸은 없었다(단계 1 에서 추가).
--        price_list.updated_at 은 **text**('YYYY-MM-DD' 글자). cost_jpy·price_jpy 는 **integer**.
--        → 함수는 updated_at 에 v_today 글자를 넣고, 가격은 미리 반올림한다(위 1-b).
--        → 파서도 정수로 반올림해 보낸다(lib/priceListParse.ts).
--     ② item_code 단독 유일 제약은 없었다 → 두 줄 저장(Jig)이 가능하다.
--     ③ price_list 의 anon 쓰기는 막혀 있다. 쓰기는 서버(service role)만 — 새 라우트가 그렇게 한다.
--     ④ 지금 들어 있는 종류는 **4개**다: SFG Accessory · CMM Accessory ·
--        SFG Spare part · CMM Spare. SFG Main · CMM Main body · Calibration 은 **아직 없다**
--        (첫 등록이 곧 신규 전량이 된다 — 미리보기의 「신규」 건수가 그만큼 크게 나온다).
--     ⑤ 같은 종류 안의 품번 중복은 없었다 → 단계 1b 유일 인덱스가 걸렸다.
-- ════════════════════════════════════════════════════════════════════════════

-- ① price_list 의 칸·타입·NOT NULL·기본값
--    확인할 것:
--      · variant 라는 칸이 **아직 없어야** 한다(있으면 단계 1 을 건너뛰고 뜻을 확인한다).
--      · updated_at 의 타입. 단계 3 의 함수는 now() 를 넣는다. date 면 날짜로 잘려 들어가고
--        timestamptz 면 시각까지 들어간다 — 둘 다 동작하지만 어느 쪽인지 알고 있어야 한다.
--        (upload_price_list.js:106 은 'YYYY-MM-DD' 문자열을 넣는다 → date 일 가능성이 높다.)
--      · 기본값 없는 NOT NULL 칸이 id 말고 또 있는지. 있으면 단계 3 의 insert 목록에 넣어야 한다.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'price_list'
order by ordinal_position;

-- ② 제약·인덱스 — 품번에 유일 제약이 있는가
--    기대: item_code 단독 유일 제약은 **없다.**
--    근거 — SFG Spare 와 CMM Spare 에 같은 품번이 313건 겹친다(사용자 확인).
--           있었다면 지금 데이터가 들어가 있을 수 없다.
--    여기서 (sheet_name, item_code) 유일 제약이 나오면 단계 1b 는 이미 충족된 것이고,
--    item_code 단독 유일 제약이 나오면 **멈춰라** — 두 줄 저장(Jig)이 불가능하므로
--    그 제약을 떼는 작업을 따로 계획해야 한다.
select conname, contype, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.price_list'::regclass
order by contype, conname;

select indexname, indexdef from pg_indexes
where schemaname = 'public' and tablename = 'price_list'
order by indexname;

-- ③ RLS 정책 — 쓰기 정책이 열려 있는가
--    기대: SELECT 정책 하나(price_list_select_authenticated)뿐.
--    ⚠ upload_price_list.js 는 **anon 키로** price_list 를 지우고 넣는다. 그게 통했다면
--      쓰기 정책이 열려 있거나 RLS 가 꺼져 있다는 뜻이다. 열려 있으면 이번 기회에 닫는 것이
--      맞다(쓰기는 서버 service role 만). 여기서 나온 결과를 보고 판단한다 — 이 파일은
--      기존 정책을 건드리지 않는다.
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'price_list'
order by cmd, policyname;

select relrowsecurity from pg_class where oid = 'public.price_list'::regclass;

-- ④ sheet_name 에 무엇이 들어 있는가 — 확정 정책의 종류 7개와 글자가 같아야 한다
--    기대하는 7개: SFG Main / CMM Main body / SFG Accessory / CMM Accessory /
--                  SFG Spare part / CMM Spare / Calibration
--    (upload_price_list.js:140 은 엑셀 시트 이름을 **그대로** sheet_name 에 넣는다.
--     그래서 지금 값은 지난번 파일의 시트 이름이다. 공백·대소문자가 다르면 등록 화면의
--     종류 목록을 그 글자에 맞춰야 한다 — 다른 글자로 넣으면 같은 종류가 둘로 갈린다.)
select sheet_name, count(*) as 행수,
       count(*) filter (where cost_jpy is null) as 구입가없음,
       count(*) filter (where price_jpy is null) as 정가없음
from public.price_list
group by sheet_name
order by sheet_name;

-- ⑤ 같은 종류 안에 같은 품번이 이미 둘 이상 있는가
--    여기서 0 행이 나와야 단계 1b 의 유일 인덱스를 걸 수 있다.
--    0 이 아니면 — 단계 1b 를 **건너뛴다**(함수는 유일 인덱스 없이도 돈다).
--    다만 그 중복은 등록 화면에서 어느 줄을 덮을지 정할 수 없으므로 먼저 정리하는 것이 맞다.
select sheet_name, item_code, count(*) as 줄수
from public.price_list
group by sheet_name, item_code
having count(*) > 1
order by 줄수 desc, sheet_name, item_code
limit 50;

-- ⑥ 구입가가 없는 행이 이미 몇 건인가
--    확정 정책 3 은 구입가 없는 행을 **등록하지 않는다.** 이미 들어 있는 행은 그대로 둔다
--    (지우면 FK 때문에 막히고, 지난 견적의 연결도 끊긴다).
--    견적 화면은 구입가가 없어도 깨지지 않는다 — calcRow 의 마지막 분기가 금액을 전부 0 으로
--    두고(app/quote/calc.ts), 검색 결과 줄은 「구입가: ¥」로 빈칸만 보인다(NaN 은 나오지 않는다).
select count(*) as 구입가없는행 from public.price_list where cost_jpy is null;

-- ⑦ 견적이 참조하는 가격표 행 수 — 삭제가 왜 불가능한지 숫자로 본다
select count(distinct price_list_id) as 참조되는_가격표행,
       count(*) as 참조하는_견적품목줄
from public.quote_items
where price_list_id is not null;


-- ════════════════════════════════════════════════════════════════════════════
-- 단계 1 [적용 완료 2026-10-20]. price_list.variant — 같은 품번을 두 줄로 저장하기 위한 구분 칸
--
--   CMM Main body 는 Net price 가 두 열이다(Jig 포함 / Jig 제외).
--   확정 정책 6: **같은 품번을 두 줄로 저장하고** 견적 검색에서 둘 다 나오게 한다.
--   품번(item_code)은 PDF 품번 칸에 그대로 나가므로 **절대 바꾸지 않는다.**
--   그래서 줄을 가르는 값을 **따로 둔다.**
--
--   ── 왜 null 허용이 아니라 not null default '' 인가 ────────────────────────
--     유일 인덱스에서 NULL 은 서로 같지 않다. variant 가 null 이면
--     (sheet_name, item_code, variant) 유일 인덱스가 **같은 품번을 몇 줄이든 받아 준다** —
--     막으려던 중복을 그대로 통과시킨다. 빈 문자열은 서로 같으므로 그 구멍이 없다.
--     (PostgreSQL 15 의 `nulls not distinct` 로도 되지만, 버전에 기대지 않는 쪽을 골랐다.)
--     코드에서는 '' 과 null 을 같은 뜻(구분 없음)으로 읽으면 된다.
--
--   ── 위험 ──────────────────────────────────────────────────────────────────
--     낮다. 칸을 더하기만 한다. 기본값이 상수라 PostgreSQL 11+ 에서는 표를 다시 쓰지 않고
--     카탈로그만 고친다(수천 행이라 어차피 금방이다).
--     기존 행은 전부 variant = '' 가 되고, 기존 조회·검색은 이 칸을 읽지 않으므로 영향이 없다.
--   ── 되돌리기 ── 파일 맨 아래 「단계 1 되돌리기」.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.price_list
  add column if not exists variant text not null default '';

comment on column public.price_list.variant is
  '같은 종류·같은 품번을 여러 줄로 둘 때의 구분값. 빈 문자열이 「구분 없음」이다. '
  'CMM Main body 의 Net price 두 열에 jig_in(Jig 포함) · jig_out(Jig 제외) 를 쓴다. '
  '품번(item_code)은 PDF 에 그대로 나가는 값이라 구분을 품번에 섞지 않는다.';

-- ── 적용 확인 (읽기) ──
-- 칸이 생겼고 기존 행이 모두 '' 인가
-- select count(*) as 전체, count(*) filter (where variant = '') as 빈값
-- from public.price_list;


-- ════════════════════════════════════════════════════════════════════════════
-- 단계 1b [적용 완료 2026-10-20]. (종류, 품번, 구분) 유일 인덱스
--
--   ⚠ 단계 0 ⑤ 가 **0 행일 때만** 실행한다. 중복이 있으면 이 문장은 실패한다
--     (실패해도 표는 그대로다 — 인덱스만 안 생긴다).
--   ⚠ 걸지 않아도 단계 3 의 함수는 동작한다. 함수는 on conflict 가 아니라
--     「먼저 update, 없으면 insert」 방식이고 같은 종류에 대해 advisory lock 을 잡는다.
--     이 인덱스는 **사고로 같은 줄이 둘 생기는 것을 DB 가 막아 주는** 안전망이고,
--     덤으로 함수의 update·insert 조회가 빨라진다.
--
--   ── 위험 ──────────────────────────────────────────────────────────────────
--     중간 수준. 유일 인덱스는 **앞으로의 삽입도 막는다.** 지금까지 같은 종류 안에서 같은
--     품번을 여러 줄 쓰고 있었다면(예: Calibration 의 섹션 중복) 그 운영이 막힌다.
--     그래서 선택 단계로 두었다. 운영 중 멈춤이 걱정되면 concurrently 쪽을 쓴다
--     (단, create index concurrently 는 트랜잭션 안에서 돌지 않는다 — 한 문장만 따로 실행).
--   ── 되돌리기 ── drop index (파일 맨 아래).
-- ════════════════════════════════════════════════════════════════════════════

create unique index if not exists price_list_sheet_code_variant_key
  on public.price_list (sheet_name, item_code, variant);

-- 운영 중 멈춤이 걱정되면 위 대신 이것(한 문장만 따로 실행):
-- create unique index concurrently if not exists price_list_sheet_code_variant_key
--   on public.price_list (sheet_name, item_code, variant);

-- ── 적용 확인 (읽기) ──
-- select indexname, indexdef from pg_indexes
-- where schemaname = 'public' and tablename = 'price_list'
--   and indexname = 'price_list_sheet_code_variant_key';


-- ════════════════════════════════════════════════════════════════════════════
-- 단계 2 [적용 완료 2026-10-20]. 등록 이력 표 price_list_imports
--
--   언제 누가 어떤 파일로 무엇을 바꿨는지 남긴다. 되돌리기 기능은 두지 않는다
--   (확정 정책에 없다) — 이력은 **읽기 전용 기록**이다.
--   파일의 「Valid date …」 문구도 여기 메모로 남는다(확정 정책 5).
--
--   ── 권한 ──────────────────────────────────────────────────────────────────
--     조회: superadmin 만. 쓰기: 정책도 GRANT 도 주지 않는다 — 서버(service role)만 쓴다.
--     quote_templates 와 같은 방식이다(quote_category_template_schema.sql 단계 4).
--     ※ public 에 새 표를 만들면 이벤트 트리거 rls_auto_enable 이 RLS 를 켠다
--       (db_functions_snapshot.sql:76). 아래 enable 문장은 그래도 명시해 둔다 — 두 번 켜도 무해하다.
--   ── 위험 ── 낮다. 새 표 하나. 기존 객체를 건드리지 않는다.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.price_list_imports (
  import_id       bigint generated always as identity primary key,
  -- 어떤 종류(시트)를 올렸는가. price_list.sheet_name 과 같은 글자를 넣는다.
  sheet_name      text not null,
  -- 올린 엑셀 파일 이름(경로 없이 이름만).
  file_name       text not null,
  -- 파일 맨 위의 「Valid date : From … to …」 문구를 그대로. 기능은 없고 기록용이다.
  valid_text      text,
  -- 건수 넷. 함수가 센 값이 그대로 들어온다.
  inserted_count  integer not null default 0,   -- 새로 들어간 품번
  updated_count   integer not null default 0,   -- 값이 달라 덮어쓴 품번
  unchanged_count integer not null default 0,   -- 이미 같아서 그대로 둔 품번
  skipped_count   integer not null default 0,   -- 구입가가 없거나 품번이 빈 줄(등록 제외)
  -- 적용한 사람. engineers 를 참조하되 사람이 지워져도 이력은 남게 on delete set null.
  applied_by      integer references public.engineers(engineer_id) on delete set null,
  applied_at      timestamptz not null default now(),
  -- 나중에 쓸 메모 칸(지금은 함수가 넣지 않는다).
  note            text
);

comment on table public.price_list_imports is
  '가격표 엑셀 등록 이력. 종류(시트) 하나가 한 줄이다. 되돌리기 기능은 없고 기록만 남긴다.';

create index if not exists price_list_imports_sheet_at_idx
  on public.price_list_imports (sheet_name, applied_at desc);

alter table public.price_list_imports enable row level security;

drop policy if exists "price_list_imports_select_superadmin" on public.price_list_imports;
create policy "price_list_imports_select_superadmin"
on public.price_list_imports for select to authenticated
using ((select public.is_superadmin()));

grant select on public.price_list_imports to authenticated;
-- insert/update/delete GRANT 는 주지 않는다 — 정책도 없고 권한도 없어 두 겹으로 막힌다.
-- 서버 라우트(service role)와 단계 3 의 함수(security definer)는 둘 다 우회한다.

-- ── 적용 확인 (읽기) ──
-- select column_name, data_type, is_nullable, column_default
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'price_list_imports'
-- order by ordinal_position;
--
-- RLS 가 켜졌고 정책이 하나인가
-- select relrowsecurity from pg_class where oid = 'public.price_list_imports'::regclass;
-- select policyname, cmd from pg_policies
-- where schemaname = 'public' and tablename = 'price_list_imports';


-- ════════════════════════════════════════════════════════════════════════════
-- 단계 3 [적용 완료 2026-10-20]. 적용 함수 apply_price_list_import()
--
--   종류 하나와 행 배열(jsonb)을 받아 **한 트랜잭션**으로 반영하고 건수를 돌려준다.
--   함수 하나가 통째로 성공하거나 통째로 실패한다(확정 정책 8) — 중간 상태가 남지 않는다.
--
--   ── 하는 일 ───────────────────────────────────────────────────────────────
--     1. 입력 검사(종류·배열·행 수 상한).
--     2. 같은 종류에 대해 advisory lock — 두 사람이 동시에 적용하는 것을 막는다.
--     3. 받은 행을 임시표로 펼친다. **종류(sheet_name)는 서버가 덮어쓴다** — 본문 값을 믿지 않는다.
--     4. 품번이 비었거나 구입가가 없는 줄을 버리고 센다(확정 정책 3).
--     5. 같은 (품번, 구분)이 **값이 다르게** 두 번 들어 있으면 **전체를 중단**한다
--        (Calibration 의 KA00202C 같은 경우. 값이 같은 중복은 하나로 합친다).
--     6. 달라진 줄만 update, 없는 줄은 insert. **지우는 문장은 없다.**
--     7. 이력 한 줄을 남기고 건수를 돌려준다.
--
--   ── 호출자 검증은 왜 함수가 하지 않는가 ───────────────────────────────────
--     이 함수는 service role 로만 부를 수 있다. service role 에는 auth.uid()·auth.jwt() 가
--     없어서(로그인 사용자가 아니다) 함수 안에서 「누가 불렀는지」를 알 수 없다.
--     그래서 **서버 라우트가** 세션으로 superadmin 을 확인하고(app/api/office/route.ts 와 같은
--     방식: createServerClient → auth.getUser → engineers 조회 → isSuperAdmin),
--     applied_by 도 **세션에서 꺼내** 넘긴다. 함수는 받은 값을 그대로 기록한다.
--     확정 정책 1(관리자만)은 그 라우트가 지킨다.
--
--   ── 안 건드리는 칸 ────────────────────────────────────────────────────────
--     delivery_time · stock_quantity · item_name_en · model_en · note1~3_en.
--     엑셀에 없는 값이고 사람이 손으로 채운 값이다(파일 머리말 참조).
--
--   ── 위험 ──────────────────────────────────────────────────────────────────
--     중간 수준. 최대 5,000행을 한 트랜잭션에서 update·insert 한다.
--     · 실패하면 전부 롤백된다 — 중간 상태는 남지 않는다.
--     · 긴 트랜잭션 동안 그 행들에 잠금이 걸린다(수천 행이면 1~2초 수준).
--     · security definer 라 RLS 를 우회한다. 그래서 **권한을 service_role 에만** 준다.
--   ── 되돌리기 ── drop function (파일 맨 아래). 함수를 지워도 데이터는 그대로다.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.apply_price_list_import(
  p_sheet_name text,
  p_file_name  text,
  p_valid_text text,
  p_applied_by integer,
  p_rows       jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total     integer;
  v_skipped   integer := 0;
  v_dedup     integer := 0;
  v_matched   integer := 0;
  v_updated   integer := 0;
  v_inserted  integer := 0;
  v_unchanged integer := 0;
  v_conflict  text;
  v_import_id bigint;
  -- updated_at 은 **text 칸**이고 'YYYY-MM-DD' 글자가 들어 있다(단계 0 ① 에서 확인).
  -- now() 를 그대로 넣으면 '2026-10-20 14:03:11.123+09' 같은 글자가 섞여 기존 값과 모양이 달라진다.
  -- 그래서 한국 날짜 글자를 한 번 만들어 두고 그 값을 넣는다(한 번의 적용은 한 날짜다).
  v_today     text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD');
  -- 소수가 섞인 가격을 반올림한 행 배열(아래 1-b).
  v_rows      jsonb;
begin
  -- 1. 입력 검사 ------------------------------------------------------------
  if p_sheet_name is null or btrim(p_sheet_name) = '' then
    raise exception '종류가 비어 있습니다.';
  end if;
  if p_file_name is null or btrim(p_file_name) = '' then
    raise exception '파일 이름이 비어 있습니다.';
  end if;
  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' then
    raise exception '행 목록이 배열이 아닙니다.';
  end if;
  v_total := jsonb_array_length(p_rows);
  if v_total = 0 then
    raise exception '등록할 행이 없습니다.';
  end if;
  -- 한 시트가 1,000행 안팎이다. 20,000 은 사고(같은 파일을 여러 번 붙여 보낸 경우)를 막는 선이다.
  if v_total > 20000 then
    raise exception '한 번에 등록할 수 있는 행은 20,000개까지입니다 (받은 행 %).', v_total;
  end if;

  -- 1-b. 소수 반올림 ---------------------------------------------------------
  --    price_jpy·cost_jpy 는 integer 칸이다. 엑셀에 소수가 섞여 있으면(환산값·수식 결과)
  --    integer 대입에서 PostgreSQL 이 알아서 반올림하지만, **여기서 먼저 반올림한다.**
  --    화면 미리보기가 보여 준 숫자와 저장된 숫자가 어긋나면 안 되기 때문이다
  --    (화면도 같은 규칙으로 반올림한다 — lib/priceListParse.ts).
  --    ⚠ 숫자가 아닌 값("1,000" 같은 문자열)은 **그대로 둔다.** 조용히 고쳐 주면 잘못 읽은
  --      열을 그대로 저장하게 된다. 아래 jsonb_populate_recordset 에서 오류가 나고 전체가 롤백된다.
  select jsonb_agg(
           case when jsonb_typeof(r) <> 'object' then r
                else r
                  || case when jsonb_typeof(r -> 'price_jpy') = 'number'
                          then jsonb_build_object('price_jpy', round((r ->> 'price_jpy')::numeric))
                          else '{}'::jsonb end
                  || case when jsonb_typeof(r -> 'cost_jpy') = 'number'
                          then jsonb_build_object('cost_jpy', round((r ->> 'cost_jpy')::numeric))
                          else '{}'::jsonb end
           end
         )
    into v_rows
  from jsonb_array_elements(p_rows) r;

  -- 2. 같은 종류에 대한 동시 적용 방지 --------------------------------------
  --    트랜잭션이 끝나면(성공이든 실패든) 저절로 풀린다.
  perform pg_advisory_xact_lock(hashtext('price_list_import:' || p_sheet_name));

  -- 3. 받은 행을 임시표로 ----------------------------------------------------
  --    **price_list 의 행 타입을 그대로 쓴다.** 칸 타입을 여기서 다시 적지 않아야
  --    표의 타입이 바뀌어도 이 함수가 어긋나지 않는다(create_quote 와 같은 방식).
  --    모르는 키는 버려지고, 없는 키는 null 이 된다.
  --    ⚠ 숫자 칸(price_jpy·cost_jpy)은 **숫자로** 보내야 한다. "1,000" 처럼 쉼표가 섞인
  --      문자열은 여기서 타입 변환 오류가 나고 전체가 롤백된다(서버에서 쉼표를 털어 보낸다).
  --    같은 트랜잭션에서 두 번 불리는 경우를 대비해 먼저 떨어낸다.
  drop table if exists tmp_price_import;
  create temporary table tmp_price_import on commit drop as
    select * from jsonb_populate_recordset(null::public.price_list, coalesce(v_rows, p_rows));

  -- 종류는 서버가 정한다 — 본문에 다른 종류가 섞여 와도 이 한 줄이 덮는다
  -- (확정 정책 4: 다른 종류의 행은 건드리지 않는다).
  -- 품번·구분은 앞뒤 공백을 털고, 구분이 비면 빈 문자열로 맞춘다.
  update tmp_price_import
     set sheet_name = p_sheet_name,
         item_code  = btrim(item_code),
         variant    = coalesce(btrim(variant), '');

  -- 4. 등록하지 않을 줄을 버린다(확정 정책 3) --------------------------------
  --    구입가(cost_jpy)가 없는 줄과 품번이 빈 줄. 미리보기에서 이미 사람에게 보여 준 줄이다.
  delete from tmp_price_import
   where item_code is null or item_code = '' or cost_jpy is null;
  get diagnostics v_skipped = row_count;

  if (select count(*) from tmp_price_import) = 0 then
    raise exception '등록할 수 있는 행이 없습니다 (구입가가 있는 줄이 하나도 없습니다).';
  end if;

  -- 5. 한 파일 안의 같은 품번 처리 -------------------------------------------
  --    ⓐ 값까지 같은 중복 → 하나로 합친다.
  --    ⓑ 값이 다른 중복   → 어느 쪽이 맞는지 기계가 고를 수 없다. **중단한다.**
  --       (Calibration 시트는 섹션이 나뉘어 있어 같은 품번이 두 번 나오는 일이 있다.)
  select string_agg(item_code || case when variant <> '' then ' / ' || variant else '' end, ', ')
    into v_conflict
  from (
    select item_code, variant
    from tmp_price_import
    group by item_code, variant
    having count(distinct
      coalesce(cost_jpy::text, '') || '|' || coalesce(price_jpy::text, '') || '|' ||
      coalesce(item_name_jp, '')   || '|' || coalesce(model_jp, '')) > 1
    order by item_code
    limit 20
  ) d;
  if v_conflict is not null then
    raise exception '같은 품번이 서로 다른 값으로 여러 번 들어 있습니다: % — 파일을 고친 뒤 다시 올려 주세요.', v_conflict;
  end if;

  -- 값이 같은 중복만 남았다. 한 줄만 남긴다.
  delete from tmp_price_import t
   using tmp_price_import u
   where t.ctid > u.ctid
     and t.item_code = u.item_code
     and t.variant   = u.variant;
  get diagnostics v_dedup = row_count;

  -- 6. 반영 ------------------------------------------------------------------
  --    먼저 「이미 있는 줄」이 몇 개인지 센다. 덮어쓴 수를 빼면 「그대로인 수」가 나온다.
  select count(*) into v_matched
  from tmp_price_import t
  join public.price_list p
    on p.sheet_name = t.sheet_name
   and p.item_code  = t.item_code
   and p.variant    = t.variant;

  --    달라진 줄만 덮어쓴다. 값이 같으면 updated_at 도 그대로 둔다
  --    (언제 실제로 바뀌었는지를 남기기 위해서다).
  --    updated_at 은 text 칸이라 v_today('YYYY-MM-DD')를 넣는다 — 기존 값과 같은 모양이다.
  update public.price_list p
     set plnt         = t.plnt,
         grp          = t.grp,
         item_name_jp = t.item_name_jp,
         model_jp     = t.model_jp,
         note1_jp     = t.note1_jp,
         note2_jp     = t.note2_jp,
         note3_jp     = t.note3_jp,
         price_jpy    = t.price_jpy,
         cost_jpy     = t.cost_jpy,
         updated_at   = v_today
  from tmp_price_import t
  where p.sheet_name = t.sheet_name
    and p.item_code  = t.item_code
    and p.variant    = t.variant
    and (p.plnt         is distinct from t.plnt
      or p.grp          is distinct from t.grp
      or p.item_name_jp is distinct from t.item_name_jp
      or p.model_jp     is distinct from t.model_jp
      or p.note1_jp     is distinct from t.note1_jp
      or p.note2_jp     is distinct from t.note2_jp
      or p.note3_jp     is distinct from t.note3_jp
      or p.price_jpy    is distinct from t.price_jpy
      or p.cost_jpy     is distinct from t.cost_jpy);
  get diagnostics v_updated = row_count;

  --    없는 줄을 넣는다. delivery_time·stock_quantity·*_en 은 목록에 없다 — 기본값으로 남는다.
  insert into public.price_list (
    sheet_name, item_code, variant, plnt, grp,
    item_name_jp, model_jp, note1_jp, note2_jp, note3_jp,
    price_jpy, cost_jpy, updated_at
  )
  select t.sheet_name, t.item_code, t.variant, t.plnt, t.grp,
         t.item_name_jp, t.model_jp, t.note1_jp, t.note2_jp, t.note3_jp,
         t.price_jpy, t.cost_jpy, v_today
  from tmp_price_import t
  where not exists (
    select 1 from public.price_list p
     where p.sheet_name = t.sheet_name
       and p.item_code  = t.item_code
       and p.variant    = t.variant
  );
  get diagnostics v_inserted = row_count;

  v_unchanged := v_matched - v_updated;

  -- 7. 이력 ------------------------------------------------------------------
  insert into public.price_list_imports (
    sheet_name, file_name, valid_text,
    inserted_count, updated_count, unchanged_count, skipped_count, applied_by
  ) values (
    p_sheet_name, p_file_name, p_valid_text,
    v_inserted, v_updated, v_unchanged, v_skipped, p_applied_by
  )
  returning import_id into v_import_id;

  return jsonb_build_object(
    'import_id', v_import_id,
    'sheet_name', p_sheet_name,
    'received',  v_total,      -- 받은 줄
    'skipped',   v_skipped,    -- 구입가 없음·품번 없음으로 제외한 줄
    'merged',    v_dedup,      -- 값이 같아 하나로 합친 중복 줄
    'inserted',  v_inserted,   -- 새로 넣은 줄
    'updated',   v_updated,    -- 덮어쓴 줄
    'unchanged', v_unchanged   -- 이미 같아서 그대로 둔 줄
  );
end;
$$;

comment on function public.apply_price_list_import(text, text, text, integer, jsonb) is
  '가격표 엑셀 한 시트를 한 트랜잭션으로 반영한다. 지우지 않고 덮어쓰거나 새로 넣는다. '
  '호출자 검증(superadmin)과 applied_by 는 서버 라우트가 세션으로 정해 넘긴다.';

-- 권한 — service_role 에만 준다.
-- Supabase 에서 함수를 만들면 public 에 execute 가 기본으로 붙는다. 그래서 먼저 뗀다.
revoke execute on function public.apply_price_list_import(text, text, text, integer, jsonb) from public, anon, authenticated;
grant  execute on function public.apply_price_list_import(text, text, text, integer, jsonb) to service_role;

-- ── 적용 확인 (읽기) ──
-- 함수가 security definer 이고 search_path 가 public 인가
-- select p.proname, p.prosecdef, p.proconfig, pg_get_function_identity_arguments(p.oid) as args
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'apply_price_list_import';
--
-- 권한이 service_role 에만 있는가(anon·authenticated 가 나오면 안 된다)
-- select grantee, privilege_type
-- from information_schema.routine_privileges
-- where routine_schema = 'public' and routine_name = 'apply_price_list_import';
--
-- ── 손으로 한 번 시험하려면 (⚠ 실제로 price_list 를 바꾼다. 시험용 종류 이름을 쓴다) ──
-- select public.apply_price_list_import(
--   'ZZ Test', 'test.xlsx', 'Valid date : test', null,
--   '[{"item_code":"TEST-001","variant":"","item_name_jp":"시험","model_jp":"시험 규격","cost_jpy":1000,"price_jpy":2000}]'::jsonb
-- );
-- 확인: select * from public.price_list where sheet_name = 'ZZ Test';
-- 같은 문장을 한 번 더 실행하면 unchanged 가 1 이어야 한다(두 번 넣지 않는다).
-- 정리:   delete from public.price_list where sheet_name = 'ZZ Test';
--         delete from public.price_list_imports where sheet_name = 'ZZ Test';


-- ════════════════════════════════════════════════════════════════════════════
-- 단계 4 [적용 완료 2026-10-20]. quote_template_items.variant
--
--   장비 구성 템플릿은 **품번만** 저장하고 열 때 가격표에서 원가를 다시 찾는다.
--   그런데 같은 품번이 Jig 포함/제외로 **두 줄**이 되면, 품번만으로는 어느 줄이었는지
--   알 수 없다(불러올 때 아무 쪽이나 걸린다). 그래서 템플릿 줄에도 구분을 함께 저장한다.
--
--   이미 저장된 템플릿은 전부 '' 가 된다 — 「구분 없음」이고, 종전과 똑같이 동작한다.
--   읽는 쪽 규칙(lib/quoteTemplates.ts · components/quote/equip/useEquipConfig.ts):
--     (item_code, variant) 짝으로 가격표를 찾고, 같은 짝이 여러 종류에 있으면
--     sheet_name 오름차순의 첫 줄을 쓴다(같은 부품이라 값이 같고, 늘 같은 쪽이 골라진다).
--
--   ── 위험 ── 낮다. 칸 추가뿐이고 기본값이 상수다. 기존 조회는 이 칸을 읽지 않는다.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.quote_template_items
  add column if not exists variant text not null default '';

comment on column public.quote_template_items.variant is
  'price_list.variant 와 같은 뜻의 구분값. 빈 문자열이 「구분 없음」이다. '
  '품번만으로는 Jig 포함/제외 두 줄을 가릴 수 없어 함께 저장한다.';

-- ── 적용 확인 (읽기) ──
-- select column_name, data_type, is_nullable, column_default
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'quote_template_items' and column_name = 'variant';


-- ════════════════════════════════════════════════════════════════════════════
-- 되돌리기 — 역순으로 실행한다
-- ════════════════════════════════════════════════════════════════════════════

-- 단계 4 되돌리기:
--   ⚠ 이 칸을 지우면 템플릿이 Jig 포함/제외를 다시 잃는다(줄은 남는다).
--     지우기 전에 무엇이 들어 있는지 본다:
--       select template_id, part_code, variant from public.quote_template_items
--       where variant <> '' order by template_id;
--   alter table public.quote_template_items drop column if exists variant;

-- 단계 3 되돌리기 (함수만 없어진다. 데이터는 그대로다):
--   drop function if exists public.apply_price_list_import(text, text, text, integer, jsonb);

-- 단계 2 되돌리기 (이력이 사라진다 — 지우기 전에 내보내 둘지 생각한다):
--   drop policy if exists "price_list_imports_select_superadmin" on public.price_list_imports;
--   drop index if exists public.price_list_imports_sheet_at_idx;
--   drop table if exists public.price_list_imports;

-- 단계 1b 되돌리기:
--   drop index if exists public.price_list_sheet_code_variant_key;

-- 단계 1 되돌리기:
--   ⚠ 이 칸을 지우면 Jig 포함/제외로 나뉘어 들어간 줄의 **구분이 사라진다.**
--     같은 품번 두 줄이 구별되지 않는 상태로 남는다(줄 자체는 지워지지 않는다).
--     이미 등록을 한 번이라도 돌린 뒤라면, 지우기 전에 아래로 무엇이 묶여 있는지 먼저 본다.
--       select sheet_name, item_code, variant, cost_jpy
--       from public.price_list where variant <> '' order by sheet_name, item_code;
--   alter table public.price_list drop column if exists variant;
