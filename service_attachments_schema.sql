-- 서비스 레포트 첨부파일 (2026-09-22 DB 적용 완료). 기록용, 다시 실행하지 마라.
-- 버킷 service-attachments (비공개, 20MB). 업로드·삭제는 service role 라우트만 한다.
-- RLS 는 읽기 정책만 둔다.
--
-- 기존 report_url(서비스 레포트 본체)과는 별개다 — 그쪽은 service_history.report_url 한 칸에
-- 서명 완료 PDF 한 건만 담고, 이 표는 현장 사진·문서를 건당 여러 개 담는다.
-- 파일은 버킷 안 파일명만 저장한다(전체 URL 이 아니다). 열 때마다 서명 URL 을 발급한다
-- — 패킹리스트·서비스 레포트와 같은 규칙이다.

create table public.service_attachments (
  attachment_id bigint generated always as identity primary key,
  -- 서비스 기록이 지워지면 행도 함께 지운다. 스토리지 파일은 CASCADE 로 지워지지 않으므로
  -- /api/service-attachment 가 먼저 파일을 지운다(useServiceCrud·useCustomerCrud 가 부른다).
  service_id    bigint not null references public.service_history(service_id) on delete cascade,
  -- service-attachments 버킷 안의 파일명. 서버가 정한다(svc-<service_id>-<시각>-<순번>.<확장자>).
  file_path     text not null unique,
  -- 올린 사람이 보던 원래 이름. 표시에만 쓰고 경로로는 쓰지 않는다.
  file_name     text not null,
  content_type  text,
  byte_size     bigint,
  sort_order    integer not null default 0,
  uploaded_by   integer references public.engineers(engineer_id),
  created_at    timestamptz not null default now()
);

create index idx_service_attachments_service on public.service_attachments (service_id);

alter table public.service_attachments enable row level security;

-- 읽기 — 고객사 열람 권한이 있는 팀(고객 현장 자료다). 쓰기 정책은 두지 않는다:
-- 업로드·삭제는 service role 라우트(/api/service-attachment)만 한다.
create policy service_attachments_select on public.service_attachments
  for select to authenticated
  using (public.has_team_perm('customers'));

-- 버킷: service-attachments (Public 체크 해제, 파일 크기 제한 20MB).
-- storage.objects 에 정책을 만들지 않는다 — 정책이 없으면 service role 만 접근할 수 있다.
