'use client'

/**
 * 사업장 카드 맨 위의 **회사 이름** — 「이 사업장이 어느 회사인가」이자 그 회사로 가는 길.
 *
 * ── 왜 한 부품인가(2026-11-20) ────────────────────────────────────────────
 *   같은 글자가 두 자리에 선다.
 *     분할 보기 안(고객사 현황 `/`) — 우측 pane 을 회사 화면으로 **갈아 끼운다**.
 *       화면을 떠나지 않으므로 주소도 바뀌지 않는다(onOpen 이 그 일을 한다).
 *     상세 페이지(`/customer/[id]`) — 그 화면에는 갈아 끼울 pane 이 없다. 그래서
 *       목록 보기로 **옮겨 가며** 그 회사를 고른 상태로 연다(`/?view=list&company=<id>`).
 *       주소에 남으므로 새로고침해도 그 회사가 그대로 열리고, 뒤로 가기로 사업장으로 돌아온다.
 *   전에는 상세 페이지에서 이 글자가 **그냥 글자**였다(onOpenCompany 가 undefined 였다) —
 *   회사로 가려면 고객사 현황으로 나가 트리에서 다시 찾아야 했다.
 *
 * 회사에 묶이지 않은 단독 업체는 갈 곳이 없으므로 글자만 둔다(종전과 같다).
 */

import Link from 'next/link'
import { companyHref } from '@/lib/mapPopup'

const TEXT = '#111827'
const MUTED = '#6b7280'

/** 목록 보기에서 한 회사를 고른 채 여는 주소. 읽는 쪽은 app/page.tsx 의 `?company=` 다. */
/**
 * 목록 보기에서 한 회사를 고른 채 여는 주소. 읽는 쪽은 app/page.tsx 의 `?company=` 다.
 * 주소를 만드는 규칙은 **lib/mapPopup.ts 한 곳**이다(2026-11-28, 야간4 7-1) —
 * 지도 팝업·업체 카드·이 링크가 같은 글자를 만든다.
 */
export function companyListHref(companyId: number): string {
  return companyHref({ customer_id: 0, company_name: '', parent_customer_id: companyId }) ?? `/?view=list&company=${companyId}`
}

export default function CompanyLink({
  name, companyId, onOpen, fontSize = 20,
}: {
  /** 보이는 글자 — 회사 이름(없으면 업체 이름). */
  name: string
  /** 묶인 회사의 id. 없으면 길이 없다. */
  companyId?: number | null
  /** 분할 보기 안이면 pane 을 갈아 끼우는 일. 있으면 이쪽을 쓴다(주소를 바꾸지 않는다). */
  onOpen?: () => void
  fontSize?: number
}) {
  const text: React.CSSProperties = {
    fontSize, fontWeight: 700, color: TEXT, letterSpacing: '-0.3px',
  }
  const linked: React.CSSProperties = { ...text, borderBottom: `1px dashed ${MUTED}` }

  if (onOpen) {
    return (
      <button type="button" onClick={onOpen} title="회사 보기"
        style={{ padding: 0, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
        <span style={linked}>{name}</span>
      </button>
    )
  }
  if (companyId != null) {
    return (
      <Link href={companyListHref(companyId)} title="회사 보기"
        style={{ textDecoration: 'none', fontFamily: 'inherit' }}>
        <span style={linked}>{name}</span>
      </Link>
    )
  }
  return <span style={text}>{name}</span>
}
