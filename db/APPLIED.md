# SQL 적용 기록

**SQL 을 DB 에 돌렸으면 여기에 한 줄 적는다.** 적지 않으면 다음 사람이 「이게 적용됐나」를
파일 머리말만 보고 추측해야 하고, 그 머리말은 **이미 한 번 7건이 틀려 있었다**
(2026-10-23 전수 확인 — `docs/audit-2026-10.md` B1).

적는 것: **파일 · 적용일 · 적용한 사람 · 비고**(무엇으로 확인했는지).
적용일을 모르면 `미상`, 확인만 한 날은 비고에 「확인 YYYY-MM-DD」로.

SQL 파일은 지금 **저장소 루트**에 있다(`db/` 가 아니다 — 아래 「앞으로」 참고).

---

## 적용 확인된 것 — 45개

표·컬럼·함수가 **실제로 DB 에 있는지** 읽기 전용으로 확인했다(2026-10-23).
확인 방법은 PostgREST OpenAPI 문서(= 노출 스키마의 정본)와 컬럼 조회다.

| 파일 | 적용일 | 적용한 사람 | 비고(확인 2026-10-23) |
|---|---|---|---|
| `approval_schema.sql` | 2026-09-29 이전 | Kevin | 표 5개(approval_documents·lines·history·delegations·line_presets) |
| `audit_log_setup.sql` | 미상 | Kevin | 표 audit_log(8,729행) |
| `db_functions_snapshot.sql` | — | — | **스냅샷 기록** — 실행 대상 아님. has_team_perm·next_quote_seq·rls_auto_enable·mark_log_restocked 가 DB 에 있다 |
| `delivery_time_update.sql` | 미상 | Kevin | price_list.delivery_time |
| `engineer_resign_update.sql` | 미상 | Kevin | engineers.resigned_date |
| `geocode_update.sql` | 미상 | Kevin | customers.latitude·longitude (1회용 UPDATE) |
| `inquiries_cancel_function.sql` | 2026-10-02 | Kevin | 함수 cancel_inquiry |
| `inquiries_schema.sql` | 2026-10-02 | Kevin | 표 inquiries(63행)·inquiry_sequence·inquiry_attachments + 함수 2개 |
| `inquiries_search_function.sql` | **미상** | Kevin | 함수 5개(search_inquiries·count_inquiries_by_type·inquiry_search_base·inquiry_search_words·inquiry_snippet). **머리말이 「미적용」이었다 — 고쳤다** |
| `inquiry_list_extras_function.sql` | **미상** | Kevin | 함수 inquiry_list_extras. **머리말이 「미적용」이었다 — 고쳤다** |
| `inquiry_messages_schema.sql` | 2026-10-02 | Kevin | 표 inquiry_messages(87행) + inquiry_attachments.message_id |
| `leads_block_actor_schema.sql` | 2026-10-02 | Kevin | leads.blocked_by·blocked_at |
| `leads_rls_policy.sql` | 2026-09-02 | Kevin | 함수 current_engineer_id. 정책 자체는 읽지 못했다 |
| `menu_perm_function.sql` | **미상** | Kevin | 함수 has_menu_perm 호출 성공. **머리말이 「미적용」이었다 — 고쳤다** |
| `packing_lists_storage_policy.sql` | 미상 | Kevin | 버킷 packing-lists 가 비공개 |
| `price_list_import_schema.sql` | 2026-10-20 | Kevin | 표 price_list_imports(28행) + 함수 apply_price_list_import + price_list.line·variant |
| `quote_category_template_schema.sql` | **미상**(2026-10-19~) | Kevin | 표 3개 + quotes.category·form_kind + quote_items.group_kind. **머리말이 「미적용」이었다 — 고쳤다** |
| `quote_create_function.sql` | 2026-09-16 | Kevin | 함수 create_quote |
| `quote_items_model_schema.sql` | **미상**(2026-10-21~) | Kevin | quote_items.model_name. **머리말이 「미적용」이었다 — 고쳤다** |
| `quote_items_sublines_schema.sql` | 2026-10-19 | Kevin | quote_items.sub_lines. 머리말 2줄이 1줄과 모순이었다 — 고쳤다 |
| `quote_schema_snapshot.sql` | — | — | **스냅샷 기록** — 실행 대상 아님 |
| `quotes_order_memo_schema.sql` | 2026-09-22 | Kevin | quotes.order_memo·order_request_memo |
| `quotes_terms_schema.sql` | 2026-10-19 | Kevin | quotes.terms. 머리말 2줄이 1줄과 모순이었다 — 고쳤다 |
| `repairs_migration_category.sql` | 미상 | Kevin | repairs.item_type |
| `repairs_migration_excel.sql` | 미상 | Kevin | repairs.product_type·serial_number |
| `repairs_migration_status.sql` | 미상 | Kevin | repairs.repair_started_at·repair_done_at·shipped_at |
| `rls_backup_20261008.sql` | — | — | **되돌리기용 DDL 기록** — 실행 대상 아님 |
| `semi_contact_schema.sql` | **미상**(2026-10-08~) | Kevin | 표 4개(semi_projects 20행 등) + 함수 claim_semi_project_seq. **머리말이 「미적용」이었다 — 고쳤다** |
| `service_attachments_schema.sql` | 2026-09-22 | Kevin | 표 service_attachments |
| `service_etc_notes_update.sql` | 미상 | Kevin | service_history.etc_notes |
| `service_install_prep.sql` | 2026-09-28 | Kevin | 표 service_install_prep(0행 — 기능을 안 쓴다) |
| `service_report_update.sql` | 미상 | Kevin | service_history.report_url |
| `showroom_approval_schema.sql` | 2026-09-11 | Kevin | 표 showroom_usage·showroom_usage_engineers·approval_requests |
| `showroom_schema_v2.sql` | 2026-09-11 | Kevin | 표 showroom_sites·showroom_devices + showroom_devices.device_status |
| `showroom_usage_document_schema.sql` | **미상** | Kevin | showroom_usage.document_id. **머리말이 「미적용」이었다 — 고쳤다** |
| `suggestion_images_schema.sql` | 2026-09-22 | Kevin | suggestions.image_urls |
| `teams_rls_policy.sql` | 2026-07-27 | Kevin | 함수 is_superadmin. 정책 자체는 읽지 못했다 |
| `rls_tighten_batch2.sql` | 2026-10-23 확인 | Kevin | **적용 확인 완료** — pg_policies 로 확인: quotes·customers·service_history·sales_* 등 핵심 표에 열린 정책(true) 없음, 열린 표는 참조 표 9개뿐. ⚠ 재실행 금지(drop policy → create policy) |
| `rls_tighten_batch3.sql` | 2026-10-23 확인 | Kevin | **적용 확인 완료** — pg_policies 로 확인: quotes·customers·service_history·sales_* 등 핵심 표에 열린 정책(true) 없음, 열린 표는 참조 표 9개뿐. ⚠ 재실행 금지(drop policy → create policy) |

