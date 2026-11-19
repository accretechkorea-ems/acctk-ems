-- db/crm_cleanup_20261118.sql
--
-- 고객사 데이터 정리 — 대리점 한 줄화 · 회사/사업장 묶기 · 영업활동 종류 표.
-- 2026-11-18 조사(1·2·3차 보고)에서 확정된 결정 1~15 를 그대로 옮긴 것이다.
--
-- ── 읽는 사람에게 ────────────────────────────────────────────────────────
--   · **단계마다 확인 select 가 있다.** 그 결과를 보고 다음 단계로 간다. 한 번에 통째로
--     돌리지 마라 — 단계 ⑦(제약)은 앞 단계가 다 맞아야만 걸린다.
--   · 줄을 **지우지 않는다**. 병합으로 사라지는 줄은 deleted_at 을 찍는다(결정 8).
--     화면은 전부 is('deleted_at', null) 로 거르므로 보이지 않게 되는 것은 같고,
--     되돌리기가 한 줄이다.
--   · 사업장 줄의 company_name 은 **네 줄만** 고친다(결정 13 — 245·452·780·1254).
--     그 밖의 줄은 이름·주소·좌표·장비·담당자·견적·서비스 이력을 한 칸도 바꾸지 않는다.
--     바뀌는 칸은 parent_customer_id · site_name · agency · agency_customer_id ·
--     is_agency · note 여섯이다.
--   · 임시 표 두 개(agency_map_20261118 · site_promote_20261118)는 되돌릴 때 매핑이
--     필요하므로 **남긴다**(결정 15). 지우려면 맨 끝 주석을 풀어라.
--
-- ── 수치(2026-11-18 실측) ────────────────────────────────────────────────
--   살아있는 customers 1,649 = 회사 282 + 사업장(부모 있음) 775 + 사업장(부모 없음) 592
--   agency 채워진 줄 624 (전부 사업장 줄)
--   만들 줄: 대리점 29 + 회사 561
--   고칠 줄: 자동 연결 20 · 회사 붙이기 570 · 병합 자식 46(40+4+2)
--            · 이름·메모 직접 수정 5
--   deleted_at 찍을 줄: 4 (305 · 1730 · 1733 · 1734)
--   끝난 뒤: 살아있는 줄 2,235 = 회사 840 + 사업장 1,365 + 대리점 전용 줄 30
--            (대리점 깃발이 켜진 줄은 45 — 그중 15 은 회사·사업장 줄과 겹치고,
--             1779 만 대리점 전용으로 남는다)
--   부모 없는 사업장 592 = 자동 연결 20 + 회사 붙이기 570
--            + 닫는 줄 1(305) + 대리점 줄 1(1779)  →  ⑦ 제약 위반 0


-- ═══════════════════════════════════════════════════════════════════════
-- ⓞ 백업 — 어떤 변경보다 먼저.
-- ═══════════════════════════════════════════════════════════════════════
create table public.customers_backup_20261118        as select * from public.customers;
create table public.sales_activities_backup_20261118 as select * from public.sales_activities;
create table public.quotes_backup_20261118           as select * from public.quotes;

-- 확인 — 지워진 줄까지 포함한 전량이어야 한다.
select (select count(*) from public.customers_backup_20261118)        as customers_backup,
       (select count(*) from public.sales_activities_backup_20261118) as activities_backup,
       (select count(*) from public.quotes_backup_20261118)           as quotes_backup;


-- ═══════════════════════════════════════════════════════════════════════
-- ① 칸 추가 — note(결정 1·13) · is_agency/agency_customer_id(결정 10)
-- ═══════════════════════════════════════════════════════════════════════
alter table public.customers add column note text;
alter table public.customers add column is_agency boolean not null default false;
alter table public.customers add column agency_customer_id bigint references public.customers(customer_id);
create index customers_agency_customer_id_idx on public.customers (agency_customer_id);

-- 확인
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'customers'
  and column_name in ('note', 'is_agency', 'agency_customer_id')
order by column_name;


-- ═══════════════════════════════════════════════════════════════════════
-- ② 대리점 = customers 한 줄
-- ═══════════════════════════════════════════════════════════════════════

-- ②-1 이미 있는 줄에 깃발만 켠다. 1638(엔아이텍)·1567(데바)는 회사 줄이라
--      is_parent 와 is_agency 가 **둘 다 true** 가 된다(결정 10).
update public.customers set is_agency = true
where customer_id in (63, 314, 387, 843, 1472, 1567, 1638, 1767, 1778, 1779, 1783, 1785, 1800, 1804, 1812, 1822);
--   1779 젠트 · 1767 하나무역 · 387 이룸지텍 · 843 아이메저 · 1638 엔아이텍 · 1567 데바 · 63 CM TECH · 1822 한국코어텍 · 1472 써모피셔사이언티픽 코리아 · 314 성우IMS
--   dealer_id 전용: 1778 더드림코리아 · 1783 신한산전 · 1785 기풍상사 · 1800 킴스텍 · 1804 용마 · 1812 서브원

-- ②-2 아이메저(843)는 status 가 '이탈' 이었다 — 대리점으로 쓰므로 살린다(결정 5).
update public.customers set status = '활성' where customer_id = 843;

-- ②-3 새 대리점 줄 29개. is_parent=false · is_agency=true · 부모 없음 —
--      ⑦ 제약의 is_agency 항이 이 줄들을 받는다(결정 10).
create table public.agency_map_20261118 (
  agency_text        text primary key,
  agency_customer_id bigint references public.customers(customer_id)
);

with ins as (
  insert into public.customers (company_name, is_parent, is_agency, status)
  select v.n, false, true, '활성'
  from (values
    ('신스코퍼레이션'),
    ('범아유니텍'),
    ('시스콤'),
    ('태성시스템'),
    ('TDK'),
    ('키메스'),
    ('남영무역'),
    ('이큐마이크론'),
    ('세진계기'),
    ('지티에스코리아'),
    ('발만'),
    ('도호코리아'),
    ('삼화기업'),
    ('내외교역'),
    ('새한씨엔티'),
    ('경화상사'),
    ('제이엠씨소루션'),
    ('휴 라이스'),
    ('신정'),
    ('젠트-프리텍'),
    ('세동엔터프라이즈'),
    ('다산실업'),
    ('태영트레이딩'),
    ('CEPCO'),
    ('T.S.K'),
    ('자산기'),
    ('화원테크'),
    ('일신테크윈'),
    ('동일기계')
  ) as v(n)
  returning customer_id, company_name
)
insert into public.agency_map_20261118 (agency_text, agency_customer_id)
select company_name, customer_id from ins;

-- ②-4 이미 있던 줄도 매핑에 넣는다.
insert into public.agency_map_20261118 (agency_text, agency_customer_id) values
  ('젠트', 1779),
  ('하나무역', 1767),
  ('이룸지텍', 387),
  ('아이메저', 843),
  ('IMEASURE', 843),
  ('엔아이텍', 1638),
  ('데바', 1567),
  ('CM TECH', 63),
  ('한국코어텍', 1822),
  ('써모피셔사이언티픽 코리아', 1472),
  ('성우IMS', 314);

