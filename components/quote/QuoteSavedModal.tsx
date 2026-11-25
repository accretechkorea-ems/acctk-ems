'use client'

/**
 * 견적서를 **확정한 바로 뒤** 뜨는 작은 창 (2026-11-25).
 *
 * 번호가 발급되고 PDF 가 내려간 그 순간, 받는 사람에게 보낼 메일 한 통을 바로 열 수
 * 있게 한다. 전에는 화면이 비워지면서 수신인 이메일이 함께 사라져, 메일을 쓰려면
 * 고객사 화면을 다시 뒤져야 했다.
 *
 * ── 첨부는 사람이 한다 ──────────────────────────────────────────────────
 *   브라우저는 mailto 로 파일을 붙일 수 없다. 그래서 「메일 창이 열리면 방금 저장한
 *   PDF 를 끌어다 첨부해 주세요」를 아래에 적어 둔다.
 */

import ModalOverlay from '@/components/common/ModalOverlay'
import ModalCard from '@/components/common/ModalCard'
import { BLUE, BORDER, CARD_BG, SUB, TEXT } from '@/components/common/ui'
import { R } from '@/lib/radius'
import { ATTACH_NOTICE, NO_EMAIL_NOTICE, mailtoUrl, savedTitle, type MailParts } from '@/lib/quoteMail'

/**
 * 봉투 아이콘 — **lucide 모양 인라인 SVG** 다(디자인 규칙: 이모지를 아이콘으로 쓰지 않는다).
 * lucide-react 는 미설치라 path 를 직접 적는다.
 */
const MAIL_ICON = (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m2 7 10 6 10-6" />
  </svg>
)

export default function QuoteSavedModal({ parts, onClose }: {
  parts: MailParts
  onClose: () => void
}) {
  const href = mailtoUrl(parts)
  const email = String(parts.toEmail ?? '').trim()

  return (
    <ModalOverlay onClose={onClose}>
      <ModalCard
        width={420}
        onClose={onClose}
        title={<div style={{ fontSize: 16, fontWeight: 800, color: TEXT }}>{savedTitle(parts.quoteNo)}</div>}
        footer={<>
          <button type="button" onClick={onClose}
            style={{
              height: 40, flex: 1, border: `1px solid ${BORDER}`, borderRadius: R.control,
              background: CARD_BG, color: SUB, fontWeight: 600, fontSize: 13,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>
            닫기
          </button>
          {href && (
            <button type="button" onClick={() => { window.location.href = href }}
              style={{
                height: 40, flex: 2, border: 'none', borderRadius: R.control,
                background: BLUE, color: '#fff', fontWeight: 700, fontSize: 14,
                cursor: 'pointer', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              }}>
              {MAIL_ICON}메일 쓰기
            </button>
          )}
        </>}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {email ? (
            <a href={`mailto:${email}`}
              style={{ fontSize: 17, fontWeight: 700, color: TEXT, textDecoration: 'none', wordBreak: 'break-all' }}
              onMouseEnter={e => { e.currentTarget.style.color = BLUE; e.currentTarget.style.textDecoration = 'underline' }}
              onMouseLeave={e => { e.currentTarget.style.color = TEXT; e.currentTarget.style.textDecoration = 'none' }}>
              {email}
            </a>
          ) : (
            <div style={{ fontSize: 13, color: SUB, lineHeight: 1.8 }}>{NO_EMAIL_NOTICE}</div>
          )}
          <div style={{ fontSize: 12, color: SUB, lineHeight: 1.8 }}>{ATTACH_NOTICE}</div>
        </div>
      </ModalCard>
    </ModalOverlay>
  )
}
