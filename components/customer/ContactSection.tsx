'use client'

import { useState } from 'react'
import type { Contact } from './types'

type Props = {
  contacts: Contact[]
  onAdd: () => void
  onEdit: (contact: Contact) => void
}

function ContactCard({ contact, onEdit }: { contact: Contact; onEdit: () => void }) {
  const [hovered, setHovered] = useState(false)
  const [btnHover, setBtnHover] = useState(false)

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        minWidth: 240, maxWidth: 240, background: '#ffffff', borderRadius: 8, padding: '14px 16px',
        border: `1px solid ${hovered ? '#c7d7f8' : '#ebebeb'}`,
        flex: '0 0 auto', position: 'relative',
        transform: hovered ? 'translateY(-2px)' : 'translateY(0)',
        transition: 'transform 0.18s ease, border-color 0.18s ease',
      }}
    >
      <button
        onClick={onEdit}
        onMouseEnter={() => setBtnHover(true)}
        onMouseLeave={() => setBtnHover(false)}
        style={{
          position: 'absolute', top: 12, right: 12,
          padding: 0, background: 'none', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: btnHover ? '#234ea2' : '#9ca3af',
          transition: 'color 0.15s ease',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      </button>

      {/* 이름 + 직책 */}
      <div style={{ fontSize: 15, fontWeight: 600, color: '#111827', paddingRight: 30, display: 'flex', alignItems: 'baseline', gap: 6 }}>
        {contact.name ?? '-'}
        {contact.position && (
          <span style={{ fontSize: 12, fontWeight: 500, color: '#9ca3af' }}>
            {contact.position}
          </span>
        )}
      </div>

      {/* 부서 — 값 없으면 렌더 안 함 */}
      {contact.department?.trim() && (
        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
          {contact.department?.trim()}
        </div>
      )}

      {/* 전화번호 — 값 없으면 렌더 안 함 */}
      {contact.phone && (
        <a
          href={`tel:${contact.phone}`}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            fontSize: 13, color: '#234ea2', fontWeight: 600,
            textDecoration: 'none', marginTop: 8,
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
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#111827' }}>담당자</h2>
        {contacts.length > 0 && (
          <span style={{ fontSize: 12, color: '#9ca3af' }}>총 {contacts.length}명</span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'stretch', gap: 12, overflowX: 'auto', paddingBottom: 4 }}>
        {contacts.map((c) => (
          <ContactCard key={c.contact_id} contact={c} onEdit={() => onEdit(c)} />
        ))}

        {/* 추가 버튼 */}
        <button
          onClick={onAdd}
          style={{
            minWidth: 240, flex: '0 0 auto',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
            background: 'transparent', border: '1px dashed #d1d5db', borderRadius: 8,
            cursor: 'pointer', color: '#6b7280', fontSize: 13, fontWeight: 600,
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = '#9ca3af'
            e.currentTarget.style.background = '#fafafa'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = '#d1d5db'
            e.currentTarget.style.background = 'transparent'
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          담당자 추가
        </button>
      </div>
    </div>
  )
}