-- 확인 — 매핑 40줄, 전부 줄에 연결돼 있어야 한다.
select count(*) as 매핑줄, count(agency_customer_id) as 줄연결됨 from public.agency_map_20261118;

-- ②-5 백필 — agency 텍스트가 매핑과 정확히 같은 줄.
update public.customers c set agency_customer_id = m.agency_customer_id
from public.agency_map_20261118 m
where trim(c.agency) = m.agency_text and c.agency_customer_id is null;

-- ②-6 「동일기계 협력사」(615) — 값 자체는 대리점명이 아니다. 「동일기계」 줄에 붙이고
--      텍스트도 정본 표기로 맞춘다(결정 3). 비우는 쪽을 원하면 agency 줄을 지워라.
update public.customers
   set agency_customer_id = (select agency_customer_id from public.agency_map_20261118 where agency_text = '동일기계'),
       agency = '동일기계'
 where customer_id = 615;

-- ②-7 「일본 직수입」 10줄 — note 로 옮기고 agency 를 비운다(결정 1).
update public.customers set note = '일본 직수입', agency = null
where customer_id in (102, 103, 256, 541, 542, 543, 838, 839, 909, 989);

-- ②-8 대리점명이 아닌 값 비움(결정 3 포함) — 74줄.
--      ACCT-K 39 · ACCTK 20(자사=직판) · 직판 9 · 대리점 1 · 없음 1
--      · IMEASURE 1(②-5 에서 843 에 이미 연결했다) · 정제욱 책임 1 · 김영기 수석 1
--      · 오사카영업소 1
update public.customers set agency = null
where trim(agency) in ('ACCT-K', 'ACCTK', '직판', '대리점', '없음', 'IMEASURE', '정제욱 책임', '김영기 수석', '오사카영업소');

-- 확인 ① — 대리점 줄과 거기에 매달린 사업장 수.
select a.customer_id, a.company_name, a.is_parent,
       (select count(*) from public.customers s where s.agency_customer_id = a.customer_id) as 연결된사업장
from public.customers a
where a.is_agency and a.deleted_at is null
order by 연결된사업장 desc, a.company_name;

-- 확인 ② — 아직 agency 텍스트만 남은 줄. **0건이어야 한다.**
select customer_id, company_name, agency
from public.customers
where deleted_at is null and agency is not null and trim(agency) <> '' and agency_customer_id is null
order by customer_id;


-- ═══════════════════════════════════════════════════════════════════════
-- ③ 병합 — 305→1779 · 1730→1729 · 1733·1734→1744 (결정 4·6·7)
--
--    보부하이테크(618·1825)는 **병합하지 않는다**(결정 14 고침). 두 줄의 주소가
--    서로 다르다 — 618 경기도 용인시 수지구 죽전동 / 1825 강원특별자치도 강릉시
--    과학단지로. 이름만 같은 **서로 다른 사업장**이라, 회사 「보부하이테크」 아래
--    두 사업장으로 둔다(⑤ 승격 표에 site_name 용인·강릉 으로 들어 있다).
-- ═══════════════════════════════════════════════════════════════════════

-- ③-1 젠트 — 305 의 참조를 1779 로 옮기고 305 를 닫는다.
--      305: 담당자 1 · 장비 1 · 대리점 견적 5.  1779: 담당자 1 · 고객 견적 2 · 대리점 견적 28.
update public.quotes   set dealer_id   = 1779 where dealer_id   = 305;
update public.quotes   set customer_id = 1779 where customer_id = 305;
update public.contacts set customer_id = 1779 where customer_id = 305;
update public.devices  set customer_id = 1779 where customer_id = 305;
update public.service_history     set customer_id = 1779 where customer_id = 305;
update public.sales_activities    set customer_id = 1779 where customer_id = 305;
update public.sales_opportunities set customer_id = 1779 where customer_id = 305;
update public.repairs             set customer_id = 1779 where customer_id = 305;
update public.showroom_usage      set customer_id = 1779 where customer_id = 305;
update public.holdings            set customer_id = 1779 where customer_id = 305;
update public.leads               set customer_id = 1779 where customer_id = 305;
update public.customers set agency_customer_id = 1779 where agency_customer_id = 305;
update public.customers set deleted_at = now() where customer_id = 305;

-- ③-2 현대자동차 — 1730(사업장 40) → 1729. 둘 다 자기 데이터가 0건인 묶음 줄이다.
update public.customers set parent_customer_id = 1729 where parent_customer_id = 1730;
update public.customers set deleted_at = now() where customer_id = 1730;

-- ③-3 현대트랜시스 — 회사 줄 1733·1734 를 1744 로 접고, 자식의 site_name 을 채운다.
update public.customers set parent_customer_id = 1744, site_name = '지곡공장' where parent_customer_id = 1733;
update public.customers set parent_customer_id = 1744, site_name = '화성공장' where parent_customer_id = 1734;
update public.customers set deleted_at = now() where customer_id in (1733, 1734);

-- 확인 ① — 이름이 겹치는 살아있는 회사 줄. **0건이어야 한다.**
select company_name, count(*) as 줄수, string_agg(customer_id::text, ',' order by customer_id) as ids
from public.customers
where is_parent and deleted_at is null
group by 1 having count(*) > 1
order by 1;

-- 확인 ② — 닫은 줄 4개의 참조. 전부 0 이어야 한다(305 는 1779 로 옮겼다).
select c.customer_id, c.company_name, c.deleted_at is not null as 닫힘,
       (select count(*) from public.customers x where x.parent_customer_id = c.customer_id) as 자식,
       (select count(*) from public.quotes   x where x.customer_id = c.customer_id or x.dealer_id = c.customer_id) as 견적,
       (select count(*) from public.contacts x where x.customer_id = c.customer_id) as 담당자,
       (select count(*) from public.devices  x where x.customer_id = c.customer_id) as 장비
from public.customers c where c.customer_id in (305, 1730, 1733, 1734)
order by c.customer_id;


-- ═══════════════════════════════════════════════════════════════════════
-- ④ 자동 연결 20줄 — 이름이 같거나 「회사명 + 사업장명」인 것(결정 7)
--    company_name 은 **그대로 둔다**. 바뀌는 칸은 parent_customer_id 와 site_name.
-- ═══════════════════════════════════════════════════════════════════════
update public.customers as c
   set parent_customer_id = v.pid,
       site_name = nullif(v.site, '')
from (values
  (409, 1668, ''),
  (476, 1589, '세명테크'),
  (545, 1729, ''),
  (566, 1732, ''),
  (594, 1729, '람다엔진'),
  (601, 1667, '경주3공장'),
  (815, 1599, ''),
  (847, 1514, '마곡단지(PRI TS TEAM)'),
  (850, 1744, '지곡공장'),
  (854, 1744, ''),
  (992, 1769, ''),
  (1014, 1485, ''),
  (1206, 1802, ''),
  (1358, 1744, '서산공장'),
  (1392, 1729, 'A엔진'),
  (1399, 1710, ''),
  (1461, 1581, ''),
  (1464, 1656, ''),
  (1473, 1817, ''),
  (1785, 1784, '')
) as v(sid, pid, site)
where c.customer_id = v.sid;

