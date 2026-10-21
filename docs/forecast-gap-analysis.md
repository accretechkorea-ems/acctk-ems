# 포캐스트 도입 조사 — EMS 에 무엇이 부족한가

작성 2026-10-21 · **코드·DB 변경 없음**(읽기 전용 조회만 했다)
대상 엑셀: `C:/Users/admin/quote-ref/2026년 계측수주매출 계획_주간회의용_완결판의 복사본.xlsx`
(마지막 수정 2026-10-21 16:15. **`forecast.xlsx` 라는 파일은 그 폴더에 없다** — 이 파일을 그것으로 보았다.)

> 이 문서에 고객사명·End User·모델명·금액·사람 이름은 옮기지 않았다. 건수와 분포만 적는다.

---

## 0. 요약 — 지금 없는 것 (10줄)

1. **안건(포캐스트 줄)이라는 그릇이 없다.** `sales_opportunities` 는 22건뿐이고 칸반용 6칸(상담~실주)만 있다. 엑셀의 Status 8종(목표금액·포캐스트·포캐스트(40)·포캐스트(80)·수주확정·지연·실주·구매취소)은 **EMS 코드 어디에도 없다.**
2. **월이 하나뿐이다.** 엑셀은 Initial / Current / Confirmed 3개 월을 들고 있는데 EMS 는 `expected_close` 하나다(다행히 저장 모양은 같다 — 월 입력 → 그 달 말일).
3. **지연·변경 횟수를 세지 않는다.** Change Count·Changed Status·Delay Month 에 해당하는 값이 없다. 단 `audit_log` 에 영업기회 UPDATE 33건이 쌓여 있고 그중 `expected_close` 변경 5건이 실제로 잡힌다 — **원재료는 이미 있다.**
4. **목표의 단위가 다르다.** `sales_targets` 는 담당자 × **연** × {매출목표, 수주목표} 2개 값이다(23건, 전부 quarter=null). 엑셀 목표금액 줄은 담당자 × **월** × **Detailed Division** (296+75줄)이다.
5. **견적과 영업기회가 실제로 연결돼 있지 않다.** `quotes.opportunity_id` 는 컬럼·FK 모두 있는데 **채워진 행이 0/96** 이다.
6. **담당자 영문명이 없다.** 엑셀 NAME(15+4명)은 영문 대문자다. `engineers` 에 영문 이름 컬럼이 없다(이니셜은 41/41 있다).
7. **팀 체계가 다르다.** 엑셀 TEAM 은 1·2·3팀(80)·4팀(20)인데, `teams` 10행에는 그런 이름이 없다(임원·영업관리·80영업·80CS·Apps.·20영업·20수리·반도체 3팀).
8. **S.C(Sales / C/S)** 를 담은 컬럼이 없다. 팀 이름(80영업/80CS/20영업/20수리)에서 끌어낼 수는 있으나 규칙이 정해져 있지 않다.
9. **분류가 하나 모자라고(ZEISS) 숫자 코드가 없다.** `quote_categories` 8종은 Detailed Division 과 7종이 일치하지만 ZEISS 가 없다. D.Code·Division 숫자(80/81/83/84/20/11…)는 **고객 단위로만** 있다(`customers.division`·`customers.category`).
10. **M/P/L·Q'ty·Model 을 안건 단위로 적을 곳이 없다.** 견적 줄(`quote_items`)에는 있지만, 견적 없는 안건이 대부분이라(지금 영업기회 22건 중 견적 연결 0건) 안건 자체에 들어갈 칸이 필요하다.

---

## A. EMS 의 현재 상태 (실측)

조회 방법: `.env.local` 의 service role 키로 **읽기 전용** 조회(select / count). `information_schema` 는 PostgREST 가 `public` 스키마만 노출하므로 접근할 수 없어, **각 표의 한 행을 읽어 컬럼 이름**을 얻고 제약은 저장소의 `.sql` 파일·코드 상수에서 읽었다.

### A-1. 표와 컬럼 (2026-10-21 기준 건수)

