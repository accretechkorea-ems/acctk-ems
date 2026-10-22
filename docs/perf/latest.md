# 브라우저 실측 — 2026-10-22 16:19

모드 **start (next start)** · 주소 http://localhost:3100 · 브라우저 Chromium(playwright ^1.64.1)

재는 값: ① 문서 TTFB ② 새로 받은 JS ③ 자료 요청 수(supabase+/api)와 중복 ④ 가장 느린 요청
⑤ 자료 요청 첫 시작→마지막 끝 ⑥ 직렬(앞 요청이 끝난 뒤 시작한 것) 수.

「새 JS」는 **그 화면에서 처음 받은** 스크립트만이다 — 공통 덩어리는 먼저 열어 본 화면에서
이미 받아 브라우저 캐시에 있다(그래서 0KB 인 화면이 있다). 「중복」은 같은 조회가 두 번 이상
나간 횟수의 합이고, URL 은 **파라미터 이름까지** 같아야 같은 것으로 센다(값은 적지 않는다).

## 화면

| 묶음 | 화면 | 경로 | TTFB | 새 JS | 자료 요청 | 중복 | 네트워크 완료 | 직렬 | 가장 느린 요청 |
|---|---|---|---|---|---|---|---|---|---|
| 주 메뉴 | 홈 | `/dashboard` | 5408ms | 0KB | 2 | — | 1,987ms | 0 | auth:user 1986ms |
| 주 메뉴 | 알림 | `/notifications` | 82ms | 6KB | 7 | — | 1,190ms | 3 | /api/approval ?box 604ms |
| 주 메뉴 | 전자결재 | `/approval` | 195ms | 37KB | 12 | 3 | 1,704ms | 3 | /api/approval/done ?scope 1108ms |
| 대시보드 | 20 대시보드 | `/repair/dashboard` | 120ms | 148KB | 9 | — | 966ms | 3 | /api/repair-quotes ?revenue 763ms |
| 대시보드 | 80 대시보드 | `/dashboard/80` | 68ms | 26KB | 16 | 1 | 2,280ms | 2 | sales_activities(activity_type) ?activity_date&activity_date 1858ms |
| 대시보드 | 활동 현황 | `/activity` | 244ms | 21KB | 11 | — | 687ms | 5 | /api/approval ?box 394ms |
| 고객 | 고객사 목록 | `/` | 70ms | 26KB | 10 | — | 552ms | 3 | customers(customer_id,company_name…) ?deleted_at&is_parent&limit&offset&order 273ms |
| 고객 | 20 수리 | `/repair` | 62ms | 0KB | 9 | — | 639ms | 2 | /api/repair-quotes ?quote_ids 446ms |
| 고객 | 쇼룸 | `/showroom` | 69ms | 50KB | 21 | — | 783ms | 4 | /api/showroom/stats ?from&site&to 362ms |
| 고객 | 의뢰서 | `/inquiries` | 71ms | 33KB | 13 | — | 604ms | 4 | /api/approval ?box 377ms |
| 영업 | 리드 | `/leads` | 69ms | 21KB | 10 | — | 457ms | 4 | /api/approval ?box 256ms |
| 영업 | 포캐스트 | `/pipeline` | 66ms | 37KB | 12 | — | 443ms | 2 | /api/approval ?box 230ms |
| 영업 | 견적서 | `/quote` | 65ms | 528KB | 11 | — | 476ms | 2 | /api/approval ?box 264ms |
| 영업 | 접촉 보고서 ⚠ | `/contact/semi` | 65ms | 12KB | 7 | — | 439ms | 3 | /api/approval ?box 236ms |
| 주문 | 발주 | `/purchase` | 160ms | 12KB | 9 | — | 383ms | 3 | customers(customer_id,company_name) 141ms |
| 주문 | 재고 | `/inventory` | 175ms | 15KB | 2 | — | 271ms | 1 | auth:user 269ms |
| 하단 | 건의사항 | `/suggestions` | 145ms | 9KB | 4 | 1 | 2,862ms | 2 | engineers(engineer_id,name,positio…) ?email 1431ms |
| 관리 | 실적 현황 | `/sales` | 227ms | 24KB | 12 | — | 2,099ms | 5 | /api/auto-fail 1063ms |
| 관리 | 관리 | `/admin` | 156ms | 41KB | 9 | — | 672ms | 2 | /api/approval ?box 484ms |
| 고객 | 고객사 상세 (목록 첫 줄) | `/customer/159` | 72ms | 67KB | 16 | — | 534ms | 2 | /api/approval ?box 292ms |
| 고객 | 의뢰서 상세 (목록 첫 줄) | `/inquiries/e1786945-bf78-4716-8a4f-bb109a7dc637` | —ms | 18KB | 3 | — | 107ms | 0 | inquiries(id,inquiry_no,inquiry_ty…) ?id 107ms |