-- 확인 — 20줄. 이름그대로 가 전부 true 여야 한다(백업과 대조).
select c.customer_id, c.company_name, c.site_name, c.parent_customer_id, p.company_name as 회사,
       (b.company_name = c.company_name) as 이름그대로
from public.customers c
join public.customers_backup_20261118 b on b.customer_id = c.customer_id
left join public.customers p on p.customer_id = c.parent_customer_id
where c.customer_id in (409, 476, 545, 566, 594, 601, 815, 847, 850, 854, 992, 1014, 1206, 1358, 1392, 1399, 1461, 1464, 1473, 1785)
order by c.customer_id;


-- ═══════════════════════════════════════════════════════════════════════
-- ⑤ 회사 줄 만들고 붙이기 — 570줄 → 회사 561개
--    ⒜ 같은 이름 묶음 18곳
--    ⒝ 홀로 544곳  ⒞ 미연결 유지였던 8곳(결정 9)
--    새 회사명은 ㈜·(주)·주식회사를 뗀 표기다(결정 11). 이탈 69곳도 포함한다(결정 12) —
--    빼 두면 ⑦ 제약에 걸린다. 회사 줄의 status 는 그 아래 사업장과 같게 넣는다(결정 12).
--    site_name 은 568줄이 빈칸이다 — 이름에서 뽑을 글자가 없다.
--    보부하이테크 두 줄만 주소에서 따 넣는다(618 용인 · 1825 강릉 — 결정 14 고침).
-- ═══════════════════════════════════════════════════════════════════════

-- ⑤-0 이름이 잘못 들어 있던 5줄 — **사업장 줄의 이름(과 메모)을 직접 고친다**
--      (결정 13, 사용자 승인 예외). 회사명은 아래 승격 표가 이 이름에 맞춰져 있다.
--      앞 4줄은 이름에 섞인 상태 메모를 note 로 옮기는 것이고, 1764 는 원문에 여는
--      괄호가 빠져 있던 것을 메운다('주)대진이엔지' → '(주)대진이엔지').
update public.customers set company_name = '우창기계(주)', note = '정광기계에서 중고로 측정기 매입' where customer_id = 245;
update public.customers set company_name = '썬하이드로릭스 코리아(주)', note = '인천 서구 이전' where customer_id = 452;
update public.customers set company_name = '동우HST', note = '동우열처리공업 → 동우HST 사명 변경, 충남 아산으로 사옥 이전' where customer_id = 780;
update public.customers set company_name = '큐블락', note = '경기도 시흥으로 사옥 이전' where customer_id = 1254;
update public.customers set company_name = '(주)대진이엔지' where customer_id = 1764;

-- 확인 — 5줄. 바뀐 이름·메모와 백업의 옛 이름을 나란히 본다.
select c.customer_id, b.company_name as 옛이름, c.company_name as 새이름, c.note, c.status
from public.customers c
join public.customers_backup_20261118 b on b.customer_id = c.customer_id
where c.customer_id in (245, 452, 780, 1254, 1764)
order by c.customer_id;

-- 이탈 15줄은 이름을 그대로 둔다(결정 13) — 회사명에 '-폐업' 등이 그대로 들어간다.
--   81 리버티-폐업 · 439 ㈜썬스타특수정밀 (폐업) · 464 카스윈 (창원본사로 이전 )
--   558 비전테크 -> 폐업 · 572 INCOCHEM(인코쳄)-폐업 · 732 JL테크 (폐업)
--   790 SAMD( 화성이동 후 폐업) · 993 금영정공-폐업 · 1021 CS정밀-폐업
--   1088 경남테크노파크-폐업 · 1293 성신금속-폐업 · 1299 서원산업-폐업
--   1306 동흥산업-폐업 · 1313 에이스테크 - 폐업 · 1347 대명산업-폐업

create table public.site_promote_20261118 (
  site_customer_id   bigint primary key,
  new_company_name   text not null,
  new_company_status text,
  new_site_name      text,
  parent_customer_id bigint
);