| 표 | 건수 | 컬럼 |
|---|---:|---|
| `sales_opportunities` | 22 | opportunity_id, customer_id, engineer_id, title, stage, expected_amount, expected_close, lost_reason, lost_note, closed_at, created_at, updated_at |
| `sales_activities` | 5 | activity_id, opportunity_id, customer_id, engineer_id, contact_id, activity_date, activity_type, content, created_at, updated_at |
| `quotes` | 96 | quote_id, quote_number, customer_id, engineer_id, quote_date, total_supply, total_tax, total_amount, status, order_date, revenue_date, fail_reason, recipient, subject, note, created_at, total_cost, total_profit, profit_rate, pdf_url, dealer_id, delivery_info, purchase_order_url, purchase_order_at, shipping_date, order_memo, order_completed_at, tax_invoice_date, tax_invoice_requested_at, tax_invoice_completed_at, delivery_method, order_completed_by, tax_completed_by, quote_type, **opportunity_id**, delete_reason, created_by, order_request_memo, terms, category, form_kind |
| `quote_items` | 184 | item_id, quote_id, price_list_id, product_name, quantity, unit_price_jpy, unit_price_krw, supply_amount, tax_amount, category, cost_amount, profit_amount, profit_rate, exchange_rate, tariff_rate, part_code, row_kind, sub_lines, group_kind, **model_name** |
| `quote_categories` | 8 | code, label, sort_order, is_active, created_at |
| `engineers` | 41 | engineer_id, name, position, email, profile_image_url, initials, teams, permission_level, allowed_categories, resigned_date, office, tel, team_id, can_switch_division |
| `teams` | 10 | id, name, is_special, display_order, can_view_*(7개 권한), division |
| `customers` | 1,627 | customer_id, status, company_name, region1, region2, address, agency, category, latitude, longitude, created_at, total_revenue, deleted_at, division, parent_customer_id, is_parent |
| `leads` | 19 | 40개 컬럼(리드 전환용. converted_opportunity_id 포함) |
| `sales_targets` | 23 | target_id, engineer_id, year, quarter, target_amount, order_target_amount, created_at |
| `audit_log` | 8,513 | id, occurred_at, actor_uid, actor_email, action, table_name, row_id, old_data, new_data |

없는 표(확인함): `opportunity_stages`, `forecast`, `targets`, `opportunity_history`, `quote_status_history`.

> **덤으로 확인된 것**: `quote_items.model_name` 컬럼이 **이미 DB 에 있다**(채워진 행은 0). 즉 `quote_items_model_schema.sql` 단계 1 은 적용돼 있다. 단계 2(create_quote 의 칸 목록)가 적용됐는지는 함수 본문을 읽을 길이 없어 **미확인**이다.

### A-2. 값 분포 (코드값만)

| 자리 | 값 |
|---|---|
| `sales_opportunities.stage` | 상담 11 · 견적제출 4 · 협상 3 · 수주 2 · 사양검토 2 (CHECK 값은 `components/customer/opportunity.ts` 의 `STAGES` = 상담·사양검토·견적제출·협상·수주·실주) |
| `quotes.status` | 견적중 48 · 주문완료 21 · 실패 12 · 매출완료 9 · 발주(주문 대기) 6 |
| `quotes.form_kind` | null 94 · parts80 2 (양식은 막 도입됐다) |
| `quotes.category` | null 85 · MEASURING_SERVICE 4 · SURFACE 3 · CMM 2 · SBS 1 · ROUNDNESS 1 |
| `quote_categories` | BCT·CMM·KOLAS·MEASURING_SERVICE(Measuring Service)·ROUNDNESS·SBS·SURFACE·TSE (전부 활성) |
| `customers.division` | 80 = 1,367 · null = 260 |
| `customers.category` | 83 = 821 · null = 338 · 84 = 260 · 81 = 202 · 공백 6 |
| `teams` | 임원 / 영업관리 / 80CS / 80영업 / Apps. / 20수리 / 20영업 (division=계측) · SEC / SK Hynix / OSAT (division=반도체) |
| `engineers` | 재직 36/41 · initials 41/41 · team_id 있음 28/41 · `teams` 는 **문자열** 한 개(예: 영업관리) · 직급 7종 |
| `engineers.team_id` 분포 | 80CS 9 · 80영업 5 · 영업관리 4 · 20영업 4 · Apps. 3 · 임원 2 · 20수리 1 · 미지정 13 |
| `sales_targets` | year 전부 2026 · quarter 전부 null · 23명 |

### A-3. 연결·자동화

