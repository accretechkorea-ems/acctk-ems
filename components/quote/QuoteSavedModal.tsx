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

import { useEffect, useState } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import ModalCard from '@/components/common/ModalCard'
import { BAND_BG, BLUE, BORDER, CARD_BG, MUTED, SUB, TEXT } from '@/components/common/ui'
import { LABEL_WEIGHT, TEXT_LABEL } from '@/lib/textTokens'
import { R } from '@/lib/radius'
import { todayKST } from '@/lib/date'
import { useSnippets } from '@/hooks/useSnippets'
import { KIND_LABEL, SCOPE_LABEL, applyVars, type SnippetCtx } from '@/lib/snippets'
import {
  ATTACH_NOTICE, NO_EMAIL_LINK_TEXT, NO_EMAIL_NOTICE, contactHref, mailtoUrl, savedTitle, type MailParts,
} from '@/lib/quoteMail'

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
  /**
   * 본문 문구 — 담아 둔 「메일 본문」·「공통」 문구에서 고른다(문구함, 2026-11-25).
   * 고르지 않으면 본문 없이 보낸다(종전과 같다).
   */
  const snippets = useSnippets('mail_body')
  const { load } = snippets
  const [picked, setPicked] = useState<number | null>(null)
  // 열 때 한 번 읽는다 — load 는 상태와 무갈이라 여기서 되돌이가 생기지 않는다(useSnippets).
  useEffect(() => { void load() }, [load])

  const ctx: SnippetCtx = {
    수신인: parts.toName, 직급: parts.toPosition, 회사: parts.company,
    품명: parts.firstItem, 견적번호: parts.quoteNo, 작성자: parts.fromName, 오늘: todayKST(),
  }
  const chosen = snippets.rows.find(s => s.snippet_id === picked) ?? null
  const preview = chosen ? applyVars(chosen.body, ctx) : ''

  const href = mailtoUrl(parts, preview)
  /** 이메일이 없을 때 갈 곳 — 그 사업장의 담당자 수정 창. */
  const fixHref = contactHref(parts)
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
            /* 「담당자 정보에서 추가」는 **그 담당자 수정 창**으로 바로 간다(2026-11-25).
               사업장을 모르면 글자만 남는다. */
            <div style={{ fontSize: 13, color: SUB, lineHeight: 1.8 }}>
              {fixHref ? (<>
                {NO_EMAIL_NOTICE.replace(NO_EMAIL_LINK_TEXT, '')}
                <a href={fixHref} style={{ color: BLUE, fontWeight: 600, textDecoration: 'none' }}
                  onMouseEnter={e => { e.currentTarget.style.textDecoration = 'underline' }}
                  onMouseLeave={e => { e.currentTarget.style.textDecoration = 'none' }}>
                  {NO_EMAIL_LINK_TEXT}
                </a>
              </>) : NO_EMAIL_NOTICE}
            </div>
          )}

          {/* 본문 문구 — 고르면 자리표가 바뀐 글이 아래에 뜨고, 그 글이 메일 본문이 된다. */}
          <div>
            <label htmlFor="quote-mail-snippet"
              style={{ fontSize: 12, fontWeight: LABEL_WEIGHT, color: TEXT_LABEL, marginBottom: 4, display: 'block' }}>
              본문 문구
            </label>
            <select id="quote-mail-snippet" value={picked ?? ''}
              onChange={e => setPicked(e.target.value === '' ? null : Number(e.target.value))}
              style={{
                width: '100%', height: 38, padding: '0 10px', boxSizing: 'border-box',
                border: `1px solid ${BORDER}`, borderRadius: R.control, background: CARD_BG,
                fontSize: 13, color: picked == null ? MUTED : TEXT, outline: 'none',
                fontFamily: 'inherit', cursor: 'pointer',
              }}>
              <option value="">본문 없이 보내기</option>
              {snippets.rows.map(s => (
                <option key={s.snippet_id} value={s.snippet_id}>
                  {s.title} ({SCOPE_LABEL[s.scope]}{s.kind !== 'mail_body' ? ` · ${KIND_LABEL[s.kind]}` : ''})
                </option>
              ))}
            </select>
            {snippets.notice && (
              <div style={{ fontSize: 11, color: SUB, marginTop: 4, lineHeight: 1.7 }}>{snippets.notice}</div>
            )}
            {preview && (
              <div style={{
                marginTop: 6, padding: '8px 10px', borderRadius: R.control, background: BAND_BG,
                fontSize: 12, color: SUB, lineHeight: 1.6, whiteSpace: 'pre-wrap',
              }}>
                {preview}
              </div>
            )}
          </div>

          <div style={{ fontSize: 12, color: SUB, lineHeight: 1.8 }}>{ATTACH_NOTICE}</div>
        </div>
      </ModalCard>
    </ModalOverlay>
  )
}
