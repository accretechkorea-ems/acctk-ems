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

/** 제목 — 「[아크레텍코리아] 견적서 {번호} — {회사명}」. 회사명이 없으면 그 뒤를 뗀다. */
export function mailSubject(p: MailParts): string {
  const head = `[아크레텍코리아] 견적서 ${t(p.quoteNo)}`
  const company = t(p.company)
  return company ? `${head} — ${company}` : head
}

/**
 * 본문. 줄바꿈은 **CRLF** 다 — 메일 프로그램이 줄을 그대로 받는다.
 * 이름·직급·품명·작성자가 비어도 문장이 깨지지 않게 다듬는다.
 */
export function mailBody(p: MailParts): string {
  const who = [t(p.toName), t(p.toPosition)].filter(Boolean).join(' ')
  const hello = who ? `${who}님, 안녕하세요.` : '안녕하세요.'
  const item = t(p.firstItem)
  const line = item ? `요청하신 ${item} 견적서를 송부드립니다.` : '요청하신 견적서를 송부드립니다.'
  const from = t(p.fromName)
  return [
    hello,
    line,
    '첨부 파일 확인 부탁드립니다.',
    '',
    '감사합니다.',
    from ? `${from} 드림` : '',
  ].filter((l, i, arr) => !(l === '' && i === arr.length - 1)).join('\r\n')
}

/**
 * mailto 주소. 받는 사람이 없으면 **null** — 화면은 버튼 대신 안내를 띄운다.
 * 줄바꿈(%0D%0A)을 포함해 encodeURIComponent 가 전부 감싼다.
 */
export function mailtoUrl(p: MailParts): string | null {
  const to = t(p.toEmail)
  if (!to) return null
  const q = `subject=${encodeURIComponent(mailSubject(p))}&body=${encodeURIComponent(mailBody(p))}`
  return `mailto:${encodeURIComponent(to)}?${q}`
}

/** 이메일이 없을 때 그 자리에 적는 말. */
export const NO_EMAIL_NOTICE = '수신인에 이메일이 없습니다 — 담당자 정보에서 추가'

/** 창 제목. */
export function savedTitle(quoteNo: string): string {
  return `견적서 ${t(quoteNo)} 저장됨`
}

/** 창 아래 안내. */
export const ATTACH_NOTICE = '메일 창이 열리면 방금 저장한 PDF 를 끌어다 첨부해 주세요'