- `quotes.opportunity_id` : **채워진 행 0/96.** 견적 작성 화면에 영업기회 선택칸이 있고(`hooks/quote/useQuoteCustomer.ts:84`, `components/quote/CustomerCard.tsx`) 저장도 하지만(`useQuoteSubmit.tsx:420`), 실제로 고른 적이 없다.
- 한 기회에 견적 2건 이상인 경우 : 0건(연결 자체가 0이라 판단 불가).
- **자동 종료** : 매출 처리(세금계산서 완료)가 끝나면 연결된 기회에 `closed_at` 을 찍는다(`app/api/purchase-order/route.ts:256`). 단계(stage)는 건드리지 않는다.
- **리드 전환** : 리드를 전환하면 `sales_opportunities` 를 insert 하고 `leads.converted_opportunity_id` 를 채운다(`app/api/lead-manage/route.ts:394`). 그때 `expected_close` 는 `monthToDate()`(월 → 말일)로 넣는다.
- `quotes.order_date` · `revenue_date` 는 **코드가 쓰지 않는다**(`app/sales/page.tsx:64` 주석). 수주·매출 시점은 `purchase_order_at` · `tax_invoice_completed_at` 이 정본이다(채움: 36 / 9).

### A-4. 화면 — 지금 무엇을 보여 주는가

**① 파이프라인은 `/pipeline` 이다**(의뢰 글의 「/sales 의 파이프라인」은 실제로 다른 화면이다).
`app/pipeline/page.tsx`(384줄) + `hooks/pipeline/usePipelineData.ts`(80줄). 칸반 5칸(상담·사양검토·견적제출·협상·수주. 실주는 보드에서 빼고 아래 「종료」로)에 영업기회 카드를 놓고 **드래그로 stage 를 바꾼다**. 칸 머리에 건수와 `expected_amount` 합을 보여 준다. 끌어오는 데이터는 영업기회 전체 + 기회에 묶인 활동 + 엔지니어 + 고객 목록이고, 기회에 `quotes(...)` 를 조인해 연결 견적을 함께 읽는다.

**② `/sales` 는 실적 현황이다**(`app/sales/page.tsx`, 1,853줄).
- 상단 **통합 실적 차트**(`PerformanceChart`, 231줄~): 분기별/월별/연도별 **막대 1개 + 목표선 1개**.
  - 막대 = 매출액. `scopedQuotes.filter(q => q.status === '매출완료' && q.tax_invoice_completed_at)` 의 `total_supply` 합(250·270줄). 기간은 `tax_invoice_completed_at` 을 **한국 날짜**로 읽어 회계연도(4월 시작)·분기로 나눈다(133~146줄).
  - 목표선 = `sales_targets` 중 `year === fy && quarter === null` 인 행들의 `target_amount` 합을 **분기면 ÷4, 월이면 ÷12**(272·287줄).
  - 막대 위에 이익률(`total_profit / total_supply`)과 달성률을 적는다.
- 그 아래 **견적 표**(번호·견적일·대리점·금액·상태 …)와 엔지니어별 실적, 개인 월별 차트 모달(`EngineerChartModal`, 377줄~).
- **엑셀의 Status 8계열 막대에 해당하는 것은 없다.** `포캐스트`·`수주확정`·`목표금액` 이라는 글자는 저장소 코드 전체에 **한 번도 나오지 않는다**(grep 결과 0건).

**③ 목표 입력은 `/admin`** (`app/admin/page.tsx:303 fetchTargetData`, 341·343줄 저장).
`sales_targets` 를 `year` + `quarter is null` 로 읽고, **담당자 한 명당 한 행**에 매출목표·수주목표 두 금액을 넣는다. 월·분류·팀 단위 입력은 없다(화면이 ÷12 로 월 목표를 만들어 보여 줄 뿐이다, 1291줄).

---

## B. 엑셀 27열 ↔ EMS 매핑

엑셀 실측(재확인): `tbl_80` **데이터 556줄**(머리글 제외, 범위 A1:AA789) · `tbl_20` **186줄**(A1:AA458). 열은 27개로 같다.
의뢰 글의 528 / 182 는 **Initial Plan Month 가 채워진 줄 수**와 정확히 일치한다(528 / 182) — 빈 줄이 각각 28 / 4 줄 섞여 있다.
머리글에 앞뒤 공백이 섞여 있다(`' T/Amount '`, `' R/Amount '`) — 그대로 읽으면 열 이름이 어긋난다.