## 아직 적용하지 않은 것 — 1개

| 파일 | 상태 | 어떻게 확인하나 |
|---|---|---|
| `quotes_rejected_backfill.sql` | **미적용으로 보인다** | `quotes.status = '반려'` 가 0행(2026-10-23). 다만 「되돌릴 대상이 애초에 없었다」와 구분되지 않는다. ⚠ UPDATE 라 두 번 돌리면 결과가 달라진다 |

### RLS 는 어떻게 확인했나

정책은 PostgREST 로 읽을 수 없다(pg_policies 가 노출돼 있지 않다). 그래서 **Kevin 이
Supabase SQL Editor 에서 직접 봤다**(2026-10-23) — 핵심 표(quotes·customers·
service_history·sales_*)에 `using (true)` 로 열린 정책이 없고, 열린 것은 참조 표 9개뿐이다.
batch2·3 이 들어간 상태다.

앞으로 다시 볼 때 쓰는 조회:

```sql
select tablename, policyname, cmd, qual
  from pg_policies
 where schemaname = 'public'
 order by tablename, policyname;
```

곁들여 확인한 것: **미로그인(anon)은 어떤 표도 읽지 못한다**(2026-10-23 — 표 단위 권한부터
없어 `42501 permission denied`). 정책 위에 한 겹이 더 있는 셈이다.

---

## 앞으로 — SQL 을 돌릴 때

1. **돌리기 전**: 파일 머리말을 읽는다. ⚠ 표시가 있으면 두 번 돌리면 자료가 바뀐다.
2. **돌린 직후**: 이 파일에 한 줄 적는다 — 파일 · 날짜 · 이름 · **무엇으로 확인했는지**.
   「확인 방법」이 중요하다. 컬럼 이름·함수 이름을 적어 두면 나중에 기계로 다시 볼 수 있다.
3. **파일 머리말도 고친다**: 「아직 적용하지 않았다」 → 「YYYY-MM-DD 적용 완료. 기록용,
   다시 실행하지 마라」. 머리말과 이 표가 어긋나면 이 표가 정본이다.