## 탭 전환

| 화면 | 동작 | 걸린 시간 | 자료 요청 | 중복 | 네트워크 | 비고 |
|---|---|---|---|---|---|---|
| 알림 | 탭: 안 읽음 | 요청 없음(화면에서만 거른다) | 0 | — | 0ms |  |
| 알림 | 탭: 전체 | 요청 없음(화면에서만 거른다) | 0 | — | 0ms |  |
| 전자결재 | 탭: 기결 | 요청 없음(화면에서만 거른다) | 0 | — | 0ms |  |
| 전자결재 | 탭: 상신 | 요청 없음(화면에서만 거른다) | 0 | — | 0ms | 금지어 「상신」 — 누르지 않는다 |
| 전자결재 | 탭: 참조 | 요청 없음(화면에서만 거른다) | 0 | — | 0ms |  |
| 전자결재 | 탭: 미결 | 요청 없음(화면에서만 거른다) | 0 | — | 0ms |  |

## 모달

| 화면 | 모달 | 열리기까지 | 자료 요청 | 중복 | 네트워크 | 비고 |
|---|---|---|---|---|---|---|
| 홈 | 내 견적 (전체 탭) | 1ms | 3 | — | 2,512ms | 화면에 없다 |
| 홈 | 내 실적 → 월별 그래프 | 8029ms | 7 | — | 7,227ms | 「월별 실적」가 보이지 않았다(열리지 않음) |
| 실적 현황 | 담당자 → 월별 그래프 | 81ms | 0 | — | 0ms |  |

## 중복 요청 (같은 URL·메서드가 한 화면에서 두 번 이상)

| 화면 | 요청 | 횟수 |
|---|---|---|
| 전자결재 | GET /api/approval ?box | 4 |
| 80 대시보드 | GET quotes(total_supply) ?status&tax_invoice_completed_at&tax_invoice_completed_at | 2 |
| 건의사항 | GET engineers(engineer_id,name,positio…) ?email | 2 |

## 가장 느린 요청 10개

| 화면 | 요청 | 시간 | 종류 |
|---|---|---|---|
| 홈 | auth:user | 1986ms | supabase |
| 80 대시보드 | sales_activities(activity_type) ?activity_date&activity_date | 1858ms | supabase |
| 80 대시보드 | team_permissions(team_id,perm_key) | 1708ms | supabase |
| 건의사항 | engineers(engineer_id,name,positio…) ?email | 1431ms | supabase |
| 건의사항 | engineers(engineer_id,name,positio…) ?email | 1223ms | supabase |
| 전자결재 | /api/approval/done ?scope | 1108ms | api |
| 실적 현황 | /api/auto-fail | 1063ms | api |
| 실적 현황 | /api/approval ?box | 1022ms | api |
| 실적 현황 | quotes(*,engineers!quotes_engin…) ?order | 1019ms | supabase |
| 전자결재 | /api/approval ?box | 1008ms | api |

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
