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
const SUB = '#4b5563'
const MUTED = '#6b7280'

/** 담당자 칩 한 줄 높이와 사이 간격. 두 줄까지 보이는 높이를 이 값으로 셈한다. */
const CHIP_H = 30
const CHIP_GAP = 8
const TWO_ROWS = CHIP_H * 2 + CHIP_GAP

/** 두 칸 사이(세로선 양쪽) 여백. */
const COL_GAP = 18
/** 상태 뱃지와 세로선 사이 여백 — 지시값 12. */
const STATUS_RULE_GAP = 12
/**
 * 제목 줄이 상태 뱃지 아래로 흘러들지 않게 비워 두는 폭.
 * 뱃지는 「● 활성」 꼴이라 45px 안팎이다(dot 8 + 간격 5 + 두 글자).
 */
export const STATUS_RESERVE = 56

/** 상태 dot 색 — 사업장·대리점이 같은 표를 쓴다. */
const STATUS_DOT: Record<string, string> = { '활성': '#16a34a', '잠재': '#f59e0b', '이탈': '#ef4444' }

/** 메모 줄 높이를 모를 때 쓰는 값(13px · 1.6). 실제로는 재서 쓴다. */
const MEMO_LINE_FALLBACK = 21

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
  /**
   * 상태(「활성」·「잠재」·「이탈」) — **좌 칸의 우상단에 고정**한다(2026-11-21).
   *
   * 전에는 제목 줄 흐름에 섞여 있어, 「사업장명 입력 필요」 같은 경고 태그가 서면
   * 그만큼 오른쪽으로 밀렸다(줄이 넘치면 아랫줄로 떨어지기도 했다). 상태는 늘 같은
   * 자리에 있어야 눈이 그 자리를 찾는다. 값이 없으면 그리지 않는다.
   */
  status?: string | null
  /** 우상단 ✎ — 수정 창을 연다. */
  onEdit: () => void
  editLabel: string
  onAddContact: () => void
  onEditContact: (c: Contact) => void
  /** 바깥에서 붙이는 class(화면별 CSS·실측이 쓴다). */
  className?: string
}

