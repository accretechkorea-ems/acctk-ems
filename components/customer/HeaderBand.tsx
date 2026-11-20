'use client'

/**
 * 화면 **맨 위 카드 한 장**의 틀 — 좌(누구인가)·우(누구와 일하는가)를 5:5 로 나눈다.
 *
 * ── 왜 틀을 따로 두는가(2026-11-21) ──────────────────────────────────────
 *   사업장 화면에서 만든 모양을 **대리점 화면**이 그대로 쓴다. 우 칸(담당자 칩 ·
 *   메모)은 두 화면이 글자 하나까지 같고, 칩이 두 줄을 넘는지 세는 일은 그려 본
 *   뒤에만 알 수 있어 코드가 짧지 않다(ResizeObserver). 두 벌로 두면 한쪽만
 *   고쳐지는 날이 온다. 좌 칸만 화면마다 다르므로 그것만 받는다.
 *
 *   가운데 세로선은 카드 **위에서 아래까지** 긋는다(안쪽 여백까지 가로질러야
 *   두 칸이 하나의 카드를 나눈 것으로 보인다).
 *
 * ── 높이 ──────────────────────────────────────────────────────────────────
 *   좌 패널의 상단 카드와 **같은 높이**로 못 박는다(TOP_CARD_HEIGHT).
 *   담당자 칩 두 줄 + 더보기가 그 안에 들어간다(2026-11-21 실측).
 *   폰에서는 고정을 풀고 두 칸을 위아래로 쌓는다.
 *
 * 연필은 **호버·포커스에서만** 보이고 **자리는 늘 차지한다**(opacity 만 바뀐다).
 * 평소에는 글자만 남아 조용하고, 눌러야 할 때는 늘 같은 자리에 있다.
 * 폰(≤640)에서는 호버가 없으므로 항상 보인다.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AddIconButton, EditIconButton } from '@/components/common/IconButton'
import { hasMemo } from '@/components/common/MemoPopover'
import MemoHoverText from '@/components/common/MemoHoverText'
import { TOP_CARD_HEIGHT, TOP_CARD_FIXED_MIN_WIDTH } from '@/components/home/SidePanel'
import { R } from '@/lib/radius'
import type { Contact } from './types'

const BORDER = '#ebebeb'
const TEXT = '#111827'
const LABEL = '#374151'
const SUB = '#6b7280'
const MUTED = '#9ca3af'

/** 담당자 칩 한 줄 높이와 사이 간격. 두 줄까지 보이는 높이를 이 값으로 셈한다. */
const CHIP_H = 30
const CHIP_GAP = 8
const TWO_ROWS = CHIP_H * 2 + CHIP_GAP

/**
 * 담당자 한 칸 — 「이름 직급 · 부서 전화 ✎」. 부서가 없으면 직급만 적는다.
 * 이메일은 넣지 않는다(칩이 한 줄을 넘는다) — 도움말과 수정 창에 그대로 있다.
 */
function ContactChip({ c, onEdit }: { c: Contact; onEdit: () => void }) {
  const tip = [c.name, c.position, c.department, c.phone, c.email].filter(Boolean).join(' · ')
  const role = [c.position, c.department].map(v => (v ?? '').trim()).filter(Boolean).join(' · ')
  return (
    <span className="chip-c" title={tip}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, height: CHIP_H, padding: '0 6px 0 10px',
        border: `1px solid ${BORDER}`, borderRadius: R.control, background: '#fafafa',
        fontSize: 13, whiteSpace: 'nowrap',
      }}>
      <b style={{ fontWeight: 600, color: TEXT }}>{c.name?.trim() || '이름 없음'}</b>
      {role && <span style={{ fontSize: 12, color: SUB }}>{role}</span>}
      {c.phone && (
        <a href={`tel:${c.phone.replace(/[^0-9+]/g, '')}`} onClick={e => e.stopPropagation()}
          style={{ fontSize: 12, color: '#234ea2', textDecoration: 'none' }}>
          {c.phone}
        </a>
      )}
      <span className="edit2">
        <EditIconButton size={22} label={`${c.name ?? '담당자'} 수정`} onClick={onEdit}
          style={{ border: 'none', background: 'transparent' }} />
      </span>
    </span>
  )
}

