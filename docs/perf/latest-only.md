# 브라우저 실측 — 2026-10-23 09:04

모드 **start (next start)** · 주소 http://localhost:3100 · 브라우저 Chromium(playwright ^1.64.1)

재는 값: ① 문서 TTFB ② 새로 받은 JS ③ 자료 요청 수(supabase+/api)와 중복 ④ 가장 느린 요청
⑤ 자료 요청 첫 시작→마지막 끝 ⑥ 직렬(앞 요청이 끝난 뒤 시작한 것) 수.

「새 JS」는 **그 화면에서 처음 받은** 스크립트만이다 — 공통 덩어리는 먼저 열어 본 화면에서
이미 받아 브라우저 캐시에 있다(그래서 0KB 인 화면이 있다). 「중복」은 같은 조회가 두 번 이상
나간 횟수의 합이고, URL 은 **파라미터 이름까지** 같아야 같은 것으로 센다(값은 적지 않는다).

## 화면

| 묶음 | 화면 | 경로 | TTFB | 새 JS | 자료 요청 | 중복 | 네트워크 완료 | 직렬 | 가장 느린 요청 |
|---|---|---|---|---|---|---|---|---|---|
| 주 메뉴 | 홈 | `/dashboard` | 151ms | 0KB | 12 | — | 657ms | 5 | /api/approval ?box 310ms |
| 대시보드 | 20 대시보드 | `/repair/dashboard` | 401ms | 148KB | 9 | — | 2,944ms | 2 | /api/repair-quotes ?revenue 1742ms |
| 대시보드 | 80 대시보드 | `/dashboard/80` | 198ms | 26KB | 15 | — | 2,013ms | 3 | holdings(*,customers(company_name…) ?order 1772ms |

## 모달

| 화면 | 모달 | 열리기까지 | 자료 요청 | 중복 | 네트워크 | 비고 |
|---|---|---|---|---|---|---|
| 홈 | 내 견적 (전체 탭) | 72ms | 2 | — | 437ms |  |
| 홈 | 내 실적 → 월별 그래프 | 64ms | 0 | — | 0ms |  |

## 중복 요청 (같은 URL·메서드가 한 화면에서 두 번 이상)

없다.

## 가장 느린 요청 10개

| 화면 | 요청 | 시간 | 종류 |
|---|---|---|---|
| 80 대시보드 | holdings(*,customers(company_name…) ?order | 1772ms | supabase |
| 20 대시보드 | /api/repair-quotes ?revenue | 1742ms | api |
| 80 대시보드 | quotes(total_supply) ?status&tax_invoice_completed_at&tax_invoice_completed_at | 1705ms | supabase |
| 80 대시보드 | sales_opportunities(*,customers(company_name…) ?closed_at&stage | 1656ms | supabase |
| 80 대시보드 | sales_activities(activity_type) ?activity_date&activity_date | 1641ms | supabase |
| 80 대시보드 | service_history(service_type) ?visit_date&visit_date&visit_date | 1618ms | supabase |
| 80 대시보드 | service_history(service_id,visit_date,st…) ?order&visit_date | 1591ms | supabase |
| 20 대시보드 | notifications(id,engineer_id,title,mes…) ?engineer_id&limit&offset&order | 1093ms | supabase |
| 20 대시보드 | /api/approval ?box | 1070ms | api |
| 20 대시보드 | repairs(*) ?order | 1036ms | supabase |

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
