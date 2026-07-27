# 취약점 점검 이력 (security-audit-log.md)

> 실제 코드/설정에서 확인된 내용만 기재하며, 확인 불가 항목은 **"확인 필요"** 로 명시한다.
> 민감 정보(키·비밀번호·토큰 실제 값)는 기재하지 않는다.

---

## 1. 점검 개요

| 항목 | 내용 |
|---|---|
| 점검 일자 | 2026-06-29 |
| 점검 도구 | Claude Code (정적 코드 분석 + `npm audit`) |
| 점검 대상 | `customer-map-web` 전체 코드베이스 (Next.js App Router, Supabase) |
| 점검 범위 | 9개 영역: ① Secrets ② RLS ③ 인증·인가 ④ API/Server ⑤ Storage ⑥ 데이터 노출 ⑦ 보안 헤더 ⑧ 의존성 ⑨ 감사 로깅 |
| 점검 방식 | 코드/설정 grep·정독, `npm audit`, 라우트별 인증 확인, 헤더/버킷/토큰 위치 검증 |

---

## 2. 점검 결과 요약표

| No | 점검 영역 | 발견 항목 | 심각도 | 조치 방식 | 조치 전 상태 | 조치 후 상태 | 관련 파일 |
|---|---|---|---|---|---|---|---|
| 1 | Secrets | `.env*` gitignore·미추적·커밋이력 없음 | 하 | — (양호) | 양호 | 유지 | `.gitignore` |
| 2 | Secrets | service_role 키 서버(API)에서만 사용 | 하 | — (양호) | 양호 | 유지 | `app/api/*/route.ts` |
| 3 | Secrets | NEXT_PUBLIC_은 공개용 3종만(URL/anon/kakao) | 하 | — (양호) | 양호 | 유지 | `.env.local`(키명만) |
| 4 | 인증·인가 | **`/api/quote-pdf` 무인증 — 견적 PDF signed URL 임의 발급** | **상** | 자동수정 | 비로그인 접근 가능 | 세션검증(401)+견적확인+경로검증 | `app/api/quote-pdf/route.ts` |
| 5 | 인증·인가 | middleware가 `/api/*` 통과(설계) → 라우트 자체검증 필요 | 정보 | 확인 | 정상(대부분 자체검증) | 유지 | `middleware.ts` |
| 6 | API/Server | `/api/exchange-rate` 무인증 호출 | 중 | 자동수정 | 무인증 | 로그인 필수 + 타임아웃 | `app/api/exchange-rate/route.ts` |
| 7 | API/Server | `/api/exchange-rate` TLS 검증 비활성(`rejectUnauthorized:false`) | 중 | 제안/코드밖 | 유지(정부 CA 이슈) | 호스트 고정·문서화, CA주입은 별도 | `app/api/exchange-rate/route.ts` |
| 8 | API/Server | 전 API 라우트 rate limiting 부재 | 중 | 코드밖 | 없음 | WAF/Vercel 레벨 권장 | — |
| 9 | RLS | **`teams` RLS 활성 but INSERT 정책 누락 → 팀 추가 실패** | 상 | 제안(SQL) | 정책 위반 오류 | 정책 SQL 제공 | `teams_rls_policy.sql` |
| 10 | RLS | 전 테이블 RLS 활성/정책 원문 미확인 | 상 | 코드밖 | 미확인 | 대시보드 전수확인 필요 | — |
| 11 | Storage | `packing-lists`/`service-report`/`quote-pdfs`/`profile-images` 비공개+signed URL | 하 | — (양호) | 양호 | 유지 | 각 API/페이지 |
| 12 | Storage | `device-images` 공개 URL 사용(장비사진 노출 가능) | 중 | 코드밖 | 공개 추정 | 의도 확인 필요 | `components/customer/utils.ts` |
| 13 | Storage | 경로 순회 방지(`..` 제거, `/` 거부, DB 확인) | 하 | — (양호) | 양호 | 유지 | `device-image`/`profile-image`/`quote-pdf` |
| 14 | 데이터 노출 | API 에러 응답에 DB 원문 메시지 노출 | 중 | 자동수정 | `error.message` 반환 | 일반 메시지 + 서버 로그 | quote-pdf/device-image/profile-image/delete-quote-pdf/update-engineer/exchange-rate |
| 15 | 데이터 노출 | `select('*')` 광범위 사용 | 하 | 수용(현행) | 다수 | 미변경(비밀 컬럼 없음·RLS 통제·파손위험) | 다수 페이지 |
| 16 | 보안 헤더 | CSP/HSTS/XFO/XCTO/Referrer/Permissions/XSS 7종 설정 | 하 | — (양호) | 양호 | 유지 | `next.config.ts` |
| 17 | 보안 헤더 | CORS 커스텀 미개방(same-origin) | 하 | — (양호) | 양호 | 유지 | — |
| 18 | 의존성 | **undici HIGH (미사용 `cheerio` 경유)** | 상 | 자동수정 | HIGH 존재 | cheerio 제거 → undici 동반 제거 | `package.json`/`package-lock.json` |
| 19 | 의존성 | **xlsx HIGH (패치 없음, 개발 스크립트 전용)** | 상 | 자동수정 | dependencies 포함 | devDependencies 재분류(프로덕션 배제) | `package.json` |
| 20 | 의존성 | 잔여 취약점(next·postcss·dompurify·js-yaml·@babel/core moderate 등) | 중 | 코드밖 | 존재 | 정기 업데이트 계획 | — |
| 21 | 감사 로깅 | 데이터 변경(INSERT/UPDATE/DELETE) 전반 감사 부재 | 상 | 자동수정 | 없음 | `audit_log` 테이블+트리거 신설(SQL) | `audit_log_setup.sql` |
| 22 | 감사 로깅 | 파일 열람/다운로드 기록 | 중 | 자동수정 | 견적 PDF만(`download_logs`) | 서버 라우트 READ 로그 추가 | quote-pdf/device-image/profile-image |
| 23 | 인증·인가 | 비밀번호 정책 문구 불일치(UI 6자 vs API 8자) | 하 | 자동수정 | 불일치 | UI "8자"로 통일(API가 실제 강제) | `app/admin/page.tsx` |