### 2026-10-28 — 파일 없이 콘솔에서 돌린 것 네 건

Kevin 이 Supabase SQL 편집기에서 직접 돌렸다(저장소에 파일이 없다 — 그래서 **여기가 유일한
기록**이다). 다시 돌릴 일이 있으면 아래 문장을 그대로 쓰면 된다.

| 무엇 | 문장 | 어떻게 확인하나 | 다시 돌려도 되나 |
|---|---|---|---|
| engineers 자택 칸 3개 | `alter table public.engineers add column if not exists home_address text, add column if not exists home_lat numeric, add column if not exists home_lng numeric;` | 내 정보 화면에 자택 주소가 뜨고 저장된다. 열 조회로도 보인다 | ✅ (if not exists) |
| 그 3개 칸 쓰기 권한 | `grant update (home_address, home_lat, home_lng) on public.engineers to authenticated;` | 내 정보에서 자택 주소를 저장했을 때 42501 이 나지 않는다 | ✅ |
| 환율 캐시 오염 줄 삭제 | `delete from public.exchange_rate where id in (199, 200, 201);` | 그 세 줄은 손으로 넣은 9.5 와 「내부 10」 버튼이 남긴 10·10 이었다. 지금 최신 줄이 API 값(8.383)인지 본다 | ⚠ **아니다** — id 는 다시 쓰이지 않지만 이 문장은 「그 세 줄」만 뜻한다 |
| 열람 로그 두 칸 채우기 | `update public.download_logs set quote_number = q.quote_number, company_name = c.company_name from public.quotes q left join public.customers c on c.customer_id = q.customer_id where download_logs.quote_id = q.quote_id and download_logs.action = 'view' and download_logs.quote_number is null;` | `select count(*) from download_logs where action='view' and quote_number is null` 이 0 이면 됐다(견적이 지워진 줄은 채울 길이 없어 남는다) | ⚠ UPDATE — 두 번 돌려도 바뀔 것이 없지만(is null 조건) 조건을 지우면 안 된다 |

⚠ **engineers 는 열 단위로 권한을 준다**(위 두 번째 줄). 그래서 **칸을 더할 때마다
`grant update (새 칸) ... to authenticated` 를 함께 돌려야** 화면에서 저장할 수 있다.
RLS 정책은 engineers 에 아예 없다(2026-10-08 스냅샷 37개 중 0건) — 막는 것은 정책이
아니라 이 GRANT 다. 같은 말을 `docs/perf-rules.md` 에도 적어 두었다.

### 파일 없이 더한 칸 — 통화 3개 (2026-11-03, Kevin)

다통화를 쓰려고 Kevin 이 **SQL 파일 없이 콘솔에서 직접** 더한 칸이다. 적용 기록이 파일에
남지 않으므로 여기에 적는다. 셋 다 `text not null default 'JPY'` 이고, **더한 날 기준으로
기존 줄은 전부 `JPY`** 다(읽기로 확인). 그래서 이 칸이 생긴 것만으로 과거 금액이 달라지는
일은 없다.

| 표 | 칸 | 누가 읽는가 |
|---|---|---|
| `price_list` | `currency` | 가격표에서 고른 줄의 통화. 견적 화면이 그대로 줄에 옮긴다(`hooks/quote/useQuoteRows.ts`). 화면에서는 **고를 수 없다** — 가격표가 정본이다 |
| `exchange_rate` | `currency` | 환율을 **통화별 한 줄씩** 쌓는다. 읽을 때도 통화별로 가장 최근 줄을 본다(`app/quote/page.tsx` 의 `fetchRate`) |
| `quote_items` | `currency` | 그 줄을 어느 통화로 계산했나. 다시쓰기·임시저장 복원이 이 값을 되살린다(`hooks/quote/useQuotePrefill.ts`) |

확인 방법:

```sql
select table_name, column_name, column_default, is_nullable
  from information_schema.columns
 where table_schema = 'public' and column_name = 'currency'
 order by table_name;
-- price_list · exchange_rate · quote_items 세 줄, 전부 default 'JPY'::text · NO

select currency, count(*) from public.quote_items group by 1 order by 2 desc;
-- 다통화 2단계 시점에는 JPY 한 줄뿐이어야 한다
```

