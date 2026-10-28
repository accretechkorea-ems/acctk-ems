'use client'

// 담당자 — 카드 하나 안에 목록으로 쌓는다.
// 담당자마다 카드를 만들면 좌측 열이 사람 수만큼 길어지므로,
// 카드는 하나로 두고 구분선으로 항목을 나눈다(추가 버튼도 같은 카드의 마지막 줄).
//
// 기본은 두 명까지만 편다. 왼쪽 열은 sticky 라 화면 높이만큼만 쓰고(.cust-left 의
// max-height), 그 아래는 열 안에서 스크롤해야 나온다 — 세 명째부터 「잘린 것처럼」 보였다.
// 더 있으면 [N명 더 보기] 로 펼친다.
//
// **펼쳤을 때는 목록만 스크롤한다.** 담당자가 여럿인 업체에서 펼치면 카드가 왼쪽 열보다
// 길어져, 더 보기 줄이 열 바닥에 걸려 겹쳐 보이고 잘렸다. 목록에 제 높이를 주면
// (LIST_MAX) 그 줄은 늘 카드 안에 남는다.
//
// 카드 높이를 줄인 자리(2026-10-28) — 왼쪽 열에는 이 카드 아래로 장비·이력이 더 붙는다:
//   · 추가는 **제목 줄 오른쪽 아이콘 하나**로 옮겼다(한 줄 전부를 쓰던 버튼을 걷었다).
//   · 더 보기는 테두리 있는 버튼 줄이 아니라 작은 글자 한 줄로 둔다.
//   · 담당자 한 명의 상하 여백을 11 → 7 로 줄였다. **글자 크기는 건드리지 않는다** —
//     전화·메일을 누르는 자리라 작아지면 안 된다.

import { useState } from 'react'
import type { Contact } from './types'

/** 접었을 때 보이는 담당자 수. 이보다 많을 때만 더 보기 줄이 생긴다. */
const VISIBLE = 2
/** 펼쳤을 때 목록이 쓰는 최대 높이(px). 넘치면 목록 안에서 스크롤한다 — 네 줄 남짓이다. */
const LIST_MAX = 300

type Props = {
  contacts: Contact[]
  onAdd: () => void
  onEdit: (contact: Contact) => void
}

const BORDER = '#ebebeb'
/**
 * 제목 줄을 닫는 선의 위아래 여백(px). 제목 10 · 첫 사람 10 으로 같다.
 *
 * 홈 카드(DashCard)의 CARD_HEAD_STYLE 을 쓰지 않는다 — 그쪽은 격자가 카드 높이를 정해
 * 머리 높이를 42 로 못 박고 좌우 16, 선 아래 12(CARD_BODY_STYLE)를 쓴다. 이 카드는
 * 격자에 들지 않고(왼쪽 열 한 칸), 좌우는 담당자 줄과 같은 14 라야 글자가 선다. 28px
 * 아이콘이 들어가 42 에도 맞지 않는다(10+28+10=48). 그래서 치수를 따로 둔다.
 */
