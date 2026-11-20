# 색상 하드코딩 전수 조사 — 2026-11-21

> **보고만 한다. 코드는 바꾸지 않았다.** 다크모드로 갈 때 쓰는 자료다.
> 읽은 범위: `app` · `components` · `lib` · `hooks` · `scripts` 의 `.ts` · `.tsx` · `.css` · `.mjs`
> 파일 477개에서 색 표기 **3476건** · 서로 다른 값 **176가지**

## 한눈에

| 갈래 | 서로 다른 값 | 표기 건수 |
|---|---|---|
| 표에 있고 토큰은 없는 값 | 9 | 1191 |
| **토큰이 있는데** 직접 적은 값 | 24 | 1469 |
| 표에 **없는** 값(hex·rgb) | 140 | 599 |
| 이름 색(white·black…) | 3 | 217 |

## ① 토큰이 **이미 있는데** 직접 적은 값 — 가장 먼저 옮길 자리

| 값 | 토큰 | 건수 | 파일 |
|---|---|---|---|
| `#9ca3af` | `--color-text-muted` | 282 | app/account/page.tsx · app/activity/page.tsx · app/admin/page.tsx … (+98) |
| `#6b7280` | `--color-text-secondary` | 233 | app/admin/page.tsx · app/contact/semi/[projectId]/page.tsx · app/dashboard/80/page.tsx … (+89) |
| `#234ea2` | `--color-brand` | 214 | app/account/page.tsx · app/activity/page.tsx · app/admin/page.tsx … (+93) |
| `#ffffff` | `--color-surface` | 160 | app/account/page.tsx · app/activity/page.tsx · app/admin/page.tsx … (+76) |
| `#d1d5db` | `--color-border-strong` | 96 | app/admin/page.tsx · app/approval/doc/[id]/page.tsx · app/approval/page.tsx … (+39) |
| `#f8fafc` | `--color-bg-subtle` | 65 | app/admin/page.tsx · app/globals.css · app/inventory/page.tsx … (+14) |
| `#dc2626` | `--color-danger` | 60 | app/account/page.tsx · app/admin/page.tsx · app/contact/semi/[projectId]/write/page.tsx … (+29) |
| `#15803d` | `--color-success-strong` | 47 | app/globals.css · app/inventory/page.tsx · app/purchase/page.tsx … (+7) |
| `#eff4ff` | `--color-brand-tint` | 42 | app/globals.css · app/inventory/page.tsx · app/quote/page.tsx … (+20) |
| `#16a34a` | `--color-success` | 40 | app/admin/page.tsx · app/approval/doc/[id]/page.tsx · app/approval/page.tsx … (+23) |
| `#fef2f2` | `--color-danger-tint` | 36 | app/account/page.tsx · app/contact/semi/page.tsx · app/contact/semi/[projectId]/page.tsx … (+16) |
| `#c7d7f8` | `--color-brand-border` | 36 | app/contact/semi/[projectId]/write/page.tsx · app/dashboard/80/page.tsx · app/globals.css … (+21) |
| `#f0fdf4` | `--color-success-tint` | 24 | app/account/page.tsx · app/admin/page.tsx · app/globals.css … (+7) |
| `#f4f5f7` | `--color-bg` | 21 | app/account/page.tsx · app/admin/page.tsx · app/dashboard/80/page.tsx … (+11) |
| `#1c3e87` | `--color-brand-dark` | 21 | app/activity/page.tsx · app/globals.css · app/lead/page.tsx … (+18) |
| `#f59e0b` | `--color-warning-strong` | 16 | app/globals.css · components/customer/ActivityTimeline.tsx · components/customer/HeaderBand.tsx … (+10) |
| `#111113` | `--color-ink` | 15 | app/account/page.tsx · app/admin/page.tsx · app/globals.css … (+11) |
| `#bbf7d0` | `--color-success-border` | 12 | app/globals.css · app/inventory/page.tsx · app/purchase/page.tsx … (+4) |
| `#fecaca` | `--color-danger-border` | 11 | app/globals.css · app/inventory/page.tsx · app/sales/page.tsx … (+1) |
| `#fffbeb` | `--color-warning-tint` | 11 | app/globals.css · app/inventory/page.tsx · app/purchase/page.tsx … (+5) |
| `#d97706` | `--color-warning` | 9 | app/globals.css · app/inventory/page.tsx · app/purchase/page.tsx … (+5) |
| `#fde68a` | `--color-warning-border` | 7 | app/globals.css · app/inventory/page.tsx · app/purchase/page.tsx … (+3) |
| `#e2e4e9` | `--color-border` | 6 | app/account/page.tsx · app/globals.css · app/inventory/page.tsx … (+3) |
| `#f0f0f0` | `--color-border-subtle` | 5 | app/account/page.tsx · app/globals.css · app/login/page.tsx |

