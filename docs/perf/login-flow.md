# 로그인 흐름 실측 — 2026-10-23 11:52

모드 **start (next start)** · 주소 http://localhost:3100 · Chromium(playwright ^1.64.1)

모든 시간은 **「로그인」을 누른 순간을 0** 으로 한 ms 다. 회차마다 새 브라우저
컨텍스트를 쓰고(찬 캐시), 같은 컨텍스트에서 쿠키만 버려 한 번 더 잰다(더운 캐시 —
JS·문서는 받아 둔 상태로 세션만 없는 「두 번째 로그인」).

구간: ① auth 토큰 ② 리다이렉트 ③ 홈 문서·JS ④ 본인 확인 사슬(auth/user → engineers → teams)
⑤ 화면 카드 조회 ⑥ 첫 그림·껍데기·조용해짐.

### 찬 캐시(첫 방문) — 3/3회 성공

| 구간 | 시작 | 끝 | 걸린 시간 |
|---|---|---|---|
| ① auth 토큰 | 71ms | 275ms | 204ms |
| ④-a auth/user | — | — | — |
| ④-b engineers?email | 285ms | 453ms | 168ms |
| ④-c teams | 260ms | 433ms | 173ms |
| ④-d team_permissions | — | — | — |
| ④ 본인 확인 사슬 전체 | 260ms | 453ms | 193ms |
| ⑤ 첫 카드 조회 | 575ms | 717ms | 142ms |

| 지점 | 중간값 | 각 회차 |
|---|---|---|
| ② 주소가 바뀐 때 | 545ms | 1,096ms · 545ms · 509ms |
| ③ 문서 TTFB | — | — · — · — |
| ③ JS 다 받은 때 | 528ms | 1,071ms · 528ms · 492ms |
| ⑥ 첫 그림(FCP) | 68ms | 80ms · 68ms · 60ms |
| ⑥ 껍데기(사이드바) | 569ms | 1,139ms · 569ms · 537ms |
| ⑥ 네트워크 조용해짐 | 2,325ms | 3,008ms · 2,325ms · 2,282ms |

문서 사슬(1회차): 없음(소프트 이동) · 리다이렉트 0번

자료 요청 12건(카드 8건) · 새 JS 38KB · 첫 카드 조회는 `/api/approval`

대표 회차(조용해짐 2,325ms) 의 요청 순서 — 「대기」는 앞 요청이 끝난 뒤 이것이 시작할 때까지다.

| # | 요청 | 시작 | 끝 | 걸린 시간 | 대기 |
|---|---|---|---|---|---|
| 1 | `auth:token ?grant_type` | 71ms | 270ms | 199ms | 71ms |
| 2 | `teams` | 260ms | 433ms | 173ms | — |
| 3 | `engineers ?email` | 280ms | 453ms | 173ms | — |
| 4 | `/dashboard ?_rsc` | 418ms | 522ms | 104ms | — |
| 5 | `/api/approval` | 575ms | 717ms | 142ms | 53ms |
| 6 | `quotes ?engineer_id` | 606ms | 687ms | 81ms | — |
| 7 | `sales_opportunities ?engineer_id` | 607ms | 693ms | 86ms | — |
| 8 | `service_engineers ?engineer_id` | 608ms | 682ms | 74ms | — |
| 9 | `notifications ?engineer_id&limit&offset&order` | 610ms | 690ms | 80ms | — |
| 10 | `sales_targets ?engineer_id` | 612ms | 691ms | 79ms | — |
| 11 | `auth:.well-known/jwks.json` | 651ms | 729ms | 78ms | — |
| 12 | `sales_activities ?activity_date&activity_date&engineer_id` | 685ms | 777ms | 92ms | — |
| 13 | `notices ?ends_at&order&starts_at` | 695ms | 789ms | 94ms | — |

### 더운 캐시(두 번째 로그인) — 3/3회 성공

| 구간 | 시작 | 끝 | 걸린 시간 |
|---|---|---|---|
| ① auth 토큰 | 45ms | 202ms | 157ms |
| ④-a auth/user | — | — | — |
| ④-b engineers?email | 211ms | 348ms | 137ms |
| ④-c teams | 210ms | 286ms | 76ms |
| ④-d team_permissions | — | — | — |
| ④ 본인 확인 사슬 전체 | 210ms | 348ms | 138ms |
| ⑤ 첫 카드 조회 | 471ms | 612ms | 141ms |

| 지점 | 중간값 | 각 회차 |
|---|---|---|
| ② 주소가 바뀐 때 | 440ms | 508ms · 340ms · 440ms |
| ③ 문서 TTFB | — | — · — · — |
| ③ JS 다 받은 때 | 424ms | 489ms · 322ms · 424ms |
| ⑥ 첫 그림(FCP) | 48ms | 48ms · 44ms · 56ms |
| ⑥ 껍데기(사이드바) | 465ms | 534ms · 365ms · 465ms |
| ⑥ 네트워크 조용해짐 | 2,305ms | 2,505ms · 2,110ms · 2,305ms |

문서 사슬(1회차): 없음(소프트 이동) · 리다이렉트 0번

자료 요청 12건(카드 8건) · 새 JS -4KB · 첫 카드 조회는 `/api/approval`

대표 회차(조용해짐 2,305ms) 의 요청 순서 — 「대기」는 앞 요청이 끝난 뒤 이것이 시작할 때까지다.

| # | 요청 | 시작 | 끝 | 걸린 시간 | 대기 |
|---|---|---|---|---|---|
| 1 | `auth:token ?grant_type` | 48ms | 202ms | 154ms | 48ms |
| 2 | `teams` | 210ms | 286ms | 76ms | — |
| 3 | `engineers ?email` | 211ms | 348ms | 137ms | — |
| 4 | `/dashboard ?_rsc` | 353ms | 420ms | 67ms | — |
| 5 | `/api/approval` | 471ms | 612ms | 141ms | 51ms |
| 6 | `auth:.well-known/jwks.json` | 486ms | 487ms | 1ms | — |
| 7 | `notifications ?engineer_id&limit&offset&order` | 489ms | 552ms | 63ms | — |
| 8 | `quotes ?engineer_id` | 492ms | 566ms | 74ms | — |
| 9 | `sales_targets ?engineer_id` | 493ms | 553ms | 60ms | — |
| 10 | `sales_opportunities ?engineer_id` | 493ms | 552ms | 59ms | — |
| 11 | `service_engineers ?engineer_id` | 494ms | 622ms | 128ms | — |
| 12 | `notices ?ends_at&order&starts_at` | 494ms | 624ms | 130ms | — |
| 13 | `sales_activities ?activity_date&activity_date&engineer_id` | 625ms | 775ms | 150ms | — |