const GAP = 10

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
        // 상하 7 — 좌우(14)보다 좁다. 이름·전화·메일 세 줄이 한 덩어리로 읽히고,
        // 사람 사이는 구분선이 가른다(여백으로 가르지 않는다).
        //
        // 첫 사람만 위를 10 으로 띄운다 — 바로 위 선은 사람 사이를 가르는 선이 아니라
        // 제목 줄을 닫는 선이고, 그 선의 위아래(제목 10 · 첫 사람 10)를 같게 둔다.
        padding: `${first ? GAP : 7}px 14px 7px`,
        borderTop: first ? 'none' : `1px solid ${BORDER}`,
        position: 'relative',
      }}
    >
      {/* 수정 — 행에 마우스를 올렸을 때만 보인다(자리는 유지되므로 높이가 흔들리지 않는다) */}
      <button
        onClick={onEdit}
        onMouseEnter={() => setBtnHover(true)}
        onMouseLeave={() => setBtnHover(false)}
        aria-label="고객 담당자 수정"
        style={{
          position: 'absolute', top: first ? GAP : 7, right: 14,
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
  const [expanded, setExpanded] = useState(false)
  const hidden = Math.max(0, contacts.length - VISIBLE)
  const shown = expanded ? contacts : contacts.slice(0, VISIBLE)

  return (
    <div style={{ background: '#ffffff', border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>

      {/* 제목 줄 — 추가는 오른쪽 끝 아이콘 하나다. 카드 맨 아래 한 줄을 쓰던 버튼을
          여기로 들였다: 추가는 이 카드에 대한 동작이라 제목과 같은 줄이 제 자리고,
          한 줄(41px)을 돌려받는다. 세로 여백은 아이콘(28)에 맞춰 9 로 줄였다.

          아래는 **사람 사이와 같은 선**(1px ${BORDER})으로 닫는다 — 제목 줄과 첫 사람이
          붙어 있어 어디까지가 머리인지 보이지 않았다. 선은 이 줄에 붙여 둔다(목록 쪽이
          아니라): 펼치면 목록만 스크롤하므로 목록에 두면 선이 함께 밀려 올라간다. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: `9px 14px ${GAP}px`, borderBottom: `1px solid ${BORDER}`,
      }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#111827' }}>고객 담당자</h2>
        {contacts.length > 0 && (
          <span style={{ fontSize: 12, color: '#9ca3af' }}>총 {contacts.length}명</span>
        )}
        <button
          onClick={onAdd}
          aria-label="담당자 추가" title="담당자 추가"
          style={{
            marginLeft: 'auto', flexShrink: 0,
            width: 28, height: 28, padding: 0, boxSizing: 'border-box',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'transparent', border: `1px solid ${BORDER}`, borderRadius: 6,
            cursor: 'pointer', color: '#234ea2',
            transition: 'background 0.15s ease, border-color 0.15s ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#fafafa'; e.currentTarget.style.borderColor = '#234ea2' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = BORDER }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>

      {/* 펼쳤을 때만 높이를 준다 — 접힌 두 줄은 그대로 흐른다(스크롤 자리를 만들지 않는다). */}
      <style>{`
        .contact-list { scrollbar-width: thin; scrollbar-color: #d1d5db transparent; }
        .contact-list::-webkit-scrollbar { width: 5px; }
        .contact-list::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 3px; }
        .contact-list::-webkit-scrollbar-track { background: transparent; }
      `}</style>
      <div className="contact-list" style={expanded ? { maxHeight: LIST_MAX, overflowY: 'auto' } : undefined}>
        {shown.map((c, i) => (
          <ContactRow key={c.contact_id} contact={c} first={i === 0} onEdit={() => onEdit(c)} />
        ))}
      </div>

      {/* 더 보기 — 두 명 이하면 아예 두지 않는다(누를 것이 없는 줄을 만들지 않는다).
          테두리 있는 버튼 줄이 아니라 **작은 글자 한 줄**이다: 목록을 접었다 펴는 일은
          담당자를 고치거나 더하는 일보다 가벼워 그만큼 조용해야 하고, 위아래 여백(4)을
          최소로 둬 카드가 길어지지 않는다. 구분선은 남긴다 — 목록의 끝을 알린다. */}
      {hidden > 0 && (
        <button
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          style={{
            width: '100%', padding: '4px 0', boxSizing: 'border-box',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
            background: 'transparent', border: 'none', borderTop: `1px solid ${BORDER}`,
            cursor: 'pointer', color: '#9ca3af', fontSize: 12, fontWeight: 500,
            fontFamily: 'inherit', transition: 'color 0.15s ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#6b7280' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = '#9ca3af' }}
        >
          {expanded ? '접기' : `${hidden}명 더 보기`}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            {expanded ? <polyline points="18 15 12 9 6 15" /> : <polyline points="6 9 12 15 18 9" />}
          </svg>
        </button>
      )}
    </div>
  )
}
