'use client'

/**
 * 담당자 카드 — **한 벌만 있다** (2026-11-27, 묶음4 B).
 *
 * ── 왜 모았나 ────────────────────────────────────────────────────────────
 *   2026-11-25 에 PC 는 왼쪽 열의 **세로 카드**(V8)가 되었는데, 폰은 가로 띠의
 *   **칩**(이름 옆 ✎, 전화가 먼저)이 그대로 남아 두 벌이 되었다. 같은 담당자가
 *   화면 폭에 따라 다르게 보였고, 한쪽만 고치는 일이 되풀이됐다.
 *   그래서 **부품 하나**로 모으고 폭에 따라 **달라지는 것만** CSS 로 가른다.
 *
 * ── 한 사람의 생김새(어느 폭에서나 같다) ─────────────────────────────────
 *   윗줄  이름(600) + 직급 · 부서
 *   아랫줄 📱 휴대폰(없으면 ☎ 회사 전화) — `tel:`
 *          ✉ 이메일 — `mailto:`
 *   없으면 「—」 를 둔다. 자리를 비우면 「없다」가 아니라 「못 읽었다」로 읽힌다.
 *
 * ── 폭에 따라 갈리는 것 셋뿐 ─────────────────────────────────────────────
 *   ① 수정 — PC 는 호버·포커스에 ✎ 가 뜨고, 폰은 **카드를 누르면** 바로 열린다
 *      (폰에는 호버가 없다. 작은 ✎ 를 겨누게 하지 않는다).
 *   ② 접기 — 높이가 고정된 띠(HeaderBand)는 두 줄 넘치면 「더보기 +N」 으로 접는다.
 *      폰에서는 접지 않는다(`collapseTo` 를 주지 않으면 늘 전부 보인다).
 *   ③ ＋ — PC 는 머리줄 오른쪽의 아이콘, 폰은 목록 **아래 한 줄짜리 단추**다.
 *      아이콘 하나로는 폰에서 찾기 어렵다(2026-11-25 에 띠에서 배운 것).
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AddIconButton, EditIconButton } from '@/components/common/IconButton'
import { R } from '@/lib/radius'
import { BLUE, BORDER, CARD_BG, MUTED, NEUTRAL_BG, SUB, TEXT } from '@/components/common/ui'
import { DUPE_BADGE, DUPE_BG, DUPE_TEXT, dupeMarks, type DupeMark } from '@/lib/contactDupes'
import type { Contact } from './types'

/** 휴대폰. 회사 전화와 아이콘으로 가른다 — 글자로 적으면 줄이 길어진다. */
const SmartphoneGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="5" y="2" width="14" height="20" rx="2" ry="2" /><line x1="12" y1="18" x2="12.01" y2="18" />
  </svg>
)
const PhoneGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z" />
  </svg>
)
const MailGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 6L2 7" />
  </svg>
)

/** 카드 한 장의 최소 높이 — 폰에서 손가락이 닿는 크기(44)보다 커야 한다. */
const CARD_MIN_H = 44
/** 접을 때 보여 주는 높이 — 카드 두 장 + 사이 간격. */
const TWO_CARDS = 150

/** 이 부품이 쓰는 CSS. 폭으로 갈리는 셋(✎·＋·접기)만 여기 있다. */
export const CONTACT_LIST_CSS = `
  .ctl-card { position: relative; }
  /* 연필은 자리를 늘 차지하고 보이기만 바뀐다 — 나타날 때 글자가 밀리지 않게. */
  .ctl-edit { opacity: 0; transition: opacity 0.15s ease; }
  .ctl-card:hover .ctl-edit, .ctl-card:focus-within .ctl-edit { opacity: 1; }
  .ctl-add-wide { display: none; }
  @media (max-width: 767px) {
    /* 폰에는 호버가 없다 — ✎ 를 감추고 **카드를 누르면** 수정이 열린다. */
    .ctl-edit { display: none; }
    .ctl-card { min-height: ${CARD_MIN_H}px; }
    /* 접지 않는다 — 담당자는 폰에서 가장 자주 찾는 것이다. */
    .ctl-list { max-height: none !important; overflow: visible !important; }
    .ctl-more, .ctl-add-icon { display: none !important; }
    .ctl-add-wide { display: flex !important; }
  }
`