## ② 디자인 시스템 표에는 있는데 **토큰이 없는** 값

토큰(또는 상수)으로 바꿀 수 있는 자리다. 건수가 큰 것부터.

| 값 | 뜻 | 건수 | 파일 수 | 보기 |
|---|---|---|---|---|
| `#fff` | 표면(짧은 표기) | 383 | 81 | app/account/page.tsx · app/activity/page.tsx · app/admin/page.tsx … (+78) |
| `#ebebeb` | 테두리 | 251 | 98 | app/activity/page.tsx · app/contact/semi/page.tsx · app/dashboard/80/page.tsx … (+95) |
| `#111827` | 텍스트 진함 | 203 | 91 | app/activity/page.tsx · app/dashboard/80/page.tsx · app/dashboard/page.tsx … (+88) |
| `#f3f4f6` | 중립 배경 | 200 | 69 | app/admin/page.tsx · app/contact/semi/page.tsx · app/contact/semi/[projectId]/page.tsx … (+66) |
| `#fafafa` | 페이지 배경 | 53 | 33 | app/activity/page.tsx · app/dashboard/80/page.tsx · app/dashboard/page.tsx … (+30) |
| `#ef4444` | 위험·상태 이탈 | 39 | 33 | app/approval/doc/[id]/page.tsx · app/approval/page.tsx · app/contact/semi/page.tsx … (+30) |
| `#e5e7eb` | 스켈레톤 | 32 | 14 | app/activity/page.tsx · app/admin/page.tsx · app/inventory/page.tsx … (+11) |
| `#374151` | 텍스트 결과값 | 26 | 17 | app/quote/ProfitPanel.tsx · components/activity/RouteMapView.tsx · components/customer/ActivityTimeline.tsx … (+14) |
| `#fafbfc` | 지브라 띠 | 4 | 2 | app/quote/ProfitPanel.tsx · components/quote/RepairInfoPanel.tsx |

## ③ 표에 없는 값 — 140가지

다크모드에서 **하나하나 정해야 하는** 값들이다. 갈래를 함께 적었다.