| # | 엑셀 열 | EMS 에 있는가 | 표.컬럼 | 값 체계가 같은가 | 없으면 필요한 것 |
|---:|---|---|---|---|---|
| 1 | Initial Plan Month | ✗ | — | — | **컬럼 추가**(안건.initial_month). 최초 예상월을 처음 저장할 때 한 번 박고 그 뒤 바꾸지 않는다 |
| 2 | Current Forecast Month | △ | `sales_opportunities.expected_close` | **같다.** 둘 다 「그 달 말일」(엑셀 2026-05-31, EMS `monthToDate()`) | 이름만 다르다. 그대로 쓸 수 있다 |
| 3 | Confirmed Order Month | △ | `quotes.purchase_order_at`(36건) 또는 `quotes.order_date`(0건, 미사용) | 엑셀은 **실제 일자**(2026-06-24), EMS 는 timestamptz | 안건↔견적 연결이 있어야 끌어온다. 연결 없는 안건은 **직접 입력 칸** 필요 |
| 4 | Status | ✗ | — | 엑셀 8값, EMS 는 stage 6값(상담~실주)으로 **뜻이 다르다** | **컬럼 추가 + 값 정의.** 아래 D 참조 |
| 5 | 진행사항 | △ | `sales_activities.content`(5건) | 엑셀은 한 칸에 이력+메모 누적(최대 3,656자) | 「월 이동 이력 자동 + 메모」로 나누는 설계 필요 |
| 6 | 고객사 | ○ | `customers.company_name` (+ `quotes.dealer_id`) | 엑셀 고객사/End User 가 **대리점/실사용자** 구분이면 EMS 의 dealer/customer 와 같은 축 | 안건에 고객 FK 는 이미 있다(`sales_opportunities.customer_id`) |
| 7 | End User | ○ | `customers`(`parent_customer_id`·`is_parent` 로 사업장/본사 구분, 776건 연결) | 미확인(엑셀 쪽 정의) | **F-3** 에서 확인 필요 |
| 8 | TEAM | △ | `teams.name` / `engineers.team_id` | **다르다.** 1~4팀 ↔ 80영업·80CS·20영업·20수리 | 대응표가 필요(컬럼 추가 없이 매핑 상수로 가능) |
| 9 | D.Code | △ | `customers.division`(80/null) | 값은 같은 계열(80·10·30·10(etc)) | 분류표에 코드 컬럼을 붙이는 쪽이 낫다(아래 11번과 함께) |
| 10 | Division | △ | `customers.category`(81/83/84) | 값 자체는 같다(81·83·84·…) | **고객 단위로만** 있다. 안건 단위로 필요하면 분류표에 숫자코드 컬럼 추가 |
| 11 | Detailed Division | ○(7/8) | `quote_categories.label` | Surface·Roundness·CMM·KOLAS·BCT·Measuring Service·TSE·SBS 일치 / **ZEISS 없음**(엑셀 6건) | `quote_categories` 에 ZEISS 1행 추가 + (선택) `d_code`·`division_code` 컬럼 |
| 12 | S.C | ✗ | — | Sales / C/S | 팀에서 파생 가능(80영업·20영업→Sales, 80CS·20수리→C/S) 또는 `teams` 에 컬럼 추가 |
| 13 | NAME | △ | `engineers.name`(한글) · `initials`(41/41) | **영문 대문자 이름이 없다** | `engineers.name_en` 추가 또는 보고서에서 한글로 낸다 |
| 14 | M/P/L | ✗ | (견적 줄에서 추론 가능) | M/C·Parts·Labor ↔ `quote_items.row_kind`(price_list/manual_jpy/domestic/**service**/discount)·`group_kind`(base/option/include) | Labor = 서비스비 줄(`row_kind='service'`). 견적 없는 안건에는 **안건 컬럼**이 필요 |
| 15 | Distributor/Direct Sales | ○ | `quotes.dealer_id` 유무(25/96) | 같다(대리점 있음=Distributor) | 견적 없는 안건용으로 안건 컬럼 필요 |
| 16 | Model | △ | `quote_items.product_name`·`model_name`·`price_list.model_jp` | 엑셀은 한 줄에 모델 하나(최대 49자) | 안건 컬럼 필요(견적 없는 안건) |
| 17 | Q'ty | △ | `quote_items.quantity` | 같다 | 위와 같음 |
| 18 | T/Amount | ○ | `sales_opportunities.expected_amount`(22/22) · `quotes.total_supply` | 같다(원화 공급가로 보인다 — **미확인**) | 안건 금액이 이미 있다 |
| 19 | R/Amount | ✗ | — | **엑셀에서도 거의 비어 있다**(80: 0건, 20: 2건) | 재현 대상에서 빼도 된다 |
| 20 | Delay Month | 파생 | — | 수식 | `months_between(initial_month, coalesce(confirmed_month, current_month))` |
| 21 | Forecast Gap | 파생 | — | **엑셀에서 서로 다른 값이 1개뿐**(전부 0) — 사실상 미사용 | `months_between(current_month, confirmed_month)` |
| 22 | Data Check | 파생 | — | 값: OK / Forecast 미입력 / Initial>Forecast 오류 / Initial>Confirmed 오류 | 날짜 순서 검증식. 화면 경고로 대체 가능 |
| 23 | Risk Level | ✗ | — | 수식이 깨져 있다(값은 Check / 빈칸뿐) | **재현 대상 아님**(의뢰 글과 같은 결론) |
| 24 | Change Count | ✗ | — | 밀린 횟수(80: 99건 채움, 20: 26건) | **컬럼 추가**(안건.change_count) 또는 이력표 집계 |
| 25 | Delay Reason | ✗ | — | **엑셀에서 0건** | 열만 있고 쓰지 않는다 |
| 26 | Remark | ✗ | — | **엑셀에서 0건** | 열만 있고 쓰지 않는다 |
| 27 | Changed Status | ✗ | — | 지연(80:18) / 지연 후 포캐스트(80:75, 20:22) | 파생 가능: 이번 달 기준 `current_month` 이동 여부로 계산 |