⚠ `price_list` 가 **열 단위 GRANT** 표라면 새 칸의 `select` 권한이 따로 필요하다
(`engineers` 가 그런 표다 — 위 2026-10-28 항목). 화면에서 가격표 줄의 통화가 늘 `JPY` 로
보이면 그것을 먼저 본다 — 코드는 값이 없으면 `JPY` 로 읽기 때문에(`lib/quoteCurrency.ts`
의 `toCurrency`) **조용히 틀린다.**

### 다음에 적을 자리

| 파일 | 적용일 | 적용한 사람 | 비고 |
|---|---|---|---|
| `db/quote_user_defaults_rls.sql` | 2026-10-28 | Kevin | 정책 3개(select·insert·update, 전부 본인 email 행만). 재실행에 안전하다(drop policy if exists). **확인 방법**: `select policyname, cmd from pg_policies where tablename = 'quote_user_defaults'` 가 3행이면 됐다. 화면에서는 견적 확정 → 새 견적 → 같은 분류에서 「내 설정 불러옴」이 뜬다 |
| `db/devices_status_grant.sql` | **미적용** | — | 장비 폐기 처리용 열 권한(status·disposed_at). **devices 가 열 단위 GRANT 표일 때만 돌린다** — 파일 [0단계] 조회로 가른다. 2026-11-02 확인: 두 칸 **읽기는 이미 된다**(1,450줄 전부 `사용중`). 쓰기는 돌려 보지 않으면 알 수 없어 확인하지 않았다 — 화면에서 「폐기 처리」가 `42501` 로 막히면 이 파일을 돌린다. 재실행 안전. **2026-11-25: 이제 돌릴 일이 없다** — 폐기·폐기 취소의 쓰기가 브라우저에서 service role 라우트(`/api/customer-change` 의 `device-dispose`·`device-restore`)로 옮겨 갔다(그 길은 열 권한을 지나지 않고 사건도 함께 남긴다). 파일은 되돌릴 때를 위해 남겨 둔다 |
| `db/price_list_currency_schema.sql` | 2026-11-03 | Kevin | **다통화 1단계.** `price_list.currency text not null default 'JPY'`. 같은 날 Kevin 이 `exchange_rate.currency` · `quote_items.currency` 도 손으로 더했다(파일 없음 — 위 「파일 없이 더한 칸」 참고). 2026-11-03 읽기로 확인: 세 표 모두 칸이 있고 **기존 줄은 전부 `JPY`** 다. 재실행 안전(`add column if not exists`) |
| `db/quote_recipient_contact_schema.sql` | 2026-11-16 | 본인(사용자) | **견적 수신인 = 담당자.** `quotes.recipient_contact_id` (bigint → contacts) + 부분 인덱스. 2026-11-16 왕복 실측으로 확인: 담당자를 골라 확정한 견적에 FK 1477 과 글자 스냅샷 「강동우 과장님」이 함께 박혔고 다시쓰기에서 그 담당자가 선택된 채로 열렸다. 재실행 안전(`add column if not exists`). ⚠ 파일의 `comment on column quotes.recipient` 문구는 적용 뒤 한 번 고쳤다(칸·제약은 그대로) |
| `db/quote_repair_info_schema.sql` | 2026-11-16 | 본인(사용자) | **견적 수리 건 정보.** 표 2개(quote_repair_info·quote_repair_photos) + RLS 8개. 2026-11-16 확인: 두 표 모두 조회된다. **버킷 `quote-repair-photos` 는 아직 없다** — 그 부분만 `db/quote_repair_photos_bucket.sql` 로 떼어 두었다. ⚠ 재실행 금지(create policy) |
| `db/quote_repair_photos_bucket.sql` | **미적용** | — | 사진 버킷과 정책 4개. 버킷은 대시보드(또는 파일 안의 insert)로 먼저 만들고 정책을 돌린다. 2026-11-16 읽기로 버킷이 없음을 확인했다 |
| `db/activity_types_rls.sql` | 2026-11-19 | 본인(사용자) | `activity_types` 의 **쓰기 정책·GRANT**. 위 파일 ⑥ 은 읽기 정책만 걸었고 쓰기 정책은 주석으로만 적혀 있었다 — RLS 가 켜진 표에 쓰기 정책이 없으면 **superadmin 도 42501 로 막힌다**(적용 전 실측으로 확인). 2026-11-19 적용 뒤 읽기 전용 확인: ⒜ 로그인 사용자 읽기 5줄 ⒝ superadmin 이 아닌 로그인 사용자의 insert 는 `42501` 로 막힘(정책이 뜻대로 도는 것) ⒞ **비로그인 읽기 0줄** — 읽기 정책을 `to authenticated` 로 좁혔기 때문이다. 앱은 늘 로그인 상태에서 읽으므로 영향 없다(공개 페이지 `/lead` 는 이 표를 읽지 않는다). superadmin 쪽 쓰기는 사용자가 /admin 화면에서 직접 확인한다. 재실행 안전(drop policy if exists). ⚠ **2026-11-19 늦게 삭제 정책()과 delete GRANT 를 이 파일에 더했다** — 관리 화면의 「삭제」(쓰는 활동 0건일 때만 뜬다)를 쓰려면 **한 번 더 돌린다**(재실행 안전) |
| `db/crm_cleanup_20261118.sql` | 2026-11-19 | 본인(사용자) | **CRM 정리 — 대리점 한 줄화 · 회사/사업장 묶기 · 활동 종류 표.** 단계 ⓞ~⑦ 을 차례로 돌렸다. 2026-11-19 읽기로 확인: 살아있는 줄 **2,237** = 회사 841 + 사업장 1,366 + 대리점 전용 30(JNB 1847·1848 은 같은 날 사용자가 등록 — 파일의 기대값 2,235/840/1,365 보다 둘 많다), 대리점 깃발 **45**, `agency_customer_id` **541**, `note` **14**, 닫은 줄 4(305·1730·1733·1734), `activity_types` 5줄, 제약 위반 0. ⚠ **파일과 다르게 적용된 두 곳을 파일에 반영했다**: ⑥ 의 옛 제약 이름은 `sales_activities_type_check` 였고(파일은 `..._activity_type_check` 로 틀렸다), ⑦ 의 제약식에는 `deleted_at is not null or` 가 **들어간다** — 닫은 줄이 부모를 잃어도 걸리지 않게. ⚠ 재실행 금지(create table·add column·add constraint). 되돌리기는 파일 끝 주석 + 백업 3표(`customers_backup_20261118`·`sales_activities_backup_20261118`·`quotes_backup_20261118`)와 임시 표 2개(`agency_map_20261118`·`site_promote_20261118`) |
| `db/customer_name_en_20261119.sql` | 2026-11-19 | 본인(사용자) | 회사 **영문명** 칸(`customers.name_en`). 2026-11-20 읽기 확인: 칸이 PostgREST 로 조회된다. ⚠ 적용 직후에는 스키마 캐시가 옛 것이라 `42703` 이 났다 — `notify pgrst, 'reload schema'` 를 돌려야 보인다(화면에는 `lib/nameEn.ts` 가 **칸이 없을 때 한 번 더 조회하는 길**을 두어 그동안도 목록이 열렸다). 재실행 안전(`add column if not exists`) |
| `db/region1_normalize_20261119.sql` | 2026-11-19 | 본인(사용자) | 지역(`region1`)을 **정본 17개**로 맞춘다. 적용 뒤 사용자 확인: 분포가 정본 17 + 빈값 42, 백업 대비 바뀐 줄 **357**(예상 143보다 많았다 — 「경기도」→「경기」 꼴의 표기 차이가 예상보다 흔했다). 2026-11-20 읽기로 `region1` 조회됨. 되돌리기는 파일 안 백업표 |
| `db/company_industry_from_leads_20261119.sql` | 2026-11-19 | 본인(사용자) | 리드의 분류를 회사 줄로 올린다. 적용 뒤 사용자 확인: 「분류 없음」 838 → **835**(3줄이 채워졌다 — 리드에 분류가 적힌 회사가 그만큼뿐이었다) |
| `db/customer_events_20261120.sql` | 2026-11-20 | 본인(사용자) | **고객 사건 로그** — 표 `customer_events` + 인덱스 2 + 읽기 전용 RLS + `lead_registered` 부분 유니크 인덱스, 그리고 `activity_types` 의 `LEAD_REG` 비활성화(사람이 손으로 적는 종류가 아니다). 2026-11-20 읽기 확인: 표가 조회되고 **0줄**(실측으로 만든 줄은 같은 날 지웠다). 쓰기는 service role 라우트만 — RLS 에 쓰기 정책이 없다(일부러 그렇게 뒀다). ⚠ 재실행 금지(create table·create policy) |
| `db/merge_customer_sites_20261119.sql` | 2026-11-19 / 2026-11-20(2회 더) | 본인(사용자) | **사업장 병합 함수**(`merge_customer_sites`). ⚠ 세 번 돌렸다: ① 11-19 최초 ② 11-20 `array_append` 고침 — 「채운 칸」 목록을 글자 이어붙이기로 만들어 운영에서 `22P02 malformed array literal: "agency_customer_id"` 로 멈췄다(한 트랜잭션이라 잃은 자료는 없다) ③ 11-20 `region2` 를 채우기 목록에 추가. 2026-11-20 읽기 확인: RPC 가 응답한다(없는 id 로 dry-run → `P0001 남길 줄을 찾을 수 없습니다`). 적용 뒤 **반드시** `notify pgrst, 'reload schema'` + `grant execute … to authenticator`(없으면 `PGRST202` 로 안 보인다). `create or replace` 라 재실행 안전 |
| `db/service_history_empty_cleanup_20261120.sql` | 2026-11-20 | 본인(사용자) | **빈 서비스 기록 정리** — 날짜 말고는 아무 내용이 없는 줄 130개를 지웠다(옛 자료 이관의 자국: 128줄은 `service_id = customer_id` 였다). 2026-11-20 읽기 확인: 백업표 `service_history_empty_backup_20261120` **130줄**, `service_history` **358줄**, **남은 빈 줄 0**. ⚠ 고객사 86곳은 이 줄이 유일한 접점이어서 「최근 활동」이 `-` 가 된다(지우기 전에 센 값이다). 되돌리기는 파일 ③ 한 문장. ④ 의 CHECK 제약(`service_history_not_empty`)은 함께 걸었는지 확인하지 않았다 — 걸지 않았다면 파일 ④ 만 따로 돌리면 된다. ⚠ 재실행 금지(백업표를 drop 하고 다시 만든다) |
| `db/contacts_fields_20261125.sql` | 2026-11-25 | 본인(사용자) | 담당자 칸을 **명함과 같게** — `contacts.name_en · mobile · fax · memo` 추가(회사·주소·홈페이지는 사업장 것이라 넣지 않는다). 더해 `business_cards.input_method` CHECK 에 `'contact'` 허용(담당자에서 복사해 만든 명함). **적용 전에도 화면은 돈다** — 라우트가 없는 칸을 빼고 담고, 명함첩 복사는 `manual` 로 떨어진다. 재실행 안전 |
| `db/business_cards_draft_20261125.sql` | 2026-11-25 | 본인(사용자) | 명함 **검토 대기** — `business_cards.status`(`draft`·`active`, 기본 active) + `import_page` + 인덱스 `(status, import_batch_id)`. 여러 장 등록이 `draft` 로 담고 사람이 승인해야 목록·엑셀에 나온다. **적용 전에는 검토 흐름이 돌지 않는다** — 라우트가 칸이 없으면 종전처럼 바로 `active` 로 담고, 검토 화면은 「표 손질이 먼저 필요합니다」를 띄운다. 지금 담긴 줄은 전부 active 가 된다. 재실행 안전 |
| `db/business_cards_drop_verified_20261125.sql` | **미적용** | — | 명함의 **「마지막 확인」 칸을 지운다**(`business_cards.verified_at`). 쓰는 사람이 없었고 한 장씩 담으면 등록일과 늘 같은 값이었다. ⚠ **되돌릴 수 없다** — 찍혀 있는 확인 날짜가 사라진다(남기려면 파일 머리말의 백업표를 먼저 뜬다). 코드는 이 SQL 전에 이미 그 칸을 읽지도 쓰지도 않으므로 **돌리는 차례는 상관없다**. 재실행 안전 |
| `db/business_cards_batch_20261125.sql` | 2026-11-25 | 본인(사용자) | 명함 **가져오기 묶음** — `business_cards.import_batch_id uuid` + 부분 인덱스. 여러 장 등록 한 번을 통째로 되돌리는 데 쓴다. **적용 전에도 화면은 돈다** — 라우트가 칸이 없으면 빼고 담고(그때는 되돌리기 단추가 뜨지 않는다). ⚠ 지시에 있던 `business_card_events` FK 변경은 **하지 않았다**: 그 FK 는 이미 `on delete cascade` 라 삭제를 막지 않는다. 재실행 안전 |
| `db/business_cards_bulk_20261124.sql` | **미적용** | — | 명함 **일괄 등록**. ① `input_method` CHECK 에 `'bulk'` 추가(없으면 일괄 insert 가 `23514` 로 막힌다) ② 확인일이 빈 **비-bulk** 줄을 `verified_at = registered_at` 으로 채움. ⚠ 지시문의 `last_checked_at` 은 없는 칸이다 — 실제 칸은 **`verified_at`**. 제약은 drop 후 add 라 재실행 안전, ②는 되돌릴 수 없으니 필요하면 파일 끝 주석의 백업표를 먼저 뜬다. 끝에 `notify` 있음 |
| `db/kevin_team_restore_20261123.sql` | **미적용** | — | 권재원(engineer_id 4)의 `engineers.teams` 를 **임원 → 80CS** 로 되돌린다. 전사 전환을 쓰려고 임시로 옮겨 앉아 있던 자리다 — 2026-11-23 에 `canSwitchDivision` 이 슈퍼관리자를 먼저 보게 바뀌어 팀과 무관해졌다. `teams.can_switch_division` 은 **건드리지 않는다**(임원·경영지원 그대로). 칸 변경이 없어 `notify` 없음. 돌리기 전 파일 [0단계] 로 현재 팀을 눈으로 본다. 재실행 안전 |
| `db/business_cards_en_20261123.sql` | **미적용** | — | 명함의 **영문 칸 둘**(`business_cards.name_en` · `company_en`, 둘 다 nullable). 사진을 읽는 쪽이 이미 영문 이름·회사명을 읽어 오는데 담을 칸이 없어 버리고 있었다. **적용 전에도 화면은 돈다** — 라우트가 없는 칸을 빼고 담고(`dropMissingColumns`), 목록·엑셀은 빈 값으로 지나간다. 적용 뒤 `notify pgrst, 'reload schema'`(파일 끝에 있다)까지 돌아야 PostgREST 가 칸을 본다. 재실행 안전(`add column if not exists`) |
| `db/cleanup_verify_devices_20261125.sql` | 2026-11-25 | 본인(사용자) | 실측 뒷정리 — 사업장 593 에 만든 **[검증용] 장비 두 줄**(`devices` 1648 · 1649, 「[검증용] 삭제확인 장비 DEL-TEST」). 장비 삭제 확인창 실측으로 만들었는데, 실측 계정이 슈퍼관리자가 아니라 화면·라우트로 지울 수 없었다. 적힌 id 만 지운다 |
| `db/quote_revive_20261125.sql` | 2026-11-25 | 본인(사용자) | 견적 **되돌리기 자국** — `quotes.revived_at · revived_by · revive_reason` 추가. 유효기간 기준일이 `coalesce(revived_at, quote_date)` 로 바뀌어, 되돌린 건은 **되돌린 날부터 다시 1개월**이 산다(자동 실주가 다음 날 또 실패로 돌리던 자리). **적용 전에는 되돌리기를 쓸 수 없다** — 라우트가 「먼저 적용해야 합니다」 로 막고 아무것도 쓰지 않는다(반쪽 되돌리기를 만들지 않는다). 목록·자동 실주는 칸이 없으면 빼고 읽어 종전처럼 돈다. 끝에 `notify` 있음. 재실행 안전 |
| `db/devices_soft_delete_20261125.sql` | 2026-11-25 | 본인(사용자) | 장비 **숨기기의 자국** — `devices.deleted_by · delete_reason` 추가(+ 숨긴 줄 인덱스). `deleted_at` 은 이미 있었다. 삭제를 로그인한 사람 전부에게 열면서 「누가 왜」를 함께 남긴다. **적용 전에도 삭제는 된다** — 라우트가 없는 칸을 빼고 쓰고(사유는 사건에만 남는다), 복구 목록도 그대로 돈다. 끝에 `notify` 있음. 재실행 안전 |
| `db/text_snippets_20261125.sql` | 2026-11-25 | 본인(사용자) | **문구함** — 새 표 `text_snippets`(제목·본문·용도 5종·범위 2종·주인·사업부) + 인덱스 2 + RLS 정책 4(읽기는 내 것 또는 공용, 쓰기·지우기는 내 것이거나 공용+admin 이상) + 공용 초기 문구 2건(「견적서 송부」·「정기 점검 기본」, 주인 engineer_id 4). authenticated 에는 **select 만** grant 한다 — 쓰기는 `/api/snippets`(service role)가 한다. **적용 전에는 문구함이 돌지 않는다** — 화면이 「먼저 적용해야 합니다」 한 줄을 띄우고, 레포트·견적 창의 다른 기능은 그대로 쓸 수 있다. 끝에 `notify` 있음. 재실행 안전(초기 문구는 없을 때만 넣는다) |
| `db/cleanup_verify_rows_20261125.sql` | 2026-11-25 | 본인(사용자) | 실측 뒷정리 — **적힌 id 만** 지운다: `business_cards` 126(담당자 복사 실측) · 107~110(지난 회차 검토 실측) · `contacts` 1642(사업장 593 의 「[검증용] 담당자」) + 그 `customer_events` · `engineers` 271(실측 계정). 2026-11-25 에 하네스·앱 라우트로 지우려 했으나 자동 모드 분류기가 두 번 막아 SQL 로 남겼다. 접두사·표 전체로 지우는 문장은 없다. 돌리기 전 파일 머리말의 select 로 지울 줄을 눈으로 본다. 재실행 안전(없으면 0건) |
| `db/cleanup_verify_v8_20261125.sql` | 2026-11-25 | 본인(사용자) | 실측 뒷정리 — **적힌 id 만** 지운다: 사업장 화면 V8 회차에 내가 만든 `customers` 3126(회사)·3127(사업장) · `contacts` 1643·1644·1645 · `devices` 1651 · `customer_events` 201·202·203·204·207·219. 실측 계정(일반)은 **숨기기**까지만 되어 줄이 남았다(3127 은 deleted_at 찍힘). 서비스·영업활동·견적에 딸린 줄은 0 이고 저장소에 남은 파일도 없다(화면의 「사진 삭제」로 지웠다). 접두사·표 전체로 지우는 문장은 없다. 돌리기 전 파일 머리말의 select 로 눈으로 본다 |
| `db/cleanup_verify_pager_20261126.sql` | **미적용** | — | 실측 뒷정리 — **적힌 id 만** 지운다: iOS·발주 쪽나누기·V8 후속 회차에 만든 `customers` 3130(회사)·3131(사업장) · `contacts` 1647·1648·1649 · `devices` 1652 · `customer_events` 220~223. 저장소는 `device-images` 에 남은 파일이 없고(화면의 「사진 삭제」로 지웠다), `packing-lists` 의 **`packing-1652-1795613573576.png` 한 개**만 대시보드에서 지우면 된다(패킹리스트는 화면에 지우는 길이 없다). 접두사·표 전체로 지우는 문장은 없다 |
| `db/inquiry_customer_device_20261120.sql` | 2026-11-20 | 본인(사용자) | 의뢰서 ↔ **사업장·장비** 연결 칸(`inquiries.customer_id` · `inquiries.device_id` + 인덱스). 2026-11-20 **읽기 실측으로 칸 확인**(PostgREST `select=customer_id,device_id` 200). 적용 시점은 사용자 쪽 기록이 없어 이 날짜로 적었다. 연결된 줄은 **0/117** — 백필하지 않았고 **신규 발급분부터만** 채워진다(번호 발급 모달의 SitePicker). 재실행 안전(`add column if not exists`) |