export type HeaderBandProps = {
  /** 좌 칸 — 누구인가. 화면마다 다르다(사업장: 회사 » 사업장, 대리점: 대리점명). */
  left: ReactNode
  contacts: Contact[]
  /** 메모 툴팁의 제목 줄 — 어느 건의 메모인지. */
  memoTitle: string
  memo?: string | null
  /** 우상단 ✎ — 수정 창을 연다. */
  onEdit: () => void
  editLabel: string
  onAddContact: () => void
  onEditContact: (c: Contact) => void
  /** 바깥에서 붙이는 class(화면별 CSS·실측이 쓴다). */
  className?: string
}

export default function HeaderBand({
  left, contacts, memoTitle, memo, onEdit, editLabel, onAddContact, onEditContact, className,
}: HeaderBandProps) {
  /** 담당자 칩을 전부 펼쳤는가. 접힌 상태에서는 두 줄까지만 보인다. */
  const [openContacts, setOpenContacts] = useState(false)
  /** 접었을 때 가려지는 칩 수 — 「더보기 +N」 의 N. 0 이면 버튼을 내지 않는다. */
  const [hidden, setHidden] = useState(0)
  const chipsRef = useRef<HTMLDivElement | null>(null)

  /**
   * 두 줄 밖으로 밀린 칩이 몇 개인가 — **그려 본 뒤**에만 알 수 있다.
   * 칸 폭이 바뀌면 다시 센다(ResizeObserver). setState 는 rAF 안에서 부른다 —
   * 효과 안에서 곧바로 부르면 한 번 그린 것을 그 자리에서 다시 그리게 된다.
   */
  useEffect(() => {
    const box = chipsRef.current
    if (!box) return
    let raf = 0
    const count = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const chips = [...box.querySelectorAll<HTMLElement>('[data-chip]')]
        if (chips.length === 0) { setHidden(0); return }
        const top0 = chips[0].offsetTop
        setHidden(chips.filter(el => el.offsetTop - top0 > CHIP_H + CHIP_GAP).length)
      })
    }
    count()
    const ro = new ResizeObserver(count)
    ro.observe(box)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [contacts, openContacts])

  return (
    <section className={className ? `pane-band ${className}` : 'pane-band'}
      style={{
        background: '#ffffff', border: `1px solid ${BORDER}`, borderRadius: R.card,
        padding: '14px 18px 12px', position: 'relative', boxSizing: 'border-box',
      }}>
      <style>{`
        /* flex-shrink:0 — 아래에 큰 표가 선 화면(대리점: 187줄)에서는 세로 flex 가
           이 카드부터 줄여 버린다(2026-11-21 실측: 137 → 41px). 상단 카드는 줄지 않는다. */
        .pane-band { display: grid; grid-template-columns: minmax(0, 1fr) 1px minmax(0, 1fr); gap: 0 18px; align-items: start; flex-shrink: 0 }
        /* 좌 패널의 상단 카드와 같은 높이 — 두 카드의 아랫선이 맞는다. */
        @media (min-width: ${TOP_CARD_FIXED_MIN_WIDTH}px) {
          .pane-band { height: ${TOP_CARD_HEIGHT}px; overflow: hidden }
        }
        /* 세로선은 카드의 안쪽 여백까지 가로질러 위·아래 끝에 닿는다. */
        .pane-band .band-rule { background: ${BORDER}; align-self: stretch; margin: -14px 0 -12px }
        /* 연필은 자리를 늘 차지하고 보이기만 바뀐다 — 나타날 때 글자가 밀리지 않게. */
        .pane-band .edit1, .pane-band .edit2 { opacity: 0; transition: opacity 0.15s ease }
        .pane-band:hover .edit1, .pane-band:focus-within .edit1 { opacity: 1 }
        .pane-band .chip-c:hover .edit2, .pane-band .chip-c:focus-within .edit2 { opacity: 1 }
        @media (max-width: 640px) {
          /* 폰에는 호버가 없다 — 늘 보인다. */
          .pane-band { grid-template-columns: minmax(0, 1fr); gap: 12px }
          .pane-band .band-rule { display: none }
          .pane-band .band-right { border-top: 1px solid ${BORDER}; padding-top: 12px }
          .pane-band .edit1, .pane-band .edit2 { opacity: 1 }
          /* 폰에는 호버가 없다 — 메모는 줄여 두지 않고 전부 보여 준다. */
          .pane-band .band-memo { white-space: pre-wrap !important; overflow: visible !important; word-break: break-word }
        }
      `}</style>

      {/* 수정 — 카드 우상단. 호버·포커스에서만 보인다(자리는 늘 있다). */}
      <span className="edit1" style={{ position: 'absolute', top: 12, right: 12, zIndex: 1 }}>
        <EditIconButton label={editLabel} onClick={onEdit} />
      </span>

      {/* ── 좌: 누구인가 ── */}
      <div style={{ minWidth: 0 }}>{left}</div>

      <div className="band-rule" />

      {/* ── 우: 누구와 일하는가 — 라벨 열을 고정해 칩 시작 x 를 맞춘다 ── */}
      <div className="band-right" style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0, paddingRight: 36 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '44px minmax(0, 1fr)', gap: '0 8px', alignItems: 'start', fontSize: 13 }}>
          <span style={{ color: MUTED, lineHeight: `${CHIP_H}px` }}>담당자</span>
          <div ref={chipsRef}
            style={{
              display: 'flex', flexWrap: 'wrap', gap: CHIP_GAP, minWidth: 0,
              maxHeight: openContacts ? undefined : TWO_ROWS, overflow: openContacts ? undefined : 'hidden',
            }}>
            {contacts.length === 0 && <span style={{ fontSize: 12, color: MUTED, lineHeight: `${CHIP_H}px` }}>없음</span>}
            {contacts.map(c => (
              <span key={c.contact_id} data-chip style={{ display: 'inline-flex' }}>
                <ContactChip c={c} onEdit={() => onEditContact(c)} />
              </span>
            ))}
            {/* 더보기 — 두 줄 밖으로 밀린 칩이 있을 때만. 펼치면 접기로 바뀐다. */}
            {(hidden > 0 || openContacts) && (
              <button type="button" onClick={() => setOpenContacts(v => !v)}
                style={{ height: CHIP_H, padding: '0 10px', border: `1px solid ${BORDER}`, borderRadius: R.control, background: '#ffffff', color: SUB, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                {openContacts ? '접기' : `더보기 +${hidden}`}
              </button>
            )}
            <AddIconButton size={CHIP_H} label="담당자 추가" onClick={onAddContact} />
          </div>
        </div>

        {/* 메모 — 같은 열 정렬. 없으면 **라벨만** 둔다(없다는 것을 아이콘으로 말하지 않는다).
            한 줄로 줄이고, 손을 300ms 올리면 기존 메모 판과 **같은 모양**으로 전부 뜬다. */}
        <div style={{ display: 'grid', gridTemplateColumns: '44px minmax(0, 1fr)', gap: '0 8px', alignItems: 'start', fontSize: 13, color: LABEL }}>
          <span style={{ color: MUTED }}>메모</span>
          {hasMemo(memo) ? (
            <MemoHoverText
              className="band-memo"
              title={memoTitle}
              value={memo}
              style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: LABEL, outline: 'none', cursor: 'default' }}
            />
          ) : <span />}
        </div>
      </div>
    </section>
  )
}
