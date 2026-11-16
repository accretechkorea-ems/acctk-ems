-- 견적의 수리 건 정보 + 사진 (2026-11-16 작성). **아직 적용하지 않았다 — 확인 뒤 돌린다.**
--
-- ════════════════════════════════════════════════════════════════
-- 무엇을 담나
-- ════════════════════════════════════════════════════════════════
--   수리 건으로 만든 견적서에 「고장 증상 · 고장 원인 · 처리 결과」와 사진 1~4장을 붙인다.
--   지금은 그 내용을 적을 자리가 없어 repairs.repair_content(자유 메모) 한 칸에 섞여 있거나
--   아예 남지 않는다. 견적 하나에 한 묶음이라 **1:1** 이다.
--
-- ════════════════════════════════════════════════════════════════
-- 수리 건과의 연결 — **repairs.quote_id 하나뿐이다**
-- ════════════════════════════════════════════════════════════════
--   이 표에는 수리 건을 가리키는 칸을 두지 않는다. 이미 repairs.quote_id 가 있고
--   (수리 목록에서 「견적서 작성」을 누르면 견적을 저장할 때 채워진다 — create_quote 의
--   p_repair_id), 같은 사실을 두 곳에 두면 어긋났을 때 어느 쪽이 맞는지 알 수 없다.
--   2026-11-16 현재 repairs 343건 중 10건이 견적에 연결돼 있다.
--
--   그래서 「이 견적의 수리 건」은 repairs 를 quote_id 로 찾아 쓴다.
--

-- ════════════════════════════════════════════════════════════════
-- 타입 (2026-11-16 PostgREST 스키마로 확인)
-- ════════════════════════════════════════════════════════════════
--   quotes.quote_id bigint · engineers.engineer_id **integer**
--
-- ════════════════════════════════════════════════════════════════

-- ── 1. 수리 건 정보 (견적 1건당 1줄) ───────────────────────────────────────
create table if not exists public.quote_repair_info (
  -- quote_id 가 곧 기본키다 — 「견적당 하나」를 UNIQUE 로 따로 걸지 않고 키로 못 박는다.
  quote_id    bigint primary key references public.quotes(quote_id) on delete cascade,
  symptom     text,
  cause       text,
  result      text,
  created_by  integer references public.engineers(engineer_id),
  created_at  timestamptz not null default now(),
  updated_by  integer references public.engineers(engineer_id),
  updated_at  timestamptz not null default now()
);

comment on table public.quote_repair_info is
  '견적에 붙는 수리 건 정보(증상·원인·처리 결과). 견적 1건당 1줄. 사진은 quote_repair_photos.';
comment on column public.quote_repair_info.result is
  '처리 결과. 처리 일시·출고일은 여기 적지 않는다 — repairs 의 received_date · '
  'repair_done_at · shipped_date 를 읽어서 보여주기만 한다(한 사실을 두 곳에 두지 않는다).';

-- ── 2. 사진 (견적 1건당 최대 4장) ──────────────────────────────────────────
create table if not exists public.quote_repair_photos (
  photo_id     bigint generated always as identity primary key,
  quote_id     bigint not null references public.quotes(quote_id) on delete cascade,
  -- 버킷 안의 **경로만** 담는다. 공개 URL 을 담지 않는다 — 비공개 버킷이라 그 주소는
  -- 열리지 않는다(lib/profileImage.ts 머리말에 같은 사고 기록이 있다).
  storage_path text not null,
  caption      text,
  sort_order   integer not null default 0,
  uploaded_by  integer references public.engineers(engineer_id),
  created_at   timestamptz not null default now()
);

comment on table public.quote_repair_photos is
  '수리 건 사진. 견적당 4장까지(개수 제한은 올리는 라우트가 센다 — CHECK 를 두면 '
  '지우고 다시 올리는 중간 상태까지 막힌다).';
comment on column public.quote_repair_photos.storage_path is
  'quote-repair-photos 버킷 안의 파일 이름. 공개 주소가 아니다 — 보여줄 때 서명 URL 을 만든다.';

