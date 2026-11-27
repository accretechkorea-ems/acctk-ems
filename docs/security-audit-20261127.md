# 보안 조사 (2026-11-27, 묶음5 11)

**수정하지 않았다.** 코드도 설정도 데이터도 그대로다. 본 것과 권고만 적는다.
위험은 **상 / 중 / 하** 셋이고, **긴급(상)은 맨 위**에 따로 모았다.

조사 범위 — 서비스 롤 키 노출 경로 · RLS · API 라우트의 권한 검사 · 클라이언트가
직접 쓰는 표 · CSP·헤더 · 업로드 검증 · 세션/쿠키.

---

## ■ 긴급 (상) — **3건**

| # | 항목 | 위치 | 무엇이 문제인가 | 권고 |
|---:|---|---|---|---|
| **상-1** | **RLS 선언을 찾지 못한 표 넷** | `notifications` · `holding_notes` · `inventory_items` · `suggestions` | 이 저장소의 `*.sql` 어디에도 `enable row level security` 가 없다. **anon 키로 누구나 읽고 쓸 수 있다는 뜻일 수 있다** — anon 키는 클라이언트 번들에 들어 있어 누구나 꺼낼 수 있다. 특히 `notifications` 는 **남의 알림을 읽는 길**이고, `suggestions` 는 글쓴이가 아닌 사람이 고치거나 지울 수 있다 | **먼저 실제 상태를 본다**: `select relname, relrowsecurity from pg_class where relname in (…)`. 켜져 있지 않으면 표마다 「본인 것만」 정책을 두는 SQL 을 쓴다. ⚠ 지금 화면이 그 표를 **직접** 쓰고 있어(아래 중-1), 정책을 켜면 화면이 멈출 수 있다 — 정책과 화면을 **한 묶음**으로 바꿔야 한다 |
| **상-2** | **클라이언트가 직접 쓰는 표 20여 개** | 아래 「중-1」 표 | RLS 가 느슨하면 브라우저 콘솔에서 anon 키로 **남의 줄을 고칠 수 있다**. 특히 `quotes.update`(금액·상태) · `sales_opportunities.update`(단계) · `approval_history.delete`(결재 이력 지우기) · `audit_log.insert`(기록 위조)가 위험하다. **결재 이력과 감사 기록을 클라이언트가 지우고 쓸 수 있다는 것**이 가장 나쁘다 | 셋을 먼저 서버로 옮긴다: `approval_history` 의 delete · `audit_log` 의 insert · `download_logs` 의 insert. **기록은 기록하는 주체가 지울 수 없어야** 기록이다(2026-11-27 의 `admin_events` 가 그 규칙으로 만들어졌다 — 쓰기 정책을 아예 두지 않았다) |
| **상-3** | **`db/admin_events_20261127.sql` 미적용** | `db/APPLIED.md` | 관리자 행위(비밀번호 초기화·역할 변경·삭제 복구)가 **서버 로그 한 줄**로만 남는다. 로그는 돌아가며 지워지고, 「누가 언제 무엇을」을 나중에 물을 수 없다 | 적용. 코드는 이미 전부 돌고 있다 |

---

## ① 서비스 롤 키 — **깨끗하다**

| 항목 | 위험 | 위치 | 본 것 | 권고 |
|---|:-:|---|---|---|
| 번들 노출 | **하** | `lib/supabase/admin.ts` | 키를 읽는 파일이 **한 곳뿐**이다. `SUPABASE_SERVICE_ROLE_KEY` 에 `NEXT_PUBLIC_` 접두어가 없어 클라이언트 번들에서는 `undefined` 가 된다. 화면 코드(`components/**`·`app/**/page.tsx`)에서 이 이름을 쓰는 자리는 **0곳** | 그대로 둔다. 2026-10-23 의 「56곳에 흩어짐」은 해결됐다 |
| 로그 노출 | **하** | 라우트 전반 | 키를 찍는 `console.log` 를 찾지 못했다 | 그대로 |
| `.env.local` | **중** | 저장소 밖 | `.gitignore` 에 있다. 다만 **이 파일을 읽는 조사 스크립트**가 늘고 있다(`scripts/*-measure.js`) — 그 스크립트가 값을 찍지 않는지는 사람이 봐야 한다 | 하네스에 「env 값을 출력하지 않는다」 한 줄을 두는 것을 권한다 |

## ② RLS

| 항목 | 위험 | 위치 | 본 것 | 권고 |
|---|:-:|---|---|---|
| 선언을 못 찾은 표 | **상** | 위 상-1 | `notifications` · `holding_notes` · `inventory_items` · `suggestions` | 상-1 |
| 선언이 있는 표 | 하 | `rls_tighten_batch2.sql` · `audit_log_setup.sql` · `menu_perm_function.sql` · `semi_contact_schema.sql` 등 | `download_logs` · `audit_log` · `semi_*` 는 정책이 있다 | 그대로 |
| 쓰기 정책 없는 표 | 하 | `admin_events`(미적용) · `equipment_*` | **일부러** 그렇다 — service role 만 쓴다. 좋은 모양이다 | 다른 기록표도 이 모양으로 |

> ⚠ 이 조사는 **저장소의 SQL 파일**만 읽었다. 실제 DB 에 손으로 켜 둔 정책은 보이지 않는다.
> 상-1 의 첫 걸음이 「실제 상태를 본다」인 까닭이다.

## ③ API 라우트의 권한 검사 — **68개 전수**

