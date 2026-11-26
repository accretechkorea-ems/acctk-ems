# 코드에 박힌 값 — 전수 (2026-11-27 야간3 7-1)

**코드는 한 줄도 고치지 않았다.** 어디에 무엇이 박혀 있고, 웹 설정으로 빼려면 얼마나
드는지를 적는다. 2026-11-25 조사(`docs/night-20261125.md`)와 합치고 **빠진 것을 더 찾는
것**이 목적이라, 그때 이미 적힌 것은 「11-25」로 표시하고 새로 찾은 것은 ✚ 로 적는다.

난이도 — **하** 표 하나 만들고 읽는 자리 한둘을 바꾸면 된다 · **중** 읽는 자리가 여럿이거나
캐시·폴백을 함께 손봐야 한다 · **상** 값이 바뀌면 지난 자료의 뜻이 달라진다(마이그레이션이 필요).

---

## 1. 견적서에 찍히는 회사 정보 ✚

견적서 PDF 머리 오른쪽 블록. **고객에게 그대로 나가는 글자**인데 코드 안에 있다.

| 값 | 파일:줄 | 쓰임 | 난이도 |
|---|---|---|---|
| `화성시 동탄대로 24길 31-8` | [app/quote/QuotePDFDoc.tsx:763](app/quote/QuotePDFDoc.tsx#L763) | 견적서 머리 주소 | 하 |
| `Accretech Korea Co., Ltd.` | [app/quote/QuotePDFDoc.tsx:764](app/quote/QuotePDFDoc.tsx#L764) | 영문 상호 | 하 |
| `대표이사 이상철` | [app/quote/QuotePDFDoc.tsx:765](app/quote/QuotePDFDoc.tsx#L765) | 대표자 | 하 |
| `대표전화 031)786-4093` | [app/quote/QuotePDFDoc.tsx:766](app/quote/QuotePDFDoc.tsx#L766) | 대표번호 | 하 |
| `/pdflogo.png` | [app/quote/QuotePDFDoc.tsx:762](app/quote/QuotePDFDoc.tsx#L762) | 로고 이미지 경로 | 중(파일 업로드 자리가 필요) |

> **계좌·사업자등록번호는 코드에 없다.** 명함 OCR 쪽에 「계좌번호·사업자등록번호는 어떤
> 칸에도 넣지 않는다」는 **지시문**이 있을 뿐이다([lib/cardOcrServer.ts:107](lib/cardOcrServer.ts#L107)).
> 견적서에 계좌를 찍어야 한다면 지금은 넣을 자리가 없다 — **판단 필요**.

**빼는 법(제안)** — `company_profile` 한 줄짜리 표(또는 `app_settings` key/value)를 만들고
PDF 가 서버에서 그 값을 받아 그린다. 지난 PDF 는 이미 파일로 굳어 있어 영향이 없다.

## 2. 메일 — 보내는 이·제목·본문 ✚ / 11-25

| 값 | 파일:줄 | 쓰임 | 난이도 |
|---|---|---|---|
| `아크레텍코리아 EMS <acctk-ems@accretechkorea.com>` | [lib/leadMail.ts:22](lib/leadMail.ts#L22) | Resend 보내는 이 | 하 |
| `아크레텍코리아 계측사업부 리드 신규등록 알림 (…)` | [lib/leadMail.ts:136](lib/leadMail.ts#L136) | 제목 | 하 |
| `신규 리드가 등록되었습니다 — 아크레텍코리아 계측사업부` | [lib/leadMail.ts:192](lib/leadMail.ts#L192) | 미리보기 글 | 하 |
| 서명 줄 `아크레텍코리아 계측사업부` | [lib/leadMail.ts:168](lib/leadMail.ts#L168) · [316](lib/leadMail.ts#L316) | 본문 꼬리 | 하 |
| 메일 본문 HTML 전체(색·여백 포함) | lib/leadMail.ts 전체 | 리드 알림 두 종 | 중 |

메일 문구를 쓰는 자리는 **162곳**이 걸렸는데 대부분 화면 안내문이다. 실제로 **밖으로 나가는**
메일은 리드 알림 둘뿐이다(lib/leadMail.ts). 결재·공지는 앱 안 알림이다.

**빼는 법** — 보내는 이와 서명은 설정 한 줄로 빼기 쉽다(하). 본문 HTML 을 템플릿으로 빼는 것은
중 — 지금 구조가 함수 안 문자열이라 자리 표시자 규칙을 먼저 정해야 한다.

## 3. 사업부·팀 이름 11-25

| 값 | 파일:줄 | 쓰임 | 난이도 |
|---|---|---|---|
| `'계측' · '반도체'` (사업부) | [lib/division.ts](lib/division.ts) · [app/api/business-card/route.ts:124](app/api/business-card/route.ts#L124) 외 **40곳** | 명함·접촉보고서·메뉴 가르기 | **상** |
| 팀 이름 `80CS · 80영업 · 20수리 · 20영업` | `teams` 표가 정본 — 화면은 표에서 읽는다 | 실적·권한 | 하(이미 표다) |

사업부는 **표가 아니라 코드의 유니온 타입**이다. 값이 바뀌면 지난 명함·접촉보고서의
`division` 글자가 뜻을 잃는다 → 마이그레이션이 필요하다(상).

## 4. 영업활동 종류 — **이미 표다** 11-25

`public.activity_types` 가 정본이다([lib/activityTypes.ts](lib/activityTypes.ts)).
코드에 남은 14곳은 **색표**(lib/categoryColors.ts)와 **서비스 유형 7종**뿐이다.

| 값 | 파일:줄 | 쓰임 | 난이도 |
|---|---|---|---|
| 서비스 유형 7종(`신규설치·이전설치·장비교정·A/S·B/S·교육·유선기술지원`) | [components/activity/ActivityCard.tsx:11](components/activity/ActivityCard.tsx#L11) + **23곳** | 활동 집계·색·동선 | 중 |
| 활동 종류별 색 | [lib/categoryColors.ts](lib/categoryColors.ts) | 점·배지 | 하 |

**서비스 유형은 아직 코드다** — 영업 종류만 표로 옮겼다(2026-11-18). 같은 길로 옮길 수 있다(중).

## 5. 견적 상태값 ✚

| 값 | 파일:줄 | 쓰임 | 난이도 |
|---|---|---|---|
| `견적중·결재중·보류·발주(주문 대기)·주문완료·세금계산서 요청·매출완료·실패·구매취소` | [lib/quoteStatus.ts](lib/quoteStatus.ts) 외 **105곳** | 집계·필터·자동 전이 | **상** |

DB 의 `quotes.status` 가 **글자**라 값이 곧 자료다. 바꾸려면 지난 줄을 전부 옮겨야 한다.
→ 웹 설정으로 빼는 것은 권하지 않는다. **이름만** 바꿀 수 있게 하려면 표를 하나 두고
코드는 코드값을, 화면은 이름을 쓰게 갈라야 한다(그 일 자체가 상이다).

## 6. 포캐스트 단계명 ✚

| 값 | 파일:줄 | 쓰임 | 난이도 |
|---|---|---|---|
| `상담·사양검토·견적제출·협상·수주·실주` | [components/customer/opportunity.ts](components/customer/opportunity.ts) 의 `STAGES` 외 **55곳** | 칸반 열·집계 | **상** |

`sales_opportunities.stage` 가 글자다. 견적 상태와 같은 사정이다.
다만 **열의 차례와 이름만** 바꾸는 것은 중 — `STAGES` 한 배열이 차례의 정본이다.

## 7. 실주 사유 — **이미 표다** 11-25

`public.lost_reasons` 가 정본이다(db/lost_reasons_20261126.sql). 코드에 남은 61곳은
판정 함수와 화면이 그 표를 읽는 자리다. **옛 글자 칸**(`quotes.lost_reason`)이 함께 남아
있어 한동안 둘을 다 본다([lib/lostReason.ts](lib/lostReason.ts)).

## 8. 바깥 서비스 — 키·주소 ✚

| 값 | 파일:줄 | 쓰임 | 난이도 |
|---|---|---|---|
| 한국수출입은행 환율 API | [lib/exchangeRate.ts:14](lib/exchangeRate.ts#L14) · [app/api/exchange-rate/route.ts](app/api/exchange-rate/route.ts) | 외화 견적 | 하(키는 env) |
| Kakao Maps 키·도메인 | [lib/loadKakaoMap.ts](lib/loadKakaoMap.ts) · [lib/geocode.ts](lib/geocode.ts) · next.config.ts 의 CSP | 지도·주소 검색 | 중(CSP 와 한 벌) |
| Resend | [lib/leadMail.ts](lib/leadMail.ts) | 리드 알림 메일 | 하(키는 env) |
| Anthropic(명함 OCR) | [lib/cardOcrServer.ts](lib/cardOcrServer.ts) | 명함 읽기 | 하(키는 env) |

**키 자체는 전부 env 다** — 코드에 박힌 것은 **호스트 이름과 CSP 목록**이다.
도메인이 늘면 `next.config.ts` 의 CSP 도 함께 고쳐야 한다(그 사실이 `scripts/csp-check.js` 에 박혀 있다).

## 9. 목표 금액 — **이미 표다** 11-25

`sales_targets` 가 정본이다. 코드의 44곳은 그 표를 읽어 ÷12·÷4 하는 자리다
([lib/salesStats.ts](lib/salesStats.ts) 의 `periodTarget`).

## 10. 그 밖에 새로 찾은 것 ✚

| 값 | 파일:줄 | 쓰임 | 난이도 |
|---|---|---|---|
| 견적 유효기간 **1개월** | [lib/quoteStatus.ts](lib/quoteStatus.ts) 의 `quoteExpiry` | 자동 실주·할 일 줄 | 하 |
| 만료 임박 **7일** | [lib/tasks.ts](lib/tasks.ts) 의 `EXPIRY_SOON_DAYS` | 홈 할 일 | 하 |
| 멎은 포캐스트 **14일** | [lib/forecastBoard.ts](lib/forecastBoard.ts) 의 `IDLE_DIM_DAYS` | 칸반 빨간 글자 | 하 |
| 홀딩 오래됨 **30일** | [app/holdings/page.tsx:20](app/holdings/page.tsx#L20) | 홀딩 현황 | 하 |
| 의뢰서 오래됨 **7일** | [app/inquiries/page.tsx:215](app/inquiries/page.tsx#L215) | 의뢰서 흐림 | 하 |
| 고객사 오래됨 **90일** | [lib/customerList.ts:40](lib/customerList.ts#L40) | 「정리 필요」 | 하 |
| 한 쪽 줄 수 **50** | [lib/pager.ts](lib/pager.ts) 의 `PAGE_SIZE` | 발주 목록 | 하 |
| 회계연도 시작 **4월** | [lib/salesStats.ts](lib/salesStats.ts) 의 `fiscalYearOf` | 모든 집계 | **상** |
| 임시 비밀번호 길이 **10** · 글자 58종 | [lib/tempPassword.ts](lib/tempPassword.ts) | 비밀번호 초기화 | 하 |
| 무활동 로그아웃 시간 | [components/common/SessionManager.tsx](components/common/SessionManager.tsx) | 자동 로그아웃 | 하 |

「날 수」 들이 **일곱 곳에 흩어져** 있다. 전부 「하」지만, 한 곳(`app_settings`)으로 모으면
그 일곱이 한 화면에서 바뀐다 — 먼저 뺄 만한 묶음이다.

---

## 먼저 뺄 것 (제안 차례)

1. **견적서 회사 정보 다섯**(1) — 고객에게 나가는 글자인데 배포해야 바뀐다. 난이도 하.
2. **날 수 일곱**(10) — 한 표로 모으면 운영이 직접 조절한다. 난이도 하.
3. **메일 보내는 이·서명**(2) — 하.
4. **서비스 유형 7종**(4) — 영업 종류가 이미 간 길을 그대로 따라가면 된다. 중.
5. 상태값·단계명·사업부(5·6·3) — **자료의 뜻이 바뀐다.** 지금 건드리지 않는 쪽을 권한다.