create index if not exists quote_repair_photos_quote_idx
  on public.quote_repair_photos (quote_id, sort_order);

-- ── 3. RLS — 견적과 같은 범위 ──────────────────────────────────────────────
-- quote_items 와 **같은 꼴**이다(quote_schema_snapshot.sql): 부모 견적이 보이면 보이고,
-- 부모 견적이 있으면 쓸 수 있다. 쓰기는 실제로는 서비스 롤 라우트만 하지만, 정책이
-- 없으면 로그인 사용자의 읽기까지 막혀 화면이 비어 보인다.
alter table public.quote_repair_info  enable row level security;
alter table public.quote_repair_photos enable row level security;

create policy quote_repair_info_select_via_parent on public.quote_repair_info
  for select to authenticated
  using (exists (select 1 from public.quotes q where q.quote_id = quote_repair_info.quote_id));
create policy quote_repair_info_insert_via_parent on public.quote_repair_info
  for insert to authenticated
  with check (exists (select 1 from public.quotes q where q.quote_id = quote_repair_info.quote_id));
create policy quote_repair_info_update_via_parent on public.quote_repair_info
  for update to authenticated
  using (exists (select 1 from public.quotes q where q.quote_id = quote_repair_info.quote_id));
create policy quote_repair_info_delete_via_parent on public.quote_repair_info
  for delete to authenticated
  using (exists (select 1 from public.quotes q where q.quote_id = quote_repair_info.quote_id));

create policy quote_repair_photos_select_via_parent on public.quote_repair_photos
  for select to authenticated
  using (exists (select 1 from public.quotes q where q.quote_id = quote_repair_photos.quote_id));
create policy quote_repair_photos_insert_via_parent on public.quote_repair_photos
  for insert to authenticated
  with check (exists (select 1 from public.quotes q where q.quote_id = quote_repair_photos.quote_id));
create policy quote_repair_photos_update_via_parent on public.quote_repair_photos
  for update to authenticated
  using (exists (select 1 from public.quotes q where q.quote_id = quote_repair_photos.quote_id));
create policy quote_repair_photos_delete_via_parent on public.quote_repair_photos
  for delete to authenticated
  using (exists (select 1 from public.quotes q where q.quote_id = quote_repair_photos.quote_id));

-- ── 4. 사진 버킷 ───────────────────────────────────────────────────────────
-- 대시보드에서 **비공개**로 만든다: Storage → New bucket → 이름 quote-repair-photos,
-- Public bucket 체크 **해제**. 그 뒤 아래 정책을 돌린다(packing_lists_storage_policy.sql 과
-- 같은 꼴 — 로그인 사용자만, 파일은 서명 URL 로만 열린다).
--
-- 경로는 이 저장소의 관행대로 **평평한 파일 이름**이다(폴더를 쓰지 않는다):
--   qr-{quote_id}-{밀리초}-{i}.jpg     예) qr-1182-1763251200000-0.jpg
-- (service-attachments 의 svc-{id}-{stamp}-{i}.{ext} 와 같은 규칙이다.)

create policy "quote_repair_photos authenticated read"
on storage.objects for select to authenticated
using (bucket_id = 'quote-repair-photos');

create policy "quote_repair_photos authenticated insert"
on storage.objects for insert to authenticated
with check (bucket_id = 'quote-repair-photos');

create policy "quote_repair_photos authenticated update"
on storage.objects for update to authenticated
using (bucket_id = 'quote-repair-photos')
with check (bucket_id = 'quote-repair-photos');

create policy "quote_repair_photos authenticated delete"
on storage.objects for delete to authenticated
using (bucket_id = 'quote-repair-photos');

-- ── 확인용 읽기 ────────────────────────────────────────────────────────────
-- select count(*) from public.quote_repair_info;
-- select count(*) from public.quote_repair_photos;
-- -- 이 견적의 수리 건(연결은 repairs 쪽에 있다)
-- select i.quote_id, r.repair_id, r.serial_number
--   from public.quote_repair_info i
--   left join public.repairs r on r.quote_id = i.quote_id;
