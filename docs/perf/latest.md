# 브라우저 실측 — 2026-10-22 16:51

모드 **start (next start)** · 주소 http://localhost:3100 · 브라우저 Chromium(playwright ^1.64.1)

재는 값: ① 문서 TTFB ② 새로 받은 JS ③ 자료 요청 수(supabase+/api)와 중복 ④ 가장 느린 요청
⑤ 자료 요청 첫 시작→마지막 끝 ⑥ 직렬(앞 요청이 끝난 뒤 시작한 것) 수.

「새 JS」는 **그 화면에서 처음 받은** 스크립트만이다 — 공통 덩어리는 먼저 열어 본 화면에서
이미 받아 브라우저 캐시에 있다(그래서 0KB 인 화면이 있다). 「중복」은 같은 조회가 두 번 이상
나간 횟수의 합이고, URL 은 **파라미터 이름까지** 같아야 같은 것으로 센다(값은 적지 않는다).

## 화면

| 묶음 | 화면 | 경로 | TTFB | 새 JS | 자료 요청 | 중복 | 네트워크 완료 | 직렬 | 가장 느린 요청 |
|---|---|---|---|---|---|---|---|---|---|
| 주 메뉴 | 홈 | `/dashboard` | 78ms | 0KB | 12 | — | 778ms | 5 | /api/approval ?box 402ms |
| 주 메뉴 | 알림 | `/notifications` | 169ms | 6KB | 7 | — | 1,648ms | 4 | /api/approval ?box 668ms |
| 주 메뉴 | 전자결재 | `/approval` | 171ms | 37KB | 10 | 1 | 1,343ms | 4 | /api/approval/done ?scope 624ms |
| 대시보드 | 20 대시보드 | `/repair/dashboard` | 183ms | 148KB | 9 | — | 1,637ms | 3 | /api/repair-quotes ?revenue 834ms |
| 대시보드 | 80 대시보드 | `/dashboard/80` | 199ms | 26KB | 16 | 1 | 1,276ms | 4 | service_history(service_id,visit_date,st…) ?order&visit_date 796ms |
| 대시보드 | 활동 현황 | `/activity` | 323ms | 21KB | 11 | — | 3,438ms | 5 | /api/approval ?box 2076ms |
| 고객 | 고객사 목록 | `/` | 172ms | 26KB | 10 | — | 2,435ms | 2 | devices(device_id,customer_id,de…) ?deleted_at&limit&offset 1196ms |
| 고객 | 20 수리 | `/repair` | 81ms | 0KB | 9 | — | 1,127ms | 5 | /api/repair-quotes ?quote_ids 742ms |
| 고객 | 쇼룸 | `/showroom` | 80ms | 50KB | 21 | — | 1,164ms | 5 | /api/showroom/stats ?from&site&to 699ms |
| 고객 | 의뢰서 | `/inquiries` | 121ms | 33KB | 13 | — | 2,153ms | 5 | /api/inquiry 1550ms |
| 영업 | 리드 | `/leads` | 83ms | 21KB | 10 | — | 552ms | 4 | /api/approval ?box 306ms |
| 영업 | 포캐스트 | `/pipeline` | 124ms | 37KB | 12 | — | 834ms | 2 | /api/approval ?box 394ms |
| 영업 | 견적서 | `/quote` | 72ms | 528KB | 11 | — | 542ms | 2 | /api/approval ?box 275ms |
| 영업 | 접촉 보고서 ⚠ | `/contact/semi` | 83ms | 12KB | 7 | — | 604ms | 4 | /api/approval ?box 238ms |
| 주문 | 발주 | `/purchase` | 210ms | 12KB | 10 | — | 548ms | 3 | /api/approval ?box 254ms |
| 주문 | 재고 | `/inventory` | 66ms | 15KB | 11 | — | 824ms | 2 | auth:user 310ms |
| 하단 | 건의사항 | `/suggestions` | 127ms | 0KB | 8 | — | 674ms | 3 | /api/approval ?box 303ms |
| 관리 | 실적 현황 | `/sales` | 86ms | 24KB | 12 | — | 3,407ms | 5 | quotes(*,engineers!quotes_engin…) ?order 2566ms |
| 관리 | 관리 | `/admin` | 170ms | 41KB | 7 | — | 775ms | 4 | /api/approval ?box 385ms |
| 고객 | 고객사 상세 (목록 첫 줄) | `/customer/159` | 84ms | 67KB | 16 | — | 535ms | 2 | holdings(*,devices(device_name,de…) ?customer_id&order 240ms |
| 고객 | 의뢰서 상세 (목록 첫 줄) | `/inquiries/4b46d5c2-7682-4a49-a47c-25d2c72be800` | —ms | 18KB | 3 | — | 107ms | 0 | inquiry_attachments(id,message_id,file_name,…) ?inquiry_id&order 105ms |

## 탭 전환

| 화면 | 동작 | 걸린 시간 | 자료 요청 | 중복 | 네트워크 | 비고 |
|---|---|---|---|---|---|---|
| 알림 | 탭: 안 읽음 | 요청 없음(화면에서만 거른다) | 0 | — | 0ms |  |
| 알림 | 탭: 전체 | 요청 없음(화면에서만 거른다) | 0 | — | 0ms |  |
| 전자결재 | 탭: 기결 | 요청 없음(화면에서만 거른다) | 0 | — | 0ms |  |
| 전자결재 | 탭: 상신 | 요청 없음(화면에서만 거른다) | 0 | — | 0ms | 금지어 「상신」 — 누르지 않는다 |
| 전자결재 | 탭: 참조 | 4070ms | 1 | — | 499ms |  |
| 전자결재 | 탭: 미결 | 4109ms | 1 | — | 396ms |  |

## 모달

| 화면 | 모달 | 열리기까지 | 자료 요청 | 중복 | 네트워크 | 비고 |
|---|---|---|---|---|---|---|
| 홈 | 내 견적 (전체 탭) | 84ms | 2 | — | 320ms |  |
| 홈 | 내 실적 → 월별 그래프 | 51ms | 0 | — | 0ms |  |
| 20 대시보드 | 수리 목록 (첫 카드) | 8064ms | 1 | — | 191ms | 「닫기」가 보이지 않았다(열리지 않음) |
| 80 대시보드 | 단계 카드 → 목록 | 8044ms | 1 | — | 99ms | 「닫기」가 보이지 않았다(열리지 않음) |
| 실적 현황 | 담당자 → 월별 그래프 | 157ms | 0 | — | 0ms |  |

## 중복 요청 (같은 URL·메서드가 한 화면에서 두 번 이상)

| 화면 | 요청 | 횟수 |
|---|---|---|
| 전자결재 | GET /api/approval ?box | 2 |
| 80 대시보드 | GET quotes(total_supply) ?status&tax_invoice_completed_at&tax_invoice_completed_at | 2 |

## 가장 느린 요청 10개

| 화면 | 요청 | 시간 | 종류 |
|---|---|---|---|
| 실적 현황 | quotes(*,engineers!quotes_engin…) ?order | 2566ms | supabase |
| 활동 현황 | /api/approval ?box | 2076ms | api |
| 활동 현황 | notifications(id,engineer_id,title,mes…) ?engineer_id&limit&offset&order | 1680ms | supabase |
| 의뢰서 | /api/inquiry | 1550ms | api |
| 의뢰서 | rpc/search_inquiries | 1532ms | supabase |
| 실적 현황 | /api/approval ?box | 1503ms | api |
| 의뢰서 | /api/approval ?box | 1498ms | api |
| 의뢰서 | inquiries(issued_date) ?limit&order | 1274ms | supabase |
| 실적 현황 | customers(customer_id,company_name) | 1228ms | supabase |
| 실적 현황 | sales_targets(*) | 1199ms | supabase |

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