insert into public.site_promote_20261118 (site_customer_id, new_company_name, new_company_status, new_site_name) values
  (1, '유비트론', '잠재', null),
  (2, '용화정밀', '이탈', null),
  (3, 'KJ프리텍', '잠재', null),
  (4, '동성산업', '잠재', null),
  (12, '에버텍엔터프라이즈', '잠재', null),
  (16, 'LG이노텍', '이탈', null),
  (17, '거성정밀', '이탈', null),
  (18, '삼우공업', '잠재', null),
  (19, '현대 기아 연구개발 총괄본부', '잠재', null),
  (20, '한국 폴리텍 대학(화성캠퍼스)', '잠재', null),
  (23, '유앤아이', '활성', null),
  (24, '현대기아자동차', '잠재', null),
  (25, '파카코리아', '활성', null),
  (30, '모베이스', '잠재', null),
  (34, 'TNK엔지니어링', '잠재', null),
  (35, '티티에스(TTS)', '활성', null),
  (36, '엘티씨', '활성', null),
  (37, '여명기계', '잠재', null),
  (38, '동성다이캐스팅', '잠재', null),
  (40, '운복정밀', '활성', null),
  (43, 'IONES', '잠재', null),
  (44, '아이윈스', '잠재', null),
  (51, '준테크', '활성', null),
  (54, '미크론솔루션', '이탈', null),
  (60, '대성다이캐스트', '활성', null),
  (62, '청성기공', '활성', null),
  (63, 'CM TECH', '활성', null),
  (65, '다모하이텍', '잠재', null),
  (67, '대양정공', '활성', null),
  (70, '에스더블유피', '활성', null),
  (71, '젠코', '잠재', null),
  (76, '대진테크', '이탈', null),
  (81, '리버티-폐업', '이탈', null),
  (82, '오에스티', '활성', null),
  (83, '유엔아이', '활성', null),
  (84, '이에이치티', '잠재', null),
  (87, '엠에스피테크', '활성', null),
  (94, '이솔테크', '활성', null),
  (95, 'KSTE', '활성', null),
  (98, '아크레텍코리아 동탄사무실', '활성', null),
  (100, '심우테크', '활성', null),
  (101, '삼정정밀', '잠재', null),
  (104, 'SKB', '잠재', null),
  (107, '태경정밀', '활성', null),
  (108, '오양기업', '이탈', null),
  (110, 'NEK', '활성', null),
  (111, '베인', '활성', null),
  (118, '세아제강', '잠재', null),
  (119, '포스코', '잠재', null),
  (120, '포항산업과학연구원', '잠재', null),
  (123, '동국산업', '잠재', null),
  (128, 'KOREA ELECTRONICS TECH(한국전자부품연구원)', '잠재', null),
  (130, '삼기기공', '잠재', null),
  (131, 'NH테크노글라스코리아', '잠재', null),
  (132, '위너테크', '잠재', null),
  (135, '이젠텍', '이탈', null),
  (140, '쌍용자동차', '활성', null),
  (142, '일강', '활성', null),
  (143, '한국쿠제', '활성', null),
  (145, '삼기기공', '잠재', null),
  (146, '오성롤테크', '잠재', null),
  (152, '성민CNC', '활성', null),
  (153, '저스텍', '활성', null),
  (156, '퀄멕스', '잠재', null),
  (157, '엠엔피에스', '활성', null),
  (159, '일강', '활성', null),
  (166, '세아FS', '잠재', null),
  (167, '점프테크놀러지', '활성', null),
  (171, '티엠씨', '활성', null),
  (172, 'LG필립스LCD', '잠재', null),
  (173, 'PEG', '이탈', null),
  (174, '솔레모', '잠재', null),
  (178, '코템', '잠재', null),
  (179, '녹원C&I', '활성', null),
  (180, '전기초자코리아', '이탈', null),
  (185, 'GN1(지엔원)', '이탈', null),
  (186, '영진전문대', '잠재', null),
  (189, '건국대학교', '잠재', null),
  (191, '신우연마', '잠재', null),
  (192, '미디어엔지니어링', '활성', null),
  (194, '테크윈 PCM', '잠재', null),
  (198, 'SK HYNIX(SK하이닉스)', '잠재', null),
  (201, '쇼토구라모토프로세싱코리아', '잠재', null),
  (202, '유아이디', '잠재', null),
  (203, '네패스', '잠재', null),
  (207, '새론오토모티브', '활성', null),
  (208, '상신EDP', '이탈', null),
  (209, '하나실리콘', '잠재', null),
  (212, '스노젠 (SNOGEN)', '이탈', null),
  (215, '신태양', '활성', null),
  (216, '창성시트(코멧네트워크)', '잠재', null),
  (217, '지흥', '잠재', null),
  (218, '티지케이코리아', '활성', null),
  (222, '한부엔지니어링', '활성', null),
  (224, '엠프로텍', '활성', null),
  (225, '코렌텍', '활성', null),
  (230, '신라정밀', '잠재', null),
  (231, '협진정공', '활성', null),
  (234, '코리아씰팩', '활성', null),
  (236, '삼성항공', '이탈', null),
  (237, '한국동양통신 (SONY)', '이탈', null),
  (238, '효성중공업', '이탈', null),
  (239, '한국 루카스', '이탈', null),
  (241, '두창플라스틱공업사', '잠재', null),
  (245, '우창기계', '잠재', null),
  (246, '대동정밀공업', '잠재', null),
  (251, '명신정공사', '잠재', null),
  (255, '부림산업', '잠재', null),
  (265, '캐스탑', '이탈', null),
  (270, '다산', '활성', null),
  (275, '동우정공', '활성', null),
  (277, '대동정밀', '활성', null),
  (280, '이송', '잠재', null),
  (284, '영동테크', '활성', null),
  (289, '성화기계', '활성', null),
  (291, '나이스테크', '잠재', null),
  (292, '신은실업', '잠재', null),
  (293, '대호하이드로릭', '활성', null),
  (294, '델릭스', '활성', null),
  (298, '원진BMT', '잠재', null),
  (299, '용진정밀', '활성', null),
  (304, '가유', '잠재', null),
  (311, '대림자동차', '활성', null),
  (312, '한국츠바키모토오토모티브', '활성', null),
  (313, 'DY POWER', '활성', null),
  (314, '성우IMS', '활성', null),
  (315, '두산모트롤', '활성', null),
  (316, '신한밸브', '활성', null),
  (317, '세원기계', '활성', null),
  (319, '쌍용자동차', '활성', null),
  (322, '창원기계공고', '잠재', null),
  (323, '동광테크', '활성', null),
  (324, '동명테크', '잠재', null),
  (327, 'CTR(씨티알)', '잠재', null),
  (328, '한화테크윈', '잠재', null),
  (329, '에스지솔루션', '활성', null),
  (333, 'ORS KOREA', '활성', null),
  (334, '화천기계', '활성', null),
  (337, '두산에너빌리티', '활성', null),
  (339, 'GSMK', '활성', null),
  (340, '델릭스', '활성', null),
  (342, '두산모트롤', '활성', null),
  (345, '신화열처리', '활성', null),
  (347, '회원이엔지', '잠재', null),
  (349, '센트랄CMS', '잠재', null),
  (354, '엠에스테크', '잠재', null),
  (356, '영신쿼츠', '잠재', null),
  (357, '동진', '활성', null),
  (360, '대경정밀', '잠재', null),
  (361, '연암공업전문대학', '잠재', null),
  (362, '대명금속', '잠재', null),
  (363, '경상대학교 공과대 기계항공공학부', '잠재', null),
  (368, '동진기계', '잠재', null),
  (369, '우영정밀', '잠재', null),
  (371, '성원산업', '잠재', null),
  (372, '티더블류아이', '잠재', null),
  (375, '두성지텍', '잠재', null),
  (377, '광진정공', '잠재', null),
  (378, '성현기계', '잠재', null),
  (379, '한일정밀', '잠재', null),
  (380, '논산정밀', '잠재', null),
  (385, '신흥유압산업', '잠재', null),
  (387, '이룸지텍', '활성', null),
  (390, '대명금속', '잠재', null),
  (395, '조양기계금속', '잠재', null),
  (396, 'TWI(티더블유아이)', '활성', null),
  (405, '호원산업', '활성', null),
  (407, '도울테크', '활성', null),
  (416, 'KH 트레이딩', '잠재', null),
  (435, '켐스', '잠재', null),
  (437, 'CESCO', '잠재', null),
  (439, '썬스타특수정밀 (폐업)', '이탈', null),
  (440, '코아링크', '이탈', null),
  (443, '대영기계공업', '활성', null),
  (446, '네오세미테크', '이탈', null),
  (447, '두산인프라코어', '잠재', null),
  (448, '동화상협', '잠재', null),
  (450, '대한특수금속', '잠재', null),
  (451, '국제다이아몬드공업', '활성', null),
  (452, '썬하이드로릭스 코리아', '활성', null),
  (453, '한국생산기술연구원 KITECH', '잠재', null),
  (457, '이오텍', '잠재', null),
  (458, '지엠케이', '활성', null),
  (460, '핸즈', '잠재', null),
  (461, 'EXA', '잠재', null),
  (462, '세원ing', '잠재', null),
  (463, 'SGO', '활성', null),
  (464, '카스윈 (창원본사로 이전 )', '이탈', null),
  (468, '부흥정밀', '활성', null),
  (469, '한국NTK세라믹', '잠재', null),
  (473, '두진금형', '잠재', null),
  (474, '한국디케이세라믹', '잠재', null),
  (475, '동양화학공업 이리전자재료공장', '잠재', null),
  (477, '남성쎄라믹', '잠재', null),
  (478, '대호기계공업', '이탈', null),
  (479, '일진소재산업', '잠재', null),
  (482, '한국폴리텍대학 익산캠퍼스', '활성', null),
  (483, 'EPK', '잠재', null),
  (489, '6STC', '잠재', null),
  (490, '암시스', '잠재', null),
  (492, '하이파워', '활성', null),
  (493, '훌루테크 의령 2공장', '활성', null),
  (495, '한국보그워너티에스', '잠재', null),
  (496, '금아슈미터', '잠재', null),
  (500, '일진디스플레이', '잠재', null),
  (501, '우지막코리아', '잠재', null),
  (502, '세아메탈', '잠재', null),
  (504, '케이에이씨', '잠재', null),
  (507, 'KAC', '잠재', null),
  (508, '케이엠텍', '활성', null),
  (509, '한성이엔지', '잠재', null),
  (515, '한국무브넥스', '활성', null),
  (534, '송원페라이트', '잠재', null),
  (536, '고합', '잠재', null),
  (546, '아일엠테크', '잠재', null),
  (552, '메티아', '이탈', null),
  (558, '비전테크 -> 폐업', '이탈', null),
  (561, '효성', '잠재', null),
  (563, 'KD케미칼', '이탈', null),
  (569, '동아시스템즈', '이탈', null),
  (572, 'INCOCHEM(인코쳄)-폐업', '이탈', null),
  (573, 'KITECH(한국생산기술연구원)', '잠재', null),
  (575, '대흥산업', '잠재', null),
  (580, '씨티알모빌리티', '활성', null),
  (583, '동아기업', '활성', null),
  (587, '울산정보산업진흥원', '이탈', null),
  (595, '고려아연', '활성', null),
  (598, '한국 무브넥스 4공장', '활성', null),
  (599, '홍영정밀', '활성', null),
  (604, '청호산업', '활성', null),
  (615, '정진기계', '잠재', null),
  (617, '성지정공', '잠재', null),
  (618, '보부하이테크', '활성', '용인'),
  (619, '아이원스', '잠재', null),
  (620, '엘엠텍', '활성', null),
  (621, '플라텍', '활성', null),
  (630, 'KCC(케이씨씨)', '잠재', null),
  (631, '대송', '잠재', null),
  (635, 'PARK&OPC', '잠재', null),
  (639, '아이엠디', '잠재', null),
  (641, '수원금속', '활성', null),
  (642, '램리서치', '잠재', null),
  (644, '케이아이씨', '잠재', null),
  (647, '이에스티', '활성', null),
  (649, 'EST', '활성', null),
  (659, '경북하이브리드 부품연구원', '활성', null),
  (663, '두알산업', '잠재', null),
  (665, '미래테크', '활성', null),
  (680, '동진정밀', '잠재', null),
  (683, '경도광전자공업', '잠재', null),
  (684, '대영', '잠재', null),
  (685, '경도', '이탈', null),
  (686, '코렌스', '이탈', null),
  (688, '서산툴링', '활성', null),
  (691, '대성나찌', '활성', null),
  (692, '화승R&A', '활성', null),
  (693, 'KOS LIMITID', '잠재', null),
  (694, '포스텍전자', '잠재', null),
  (695, '대진', '잠재', null),
  (696, '조광ILI', '잠재', null),
  (697, '태평양밸브', '활성', null),
  (703, '유정하이텍', '활성', null),
  (707, '동일기계공업', '활성', null),
  (714, '한솔아이원스', '활성', null),
  (715, 'KJ테크노', '활성', null),
  (716, '삼우테크', '활성', null),
  (718, '아이블포토닉스', '잠재', null),
  (726, '케이티에스정공', '잠재', null),
  (730, '유현전자', '잠재', null),
  (731, '풍원화학', '활성', null),
  (732, 'JL테크 (폐업)', '이탈', null),
  (736, '비츠로넥스텍', '활성', null),
  (737, '동광기공', '잠재', null),
  (739, '에스아이티', '활성', null),
  (740, '삼보기공', '활성', null),
  (742, '유니플로', '활성', null),
  (743, '서구산업', '잠재', null),
  (747, '태양금속공업', '활성', null),
  (750, '드림텍', '잠재', null),
  (752, '서진캠', '활성', null),
  (756, '삼성디스플레이', '잠재', null),
  (757, '삼성코닝정밀소재', '잠재', null),
  (761, '디에이치', '활성', null),
  (764, '케이엔제이', '활성', null),
  (772, '한국교정기술원', '활성', null),
  (773, '유한테크', '활성', null),
  (774, '동원시스템즈', '활성', null),
  (780, '동우HST', '활성', null),
  (790, 'SAMD( 화성이동 후 폐업)', '이탈', null),
  (793, '성우에이텍', '이탈', null),
  (794, '조이', '잠재', null),
  (797, '하니웰코리아', '잠재', null),
  (800, '동서기공', '잠재', null),
  (801, 'JOY', '활성', null),
  (803, '동림산업', '활성', null),
  (806, '제현정공', '활성', null),
  (807, '유압사랑', '활성', null),
  (808, '현대스틸', '활성', null),
  (810, 'SPEEDFAM IPEC KOREA CO.,LTD.', '잠재', null),
  (811, '유니메이트', '잠재', null),
  (813, '덴티움', '활성', null),
  (814, '요꼬가와인스트루먼트코리아', '잠재', null),
  (817, '파웰코퍼레이션', '활성', null),
  (818, '일레븐전자', '활성', null),
  (819, '대명테크놀러지', '잠재', null),
  (820, '알에프랩', '활성', null),
  (821, 'SKC', '잠재', null),
  (826, '모코', '활성', null),
  (829, '오투컴', '잠재', null),
  (830, 'HPPK', '활성', null),
  (831, '룩테크', '활성', null),
  (833, '코렌텍', '활성', null),
  (834, '체육과학연구원', '잠재', null),
  (835, '우영', '잠재', null),
  (836, '도레이새한', '잠재', null),
  (837, '제일메디컬', '이탈', null),
  (840, '세원', '활성', null),
  (842, '한국메디칼 사무라이(P&B)', '잠재', null),
  (843, '아이메저', '이탈', null),
  (859, '정원산기', '잠재', null),
  (860, '미래항공', '잠재', null),
  (864, '태진하이테크(오광사)', '잠재', null),
  (873, '회명옵틱스', '활성', null),
  (877, '한국경남태양유전', '활성', null),
  (880, '캑터스오토모티브', '활성', null),
  (881, 'KIMEAS', '이탈', null),
  (882, '신양', '이탈', null),
  (883, '원태정밀', '잠재', null),
  (886, '한국동부공업', '이탈', null),
  (888, '부산공업계고교', '잠재', null),
  (889, '대한항공', '잠재', null),
  (890, '부산특수금속공업사', '잠재', null),
  (891, '한국미마 (명성물산)', '잠재', null),
  (896, '협동금속', '잠재', null),
  (897, '풍산기계', '이탈', null),
  (898, '큐엔큐', '활성', null),
  (899, '한양공업', '잠재', null),
  (901, '화영오토텍', '잠재', null),
  (902, '한조', '잠재', null),
  (904, '부경대학교 정밀측정', '이탈', null),
  (905, '케이에스비세일 (구 세일세레스)', '이탈', null),
  (906, '스타리온', '잠재', null),
  (907, 'YCP CO,.LTD.', '활성', null),
  (908, '크리우스 (구, 유엔에스)', '잠재', null),
  (909, '부산마린텍', '잠재', null),
  (910, 'PMT', '잠재', null),
  (927, '대헌정밀', '활성', null),
  (936, 'SG솔루션', '활성', null),
  (937, '아엠비하이드로릭스', '활성', null),
  (939, '에스엔에스아이엔씨', '잠재', null),
  (942, '대영기계공업', '활성', null),
  (943, '팍스텍', '이탈', null),
  (944, '경일지엠씨', '활성', null),
  (946, '서한오토멕시코', '활성', null),
  (950, '신창핫멜트', '잠재', null),
  (951, '트리스', '잠재', null),
  (953, '한국 에너지 과학 기술 연구원', '잠재', null),
  (955, '웅진에너지', '잠재', null),
  (957, '명일', '잠재', null),
  (958, '사이버메드', '활성', null),
  (964, '대우기전', '이탈', null),
  (967, '삼립산업', '이탈', null),
  (969, '대성정기', '잠재', null),
  (971, '성림', '잠재', null),
  (976, '영일정공', '활성', null),
  (978, '태평전자', '잠재', null),
  (979, '평화크러치', '잠재', null),
  (984, '삼영금속공업', '잠재', null),
  (987, 'SHINAN', '잠재', null),
  (991, '유성PM공업', '잠재', null),
  (993, '금영정공-폐업', '이탈', null),
  (994, '삼원유압', '잠재', null),
  (995, '영광산업', '잠재', null),
  (997, 'TAK', '잠재', null),
  (1002, '스틸에이', '활성', null),
  (1009, '성진포머', '이탈', null),
  (1013, '진일공업', '활성', null),
  (1016, '범서', '잠재', null),
  (1017, '현진정공', '활성', null),
  (1018, '토인 무라텍', '잠재', null),
  (1020, '케이엔티(KNT)', '활성', null),
  (1021, 'CS정밀-폐업', '이탈', null),
  (1022, '부선', '이탈', null),
  (1025, '삼금', '활성', null),
  (1027, '대명공업', '잠재', null),
  (1028, '근우정공', '활성', null),
  (1030, '삼양금속', '활성', null),
  (1031, '용화기계', '이탈', null),
  (1032, '피앤이글로벌', '활성', null),
  (1033, '대영코어텍', '활성', null),
  (1034, '한국폴리텍 대학', '잠재', null),
  (1040, '토인', '활성', null),
  (1042, '마이크로엔엑스', '활성', null),
  (1045, '삼보모터스', '잠재', null),
  (1059, '화성밸브', '활성', null),
  (1065, 'KD금속', '활성', null),
  (1066, '태진이엔지', '활성', null),
  (1069, '프로텍', '활성', null),
  (1072, '삼기', '활성', null),
  (1081, '인지AMT', '활성', null),
  (1082, '제일정밀', '잠재', null),
  (1083, '동진전기', '잠재', null),
  (1084, '적고', '잠재', null),
  (1086, '와스텍기연', '활성', null),
  (1088, '경남테크노파크-폐업', '이탈', null),
  (1090, '에이스정밀', '잠재', null),
  (1094, '태화스핀들', '활성', null),
  (1098, '칼소닉칸세이코리아', '활성', null),
  (1099, '금강테크', '잠재', null),
  (1100, '우승(범아유니텍)', '활성', null),
  (1102, '삼우', '활성', null),
  (1106, '화영상사', '활성', null),
  (1111, '성진오토모빌', '활성', null),
  (1113, '연암테크 김해공장', '활성', null),
  (1114, '대경기업', '이탈', null),
  (1116, 'KDA 2공장', '활성', null),
  (1117, '원태다이캐스팅', '활성', null),
  (1118, '에스비씨리니어', '잠재', null),
  (1121, '한국씰마스터(KSM)', '활성', null),
  (1122, '아주스틸', '활성', null),
  (1125, '일강(김제공장)', '활성', null),
  (1131, 'SIMULINE 시뮬라인', '잠재', null),
  (1132, '한국건자재시험연구원(KCL)', '잠재', null),
  (1133, '현대케피코', '잠재', null),
  (1136, '제일합섬', '이탈', null),
  (1140, '한국I.G모터', '이탈', null),
  (1141, 'NEG(한국전기초자)', '이탈', null),
  (1142, '효성B&H', '이탈', null),
  (1143, '동아제약', '이탈', null),
  (1148, '동양전자초자', '잠재', null),
  (1154, '태석기계', '이탈', null),
  (1161, '삼성코닝정밀유리', '잠재', null),
  (1171, '동경계측기 (LG마이크론)', '잠재', null),
  (1174, '한국계측기', '잠재', null),
  (1175, '동경계측기', '잠재', null),
  (1177, '일본전기초자', '잠재', null),
  (1185, '아신큐엔텍', '활성', null),
  (1189, '신광금형', '잠재', null),
  (1190, '신원테크', '이탈', null),
  (1192, 'KEC세미컨덕터', '활성', null),
  (1194, '대광정밀(MS테크)', '이탈', null),
  (1196, 'KTG 구미사업장', '잠재', null),
  (1198, '동경계측기(STX ENPACO)', '잠재', null),
  (1199, '원광테크', '잠재', null),
  (1200, '인탑스', '잠재', null),
  (1201, '기성엔지니어링', '잠재', null),
  (1207, '성진정밀', '활성', null),
  (1210, '대성정밀(WHITE KOREA)', '잠재', null),
  (1215, '폴리텍 구미캠퍼스', '활성', null),
  (1218, 'LT', '잠재', null),
  (1223, '주광정밀', '활성', null),
  (1228, 'STP', '활성', null),
  (1230, '원익', '활성', null),
  (1237, '아세아자동차공업', '이탈', null),
  (1241, '불암 엔지니어링', '이탈', null),
  (1243, 'LG전자부품', '잠재', null),
  (1244, '태정산업', '잠재', null),
  (1246, '명성샤프트', '잠재', null),
  (1247, '옵테론', '잠재', null),
  (1252, '씨티에스', '잠재', null),
  (1254, '큐블락', '활성', null),
  (1255, '케이에스티이', '활성', null),
  (1256, '예리코코리아', '활성', null),
  (1258, '대신메탈라이징', '잠재', null),
  (1261, '명성정공', '잠재', null),
  (1262, '대광소결', '잠재', null),
  (1263, '일진단조', '잠재', null),
  (1264, '아폴로산업 (폴리텍)', '이탈', null),
  (1265, '만도기계', '잠재', null),
  (1269, '용강산업', '잠재', null),
  (1275, '석천오토모티브', '잠재', null),
  (1277, '유원', '잠재', null),
  (1288, '엠케이테크', '활성', null),
  (1291, 'HD사이트솔루션(현대중공업 내)', '활성', null),
  (1293, '성신금속-폐업', '이탈', null),
  (1298, '건아정밀', '잠재', null),
  (1299, '서원산업-폐업', '이탈', null),
  (1303, '솔로몬테크', '활성', null),
  (1306, '동흥산업-폐업', '이탈', null),
  (1309, '데이먼인더스트리', '활성', null),
  (1310, '우성오토텍', '이탈', null),
  (1311, '티에스경주(TS경주)', '잠재', null),
  (1313, '에이스테크 - 폐업', '이탈', null),
  (1315, '동양테크', '활성', null),
  (1319, '동화정밀공업', '활성', null),
  (1320, '바램상사', '활성', null),
  (1330, '대진하이테크', '잠재', null),
  (1332, '동영테크', '활성', null),
  (1333, '태한', '활성', null),
  (1339, '제일이엔앰', '활성', null),
  (1341, '양정엔지니어링', '잠재', null),
  (1342, '대영금속', '이탈', null),
  (1345, '삼광', '잠재', null),
  (1347, '대명산업-폐업', '이탈', null),
  (1351, '삼성중공업', '활성', null),
  (1352, '에프셀텍', '잠재', null),
  (1353, '한국폴리텍 강원 캠퍼스', '잠재', null),
  (1355, '동민산업', '활성', null),
  (1356, '네카로', '활성', null),
  (1363, '아크레텍 울산사무소(테스트 데이터)', '활성', null),
  (1366, 'DH하이드록스', '활성', null),
  (1368, '에스엔케이항공(S&K AEROSPACE)', '활성', null),
  (1369, 'TSP', '활성', null),
  (1383, '대륭공업사', '활성', null),
  (1406, '디엠테크', '활성', null),
  (1416, '태성테크윈', '활성', null),
  (1440, 'TJT ENG', '활성', null),
  (1446, '하이에스지', '활성', null),
  (1451, '태창기업', '활성', null),
  (1453, '아크레텍코리아 구미사무실', '활성', null),
  (1454, '제이텍트베어링스코리아', '활성', null),
  (1456, '트라닉스', '활성', null),
  (1457, '케이세라(K-CERA)', '활성', null),
  (1458, '오성모빌리티', '활성', null),
  (1465, '성경산업', '활성', null),
  (1467, '더썬', '활성', null),
  (1468, '삼성정공', '활성', null),
  (1470, '네오마그네틱', '활성', null),
  (1471, '헨켈코리아', '활성', null),
  (1472, '써모피셔사이언티픽코리아', '활성', null),
  (1474, '정광테크', '활성', null),
  (1475, '동진테크', '활성', null),
  (1476, 'HD건설기계', '활성', null),
  (1748, '신성기계', '활성', null),
  (1749, '경창산업', '활성', null),
  (1750, '아이넥스엠에이티', '활성', null),
  (1753, '이원머티리얼즈', '활성', null),
  (1760, '일신프라스틱', '활성', null),
  (1762, '주영정공', '활성', null),
  (1763, '성광정밀', '활성', null),
  (1764, '대진이엔지', '활성', null),
  (1765, '디아이티', '활성', null),
  (1766, '알에스교정센터', '활성', null),
  (1767, '하나무역', '활성', null),
  (1771, '현대남양연구소', '활성', null),
  (1772, 'WIKA Korea Ltd. - 비카코리아', '활성', null),
  (1774, '테스트 테스트', '활성', null),
  (1775, '엠엠티에스엠', '활성', null),
  (1776, '유니테크노', '활성', null),
  (1778, '더드림코리아', '활성', null),
  (1780, '세림정공', '활성', null),
  (1781, '효성전기', '활성', null),
  (1782, '모토닉', '활성', null),
  (1783, '신한산전', '활성', null),
  (1787, '대리정밀', '활성', null),
  (1788, '이노테크', '활성', null),
  (1789, '퍼시픽엑스코리아', '활성', null),
  (1790, '계양정밀', '활성', null),
  (1791, '유림테크', '활성', null),
  (1792, '유림산', '활성', null),
  (1793, '동평테크', '활성', null),
  (1794, '세일공업', '활성', null),
  (1795, '아진테크', '활성', null),
  (1796, '명신정공', '잠재', null),
  (1797, '세명정공', '활성', null),
  (1800, '킴스텍', '활성', null),
  (1804, '용마', '활성', null),
  (1805, '디엠모티브', '잠재', null),
  (1806, '쿠어스텍코리아', '활성', null),
  (1807, '우수정기(우수AMS)', '활성', null),
  (1811, '비엠솔루션', '활성', null),
  (1812, '서브원', '활성', null),
  (1815, '삼인하이테크', '활성', null),
  (1816, '셰플러코리아', '활성', null),
  (1819, 'MNC Solution', '잠재', null),
  (1820, 'DM motive', '활성', null),
  (1821, '동부정밀', '활성', null),
  (1822, '한국코어텍', '활성', null),
  (1825, '보부하이테크', '활성', '강릉'),
  (1830, '효명정공', '활성', null);

