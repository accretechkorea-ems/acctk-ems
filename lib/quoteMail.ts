/**
 * 견적서를 **확정한 뒤 보내는 메일** 한 통 (2026-11-25).
 *
 * 확정 → 번호 발급 → PDF 내려받기 바로 뒤에 작은 창이 뜬다. 거기서 「메일 쓰기」를
 * 누르면 메일 프로그램이 받는 사람·제목·본문이 채워진 채 열린다. **첨부는 사람이**
 * 끌어다 붙인다 — 브라우저가 mailto 로 파일을 붙일 수 없기 때문이다.
 *
 * 조립만 하는 순수 모듈이다 — 화면도 조회도 없다(하네스가 돌린다).
 */

/** 메일에 들어갈 값들. 없는 것은 비워도 된다. */
export type MailParts = {
  /** 견적서 번호 — 제목에 그대로 들어간다. */
  quoteNo: string
  /** 받는 사람. */
  toEmail?: string | null
  toName?: string | null
  toPosition?: string | null
  /** 수신처 회사(제목에 들어간다). */
  company?: string | null
  /** 첫 품목의 품명 — 본문 한 줄. */
  firstItem?: string | null
  /** 보내는 사람(작성자). */
  fromName?: string | null
  /** 수신처 사업장 — 이메일이 없을 때 「담당자 정보에서 추가」가 갈 곳이다. */
  customerId?: number | null
  /** 그 수신인 — 사업장 화면에서 **그 담당자 수정 창**이 바로 열린다. */
  contactId?: number | null
}

const t = (v: string | null | undefined) => String(v ?? '').trim()

/**
 * 제목 — 「{회사명}_{첫 품목 품명}_견적서 송부의 건」 (2026-11-25 지시).
 *
 *   협진정공_스타일러스_견적서 송부의 건
 *
 * 품목이 없으면 「{회사명}_견적서 송부의 건」, 회사명까지 없으면 꼬리만 남는다.
 * 견적서 번호는 제목에 넣지 않는다 — 첨부한 PDF 에 적혀 있다.
 */
export function mailSubject(p: MailParts): string {
  return [t(p.company), t(p.firstItem), '견적서 송부의 건'].filter(Boolean).join('_')
}

/**
 * 본문은 **비운다**(2026-11-25 지시) — 사람이 메일 창에서 직접 적는다.
 * 함수는 남겨 둔다: 화면·하네스가 「본문이 비어 있다」를 이 한 곳에서 본다.
 */
export function mailBody(_p: MailParts): string {
  return ''
}

/**
 * mailto 주소. 받는 사람이 없으면 **null** — 화면은 버튼 대신 안내를 띄운다.
 *
 * 본문은 **고른 문구가 있을 때만** 붙인다(문구함, 2026-11-25). 빈 body 를 보내면
 * 메일 프로그램이 서명·인용 기본 본문을 지우고 빈 창을 띄우는 쪽이 있어, 고르지 않으면
 * body 파라미터 자체를 넣지 않는다. 줄바꿈은 CRLF 로 보내 %0D%0A 가 된다.
 */
export function mailtoUrl(p: MailParts, body?: string | null): string | null {
  const to = t(p.toEmail)
  if (!to) return null
  const q = [`subject=${encodeURIComponent(mailSubject(p))}`]
  const text = String(body ?? '').trim() === '' ? '' : String(body)
  if (text) q.push(`body=${encodeURIComponent(text.replace(/\r?\n/g, '\r\n'))}`)
  return `mailto:${encodeURIComponent(to)}?${q.join('&')}`
}

/** 이메일이 없을 때 그 자리에 적는 말. 「담당자 정보에서 추가」가 링크다. */
export const NO_EMAIL_NOTICE = '수신인에 이메일이 없습니다 — 담당자 정보에서 추가'
/** 그 말에서 **링크가 되는 부분**. 화면이 이 글자만 파랗게 띄운다. */
export const NO_EMAIL_LINK_TEXT = '담당자 정보에서 추가'

/**
 * 「담당자 정보에서 추가」가 가는 곳.
 *   · 수신인을 안다 — 그 사업장 화면에서 **그 담당자 수정 창**이 바로 열린다(?contact=).
 *   · 사업장만 안다 — 사업장 화면으로 간다.
 *   · 둘 다 모른다 — 링크를 걸지 않는다(null).
 */
export function contactHref(p: MailParts): string | null {
  const id = Number(p.customerId ?? 0)
  if (!Number.isInteger(id) || id <= 0) return null
  const contact = Number(p.contactId ?? 0)
  return contact > 0 ? `/customer/${id}?contact=${contact}` : `/customer/${id}`
}

/** 창 제목. */
export function savedTitle(quoteNo: string): string {
  return `견적서 ${t(quoteNo)} 저장됨`
}

/** 창 아래 안내. */
export const ATTACH_NOTICE = '메일 창이 열리면 방금 저장한 PDF 를 끌어다 첨부해 주세요'