| 값 | 건수 | 갈래 | 파일 |
|---|---|---|---|
| `rgba(0,0,0,0.22)` | 49 | 화면, 지도·마커, PDF(react-pdf·인쇄) | app/contact/semi/page.tsx · app/contact/semi/[projectId]/page.tsx · app/inquiries/page.tsx … (+41) |
| `#000` | 24 | PDF(react-pdf·인쇄), 화면 | app/quote/QuotePDFDoc.tsx · components/customer/ServiceReportDoc.tsx · components/pdf/docBase.ts … (+3) |
| `#be123c` | 22 | 화면, 색 정의 파일 | app/contact/semi/page.tsx · app/contact/semi/[projectId]/page.tsx · app/inquiries/page.tsx … (+8) |
| `#7c3aed` | 22 | 화면, 색 정의 파일 | app/purchase/page.tsx · app/repair/page.tsx · app/sales/page.tsx … (+3) |
| `rgba(0,0,0,0.5)` | 19 | 화면 | app/admin/page.tsx · app/quote/page.tsx · app/repair/page.tsx … (+7) |
| `rgba(0,0,0,0.2)` | 19 | 화면 | app/admin/page.tsx · app/repair/page.tsx · app/sales/page.tsx … (+1) |
| `#999` | 18 | 화면 | components/customer/ServiceReportDoc.tsx |
| `#f9fafb` | 16 | 화면, 색 정의 파일 | app/sales/page.tsx · components/customer/AgencyPicker.tsx · components/customer/constants.ts … (+6) |
| `rgba(0,0,0,0.08)` | 14 | 화면, 지도·마커 | app/pipeline/page.tsx · components/activity/RouteMapView.tsx · components/common/AutocompleteInput.tsx … (+8) |
| `rgba(0,0,0,0.6)` | 12 | 화면 | app/admin/page.tsx · app/sales/page.tsx · components/approval/DelegationModal.tsx … (+2) |
| `#c2410c` | 12 | 화면 | app/sales/page.tsx · components/home/list/AgencyPane.tsx · components/home/list/CompanyEditModal.tsx … (+2) |
| `#b45309` | 11 | 화면, 색 정의 파일 | app/purchase/page.tsx · app/repair/dashboard/page.tsx · app/sales/page.tsx … (+3) |
| `#f5f3ff` | 11 | 화면, 색 정의 파일 | app/repair/page.tsx · app/sales/page.tsx · components/dashboard/MyQuotesPanel.tsx … (+2) |
| `#eff6ff` | 10 | 화면, 색 정의 파일 | app/admin/page.tsx · app/sales/page.tsx · components/common/NotificationList.tsx … (+2) |
| `#0369a1` | 10 | 화면, 색 정의 파일 | app/purchase/page.tsx · app/sales/page.tsx · components/dashboard/MyQuotesPanel.tsx … (+1) |
| `#f8f9fb` | 9 | 화면 | app/repair/page.tsx · components/customer/InstallPrepSection.tsx · components/customer/modals/ServiceAddModal.tsx … (+3) |
| `rgba(0,0,0,0.12)` | 9 | 화면 | components/activity/ActivityDetail.tsx · components/common/Toast.tsx · components/dashboard/MyQuotesPanel.tsx … (+2) |
| `#b91c1c` | 8 | 화면, 색 정의 파일 | app/inventory/page.tsx · app/quote/QuoteItemRow.tsx · app/repair/page.tsx … (+4) |
| `rgba(0,0,0,0.55)` | 8 | 화면 | app/inventory/page.tsx · app/purchase/page.tsx · components/quote/AssigneePicker.tsx |
| `#111` | 8 | 화면 | app/login/page.tsx · components/common/NotificationList.tsx · components/customer/modals/SignModal.tsx |
| `#9aa` | 7 | PDF(react-pdf·인쇄) | app/quote/QuotePDFDoc.tsx |
| `#f5f5f5` | 7 | 화면 | components/common/NotificationList.tsx · components/customer/AgencyPicker.tsx · components/customer/modals/OpportunityModal.tsx … (+2) |
| `#22c55e` | 7 | 화면, 지도·마커, 색 정의 파일 | components/common/Toast.tsx · components/home/CustomerCard.tsx · components/home/MapView.tsx … (+2) |
| `rgba(35,78,162,0.10)` | 6 | 화면 | app/contact/semi/[projectId]/write/page.tsx · app/inventory/page.tsx · app/lead/page.tsx … (+2) |
| `rgba(0,0,0,0.18)` | 6 | 화면, 지도·마커 | app/pipeline/page.tsx · components/activity/RouteMapView.tsx · components/home/MapView.tsx … (+1) |
| `rgba(0,0,0,0.25)` | 6 | 화면 | app/purchase/page.tsx · app/sales/page.tsx · components/quote/AssigneePicker.tsx … (+1) |
| `#f0f4ff` | 6 | 화면 | app/quote/QuoteItemRow.tsx · app/suggestions/page.tsx · components/common/NotificationList.tsx … (+2) |
| `rgba(0,0,0,0.1)` | 5 | globals.css(토큰 정의), 화면 | app/globals.css · components/customer/modals/ServiceAddModal.tsx · components/customer/modals/ServiceEditModal.tsx … (+2) |
| `#dce9ff` | 5 | 화면 | app/inventory/page.tsx · components/admin/priceList/PriceListDropZone.tsx |
| `rgba(0,0,0,0.10)` | 5 | 화면 | app/inventory/page.tsx · app/sales/page.tsx · components/home/CustomerCard.tsx … (+1) |
| `#fed7aa` | 5 | 화면 | app/sales/page.tsx · components/quote/CustomerCard.tsx |
| `rgba(0,0,0,0.3)` | 5 | 화면, 지도·마커 | app/sales/page.tsx · components/activity/RouteMapView.tsx |
| `#3b82f6` | 5 | 화면, 색 정의 파일 | components/customer/modals/QuoteHistoryModal.tsx · lib/categoryColors.ts · lib/inquiries.ts |
| `#f43f5e` | 5 | 화면, 지도·마커, 색 정의 파일 | components/home/CustomerCard.tsx · components/home/MapView.tsx · lib/categoryColors.ts |
| `rgba(255,255,255,0.16)` | 5 | 화면 | components/quote/QuotePreviewPane.tsx |
| `rgba(255,255,255,0.5)` | 5 | 화면 | components/quote/QuotePreviewPane.tsx |
| `rgba(0,0,0,0.05)` | 4 | 화면 | app/inventory/page.tsx |
| `#2a2a2a` | 4 | 화면 | app/login/page.tsx |
| `#555` | 4 | 화면 | app/login/page.tsx · components/customer/ServiceReportDoc.tsx |
| `#92400e` | 4 | 화면, 색 정의 파일 | app/purchase/page.tsx · components/quote/ConfirmQuoteModal.tsx · components/sales/EngineerStatCard.tsx … (+1) |
| `rgba(35,78,162,0.12)` | 4 | 화면 | app/quote/QuoteItemRow.tsx · components/quote/CustomerCard.tsx · components/showroom/CustomerSearch.tsx |
| `#000000` | 4 | PDF(react-pdf·인쇄) | app/quote/QuotePDFDoc.tsx · components/pdf/docBase.ts · components/showroom/ApprovalPdfDoc.tsx |
| `#fff7ed` | 4 | 화면 | app/sales/page.tsx · components/quote/CustomerCard.tsx · components/sales/EngineerStatCard.tsx |
| `#fecdd3` | 4 | 화면 | app/sales/page.tsx · components/repair/RepairEditModal.tsx |
| `#faf5ff` | 4 | 화면, 색 정의 파일 | app/sales/page.tsx · components/dashboard/MyQuotesPanel.tsx · lib/categoryColors.ts |
| `rgba(255,255,255,0.95)` | 4 | 지도·마커, 화면 | components/activity/RouteMapView.tsx · components/common/HorizontalScroller.tsx · components/home/MapView.tsx |
| `rgba(0,0,0,0.65)` | 4 | 색 정의 파일, PDF(react-pdf·인쇄), 화면 | components/customer/constants.ts · components/pdf/PdfViewerModal.tsx · components/quote/RepairInfoModal.tsx … (+1) |
| `#f1f5f9` | 4 | 화면 | components/customer/DeviceSection.tsx · components/sales/EngineerStatCard.tsx |
| `#0f766e` | 4 | 색 정의 파일 | lib/categoryColors.ts |
| `#f0fdfa` | 4 | 색 정의 파일 | lib/categoryColors.ts |
| `#4b5563` | 3 | 화면, 색 정의 파일 | app/account/page.tsx · components/customer/constants.ts · components/customer/DeviceSection.tsx |
| `#e6ecf8` | 3 | 화면 | app/contact/semi/[projectId]/write/page.tsx · app/quote/QuoteItemRow.tsx · components/layout/Sidebar.tsx |
| `#f8fffe` | 3 | 화면 | app/inventory/page.tsx · app/repair/page.tsx |
| `#14532d` | 3 | 화면 | app/inventory/page.tsx |
| `#111111` | 3 | 화면 | app/page.tsx · lib/home.ts |
| `rgba(0,0,0,0.15)` | 3 | 화면, 지도·마커 | app/purchase/page.tsx · components/activity/RouteMapView.tsx · components/home/MapView.tsx |
| `#fee2e2` | 3 | 화면 | app/quote/QuoteItemRow.tsx · components/customer/DeviceSection.tsx · components/home/list/ListTabs.tsx |
| `#b9cdee` | 3 | PDF(react-pdf·인쇄) | app/quote/QuotePDFDoc.tsx |
| `#e2e2e2` | 3 | PDF(react-pdf·인쇄) | app/quote/QuotePDFDoc.tsx |
| `#666` | 3 | PDF(react-pdf·인쇄) | app/quote/QuotePDFDoc.tsx |
| `#94a3b8` | 3 | 화면 | app/sales/page.tsx |
| `#c0c4cc` | 3 | 화면 | components/common/MemoPopover.tsx · components/quote/QuoteRowIcons.tsx |
| `#64748b` | 3 | 화면, 색 정의 파일 | components/customer/ActivityTimeline.tsx · components/sales/EngineerStatCard.tsx · lib/categoryColors.ts |
| `#e6e8ec` | 3 | 화면 | components/layout/Sidebar.tsx |
| `#e3e5e9` | 3 | 화면 | components/layout/Sidebar.tsx |
| `rgba(255,255,255,0.7)` | 3 | 화면 | components/quote/QuotePreviewPane.tsx |
| `#f4f7fd` | 2 | 화면 | app/contact/semi/[projectId]/page.tsx · app/contact/semi/[projectId]/write/page.tsx |
| `#171717` | 2 | globals.css(토큰 정의) | app/globals.css |
| `rgba(35,78,162,0.1)` | 2 | globals.css(토큰 정의), 화면 | app/globals.css · components/common/FormFocusStyle.tsx |
| `#6b8fce` | 2 | 화면 | app/inventory/page.tsx |
| `#fef3c7` | 2 | 화면, 색 정의 파일 | app/inventory/page.tsx · lib/categoryColors.ts |
| `#c00000` | 2 | PDF(react-pdf·인쇄) | app/quote/QuotePDFDoc.tsx |
| `#bbb` | 2 | PDF(react-pdf·인쇄) | app/quote/QuotePDFDoc.tsx |
| `#ddd` | 2 | PDF(react-pdf·인쇄) | app/quote/QuotePDFDoc.tsx |
| `#222` | 2 | PDF(react-pdf·인쇄) | app/quote/QuotePDFDoc.tsx |
| `#f1f1f1` | 2 | 화면 | app/repair/page.tsx · components/common/AutocompleteInput.tsx |
| `#e2e8f0` | 2 | 화면 | app/sales/page.tsx |
| `#c4b5fd` | 2 | 화면 | app/sales/page.tsx · components/dashboard/MyQuotesPanel.tsx |
| `#fca5a5` | 2 | 화면 | app/sales/page.tsx · components/dashboard/MyQuotesPanel.tsx |
| `rgba(0,0,0,0.45)` | 2 | 화면, 지도·마커 | components/activity/ActivityDetailModal.tsx · components/activity/RouteMapView.tsx |
| `rgba(0,0,0,0.35)` | 2 | 지도·마커, 화면 | components/activity/RouteMapView.tsx · components/customer/modals/QuoteHistoryModal.tsx |
| `rgba(0,0,0,0.06)` | 2 | 화면 | components/admin/priceList/PriceListImportModal.tsx · components/common/HorizontalScroller.tsx |
| `#8b5cf6` | 2 | 색 정의 파일 | lib/categoryColors.ts |
| `#14b8a6` | 2 | 색 정의 파일 | lib/categoryColors.ts |
| `#f0f9ff` | 2 | 색 정의 파일 | lib/categoryColors.ts |
| `#2563eb` | 2 | 색 정의 파일 | lib/categoryColors.ts |
| `#166534` | 1 | 화면 | app/account/page.tsx |
| `#bfdbfe` | 1 | 화면 | app/admin/page.tsx |
| `#f6f6f6` | 1 | 화면 | app/approval/doc/[id]/page.tsx |
| `rgba(0,0,0,0.04)` | 1 | globals.css(토큰 정의) | app/globals.css |
| `rgba(0,0,0,0.14)` | 1 | globals.css(토큰 정의) | app/globals.css |
| `rgba(0,0,0,0.11)` | 1 | 화면 | app/inventory/page.tsx |
| `rgba(35,78,162,0.07)` | 1 | 화면 | app/inventory/page.tsx |
| `rgba(217,119,6,0.08)` | 1 | 화면 | app/inventory/page.tsx |
| `rgba(0,0,0,0.8)` | 1 | 화면 | app/leads/page.tsx |
| `#1c1c1c` | 1 | 화면 | app/login/page.tsx |
| `#17181d` | 1 | 화면 | app/page.tsx |
| `#5b606b` | 1 | 화면 | app/page.tsx |
| `#1d4ed8` | 1 | 화면 | app/purchase/page.tsx |
| `#78350f` | 1 | 화면 | app/purchase/page.tsx |
| `#dcfce7` | 1 | 화면 | app/quote/QuoteItemRow.tsx |
| `#fef9c3` | 1 | 화면 | app/quote/QuoteItemRow.tsx |
| `#854d0e` | 1 | 화면 | app/quote/QuoteItemRow.tsx |
| `#7a8fb5` | 1 | PDF(react-pdf·인쇄) | app/quote/QuotePDFDoc.tsx |
| `#444` | 1 | PDF(react-pdf·인쇄) | app/quote/QuotePDFDoc.tsx |
| `#777` | 1 | PDF(react-pdf·인쇄) | app/quote/QuotePDFDoc.tsx |
| `#fffdf7` | 1 | 화면 | app/repair/page.tsx |
| `#f0f1f4` | 1 | 화면 | app/repair/page.tsx |
| `#1e293b` | 1 | 화면 | app/sales/page.tsx |
| `rgba(255,255,255,0.92)` | 1 | 지도·마커 | components/activity/RouteMapView.tsx |
| `#f1f3f5` | 1 | 색 정의 파일 | components/customer/constants.ts |
| `rgba(0,0,0,0.16)` | 1 | 화면 | components/home/CustomerCard.tsx |
| `#c4c9d1` | 1 | 화면 | components/home/CustomerList.tsx |
| `#dbe4f7` | 1 | 화면 | components/home/list/CustomerListPanel.tsx |
| `#f5f6f8` | 1 | 화면 | components/layout/Sidebar.tsx |
| `#eceef2` | 1 | 화면 | components/layout/Sidebar.tsx |
| `rgba(17,24,39,0.45)` | 1 | 화면 | components/layout/Sidebar.tsx |
| `#333` | 1 | PDF(react-pdf·인쇄) | components/pdf/docBase.ts |
| `#333333` | 1 | PDF(react-pdf·인쇄) | components/pdf/docBase.ts |
| `#fcd34d` | 1 | 화면 | components/quote/ConfirmQuoteModal.tsx |
| `rgba(194,65,12,0.12)` | 1 | 화면 | components/quote/CustomerCard.tsx |
| `#d7dce6` | 1 | 화면 | components/quote/equip/equipStyles.ts |
| `#1c2230` | 1 | 화면 | components/quote/equip/equipStyles.ts |
| `#6b7488` | 1 | 화면 | components/quote/equip/equipStyles.ts |
| `#2b4fb8` | 1 | 화면 | components/quote/equip/equipStyles.ts |
| `#e8eefc` | 1 | 화면 | components/quote/equip/equipStyles.ts |
| `#1d7a4a` | 1 | 화면 | components/quote/equip/equipStyles.ts |
| `#c0392b` | 1 | 화면 | components/quote/equip/equipStyles.ts |
| `#f8f9fc` | 1 | 화면 | components/quote/equip/equipStyles.ts |
| `#f1f3f9` | 1 | 화면 | components/quote/equip/equipStyles.ts |
| `#b8860b` | 1 | 화면 | components/sales/EngineerStatCard.tsx |
| `#1f4e79` | 1 | 화면 | components/xlsx/XlsxPreviewModal.tsx |
| `#475569` | 1 | 색 정의 파일 | lib/categoryColors.ts |
| `#7e22ce` | 1 | 색 정의 파일 | lib/categoryColors.ts |
| `#3014` | 1 | 화면 | lib/customerList.ts |
| `#555555` | 1 | 화면 | lib/home.ts |
| `#888888` | 1 | 화면 | lib/home.ts |
| `#f4f4f5` | 1 | 화면 | lib/home.ts |
| `#e6e6e6` | 1 | PDF(react-pdf·인쇄) | lib/pdfViewer.ts |
| `#d9e1f2` | 1 | 화면 | lib/showroomExcel.ts |

