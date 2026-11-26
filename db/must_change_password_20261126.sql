-- 비밀번호 **초기화 뒤 강제 변경** 표식 (2026-11-26)
--
-- ── 왜 ───────────────────────────────────────────────────────────────────
--   관리자가 직원의 비밀번호를 임시값으로 바꿔 주면, 그 임시값은 **한 번만** 보여 주고
--   사라진다(화면에 띄우고 닫으면 끝. 어디에도 저장하지 않는다). 받은 사람은 그것으로
--   한 번 들어와 **제 비밀번호로 바꿔야** 한다 — 임시값이 계속 살아 있으면 그것을 아는
--   사람이 둘이 된다. 그 「바꿔야 함」을 이 칸이 들고 있다.
--
--   true  → 로그인 뒤 어느 화면으로 가든 /account/change-password 로 보낸다(미들웨어).
--   false → 평소. 새 비밀번호를 저장하는 순간 false 가 된다.
--
-- ── 적용 전에도 화면은 돈다 ──────────────────────────────────────────────
--   칸이 없으면(42703) 라우트는 **비밀번호만 바꾸고** 표식은 건너뛴다. 강제 이동도 없다
--   (미들웨어가 조회에 실패하면 그대로 들여보낸다 — 판정 자료를 못 읽었다고 사람을
--   막지 않는다. 퇴사 판정과 같은 규칙이다).
--   즉 적용 전에는 「초기화는 되지만 바꾸라고 떠밀지는 않는다」가 된다.
--
-- 재실행 안전 — add column if not exists.

alter table public.engineers
  add column if not exists must_change_password boolean not null default false;

comment on column public.engineers.must_change_password is
  '관리자가 비밀번호를 초기화했다. true 면 로그인 뒤 /account/change-password 로 보낸다(새 비밀번호를 저장하면 false).';

-- 미들웨어가 **화면 이동마다** 읽는 자리다. 퇴사 판정과 같은 한 줄 조회에 얹힌다
-- (engineers.email 로 찾는다 — 그 인덱스가 이미 쓰인다).


-- ── 확인 ─────────────────────────────────────────────────────────────────
--   select column_name, data_type, column_default, is_nullable
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'engineers'
--      and column_name = 'must_change_password';            → 1행 · boolean · false · NO
--
--   select must_change_password, count(*) from public.engineers
--    group by must_change_password;                          → 전원 false 로 시작한다

notify pgrst, 'reload schema';
