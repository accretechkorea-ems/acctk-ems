-- **납품 예정 장비** — devices 에 칸 둘 (2026-11-26, 교정 칸 제거 후)
--
-- ── 왜 ───────────────────────────────────────────────────────────────────
--   수주(발주서 등록)가 끝나면 그 사업장에 **곧 들어올 장비**가 정해진다. 지금은 설치가
--   끝나고 누군가 손으로 등록할 때까지 그 장비가 어디에도 없다 — 「언제 무엇이 들어오는가」를
--   묻는 자리(홈·사업장 화면)가 답할 수 없었다. 그래서 발주 등록 때 **`status = '납품 예정'`**
--   줄을 미리 만든다.
--
--   칸 둘
--     install_due_month    설치 예정월 'YYYY-MM'(납품 예정 장비만 찬다)
--     source_quote_id      그 줄을 만든 견적 — 발주가 취소되면 **그 줄만** 숨긴다
--
--   ⚠ 2026-11-26 지시로 **교정 예정일(next_calibration_date)은 빼기로 했다** — 홈 타일·카드와
--     교정 레포트의 자동 세팅까지 함께 지웠다. 이 파일은 그 뒤의 모습이다. 다시 필요해지면
--     「무엇을 교정이라 부르는가」(서비스 유형·주기)부터 정해야 한다.
--
-- ⚠ **status 의 CHECK 제약은 건드리지 않는다.** devices.status 는 글자 칸이고 기본값이
--   '사용중' 이다(2026-11-02 확인). 제약이 걸려 있지 않다면 '납품 예정' 은 그냥 들어간다.
--   혹시 제약이 있어 insert 가 23514 로 막히면 아래 [선택] 블록을 풀어 돌린다 —
--   제약 이름·값을 눈으로 보고 고치는 쪽이 안전하다(모르고 지우면 옛 값이 풀린다).
--
-- 재실행 안전 — add column if not exists.

alter table public.devices
  add column if not exists install_due_month     text,
  add column if not exists source_quote_id       bigint references public.quotes(quote_id) on delete set null;

comment on column public.devices.install_due_month is '설치 예정월 YYYY-MM — status = ''납품 예정'' 인 줄만 찬다.';
comment on column public.devices.source_quote_id is '이 줄을 만든 견적(발주). 발주가 취소되면 그 줄만 숨긴다.';

-- 발주 취소가 그 발주의 장비를 찾는 자리.
create index if not exists devices_source_quote_idx
  on public.devices (source_quote_id) where source_quote_id is not null;


-- ════════════════════════════════════════════════════════════════
-- [선택] status 에 CHECK 가 걸려 있어 '납품 예정' 이 막힐 때만
-- ════════════════════════════════════════════════════════════════
--
-- 먼저 **무엇이 걸려 있는지 눈으로 본다**:
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid = 'public.devices'::regclass and contype = 'c';
--
-- 그 정의에 status 가 들어 있고 '납품 예정' 이 빠져 있으면, **그 정의를 그대로 옮겨 적고**
-- 값 하나만 더해 다시 건다(아래는 보기일 뿐이다 — 실제 이름·값으로 바꿔라).
--
--   alter table public.devices drop constraint devices_status_check;
--   alter table public.devices add constraint devices_status_check
--     check (status in ('사용중', '폐기', '납품 예정'));


-- ── 확인 ─────────────────────────────────────────────────────────────────
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'devices'
--      and column_name in ('install_due_month', 'source_quote_id');  → 2행
--   select status, count(*) from public.devices group by status;

notify pgrst, 'reload schema';