## ④ 예외 후보 — 화면 토큰으로 바꾸면 안 되는 자리

| 갈래 | 건수 | 왜 예외인가 |
|---|---|---|
| 화면 | 3092 | 토큰으로 옮길 대상 |
| 색 정의 파일 | 129 | 분류·상태 색을 한 곳에 모아 둔 자리 — 여기가 정본이다 |
| 지도·마커 | 114 | 카카오 지도가 문자열로 받는 색이다(클러스터·마커·오버레이) |
| PDF(react-pdf·인쇄) | 72 | 인쇄물의 색이다. 화면 토큰과 다른 기준(흑백·CMYK)으로 간다 |
| globals.css(토큰 정의) | 36 | 토큰을 정의하는 자리다 |
| 메일 HTML | 33 | 받는 메일 클라이언트는 CSS 변수를 모른다 — 인라인 hex 여야 한다 |

## ⑤ 파일별 — 색을 많이 든 순서(상위 25)

| 파일 | 건수 | 다른 값 | 갈래 |
|---|---|---|---|
| `app/inventory/page.tsx` | 172 | 40 | 화면 |
| `app/admin/page.tsx` | 144 | 20 | 화면 |
| `app/sales/page.tsx` | 120 | 51 | 화면 |
| `lib/categoryColors.ts` | 99 | 33 | 색 정의 파일 |
| `app/quote/QuoteItemRow.tsx` | 98 | 23 | 화면 |
| `components/activity/RouteMapView.tsx` | 87 | 20 | 지도·마커 |
| `components/dashboard/MyQuotesPanel.tsx` | 75 | 32 | 화면 |
| `components/customer/modals/HoldingModal.tsx` | 70 | 14 | 화면 |
| `components/customer/modals/ServiceAddModal.tsx` | 68 | 16 | 화면 |
| `components/customer/modals/OpportunityModal.tsx` | 67 | 18 | 화면 |
| `app/quote/ProfitPanel.tsx` | 65 | 11 | 화면 |
| `components/customer/DeviceSection.tsx` | 65 | 19 | 화면 |
| `app/dashboard/80/page.tsx` | 64 | 13 | 화면 |
| `components/customer/modals/ServiceEditModal.tsx` | 63 | 16 | 화면 |
| `components/layout/Sidebar.tsx` | 62 | 18 | 화면 |
| `app/repair/page.tsx` | 61 | 31 | 화면 |
| `components/quote/CustomerCard.tsx` | 58 | 15 | 화면 |
| `components/quote/equip/equipStyles.ts` | 57 | 26 | 화면 |
| `app/pipeline/page.tsx` | 55 | 15 | 화면 |
| `components/repair/RepairEditModal.tsx` | 52 | 16 | 화면 |
| `app/purchase/page.tsx` | 50 | 26 | 화면 |
| `components/customer/ActivityTimeline.tsx` | 46 | 16 | 화면 |
| `app/holdings/page.tsx` | 44 | 11 | 화면 |
| `app/suggestions/page.tsx` | 41 | 17 | 화면 |
| `components/customer/modals/DeviceEditModal.tsx` | 38 | 10 | 화면 |

