-- 건의사항 스크린샷 (2026-09-22 DB 적용 완료). 기록용, 다시 실행하지 마라.
-- 버킷 suggestion-images (비공개, 5MB). 업로드·삭제는 service role 라우트만 한다.
-- 공지 이미지(notices.image_urls)와 같은 모양이지만 버킷이 비공개인 점이 다르다 —
-- 건의 스크린샷에는 고객사·단가가 찍힌 내부 화면이 올라올 수 있어 URL 만으로 열리면 안 된다.
-- 그래서 전체 URL 이 아니라 버킷 안 파일명만 담고, 열 때마다 서명 URL 을 발급한다
-- (서비스 첨부 service_attachments 와 같은 규칙).

alter table public.suggestions
  add column if not exists image_urls text[] not null default '{}'::text[];

comment on column public.suggestions.image_urls is
  'suggestion-images 버킷 안의 파일명 목록(전체 URL 아님). 최대 3장. 업로드·삭제는 service role 라우트(/api/suggestion-image)만 한다.';

-- RLS 는 기존 suggestions 정책을 그대로 쓴다. 행 단위 정책이라 새 컬럼에 자동 적용되고,
-- 이 컬럼을 화면에서 직접 쓰지 못하게 막을 필요는 없다(쓰기는 라우트가 service role 로 한다).
--
-- 버킷: suggestion-images (Public 체크 해제, 파일 크기 제한 5MB).
-- storage.objects 에 정책을 만들지 않는다 — 정책이 없으면 service role 만 접근할 수 있다.
--
-- 파일명 규칙: sug-<suggestion_id>-<시각>-<순번>.<확장자>
-- 건의를 지우기 전에 /api/suggestion-image DELETE { all: true } 로 파일을 먼저 치운다
-- (컬럼은 행과 함께 사라지지만 스토리지 파일은 남기 때문이다).
