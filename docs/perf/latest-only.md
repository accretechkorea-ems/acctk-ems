# 브라우저 실측 — 2026-10-23 09:13

모드 **start (next start)** · 주소 http://localhost:3100 · 브라우저 Chromium(playwright ^1.64.1)

재는 값: ① 문서 TTFB ② 새로 받은 JS ③ 자료 요청 수(supabase+/api)와 중복 ④ 가장 느린 요청
⑤ 자료 요청 첫 시작→마지막 끝 ⑥ 직렬(앞 요청이 끝난 뒤 시작한 것) 수.

「새 JS」는 **그 화면에서 처음 받은** 스크립트만이다 — 공통 덩어리는 먼저 열어 본 화면에서
이미 받아 브라우저 캐시에 있다(그래서 0KB 인 화면이 있다). 「중복」은 같은 조회가 두 번 이상
나간 횟수의 합이고, URL 은 **파라미터 이름까지** 같아야 같은 것으로 센다(값은 적지 않는다).

## 화면

| 묶음 | 화면 | 경로 | TTFB | 새 JS | 자료 요청 | 중복 | 네트워크 완료 | 직렬 | 가장 느린 요청 |
|---|---|---|---|---|---|---|---|---|---|
| 주 메뉴 | 홈 | `/dashboard` | 208ms | 0KB | 2 | — | 1,354ms | 1 | auth:user 1352ms |
| 주 메뉴 | 알림 | `/notifications` | 376ms | 6KB | 6 | — | 1,199ms | 4 | /api/approval ?box 465ms |
| 주 메뉴 | 전자결재 | `/approval` | 446ms | 37KB | 9 | — | 5,399ms | 3 | /api/approval/done ?scope 2963ms |
| 대시보드 | 20 대시보드 | `/repair/dashboard` | 213ms | 148KB | 8 | — | 980ms | 3 | /api/repair-quotes ?revenue 586ms |
| 대시보드 | 80 대시보드 | `/dashboard/80` | 85ms | 26KB | 14 | — | 1,692ms | 3 | service_history(service_type) ?visit_date&visit_date&visit_date 1315ms |

## 탭 전환

| 화면 | 동작 | 걸린 시간 | 자료 요청 | 중복 | 네트워크 | 비고 |
|---|---|---|---|---|---|---|
| 알림 | 탭: 안 읽음 | 요청 없음(화면에서만 거른다) | 0 | — | 0ms |  |
| 알림 | 탭: 전체 | 요청 없음(화면에서만 거른다) | 0 | — | 0ms |  |
| 전자결재 | 탭: 기결 | 요청 없음(화면에서만 거른다) | 0 | — | 0ms |  |
| 전자결재 | 탭: 상신 | 요청 없음(화면에서만 거른다) | 0 | — | 0ms | 금지어 「상신」 — 누르지 않는다 |
| 전자결재 | 탭: 참조 | 4104ms | 1 | — | 396ms |  |
| 전자결재 | 탭: 미결 | 4089ms | 1 | — | 488ms |  |

## 모달

| 화면 | 모달 | 열리기까지 | 자료 요청 | 중복 | 네트워크 | 비고 |
|---|---|---|---|---|---|---|
| 홈 | 내 견적 (전체 탭) | 1ms | 9 | — | 8,703ms | 화면에 없다 |
| 홈 | 내 실적 → 월별 그래프 | 100ms | 0 | — | 0ms |  |

## 중복 요청 (같은 URL·메서드가 한 화면에서 두 번 이상)

없다.

## 가장 느린 요청 10개

| 화면 | 요청 | 시간 | 종류 |
|---|---|---|---|
| 전자결재 | /api/approval/done ?scope | 2963ms | api |
| 전자결재 | /api/approval ?box | 2405ms | api |
| 전자결재 | /api/approval ?box | 1658ms | api |
| 전자결재 | engineers(engineer_id,name,positio…) ?order | 1470ms | supabase |
| 전자결재 | notifications(id,engineer_id,title,mes…) ?engineer_id&limit&offset&order | 1373ms | supabase |
| 홈 | auth:user | 1352ms | supabase |
| 80 대시보드 | service_history(service_type) ?visit_date&visit_date&visit_date | 1315ms | supabase |
| 전자결재 | engineers(engineer_id,name,positio…) ?email | 1238ms | supabase |
| 80 대시보드 | holdings(*,customers(company_name…) ?order | 1217ms | supabase |
| 80 대시보드 | quotes(total_supply) ?status&tax_invoice_completed_at&tax_invoice_completed_at | 1216ms | supabase |

## 일부러 열지 않은 모달 (읽기 전용 규칙)

| 화면 | 모달 | 이유 |
|---|---|---|
| 견적서 | 장비 구성 선택 | 견적 분류·양식을 먼저 골라야 단추가 열린다 — 고르는 것은 입력이다 |
| 견적서 | 템플릿 저장 | 저장 모달이다(쓰기 직전) |
| 견적서 | 품목 검색 | 검색창에 글자를 넣어야 결과가 나온다 |
| 고객사 상세 | 고객사 수정 · 장비 추가 · 서비스 추가 | 전부 입력 폼이다. 열기만 해도 되지만 그 안의 단추가 쓰기라 아예 건드리지 않는다 |
| 전자결재 | 결재선 지정 | 상신 흐름 안에서만 열린다(상신은 쓰기) |
| 관리 | 가격표 등록 | 파일 업로드 모달이다 |
| 의뢰서 | 의뢰서 작성 | 등록 폼이다 |
| 포캐스트 | 포캐스트 추가 | 등록 폼이다 |
| 80 대시보드 | 포캐스트 수정 · 홀딩 처리 | 줄을 누르면 고치는 폼이 열린다(OpportunityModal·HoldingModal) |
| 20 대시보드 | (없음) | 모달이 없는 화면이다 — 숫자와 그래프만 있다 |
