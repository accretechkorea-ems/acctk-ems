-- ⚠ 정책을 갈아 끼우는 파일이다(drop policy → create policy). 두 번 돌리면 중간에
--   「정책이 없는 순간」이 생긴다 — 돌리기 전에 아래를 다 읽어라.
--
-- RLS 좁히기 묶음 3 (2026-10-08 작성). **적용 여부를 확인하지 못했다(2026-10-23).**
--   왜 — RLS 정책은 PostgREST 로 읽을 수 없다(batch2 의 머리말과 같은 이유).
--   확인하려면 Supabase SQL Editor 에서:
--     select tablename, policyname, cmd from pg_policies
--      where schemaname='public' and tablename like 'inventory%';
--   미로그인(anon) 이 어떤 표도 읽지 못하는 것은 2026-10-23 확인했다(42501).
-- 적용 대기 상태로 둔다 — 아래 「적용 순서와 시험 메모」를 읽고 **한 문장씩 따로** 실행한다.
-- begin/commit 으로 묶지 않았다. 문장 하나를 실행하고, 그 문장의 시험을 하고, 다음으로 넘어간다.
-- rls_tighten_batch2.sql 을 먼저 끝낸 뒤에 한다.
--
-- 왜 하는가
--   반도체사업부 계정(teams.can_view_* 가 모두 false)이 계측의 쇼룸 사용 기록·영업기회·영업활동·재고와
--   납입의사록·서비스 레포트·견적 PDF 파일을 읽지 못하게, 「로그인했는가」만 보던 정책을 has_team_perm(...) 으로 좁힌다.
--   지금 계측 7개 팀은 모두 can_view_customers = true 라 customers 를 요구해도 계측 직원 화면은 그대로다.
--
-- 지키는 규칙
--   · 표의 GRANT 는 어느 표도 회수하지 않는다(임베드 조회가 깨진다).
--   · 같은 이름의 정책은 drop·create 하지 않고 `alter policy` 로 그 자리에서 바꾼다 — 바꾸는 사이에 빈틈이 없다.
--     alter policy 는 roles·명령(for SELECT 등)은 그대로 두고 조건만 바꾼다.
--     예외는 B3-4 의 packing-lists 중복 정책 두 개다(삭제 — 그 문장의 설명을 꼭 읽는다).
--   · 함수는 (select …) 로 감싼다 — 문장마다 한 번만 평가된다(레포 관례).
--   · has_team_perm 은 superadmin 이면 true 다. 관리자 화면은 영향이 없다.
--   · 쓰기 조건을 「본인 행만」으로 좁히지 않는다 — 지금 계측 직원이 할 수 있는 일은 그대로 두고
--     「계측 팀인가」만 더한다. 영업기회 삭제가 남의 영업활동 연결을 푸는 UPDATE 를 브라우저에서 하므로
--     (hooks/customer/useOpportunityCrud.ts:99-100) 본인 행으로 좁히면 그 동작이 깨진다. 그 강화는 별도 작업이다.
--
-- 되돌리기
--   문장마다 바로 아래에 적었다. 원래 정책은 rls_backup_20261008.sql 의 DDL 을 그대로 옮겼다.
--   이미 같은 이름의 정책이 있으면 create policy 가 실패하므로, 되돌리기는 drop policy → 백업 DDL 두 줄이다
--   (삭제한 중복 정책 두 개는 백업 DDL 한 줄). 두 줄 사이에는 정책이 없는 순간이 생긴다 — 이어서 바로 실행한다.
--
-- ── 적용 순서와 시험 메모 ────────────────────────────────────────────────────
--   · 점심처럼 사용자가 적은 시간에 한다. 문장 하나 → 그 문장의 「시험」 → 다음 문장.
--   · 시험이 이상하면 다음으로 가지 말고 **그 문장의 되돌리기**를 바로 실행한다.
--   · 시험은 계측 직원 계정(superadmin 이 아닌 사람)으로 한다. superadmin 은 모든 조건을 통과하므로 시험이 안 된다.
--   · 순서(위험이 낮은 것부터):
--       B3-1 쇼룸 표 4개 → B3-2 영업기회·영업활동 → B3-3 재고 → B3-4 Storage(packing-lists → service-report → quote-pdfs)
--   · 브라우저는 화면을 새로고침한 뒤 시험한다(이미 읽어 둔 목록이 남아 있을 수 있다).
--
-- 적용 후 확인 쿼리와 「권한 없는 계정 시뮬레이션」은 파일 맨 아래에 있다.


