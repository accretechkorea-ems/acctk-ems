# 브라우저 실측 — 2026-10-23 09:16

모드 **start (next start)** · 주소 http://localhost:3100 · 브라우저 Chromium(playwright ^1.64.1)

재는 값: ① 문서 TTFB ② 새로 받은 JS ③ 자료 요청 수(supabase+/api)와 중복 ④ 가장 느린 요청
⑤ 자료 요청 첫 시작→마지막 끝 ⑥ 직렬(앞 요청이 끝난 뒤 시작한 것) 수.

「새 JS」는 **그 화면에서 처음 받은** 스크립트만이다 — 공통 덩어리는 먼저 열어 본 화면에서
이미 받아 브라우저 캐시에 있다(그래서 0KB 인 화면이 있다). 「중복」은 같은 조회가 두 번 이상
나간 횟수의 합이고, URL 은 **파라미터 이름까지** 같아야 같은 것으로 센다(값은 적지 않는다).

## 화면

| 묶음 | 화면 | 경로 | TTFB | 새 JS | 자료 요청 | 중복 | 네트워크 완료 | 직렬 | 가장 느린 요청 |
|---|---|---|---|---|---|---|---|---|---|
| 주 메뉴 | 홈 | `/dashboard` | 277ms | 0KB | 11 | — | 1,048ms | 5 | /api/approval ?box 401ms |
| 주 메뉴 | 알림 | `/notifications` | 180ms | 6KB | 6 | — | 1,015ms | 4 | /api/approval ?box 337ms |
| 주 메뉴 | 전자결재 | `/approval` | 128ms | 37KB | 9 | — | 1,473ms | 4 | /api/approval/done ?scope 900ms |
| 대시보드 | 20 대시보드 | `/repair/dashboard` | 142ms | 148KB | 8 | — | 1,607ms | 3 | /api/repair-quotes ?revenue 1026ms |
| 대시보드 | 80 대시보드 | `/dashboard/80` | 108ms | 26KB | 14 | — | 736ms | 2 | holdings(*,customers(company_name…) ?order 453ms |
| 대시보드 | 활동 현황 | `/activity` | 118ms | 21KB | 10 | — | 957ms | 6 | sales_activities(activity_id,engineer_id,…) ?activity_date&activity_date 202ms |
| 고객 | 고객사 목록 | `/` | 128ms | 26KB | 9 | — | 530ms | 3 | devices(device_id,customer_id,de…) ?deleted_at&limit&offset 341ms |
| 고객 | 20 수리 | `/repair` | 162ms | 0KB | 8 | — | 959ms | 3 | /api/repair-quotes ?quote_ids 681ms |
| 고객 | 쇼룸 | `/showroom` | 147ms | 50KB | 19 | — | 1,705ms | 5 | /storage/v1/render/image/public/device-images/default_SNEX200.jpg ?quality&resize&width 782ms |
| 고객 | 의뢰서 | `/inquiries` | 132ms | 33KB | 12 | — | 967ms | 5 | /api/inquiry 642ms |
| 영업 | 리드 | `/leads` | 111ms | 21KB | 9 | — | 559ms | 4 | /api/approval ?box 195ms |
| 영업 | 포캐스트 | `/pipeline` | 229ms | 37KB | 11 | — | 639ms | 3 | /api/approval ?box 257ms |
| 영업 | 견적서 | `/quote` | 182ms | 528KB | 10 | — | 648ms | 4 | /api/approval ?box 240ms |
| 영업 | 접촉 보고서 ⚠ | `/contact/semi` | 134ms | 12KB | 6 | — | 545ms | 4 | /api/approval ?box 204ms |
| 주문 | 발주 | `/purchase` | 96ms | 12KB | 9 | — | 765ms | 3 | customers(customer_id,company_name) 301ms |
| 주문 | 재고 | `/inventory` | 136ms | 15KB | 10 | — | 4,236ms | 3 | inventory_items(*) ?order 2967ms |
| 하단 | 건의사항 | `/suggestions` | 177ms | 9KB | 7 | — | 847ms | 3 | /api/approval ?box 293ms |
| 관리 | 실적 현황 | `/sales` | 112ms | 24KB | 11 | — | 891ms | 4 | /api/auto-fail 474ms |
| 관리 | 관리 | `/admin` | 151ms | 41KB | 6 | — | 538ms | 4 | /api/approval ?box 170ms |
| 고객 | 고객사 상세 (목록 첫 줄) | `/customer/880` | 253ms | 68KB | 15 | — | 777ms | 2 | devices(*) ?customer_id&deleted_at&order 304ms |
| 고객 | 의뢰서 상세 (목록 첫 줄) | `/inquiries/4b46d5c2-7682-4a49-a47c-25d2c72be800` | —ms | 18KB | 3 | — | 188ms | 0 | inquiries(id,inquiry_no,inquiry_ty…) ?id 184ms |

## 탭 전환

| 화면 | 동작 | 걸린 시간 | 자료 요청 | 중복 | 네트워크 | 비고 |
|---|---|---|---|---|---|---|
| 알림 | 탭: 안 읽음 | 요청 없음(화면에서만 거른다) | 0 | — | 0ms |  |
| 알림 | 탭: 전체 | 요청 없음(화면에서만 거른다) | 0 | — | 0ms |  |
| 전자결재 | 탭: 기결 | 요청 없음(화면에서만 거른다) | 0 | — | 0ms |  |
| 전자결재 | 탭: 상신 | 요청 없음(화면에서만 거른다) | 0 | — | 0ms | 금지어 「상신」 — 누르지 않는다 |
| 전자결재 | 탭: 참조 | 4728ms | 1 | — | 2,252ms |  |
| 전자결재 | 탭: 미결 | 4097ms | 1 | — | 1,116ms |  |

## 모달

| 화면 | 모달 | 열리기까지 | 자료 요청 | 중복 | 네트워크 | 비고 |
|---|---|---|---|---|---|---|
| 홈 | 내 견적 (전체 탭) | 83ms | 2 | — | 401ms |  |
| 홈 | 내 실적 → 월별 그래프 | 79ms | 0 | — | 0ms |  |
| 실적 현황 | 담당자 → 월별 그래프 | 139ms | 0 | — | 0ms |  |

## 중복 요청 (같은 URL·메서드가 한 화면에서 두 번 이상)

없다.

## 가장 느린 요청 10개

| 화면 | 요청 | 시간 | 종류 |
|---|---|---|---|
| 재고 | inventory_items(*) ?order | 2967ms | supabase |
| 재고 | inventory_logs(*,inventory_items(item_n…) ?order | 2966ms | supabase |
| 재고 | inventory_requests(*,inventory_items(item_n…) ?order | 2760ms | supabase |
| 재고 | engineers(engineer_id,name,positio…) ?email | 1733ms | supabase |
| 재고 | engineers(engineer_id,name,positio…) ?order | 1627ms | supabase |
| 재고 | teams(id,name,division,team_pe…) | 1094ms | supabase |
| 재고 | /api/approval ?box | 1052ms | api |
| 20 대시보드 | /api/repair-quotes ?revenue | 1026ms | api |
| 전자결재 | /api/approval/done ?scope | 900ms | api |
| 쇼룸 | /storage/v1/render/image/public/device-images/default_SNEX200.jpg ?quality&resize&width | 782ms | supabase |

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