-- 확인 — 570줄 / 이름 561개 / 이름마다 status 가 하나여야 한다.
select (select count(*) from public.site_promote_20261118) as 줄,
       (select count(distinct new_company_name) from public.site_promote_20261118) as 이름,
       (select count(*) from (
          select new_company_name from public.site_promote_20261118
          group by 1 having count(distinct coalesce(new_company_status, '')) > 1) t) as status갈린이름;
-- 사업장끼리 status 가 갈린 묶음(활성 > 잠재 > 이탈 로 골랐다):
--   쌍용자동차 : 잠재 / 활성 → 활성
--   일강 : 잠재 / 활성 → 활성
--   코렌텍 : 활성 / 잠재 → 활성

-- ⑤-1 회사 줄 생성 — 이름 하나당 한 줄.
with ins as (
  insert into public.customers (company_name, is_parent, status)
  select distinct new_company_name, true, new_company_status
  from public.site_promote_20261118
  returning customer_id, company_name
)
update public.site_promote_20261118 p
   set parent_customer_id = i.customer_id
from ins i
where p.new_company_name = i.company_name;

-- 확인 — 짝 못 찾은 줄 0 / 만든 회사 561개 / status 가 '이탈' 인 회사 70개.
select (select count(*) from public.site_promote_20261118 where parent_customer_id is null) as 짝못찾은줄,
       (select count(distinct parent_customer_id) from public.site_promote_20261118) as 만든회사,
       (select count(*) from public.customers where is_parent and status = '이탈' and deleted_at is null) as 이탈회사;

