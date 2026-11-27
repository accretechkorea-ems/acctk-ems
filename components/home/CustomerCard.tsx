'use client'

import { useState } from 'react'
import { getDeviceLines, type Customer, type Device } from '@/lib/home'
import { DIRECT_SALE_LABEL } from '@/lib/customerAgency'
import { R } from '@/lib/radius'
import { companyHref, popupTitle, siteHref } from '@/lib/mapPopup'

const STATUS_COLOR: Record<string, string> = {
  '활성': '#22c55e',
  '잠재': '#f59e0b',
  '이탈': '#f43f5e',
}

type Props = {
  customer: Customer
  devices: Device[]
  onMove: () => void
  onDetailClick: () => void
}

/** 폰에서 장비 줄을 **두 줄**로 줄인다(그 아래는 「외 N대 더」가 말한다). */
const CARD_CSS = `
  /* 넓은 화면 — 넷까지 보이고 「외 N대 더」는 넷을 뺀 수다. */
  .cc-more-narrow { display: none; }
  @media (max-width: 768px) {
    /* 폰 — 두 줄까지. 셋째·넷째 줄과 넓은 화면용 꼬리말을 감추고 폰용 꼬리말을 낸다. */
    .cc-dev-extra { display: none; }
    .cc-more-wide { display: none; }
    .cc-more-narrow { display: inline; }
  }
`

