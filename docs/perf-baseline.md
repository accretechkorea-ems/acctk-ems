# 성능 측정 — 1단계 기준선 (2026-10-22)

무엇을 고칠지 정하기 전에, **지금 무엇이 몇 번 나가는지** 코드에서 센 기록이다.
브라우저를 띄워 잰 값이 아니라 **코드 경로를 따라 센 값**이다(헤드리스 브라우저 미설치).
화면에서 관찰된 값(요청 30개 · auth/user 3회 · engineers 4회 · quotes·customers·
sales_targets·notifications 각 2회 · 타임라인 12초)과 맞춰 읽는다.

---

## 요약 — 왜 많은가

| 원인 | 무엇 | 사실/추측 |
|---|---|---|
| ① 본인 확인이 화면마다 따로 | `auth.getUser()` → `engineers where email` → `loadTeamPerms()` 를 사이드바·각 화면·각 훅이 **제각기** 부른다. 한 화면에 최소 2벌(사이드바 + 그 화면) | 사실 (아래 a) |
| ② 같은 자료를 두 곳에서 | 결재 미결함을 사이드바 배지와 결재 카드가 각각 `/api/approval?box=inbox` 로 읽는다. 알림도 사이드바 배지와 알림 카드가 따로 읽는다 | 사실 |
| ③ 알림 10초 폴링 | `useNotifications` 기본 `pollMs = 10000`, 조회는 `select('*')`. 사이드바가 모든 화면에서 쓴다 → 12초 타임라인에 notifications 가 두 번 보이는 이유 | 사실 (hooks/useNotifications.ts:21,67,97) |
| ④ 개발 모드 이중 실행 | App Router 는 React Strict Mode 가 기본 켜짐이다. `useEffect` 가 dev 에서 두 번 돌아 **effect 로 나가는 조회가 전부 2회**가 된다. 운영 빌드에서는 1회 | 사실(동작) + 추측(관찰값의 몇 할인지) |
| ⑤ 직렬 await | 본인 확인 세 단계가 줄줄이 이어진 뒤에야 화면 자료를 읽기 시작한다 | 사실 (아래 c) |

①②③은 운영에서도 그대로 남는 **구조 문제**다. ④는 dev 에서만 보이는 배수다 —
관찰값 「engineers 4회」는 호출부 2곳 × 2(Strict Mode)로 설명된다.

---

## /dashboard 초기 로드 — 코드 경로로 센 조회 (수정 전)

| # | 조회 | 어디서 | 비고 |
|---|---|---|---|
| 1 | `auth.getUser()` | components/layout/Sidebar.tsx:256 | |
| 2 | `engineers` (email) | components/layout/Sidebar.tsx:260 | |
| 3 | `teams` | lib/teamPerms.ts:34 | 모듈 캐시(세션 1회) |
| 4 | `team_permissions` | lib/teamPerms.ts:35 | 모듈 캐시(세션 1회) |
| 5 | `notifications` `select('*')` | hooks/useNotifications.ts:67 (사이드바 배지) | **10초마다 반복** |
| 6 | `GET /api/approval?box=inbox` | components/layout/Sidebar.tsx:240 | 서버에서 `auth.getUser`+`engineers`+`approval_documents`+`approval_delegations` |
| 7 | `auth.getClaims()` | components/common/NoticePopup.tsx:44 | 로컬 검증 실패 시 `/auth/v1/user` 로 나간다 |
| 8 | `notices` | components/common/NoticePopup.tsx:53 | |
| 9 | `auth.getUser()` | app/dashboard/page.tsx:67 | **①과 중복** |
| 10 | `engineers` (email) | app/dashboard/page.tsx:70 | **②와 중복** |
| 11 | (`withTeamPerm`) | lib/teamPerms.ts | 캐시 적중 — 조회 0 |
| 12 | `quotes` | hooks/dashboard/useDashboardCards.ts:63 | 본인 전체(기간 무관) |
| 13 | `sales_targets` | hooks/dashboard/useDashboardCards.ts:96 | |
| 14 | `sales_opportunities` | hooks/dashboard/useDashboardCards.ts:103 | |
| 15 | `notifications` | hooks/dashboard/useDashboardCards.ts:110 | **5와 중복 테이블** |
| 16 | `GET /api/approval?box=inbox` | hooks/dashboard/useDashboardCards.ts:119 | **6과 완전 중복** |
| 17 | `service_engineers` | app/dashboard/page.tsx:106 | |
| 18 | `service_history` | app/dashboard/page.tsx:116 | 17 이 끝나야 시작(직렬) |
| 19 | `sales_activities` | app/dashboard/page.tsx:122 | 18 과 동시 |

