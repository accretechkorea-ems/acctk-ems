-- 쇼룸 스키마 v2 (2026-09-11 DB 적용 완료). 기록용, 다시 실행하지 마라.
-- 엑셀 「장비 사용승인서」 항목 반영. 쇼룸 장비 = showroom_sites 에 지정된 사무실의 devices.

begin;
create table public.showroom_sites (
  customer_id bigint primary key references public.customers(customer_id),
  created_at  timestamptz not null default now()
);
alter table public.showroom_sites enable row level security;
create policy ss_select on public.showroom_sites for select to authenticated using (true);
alter table public.showroom_devices
  add column device_status text not null default '가동'
    check (device_status in ('가동','점검','수리','미사용'));
alter table public.showroom_usage drop constraint if exists showroom_usage_purpose_check;
alter table public.showroom_usage drop constraint if exists su_customer_required;
alter table public.showroom_usage
  add constraint su_purpose_check
    check (purpose in ('고객 데모','고객 평가','측정대행','내부 시험','교육','유지보수','기타')),
  add constraint su_customer_required
    check (purpose not in ('고객 데모','고객 평가','측정대행') or customer_id is not null);
alter table public.showroom_usage
  add column project_name    text,
  add column customer_dept   text,
  add column sample_material text,
  add column carried_out     boolean not null default false,
  add column expected_cost   numeric(14,0) check (expected_cost >= 0),
  add column nda_status      text check (nda_status in ('해당없음','확인완료','확인필요')),
  add column expected_result text,
  add column result_category text
    check (result_category in ('완료(성공)','완료(부분성공)','재평가 필요','중단','실패')),
  add column issue           text,
  add column follow_up       text,
  add column downtime_hours  numeric(4,1) not null default 0 check (downtime_hours >= 0),
  add column quote_id        bigint references public.quotes(quote_id),
  add column note            text;
create index idx_su_quote on public.showroom_usage (quote_id);
commit;

-- 2026-09-14 추가: 공휴일 (자동 계산분 + 임시공휴일 수동 등록)
-- 가동률의 평일 수 계산에 쓴다. 자동 계산분(is_manual=false)은 /api/showroom/stats 가
-- 그해 첫 조회 때 lib/holidays.ts 의 계산 결과로 채운다. 쓰기는 service role 라우트에서만.
create table public.company_holidays (
  holiday_date date primary key,
  name         text not null,
  is_manual    boolean not null default false,
  created_at   timestamptz not null default now()
);
alter table public.company_holidays enable row level security;
create policy ch_select on public.company_holidays
  for select to authenticated using (true);

-- 2026-09-14: 사용목적 5종으로 축소 (고객 평가·내부 시험 제거), 고객활동 개념 폐기
-- 대상 고객사 필수는 측정대행·고객 데모 둘뿐이다. 견적·수주 전환율의 분모는 고객 데모 건수다
-- (측정대행은 견적으로 이어지는 일이 아니다). 화면·라우트의 목록은 lib/showroom.ts 의 USAGE_PURPOSES.
alter table public.showroom_usage drop constraint if exists su_purpose_check;
alter table public.showroom_usage drop constraint if exists su_customer_required;
alter table public.showroom_usage
  add constraint su_purpose_check
    check (purpose in ('측정대행','고객 데모','유지보수','교육','기타')),
  add constraint su_customer_required
    check (purpose not in ('측정대행','고객 데모') or customer_id is not null);

-- 2026-09-15: 정지시간(downtime_hours) 제거. 영업시간·점심 공제로 충분.
alter table public.showroom_usage drop column downtime_hours;

-- 2026-09-15: 데모 사용 신청. pdf_url = 승인서 PDF 경로, 신청 1건당 사용 기록 1건.
alter table public.approval_requests add column pdf_url text;
alter table public.showroom_usage add constraint su_request_unique unique (request_id);

-- 2026-09-15: 데모 신청은 쇼룸 권한자 전체가 조회 가능. 사내 장비 사용 내역은 공유 대상.
create policy ar_select_showroom on public.approval_requests
  for select to authenticated
  using (request_type = 'showroom_demo' and public.has_team_perm('customers'));