---

## 3. 영역별 상세

### ① Secrets 관리 — 양호
- **점검**: `.gitignore` 내 `.env*` 확인, `git ls-files`/`git log`로 env 추적·커밋 이력 확인, `SUPABASE_SERVICE_ROLE_KEY` 참조 위치 grep, `NEXT_PUBLIC_` 접두사 목록 확인, 루트 스크립트 하드코딩 여부 확인.
- **발견**: `.env.local` git 미추적·커밋 이력 없음. service_role 키는 `app/api/*/route.ts`에서만 `process.env`로 참조(클라이언트 번들 미포함). `NEXT_PUBLIC_`은 SUPABASE_URL/ANON_KEY/KAKAO_JS_KEY 3종(공개용). 루트 스크립트(`geocode_update.js`, `upload_price_list.js`)도 env 사용(하드코딩 없음).
- **조치**: 없음(양호).
- **검증**: `git ls-files | grep env` → 없음.

### ② RLS
- **점검**: 코드에서 RLS 위반 오류 로그 및 정책 관련 SQL 확인.
- **발견**: `teams` 테이블은 RLS **활성**이나 INSERT 정책이 없어 "new row violates row-level security policy for table \"teams\"" 발생. 그 외 테이블의 RLS 상태·정책 원문은 코드로 확인 불가.
- **조치**: `teams_rls_policy.sql`(select/insert/update/delete 허용) 제공. `audit_log`용 RLS(superadmin 조회 전용)는 `audit_log_setup.sql`에 포함.
- **검증**: 정책 적용은 대시보드 확인 필요(코드밖).

### ③ 인증·인가
- **점검**: `middleware.ts`와 11개 API 라우트의 `getUser()`·`permission_level` 체크 grep.
- **발견**: middleware가 전 페이지 세션검증 후 `/api/*`는 통과. API 중 권한필요 9개는 자체 검증 존재. **`/api/quote-pdf`만 인증이 전무**하여 재무문서 signed URL을 비로그인 발급 가능(경로도 `/` 허용).
- **조치(자동수정)**: quote-pdf에 `createServerClient().auth.getUser()` 401 + `pdf_url` DB 확인 + 경로 `/` 거부 추가.
- **검증**: `npx tsc --noEmit` 통과. 기존 정상 라우트(device-image)와 동일 패턴.