### B-1. 값 분포 실측 (엑셀)

| 열 | tbl_80 (556줄) | tbl_20 (186줄) |
|---|---|---|
| Status | 목표금액 296 · 수주확정 97 · 포캐스트 56 · 빈칸 28 · 구매취소 27 · 포캐스트(40) 26 · 지연 18 · 실주 6 · 포캐스트(80) 2 | 수주확정 83 · 목표금액 75 · 포캐스트(40) 9 · 포캐스트 6 · 포캐스트(80) 5 · 구매취소 4 · 빈칸 4 |
| TEAM | 1팀 201 · 2팀 173 · 3팀 154 · 빈칸 28 | 4팀 167 · 빈칸 19 |
| S.C | C/S 320 · Sales 208 | Sales 122 · C/S 45 |
| D.Code | 80 491 · 10 13 · 30 12 · 10(etc) 11 · **Sales 1(오입력)** | 20 145 · 10(etc) 22 |
| Division | 83 221 · 84 140 · 81 129 · 13 14 · 30 12 · 12 9 · 14 2 · **사람 이름 1(오입력)** | 20 145 · 11 22 |
| Detailed Division | Surface 229 · Roundness 132 · CMM 129 · KOLAS 20 · BCT 9 · **ZEISS 6** · Measuring Service 2 | TSE 145 · SBS 22 |
| M/P/L | 빈칸 325 · Parts 102 · M/C 81 · Labor 47 · **'.' 1(오입력)** | **전부 빈칸** |
| Distributor/Direct | Direct Sales 178 · Distributor 54 · 빈칸 324 | Direct Sales 86 · Distributor 21 · 빈칸 79 |
| Changed Status | 빈칸 463 · 지연 후 포캐스트 75 · 지연 18 | 빈칸 164 · 지연 후 포캐스트 22 |
| NAME | 서로 다른 값 15 | 서로 다른 값 4 |
| 진행사항 | 채움 211 · 최대 3,656자 | 채움 89 · 최대 36자 |

> 사람이 손으로 넣는 표라 **열이 섞인 오입력이 3건** 있다(D.Code 에 'Sales', Division 에 사람 이름, M/P/L 에 '.'). 시스템으로 옮기면 선택칸으로 막힌다.

---

## C. 보고서별 재현 가능성

피벗 11개·캐시 3개(`tbl_20` / `tbl_80` / 시트취합 Power Query)·차트 6개(전부 막대, 80 쪽 8계열·20 쪽 6계열)를 패키지에서 직접 확인했다. 필드 번호는 캐시 정의 순서(0=Initial Plan Month … 3=Status … 17=T/Amount … 23=Change Count … 26=Changed Status)다.

