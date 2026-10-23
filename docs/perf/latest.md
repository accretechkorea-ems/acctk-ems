# 브라우저 실측 — 2026-10-23 09:07

모드 **start (next start)** · 주소 http://localhost:3100 · 브라우저 Chromium(playwright ^1.64.1)

재는 값: ① 문서 TTFB ② 새로 받은 JS ③ 자료 요청 수(supabase+/api)와 중복 ④ 가장 느린 요청
⑤ 자료 요청 첫 시작→마지막 끝 ⑥ 직렬(앞 요청이 끝난 뒤 시작한 것) 수.

「새 JS」는 **그 화면에서 처음 받은** 스크립트만이다 — 공통 덩어리는 먼저 열어 본 화면에서
이미 받아 브라우저 캐시에 있다(그래서 0KB 인 화면이 있다). 「중복」은 같은 조회가 두 번 이상
나간 횟수의 합이고, URL 은 **파라미터 이름까지** 같아야 같은 것으로 센다(값은 적지 않는다).

## 화면

| 묶음 | 화면 | 경로 | TTFB | 새 JS | 자료 요청 | 중복 | 네트워크 완료 | 직렬 | 가장 느린 요청 |
|---|---|---|---|---|---|---|---|---|---|
| 주 메뉴 | 홈 | `/dashboard` | 81ms | 0KB | 12 | — | 729ms | 4 | /api/approval ?box 299ms |
| 주 메뉴 | 알림 | `/notifications` | 400ms | 6KB | 7 | — | 2,093ms | 4 | /api/approval ?box 762ms |
| 주 메뉴 | 전자결재 | `/approval` | 216ms | 37KB | 10 | — | 4,397ms | 4 | /api/approval/done ?scope 2659ms |
| 대시보드 | 20 대시보드 | `/repair/dashboard` | 116ms | 148KB | 9 | — | 854ms | 4 | /api/repair-quotes ?revenue 443ms |
| 대시보드 | 80 대시보드 | `/dashboard/80` | 76ms | 26KB | 15 | — | 628ms | 3 | sales_activities(activity_type) ?activity_date&activity_date 262ms |
| 대시보드 | 활동 현황 | `/activity` | 154ms | 21KB | 11 | — | 717ms | 6 | /api/approval ?box 264ms |
| 고객 | 고객사 목록 | `/` | 90ms | 26KB | 10 | — | 939ms | 3 | customers(customer_id,company_name…) ?deleted_at&is_parent&limit&offset&order 718ms |
| 고객 | 20 수리 | `/repair` | 79ms | 0KB | 9 | — | 649ms | 3 | /api/repair-quotes ?quote_ids 481ms |
| 고객 | 쇼룸 | `/showroom` | 898ms | 50KB | 20 | — | 5,377ms | 4 | /api/showroom/stats ?from&site&to 2703ms |
| 고객 | 의뢰서 | `/inquiries` | 115ms | 33KB | 13 | — | 732ms | 5 | /api/inquiry 451ms |
| 영업 | 리드 | `/leads` | 86ms | 21KB | 10 | — | 767ms | 3 | auth:user 286ms |
| 영업 | 포캐스트 | `/pipeline` | 77ms | 37KB | 12 | — | 437ms | 3 | /api/approval ?box 194ms |
| 영업 | 견적서 | `/quote` | 109ms | 528KB | 11 | — | 625ms | 3 | /api/approval ?box 241ms |
| 영업 | 접촉 보고서 ⚠ | `/contact/semi` | 123ms | 12KB | 7 | — | 1,415ms | 4 | /api/approval ?box 871ms |
| 주문 | 발주 | `/purchase` | 113ms | 12KB | 10 | — | 858ms | 3 | engineers(engineer_id,name,positio…) ?order 463ms |
| 주문 | 재고 | `/inventory` | 83ms | 15KB | 11 | — | 649ms | 3 | /api/approval ?box 226ms |
| 하단 | 건의사항 | `/suggestions` | 87ms | 9KB | 8 | — | 528ms | 4 | /api/approval ?box 199ms |
| 관리 | 실적 현황 | `/sales` | 88ms | 24KB | 12 | — | 879ms | 5 | /api/auto-fail 462ms |
| 관리 | 관리 | `/admin` | 160ms | 41KB | 7 | — | 1,380ms | 4 | engineers(engineer_id,name,positio…) ?email 463ms |
| 고객 | 고객사 상세 (목록 첫 줄) | `/customer/880` | 264ms | 68KB | 16 | — | 2,793ms | 3 | holdings(*,devices(device_name,de…) ?customer_id&order 2293ms |
| 고객 | 의뢰서 상세 (목록 첫 줄) | `/inquiries/4b46d5c2-7682-4a49-a47c-25d2c72be800` | —ms | 18KB | 3 | — | 135ms | 0 | inquiries(id,inquiry_no,inquiry_ty…) ?id 135ms |

## 탭 전환

| 화면 | 동작 | 걸린 시간 | 자료 요청 | 중복 | 네트워크 | 비고 |
|---|---|---|---|---|---|---|
| 알림 | 탭: 안 읽음 | 요청 없음(화면에서만 거른다) | 0 | — | 0ms |  |
| 알림 | 탭: 전체 | 요청 없음(화면에서만 거른다) | 0 | — | 0ms |  |
| 전자결재 | 탭: 기결 | 요청 없음(화면에서만 거른다) | 0 | — | 0ms |  |
| 전자결재 | 탭: 상신 | 요청 없음(화면에서만 거른다) | 0 | — | 0ms | 금지어 「상신」 — 누르지 않는다 |
| 전자결재 | 탭: 참조 | 4072ms | 1 | — | 380ms |  |
| 전자결재 | 탭: 미결 | 4096ms | 1 | — | 400ms |  |

## 모달

| 화면 | 모달 | 열리기까지 | 자료 요청 | 중복 | 네트워크 | 비고 |
|---|---|---|---|---|---|---|
| 홈 | 내 견적 (전체 탭) | 79ms | 2 | — | 295ms |  |
| 홈 | 내 실적 → 월별 그래프 | 69ms | 0 | — | 0ms |  |
| 실적 현황 | 담당자 → 월별 그래프 | 116ms | 0 | — | 0ms |  |

## 중복 요청 (같은 URL·메서드가 한 화면에서 두 번 이상)

없다.

## 가장 느린 요청 10개

| 화면 | 요청 | 시간 | 종류 |
|---|---|---|---|
| 쇼룸 | /api/showroom/stats ?from&site&to | 2703ms | api |
| 전자결재 | /api/approval/done ?scope | 2659ms | api |
| 쇼룸 | showroom_usage(device_id,work_hours,pur…) ?deleted_at&usage_date&usage_date | 2523ms | supabase |
| 전자결재 | /api/approval ?box | 2373ms | api |
| 고객사 상세 (목록 첫 줄) | holdings(*,devices(device_name,de…) ?customer_id&order | 2293ms | supabase |
| 고객사 상세 (목록 첫 줄) | sales_opportunities(*,engineers(name,positio…) ?customer_id&order | 2265ms | supabase |
| 고객사 상세 (목록 첫 줄) | sales_activities(*,engineers(name,positio…) ?customer_id&order | 2235ms | supabase |
| 쇼룸 | notifications(id,engineer_id,title,mes…) ?engineer_id&limit&offset&order | 2220ms | supabase |
| 쇼룸 | /api/approval ?box | 2218ms | api |
| 쇼룸 | showroom_sites(customer_id,created_at,c…) ?order | 2216ms | supabase |

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
