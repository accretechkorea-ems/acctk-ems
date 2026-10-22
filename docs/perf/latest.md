# 브라우저 실측 — 2026-10-22 15:28

모드 **start (next start)** · 주소 http://localhost:3100 · 브라우저 Chromium(playwright ^1.64.1)

재는 값: ① 문서 TTFB ② 새로 받은 JS ③ 자료 요청 수(supabase+/api)와 중복 ④ 가장 느린 요청
⑤ 자료 요청 첫 시작→마지막 끝 ⑥ 직렬(앞 요청이 끝난 뒤 시작한 것) 수.

「새 JS」는 **그 화면에서 처음 받은** 스크립트만이다 — 공통 덩어리는 먼저 열어 본 화면에서
이미 받아 브라우저 캐시에 있다(그래서 0KB 인 화면이 있다). 「중복」은 같은 조회가 두 번 이상
나간 횟수의 합이고, URL 은 **파라미터 이름까지** 같아야 같은 것으로 센다(값은 적지 않는다).

## 화면

| 묶음 | 화면 | 경로 | TTFB | 새 JS | 자료 요청 | 중복 | 네트워크 완료 | 직렬 | 가장 느린 요청 |
|---|---|---|---|---|---|---|---|---|---|
| 주 메뉴 | 홈 | `/dashboard` | 66ms | 0KB | 14 | 2 | 1,670ms | 5 | /api/approval ?box 1157ms |
| 주 메뉴 | 알림 | `/notifications` | 259ms | 6KB | 9 | 2 | 1,264ms | 4 | /api/approval ?box 469ms |
| 주 메뉴 | 전자결재 | `/approval` | 90ms | 37KB | 12 | 3 | 1,244ms | 3 | /api/approval ?box 910ms |
| 대시보드 | 20 대시보드 | `/repair/dashboard` | 103ms | 148KB | 9 | — | 820ms | 2 | /api/repair-quotes ?revenue 820ms |
| 대시보드 | 80 대시보드 | `/dashboard/80` | 102ms | 26KB | 18 | 3 | 887ms | 1 | /api/approval ?box 398ms |
| 대시보드 | 활동 현황 | `/activity` | 66ms | 21KB | 13 | 2 | 560ms | 4 | /api/approval ?box 275ms |
| 고객 | 고객사 목록 | `/` | 71ms | 26KB | 12 | 2 | 877ms | 2 | /api/approval ?box 273ms |
| 고객 | 20 수리 | `/repair` | 71ms | 0KB | 11 | 2 | 595ms | 3 | /api/repair-quotes ?quote_ids 401ms |
| 고객 | 쇼룸 | `/showroom` | 69ms | 50KB | 21 | — | 1,005ms | 4 | /storage/v1/object/public/device-images/default_AXCEL.jpg 495ms |
| 고객 | 의뢰서 | `/inquiries` | 66ms | 33KB | 15 | 2 | 597ms | 4 | /api/inquiry 339ms |
| 영업 | 리드 | `/leads` | 67ms | 21KB | 12 | 2 | 564ms | 4 | /api/approval ?box 282ms |
| 영업 | 포캐스트 | `/pipeline` | 59ms | 37KB | 14 | 2 | 553ms | 3 | /api/approval ?box 271ms |
| 영업 | 견적서 | `/quote` | 67ms | 528KB | 13 | 2 | 585ms | 4 | /api/approval ?box 296ms |
| 영업 | 접촉 보고서 ⚠ | `/contact/semi` | 63ms | 12KB | 9 | 2 | 1,265ms | 3 | auth:user 466ms |
| 주문 | 발주 | `/purchase` | 65ms | 12KB | 12 | 2 | 539ms | 3 | /api/approval ?box 251ms |
| 주문 | 재고 | `/inventory` | 67ms | 15KB | 13 | 2 | 531ms | 3 | /api/approval ?box 255ms |
| 하단 | 건의사항 | `/suggestions` | 65ms | 9KB | 10 | 2 | 542ms | 3 | /api/approval ?box 275ms |
| 관리 | 실적 현황 | `/sales` | 62ms | 24KB | 14 | 2 | 544ms | 4 | /api/auto-fail 297ms |
| 관리 | 관리 | `/admin` | 655ms | 41KB | 8 | — | 4,059ms | 2 | offices(office_id,code,label,add…) ?order 1827ms |
| 고객 | 고객사 상세 (목록 첫 줄) | `/customer/159` | 136ms | 67KB | 16 | — | 546ms | 3 | /api/approval ?box 261ms |
| 고객 | 의뢰서 상세 (목록 첫 줄) | `/inquiries/e1786945-bf78-4716-8a4f-bb109a7dc637` | —ms | 18KB | 3 | — | 85ms | 0 | inquiry_messages(id,entry_date,body,direc…) ?inquiry_id&order 84ms |

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
| 홈 | 내 견적 (전체 탭) | 66ms | 2 | — | 1,002ms |  |
| 홈 | 내 실적 → 월별 그래프 | 8034ms | 1 | — | 423ms | 「월별 실적」가 보이지 않았다(열리지 않음) |
| 실적 현황 | 담당자 → 월별 그래프 | 104ms | 0 | — | 0ms |  |

