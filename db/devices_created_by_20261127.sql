-- **장비 줄을 만든 사람** — devices.created_by (2026-11-27, 묶음4 G1)
--
-- ── 왜 ───────────────────────────────────────────────────────────────────
--   「납품 예정」 장비 줄의 **주인**을 정하는 규칙이 2026-11-27 에 정해졌다:
--
--     ① 그 줄을 만든 견적(source_quote_id)의 **작성자**
--     ② 없으면 **그 줄을 만든 사람**(created_by)      ← 이 칸이 필요해서 만든다
--     ③ 둘 다 없으면 **홈 할 일에 띄우지 않는다** — 사업장 화면에만 둔다
--
--   ②가 없으면, 발주를 거치지 않고 손으로 넣은 「납품 예정」 줄이 **누구의 할 일도 아닌
--   채** 떠다닌다. 지금 홈은 ①만 보므로 그런 줄은 아무에게도 안 보인다 — 그래서 사람이
--   「넣어 뒀는데 왜 안 뜨지」를 묻는다. ③을 **규칙으로 못 박으려면** ②가 먼저 있어야 한다.
--
--   ⚠ **옛 줄은 채우지 않는다.** 지금 있는 줄의 작성자는 어디에도 남아 있지 않다
--     (장비 표에 사건 기록이 없다). 비워 두면 규칙 ③이 받아 사업장 화면에만 선다 —
--     틀린 사람에게 할 일을 붙이는 것보다 낫다.
--
-- 재실행 안전 — add column if not exists.

alter table public.devices
  add column if not exists created_by integer references public.engineers(engineer_id) on delete set null;

comment on column public.devices.created_by is
  '이 장비 줄을 만든 사람. 납품 예정 줄의 주인을 정할 때 source_quote 작성자 다음으로 본다(2026-11-27).';

-- 홈이 「내가 만든 납품 예정 줄」을 찾는 자리. 그 줄만 모이므로 부분 인덱스로 둔다.
create index if not exists devices_created_by_pending_idx
  on public.devices (created_by)
  where created_by is not null and status = '납품 예정';

notify pgrst, 'reload schema';