| 보고서 | 피벗 정의(실측) | 지금 되는가 | 무엇이 채워지면 되는가 | 집계 초안 |
|---|---|---|---|---|
| ① 수정계획 | 행 TEAM>NAME, 열 Status, 값 Σ T/Amount (pivotTable2) + 행 End User 열 Status (1·3·5) | ✗ | B-4(Status)·B-8(TEAM)·B-13(NAME) | `select team, name, status, sum(amount) from 안건 where 월필터 group by 1,2,3` |
| ② 장비별 | 행 Detailed Division, 열 Status, 값 Σ T/Amount (pivotTable4) | ✗ | B-4 + ZEISS 추가 | `… group by detailed_division, status` |
| ③ 시트취합 | 행 S.C>TEAM>NAME, 열 Status (pivotTable6, 80+20 합친 캐시) | ✗ | B-4·B-8·B-12·B-13 | 80/20 을 한 표에 두면 Power Query 자리가 통째로 없어진다 |
| ④ 당월 지연및취소 | 페이지필터 **Current Forecast Month**, 행 S.C>Status>NAME>End User>Model>진행사항, 값 Σ T/Amount·Σ Change Count (pivotTable7/10/11) | ✗ | B-4·B-16·B-24 + 진행사항 | `… where current_month = :월 and status in ('지연','실주','구매취소')` |
| ⑤ 지연 횟수 | 페이지필터 **Changed Status**, 행 TEAM>NAME>End User>Model, 값 Σ Change Count (pivotTable8/9) | ✗ | B-24·B-27 | 이력표 집계로 대체 가능(아래 D) |
| ⑥ 회신리스트 | 피벗 아님. 담당자 × 주차 마감(「5/12 15시까지」 식) × O(기한내)/△(기한초과) 수기표 | ✗ | **EMS 에 주간 제출 개념 자체가 없다** | 별도 기능(주차 마감·제출 기록) |

**슬라이서 7종**(캐시 15개 실측: TEAM×3 · NAME.1×2 · Detailed Division×1 · M/P/L×3 · Distributor/Direct Sales×3 · Initial Plan Month×1 · Current Forecast Month×1 · Confirmed Order Month×1)은 전부 **열 하나로 거르는 필터**다. B 의 해당 열이 안건 컬럼으로 생기면 화면 필터로 그대로 옮길 수 있다. 지금 당장 가능한 것은 Detailed Division(분류) 하나뿐이다.

---

## D. 안건의 생애주기 — 설계에 필요한 사실

**D-1. `sales_opportunities` 를 그대로 포캐스트 줄로 쓸 수 있는가**
뼈대는 맞다 — 고객·담당자·제목·금액·예상월·종료 시각이 이미 있고, `expected_close` 의 저장 모양(월 → 말일)이 엑셀과 **같다**.
부족한 칸: `initial_month` · `status`(8값) · `confidence`(100/80/40) · `model` · `qty` · `mpl` · `distributor_or_direct` · `detailed_division`(분류 FK) · `change_count` · `changed_status` · `confirmed_month`.
단계(stage 6값)와 Status(8값)는 **축이 다르다** — stage 는 영업 진행 단계, Status 는 「이 금액이 어떤 성격인가(목표/예상/확정/지연/실패)」다. 둘을 한 컬럼에 합치면 칸반과 포캐스트 중 하나가 깨진다.

**D-2. 견적 없는 안건**
지금도 가능하다. `expected_amount` 가 안건 자체에 있고(22/22 채움), 실제로 **견적과 연결된 안건은 0건**이다. 즉 EMS 의 영업기회는 이미 「견적 없는 금액 안건」으로만 쓰이고 있다.

**D-3. 수주확정을 자동으로 끌어올 수 있는가**
연결만 되면 가능하다. 재료: `quotes.status`(발주(주문 대기) → 주문완료 → 매출완료) · `purchase_order_at`(36건) · `tax_invoice_completed_at`(9건). 이미 매출 확정 시 기회를 `closed_at` 으로 닫는 코드가 있다(`app/api/purchase-order/route.ts:256`).
**단, `quotes.opportunity_id` 가 0건이라 지금은 아무것도 자동으로 오지 않는다.** 견적 작성 때 안건을 고르도록 강제하거나(필수화), 안건에서 견적을 만들게 해야 한다.

**D-4. 월 이동 이력**
세 길이 있다.
1. **이미 있는 `audit_log`** — `sales_opportunities` 줄 50건(INSERT 17 / UPDATE 33)이 쌓여 있고, `old_data`·`new_data` 에 `expected_close` 가 들어 있어 **이동 5건이 실제로 잡힌다**(2026-09-04 ~ 10-19). 트리거로 자동 기록된다. 다만 전 테이블 공용이라 보존·조회 비용이 커지고, 「무엇을 왜 옮겼는가」(사유)는 없다.
2. **전용 이력표**(안건 월 변경만) — 사유·작성자·시점을 같이 남길 수 있고 Change Count 가 곧 `count(*)` 다.
3. 애플리케이션 기록(코드에서 insert) — 트리거보다 빠지기 쉽다.
「4월→5월→6월」 문자열은 2·3번이면 **자동 생성 가능**하다(이력 월을 순서대로 이어 붙인다). 1번만으로도 만들 수 있으나 audit_log 를 업무 조회에 쓰게 되는 부담이 있다.