-- ⑤-2 붙이기. site_name 은 **승격 표에 값이 있는 줄만** 채운다(보부하이테크 두 줄).
update public.customers c
   set parent_customer_id = p.parent_customer_id,
       site_name = coalesce(nullif(p.new_site_name, ''), c.site_name)
from public.site_promote_20261118 p
where c.customer_id = p.site_customer_id;

-- 확인 — site_name 이 들어간 줄(보부하이테크 618 용인 · 1825 강릉).
select c.customer_id, c.company_name, c.site_name, p.company_name as 회사
from public.customers c
left join public.customers p on p.customer_id = c.parent_customer_id
where c.customer_id in (618, 1825)
order by c.customer_id;

-- 확인 — 회사 840 · 대리점 45 · 부모 없는 사업장은 **1**(1779, 대리점 줄) 이어야 한다.
select (select count(*) from public.customers where is_parent  and deleted_at is null) as 회사줄,
       (select count(*) from public.customers where is_agency and deleted_at is null) as 대리점줄,
       (select count(*) from public.customers
          where deleted_at is null and not is_parent and parent_customer_id is null) as 부모없는사업장,
       (select count(*) from public.customers
          where deleted_at is null and not is_parent and not is_agency and parent_customer_id is null) as 제약위반;


-- ═══════════════════════════════════════════════════════════════════════
-- ⑥ activity_types — CHECK 를 표로 (label FK · on update cascade · is_remote)
-- ═══════════════════════════════════════════════════════════════════════
create table public.activity_types (
  code       text primary key,
  label      text not null,
  sort_order int  not null default 0,
  is_active  boolean not null default true,   -- 끄면 드롭다운에서 빠진다(과거 줄은 남는다)
  is_system  boolean not null default false,  -- 사람이 못 고르는 줄(리드 등록)
  is_remote  boolean not null default false,  -- 비방문 — 동선 지도에서 뺀다(lib/routeMap.ts)
  created_at timestamptz not null default now()
);
create unique index activity_types_label_key on public.activity_types (label);