| 항목 | 위험 | 본 것 |
|---|:-:|---|
| 권한 검사가 **아예 없는** 라우트 | **하** | **1개** — `/api/lead-delete`. 다만 그 라우트는 **410 Gone 만 돌려준다**(2026-11-23 에 기능을 걷었다). 위험이 아니다 |
| 나머지 67개 | 하 | 전부 `loadCaller` 또는 `getUser` 를 지난다 |
| 비밀번호 초기화 | 하 | `loadCaller({ kind: 'superadmin' })` — 슈퍼관리자만. 좋다 |
| 관리 라우트(`/api/team`·`/api/update-engineer`·`/api/customer-delete`) | 하 | 전부 `loadCaller` 로 자격을 보고, 2026-11-27 부터 `admin_events` 에 기록한다 |

## ④ 클라이언트가 직접 쓰는 표 — **중-1**

| 항목 | 위험 | 표 · 횟수 | 왜 서버로 가야 하나 |
|---|:-:|---|---|
| **기록을 클라이언트가 쓴다** | **상**(상-2) | `audit_log.insert` 4 · `download_logs.insert` 4 · `approval_history.insert` 2 · `approval_history.delete` 2 · `approval_documents.delete` 2 | 기록은 **기록하는 주체가 지울 수 없어야** 기록이다 |
| **돈과 단계를 클라이언트가 고친다** | **중** | `quotes.update` 2 · `sales_opportunities.update` 6 | RLS 가 「내 것만」이면 큰 문제는 아니다 — 그러나 그 RLS 를 확인하지 못했다(②) |
| 그 밖 | 중 | `notifications.insert` 6 · `repairs.update` 4 · `service_history.update` 3 · `inventory_items.update` 3 · `holding_notes` 4 · `suggestions` 2 · `showroom_usage.delete` 1 … | 차례로 라우트 뒤로 옮긴다 |

> `notifications.insert` 가 **6곳**인 것이 눈에 띈다 — 알림을 **클라이언트가 만든다**는 뜻이다.
> 남에게 알림을 보내는 일이라, 아무나 아무 내용을 보낼 수 있다.

## ⑤ CSP · 헤더 — **좋다**

| 헤더 | 위험 | 값 |
|---|:-:|---|
| `Content-Security-Policy` | 하 | `default-src 'self'` 에서 시작해 자리마다 좁혀 두었다. 바뀔 때 `scripts/csp-check.js` 가 잡는다 |
| `X-Frame-Options` | 하 | `DENY` |
| `Strict-Transport-Security` | 하 | `max-age=63072000; includeSubDomains; preload` |
| `Referrer-Policy` | 하 | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | 하 | `camera=() microphone=() geolocation=()` |
| `X-XSS-Protection` | **하(권고)** | `1; mode=block`. 요즘 브라우저는 무시하고, 옛 브라우저에서는 **오히려 취약점**이 된 적이 있다 | 떼어도 된다 |
| `X-Content-Type-Options` | **중 — 없다** | `nosniff` 가 **빠져 있다**. 업로드한 파일을 브라우저가 냄새로 판정해 실행할 여지가 남는다 | 한 줄 더하기를 권한다 |

## ⑥ 업로드 검증 — **좋다, 한 자리만 빼고**

| 자리 | 위험 | 본 것 |
|---|:-:|---|
| 이미지(명함·공지·첨부·서비스) | **하** | `lib/imageUpload.ts` 가 ① data URL 꼴 ② 선언 MIME(jpeg/png/webp) ③ 크기 ④ **앞머리 바이트로 실제 형식**까지 본다. 선언과 실제가 다르면 거부한다 — 제대로 된 검사다 |
| 견적 PDF(`/api/quote-backfill`) | **중** | 크기(20MB)만 본다. **MIME 도 앞머리 바이트도 보지 않는다.** 올린 뒤 `contentType: 'application/pdf'` 로 저장하므로, PDF 가 아닌 것이 PDF 로 둔갑해 저장된다 | 이미지와 같은 검사를 더하기를 권한다(`%PDF-` 네 바이트) |

## ⑦ 세션 · 쿠키

| 항목 | 위험 | 본 것 | 권고 |
|---|:-:|---|---|
| 쿠키 설정 | 하 | `@supabase/ssr` 이 정한다 — HttpOnly·SameSite·Secure 가 그 안에 있다. 우리가 손대지 않았다 | 그대로 |
| 무활동 로그아웃 | 하 | 30분 · 1분 전 경고 · 탭 공유(2026-11-27 묶음5 8 에서 고쳤다) | 그대로 |
| 로그아웃 | 하 | 무슨 일이 있어도 로그인 화면으로 가고, 쿠키를 직접 지우는 폴백이 있다(`lib/auth/logout.ts`) | 그대로 |
| 미들웨어 | 하 | 2026-11-27 부터 `getUser()` 를 **한 번 더** 물어보고 판정한다 | 그대로 |
| bfcache | 하 | 뒤로 가기로 되살아난 보호 화면을 다시 판정한다(`guardRestoredPage`) | 그대로 |

---

## 먼저 할 것 (차례)

1. **상-1** — 네 표의 RLS 실제 상태를 본다. 꺼져 있으면 정책 + 화면을 **한 묶음**으로.
2. **상-2** — `audit_log` · `approval_history` · `download_logs` 의 쓰기·지우기를 서버로.
3. **상-3** — `admin_events` 적용.
4. `X-Content-Type-Options: nosniff` 한 줄.
5. 견적 PDF 의 앞머리 바이트 검사.
6. `notifications.insert` 6곳을 라우트 뒤로.
