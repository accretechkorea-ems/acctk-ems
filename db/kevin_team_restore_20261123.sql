-- 권재원(engineers.engineer_id = 4)의 팀을 **원래대로** (2026-11-23)
--
-- 왜 옮겼었나
--   사업부 전환을 teams.can_switch_division 하나로만 판정하던 동안에는, 전사를 봐야 하는
--   슈퍼관리자가 **전환되는 팀으로 옮겨 앉아야** 했다(「임원」). 그 자국이 명함 등록자
--   표시에 「권재원 · 임원」으로 남는다.
--
-- 왜 이제 되돌려도 되나
--   lib/division.ts 의 canSwitchDivision 이 **슈퍼관리자를 먼저 본다**(2026-11-23).
--   팀이 무엇이든 전환이 유지된다. 그러니 팀은 제자리로 돌린다.
--
-- 원래 팀 = **80CS**
--   근거: db/team_division_switch_20261123.sql ② 의 주석 —
--     「지금 전환 권한을 가진 재직자가 속한 팀 … 임원(이상철) · 80CS(권재원)」
--   그 파일을 쓴 2026-11-23 시점에 권재원은 80CS 였다. 팀 10번으로 지금도 있다.
--   ⚠ 사람이 보고 다르면 돌리기 전에 고친다 — 아래 [0단계] 로 먼저 눈으로 본다.
--
-- 「임원」 팀의 can_switch_division 은 **그대로 둔다**(이상철·박종해가 그 팀이다).
-- 칸을 바꾸지 않으므로 notify 는 필요 없다.
--
-- 재실행 안전 — 같은 값을 다시 쓴다.

-- ── [0단계] 눈으로 먼저 (읽기만) ──────────────────────────────────────────
--   select engineer_id, name, teams, permission_level
--     from public.engineers where engineer_id = 4;
--   -- 기대: 권재원 · 임원 · superadmin
--   select id, name, division, can_switch_division
--     from public.teams where name in ('80CS', '임원');
--   -- 기대: 80CS(계측, false) · 임원(계측, true)

-- ── ① 되돌리기 ────────────────────────────────────────────────────────────
update public.engineers
   set teams = '80CS'
 where engineer_id = 4
   and name = '권재원';          -- 사람이 바뀐 자리에 잘못 쓰지 않게 이름도 함께 본다

-- ── ② 확인 (읽기만) ───────────────────────────────────────────────────────
--   select engineer_id, name, teams from public.engineers where engineer_id = 4;
--   -- 기대: 권재원 · 80CS
--   -- 화면: 사이드바에 사업부 토글이 **그대로 보인다**(슈퍼관리자라서).
--   --       80CS 는 can_switch_division = false 지만 전환은 유지된다.

-- ── 되돌리기 ──────────────────────────────────────────────────────────────
--   update public.engineers set teams = '임원' where engineer_id = 4;

-- ── 손대지 않는 것 ────────────────────────────────────────────────────────
--   · teams 의 can_switch_division (임원·경영지원 둘 다 그대로 둔다)
--   · engineers.can_switch_division (옛 칸 — 코드가 더 이상 읽지 않는다)
--   · 이미 담긴 명함의 registered_team 글자 — **그때의 기록**이라 바꾸지 않는다
--     (business_cards 는 등록 시점 스냅샷을 글자로 들고 있다. 지난 줄은 「권재원 · 임원」
--      으로 남고, 이 뒤에 담는 줄부터 「권재원 · 80CS」가 된다)
