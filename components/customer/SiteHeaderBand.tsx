'use client'

/**
 * 사업장 화면 **맨 위 카드 한 장** — 좌(업체)·우(담당자·메모)를 5:5 로 나눈다.
 *
 * ── 왜 이 모양인가(2026-11-20) ────────────────────────────────────────────
 *   세로 카드 둘을 왼쪽에 쌓던 때는 그 열이 가져간 300px 만큼 장비가 좁았다.
 *   가로로 눕히고 나서도 「주소·대리점·메모·장비 수·담당자」가 한 줄에 몰려
 *   줄이 어디서 끊길지 알 수 없었다. 이제 **두 칸**이다 —
 *     좌: 누구인가(회사 » 사업장 · 상태 / 주소 · 대리점)
 *     우: 누구와 일하는가(담당자 칩 / 메모)
 *   가운데 세로선은 카드 **위에서 아래까지** 긋는다(안쪽 여백까지 가로질러야
 *   두 칸이 하나의 카드를 나눈 것으로 보인다).
 *
 * 구분자는 » 다 — › 는 「다음」이고 » 는 「안으로」다. 회사 안의 사업장이라는 뜻.
 *
 * 연필은 **호버·포커스에서만** 보이고 **자리는 늘 차지한다**(opacity 만 바뀐다).
 * 평소에는 글자만 남아 조용하고, 눌러야 할 때는 늘 같은 자리에 있다.
 * 폰(≤640)에서는 호버가 없으므로 항상 보인다.
 *
 * 「장비 N」과 「폐기 포함」 토글은 여기 두지 않는다 — 장비 수는 카드를 세면
 * 보이고, 폐기 포함은 **사업장 수정 모달 안의 체크**로 옮겼다(2026-11-20).
 */

import { useEffect, useRef, useState } from 'react'
import { AddIconButton, EditIconButton } from '@/components/common/IconButton'
import BackIconButton from '@/components/common/BackIconButton'
import MemoPopover, { hasMemo } from '@/components/common/MemoPopover'
import { agencyLabelOf } from '@/lib/customerAgency'
import { R } from '@/lib/radius'
import type { Contact, Customer } from './types'

const BORDER = '#ebebeb'
const TEXT = '#111827'
const LABEL = '#374151'
const SUB = '#6b7280'
const MUTED = '#9ca3af'
const DANGER = '#ef4444'

const STATUS_DOT: Record<string, string> = { '활성': '#16a34a', '잠재': '#f59e0b', '이탈': '#ef4444' }

/** 담당자 칩 한 줄 높이와 사이 간격. 두 줄까지 보이는 높이를 이 값으로 셈한다. */
const CHIP_H = 30
const CHIP_GAP = 8
const TWO_ROWS = CHIP_H * 2 + CHIP_GAP

type Props = {
  customer: Customer | null
  /** 회사 이름 — 카드의 첫 글자이자 회사 보기로 가는 길이다. */
  companyName?: string | null
  contacts: Contact[]
  onBack?: () => void
  /** 회사 보기로. 없으면 회사명을 그냥 글자로 둔다(상세 페이지 단독). */
  onOpenCompany?: () => void
  onEdit: () => void
  onAddContact: () => void
  onEditContact: (c: Contact) => void
}

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