**합계 17 (브라우저) + API 라우트 2 (각자 서버에서 4~5 조회).**
dev 의 Strict Mode 이중 실행을 얹으면 ~30 — 관찰값과 맞는다.

`customers` 는 **/dashboard 초기 경로에 없다.** 「내 견적」 모달을 열면
components/dashboard/MyQuotesPanel.tsx:233·266 에서 두 번 읽는다 — 관찰된 customers 2회는
그때 찍힌 것으로 본다(추측).

---

## a. 세션·본인 확인을 부르는 곳 (클라이언트 경로 전부)

| 파일:줄 | 그 뒤 engineers 조회 |
|---|---|
| components/layout/Sidebar.tsx:256 | :260 (`engineer_id, name, position, teams, permission_level, can_switch_division`) |
| hooks/usePageGuard.ts:58 | :65 |
| app/dashboard/page.tsx:67 | :70 |
| app/account/page.tsx:59 | :64 |
| app/activity/page.tsx:103 | :106 |
| app/admin/page.tsx:245 | :250 |
| app/inquiries/page.tsx:962 | :968 |
| app/inquiries/[id]/page.tsx:746 | :754 |
| app/inventory/page.tsx:176 | :190 |
| app/purchase/page.tsx:115 | :117 (`select('*')`) |
| app/quote/page.tsx:401 | :403 (`select('*')`) |
| app/sales/page.tsx:1323 | :1333 (`select('*')`) |
| hooks/customer/useCustomerDetail.ts:138 | — |
| hooks/holding/useHoldingList.ts:35 | :37 |
| hooks/pipeline/usePipelineData.ts:54 | — |
| components/common/NoticePopup.tsx:44 (`getClaims`) | — |

같은 화면에서 **두 벌이 겹치는 조합**: 사이드바 + 그 화면(모든 로그인 화면),
사이드바 + `usePageGuard`(가드를 쓰는 화면), 사이드바 + 훅(고객사 상세·보유장비·포캐스트).

서버 쪽(바꾸지 않는다): app/api/** 각 라우트의 `loadCaller()`, lib/approval/*,
lib/semiContactServer.ts:38, lib/teamPermsServer.ts.

## b. 참조 데이터 전체 목록을 읽는 곳

**engineers 전체** (열 구성만 다르다 — `*` / `*, email` / `engineer_id, name, position, …`):
app/account/page.tsx:96,140 · app/activity/page.tsx:106 · app/admin/page.tsx:306,353,937 ·
app/approval/page.tsx:411 · app/inquiries/page.tsx:961 · app/inquiries/[id]/page.tsx:747 ·
app/inventory/page.tsx:190 · app/leads/page.tsx:274 · app/purchase/page.tsx:126 ·
app/sales/page.tsx:1331 · components/approval/DelegationModal.tsx:157 ·
components/approval/LinePickerModal.tsx:103 · components/quote/AssigneePicker.tsx:48 ·
components/showroom/showroomData.ts:82 · hooks/customer/useCustomerDetail.ts:96 ·
hooks/pipeline/usePipelineData.ts:35

같은 화면에서 두 번 이상: **/sales**(:1331 목록 + :1333 본인 `*`), **/purchase**(:117 본인 `*` + :126 목록),
**/inquiries**(:961 목록 + :968 본인), **/admin**(:250 본인 + :306 목록, 저장 후 :353 다시).

