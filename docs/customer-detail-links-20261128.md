# 고객사 상세 링크 전수 조사 (2026-11-28, 야간4 7-1)

단독 상세 페이지 `app/customer/[id]/page.tsx` 를 **지웠다**. 같은 사업장을 보는 화면이
둘이었기 때문이다 — 하나는 좌 트리가 있고(분할 보기), 하나는 없다(단독 페이지).
어느 길로 들어왔는지에 따라 옆 사업장으로 옮겨 갈 수 있기도 없기도 했고, 「돌아가기」가
어디로 가는지도 달랐다.

주소는 **301** 로 받는다 — `next.config.ts` 의
`{ source: '/customer/:id', destination: '/?view=list&site=:id', statusCode: 301 }`.
`?contact=` 같은 쿼리는 Next 가 그대로 넘긴다.

## 고친 링크 전부

주소를 만드는 규칙은 **`lib/mapPopup.ts` 한 곳**이다 — `siteListHref` · `siteHref` ·
`companyHref`. 손으로 적은 `/customer/${id}` 는 한 곳도 남아 있지 않다.

| # | 파일:줄 | 어디서 | 전 | 후 |
|---|---|---|---|---|
| 1 | [components/home/MapView.tsx:187](components/home/MapView.tsx#L187) | 지도 핀 팝업 「사업장 상세」 | `/customer/{id}` | `siteHref(c, 'map')` → `/?view=list&company=…&site=…&origin=map` |
| 2 | [components/home/MapView.tsx:112](components/home/MapView.tsx#L112) | 지도 핀 팝업 「회사 보기」 | (없었다) | `companyHref(c, 'map')` |
| 3 | [components/home/CustomerCard.tsx:163](components/home/CustomerCard.tsx#L163) | 좌측 업체 카드 「사업장 상세 ›」 | `/customer/{id}` | `siteHref(customer)` |
| 4 | [components/home/CustomerCard.tsx:41](components/home/CustomerCard.tsx#L41) | 좌측 업체 카드 제목의 회사명 | (없었다) | `companyHref(customer)` |
| 5 | [components/dashboard/TodayCards.tsx:55](components/dashboard/TodayCards.tsx#L55) | 홈 「오늘 할 일」의 고객사 줄 | `/customer/{refId}` | `siteListHref(it.refId)` |
| 6 | [components/quote/CustomerCard.tsx:571](components/quote/CustomerCard.tsx#L571) | 견적 작성 화면의 고객사 링크 | `/customer/{id}` | `siteListHref(id, '/quote')` |
| 7 | [lib/quoteMail.ts:88](lib/quoteMail.ts#L88) | 견적 저장 창 「담당자 정보에서 추가」 | `/customer/{id}?contact={c}` | `siteListHref(id)` + `&contact=` |
| 8 | [components/customer/CustomerDetailBody.tsx:296](components/customer/CustomerDetailBody.tsx#L296) | 회사 화면의 **묶인 사업장** 목록 | `/customer/{id}` | `siteListHref(c.customer_id)` |
| 9 | [components/customer/CompanyLink.tsx:29](components/customer/CompanyLink.tsx#L29) | 사업장 카드 제목의 회사명 | `/?view=list&company=…`(제 손으로 지음) | `companyHref(...)` 를 지난다 |

### 손대지 않은 것

| 파일:줄 | 무엇 | 왜 |
|---|---|---|
| [lib/menuPerms.ts:202](lib/menuPerms.ts#L202) · [:265](lib/menuPerms.ts#L265) | `'/customer/[id]'` → 권한 `customers` · 제목 「고객사」 | **라우트 표**다. 301 로 들어온 요청이 지나는 동안 그 두 값이 쓰인다 — 지우면 권한 판정과 화면 제목이 빈다. |
| [app/inquiries/[id]/page.tsx:79](app/inquiries/[id]/page.tsx#L79) · [components/customer/CompanyLink.tsx:10](components/customer/CompanyLink.tsx#L10) | 주석 속 경로 | 글자다. 「그 화면이 어떤 방식이었나」를 적은 자국이라 남긴다. |

## 들어온 곳(`?origin=`) — ← 가 돌아갈 자리

| 값 | 누가 싣나 | ← 를 누르면 |
|---|---|---|
| `map` | 지도 핀 팝업의 단추 둘 | 지도 보기로 — **보던 자리 그대로**(화면이 중심·배율을 기억한다) |
| `/quote` 같은 경로 | 견적 작성 화면의 고객사 링크 | 그 주소로 나간다 |
| (없음) | 그 밖 전부 | 왔던 화면(회사 pane)으로 — 종전 그대로 |

한 번 쓰면 비운다 — 두 번째 ←는 평소처럼 회사 pane 으로 올라간다.
`history.back()` 을 쓰지 않는 까닭: 301 로 들어온 옛 주소로 되튀어 돌 수 있다.

## 들어가면 트리가 하는 일 (7-2)

`?site=` 하나로 들어오면 목록 자료가 들어온 뒤
① 그 사업장의 **회사를 찾아 펴고**(`expanded`), ② **회사를 고르고**,
③ **그 사업장까지 연다**(`setSelectedSiteId`).
전에는 ③이 없어 회사 화면이 떴다 — 보려던 사업장은 871줄 가운데 하나로 남아 있었다.

고른 줄에는 `data-site-row="on"` 이 붙고, 화면이 그 줄을 **패널 가운데로** 데려온다
(`scrollIntoView({ block: 'center' })`). 파랗게 칠해 두어도 화면 밖에 있으면 칠한 뜻이 없다.
