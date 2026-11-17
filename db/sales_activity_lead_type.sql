-- 영업활동 종류에 **「리드 등록」**을 더한다 — 리드 전환이 자동으로 남기는 줄 전용.
--
-- 왜 필요한가 — 담당자 배정(=전환) 때 자동으로 생기는 활동이 지금은 「방문미팅」으로 적힌다.
-- 파트너사가 적어 온 리드 기록이지 우리가 방문한 것이 아니라서 통계가 틀어진다.
-- 사람이 고르는 드롭다운에는 이 값을 내지 않는다(자동 생성 전용 —
-- components/customer/modals/SalesActivityModal.tsx 의 ACTIVITY_TYPES 는 그대로 네 가지다).
--
-- 지금 표에 들어 있는 값은 방문미팅 7 · 사양검토 1 뿐이라, 아래 다섯 가지로 다시 묶어도
-- 기존 줄은 전부 통과한다(2026-11-17 확인).

alter table sales_activities drop constraint if exists sales_activities_type_check;

alter table sales_activities add constraint sales_activities_type_check
  check (activity_type in ('전화상담', '방문미팅', '사양검토', '경쟁입찰', '리드 등록'));

-- 확인
-- select activity_type, count(*) from sales_activities group by 1 order by 2 desc;