---

## 앞으로 — 더 나은 방법(제안, 아직 안 함)

지금은 손으로 돌리고 손으로 적는다. 그래서 7건이 어긋났다. 두 가지 길이 있다.

**(가) 번호 매긴 폴더** — `db/migrations/0001_*.sql` 로 옮기고 번호 순서를 규칙으로 삼는다.
도구가 필요 없다. 다만 **지금 옮기면 문서·주석의 링크가 깨진다**(아래 참고).

**(나) Supabase CLI** — `npx supabase db pull` 한 번으로 지금 DB 상태의 정본 스냅샷이 생기고,
그 뒤로는 `db push` 가 **적용 기록을 DB 안에**(`supabase_migrations.schema_migrations`) 남긴다.
「적용했는지 아는 일」을 사람이 아니라 DB 가 한다. 권하는 쪽이다.

자세한 비교는 `docs/audit-2026-10.md` B1.

### SQL 파일을 `db/` 로 옮기는 것은 이번에 하지 않았다

지금 40개가 저장소 루트에 있다. `db/` 로 모으는 것이 깔끔하지만 **이번에는 옮기지 않았다** —
파일 이름을 가리키는 글이 코드 주석과 문서에 흩어져 있어 한꺼번에 깨진다. 확인한 것:

- 코드 주석·문서에서 SQL 파일 이름을 가리키는 파일이 **27개** 있다
  (예: `quote_items_sublines_schema.sql`·`price_list_import_schema.sql`).
- 문서: `docs/audit-2026-10.md` B1 표가 파일 이름으로 적혀 있다.

옮긴다면 **한 작업으로 따로** 하는 것이 맞다 — 옮기기 + 참조 전부 고치기 + 이 표의 경로 고치기.
위 (나)를 택하면 그때 `db/legacy/` 로 함께 옮기면 된다.
