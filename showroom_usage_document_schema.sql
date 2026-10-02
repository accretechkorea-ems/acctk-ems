-- 쇼룸 사용 기록 → 전자결재 문서 연결 (미적용. 실행 전에 아래를 끝까지 읽어라).
--
-- 왜 필요한가
--   showroom_usage.request_id 는 **옛 요청함 표**(approval_requests)를 가리키는 FK 다. 4단계에서
--   승인 경로가 전자결재로 옮겨진 뒤 새로 만들어지는 기록은 이 칸이 늘 null 이고
--   (app/api/showroom/requests/shared.ts 의 createUsageFromRequest — 「전자결재 건은 null」),
--   그래서 사용 기록 목록·엑셀에서 「신청」 배지·승인자·승인일시·승인서 버튼이 모두 비어 있었다.
--
--   문서 → 기록 방향은 approval_documents.target_id 로 이미 이어져 있다. 없는 것은 **기록 → 문서**
--   방향이다. target_id 로 역추적할 수는 있지만 그것은 FK 가 아니어서(유형마다 원 표가 달라 FK 를
--   걸지 않는다 — approval_schema.sql 설계 요점) 목록 조회에서 조인·임베딩이 되지 않는다.
--   한 달치 기록을 그릴 때마다 문서를 따로 긁어 짝을 맞춰야 하므로, 칸 하나를 둔다.
--
-- 선행 조건
--   · public.showroom_usage (showroom_approval_schema.sql + showroom_schema_v2.sql 적용 상태)
--   · public.approval_documents (approval_schema.sql 적용 상태) — document_id 는 bigserial(bigint)
--   · 이 파일은 RLS 정책을 건드리지 않는다. showroom_usage 의 읽기 정책은 그대로다.
--
-- ┌─ 실행 순서 ────────────────────────────────────────────────────────────────┐
-- │ 0. (사전 확인) 칸 이름 충돌·타입을 눈으로 본다                               │
-- │ 1. document_id 칸 추가 (bigint, null 허용)                                  │
-- │ 2. FK showroom_usage_document_id_fkey 추가 (ON DELETE 없음 = NO ACTION)      │
-- │ 3. 인덱스 idx_showroom_usage_document 추가                                  │
-- │ 4. (적용 후 확인) 칸·FK·인덱스가 생겼는지 본다                               │
-- │ 순서를 지켜야 한다 — 2·3 은 1 이 끝나야 돌아간다.                             │
-- └────────────────────────────────────────────────────────────────────────────┘
--
-- ┌─ 롤백 SQL (역순) ──────────────────────────────────────────────────────────┐
-- │ drop index if exists public.idx_showroom_usage_document;                   │
-- │ alter table public.showroom_usage                                          │
-- │   drop constraint if exists showroom_usage_document_id_fkey;               │
-- │ alter table public.showroom_usage drop column if exists document_id;       │
-- │                                                                            │
-- │ ※ 되돌리면 그동안 쌓인 연결이 **전부 사라진다**. 다만 문서 → 기록 방향       │
-- │   (approval_documents.target_id)은 남아 있어 아래 「선택: 기존 기록 연결」로  │
-- │   다시 채울 수 있다 — 지워서 복구 불가가 되는 정보는 아니다.                 │
-- │   코드는 document_id 가 null 이면 옛 방식(request_id)으로 떨어지므로,        │
-- │   칸을 지워도 화면이 깨지지 않고 「승인 정보 없음」으로만 보인다.             │
-- └────────────────────────────────────────────────────────────────────────────┘
--
-- ┌─ ON DELETE 를 걸지 않는 이유 ──────────────────────────────────────────────┐
-- │ CASCADE 로 두면 결재 문서를 지우는 순간 사용 기록이 함께 사라진다. 사용 기록은 │
-- │ 장비 가동률·엑셀 보고의 원본이고, 문서는 「그 기록이 어떻게 승인됐는가」일     │
-- │ 뿐이다. SET NULL 도 두지 않는다 — 문서는 폐기 상태로 남기고 지우지 않는 설계  │
-- │ 라(approval_schema.sql), 실제로 지우는 경로는 상신 실패 롤백 하나뿐이고 그때는 │
-- │ 코드가 사용 기록을 먼저 지운다. NO ACTION 이면 그 순서가 틀렸을 때 FK 가      │
-- │ 막아 주므로, 조용히 데이터가 어긋나는 대신 에러로 드러난다.                   │
-- └────────────────────────────────────────────────────────────────────────────┘