insert into public.activity_types (code, label, sort_order, is_active, is_system, is_remote) values
  ('PHONE',    '전화상담',  10, true, false, true ),
  ('VISIT',    '방문미팅',  20, true, false, false),
  ('SPEC',     '사양검토',  30, true, false, false),
  ('BID',      '경쟁입찰',  40, true, false, false),
  ('LEAD_REG', '리드 등록', 90, true, true,  false);

alter table public.activity_types enable row level security;
create policy activity_types_read on public.activity_types for select using (true);
-- 쓰기 정책은 quote_categories 의 superadmin 정책을 그대로 옮긴다
-- (lib/quoteCategories.ts 의 머리글 주석 참조 — UPDATE 가 막히면 0행 갱신으로 끝난다).

-- 확인 — 표에 없는 값이 데이터에 있나. **0건이어야 한다**(지금 9줄: 방문미팅 7·사양검토 1·리드 등록 1).
select activity_type, count(*) from public.sales_activities
where activity_type not in (select label from public.activity_types)
group by 1 order by 2 desc;

-- CHECK → FK. label 에 거는 이유 — sales_activities 의 기존 9줄을 한 줄도 쓰지 않는다.
-- ※ 제약 이름은 DB 에 있던 실제 이름이다(`sales_activities_type_check`). 처음 쓴
--   `sales_activities_activity_type_check` 는 틀린 추측이었고, 2026-11-19 적용 때 고쳤다.
alter table public.sales_activities drop constraint sales_activities_type_check;
alter table public.sales_activities
  add constraint sales_activities_activity_type_fkey
  foreign key (activity_type) references public.activity_types (label)
  on update cascade;