**D-5. 목표금액을 같은 표에 둘 것인가**
- **같은 표(Status='목표금액' 줄)** — 엑셀과 모양이 같아 피벗 하나로 목표·예상·확정을 한 번에 집계한다(①③ 보고서가 그렇게 생겼다). 대신 목표 줄에는 고객·모델이 없어 같은 표의 다른 칸이 늘 비고, 「안건 수」를 세면 목표 줄이 섞인다.
- **별도 표(지금 `sales_targets` 확장)** — 의미가 깨끗하고 권한 분리가 쉽다(목표는 관리자, 안건은 담당자). 대신 집계할 때마다 union 이 필요하고, 엑셀의 「Status 열에 목표금액이 같이 서는」 그림을 만들려면 화면에서 합쳐야 한다.
- 지금 EMS 구조로는 **별도 표가 유리하다** — 목표 입력 화면(`/admin`)이 이미 따로 있고 권한도 거기 붙어 있다. 단 단위를 담당자×연 → **담당자×월×분류**로 늘려야 한다(23행 → 월 12 × 분류 8 × 담당자 ≈ 2,000행 규모).

---

## E. 지금 파이프라인 코드의 의존 관계

`sales_opportunities` / `opportunity_id` 를 참조하는 파일 **23개**(grep 전수).

| 파일 | 하는 일 | 칸반을 포캐스트로 바꿀 때 |
|---|---|---|
| `app/pipeline/page.tsx` | 칸반 보드(드래그로 stage 이동) | **바뀌는 본체** |
| `hooks/pipeline/usePipelineData.ts` | 기회·활동·엔지니어·고객 조회 | 조회 컬럼이 늘어난다 |
| `components/customer/opportunity.ts` | STAGES·CLOSED_STAGES·`monthToDate`·`compactKRW` | Status 축이 생기면 여기 상수와 나란히 둔다 |
| `components/customer/modals/OpportunityModal.tsx` | 기회 등록·수정 모달 | **입력 칸이 늘어난다**(B 의 추가 컬럼) |
| `hooks/customer/useOpportunityCrud.ts` | 기회 CRUD | 저장 필드 추가 |
| `components/customer/SummaryPanel.tsx` · `ActivityTimeline.tsx` | 고객 상세의 기회 요약·활동 타임라인 | 표시값 추가(Status) |
| `hooks/customer/useCustomerDetail.ts` · `useSalesActivityCrud.ts` · `components/customer/modals/SalesActivityModal.tsx` | 고객 상세 조회·활동 | 영향 적음 |
| `components/customer/types.ts` | `SalesOpportunity` 타입 | **컬럼 추가 시 같이** |
| `app/dashboard/80/page.tsx` · `hooks/dashboard/useDashboard80.ts` | 대시보드 위젯(기회 집계) | 집계 기준이 Status 로 바뀌면 같이 |
| `app/leads/page.tsx` · `app/api/lead-manage/route.ts` · `app/api/lead-delete/route.ts` | 리드 → 기회 전환·삭제 | 전환 시 새 필수 컬럼(초기월·Status) 기본값 필요 |
| `app/quote/page.tsx` · `hooks/quote/useQuoteCustomer.ts` · `components/quote/CustomerCard.tsx` · `hooks/quote/useQuoteSubmit.tsx` · `hooks/quote/useQuotePrefill.ts` | 견적 작성의 영업기회 선택·저장 | **연결을 살리는 자리**(D-3) |
| `app/api/purchase-order/route.ts` | 매출 확정 시 기회 자동 종료 | 수주확정 자동화의 자리 |
| `app/api/quote-duplicate/route.ts` | 다시쓰기 시 기회 승계 | 영향 적음 |
| `app/customer/[id]/page.tsx` | 고객 상세 화면 | 표시값 추가 |

메뉴·권한: `teams.can_view_pipeline` 컬럼이 팀별 권한으로 이미 있다(이름이 바뀌면 같이 볼 것).