**teams / team_permissions**: lib/teamPerms.ts:34-35 (모듈 캐시 — 이미 1회).
관리 화면만 따로 읽는다(app/admin/page.tsx:678 — 편집용이라 최신값이 필요).

**quote_categories**: lib/quoteCategories.ts 하나뿐. 모듈 캐시 + 훅 — **이미 원하는 모습이다**(틀로 쓴다).

**customers 전체**: app/leads/page.tsx:275 (`customer_id, company_name, address`),
app/purchase/page.tsx:125 · app/sales/page.tsx:1334 (`customer_id, company_name`).
1,627건이라 캐시하지 않는다(1단계 지시).

## c. 직렬 await 가 긴 초기 로드 (상위 5)

| 화면/훅 | 사슬 |
|---|---|
| components/layout/Sidebar.tsx:254-277 | `getUser` → `engineers` → `loadTeamPerms` → (배지 `/api/approval`) |
| app/dashboard/page.tsx:66-85, 102-144 | `getUser` → `engineers` → `withTeamPerm` ‖ 그 뒤 `service_engineers` → `service_history`+`sales_activities` |
| hooks/usePageGuard.ts:56-75 | `getUser` → `engineers` → `loadTeamPerms` (그 뒤에야 화면이 자기 자료를 읽기 시작) |
| hooks/customer/useCustomerDetail.ts:51-96,138 | `customers` → `customers`(부모) → … → `getUser` |
| app/quote/page.tsx:401-403 · app/inventory/page.tsx:176-190 | `getUser` → `engineers` → 화면 자료 |

공통 사슬은 전부 같다: **본인 확인 3단계 → 화면 자료.** 1단계가 이 사슬을 지운다.

## d. 무거운 라이브러리

| 라이브러리 | 상태 |
|---|---|
| `xlsx` | **전부 동적** ✓ (app/inventory:356 · app/repair:290 · priceListImport:82 · lib/forecastExcel:66) |
| `exceljs` | **동적** ✓ (components/quote/QuoteExcelButton.tsx:35) — 단 `lib/quoteExcel.ts:10` 이 타입만 정적 import(런타임 비용 없음) |
| 카카오맵 SDK | **동적 script 삽입** ✓ (lib/loadKakaoMap.ts:46) |
| `@react-pdf/renderer` | **정적 import 가 남아 있다** — app/customer/[id]/page.tsx:5(`Font` 등록만 하는데 번들 전체가 따라온다) · hooks/customer/useServiceCrud.tsx:10 · hooks/quote/useQuoteSubmit.tsx:18 · components/quote/QuotePreviewPane.tsx:15. 즉 **/quote 와 /customer/[id] 첫 번들에 PDF 엔진이 들어간다.** app/leads/page.tsx:556 은 이미 동적 ✓ |
| 차트 | 외부 라이브러리 없음 ✓ (SVG 직접 — components/sales/EngineerChartModal.tsx) |

/dashboard 첫 번들에는 PDF·엑셀·지도가 **없다**(MyQuotesPanel 은 `lib/openQuotePdf.tsx` 를 쓰고, 그것은
`/api/quote-pdf` 로 돌린다 — 번들에 렌더러가 없다).

---

## 곁다리로 발견한 것 (이 단계에서 고치지 않는다)

- `components/common/SessionManager.tsx:53` — 자동 로그아웃 안내가 `alert()` 다.
  규칙(「alert()/confirm() 금지」)에 어긋난다.
- 클라이언트 경로의 `select('*')` 33곳. 큰 표만 추려도 `quotes`(5곳)·`price_list`(2곳)·
  `customers`(1곳)·`notifications`(1곳)이다 — 2단계 규칙(docs/perf-rules.md)에 따라 화면별로 줄인다.