export default function SiteHeaderBand({
  customer, companyName, contacts, onBack, onOpenCompany, onEdit, onAddContact, onEditContact,
}: Props) {
  const [copied, setCopied] = useState(false)
  /** 담당자 칩을 전부 펼쳤는가. 접힌 상태에서는 두 줄까지만 보인다. */
  const [openContacts, setOpenContacts] = useState(false)
  /** 접었을 때 가려지는 칩 수 — 「더보기 +N」 의 N. 0 이면 버튼을 내지 않는다. */
  const [hidden, setHidden] = useState(0)
  const chipsRef = useRef<HTMLDivElement | null>(null)

  const dot = STATUS_DOT[customer?.status ?? ''] ?? MUTED
  const title = companyName?.trim() || customer?.company_name || '사업장 정보 없음'

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

  const copy = () => {
    if (!customer?.address) return
    navigator.clipboard.writeText(customer.address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const memo = customer?.note

  return (
    <section className="site-band" style={{ background: '#ffffff', border: `1px solid ${BORDER}`, borderRadius: R.card, padding: '14px 18px 12px', position: 'relative' }}>
      <style>{`
        .site-band { display: grid; grid-template-columns: minmax(0, 1fr) 1px minmax(0, 1fr); gap: 0 18px; align-items: start }
        /* 세로선은 카드의 안쪽 여백까지 가로질러 위·아래 끝에 닿는다. */
        .site-band .band-rule { background: ${BORDER}; align-self: stretch; margin: -14px 0 -12px }
        /* 연필은 자리를 늘 차지하고 보이기만 바뀐다 — 나타날 때 글자가 밀리지 않게. */
        .site-band .edit1, .site-band .edit2 { opacity: 0; transition: opacity 0.15s ease }
        .site-band:hover .edit1, .site-band:focus-within .edit1 { opacity: 1 }
        .site-band .chip-c:hover .edit2, .site-band .chip-c:focus-within .edit2 { opacity: 1 }
        @media (max-width: 640px) {
          /* 폰에는 호버가 없다 — 늘 보인다. */
          .site-band { grid-template-columns: minmax(0, 1fr); gap: 12px }
          .site-band .band-rule { display: none }
          .site-band .band-right { border-top: 1px solid ${BORDER}; padding-top: 12px }
          .site-band .edit1, .site-band .edit2 { opacity: 1 }
        }
      `}</style>

      {/* 사업장 수정 — 카드 우상단. 호버·포커스에서만 보인다(자리는 늘 있다). */}
      <span className="edit1" style={{ position: 'absolute', top: 12, right: 12, zIndex: 1 }}>
        <EditIconButton label="사업장 정보 수정" onClick={onEdit} />
      </span>

      {/* ── 좌: 누구인가 ── */}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
          {onBack && <BackIconButton onClick={onBack} label="이전 화면으로" />}
          {onOpenCompany ? (
            <button type="button" onClick={onOpenCompany} title="회사 보기"
              style={{ padding: 0, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
              <span style={{ fontSize: 17, fontWeight: 700, color: TEXT, letterSpacing: '-0.3px', borderBottom: `1px dashed ${MUTED}` }}>{title}</span>
            </button>
          ) : (
            <span style={{ fontSize: 17, fontWeight: 700, color: TEXT, letterSpacing: '-0.3px' }}>{title}</span>
          )}
          <span aria-hidden style={{ color: MUTED, fontWeight: 700 }}>»</span>
          {customer?.site_name?.trim()
            ? <b style={{ fontSize: 17, fontWeight: 700, color: TEXT, letterSpacing: '-0.3px' }}>{customer.site_name.trim()}</b>
            : <span style={{ fontSize: 11, fontWeight: 700, color: DANGER, background: '#fef2f2', borderRadius: R.tag, padding: '2px 7px' }}>사업장명 입력 필요</span>}
          {customer?.status && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, color: SUB }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot }} />
              {customer.status}
            </span>
          )}
        </div>

        {/* 주소·대리점 — 좁아지면 대리점이 아랫줄로 내려간다(칸 밖으로 나가지 않는다). */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px 16px', flexWrap: 'wrap', marginTop: 10, paddingLeft: 38, fontSize: 13, color: LABEL, minWidth: 0 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
            <span style={{ color: MUTED }}>주소</span>
            <span style={{ color: customer?.address ? LABEL : DANGER, fontWeight: customer?.address ? 400 : 600, wordBreak: 'break-all' }}>
              {customer?.address ?? '주소 없음 — 수정 필요'}
            </span>
            {customer?.address && (
              <button onClick={copy} title="주소 복사" aria-label="주소 복사"
                style={{ padding: 2, background: 'none', border: 'none', cursor: 'pointer', color: copied ? '#16a34a' : MUTED, display: 'inline-flex' }}>
                {copied ? (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                )}
              </button>
            )}
          </span>
          <span style={{ whiteSpace: 'nowrap' }}><span style={{ color: MUTED, marginRight: 4 }}>대리점</span>{agencyLabelOf(customer)}</span>
        </div>
      </div>

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
            있으면 기존 MemoPopover 가 그대로 뜬다(읽기 전용 — 고치는 길은 사업장 수정 모달이다). */}
        <div style={{ display: 'grid', gridTemplateColumns: '44px minmax(0, 1fr)', gap: '0 8px', alignItems: 'start', fontSize: 13, color: LABEL }}>
          <span style={{ color: MUTED }}>메모</span>
          {hasMemo(memo) ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <MemoPopover title={customer?.company_name ?? '사업장'} value={memo} label="사업장 메모" />
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{memo}</span>
            </span>
          ) : <span />}
        </div>
      </div>
    </section>
  )
}