---

## F. Kevin 이 답해야 할 것

1. **TEAM 1~4팀은 EMS 의 어느 팀인가?** (`teams`: 80영업·80CS·20영업·20수리·Apps.·영업관리·임원) 1·2·3팀이 80 쪽 세 팀이라면 어느 팀이 몇 번인가. 팀 이름을 바꿀 것인가, 대응표만 둘 것인가.
2. **S.C(Sales / C/S)는 무엇으로 정하는가?** 담당자가 속한 팀으로 자동 판정해도 되는가(80영업·20영업=Sales / 80CS·20수리=C/S). 한 사람이 두 역할을 겸하는 경우가 있는가.
3. **「고객사」와 「End User」의 차이**는 EMS 의 무엇과 같은가? 대리점(`quotes.dealer_id`)/고객사인가, 아니면 모회사(`customers.parent_customer_id`)/사업장인가.
4. **ZEISS 를 분류(`quote_categories`)에 넣어도 되는가?** 넣으면 견적 분류 선택칸에도 같이 나온다(지금 8종 → 9종).
5. **D.Code·Division 숫자코드(80/10/30, 81/83/84/11/12/13/14/20/30)** 를 EMS 가 들고 있어야 하는가? 분류표에 코드 컬럼으로 붙이면 되는가, 아니면 보고서에서만 쓰는가. (지금은 `customers` 에만 있다.)
6. **Status 8값의 정의를 확정해 달라.** 특히 포캐스트(40)/포캐스트(80)/포캐스트의 차이(확률인가 단계인가), 「지연」과 「구매취소」·「실주」의 경계.
7. **목표금액 줄을 안건과 같은 표에 둘 것인가, 목표 표를 따로 둘 것인가**(D-5). 그리고 목표 단위를 담당자×월×Detailed Division 으로 확정하는가.
8. **수주확정을 견적에서 자동으로 가져올 것인가?** 그러려면 견적 작성 때 안건 선택을 **필수**로 만들어야 한다(지금 0/96 연결). 견적 없이 수주로 찍는 길도 남길 것인가.
9. **담당자 영문명을 EMS 에 넣을 것인가**(엑셀 NAME). 아니면 보고서를 한글 이름으로 낼 것인가.
10. **진행사항**: 월 이동 이력은 자동 생성하고 메모만 사람이 적는 구조로 바꿔도 되는가(지금은 한 칸에 섞여 있고 최대 3,656자).
11. **M/P/L·Q'ty·Model 을 견적 없는 안건에도 적는가?** 적는다면 안건 입력 화면에 칸을 만든다.
12. **「회신리스트」(주간 제출 O/△)를 EMS 가 대신할 것인가?** 그렇다면 주차 마감 시각·제출 판정 규칙이 필요하다.
13. **R/Amount·Delay Reason·Remark 는 버려도 되는가?** 엑셀에서도 사실상 비어 있다(각 0건, 0건, 2건).
14. **Risk Level** 은 수식이 깨진 상태 그대로다. 되살릴 규칙이 있는가, 버리는가.

---

## G. 제안 단계

1. **정의 확정** — F 의 1~8번을 먼저 답한다(여기서 컬럼 이름과 값이 정해진다).
2. **DB 1단계** — `sales_opportunities` 에 포캐스트 칸 추가(initial_month·status·confidence·detailed_division·model·qty·mpl·sales_channel·confirmed_month). SQL 파일만 쓰고 Kevin 이 실행한다.
3. **DB 2단계** — 월 이동 이력표 + 목표표 확장(담당자×월×분류). Change Count 는 이력 집계로 둔다.
4. **입력 화면** — 기회 모달을 포캐스트 안건 입력으로 넓히고, 월을 바꾸면 이력이 쌓이게 한다(진행사항 자동 줄 생성).
5. **견적 연결** — 견적 작성에서 안건 선택을 필수로 만들고, 발주 시 수주확정·확정월을 자동으로 채운다.
6. **집계** — ①~⑤ 피벗에 해당하는 집계 함수(또는 뷰)를 만든다. 슬라이서 7종은 화면 필터로.
7. **화면** — `/pipeline` 칸반을 포캐스트 표+차트로 바꾸고(또는 탭으로 둘 다), 8계열 막대를 그린다.
8. **엑셀 내보내기** — 본사 보고용으로 27열 그대로 뽑는 버튼(기존 `lib/quoteExcel.ts` 방식과 같게).
