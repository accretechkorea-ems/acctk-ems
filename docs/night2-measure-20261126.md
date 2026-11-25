# 밤 작업 2부 실측 — 읽기 전용 (2026-11-26)

`node scripts/night2-measure.js` · 운영 빌드(next start, :3100) · Playwright chromium.
줄을 만들지 않았다(주소 이동과 창 열기·ESC 만). 그래서 뒷정리도 없다.

## PC 1440×900

| 화면 | 열림 | 가로 넘침 | 콘솔 오류 | 캡처 |
|---|---|---|---|---|
| 홈 「내 오늘」 | 1771ms | 0 | **4** | `dashboard-pc.png` |
| 포캐스트 칸반 | 1712ms | 0 | **1** | `pipeline-pc.png` |
| 발주 목록 | 1764ms | 0 | **1** | `purchase-pc.png` |
| 실적 현황 | 1695ms | 0 | **2** | `sales-pc.png` |
| 활동 현황 | 1677ms | 0 | **1** | `activity-pc.png` |
| 고객사 | 1683ms | 0 | **2** | `customers-pc.png` |
| 리드 | 1659ms | 0 | **1** | `leads-pc.png` |
| 견적서 | 1735ms | 0 | **3** | `quote-pc.png` |
| 의뢰서 | 1677ms | 0 | **1** | `inquiries-pc.png` |
| 쇼룸 | 1697ms | 0 | **1** | `showroom-pc.png` |
| 관리 | 1693ms | 0 | **1** | `admin-pc.png` |
| 건의사항 | 1654ms | 0 | **1** | `suggestions-pc.png` |

## 폰 390×844

| 화면 | 열림 | 가로 넘침 | 콘솔 오류 | 캡처 |
|---|---|---|---|---|
| 홈 「내 오늘」 | 1716ms | 0 | **4** | `dashboard-phone.png` |
| 포캐스트 칸반 | 1570ms | 0 | **1** | `pipeline-phone.png` |
| 발주 목록 | 1544ms | 0 | **1** | `purchase-phone.png` |
| 실적 현황 | 1615ms | 0 | **2** | `sales-phone.png` |
| 활동 현황 | 1539ms | 0 | **1** | `activity-phone.png` |
| 고객사 | 1550ms | 0 | **1** | `customers-phone.png` |
| 리드 | 1563ms | 0 | **1** | `leads-phone.png` |
| 견적서 | 1559ms | 0 | **3** | `quote-phone.png` |
| 의뢰서 | 1582ms | **257px** | **1** | `inquiries-phone.png` |
| 쇼룸 | 1567ms | 0 | **1** | `showroom-phone.png` |
| 관리 | 1550ms | 0 | **1** | `admin-phone.png` |
| 건의사항 | 1558ms | 0 | **1** | `suggestions-phone.png` |

## 걸린 것

### 홈 「내 오늘」 (pc)
- 콘솔: `Error: Minified React error #418; visit https://react.dev/errors/418?args[]=text&args[]= for the full message or use the non-minified dev environment for full e`
- 콘솔: `Failed to load resource: the server responded with a status of 400 ()`
- 콘솔: `Failed to load resource: the server responded with a status of 400 ()`
- 콘솔: `Failed to load resource: the server responded with a status of 503 (Service Unavailable)`

### 포캐스트 칸반 (pc)
- 콘솔: `Error: Minified React error #418; visit https://react.dev/errors/418?args[]=text&args[]= for the full message or use the non-minified dev environment for full e`

### 발주 목록 (pc)
- 콘솔: `Error: Minified React error #418; visit https://react.dev/errors/418?args[]=text&args[]= for the full message or use the non-minified dev environment for full e`

### 실적 현황 (pc)
- 콘솔: `Error: Minified React error #418; visit https://react.dev/errors/418?args[]=text&args[]= for the full message or use the non-minified dev environment for full e`
- 콘솔: `Failed to load resource: the server responded with a status of 403 (Forbidden)`

### 활동 현황 (pc)
- 콘솔: `Error: Minified React error #418; visit https://react.dev/errors/418?args[]=text&args[]= for the full message or use the non-minified dev environment for full e`

### 고객사 (pc)
- 콘솔: `Error: Minified React error #418; visit https://react.dev/errors/418?args[]=text&args[]= for the full message or use the non-minified dev environment for full e`
- 콘솔: `Error: 카카오 지도 SDK 로드 실패`

### 리드 (pc)
- 콘솔: `Error: Minified React error #418; visit https://react.dev/errors/418?args[]=text&args[]= for the full message or use the non-minified dev environment for full e`