### ④ API / Server Action
- **점검**: 각 라우트 인증·입력검증·외부통신 옵션 확인.
- **발견**: create-user 8자 검증 등 입력검증 존재. `/api/exchange-rate` 무인증 + `rejectUnauthorized:false`. rate limiting 없음.
- **조치(자동수정)**: exchange-rate에 로그인 필수 + 요청 타임아웃(10s) 추가. 유일 호출부가 로그인된 `app/quote/page.tsx`라 기능 무영향. TLS 검증 우회는 정부(한국수출입은행) CA 부재로 유지(호스트 고정·문서화) — 완전 제거는 CA 주입 필요(코드밖).
- **검증**: `npx tsc --noEmit` 통과.

### ⑤ Storage
- **점검**: `.storage.from` 버킷 목록, 공개/서명 방식, 경로검증 확인.
- **발견**: 5개 버킷. quote-pdfs/profile-images/packing-lists/service-report는 signed URL(1h). `device-images`는 기본이미지 public URL 사용(공개 추정). 경로검증은 device/profile/quote 라우트에 존재.
- **조치**: quote-pdf 경로검증 강화(위 ③). device-images 공개 여부는 대시보드 확인 필요(코드밖).

### ⑥ 데이터 과다 노출
- **점검**: `select('*')` 사용처, API 에러 응답 형식 확인.
- **발견**: `select('*')` 다수(admin 7, customer 6 등). engineers `*` 조회 시 email·permission_level 등 포함. API 5곳에서 `error.message` 원문 반환.
- **조치(자동수정)**: 6개 라우트 에러 응답을 일반 메시지로 변경하고 실오류는 `console.error`로 서버 로깅. `select('*')`는 **비밀 컬럼 부재 + RLS 통제 + 쿼리 축소 시 기능 파손 위험**을 근거로 현행 유지(향후 DB 컬럼 권한 통제 권장).
- **검증**: `npx tsc --noEmit` 통과. 클라이언트는 여전히 에러 표시(동작 무변경).

### ⑦ 보안 헤더 / CORS
- **점검**: `next.config.ts` 응답 헤더, CORS 설정 grep.
- **발견**: CSP·HSTS·X-Frame-Options(DENY)·X-Content-Type-Options(nosniff)·Referrer-Policy·Permissions-Policy·X-XSS-Protection 7종 설정. CORS 커스텀 없음(same-origin).
- **조치**: 없음(양호). CSP의 `unsafe-eval`/`unsafe-inline` 및 로컬용 http 카카오 도메인은 운영 강화 여지(제안).

### ⑧ 의존성 취약점 (npm audit)
- **점검**: `npm audit`, 취약 패키지 의존 경로, 앱 번들 포함 여부 확인.
- **발견(조치 전)**: 총 7건(HIGH 2 = undici, xlsx / moderate 4 / low 1). undici는 **미사용** `cheerio` 경유. xlsx는 **앱 번들 미포함**(루트 스크립트 전용), 패치 없음.
- **조치(자동수정)**: `cheerio` 제거(undici 동반 제거) → HIGH 2→1. `xlsx`를 devDependencies로 재분류(프로덕션 의존성 트리에서 배제).
- **검증(조치 후)**: `npm audit` 총 6건(HIGH 1[xlsx, 개발전용]/moderate 4/low 1). `npm ls cheerio undici` → 둘 다 제거 확인. `npx tsc --noEmit` 통과.
- **잔여**: next·postcss·dompurify·js-yaml·@babel/core 등 moderate — 업데이트 시 파손 위험 있어 정기 검토 항목(코드밖).

### ⑨ 감사 로깅
- **점검**: 감사 관련 테이블/삽입 코드 확인.
- **발견**: `download_logs` 테이블이 존재하며 견적 PDF 열람/다운로드를 기록 중(`app/quote/page.tsx`, `app/sales/page.tsx`, `app/admin/page.tsx`). 그러나 **데이터 변경(INSERT/UPDATE/DELETE) 전반의 감사 기록은 부재**.
- **조치(자동수정)**:
  - `audit_log_setup.sql`: `audit_log` 테이블 + `audit_row_change()` 트리거(customers/quotes/quote_items/devices/contacts/service_history/engineers/teams). **fail-open**(적재 실패가 원 작업을 막지 않음), append-only(superadmin 조회 전용).
  - 서버 라우트(quote-pdf/device-image/profile-image)에 열람 시 `audit_log` READ 기록(try/catch로 응답 무영향).
