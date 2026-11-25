-- teams 의 **임시 쓰기 권한 회수** (2026-11-26)
--
-- ── 왜 ───────────────────────────────────────────────────────────────────
--   2026-11-23 에 팀 추가·삭제를 화면에서 해 보려고 `grant insert, delete on teams
--   to authenticated` 를 임시로 주었다(그 날의 손 작업 — db/ 에 파일이 없다).
--   그 뒤 그 일은 전부 **service role 라우트**로 옮겨졌다. 코드로 확인한 것(2026-11-26):
--
--     · app/api/team/route.ts        — adminClient() + loadCaller({kind:'superadmin'})
--                                      insert(80줄) · update(119줄) · delete(167줄)
--     · app/api/team-permissions/route.ts — 같은 방식(teams.can_view_* 갱신)
--     · 브라우저에서 teams 를 건드리는 곳은 **읽기 하나뿐**이다
--       (app/admin/page.tsx 726줄의 select).
--
--   그러므로 authenticated 의 insert·delete 는 쓰이지 않는다. 열어 둘 까닭이 없다 —
--   service role 은 이 grant 와 무관하게 쓴다(RLS·GRANT 를 지나지 않는다).
--
-- ⚠ **update 는 건드리지 않는다.** 11-23 의 임시 권한은 insert·delete 였고, update 는
--   그 전부터 다른 까닭으로 있었을 수 있다. 회수는 지시받은 둘만 한다.
--
-- 재실행 안전(revoke 는 여러 번 돌려도 같은 상태로 끝난다).


-- ════════════════════════════════════════════════════════════════
-- [0단계] 지금 무엇이 열려 있나 — 돌리기 전에 눈으로 본다
-- ════════════════════════════════════════════════════════════════
--
--   select grantee, privilege_type
--     from information_schema.table_privileges
--    where table_schema = 'public' and table_name = 'teams'
--      and grantee in ('authenticated', 'anon')
--    order by grantee, privilege_type;
--
--   기대: authenticated 에 SELECT(와 아마 UPDATE)·INSERT·DELETE.
--   INSERT·DELETE 가 없으면 이미 회수된 것이다 — 아래를 돌려도 아무 일이 없다.


-- ════════════════════════════════════════════════════════════════
-- [1단계] 회수
-- ════════════════════════════════════════════════════════════════

revoke insert, delete on table public.teams from authenticated;

-- ════════════════════════════════════════════════════════════════
-- [2단계] 확인
-- ════════════════════════════════════════════════════════════════
--
--   ① 위 [0단계] 조회에 INSERT·DELETE 가 **없어야** 한다.
--   ② 화면에서 팀 추가·삭제가 **그대로 된다**(라우트가 service role 로 쓴다).
--      /admin → 팀 관리 → 팀 추가 → 삭제까지 한 번 돌려 본다.
--   ③ 팀 목록이 그대로 보인다(select 는 회수하지 않았다).
--
-- 되돌리기: grant insert, delete on table public.teams to authenticated;

notify pgrst, 'reload schema';