### 견적서 (pc)
- 콘솔: `Error: Minified React error #418; visit https://react.dev/errors/418?args[]=text&args[]= for the full message or use the non-minified dev environment for full e`
- 콘솔: `Connecting to 'data:application/octet-stream;base64,AGFzbQEAAAABugM3YAF/AGACf38AYAF/AX9gA39/fwBgAn98AGACf38Bf2ADf39/AX9gBH9/f30BfWADf398AGAAAGAEf39/fwBgAX8BfGAC`
- 콘솔: `Fetch API cannot load data:application/octet-stream;base64,AGFzbQEAAAABugM3YAF/AGACf38AYAF/AX9gA39/fwBgAn98AGACf38Bf2ADf39/AX9gBH9/f30BfWADf398AGAAAGAEf39/fwBgA`

### 의뢰서 (pc)
- 콘솔: `Error: Minified React error #418; visit https://react.dev/errors/418?args[]=text&args[]= for the full message or use the non-minified dev environment for full e`

### 쇼룸 (pc)
- 콘솔: `Error: Minified React error #418; visit https://react.dev/errors/418?args[]=text&args[]= for the full message or use the non-minified dev environment for full e`

### 관리 (pc)
- 콘솔: `Error: Minified React error #418; visit https://react.dev/errors/418?args[]=text&args[]= for the full message or use the non-minified dev environment for full e`

### 건의사항 (pc)
- 콘솔: `Error: Minified React error #418; visit https://react.dev/errors/418?args[]=text&args[]= for the full message or use the non-minified dev environment for full e`

### 홈 「내 오늘」 (phone)
- 콘솔: `Error: Minified React error #418; visit https://react.dev/errors/418?args[]=text&args[]= for the full message or use the non-minified dev environment for full e`
- 콘솔: `Failed to load resource: the server responded with a status of 400 ()`
- 콘솔: `Failed to load resource: the server responded with a status of 400 ()`
- 콘솔: `Failed to load resource: the server responded with a status of 503 (Service Unavailable)`

### 포캐스트 칸반 (phone)
- 콘솔: `Error: Minified React error #418; visit https://react.dev/errors/418?args[]=text&args[]= for the full message or use the non-minified dev environment for full e`

### 발주 목록 (phone)
- 콘솔: `Error: Minified React error #418; visit https://react.dev/errors/418?args[]=text&args[]= for the full message or use the non-minified dev environment for full e`

### 실적 현황 (phone)
- 콘솔: `Error: Minified React error #418; visit https://react.dev/errors/418?args[]=text&args[]= for the full message or use the non-minified dev environment for full e`
- 콘솔: `Failed to load resource: the server responded with a status of 403 (Forbidden)`

### 활동 현황 (phone)
- 콘솔: `Error: Minified React error #418; visit https://react.dev/errors/418?args[]=text&args[]= for the full message or use the non-minified dev environment for full e`

### 고객사 (phone)
- 콘솔: `Error: Minified React error #418; visit https://react.dev/errors/418?args[]=text&args[]= for the full message or use the non-minified dev environment for full e`

### 리드 (phone)
- 콘솔: `Error: Minified React error #418; visit https://react.dev/errors/418?args[]=text&args[]= for the full message or use the non-minified dev environment for full e`

### 견적서 (phone)
- 콘솔: `Error: Minified React error #418; visit https://react.dev/errors/418?args[]=text&args[]= for the full message or use the non-minified dev environment for full e`
- 콘솔: `Connecting to 'data:application/octet-stream;base64,AGFzbQEAAAABugM3YAF/AGACf38AYAF/AX9gA39/fwBgAn98AGACf38Bf2ADf39/AX9gBH9/f30BfWADf398AGAAAGAEf39/fwBgAX8BfGAC`
- 콘솔: `Fetch API cannot load data:application/octet-stream;base64,AGFzbQEAAAABugM3YAF/AGACf38AYAF/AX9gA39/fwBgAn98AGACf38Bf2ADf39/AX9gBH9/f30BfWADf398AGAAAGAEf39/fwBgA`

### 의뢰서 (phone)
- 가로 넘침 **257px** — 넓은 것: div.iq-main=619 · div.=619 · div.iq-cards=619 · div.=619 · div.=619
- 콘솔: `Error: Minified React error #418; visit https://react.dev/errors/418?args[]=text&args[]= for the full message or use the non-minified dev environment for full e`

### 쇼룸 (phone)
- 콘솔: `Error: Minified React error #418; visit https://react.dev/errors/418?args[]=text&args[]= for the full message or use the non-minified dev environment for full e`

### 관리 (phone)
- 콘솔: `Error: Minified React error #418; visit https://react.dev/errors/418?args[]=text&args[]= for the full message or use the non-minified dev environment for full e`

### 건의사항 (phone)
- 콘솔: `Error: Minified React error #418; visit https://react.dev/errors/418?args[]=text&args[]= for the full message or use the non-minified dev environment for full e`

