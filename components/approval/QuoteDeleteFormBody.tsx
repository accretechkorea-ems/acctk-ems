'use client'

// 견적 삭제 요청의 **양식 본문**.
//
// 값 규칙은 **기존 요약 등록표를 그대로 쓴다** — components/approval/summary.ts 의 summaryRows 가
// 어떤 칸을 어떤 라벨로 낼지, 어떤 칸을 숨길지(restoreFailReason 등)를 이미 정해 두었다.
// 여기서는 그 결과를 양식 표 모양으로 다시 배치하기만 한다.
//
// 삭제는 되돌릴 수 없다. 그래서 결재자가 「무엇을 지우는지」를 먼저 읽도록 한 줄 안내를 둔다
// (문구는 등록표의 라벨들이 이미 말해 주지만, 되돌릴 수 없다는 사실은 라벨에 없다).

import { BORDER, CARD_BG, DANGER, MUTED } from '@/components/common/ui'
import { summaryRows } from './summary'
import { FormRow } from './formStyles'
import type { DocFormBodyProps } from './panels'

export default function QuoteDeleteFormBody({ doc }: DocFormBodyProps) {
  // 유형 이름을 적지 않는다 — 문서가 들고 있는 doc_type 을 그대로 넘긴다.
  const rows = summaryRows(doc.doc_type, doc.summary)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* 되돌릴 수 없다는 사실 — 결재할 수 있는 상태일 때만 알린다. */}
      {doc.status === '진행중' && (
        <span style={{ fontSize: 11, color: DANGER, lineHeight: 1.6 }}>
          승인하면 견적이 삭제됩니다. 되돌릴 수 없습니다
        </span>
      )}

      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 6, overflow: 'hidden', background: CARD_BG }}>
        {rows.length === 0 ? (
          <FormRow label="내　　용" first>
            <span style={{ color: MUTED }}>요청 내용을 읽지 못했습니다</span>
          </FormRow>
        ) : rows.map((r, i) => (
          <FormRow key={r.label} label={r.label} first={i === 0}>{r.value}</FormRow>
        ))}
      </div>
    </div>
  )
}