-- ┌─ 위험 평가: PostgREST 임베딩이 모호해지는가 ───────────────────────────────┐
-- │                                                                            │
-- │ 1) showroom_usage → approval_documents 방향                                 │
-- │    이 칸이 **이 방향의 첫 FK** 다. showroom_usage 가 가진 다른 FK 는 각각     │
-- │    showroom_devices · customers · approval_requests · quotes · engineers 를  │
-- │    가리키고, approval_documents 를 가리키는 FK 는 없었다. 따라서              │
-- │      showroom_usage?select=*,approval_documents(...)                        │
-- │    는 **모호하지 않다**(PGRST201 이 나지 않는다).                            │
-- │                                                                            │
-- │ 2) approval_documents → showroom_usage 방향(역방향 노출)                     │
-- │    approval_documents 에는 showroom_usage 를 가리키는 FK 가 없다             │
-- │    (target_id 는 FK 가 아니다). 이 칸이 생기면 PostgREST 가 역방향 관계       │
-- │      approval_documents?select=*,showroom_usage(...)                        │
-- │    를 **새로 노출한다**. 지금 그런 조회를 하는 코드는 없으므로 깨지는 것은     │
-- │    없다. 다만 approval_documents 를 읽는 기존 조회                           │
-- │      select('*, approval_lines(*)')                                         │
-- │    처럼 임베드 대상을 **이름으로 적는 방식**은 영향을 받지 않는다 —           │
-- │    '*' 는 자식 표를 끌어오지 않는다.                                         │
-- │                                                                            │
-- │ 3) 앞으로 모호해질 조건                                                      │
-- │    showroom_usage 에서 approval_documents 로 가는 **두 번째** FK 가 생기면    │
-- │    그때부터 1) 이 PGRST201 로 깨진다. 그런 칸을 더할 일이 생기면 그 시점에     │
-- │    기존 임베딩에 제약 이름을 붙여야 한다:                                     │
-- │      approval_documents!showroom_usage_document_id_fkey(...)                │
-- │                                                                            │
-- │ 4) 이번 코드가 택한 길                                                       │
-- │    **임베딩을 쓰지 않는다.** approval_documents 의 읽기 정책(ad_select)은      │
-- │    상신자·결재선 참여자·superadmin 에게만 열려 있어, 쇼룸 기록을 보는 제3자는  │
-- │    임베드해도 null 만 받는다. 그래서 승인 정보는 service role 라우트           │
-- │    (app/api/showroom/requests/approvals)가 문서 id 목록으로 따로 읽어 내려준다 │
-- │    — 지금은 지운 옛 요청함 목록 라우트도 같은 이유로 service role 을 썼다.      │
-- └────────────────────────────────────────────────────────────────────────────┘


-- ── [0단계] 사전 확인 ────────────────────────────────────────────────────────
-- 먼저 이 세 줄을 돌려 결과를 눈으로 본다.

-- (0-1) document_id 라는 칸이 이미 있는가 — 있으면 멈춘다(0행이어야 한다)
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'showroom_usage' and column_name = 'document_id';

-- (0-2) approval_documents.document_id 의 타입 — bigint 여야 한다
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'approval_documents' and column_name = 'document_id';

-- (0-3) showroom_usage 가 지금 가진 FK — approval_documents 를 가리키는 것이 없어야 한다
select con.conname, cl.relname as references_table
from pg_constraint con
join pg_class src on src.oid = con.conrelid
join pg_class cl  on cl.oid  = con.confrelid
where con.contype = 'f' and src.relname = 'showroom_usage'
order by con.conname;


-- ── [1~3단계] 적용 ──────────────────────────────────────────────────────────
begin;

-- 1. 칸. null 허용 — 신청을 거치지 않은 기록(직접 작성)과 옛 기록은 늘 null 이다.
alter table public.showroom_usage
  add column document_id bigint;

comment on column public.showroom_usage.document_id is
  '이 기록을 만든 전자결재 문서(approval_documents). 옛 요청함 건과 직접 작성한 기록은 null — 옛 건은 request_id 로 연결된다.';

-- 2. FK. ON DELETE 를 걸지 않는다(위 설명).
alter table public.showroom_usage
  add constraint showroom_usage_document_id_fkey
  foreign key (document_id) references public.approval_documents(document_id);

-- 3. 인덱스. 문서 id 로 기록을 찾는 길(onRevert 의 방어 확인·점검 쿼리)이 쓴다.
--    목록 조회는 반대로 기록에서 문서 id 를 읽어 가므로 이 인덱스를 타지 않는다.
create index if not exists idx_showroom_usage_document
  on public.showroom_usage (document_id);

commit;


-- ── [4단계] 적용 후 확인 ────────────────────────────────────────────────────

-- (4-1) 칸 — bigint · nullable
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'showroom_usage' and column_name = 'document_id';

-- (4-2) FK — showroom_usage_document_id_fkey 가 approval_documents 를 가리키고 ON DELETE 가 'a'(NO ACTION)
select con.conname, cl.relname as references_table, con.confdeltype
from pg_constraint con
join pg_class src on src.oid = con.conrelid
join pg_class cl  on cl.oid  = con.confrelid
where con.contype = 'f' and src.relname = 'showroom_usage'
  and con.conname = 'showroom_usage_document_id_fkey';

-- (4-3) 인덱스
select indexname from pg_indexes
where schemaname = 'public' and tablename = 'showroom_usage' and indexname = 'idx_showroom_usage_document';

-- (4-4) 새 칸은 전부 null 이어야 한다(backfill 하지 않았으므로)
select count(*) as filled from public.showroom_usage where document_id is not null;


