-- 서비스 레포트 "기타사항" 입력 저장용 컬럼
alter table service_history
  add column if not exists etc_notes text;