export default function HeaderBand({
  left, contacts, memoTitle, memo, status, onEdit, editLabel, onAddContact, onEditContact, className,
}: HeaderBandProps) {
  /** 담당자 칩을 전부 펼쳤는가. 접힌 상태에서는 두 줄까지만 보인다. */
  const [openContacts, setOpenContacts] = useState(false)
  /** 접었을 때 가려지는 칩 수 — 「더보기 +N」 의 N. 0 이면 버튼을 내지 않는다. */
  const [hidden, setHidden] = useState(0)
  /**
   * 메모를 몇 줄까지 보여 줄까 — **담당자 줄이 쓰고 남은 높이**가 정한다(2026-11-21).
   * 칩이 한 줄이면 두세 줄, 두 줄이면 한 줄이다. 처음 값은 한 줄이다(재기 전에 넘치는
   * 모습을 보여 주지 않는다).
   */
  const [memoLines, setMemoLines] = useState(1)
  /** 그래도 넘쳤는가 — 넘칠 때만 손을 올려 전체를 본다. */
  const [memoOver, setMemoOver] = useState(false)
  const chipsRef = useRef<HTMLDivElement | null>(null)
  const contactRowRef = useRef<HTMLDivElement | null>(null)
  const memoRef = useRef<HTMLSpanElement | null>(null)

  /**
   * **그려 본 뒤**에만 알 수 있는 둘을 한 자리에서 센다.
   *   ① 두 줄 밖으로 밀린 칩 수 — 「더보기 +N」 의 N.
   *   ② 메모가 쓸 수 있는 줄 수 — 카드 안쪽 높이에서 담당자 줄을 뺀 만큼.
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
        if (chips.length === 0) setHidden(0)
        else {
          const top0 = chips[0].offsetTop
          setHidden(chips.filter(el => el.offsetTop - top0 > CHIP_H + CHIP_GAP).length)
        }

        const memo = memoRef.current
        const row = contactRowRef.current
        if (!memo || !row) return
        // 폰에서는 높이 고정을 풀고 전부 펼친다 — 셈할 것이 없다.
        const fixed = window.matchMedia(`(min-width: ${TOP_CARD_FIXED_MIN_WIDTH}px)`).matches
        if (!fixed) { setMemoLines(0); setMemoOver(false); return }
        const lh = parseFloat(getComputedStyle(memo).lineHeight) || MEMO_LINE_FALLBACK
        // 카드 안쪽 높이 = 고정 높이 − 위아래 여백. 거기서 담당자 줄과 줄 사이를 뺀다.
        const avail = TOP_CARD_HEIGHT - 14 - 12 - row.getBoundingClientRect().height - 10
        setMemoLines(Math.max(1, Math.floor((avail + 1) / lh)))
        setMemoOver(memo.scrollHeight > memo.clientHeight + 1)
      })
    }
    count()
    const ro = new ResizeObserver(count)
    ro.observe(box)
    if (contactRowRef.current) ro.observe(contactRowRef.current)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [contacts, openContacts, memo, memoLines])

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
          .pane-band .band-memo {
            display: block !important; white-space: pre-wrap !important;
            overflow: visible !important; word-break: break-word;
            -webkit-line-clamp: unset !important;
          }
          /* 세로선이 없으므로 상태는 칸 오른쪽 끝에 붙는다. */
          .pane-band .band-status { right: 0 !important }
        }
      `}</style>

      {/* 수정 — 카드 우상단. 호버·포커스에서만 보인다(자리는 늘 있다). */}
      <span className="edit1" style={{ position: 'absolute', top: 12, right: 12, zIndex: 1 }}>
        <EditIconButton label={editLabel} onClick={onEdit} />
      </span>

      {/* ── 좌: 누구인가 ── 상태는 이 칸의 우상단에 **붙어 있다**(흐름에서 뺐다) ── */}
      <div style={{ minWidth: 0, position: 'relative' }}>
        {left}
        {status && (
          <span className="band-status"
            style={{
              position: 'absolute', top: 0,
              // 칸 밖으로 (18−12)=6 만큼 내밀어 **세로선과의 여백이 12** 가 되게 한다.
              right: -(COL_GAP - STATUS_RULE_GAP),
              display: 'inline-flex', alignItems: 'center', gap: 5,
              fontSize: 13, color: SUB, whiteSpace: 'nowrap',
            }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_DOT[status] ?? MUTED }} />
            {status}
          </span>
        )}
      </div>

      <div className="band-rule" />

      {/* ── 우: 누구와 일하는가 — 라벨 열을 고정해 칩 시작 x 를 맞춘다 ── */}
      <div className="band-right" style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0, paddingRight: 36 }}>
        <div ref={contactRowRef} style={{ display: 'grid', gridTemplateColumns: '44px minmax(0, 1fr)', gap: '0 8px', alignItems: 'start', fontSize: 13 }}>
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
            담당자 줄이 쓰고 **남는 높이만큼 줄바꿈**한다(위 memoLines). 그래도 넘치면
            마지막 줄이 말줄임되고, 그때만 손을 300ms 올려 전체를 본다. */}
        <div style={{ display: 'grid', gridTemplateColumns: '44px minmax(0, 1fr)', gap: '0 8px', alignItems: 'start', fontSize: 13, color: LABEL }}>
          <span style={{ color: MUTED }}>메모</span>
          {hasMemo(memo) ? (
            <MemoHoverText
              className="band-memo"
              title={memoTitle}
              value={memo}
              hover={memoOver}
              textRef={el => { memoRef.current = el }}
              style={{
                display: '-webkit-box', WebkitBoxOrient: 'vertical',
                // 0 이면 폰이다 — 자르지 않는다(아래 미디어 규칙이 펼친다).
                WebkitLineClamp: memoLines > 0 ? memoLines : undefined,
                overflow: 'hidden', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                color: LABEL, outline: 'none', cursor: 'default',
              }}
            />
          ) : <span />}
        </div>
      </div>
    </section>
  )
}
