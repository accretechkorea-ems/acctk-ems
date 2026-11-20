-- db/service_history_empty_cleanup_20261120.sql
--
-- **빈 서비스 기록 정리** — 날짜 말고는 아무 내용이 없는 service_history 줄을 지운다.
--
-- ── 무엇이 빈 줄인가 ─────────────────────────────────────────────────────
--   내용 칸이 **전부** 비어 있고, 참여 엔지니어도 없고, 달린 자료도 없는 줄이다.
--     service_type · device_id · service_notes · etc_notes · visitor · contact_id
--     · work_hours · report_url · start_time · end_time · service_engineers
--   유무상(is_paid)은 **내용으로 치지 않는다** — 기본값 true 가 그냥 들어가 있다.
--
-- ── 이 줄들은 어디서 왔나(2026-11-20 조사) ───────────────────────────────
--   486줄 중 **130줄**이 여기 해당한다. 그 130줄의 성질:
--     · 130줄 전부 visit_year·visit_date_old(「5/24」 꼴)를 들고 있다 → 옛 자료 이관의 흔적
--     · 128줄은 service_id 가 customer_id 와 **같다** → 고객사마다 한 줄씩 만든 자국
--     · is_paid 는 130줄 모두 true(기본값)
--     · 첨부·홀딩·설치준비·견적 수리정보가 달린 줄은 **0건** (지워도 끊기는 참조가 없다)
--   즉 「마지막 방문일만 옮겨 적어 둔 줄」이고, 서비스 기록으로서의 내용은 없다.
--
-- ⚠ **지우면 생기는 일** — 이 날짜가 사라진다.
--     · 86개 고객사는 이 줄이 **유일한 접점**이다 → 「최근 활동」이 「-」가 된다.
--     · 44개 고객사는 더 최근의 다른 접점이 있어 화면이 바뀌지 않는다.
--     · 이 줄 때문에 날짜가 과거로 밀리는 고객사는 0곳이다.
--   날짜 자체를 남겨야 한다면 지우지 말고 **화면에서만 숨기는 쪽**을 골라야 한다.
--   그 판단은 사람이 한다 — 이 파일은 「지운다」를 고른 경우의 길이다.
--
-- 적용 순서: ⓞ 백업 → ① 삭제 → ② 확인. 되돌리기는 ③.
-- ④ 는 **다시 생기지 않게 하는 제약**이다(선택이지만 권한다).

begin;

-- ── ⓞ 백업 — 지우는 줄을 통째로 떠 둔다 ─────────────────────────────────
drop table if exists public.service_history_empty_backup_20261120;

create table public.service_history_empty_backup_20261120 as
select *
  from public.service_history s
 where coalesce(btrim(s.service_type), '') = ''
   and s.device_id is null
   and coalesce(btrim(s.service_notes), '') = ''
   and coalesce(btrim(s.etc_notes), '') = ''
   and coalesce(btrim(s.visitor), '') = ''
   and s.contact_id is null
   and s.work_hours is null
   and coalesce(btrim(s.report_url), '') = ''
   and s.start_time is null
   and s.end_time is null
   and not exists (select 1 from public.service_engineers e where e.service_id = s.service_id)
   and not exists (select 1 from public.service_attachments a where a.service_id = s.service_id)
   and not exists (select 1 from public.holdings h where h.service_id = s.service_id)
   and not exists (select 1 from public.service_install_prep p where p.service_id = s.service_id);

comment on table public.service_history_empty_backup_20261120 is
  '2026-11-20 빈 서비스 기록 정리 전 백업. 되돌리려면 이 표에서 service_history 로 다시 넣는다.';

-- 몇 줄을 떴는지 — 조사와 같은 수(130)여야 한다.
select count(*) as "백업한 줄" from public.service_history_empty_backup_20261120;