-- 확인
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.sales_activities'::regclass and conname like '%activity_type%';


-- ═══════════════════════════════════════════════════════════════════════
-- ⑦ 마지막 제약 — 닫힌 줄이거나, 회사이거나 대리점이거나 부모가 있어야 한다(결정 10)
-- ═══════════════════════════════════════════════════════════════════════

-- ⚠ 걸기 전에 이것이 **0건**이어야 한다. 한 줄이라도 나오면 멈추고 그 줄을 먼저 처리하라.
select customer_id, company_name, status, is_parent, is_agency, parent_customer_id
from public.customers
where deleted_at is null and not is_parent and not is_agency and parent_customer_id is null
order by customer_id;

-- 닫은 줄(deleted_at)은 제약에서 뺀다 — 병합으로 닫은 305·1730·1733·1734 와, 앞으로
-- 닫을 줄들이 부모를 잃어도 제약에 걸리지 않아야 한다. 2026-11-19 적용본의 식이다.
alter table public.customers
  add constraint customers_parent_or_company
  check (deleted_at is not null or is_parent or is_agency or parent_customer_id is not null);

-- 확인
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.customers'::regclass and conname = 'customers_parent_or_company';

-- 최종 집계 — 기대값: 살아있는 줄 2,235 · 회사 840 · 대리점 45
--              · 사업장 1,365 · 대리점 연결된 사업장 540 · 메모 있는 줄 14
select (select count(*) from public.customers where deleted_at is null) as 살아있는줄,
       (select count(*) from public.customers where deleted_at is null and is_parent) as 회사,
       (select count(*) from public.customers where deleted_at is null and is_agency) as 대리점,
       (select count(*) from public.customers where deleted_at is null and not is_parent and parent_customer_id is not null) as 사업장,
       (select count(*) from public.customers where deleted_at is null and agency_customer_id is not null) as 대리점연결된사업장,
       (select count(*) from public.customers where deleted_at is null and note is not null) as 메모있는줄;


-- ═══════════════════════════════════════════════════════════════════════
-- 되돌리기 (단계 역순)
-- ═══════════════════════════════════════════════════════════════════════
-- alter table public.customers drop constraint customers_parent_or_company;
--
-- -- ⑤-1·②-3 에서 만든 줄 걷어내기 — 백업에 없는 customer_id 가 그것이다.
-- delete from public.customers
--  where customer_id not in (select customer_id from public.customers_backup_20261118);
--
-- -- 칸 값 되돌리기(이름·메모를 고친 4줄도 여기서 돌아온다)
-- update public.customers c
--    set parent_customer_id = b.parent_customer_id,
--        site_name = b.site_name,
--        company_name = b.company_name,
--        agency = b.agency,
--        status = b.status,
--        deleted_at = b.deleted_at
--   from public.customers_backup_20261118 b
--  where b.customer_id = c.customer_id;
-- update public.customers set note = null, is_agency = false, agency_customer_id = null;
--
-- -- 참조 되돌리기(305 → 1779 로 옮긴 것)
-- update public.quotes q set customer_id = b.customer_id, dealer_id = b.dealer_id
--   from public.quotes_backup_20261118 b where b.quote_id = q.quote_id;
-- -- contacts·devices·service_history 등은 백업을 받지 않았다. 되돌릴 일이 있으면
-- -- customer_id 를 다시 305 로 바꾸면 된다(옮긴 줄 수는 ③ 확인 select 에 남는다).
--
-- alter table public.sales_activities drop constraint sales_activities_activity_type_fkey;
-- alter table public.sales_activities add constraint sales_activities_type_check
--   check (activity_type in ('전화상담','방문미팅','사양검토','경쟁입찰','리드 등록'));
-- drop table public.activity_types;
-- alter table public.customers drop column note, drop column is_agency, drop column agency_customer_id;
--
-- -- 임시 표(되돌리기가 끝났고 다시 쓸 일이 없을 때만 — 결정 15 는 「남김」이다)
-- -- drop table public.site_promote_20261118;
-- -- drop table public.agency_map_20261118;