-- ════════════════════════════════════════════════════════════════════════════
-- B3-1. 쇼룸 표 4개 — 고객사 권한이 있는 팀만
--   브라우저에서 이 네 표를 읽는 곳은 /showroom 안뿐이다(app/showroom/page.tsx:62-65,
--   components/showroom/showroomData.ts:43-123). showroom 메뉴는 customers 영역을 파생한다.
--   쓰기 정책은 원래 없다(쓰기는 /api/showroom/* service role). 결재 문서·승인서 PDF 는 service role 로 읽어 무관하다.
-- ════════════════════════════════════════════════════════════════════════════

-- B3-1a showroom_devices — 쇼룸 장비 목록
--   영향 화면: /showroom 장비 카드
--   시험: /showroom 을 열어 장비 카드가 전부 보인다.
--   되돌리기:
--     drop policy if exists sd_select on public.showroom_devices;
--     create policy sd_select on public.showroom_devices as PERMISSIVE for SELECT to authenticated using (true);
alter policy sd_select on public.showroom_devices
  using ((select public.has_team_perm('customers')));

-- B3-1b showroom_sites — 쇼룸 사이트(고객사 id) 목록
--   영향 화면: /showroom 사이트 선택(app/showroom/page.tsx:179)
--   시험: /showroom 사이트 선택 목록이 그대로 보인다.
--   되돌리기:
--     drop policy if exists ss_select on public.showroom_sites;
--     create policy ss_select on public.showroom_sites as PERMISSIVE for SELECT to authenticated using (true);
alter policy ss_select on public.showroom_sites
  using ((select public.has_team_perm('customers')));

-- B3-1c showroom_usage_engineers — 사용 기록의 참여 직원
--   영향 화면: /showroom 전체기록 탭의 참여자 칩. 읽기 실패는 console.error 만 남기고 칩이 조용히 빈다
--             (showroomData.ts:124) — 시험 때 칩을 눈으로 확인한다.
--   시험: /showroom 전체기록 탭에서 참여자 칩이 보인다.
--   되돌리기:
--     drop policy if exists sue_select on public.showroom_usage_engineers;
--     create policy sue_select on public.showroom_usage_engineers as PERMISSIVE for SELECT to authenticated using (true);
alter policy sue_select on public.showroom_usage_engineers
  using ((select public.has_team_perm('customers')));

-- B3-1d showroom_usage — 쇼룸 사용 기록(고객사·프로젝트·견적 id). 삭제 표시 조건은 그대로 둔다.
--   영향 화면: /showroom 장비 카드 기간 요약(app/showroom/page.tsx:62-65), 전체기록 탭(showroomData.ts:104-112)
--   시험: /showroom 장비 카드의 사용 기간과 전체기록 탭 목록이 그대로 보인다.
--   되돌리기:
--     drop policy if exists su_select on public.showroom_usage;
--     create policy su_select on public.showroom_usage as PERMISSIVE for SELECT to authenticated using ((deleted_at IS NULL));
alter policy su_select on public.showroom_usage
  using (deleted_at is null and (select public.has_team_perm('customers')));


-- ════════════════════════════════════════════════════════════════════════════
-- B3-2. 영업기회·영업활동 — 고객사 권한이 있는 팀만(영업기회 읽기는 견적 권한도)
--   영업기회는 견적 작성(/quote, quote 메뉴)의 영업기회 칸이 브라우저에서 읽는다(app/quote/page.tsx:359-363).
--   quote 메뉴는 customers 영역을 파생하지 않으므로 읽기만 quote 도 허용한다. 쓰기는 고객사 상세·파이프라인·
--   80 대시보드(모두 customers 영역)에서만 한다. 리드 전환·매출완료 자동 종료는 service role 이라 무관하다.
-- ════════════════════════════════════════════════════════════════════════════

-- B3-2a sales_opportunities 읽기 — customers 또는 quote
--   영향 화면: 고객사 상세 영업기회, 파이프라인, 80 대시보드, 견적 작성의 영업기회 칸, 고객사 상세 활동의 기회 제목 임베드
--   시험: 고객사 상세 영업기회 목록, /pipeline 카드, /quote 에서 고객사를 고르면 영업기회 칸이 나온다.
--   되돌리기:
--     drop policy if exists sales_opportunities_select on public.sales_opportunities;
--     create policy sales_opportunities_select on public.sales_opportunities as PERMISSIVE for SELECT to authenticated using ((( SELECT current_engineer_id() AS current_engineer_id) IS NOT NULL));
alter policy sales_opportunities_select on public.sales_opportunities
  using ((select public.has_team_perm('customers')) or (select public.has_team_perm('quote')));

-- B3-2b sales_opportunities 등록
--   영향 화면: 고객사 상세 「영업기회 등록」, 파이프라인 「+ 영업기회」(hooks/customer/useOpportunityCrud.ts:73)
--   시험: 고객사 상세에서 영업기회 하나 등록 → 목록에 보인다(시험 뒤 그 기회를 지운다 — B3-2d 시험과 함께).
--   되돌리기:
--     drop policy if exists sales_opportunities_insert on public.sales_opportunities;
--     create policy sales_opportunities_insert on public.sales_opportunities as PERMISSIVE for INSERT to authenticated with check ((( SELECT current_engineer_id() AS current_engineer_id) IS NOT NULL));
alter policy sales_opportunities_insert on public.sales_opportunities
  with check ((select public.has_team_perm('customers')));

-- B3-2c sales_opportunities 수정
--   영향 화면: 영업기회 모달 저장, 단계 변경, 종료/종료 해제(useOpportunityCrud.ts:70-72, 126-132, 145-148)
--   시험: B3-2b 에서 만든 기회의 단계를 바꾸고 저장 → 반영된다.
--   되돌리기:
--     drop policy if exists sales_opportunities_update on public.sales_opportunities;
--     create policy sales_opportunities_update on public.sales_opportunities as PERMISSIVE for UPDATE to authenticated using ((( SELECT current_engineer_id() AS current_engineer_id) IS NOT NULL)) with check ((( SELECT current_engineer_id() AS current_engineer_id) IS NOT NULL));
alter policy sales_opportunities_update on public.sales_opportunities
  using ((select public.has_team_perm('customers')))
  with check ((select public.has_team_perm('customers')));

-- B3-2d sales_opportunities 삭제
--   영향 화면: 영업기회 삭제(useOpportunityCrud.ts:107). 바로 앞의 활동 연결 해제는 B3-2g 가 다룬다.
--   시험: B3-2b 에서 만든 기회를 삭제 → 목록에서 사라진다.
--   되돌리기:
--     drop policy if exists sales_opportunities_delete on public.sales_opportunities;
--     create policy sales_opportunities_delete on public.sales_opportunities as PERMISSIVE for DELETE to authenticated using ((( SELECT current_engineer_id() AS current_engineer_id) IS NOT NULL));
alter policy sales_opportunities_delete on public.sales_opportunities
  using ((select public.has_team_perm('customers')));

-- B3-2e sales_activities 읽기
--   영향 화면: 고객사 상세 활동, 홈 활동 카드(본인 행, canViewCustomers 일 때만 조회 — app/dashboard/page.tsx:73),
--             /activity, 80 대시보드, 파이프라인
--   시험: 홈 활동 카드, /activity 목록, 고객사 상세 활동 타임라인이 그대로 보인다.
--   되돌리기:
--     drop policy if exists sales_activities_select on public.sales_activities;
--     create policy sales_activities_select on public.sales_activities as PERMISSIVE for SELECT to authenticated using ((( SELECT current_engineer_id() AS current_engineer_id) IS NOT NULL));
alter policy sales_activities_select on public.sales_activities
  using ((select public.has_team_perm('customers')));

-- B3-2f sales_activities 등록
--   영향 화면: 고객사 상세 활동 등록(hooks/customer/useSalesActivityCrud.ts:56-64)
--   시험: 고객사 상세에서 활동 하나 등록 → 타임라인에 보인다(시험 뒤 B3-2h 시험으로 지운다).
--   되돌리기:
--     drop policy if exists sales_activities_insert on public.sales_activities;
--     create policy sales_activities_insert on public.sales_activities as PERMISSIVE for INSERT to authenticated with check ((( SELECT current_engineer_id() AS current_engineer_id) IS NOT NULL));
alter policy sales_activities_insert on public.sales_activities
  with check ((select public.has_team_perm('customers')));

-- B3-2g sales_activities 수정 — 영업기회 삭제 때의 연결 해제(남이 쓴 활동 포함)도 이 정책을 탄다
--   영향 화면: 활동 수정(useSalesActivityCrud.ts:48-55), 영업기회 삭제 전 연결 해제(useOpportunityCrud.ts:99-100)
--   시험: B3-2f 의 활동을 수정 → 반영된다. 활동이 연결된 시험 기회를 삭제 → 오류 없이 지워지고 활동은 남는다.
--   되돌리기:
--     drop policy if exists sales_activities_update on public.sales_activities;
--     create policy sales_activities_update on public.sales_activities as PERMISSIVE for UPDATE to authenticated using ((( SELECT current_engineer_id() AS current_engineer_id) IS NOT NULL)) with check ((( SELECT current_engineer_id() AS current_engineer_id) IS NOT NULL));
alter policy sales_activities_update on public.sales_activities
  using ((select public.has_team_perm('customers')))
  with check ((select public.has_team_perm('customers')));

-- B3-2h sales_activities 삭제
--   영향 화면: 활동 삭제(useSalesActivityCrud.ts:89)
--   시험: B3-2f 의 활동을 삭제 → 타임라인에서 사라진다.
--   되돌리기:
--     drop policy if exists sales_activities_delete on public.sales_activities;
--     create policy sales_activities_delete on public.sales_activities as PERMISSIVE for DELETE to authenticated using ((( SELECT current_engineer_id() AS current_engineer_id) IS NOT NULL));
alter policy sales_activities_delete on public.sales_activities
  using ((select public.has_team_perm('customers')));


-- ════════════════════════════════════════════════════════════════════════════
-- B3-3. 재고 — 고객사 권한이 있는 팀만 (격리 목적의 최소 변경)
--   **이것은 반도체 팀을 막기 위한 최소 변경이다. 계측 내부의 최소권한(재고는 재고 담당만)은 별도 작업이다.**
--   브라우저에서 두 표를 읽고 쓰는 곳은 /inventory 화면뿐이다(app/inventory/page.tsx:183-188, 321-336, 384-436).
--   출고 요청·승인 라우트(/api/inventory-request, /api/inventory-approval)는 service role 이라 무관하다.
--   ※ 주의: inventory 메뉴가 파생하는 영역은 sales_mgmt 뿐이다(customers 아님). 지금은 계측 7개 팀이 모두
--     can_view_customers = true 라 깨지지 않지만, 앞으로 「재고만 있고 고객사 권한이 없는 팀」을 만들면 그 팀의
--     /inventory 가 빈 화면이 된다. 그때는 이 조건에 or has_team_perm('sales_mgmt') 를 더한다.
--   inventory_logs 는 inventory_items(item_name, part_code) 를 임베드한다 — 두 표를 같은 조건으로 맞춘다.
-- ════════════════════════════════════════════════════════════════════════════

-- B3-3a inventory_items 읽기
--   영향 화면: /inventory 재고 목록, 로그의 품목 이름 임베드
--   시험: /inventory 를 열어 재고 목록과 입출고 기록의 품목 이름이 보인다.
--   되돌리기:
--     drop policy if exists inventory_items_select on public.inventory_items;
--     create policy inventory_items_select on public.inventory_items as PERMISSIVE for SELECT to authenticated using ((( SELECT current_engineer_id() AS current_engineer_id) IS NOT NULL));
alter policy inventory_items_select on public.inventory_items
  using ((select public.has_team_perm('customers')));

-- B3-3b inventory_items 등록
--   영향 화면: /inventory 품목 추가(있다면 — 코드에서 브라우저 insert 는 찾지 못했다. 엑셀 일괄 등록 경로가 있으면 그쪽)
--   시험: 품목 추가 기능을 쓰는 사람이 있으면 하나 추가해 본다. 없으면 B3-3a 시험으로 갈음한다.
--   되돌리기:
--     drop policy if exists inventory_items_insert on public.inventory_items;
--     create policy inventory_items_insert on public.inventory_items as PERMISSIVE for INSERT to authenticated with check ((( SELECT current_engineer_id() AS current_engineer_id) IS NOT NULL));
alter policy inventory_items_insert on public.inventory_items
  with check ((select public.has_team_perm('customers')));

-- B3-3c inventory_items 수정
--   영향 화면: /inventory 수량 변경·재입고·일괄 수정(app/inventory/page.tsx:321, 417, 436)
--   시험: 재고 담당으로 수량 하나를 바꿨다가 되돌린다 → 둘 다 반영된다.
--   되돌리기:
--     drop policy if exists inventory_items_update on public.inventory_items;
--     create policy inventory_items_update on public.inventory_items as PERMISSIVE for UPDATE to authenticated using ((( SELECT current_engineer_id() AS current_engineer_id) IS NOT NULL)) with check ((( SELECT current_engineer_id() AS current_engineer_id) IS NOT NULL));
alter policy inventory_items_update on public.inventory_items
  using ((select public.has_team_perm('customers')))
  with check ((select public.has_team_perm('customers')));

-- B3-3d inventory_items 삭제
--   영향 화면: 브라우저 삭제 경로는 찾지 못했다(있다면 /inventory 품목 삭제).
--   시험: 없음(B3-3a 시험으로 목록이 그대로인지만 본다).
--   되돌리기:
--     drop policy if exists inventory_items_delete on public.inventory_items;
--     create policy inventory_items_delete on public.inventory_items as PERMISSIVE for DELETE to authenticated using ((( SELECT current_engineer_id() AS current_engineer_id) IS NOT NULL));
alter policy inventory_items_delete on public.inventory_items
  using ((select public.has_team_perm('customers')));

-- B3-3e inventory_logs 읽기
--   영향 화면: /inventory 입출고 기록(app/inventory/page.tsx:184-188)
--   시험: /inventory 입출고 기록 탭이 그대로 보인다.
--   되돌리기:
--     drop policy if exists inventory_logs_select on public.inventory_logs;
--     create policy inventory_logs_select on public.inventory_logs as PERMISSIVE for SELECT to authenticated using ((( SELECT current_engineer_id() AS current_engineer_id) IS NOT NULL));
alter policy inventory_logs_select on public.inventory_logs
  using ((select public.has_team_perm('customers')));

-- B3-3f inventory_logs 등록
--   영향 화면: 재입고·수량 변경 때 기록 추가(app/inventory/page.tsx:324, 424)
--   시험: B3-3c 의 수량 변경 뒤 입출고 기록에 새 줄이 생긴다.
--   되돌리기:
--     drop policy if exists inventory_logs_insert on public.inventory_logs;
--     create policy inventory_logs_insert on public.inventory_logs as PERMISSIVE for INSERT to authenticated with check ((( SELECT current_engineer_id() AS current_engineer_id) IS NOT NULL));
alter policy inventory_logs_insert on public.inventory_logs
  with check ((select public.has_team_perm('customers')));

-- B3-3g inventory_logs 수정
--   영향 화면: 브라우저 update 경로는 없다. 재입고 표시는 mark_log_restocked(SECURITY DEFINER, 묶음 2 B2-3)가 한다 — 무관.
--   시험: 재입고 처리 하나 → 성공한다(함수 경로 확인).
--   되돌리기:
--     drop policy if exists inventory_logs_update on public.inventory_logs;
--     create policy inventory_logs_update on public.inventory_logs as PERMISSIVE for UPDATE to authenticated using ((( SELECT current_engineer_id() AS current_engineer_id) IS NOT NULL)) with check ((( SELECT current_engineer_id() AS current_engineer_id) IS NOT NULL));
alter policy inventory_logs_update on public.inventory_logs
  using ((select public.has_team_perm('customers')))
  with check ((select public.has_team_perm('customers')));

-- B3-3h inventory_logs 삭제
--   영향 화면: 브라우저 삭제 경로는 찾지 못했다.
--   시험: 없음.
--   되돌리기:
--     drop policy if exists inventory_logs_delete on public.inventory_logs;
--     create policy inventory_logs_delete on public.inventory_logs as PERMISSIVE for DELETE to authenticated using ((( SELECT current_engineer_id() AS current_engineer_id) IS NOT NULL));
alter policy inventory_logs_delete on public.inventory_logs
  using ((select public.has_team_perm('customers')));


-- ════════════════════════════════════════════════════════════════════════════
-- B3-4. Storage — 납입의사록(packing-lists) → 서비스 레포트(service-report) → 견적 PDF(quote-pdfs)
--   storage.objects 의 정책이다. 정책 이름에 공백이 있어 큰따옴표로 감싼다.
--   이 파일은 profile-images·device-images·lead-cards 를 다루지 않는다(이미 처리했거나 의도된 공개).
--   ※ 업로드가 upsert:true 인 버킷(packing-lists·service-report)은 SELECT·INSERT·UPDATE 를 모두 같은 조건으로 맞춘다
--     — 하나라도 다르면 덮어쓰기 업로드가 실패한다.
-- ════════════════════════════════════════════════════════════════════════════

-- ── packing-lists ──
--   영향 화면: 고객사 상세 장비의 패킹리스트 열기·올리기·교체(hooks/customer/useDeviceCrud.ts:207, 267, 289),
--             신규 고객사 등록 시 첨부(lib/addCustomer.ts:64 — 실패해도 조용히 경로만 비운다. 시험 때 꼭 확인).
--   모두 customers 메뉴 화면이다.

-- B3-4a packing-lists 읽기(서명 URL 발급)
--   시험: 고객사 상세에서 패킹리스트가 있는 장비의 「열기」 → 파일이 열린다.
--   되돌리기:
--     drop policy if exists "packing_lists authenticated read" on storage.objects;
--     create policy "packing_lists authenticated read" on storage.objects as PERMISSIVE for SELECT to authenticated using ((bucket_id = 'packing-lists'::text));
alter policy "packing_lists authenticated read" on storage.objects
  using (bucket_id = 'packing-lists' and (select public.has_team_perm('customers')));

-- B3-4b packing-lists 올리기
--   시험: B3-4f 까지 끝낸 뒤 한 번에 — 장비 하나에 패킹리스트를 새로 올리기(아래 B3-4f 시험).
--   되돌리기:
--     drop policy if exists "packing_lists authenticated insert" on storage.objects;
--     create policy "packing_lists authenticated insert" on storage.objects as PERMISSIVE for INSERT to authenticated with check ((bucket_id = 'packing-lists'::text));
alter policy "packing_lists authenticated insert" on storage.objects
  with check (bucket_id = 'packing-lists' and (select public.has_team_perm('customers')));

-- B3-4c packing-lists 덮어쓰기(upsert)
--   시험: B3-4f 시험에 포함.
--   되돌리기:
--     drop policy if exists "packing_lists authenticated update" on storage.objects;
--     create policy "packing_lists authenticated update" on storage.objects as PERMISSIVE for UPDATE to authenticated using ((bucket_id = 'packing-lists'::text)) with check ((bucket_id = 'packing-lists'::text));
alter policy "packing_lists authenticated update" on storage.objects
  using (bucket_id = 'packing-lists' and (select public.has_team_perm('customers')))
  with check (bucket_id = 'packing-lists' and (select public.has_team_perm('customers')));

-- B3-4d packing-lists 지우기(교체 때 옛 파일 삭제)
--   시험: B3-4f 시험에 포함.
--   되돌리기:
--     drop policy if exists "packing_lists authenticated delete" on storage.objects;
--     create policy "packing_lists authenticated delete" on storage.objects as PERMISSIVE for DELETE to authenticated using ((bucket_id = 'packing-lists'::text));
alter policy "packing_lists authenticated delete" on storage.objects
  using (bucket_id = 'packing-lists' and (select public.has_team_perm('customers')));

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ **중복 정책 두 개를 지워야 실제로 닫힌다.**                                 │
-- │ permissive 정책은 OR 로 합쳐진다. 위에서 조건을 좁혀도, 같은 동작(SELECT·  │
-- │ INSERT)에 bucket_id 만 보는 정책이 하나라도 남아 있으면 로그인한 누구나    │
-- │ 계속 읽고 올릴 수 있다. B3-4a~d 만 하고 여기서 멈추면 아무것도 막히지 않는다. │
-- └──────────────────────────────────────────────────────────────────────────┘

-- B3-4e 중복 읽기 정책 삭제 — "authenticated can read packing lists"
--   영향 화면: 없음(B3-4a 가 같은 동작을 customers 조건으로 이미 허용한다).
--   시험: B3-4a 시험을 다시 — 계측 직원으로 패킹리스트 「열기」가 여전히 된다.
--   되돌리기(백업 DDL):
--     create policy "authenticated can read packing lists" on storage.objects as PERMISSIVE for SELECT to authenticated using ((bucket_id = 'packing-lists'::text));
drop policy if exists "authenticated can read packing lists" on storage.objects;

-- B3-4f 중복 올리기 정책 삭제 — "authenticated can upload packing lists"
--   영향 화면: 없음(B3-4b 가 같은 동작을 customers 조건으로 이미 허용한다).
--   시험: 계측 직원으로 고객사 상세에서 장비 하나에 패킹리스트를 올린다 → 성공. 같은 장비에 다른 파일로 교체 → 성공하고
--         「열기」가 새 파일을 연다. 신규 고객사 등록 화면에서 패킹리스트를 붙여 등록 → 그 장비의 「열기」가 된다.
--   되돌리기(백업 DDL):
--     create policy "authenticated can upload packing lists" on storage.objects as PERMISSIVE for INSERT to authenticated with check ((bucket_id = 'packing-lists'::text));
drop policy if exists "authenticated can upload packing lists" on storage.objects;

-- ── service-report ──
--   영향 화면: 고객사 상세 서비스 레포트 생성·교체·열기·삭제(hooks/customer/useServiceCrud.tsx:128-258),
--             홀딩 모달의 레포트 열기(hooks/customer/useHoldingCrud.ts:138 — /customer/[id], /holdings, /dashboard/80).
--   /holdings·/dashboard/80 은 dashboard_80 메뉴인데, dashboard_80 은 customers 영역을 파생하므로 customers 조건으로 열린다.

-- B3-4g service-report 읽기(서명 URL 발급)
--   시험: 고객사 상세 서비스 이력에서 레포트 「열기」 → 열린다. /holdings 의 홀딩 모달에서 레포트 열기 → 열린다.
--   되돌리기:
--     drop policy if exists "service_report authenticated read" on storage.objects;
--     create policy "service_report authenticated read" on storage.objects as PERMISSIVE for SELECT to authenticated using ((bucket_id = 'service-report'::text));
alter policy "service_report authenticated read" on storage.objects
  using (bucket_id = 'service-report' and (select public.has_team_perm('customers')));

-- B3-4h service-report 올리기
--   시험: B3-4j 까지 끝낸 뒤 한 번에(아래 B3-4j 시험).
--   되돌리기:
--     drop policy if exists "service_report authenticated insert" on storage.objects;
--     create policy "service_report authenticated insert" on storage.objects as PERMISSIVE for INSERT to authenticated with check ((bucket_id = 'service-report'::text));
alter policy "service_report authenticated insert" on storage.objects
  with check (bucket_id = 'service-report' and (select public.has_team_perm('customers')));

-- B3-4i service-report 덮어쓰기(upsert)
--   시험: B3-4j 시험에 포함.
--   되돌리기:
--     drop policy if exists "service_report authenticated update" on storage.objects;
--     create policy "service_report authenticated update" on storage.objects as PERMISSIVE for UPDATE to authenticated using ((bucket_id = 'service-report'::text)) with check ((bucket_id = 'service-report'::text));
alter policy "service_report authenticated update" on storage.objects
  using (bucket_id = 'service-report' and (select public.has_team_perm('customers')))
  with check (bucket_id = 'service-report' and (select public.has_team_perm('customers')));

-- B3-4j service-report 지우기
--   시험: 시험용 서비스 이력에서 레포트 생성 → 열기 → 파일 교체 → 열기(새 파일) → 레포트 삭제. 모두 성공한다.
--   되돌리기:
--     drop policy if exists "service_report authenticated delete" on storage.objects;
--     create policy "service_report authenticated delete" on storage.objects as PERMISSIVE for DELETE to authenticated using ((bucket_id = 'service-report'::text));
alter policy "service_report authenticated delete" on storage.objects
  using (bucket_id = 'service-report' and (select public.has_team_perm('customers')));

-- ── quote-pdfs ──
--   브라우저가 직접 하는 것은 견적 확정 때의 업로드뿐이다(app/quote/page.tsx:588, upsert 아님). 열기·삭제는 모두
--   service role 라우트(/api/quote-pdf, /api/repair-quotes, /api/delete-quote-pdf)라 무관하다.
--   select 정책은 지우지 않고 조건만 좁힌다 — 업로드가 이름이 겹치면 접미사를 붙여 다시 시도하는데
--   (app/quote/page.tsx:586-599), select 가 없을 때 「이미 있음」 오류가 그대로 오는지 확인하지 못했다.
--   quote 메뉴는 quote 영역을 파생하므로 견적 작성 화면에 들어오는 사람은 통과한다.

-- B3-4k quote-pdfs 읽기
--   시험: B3-4l 시험에 포함(업로드 재시도 경로가 select 를 쓸 수 있다).
--   되돌리기:
--     drop policy if exists "authenticated users can read quote pdfs" on storage.objects;
--     create policy "authenticated users can read quote pdfs" on storage.objects as PERMISSIVE for SELECT to authenticated using ((bucket_id = 'quote-pdfs'::text));
alter policy "authenticated users can read quote pdfs" on storage.objects
  using (bucket_id = 'quote-pdfs' and (select public.has_team_perm('quote')));

-- B3-4l quote-pdfs 올리기
--   시험: 견적 작성 권한이 있는 계측 직원으로 견적 하나를 확정 → PDF 가 올라가고 고객사 상세·홈 「내 견적」에서
--         그 견적의 PDF 가 열린다(열기는 /api/quote-pdf). 시험 견적은 평소 방식대로 지운다.
--   되돌리기:
--     drop policy if exists "authenticated users can upload quote pdfs" on storage.objects;
--     create policy "authenticated users can upload quote pdfs" on storage.objects as PERMISSIVE for INSERT to authenticated with check ((bucket_id = 'quote-pdfs'::text));
alter policy "authenticated users can upload quote pdfs" on storage.objects
  with check (bucket_id = 'quote-pdfs' and (select public.has_team_perm('quote')));


-- ════════════════════════════════════════════════════════════════════════════
-- 적용 후 확인 (읽기 전용)
-- ════════════════════════════════════════════════════════════════════════════
-- 바꾼 정책의 조건 — 기대: 모든 qual·with_check 에 has_team_perm(...) 이 들어 있다
--   (sales_opportunities_select 는 customers or quote, su_select 는 deleted_at is null and …)
-- select tablename, policyname, cmd, roles, qual, with_check
-- from pg_policies
-- where schemaname = 'public'
--   and tablename in ('showroom_devices', 'showroom_sites', 'showroom_usage_engineers', 'showroom_usage',
--                     'sales_opportunities', 'sales_activities', 'inventory_items', 'inventory_logs')
-- order by tablename, cmd, policyname;

-- has_team_perm 이 빠진 정책이 남았는가 — 기대: 0행
-- select tablename, policyname, cmd, qual, with_check
-- from pg_policies
-- where schemaname = 'public'
--   and tablename in ('showroom_devices', 'showroom_sites', 'showroom_usage_engineers', 'showroom_usage',
--                     'sales_opportunities', 'sales_activities', 'inventory_items', 'inventory_logs')
--   and coalesce(qual, '') not like '%has_team_perm%' and coalesce(with_check, '') not like '%has_team_perm%';

-- 표별 정책 수 — 기대: 쇼룸 4표 각 1, sales_* 각 4, inventory_* 각 4(적용 전과 같은 수)
-- select tablename, count(*) as n_policies
-- from pg_policies
-- where schemaname = 'public'
--   and tablename in ('showroom_devices', 'showroom_sites', 'showroom_usage_engineers', 'showroom_usage',
--                     'sales_opportunities', 'sales_activities', 'inventory_items', 'inventory_logs')
-- group by tablename order by tablename;

-- storage.objects 정책 목록 — 기대: packing-lists 4개·service-report 4개·quote-pdfs 2개 모두 has_team_perm 포함,
--   "authenticated can read packing lists"·"authenticated can upload packing lists" 없음.
--   "allow all"(device-images)·lead_cards_auth_select·profile-images 정책은 이 파일이 건드리지 않았다.
-- select policyname, cmd, roles, qual, with_check
-- from pg_policies
-- where schemaname = 'storage' and tablename = 'objects'
-- order by policyname;

-- 세 버킷에 has_team_perm 없이 열린 정책이 남았는가 — 기대: 0행
-- select policyname, cmd, qual, with_check
-- from pg_policies
-- where schemaname = 'storage' and tablename = 'objects'
--   and (coalesce(qual, '') || coalesce(with_check, '')) ~ '(packing-lists|service-report|quote-pdfs)'
--   and coalesce(qual, '') not like '%has_team_perm%' and coalesce(with_check, '') not like '%has_team_perm%';


-- ════════════════════════════════════════════════════════════════════════════
-- 권한 없는 계정 시뮬레이션 (반도체 계정이 생긴 뒤에 쓴다)
--   SQL Editor 에서 그 계정인 것처럼 돌려 본다. begin … rollback 이라 아무것도 남지 않는다.
--   <테스트 계정 이메일> 을 반도체 계정 이메일로 바꾼다. has_team_perm 은 JWT 의 email 을 본다.
--   update·delete 는 RLS 에 걸리면 오류가 아니라 「0행」이다(보이지 않는 행은 고칠 수 없다).
--   insert 는 RLS 에 걸리면 오류(new row violates row-level security policy)다 — 오류가 나면 그 뒤는 실행되지 않으므로
--   insert 시도는 각각 따로 begin … rollback 으로 돌린다.
-- ════════════════════════════════════════════════════════════════════════════
-- begin;
-- set local role authenticated;
-- select set_config('request.jwt.claims',
--   json_build_object('sub', '00000000-0000-0000-0000-000000000000',
--                     'email', '<테스트 계정 이메일>', 'role', 'authenticated')::text, true);
-- select public.has_team_perm('customers') as customers, public.has_team_perm('quote') as quote;  -- 기대: 둘 다 false
-- select count(*) from public.showroom_devices;          -- 기대: 0
-- select count(*) from public.showroom_sites;            -- 기대: 0
-- select count(*) from public.showroom_usage_engineers;  -- 기대: 0
-- select count(*) from public.showroom_usage;            -- 기대: 0
-- select count(*) from public.sales_opportunities;       -- 기대: 0
-- select count(*) from public.sales_activities;          -- 기대: 0
-- select count(*) from public.inventory_items;           -- 기대: 0
-- select count(*) from public.inventory_logs;            -- 기대: 0
-- select bucket_id, count(*) from storage.objects
-- where bucket_id in ('packing-lists', 'service-report', 'quote-pdfs')
-- group by bucket_id;                                     -- 기대: 0행
-- update public.sales_opportunities set stage = stage;   -- 기대: UPDATE 0
-- update public.sales_activities set content = content;  -- 기대: UPDATE 0
-- update public.inventory_items set quantity = quantity; -- 기대: UPDATE 0
-- delete from public.sales_activities;                   -- 기대: DELETE 0
-- delete from public.inventory_logs;                     -- 기대: DELETE 0
-- rollback;
--
-- begin;
-- set local role authenticated;
-- select set_config('request.jwt.claims',
--   json_build_object('sub', '00000000-0000-0000-0000-000000000000',
--                     'email', '<테스트 계정 이메일>', 'role', 'authenticated')::text, true);
-- insert into storage.objects (bucket_id, name) values ('packing-lists', 'rls-sim-test.txt');   -- 기대: row-level security 위반
-- rollback;
--
-- begin;
-- set local role authenticated;
-- select set_config('request.jwt.claims',
--   json_build_object('sub', '00000000-0000-0000-0000-000000000000',
--                     'email', '<테스트 계정 이메일>', 'role', 'authenticated')::text, true);
-- insert into storage.objects (bucket_id, name) values ('service-report', 'rls-sim-test.pdf');  -- 기대: row-level security 위반
-- rollback;
--
-- begin;
-- set local role authenticated;
-- select set_config('request.jwt.claims',
--   json_build_object('sub', '00000000-0000-0000-0000-000000000000',
--                     'email', '<테스트 계정 이메일>', 'role', 'authenticated')::text, true);
-- insert into storage.objects (bucket_id, name) values ('quote-pdfs', 'rls-sim-test.pdf');      -- 기대: row-level security 위반
-- rollback;
--
-- ※ sales_* · inventory_* 의 insert 시도는 칸 이름을 확인한 뒤 넣는다(필수 칸이 비면 RLS 가 아니라 not null 오류가 먼저 날 수
--   있어 결과를 잘못 읽게 된다). 위의 count(*) 0·update/delete 0행으로 읽기·수정·삭제 차단은 확인된다.
