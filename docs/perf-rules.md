# 성능 규칙 — 앞으로 모든 화면 작업이 따른다

측정 기준선은 docs/perf-baseline.md 다. 아래는 그 결과로 정한 규칙이다.

## 1. 본인·세션은 묻지 말고 받는다

```tsx
const { engineer, perm, loading } = useMe()
```

- `auth.getUser()` · `engineers where email` · `loadTeamPerms()` 를 **화면·훅에서 직접 부르지 않는다.**
  앱 당 한 번 `lib/appData/MeProvider.tsx` 가 읽어 context 로 내려 준다.
- 갱신은 로그인·로그아웃·권한 변경 때뿐이다(`onAuthStateChange` + `refreshMe()`).
- 예외는 **서버 코드**(app/api/**, lib/approval/*, lib/*Server.ts)와 **로그인 화면**뿐이다 —
  세션이 아직 없거나 React context 가 없는 자리다.

## 2. 참조 데이터는 모듈 캐시 + 훅

행이 적고 거의 안 바뀌는 표는 **앱 당 한 번만** 읽는다. 틀은 lib/quoteCategories.ts 다
(`let cache: Promise<T> | null` → `loadX()` → `invalidateX()` → `useX()`).

| 표 | 모듈 | 훅 |
|---|---|---|
| quote_categories | lib/quoteCategories.ts | `useQuoteCategories()` |
| teams · team_permissions | lib/teamPerms.ts | (MeProvider 가 쓴다) |
| offices | lib/offices.ts | `loadOffices()` |
| engineers 전체 | lib/appData/engineers.ts | `useEngineers()` |

- 관리 화면에서 그 표를 고치면 **저장 직후 `invalidateX()`** 를 부른다. 안 부르면 다른 화면이
  이전 값을 계속 쓴다(캐시가 앱 수명 단위다).
- **customers 는 캐시하지 않는다**(1,627건). 검색형 조회로 두고, 같은 화면에서 두 번 읽지만 않는다.

## 3. 한 화면의 초기 조회는 동시에

```ts
const [a, b, c] = await Promise.all([qa(), qb(), qc()])
```

- `await` 를 줄줄이 잇지 않는다. 앞 조회의 **결과가 필요한 조회만** 뒤에 둔다.
- 카드·패널이 여럿이면 카드마다 따로 쏘되 **동시에** 시작한다
  (틀: hooks/dashboard/useDashboardCards.ts — 하나가 실패해도 그 카드만 「불러오지 못했습니다」).

## 4. 같은 자료를 두 곳에서 읽지 않는다

사이드바 배지와 화면 카드가 같은 것을 읽고 있으면 한쪽으로 모은다(또는 공통 층으로 올린다).
알림 폴링 주기(`useNotifications` 의 `pollMs`)는 **필요한 곳에서만** 짧게 둔다 —
배지는 10초가 필요하지 않다.

## 5. select('*') 는 쓰지 않는다

화면이 그리는 열만 적는다. 큰 표부터: `quotes` · `service_history` · `price_list` ·
`audit_log` · `customers` · `notifications` · `quote_items`.
열을 적어 두면 나중에 열이 늘어도 조회가 무거워지지 않는다.

## 6. 무거운 라이브러리는 쓰는 자리에서 동적 import

```ts
const XLSX = await import('xlsx')
```

- `xlsx` · `exceljs` · `@react-pdf/renderer` · 카카오맵 SDK.
- 타입만 쓰는 import 는 정적이어도 된다(`import type { … } from 'exceljs'`).
- `@react-pdf/renderer` 정적 import 4곳은 **치웠다**(2단계). 그림 부분을 파일로 떼어
  next/dynamic 으로 부르거나(components/quote/QuotePreviewCanvas.tsx), 누를 때 import() 한다
  (hooks/quote/useQuoteSubmit.tsx · hooks/customer/useServiceCrud.tsx). 글꼴 등록도 그때 한다
  (lib/pdf/reportFont.ts) — 모듈 수준 Font.register 한 줄이 1.4MB 를 첫 번들로 끌어왔다.
  **측정: /quote 첫 로드 2,483KB → 1,062KB.**

## 7. 번들 크기는 이렇게 잰다

개발 서버의 .next 와 섞이지 않게 따로 빌드한다(next.config.ts 의 distDir 이 NEXT_DIST_DIR 을 본다).

```
NEXT_DIST_DIR=.next-perf npx next build
```

미리 그려진(○) 라우트는 그 HTML 이 불러오는 script 를 더하면 첫 로드 JS 다
(.next-perf/server/app/<라우트>.html). 동적(ƒ) 라우트는 HTML 이 없으므로, 무거운 덩어리의
파일 이름이 그 라우트의 서버 산출물에 적혀 있는지로 본다.

빌드가 tsconfig.json 에 줄을 더하므로 측정 뒤 `git checkout tsconfig.json` 을 한다.
측정 폴더(.next-perf*/)는 .gitignore 에 있다 — 두고 있으면 lint 가 빌드 산출물까지 읽는다.