function ContactCard({ c, onEdit, dupe }: { c: Contact; onEdit: () => void; dupe?: DupeMark }) {
  const role = [c.position, c.department].map(v => (v ?? '').trim()).filter(Boolean).join(' · ')
  const mobile = (c.mobile ?? '').trim()
  const office = (c.phone ?? '').trim()
  const tel = mobile || office
  const email = (c.email ?? '').trim()
  const [hover, setHover] = useState(false)
  const link: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: BLUE,
    textDecoration: 'none', maxWidth: '100%', minWidth: 0,
  }

  return (
    <div
      className="ctl-card"
      // 폰 — 카드 아무 데나 누르면 수정이 열린다. 전화·이메일 링크는 자기 일을 하고
      // 여기까지 올라오지 않는다(아래 stopPropagation).
      role="button"
      tabIndex={0}
      aria-label={`${c.name?.trim() || '담당자'} 수정`}
      onClick={onEdit}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEdit() } }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: '8px 10px', borderRadius: R.control, cursor: 'pointer',
        display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0,
        background: hover ? NEUTRAL_BG : 'transparent', transition: 'background 0.15s ease',
      }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0, paddingRight: 24 }}>
        <b style={{ fontSize: 13, fontWeight: 600, color: TEXT, whiteSpace: 'nowrap' }}>{c.name?.trim() || '이름 없음'}</b>
        {/* 「중복?」 — 같은 휴대폰·이메일을 쓰는 줄이 또 있다(2026-11-26, 지시 N).
            **묻기만 한다** — 합치는 일은 사람이 보고 해야 한다(lib/contactDupes.ts). */}
        {dupe && (
          <span title={dupe.hint}
            style={{
              flexShrink: 0, fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: R.tag,
              background: DUPE_BG, color: DUPE_TEXT, cursor: 'help',
            }}>
            {DUPE_BADGE}
          </span>
        )}
        {role && (
          <span style={{ fontSize: 12, color: SUB, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {role}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
        {tel ? (
          <a href={`tel:${tel.replace(/[^0-9+]/g, '')}`} onClick={e => e.stopPropagation()} style={link} title={mobile ? '휴대폰' : '회사 전화'}>
            <span style={{ color: MUTED, display: 'inline-flex', flexShrink: 0 }}>
              {mobile ? <SmartphoneGlyph /> : <PhoneGlyph />}
            </span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tel}</span>
          </a>
        ) : (
          <span style={{ ...link, color: MUTED }}>
            <span style={{ display: 'inline-flex', flexShrink: 0 }}><SmartphoneGlyph /></span>—
          </span>
        )}
        {email ? (
          <a href={`mailto:${email}`} onClick={e => e.stopPropagation()} style={link} title="이메일">
            <span style={{ color: MUTED, display: 'inline-flex', flexShrink: 0 }}><MailGlyph /></span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</span>
          </a>
        ) : (
          <span style={{ ...link, color: MUTED }}>
            <span style={{ display: 'inline-flex', flexShrink: 0 }}><MailGlyph /></span>—
          </span>
        )}
      </div>
      {/* ✎ 는 칸 **오른쪽 위**에 붙인다 — 흐름에 두면 줄이 하나 더 생긴다. 폰에서는 숨는다. */}
      <span className="ctl-edit" style={{ position: 'absolute', top: 6, right: 6 }}>
        <EditIconButton size={22} label={`${c.name ?? '담당자'} 수정`} onClick={onEdit}
          style={{ border: 'none', background: 'transparent' }} />
      </span>
    </div>
  )
}

export type ContactListProps = {
  contacts: Contact[]
  onAdd: () => void
  onEdit: (c: Contact) => void
  /**
   * 넘치면 접을까. 높이가 고정된 띠(HeaderBand)만 준다 — 주면 PC 에서 카드 두 장까지
   * 보이고 나머지는 「더보기 +N」 이 된다. 폰에서는 주어도 접지 않는다(CSS 가 푼다).
   */
  collapsible?: boolean
  /** 머리줄의 ref — 띠가 메모 줄 수를 셈할 때 이 칸의 높이를 잰다. */
  listRef?: React.RefObject<HTMLDivElement | null>
}

export default function ContactList({ contacts, onAdd, onEdit, collapsible, listRef }: ContactListProps) {
  const dupes = useMemo(() => dupeMarks(contacts), [contacts])
  const [open, setOpen] = useState(false)
  const innerRef = useRef<HTMLDivElement | null>(null)
  const [hidden, setHidden] = useState(0)

  /**
   * 접는 자리에서 **몇 장이 밀렸는지** 센다 — 그려 본 뒤에만 알 수 있다.
   * setState 는 rAF 안에서 부른다: 효과 안에서 곧바로 부르면 한 번 그린 것을
   * 그 자리에서 다시 그리게 된다(띠의 메모 줄 수 셈과 같은 규칙).
   */
  useEffect(() => {
    const el = innerRef.current
    if (!el) return
    let raf = 0
    const count = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        if (!collapsible || open) { setHidden(0); return }
        const cards = [...el.querySelectorAll<HTMLElement>('[data-ctl-card]')]
        setHidden(cards.filter(c => c.offsetTop + c.offsetHeight > TWO_CARDS).length)
      })
    }
    count()
    const ro = new ResizeObserver(count)
    ro.observe(el)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [contacts, collapsible, open])

  return (
    <div ref={listRef}>
      <style>{CONTACT_LIST_CSS}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px 6px' }}>
        <b style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>담당자</b>
        <span className="num" style={{ fontSize: 12, color: MUTED }}>{contacts.length}</span>
        <span style={{ flex: 1 }} />
        <span className="ctl-add-icon" style={{ display: 'inline-flex' }}>
          <AddIconButton size={26} label="담당자 추가" onClick={onAdd} />
        </span>
      </div>

      {contacts.length === 0 ? (
        <div style={{ padding: '10px 10px 6px', fontSize: 12, color: MUTED }}>등록된 담당자가 없습니다</div>
      ) : (
        <div ref={innerRef} className="ctl-list"
          style={{
            maxHeight: collapsible && !open ? TWO_CARDS : undefined,
            overflow: collapsible && !open ? 'hidden' : undefined,
          }}>
          {contacts.map(c => (
            <div key={c.contact_id} data-ctl-card>
              <ContactCard c={c} onEdit={() => onEdit(c)} dupe={dupes.get(c.contact_id)} />
            </div>
          ))}
        </div>
      )}

      {collapsible && (hidden > 0 || open) && (
        <button type="button" className="ctl-more" onClick={() => setOpen(v => !v)}
          style={{
            margin: '4px 0 0 10px', padding: '4px 10px', border: `1px solid ${BORDER}`, borderRadius: R.control,
            background: CARD_BG, color: SUB, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
          }}>
          {open ? '접기' : `더보기 +${hidden}`}
        </button>
      )}

      {/* 폰 — 「＋ 담당자」는 목록 **바로 아래**에 늘 보인다(아이콘 하나로는 찾기 어렵다). */}
      <button type="button" className="ctl-add-wide" onClick={onAdd}
        style={{
          alignItems: 'center', justifyContent: 'center', gap: 6,
          width: '100%', minHeight: CARD_MIN_H, marginTop: 6,
          border: `1px dashed ${BORDER}`, borderRadius: R.control,
          background: CARD_BG, color: SUB, fontSize: 13, fontWeight: 700,
          cursor: 'pointer', fontFamily: 'inherit',
        }}>
        ＋ 담당자
      </button>
    </div>
  )
}