export default function CustomerCard({ customer, devices, onMove, onDetailClick }: Props) {
  const [hovered, setHovered] = useState(false)
  const deviceLines = getDeviceLines(devices)
  const statusColor = STATUS_COLOR[customer.status ?? ''] ?? '#9ca3af'
  const hasNoDevice = deviceLines.length === 1 && deviceLines[0] === '-'
  /** 제목 두 토막과 회사로 가는 길 — 지도 팝업과 **같은 규칙**이다(lib/mapPopup.ts). */
  const title = popupTitle(customer)
  const companyUrl = companyHref(customer)

  return (
    <div
      className="ems-pick"
      onClick={onMove}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '100%',
        // 카드 사이 간격은 **목록의 gap** 이 정한다 — 여기서 margin 을 주면 그림자가 겹친다.
        borderRadius: R.card,
        // 테두리는 **공용 링**이 올린다(2026-11-26 묶음2 D) — hovered 는 카드 안의
        // 다른 것(단추 띄우기)에도 쓰이므로 상태는 그대로 둔다.
        border: '1px solid #ebebeb',
        background: '#ffffff',
        // 지도 위에 떠 있는 카드라 그림자로 띄운다(2026-11-20).
        // 호버에 **움직임을 주지 않는다** — 구르는 칸이 위를 잘라 맨 위 카드만 잘려 보였다.
        // 떠오르는 느낌은 그림자를 키워 낸다.
        boxShadow: hovered ? '0 8px 24px rgba(0,0,0,0.16)' : '0 4px 16px rgba(0,0,0,0.10)',
        cursor: 'pointer',
        boxSizing: 'border-box',
        padding: '14px 16px',
        minWidth: 0,
        transition: 'box-shadow 0.15s ease, border-color 0.15s ease',
      }}
    >
      {/* 폰에서 장비 줄을 두 줄로 줄이는 규칙. 글자가 같아 브라우저가 한 벌로 묶는다. */}
      <style>{CARD_CSS}</style>
      {/* 헤더: 「**회사명** » 사업장명」 + 상태 (2026-11-28, 야간4 6-2).
          지도 팝업과 **같은 규칙**이다(lib/mapPopup.ts) — 두 자리가 같은 업체를 서로 다르게
          부르면 같은 곳인지 매번 맞춰 봐야 한다. 회사명은 점선 밑줄 링크다. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}>
        <div style={{
          fontWeight: 800, color: '#111827', fontSize: 17, letterSpacing: '-0.3px',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
        }}>
          {companyUrl
            ? (
              <a
                href={companyUrl}
                onClick={e => { e.stopPropagation() }}
                title={`${title.company} 회사 화면으로`}
                style={{
                  color: '#111827', textDecoration: 'underline',
                  textDecorationStyle: 'dotted', textUnderlineOffset: 3,
                }}
              >
                {title.company}
              </a>
            )
            : (title.company || '-')}
          {title.site && (
            <span style={{ color: '#6b7280', fontWeight: 600 }}>{' » '}{title.site}</span>
          )}
        </div>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          fontSize: 11, fontWeight: 600, color: '#4b5563',
          flexShrink: 0, whiteSpace: 'nowrap',
        }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
          {customer.status ?? '-'}
        </span>
      </div>

      {/* 주소 */}
      <div style={{
        fontSize: 12,
        color: customer.address ? '#4b5563' : '#ef4444',
        fontWeight: customer.address ? 400 : 600,
        lineHeight: 1.45, marginBottom: 4,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {customer.address ?? '주소 정보 없음 — 등록 필요'}
      </div>

      {/* 대리점 — 없으면 「직판」(lib/customerAgency.ts). 전에는 '-' 였는데, 빈칸과
          「대리점을 안 거친 건」이 구별되지 않아 '-' 가 두 뜻으로 읽혔다. */}
      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 8 }}>
        대리점 {customer.agency_name ?? DIRECT_SALE_LABEL}
      </div>

      {/* 장비 태그 — 최대 4개, 5개 이상은 「외 N대 더」. **마지막 줄 오른쪽 끝**에
          「상세보기 ›」를 같은 높이로 붙여 한 줄을 아낀다(2026-11-20).
          폰에서는 **두 줄까지**만 보여 준다(2026-11-25) — 장비가 많은 사업장은 카드가
          화면 한 장을 넘겨, 목록을 훑는 일이 되지 않았다. 나머지 수는 「외 N대 더」가 말한다. */}
      <div className="cc-dev-row" style={{ display: 'flex', alignItems: 'flex-end', gap: 8, minWidth: 0 }}>
      <div className="cc-dev" style={{
        flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3,
      }}>
        {hasNoDevice ? (
          <span style={{ fontSize: 11, color: '#6b7280', fontStyle: 'italic' }}>장비 없음</span>
        ) : (
          <>
            {deviceLines.slice(0, 4).map((line, i) => (
              <span key={i} className={i >= 2 ? 'cc-dev-extra' : undefined} style={{
                fontSize: 11, color: '#234ea2', fontWeight: 600,
                whiteSpace: 'nowrap', maxWidth: '100%',
                overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {line}
              </span>
            ))}
            {/* 꼬리말 둘 — 넓은 화면은 넷, 폰은 둘을 뺀 수다. 보이는 것은 하나뿐이다. */}
            {deviceLines.length > 4 && (
              <span className="cc-more-wide" style={{ fontSize: 11, fontWeight: 500, color: '#6b7280' }}>
                외 {deviceLines.length - 4}대 더
              </span>
            )}
            {deviceLines.length > 2 && (
              <span className="cc-more-narrow" style={{ fontSize: 11, fontWeight: 500, color: '#6b7280' }}>
                외 {deviceLines.length - 2}대 더
              </span>
            )}
          </>
        )}
      </div>
        {/* 우하단 하나 — 「사업장 상세 ›」(2026-11-28, 야간4 6-2). 글자를 「상세보기」에서
            바꾼 까닭: 제목에 회사 링크가 생겨, 「상세보기」가 회사 것인지 사업장 것인지
            흐려졌다. 가는 곳도 분할 보기다 — 단독 상세 페이지로 보내지 않는다(7절). */}
        <a
          href={siteHref(customer)}
          onClick={(e) => { e.stopPropagation(); onDetailClick() }}
          onMouseEnter={(e) => { const el = e.currentTarget; el.style.color = '#1c3e87'; el.style.transform = 'scale(1.06)' }}
          onMouseLeave={(e) => { const el = e.currentTarget; el.style.color = '#234ea2'; el.style.transform = 'scale(1)' }}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            fontSize: 12, fontWeight: 600, color: '#234ea2',
            whiteSpace: 'nowrap', flexShrink: 0,
            padding: '2px 4px',
            transformOrigin: 'right center',
            transition: 'color 0.15s ease, transform 0.15s ease',
            textDecoration: 'none',
          }}
        >
          사업장 상세
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </a>
      </div>
    </div>
  )
}