-- ── ① 삭제 ──────────────────────────────────────────────────────────────
--   service_history 에는 deleted_at 칸이 **없다** — 숨김이 아니라 실제 삭제다.
--   id 를 하드코딩하지 않는다. 조건이 그대로 기준이다(백업과 **같은 조건**).
delete from public.service_history s
 where coalesce(btrim(s.service_type), '') = ''
   and s.device_id is null
   and coalesce(btrim(s.service_notes), '') = ''
   and coalesce(btrim(s.etc_notes), '') = ''
   and coalesce(btrim(s.visitor), '') = ''
   and s.contact_id is null
   and s.work_hours is null
   and coalesce(btrim(s.report_url), '') = ''
   and s.start_time is null
   and s.end_time is null
   and not exists (select 1 from public.service_engineers e where e.service_id = s.service_id)
   and not exists (select 1 from public.service_attachments a where a.service_id = s.service_id)
   and not exists (select 1 from public.holdings h where h.service_id = s.service_id)
   and not exists (select 1 from public.service_install_prep p where p.service_id = s.service_id);

commit;

-- ── ② 확인 ──────────────────────────────────────────────────────────────
-- 남은 빈 줄 — 0 이어야 한다.
select count(*) as "남은 빈 줄"
  from public.service_history s
 where coalesce(btrim(s.service_type), '') = ''
   and s.device_id is null
   and coalesce(btrim(s.service_notes), '') = ''
   and coalesce(btrim(s.etc_notes), '') = ''
   and coalesce(btrim(s.visitor), '') = ''
   and s.contact_id is null
   and s.work_hours is null
   and coalesce(btrim(s.report_url), '') = ''
   and s.start_time is null
   and s.end_time is null
   and not exists (select 1 from public.service_engineers e where e.service_id = s.service_id);

-- 전체 줄 수 — 486 → 356 이어야 한다.
select count(*) as "서비스 기록 전체" from public.service_history;

-- 연도별로 얼마나 줄었는지(지운 줄 기준).
select coalesce(left(visit_date::text, 4), '(없음)') as "연도", count(*) as "지운 줄"
  from public.service_history_empty_backup_20261120
 group by 1 order by 1;

-- ── ③ 되돌리기 ──────────────────────────────────────────────────────────
-- 잘못 지웠다면 아래 한 문장으로 전부 되돌아온다(기본키까지 그대로 들어간다).
--
--   insert into public.service_history
--   select * from public.service_history_empty_backup_20261120;
--
-- 되돌린 뒤에는 시퀀스를 손볼 필요가 없다 — 지웠던 id 를 그대로 쓰기 때문이다.
-- 다 끝나 백업이 필요 없어지면:  drop table public.service_history_empty_backup_20261120;

-- ── ④ 다시 생기지 않게(권장) ────────────────────────────────────────────
--   화면에는 이미 빗장이 있다 — 등록·수정 폼이 방문일·서비스 내용·고객 담당자·방문
--   엔지니어를 모두 받아야 저장된다(components/customer/modals/ServiceAddModal.tsx).
--   그래도 DB 쪽에 한 겹 더 둔다. 폼을 거치지 않는 길(이관 스크립트·수작업 INSERT)이
--   다시 생겨도 빈 줄이 들어오지 못하게 한다.
--
--   ① 을 돌리기 **전에** 걸면 기존 빈 줄 때문에 실패한다 — 반드시 삭제 뒤에 건다.
alter table public.service_history
  add constraint service_history_not_empty
  check (
    coalesce(btrim(service_type), '') <> ''
    or device_id is not null
    or coalesce(btrim(service_notes), '') <> ''
    or coalesce(btrim(etc_notes), '') <> ''
    or coalesce(btrim(visitor), '') <> ''
  );

comment on constraint service_history_not_empty on public.service_history is
  '날짜만 있는 빈 기록을 막는다. 종류·장비·내용·기타메모·방문자 중 하나는 있어야 한다(2026-11-20).';
