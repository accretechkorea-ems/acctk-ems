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
 * **body 파라미터 자체를 넣지 않는다** — 빈 body 를 보내면 메일 프로그램이 서명·인용
 * 기본 본문을 지우고 빈 창을 띄우는 쪽이 있다.
 */
export function mailtoUrl(p: MailParts): string | null {
  const to = t(p.toEmail)
  if (!to) return null
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(mailSubject(p))}`
}

/** 이메일이 없을 때 그 자리에 적는 말. */
export const NO_EMAIL_NOTICE = '수신인에 이메일이 없습니다 — 담당자 정보에서 추가'

/** 창 제목. */
export function savedTitle(quoteNo: string): string {
  return `견적서 ${t(quoteNo)} 저장됨`
}

/** 창 아래 안내. */
export const ATTACH_NOTICE = '메일 창이 열리면 방금 저장한 PDF 를 끌어다 첨부해 주세요'