## 다음 걸음(제안)

1. 색 토큰은 **이미 `globals.css` 에 26개 있다**(--color-brand·--color-ink·--color-border…).
   그런데 화면은 그 토큰을 거의 쓰지 않고 같은 값을 직접 적는다(①의 1,469건).
   토큰을 더 만들 일이 아니라 **쓰게 만드는** 일이 먼저다.
2. ①의 자리를 토큰으로 바꾼다. 건수가 큰 값부터 — 한 번에 한 값씩, 하네스로 잠근다.
   ⚠ 디자인 시스템 표와 globals.css 토큰이 **서로 다른 값**을 들고 있는 자리가 있다:
   페이지 배경(표 #fafafa / 토큰 #f4f5f7) · 테두리(표 #ebebeb / 토큰 #e2e4e9) ·
   본문 진함(표 #111827 / 토큰 #111113) · 위험(표 #ef4444 / 토큰 #dc2626).
   **어느 쪽이 정본인지 먼저 정해야** 바꿀 수 있다 — 토큰을 표에 맞추는 쪽을 권한다
   (화면에 실제로 그려지는 값이 표 쪽이다).
3. `#fff` 와 `#ffffff` 처럼 **같은 색의 두 표기**가 섞여 있다(383 + 160건). 토큰으로 가면 한 가지가 된다.
4. ③의 값은 **쓰임을 보고 셋 중 하나로** 정한다: 토큰에 더한다 / 가까운 토큰으로 모은다 / 예외로 남긴다.
5. ④의 네 갈래는 예외로 둔다 — 다크모드에서도 그대로다.

