---
paths:
  - "app/**/*.tsx"
  - "components/**/*.tsx"
  - "app/globals.css"
---

# 디자인 시스템 규칙

## 톤
Linear(linear.app)의 **정보 밀도와 절제된 스타일**을 따른다.
단, 다크모드 아님. 보라색 아님. 흰 배경 + #234ea2 액센트 유지.

## 최우선 규칙 — 하드코딩 금지
- **hex 색상값을 새로 쓰지 마라.** 반드시 globals.css의 @theme 토큰을 참조한다.
  - 인라인 스타일: `style={{ color: 'var(--color-text-secondary)' }}`
  - 유틸리티 클래스: `text-text-secondary`
- 토큰에 없는 색이 필요하면, 새 값을 만들지 말고 **나에게 물어봐라.**
- `const BLUE = '#234ea2'` 같은 지역 상수를 새로 만들지 마라.

## 금지 목록
- 그라데이션 전면 금지
- 새로운 장식용 보라/indigo 도입 금지.
  단, 기존 #7c3aed 계열(발주 상태·superadmin 권한)은 의미를 가진
  카테고리 색이므로 임의로 제거하지 마라.
- box-shadow 신규 사용 금지. 모달/드롭다운 외에는 border 1px로 구분한다.
- 이모지를 UI 아이콘으로 쓰지 않는다. lucide-react만 사용.
- 본문·라벨은 최대 600. 카드/섹션 제목은 700까지 허용.
- 소수점 font-size 금지 (12.5px 등)

## 수치 제약
- font-size: 11 / 12 / 13 / 14 / 16 / 20 px 외 사용 금지
- border-radius: 4 / 6 / 8 / 9999 px 외 사용 금지
- spacing(gap, padding, margin): 4의 배수만. 5·7·9·14·18 금지
- 테이블 행 높이 40px 이하, 버튼·인풋 높이 32px
- 카드 padding 16px (24px 초과 금지)

## 리팩터링 시
- 기존 인라인 스타일을 Tailwind 클래스로 "일괄 전환"하지 마라.
  값만 토큰 참조로 바꾸고 구조는 유지한다.
- 기능 로직(Supabase 쿼리, 상태 관리, props 시그니처)은 절대 건드리지 마라.

## 토큰화 예외 (절대 건드리지 말 것)
- react-pdf 컴포넌트 내부의 색상값 (ServiceReportDoc.tsx, quote/page.tsx의 PDF 파트)
  → #000 등은 인쇄용 순검정. 화면용 토큰으로 치환 금지.
- borderRadius: '50%' → pill 토큰으로 바꾸지 말 것. 원형 유지.