## 중복 요청 (같은 URL·메서드가 한 화면에서 두 번 이상)

| 화면 | 요청 | 횟수 |
|---|---|---|
| 전자결재 | GET /api/approval ?box | 4 |
| 홈 | GET auth:user | 2 |
| 홈 | GET engineers(engineer_id,name,positio…) ?email | 2 |
| 알림 | GET auth:user | 2 |
| 알림 | GET engineers(engineer_id,name,positio…) ?email | 2 |
| 80 대시보드 | GET auth:user | 2 |
| 80 대시보드 | GET quotes(total_supply) ?status&tax_invoice_completed_at&tax_invoice_completed_at | 2 |
| 80 대시보드 | GET engineers(engineer_id,name,positio…) ?email | 2 |
| 활동 현황 | GET auth:user | 2 |
| 활동 현황 | GET engineers(engineer_id,name,positio…) ?email | 2 |
| 고객사 목록 | GET auth:user | 2 |
| 고객사 목록 | GET engineers(engineer_id,name,positio…) ?email | 2 |
| 20 수리 | GET auth:user | 2 |
| 20 수리 | GET engineers(engineer_id,name,positio…) ?email | 2 |
| 의뢰서 | GET auth:user | 2 |
| 의뢰서 | GET engineers(engineer_id,name,positio…) ?email | 2 |
| 리드 | GET auth:user | 2 |
| 리드 | GET engineers(engineer_id,name,positio…) ?email | 2 |
| 포캐스트 | GET auth:user | 2 |
| 포캐스트 | GET engineers(engineer_id,name,positio…) ?email | 2 |
| 견적서 | GET auth:user | 2 |
| 견적서 | GET engineers(engineer_id,name,positio…) ?email | 2 |
| 접촉 보고서 | GET auth:user | 2 |
| 접촉 보고서 | GET engineers(engineer_id,name,positio…) ?email | 2 |
| 발주 | GET auth:user | 2 |
| 발주 | GET engineers(engineer_id,name,positio…) ?email | 2 |
| 재고 | GET auth:user | 2 |
| 재고 | GET engineers(engineer_id,name,positio…) ?email | 2 |
| 건의사항 | GET auth:user | 2 |
| 건의사항 | GET engineers(engineer_id,name,positio…) ?email | 2 |
| 실적 현황 | GET auth:user | 2 |
| 실적 현황 | GET engineers(engineer_id,name,positio…) ?email | 2 |

## 가장 느린 요청 10개

| 화면 | 요청 | 시간 | 종류 |
|---|---|---|---|
| 관리 | offices(office_id,code,label,add…) ?order | 1827ms | supabase |
| 관리 | team_permissions(team_id,perm_key) | 1786ms | supabase |
| 관리 | teams(*) ?order | 1749ms | supabase |
| 관리 | teams(id,name,division) | 1743ms | supabase |
| 관리 | engineers(engineer_id,name,positio…) ?email | 1741ms | supabase |
| 관리 | auth:user | 1177ms | supabase |
| 홈 | /api/approval ?box | 1157ms | api |
| 관리 | notifications(id,engineer_id,title,mes…) ?engineer_id&limit&offset&order | 1065ms | supabase |
| 전자결재 | /api/approval ?box | 910ms | api |
| 20 대시보드 | /api/repair-quotes ?revenue | 820ms | api |

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
