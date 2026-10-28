# SQL 적용 기록

**SQL 을 DB 에 돌렸으면 여기에 한 줄 적는다.** 적지 않으면 다음 사람이 「이게 적용됐나」를
파일 머리말만 보고 추측해야 하고, 그 머리말은 **이미 한 번 7건이 틀려 있었다**
(2026-10-23 전수 확인 — `docs/audit-2026-10.md` B1).

적는 것: **파일 · 적용일 · 적용한 사람 · 비고**(무엇으로 확인했는지).
적용일을 모르면 `미상`, 확인만 한 날은 비고에 「확인 YYYY-MM-DD」로.

SQL 파일은 지금 **저장소 루트**에 있다(`db/` 가 아니다 — 아래 「앞으로」 참고).

---

## 적용 확인된 것 — 39개

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

### 다음에 적을 자리

| 파일 | 적용일 | 적용한 사람 | 비고 |
|---|---|---|---|
| `db/quote_user_defaults_rls.sql` | 2026-10-28 | Kevin | 정책 3개(select·insert·update, 전부 본인 email 행만). 재실행에 안전하다(drop policy if exists). **확인 방법**: `select policyname, cmd from pg_policies where tablename = 'quote_user_defaults'` 가 3행이면 됐다. 화면에서는 견적 확정 → 새 견적 → 같은 분류에서 「내 설정 불러옴」이 뜬다 |

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
