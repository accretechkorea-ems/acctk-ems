-- devices 폐기 처리용 열 권한 (2026-11-02 작성). **아직 적용하지 않았다 — 필요할 때만 돌린다.**
--
-- 무엇을 하나
--   화면(로그인 사용자 = authenticated)이 devices.status · devices.disposed_at 을 읽고 고칠 수
--   있게 한다. 장비 수정 모달의 「폐기 처리」·「폐기 취소」가 그 두 칸만 바꾼다
--   (hooks/customer/useDeviceCrud.ts → lib/deviceStatus.ts 의 disposePatch·restorePatch).
--
-- 돌려야 하나 — **devices 가 열 단위로 권한을 주는 표일 때만이다.**
--   engineers 가 그런 표다(db/APPLIED.md 2026-10-28 — 칸을 더할 때마다
--   `grant update (새 칸) ... to authenticated` 를 함께 돌려야 화면에서 저장이 된다).
--   devices 가 표 단위(`grant ... on public.devices`)면 새 칸은 권한을 그냥 물려받으므로
--   **이 파일을 돌릴 필요가 없다**. 어느 쪽인지는 아래 [0단계] 로 본다.
--
--   2026-11-02 확인한 것: 로그인 계정으로 `select device_id, status, disposed_at from devices`
--   가 **읽힌다**(1,450줄 전부 '사용중', null 0줄). 그래서 **select 쪽은 이미 된다**.
--   update 권한은 돌려 보지 않고는 알 수 없어(권한 표를 PostgREST 로 읽을 수 없다) 확인하지
--   않았다 — 화면에서 「폐기 처리」를 눌렀을 때 `42501` 이 나면 이 파일을 돌린다.
--
-- 재실행에 안전하다 — grant 는 여러 번 돌려도 같은 상태로 끝난다.


-- ════════════════════════════════════════════════════════════════
-- [0단계] 열 단위인가 표 단위인가 — 돌리기 전에 본다
-- ════════════════════════════════════════════════════════════════
--
-- 열 단위로 준 권한이 있으면 줄이 나온다(table_privileges 에는 안 보이고 여기만 보인다).
--   select grantee, column_name, privilege_type
--     from information_schema.column_privileges
--    where table_schema = 'public' and table_name = 'devices'
--      and grantee = 'authenticated'
--    order by column_name, privilege_type;
--
-- 표 단위로 준 권한.
--   select grantee, privilege_type
--     from information_schema.table_privileges
--    where table_schema = 'public' and table_name = 'devices'
--      and grantee = 'authenticated';
--
-- 두 번째 조회에 UPDATE 가 있으면 **이 파일은 돌릴 필요가 없다**(표 단위라 새 칸도 함께 된다).


-- ════════════════════════════════════════════════════════════════
-- [1단계] 적용 — 열 단위 표일 때만
-- ════════════════════════════════════════════════════════════════

grant select (status, disposed_at) on public.devices to authenticated;
grant update (status, disposed_at) on public.devices to authenticated;


-- ════════════════════════════════════════════════════════════════
-- [2단계] 확인
-- ════════════════════════════════════════════════════════════════
--
-- [0단계] 첫 조회에 status·disposed_at 의 SELECT·UPDATE 가 보이면 들어갔다.
--
-- 화면에서는: 고객사 상세 → 장비 카드의 수정 아이콘 → 「폐기 처리」 →
--   목록에서 사라지고 「폐기 포함 1」 토글이 생긴다. 토글을 켜면 회색 카드에
--   「폐기 YYYY-MM-DD」 뱃지가 붙는다. 모달을 다시 열면 「폐기 취소」가 있다.
--
-- ⚠ RLS 는 손대지 않는다. devices 에 쓰기 정책이 따로 있다면(2026-10-08 스냅샷에는
--    devices 정책이 없었다) 권한과 별개로 그 정책도 통과해야 한다.