- **검증**: `audit_log` 미생성 상태에서도 try/catch로 앱 정상 동작 확인(SQL 실행 전 무파손). SQL 실행 후 기록 적재.

---

## 4. 코드 밖 조치 필요 항목

| 항목 | 현황(확인된 사실) | 권장 보완책 |
|---|---|---|
| audit_log 활성화 | SQL 파일 제공, 미실행 | Supabase SQL Editor에서 `audit_log_setup.sql` 실행 |
| 전 테이블 RLS | teams 외 상태 미확인 | 대시보드에서 모든 테이블 RLS 활성 + UNRESTRICTED 0개 + 정책 원문 점검 |
| device-images 공개 | 공개 URL 사용(공개 추정) | 장비사진 민감도 판단 후 비공개+signed 전환 여부 결정 |
| 데이터 리전/국외이전 | Supabase 리전 미확인 | 데이터 소재지 확인, 일본 본사 정책상 리전 요건 검토 |
| 저장 암호화 | Supabase 플랫폼 기본값 미확인 | at-rest 암호화·키 관리 정책 확인 |
| 백업/복구 | 설정 미확인 | Supabase 자동백업/PITR·오프사이트 백업 확인 및 복구 테스트 |
| 환경변수 범위 | Vercel Production/Preview 분리 미확인 | service_role 등 민감 변수 Production 전용 설정 확인 |
| rate limiting | 없음 | Vercel/WAF 레벨 요청 제한(특히 로그인·PDF 라우트) |
| TLS 검증(환율) | 정부 CA 부재로 우회 유지 | 한국수출입은행 CA 인증서 주입으로 검증 복원 |
| 배포 파이프라인 | 세부 미확인 | 브랜치 보호·리뷰·시크릿 스캔(CI) 도입 |
| 1인 운영(버스 팩터) | 운영 인력 구조 미확인 | 관리자 계정 다중화, 문서화, 인수인계 체계 |

---

## 5. 잔여 리스크 및 향후 계획

### 5.1 수용/미조치 리스크
| 리스크 | 사유 | 대응 |
|---|---|---|
| `select('*')` 데이터 노출 | 비밀 컬럼 부재 + RLS 통제, 쿼리 축소 시 기능 파손 위험 | 필요 시 DB 컬럼 권한(GRANT/REVOKE)으로 통제 |
| 환율 API TLS 우회 | 정부 CA 미보유 | CA 주입 시 복원(코드밖) |
| xlsx HIGH(개발 전용) | 패치 없음, 프로덕션 미포함 | devDependencies 격리로 프로덕션 배제 유지, 대체(exceljs) 검토 |
| moderate 의존성 다수 | 즉시 업데이트 시 파손 위험 | 정기 업데이트 창구에서 검토 |
| RLS 전수 상태 미확인 | 대시보드 접근 필요 | 재점검 시 최우선 확인 |

### 5.2 재점검 주기 제안
- **분기 1회 정기 점검** + 주요 기능/의존성 변경 시 수시 점검
- 정기 점검 시 필수: `npm audit`, RLS 전수 확인, audit_log 적재 상태 검토, Storage 버킷 공개설정 재확인

---

## 부록. 본 점검으로 변경된 파일

- 코드 수정: `app/api/quote-pdf/route.ts`, `app/api/exchange-rate/route.ts`, `app/api/device-image/route.ts`, `app/api/profile-image/route.ts`, `app/api/delete-quote-pdf/route.ts`, `app/api/update-engineer/route.ts`, `app/admin/page.tsx`
- 의존성: `package.json`, `package-lock.json` (cheerio 제거, xlsx→devDependencies)
- 신규 SQL: `audit_log_setup.sql`, `teams_rls_policy.sql`(팀 RLS)
- 검증: `npx tsc --noEmit`(앱 소스 오류 없음), `npm audit`(HIGH 2→1)
