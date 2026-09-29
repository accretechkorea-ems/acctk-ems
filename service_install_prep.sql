-- 신규 설치 준비 체크리스트 (2026-09-28 DB 적용 완료). 기록용, 다시 실행하지 마라.
-- 항목 4종 고정(freight·site·waste·forklift). 상태는 협의완료·미확인 둘.
-- 협의완료로 바꾼 사람은 서버가 세션에서 박는다(대리 입력 없음 — 책임 소재).
--
-- 왜 별도 표인가 (service_history 에 jsonb 한 칸으로 두지 않은 이유)
--   · service_history 에는 전체 행을 old/new jsonb 로 남기는 감사 트리거가 걸려 있다.
--     한 칸에 넣으면 체크 한 번에 서비스 본문까지 통째로 두 벌씩 audit_log 에 쌓인다.
--   · 「누가 눌렀는가」를 서버가 박아야 하는데, jsonb 면 service_history 쓰기 경로 전체를
--     서버로 옮기거나 클라이언트가 보낸 이름을 믿어야 한다(요구사항 위배).
--   · 항목이 늘면 행만 늘면 된다. 두 사람이 다른 항목을 동시에 눌러도 서로 덮어쓰지 않는다.
--   · 「준비 완료율」 같은 집계를 SQL 로 바로 낸다.
--
-- 화면·라우트: lib/installPrep.ts · app/api/install-prep/route.ts ·
--              components/customer/InstallPrepSection.tsx

create table public.service_install_prep (
  prep_id     bigint generated always as identity primary key,
  -- 서비스 기록이 지워지면 함께 지운다(service_attachments 와 같은 규칙).
  -- 준비는 그 방문에 딸린 것이라 기록 없이 남으면 고아가 된다. 지울 외부 자원(파일)은 없다.
  service_id  bigint not null references public.service_history(service_id) on delete cascade,
  -- 'freight' 화물 · 'site' 설치 장소 협의 · 'waste' 폐기물 처리 협의 · 'forklift' 지게차
  -- 항목이 늘면 이 CHECK 와 lib/installPrep.ts 의 PREP_ITEMS 를 함께 고친다.
  item_key    text   not null check (item_key in ('freight', 'site', 'waste', 'forklift')),
  -- 저장값이 곧 화면 글자다(결재 상태값과 같은 방식).
  status      text   not null default '미확인' check (status in ('협의완료', '미확인')),
  -- 화물·지게차: 업체명 / 기사 연락처 / 예정시각(하차·도착)
  vendor      text,
  contact     text,
  planned_at  time,
  -- 설치 장소 협의·폐기물 처리 협의: 협의 상대
  counterpart text,
  note        text,
  -- 협의완료로 바꾼 사람과 시각. 라우트가 세션에서 박는다(본문 값을 쓰지 않는다).
  -- 미확인으로 되돌리면 둘 다 지운다 — 「지금 누가 책임지는가」만 남긴다(이력은 audit_log 에).
  done_by     integer references public.engineers(engineer_id),
  done_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- 같은 기록에 같은 항목은 하나뿐 — 라우트가 이 제약으로 upsert 한다.
  unique (service_id, item_key)
);

create index idx_service_install_prep_service on public.service_install_prep (service_id);

alter table public.service_install_prep enable row level security;

-- 읽기만 연다. 쓰기는 service role 라우트(/api/install-prep)만 한다
-- — service_attachments 와 같은 규칙이다.
create policy service_install_prep_select on public.service_install_prep
  for select to authenticated
  using (public.has_team_perm('customers'));

-- 감사 — 표 자체에는 「지금 누가」만 남으므로, 되돌린 이력까지 보려면 로그가 필요하다.
drop trigger if exists audit_service_install_prep on public.service_install_prep;
create trigger audit_service_install_prep
  after insert or update or delete on public.service_install_prep
  for each row execute function audit_row_change('prep_id');
