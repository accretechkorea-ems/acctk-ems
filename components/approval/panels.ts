// 문서 종류별 추가 패널 등록표.
//
// components/approval/summary.ts 와 같은 방식이다 — 「유형별 표시는 한 곳에 모은다」.
// 그래서 DocDetail 에는 `if (doc.doc_type === 'quote')` 같은 분기가 없다. 상세 화면은
// 이 표를 찾아 있으면 그리고, 없으면 그냥 넘어간다. 새 유형은 여기 한 줄을 더하면 끝이다.
//
// 왜 lib/approval/docTypes.ts 가 아닌가 — 그 파일은 **화면과 서버가 함께 읽는 등록표**라
// 순수한 값과 판정만 둔다(그 파일 머리말). React 컴포넌트를 넣으면 서버 라우트의 모듈 그래프로
// 화면 코드가 끌려와 빌드가 깨진다. 화면 쪽 등록표는 여기 따로 둔다.
//
// 패널은 문서 id 하나만 받는다 — 내용은 각자 서버에서 읽는다. 상세 화면이 유형별 데이터를
// 모르게 두어야(지금처럼) 유형을 더하거나 뺄 때 DocDetail 을 고치지 않는다.

import type { ComponentType } from 'react'
import QuoteReviewPanel from './QuoteReviewPanel'

export type DocPanelProps = { documentId: number }

const PANELS: Record<string, ComponentType<DocPanelProps>> = {
  // 견적서 — 품목·원가·이익·거래 구분을 보여 주는 검토표.
  quote: QuoteReviewPanel,
}

/** 그 유형의 추가 패널. 없으면 null — 상세 화면이 아무것도 그리지 않는다. */
export function panelOf(docType: string): ComponentType<DocPanelProps> | null {
  return Object.prototype.hasOwnProperty.call(PANELS, docType) ? PANELS[docType] : null
}
