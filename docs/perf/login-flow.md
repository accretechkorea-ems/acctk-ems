# 로그인 흐름 실측 — 2026-10-23 11:49

모드 **start (next start)** · 주소 http://localhost:3100 · Chromium(playwright ^1.64.1)

모든 시간은 **「로그인」을 누른 순간을 0** 으로 한 ms 다. 회차마다 새 브라우저
컨텍스트를 쓰고(찬 캐시), 같은 컨텍스트에서 쿠키만 버려 한 번 더 잰다(더운 캐시 —
JS·문서는 받아 둔 상태로 세션만 없는 「두 번째 로그인」).

구간: ① auth 토큰 ② 리다이렉트 ③ 홈 문서·JS ④ 본인 확인 사슬(auth/user → engineers → teams)
⑤ 화면 카드 조회 ⑥ 첫 그림·껍데기·조용해짐.

### 찬 캐시(첫 방문) — 3/3회 성공

| 구간 | 시작 | 끝 | 걸린 시간 |
|---|---|---|---|
| ① auth 토큰 | 80ms | 573ms | 493ms |
| ④-a auth/user | 1,177ms | 1,262ms | 85ms |
| ④-b engineers?email | 557ms | 756ms | 199ms |
| ④-c teams | 755ms | 946ms | 191ms |
| ④-d team_permissions | — | — | — |
| ④ 본인 확인 사슬 전체 | 557ms | 1,262ms | 705ms |
| ⑤ 첫 카드 조회 | 1,260ms | 1,360ms | 100ms |

| 지점 | 중간값 | 각 회차 |
|---|---|---|
| ② 주소가 바뀐 때 | 1,131ms | 2,472ms · 920ms · 1,131ms |
| ③ 문서 TTFB | — | — · — · — |
| ③ JS 다 받은 때 | 1,048ms | 2,342ms · 785ms · 1,048ms |
| ⑥ 첫 그림(FCP) | 56ms | 56ms · 60ms · 48ms |
| ⑥ 껍데기(사이드바) | 1,157ms | 2,513ms · 947ms · 1,157ms |
| ⑥ 네트워크 조용해짐 | 3,228ms | 5,257ms · 2,883ms · 3,228ms |

문서 사슬(1회차): 없음(소프트 이동) · 리다이렉트 0번

자료 요청 14건(카드 9건) · 새 JS 38KB · 첫 카드 조회는 `notices ?ends_at&order&starts_at`

대표 회차(조용해짐 3,228ms) 의 요청 순서 — 「대기」는 앞 요청이 끝난 뒤 이것이 시작할 때까지다.

| # | 요청 | 시작 | 끝 | 걸린 시간 | 대기 |
|---|---|---|---|---|---|
| 1 | `auth:token ?grant_type` | 80ms | 573ms | 493ms | 80ms |
| 2 | `engineers ?email` | 557ms | 756ms | 199ms | — |
| 3 | `teams` | 755ms | 946ms | 191ms | — |
| 4 | `/dashboard ?_rsc` | 935ms | 1,041ms | 106ms | — |
| 5 | `/dashboard ?_rsc` | 1,045ms | 1,111ms | 66ms | — |
| 6 | `auth:user` | 1,177ms | 1,262ms | 85ms | 66ms |
| 7 | `auth:.well-known/jwks.json` | 1,188ms | 1,249ms | 61ms | — |
| 8 | `notices ?ends_at&order&starts_at` | 1,260ms | 1,360ms | 100ms | — |
| 9 | `engineers ?email` | 1,261ms | 1,363ms | 102ms | — |
| 10 | `/api/approval` | 1,369ms | 1,628ms | 259ms | — |
| 11 | `quotes ?engineer_id` | 1,392ms | 1,486ms | 94ms | — |
| 12 | `sales_opportunities ?engineer_id` | 1,393ms | 1,565ms | 172ms | — |
| 13 | `service_engineers ?engineer_id` | 1,395ms | 1,499ms | 104ms | — |
| 14 | `notifications ?engineer_id&limit&offset&order` | 1,397ms | 1,573ms | 176ms | — |
| 15 | `sales_targets ?engineer_id` | 1,397ms | 1,479ms | 82ms | — |
| 16 | `sales_activities ?activity_date&activity_date&engineer_id` | 1,501ms | 1,599ms | 98ms | — |

### 더운 캐시(두 번째 로그인) — 3/3회 성공

| 구간 | 시작 | 끝 | 걸린 시간 |
|---|---|---|---|
| ① auth 토큰 | 40ms | 289ms | 249ms |
| ④-a auth/user | 918ms | 1,011ms | 93ms |
| ④-b engineers?email | 293ms | 443ms | 150ms |
| ④-c teams | 445ms | 650ms | 205ms |
| ④-d team_permissions | — | — | — |
| ④ 본인 확인 사슬 전체 | 293ms | 1,011ms | 718ms |
| ⑤ 첫 카드 조회 | 1,012ms | 1,160ms | 148ms |

| 지점 | 중간값 | 각 회차 |
|---|---|---|
| ② 주소가 바뀐 때 | 877ms | 877ms · 1,227ms · 696ms |
| ③ 문서 TTFB | — | — · — · — |
| ③ JS 다 받은 때 | 766ms | 766ms · 1,016ms · 545ms |
| ⑥ 첫 그림(FCP) | 56ms | 56ms · 56ms · 56ms |
| ⑥ 껍데기(사이드바) | 914ms | 914ms · 1,255ms · 722ms |
| ⑥ 네트워크 조용해짐 | 2,983ms | 2,983ms · 3,962ms · 2,692ms |

문서 사슬(1회차): 없음(소프트 이동) · 리다이렉트 0번

자료 요청 14건(카드 9건) · 새 JS -4KB · 첫 카드 조회는 `notices ?ends_at&order&starts_at`

대표 회차(조용해짐 2,983ms) 의 요청 순서 — 「대기」는 앞 요청이 끝난 뒤 이것이 시작할 때까지다.

| # | 요청 | 시작 | 끝 | 걸린 시간 | 대기 |
|---|---|---|---|---|---|
| 1 | `auth:token ?grant_type` | 41ms | 342ms | 301ms | 41ms |
| 2 | `engineers ?email` | 349ms | 443ms | 94ms | — |
| 3 | `teams` | 445ms | 650ms | 205ms | — |
| 4 | `/dashboard ?_rsc` | 655ms | 757ms | 102ms | — |
| 5 | `/dashboard ?_rsc` | 766ms | 857ms | 91ms | — |
| 6 | `auth:.well-known/jwks.json` | 916ms | 917ms | 1ms | 59ms |
| 7 | `auth:user` | 918ms | 1,011ms | 93ms | — |
| 8 | `notices ?ends_at&order&starts_at` | 1,012ms | 1,160ms | 148ms | — |
| 9 | `engineers ?email` | 1,013ms | 1,160ms | 147ms | — |
| 10 | `/api/approval` | 1,173ms | 1,472ms | 299ms | — |
| 11 | `notifications ?engineer_id&limit&offset&order` | 1,179ms | 1,381ms | 202ms | — |
| 12 | `quotes ?engineer_id` | 1,179ms | 1,365ms | 186ms | — |
| 13 | `sales_targets ?engineer_id` | 1,180ms | 1,365ms | 185ms | — |
| 14 | `sales_opportunities ?engineer_id` | 1,181ms | 1,367ms | 186ms | — |
| 15 | `service_engineers ?engineer_id` | 1,182ms | 1,367ms | 185ms | — |
| 16 | `sales_activities ?activity_date&activity_date&engineer_id` | 1,371ms | 1,469ms | 98ms | — |
