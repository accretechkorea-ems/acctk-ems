'use client'

// 쇼룸 사용 신청의 **양식 본문**.
//
// 값 규칙은 **기존 요약 함수를 그대로 쓴다** — components/approval/summary.ts 의 showroomRows 가
// 「어떤 칸을 어떤 라벨로, 값이 있을 때만」을 이미 정해 두었다(접기·기본값·숨김 규칙 포함).
// 여기서는 그 결과를 **양식 표 모양으로 다시 배치**하기만 한다. 규칙을 베끼면 한쪽만 고쳐져
// 결재함 상세의 요약과 양식 본문이 서로 다른 말을 한다.
//
// 승인서 PDF 는 기존 경로를 그대로 쓴다(components/showroom/openApprovalPdf.ts →
// /api/showroom/requests/pdf?doc=). 그 라우트의 권한 판정은 결재 문서를 볼 수 있는 사람
// (상신자·결재선 전원(참조 포함)·관리자·approvals 권한자)을 모두 허용한다 — 판정을 손대지 않았다.

import { useState } from 'react'
import { BORDER, CARD_BG, DANGER, MUTED, btnGhost } from '@/components/common/ui'
import { showroomRows } from './summary'
import { FormRow } from './formStyles'
import { openApprovalPdf } from '@/components/showroom/openApprovalPdf'
import type { DocFormBodyProps } from './panels'

/** 사후 신청인가 — 요약의 위 칸과 payload 둘 다 본다(옛 문서는 한쪽만 있다). */
function isRetroactive(summary: Record<string, unknown>): boolean {
  const s = summary as { is_retroactive?: unknown; payload?: { is_retroactive?: unknown } } | null
  if (s?.is_retroactive === true || s?.payload?.is_retroactive === true) return true
  // kind 글자로도 본다 — buildSummary 가 「사후 신청」을 적어 둔다.
  return typeof (s as { kind?: unknown })?.kind === 'string' && (s as { kind: string }).kind === '사후 신청'
}

/** 승인서 PDF 경로가 요약에 있는가. */
function pdfUrlOf(summary: Record<string, unknown>): string | null {
  const v = (summary as { pdf_url?: unknown }).pdf_url
  return typeof v === 'string' && v.trim() ? v : null
}

export default function ShowroomFormBody({ doc }: DocFormBodyProps) {
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)

  const rows = showroomRows(doc.summary)
  const hasPdf = pdfUrlOf(doc.summary) !== null
  // 사후 신청 안내는 **지금 결재할 수 있을 때만** 띄운다 — 끝난 문서에 「반려하면 …」은 뜻이 없다.
  const warnRetroactive = isRetroactive(doc.summary) && doc.status === '진행중'

  /** 승인서 열기 — 서버가 돌려준 사유를 그대로 보여 준다(「권한 없음」·「승인서가 없습니다」 등). */
  const openPdf = async () => {
    if (pdfBusy) return
    setPdfBusy(true)
    setPdfError(null)
    try {
      const message = await openApprovalPdf(doc.document_id, 'doc')
      if (message) setPdfError(message)
    } finally {
      setPdfBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* 사후 신청 — 이미 끝난 사용이다. 반려하면 기록이 사라진다는 사실을 결재 전에 알린다. */}
      {warnRetroactive && (
        <span style={{ fontSize: 11, color: DANGER, lineHeight: 1.6 }}>
          이미 사용한 건에 대한 사후 신청입니다. 반려하면 등록된 사용 기록이 삭제됩니다
        </span>
      )}

      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 6, overflow: 'hidden', background: CARD_BG }}>
        {rows.length === 0 ? (
          <FormRow label="내　　용" first>
            <span style={{ color: MUTED }}>신청 내용을 읽지 못했습니다</span>
          </FormRow>
        ) : rows.map((r, i) => (
          <FormRow key={r.label} label={r.label} first={i === 0}>{r.value}</FormRow>
        ))}
        {/* 첨부 — 승인서 PDF 가 있을 때만. 없으면 줄 자체를 두지 않는다(양식의 공통 첨부 줄이 센다). */}
        {hasPdf && (
          <FormRow label="첨　　부">
            <span className="ad-noprint">
              <button
                type="button"
                onClick={openPdf}
                disabled={pdfBusy}
                style={{ ...btnGhost(pdfBusy), padding: '3px 9px', fontSize: 12 }}
              >
                {pdfBusy ? '여는 중...' : '승인서 PDF 보기'}
              </button>
            </span>
            {pdfError && (
              <span style={{ fontSize: 11, color: DANGER, marginLeft: 8 }}>{pdfError}</span>
            )}
          </FormRow>
        )}
      </div>
    </div>
  )
}
