'use client'

// 담당자 — 카드 하나 안에 목록으로 쌓는다.
// 담당자마다 카드를 만들면 좌측 열이 사람 수만큼 길어지므로,
// 카드는 하나로 두고 구분선으로 항목을 나눈다(추가 버튼도 같은 카드의 마지막 줄).

import { useState } from 'react'
import type { Contact } from './types'

type Props = {
  contacts: Contact[]
  onAdd: () => void
  onEdit: (contact: Contact) => void
}

const BORDER = '#ebebeb'

function ContactRow({ contact, onEdit, first }: { contact: Contact; onEdit: () => void; first: boolean }) {
  const [hovered, setHovered] = useState(false)
  const [btnHover, setBtnHover] = useState(false)

  const position = contact.position?.trim()
  const department = contact.department?.trim()

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '11px 14px',
        borderTop: first ? 'none' : `1px solid ${BORDER}`,
        position: 'relative',
      }}
    >
      {/* 수정 — 행에 마우스를 올렸을 때만 보인다(자리는 유지되므로 높이가 흔들리지 않는다) */}
      <button
        onClick={onEdit}
        onMouseEnter={() => setBtnHover(true)}
        onMouseLeave={() => setBtnHover(false)}
        aria-label="담당자 수정"
        style={{
          position: 'absolute', top: 11, right: 14,
          padding: 0, background: 'none', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          visibility: hovered ? 'visible' : 'hidden',
          color: btnHover ? '#234ea2' : '#9ca3af',
          transition: 'color 0.15s ease',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      </button>

      {/* 이름 · 직급 · 부서를 한 줄로 합쳐 줄 수를 줄인다 */}
      <div style={{ fontSize: 15, fontWeight: 600, color: '#111827', paddingRight: 26, display: 'flex', alignItems: 'baseline', gap: 5, flexWrap: 'wrap' }}>
        {contact.name ?? '-'}
        {position && <span style={{ fontSize: 12, fontWeight: 500, color: '#9ca3af' }}>{position}</span>}
        {department && (
          <span style={{ fontSize: 12, fontWeight: 500, color: '#6b7280' }}>
            <span style={{ color: '#d1d5db' }}>· </span>{department}
          </span>
        )}
      </div>

      {/* 전화번호 — 값 없으면 렌더 안 함 */}
      {contact.phone && (
        <a
          href={`tel:${contact.phone}`}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            fontSize: 13, color: '#234ea2', fontWeight: 600,
            textDecoration: 'none', marginTop: 5,
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.59A2 2 0 012 .01h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 7.91a16 16 0 006.29 6.29l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
          </svg>
          {contact.phone}
        </a>
      )}

      {/* 이메일 — 값이 없으면 행 자체를 렌더링하지 않음 */}
      {contact.email && (
        <a
          href={`mailto:${contact.email}`}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            fontSize: 12, color: '#9ca3af', fontWeight: 500,
            textDecoration: 'none', marginTop: 2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ flexShrink: 0 }}>
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
            <polyline points="22,6 12,13 2,6" />
          </svg>
          {contact.email}
        </a>
      )}
    </div>
  )
}

export default function ContactSection({ contacts, onAdd, onEdit }: Props) {
  return (
    <div style={{ background: '#ffffff', border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px' }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#111827' }}>담당자</h2>
        {contacts.length > 0 && (
          <span style={{ fontSize: 12, color: '#9ca3af' }}>총 {contacts.length}명</span>
        )}
      </div>

      {contacts.map((c, i) => (
        <ContactRow key={c.contact_id} contact={c} first={i === 0} onEdit={() => onEdit(c)} />
      ))}

      {/* 추가 — 목록의 마지막 줄. 담당자가 없을 때도 이 줄만 남는다. */}
      <button
        onClick={onAdd}
        style={{
          width: '100%', padding: '10px 0', boxSizing: 'border-box',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          background: 'transparent', border: 'none', borderTop: `1px solid ${BORDER}`,
          cursor: 'pointer', color: '#234ea2', fontSize: 13, fontWeight: 600,
          transition: 'background 0.15s ease, border-color 0.15s ease',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = '#fafafa'; e.currentTarget.style.borderTopColor = '#234ea2' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderTopColor = BORDER }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        담당자 추가
      </button>
    </div>
  )
}