-- ════════════════════════════════════════════════════════════════════════════
-- 점검 쿼리 (읽기 전용. 실행해도 아무것도 바뀌지 않는다)
-- ════════════════════════════════════════════════════════════════════════════
--
-- 고아 사용 기록 — 회수·폐기된 쇼룸 문서가 가리키는 사용 기록이 아직 남아 있는 행.
-- 사후 신청은 상신 때 사용 기록을 먼저 만드는데, 지금까지 showroom_usage 에는 onRevert 가
-- 등록돼 있지 않아 회수·폐기해도 기록이 남았다. 이번 코드가 그 구멍을 막았지만,
-- **그 전에 생긴 기록은 코드가 모른다** — 이 쿼리로 찾아 사람이 판단해 지운다.
--
-- select d.document_id,
--        d.doc_no,
--        d.status                      as doc_status,
--        d.updated_at                  as doc_updated_at,
--        (d.summary ->> 'is_retroactive')::boolean as retroactive,
--        u.usage_id,
--        u.usage_date,
--        u.start_time,
--        u.end_time,
--        u.device_id,
--        u.created_by
--   from public.approval_documents d
--   join public.showroom_usage     u on u.usage_id = d.target_id
--  where d.doc_type   = 'showroom_usage'
--    and d.status     in ('회수', '폐기')
--    and d.target_table = 'showroom_usage'
--    and u.deleted_at is null
--  order by d.updated_at desc;
--
-- 지울 때는 자식 행(참여 엔지니어)이 먼저다 — showroom_usage_engineers.usage_id 는
-- ON DELETE CASCADE 라 사실 함께 지워지지만, 지우기 전에 무엇이 딸려 있는지 보고 지운다:
--
-- select usage_id, engineer_id from public.showroom_usage_engineers
--  where usage_id in ( ... 위 쿼리의 usage_id ... );


-- ════════════════════════════════════════════════════════════════════════════
-- 선택: 기존 기록 연결 (backfill) — 실행하지 않는다. 필요해졌을 때 쓴다.
-- ════════════════════════════════════════════════════════════════════════════
--
-- 이번 코드는 **앞으로 만들어지는 기록만** document_id 를 채운다. 이미 전자결재로 만들어진
-- 기록은 문서의 target_id 로만 이어져 있어 화면에 승인 정보가 계속 비어 보인다.
-- 아래로 한 번에 채울 수 있다.
--
-- 안전한 조건 — 이 셋을 모두 만족하는 행만 손댄다.
--   · d.doc_type = 'showroom_usage' 이고 d.target_table = 'showroom_usage'
--     (target_id 는 유형마다 다른 표를 가리키므로 이 둘을 함께 봐야 한다 — quote_delete 의
--      target_id 를 사용 기록 id 로 오인하면 엉뚱한 기록이 엉뚱한 문서에 묶인다)
--   · u.document_id is null (이미 채워진 것은 덮어쓰지 않는다)
--   · u.request_id is null (옛 요청함 건은 그대로 둔다 — 두 방식이 한 행에 섞이지 않게)
--
-- (선택-1) 먼저 몇 건이 바뀌는지, 한 기록에 두 문서가 걸리지는 않는지 **센다**.
--          두 번째 쿼리가 0행이 아니면 아래 UPDATE 를 돌리지 마라.
--
-- select count(*) as will_fill
--   from public.approval_documents d
--   join public.showroom_usage     u on u.usage_id = d.target_id
--  where d.doc_type = 'showroom_usage' and d.target_table = 'showroom_usage'
--    and u.document_id is null and u.request_id is null;
--
-- select d.target_id as usage_id, count(*) as docs, array_agg(d.document_id order by d.document_id)
--   from public.approval_documents d
--  where d.doc_type = 'showroom_usage' and d.target_table = 'showroom_usage'
--    and d.target_id is not null
--  group by d.target_id
-- having count(*) > 1;
--
-- (선택-2) 채운다. 위 두 쿼리를 보고 나서만.
--
-- begin;
-- update public.showroom_usage u
--    set document_id = d.document_id
--   from public.approval_documents d
--  where u.usage_id     = d.target_id
--    and d.doc_type     = 'showroom_usage'
--    and d.target_table = 'showroom_usage'
--    and u.document_id is null
--    and u.request_id  is null;
-- commit;
--
-- (선택-3) 검증 — 채운 수가 (선택-1) 의 will_fill 과 같아야 하고,
--          document_id 와 request_id 가 함께 있는 행은 0 이어야 한다.
--
-- select count(*) as filled from public.showroom_usage where document_id is not null;
-- select count(*) as both_set from public.showroom_usage
--  where document_id is not null and request_id is not null;
--
-- (선택-4) 롤백 — backfill 만 되돌린다(칸·FK·인덱스는 그대로).
--          옛 요청함 건을 건드리지 않았으므로 조건도 그대로 뒤집는다.
--
-- begin;
-- update public.showroom_usage set document_id = null where request_id is null;
-- commit;
