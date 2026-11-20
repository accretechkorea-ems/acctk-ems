'use client'

/**
 * 사업장 화면 **맨 위 가로 띠** — 업체·장비 수·담당자를 한 줄에 담는다.
 *
 * 왜 세로 카드 둘을 접었나(2026-11-20)
 *   왼쪽에 업체 카드와 담당자 카드를 세로로 쌓아 두니, 그 열(300~340px)이 장비에서
 *   가져간 자리만큼 장비 카드가 좁아졌다. 두 카드가 들고 있는 것은 **줄 몇 개**다 —
 *   주소 한 줄, 대리점 한 줄, 담당자 한두 명. 가로로 눕히면 세로 한 줄이면 되고,
 *   그 아래를 장비가 전부 쓴다(1920 에서 4열, 1366 에서 3열).
 *
 * 구분자는 » 다 — › 는 「다음」이고 » 는 「안으로」다. 회사 안의 사업장이라는 뜻.
 *
 * 좁은 화면(≤640)에서는 띠를 세로로 접고 담당자는 한 줄로 줄여 ▾ 로 펼친다.
 * 현장에서 폰으로 여는 화면이라 누르는 것은 전부 44px 이상으로 둔다.
 */

import { useState } from 'react'
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

type Props = {
  customer: Customer | null
  /** 회사 이름 — 띠의 첫 글자이자 회사 보기로 가는 길이다. */
  companyName?: string | null
  contacts: Contact[]
  deviceCount: number
  onBack?: () => void
  /** 회사 보기로. 없으면 회사명을 그냥 글자로 둔다(상세 페이지 단독). */
  onOpenCompany?: () => void
  onEdit: () => void
  onAddContact: () => void
  onEditContact: (c: Contact) => void
}

/** 담당자 한 칸 — 이름·직급·전화와 연필. 이메일은 길어서 칩에 두지 않고 도움말로 둔다. */
function ContactChip({ c, onEdit }: { c: Contact; onEdit: () => void }) {
  const tip = [c.name, c.position, c.department, c.phone, c.email].filter(Boolean).join(' · ')
  return (
    <span title={tip}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 6px 0 10px',
        border: `1px solid ${BORDER}`, borderRadius: R.control, background: '#fafafa',
        fontSize: 13, maxWidth: '100%', minWidth: 0,
      }}>
      <b style={{ fontWeight: 600, color: TEXT, whiteSpace: 'nowrap' }}>{c.name?.trim() || '이름 없음'}</b>
      {c.position && <span style={{ fontSize: 12, color: SUB, whiteSpace: 'nowrap' }}>{c.position}</span>}
      {c.phone && (
        <a href={`tel:${c.phone.replace(/[^0-9+]/g, '')}`} onClick={e => e.stopPropagation()}
          style={{ fontSize: 12, color: '#234ea2', textDecoration: 'none', whiteSpace: 'nowrap' }}>
          {c.phone}
        </a>
      )}
      <EditIconButton size={24} label={`${c.name ?? '담당자'} 수정`} onClick={onEdit} style={{ border: 'none', background: 'transparent' }} />
    </span>
  )
}

export default function SiteHeaderBand({
  customer, companyName, contacts, deviceCount, onBack, onOpenCompany, onEdit, onAddContact, onEditContact,
}: Props) {
  const [copied, setCopied] = useState(false)
  /** 좁은 화면에서 담당자를 펼쳤는가 — 넓은 화면에서는 늘 펼쳐져 있다(CSS 가 정한다). */
  const [openContacts, setOpenContacts] = useState(false)
  const dot = STATUS_DOT[customer?.status ?? ''] ?? MUTED
  const title = companyName?.trim() || customer?.company_name || '사업장 정보 없음'

  const copy = () => {
    if (!customer?.address) return
    navigator.clipboard.writeText(customer.address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <section className="site-band" style={{ background: '#ffffff', border: `1px solid ${BORDER}`, borderRadius: R.card, padding: '12px 16px' }}>
      <style>{`
        .site-band { display: grid; grid-template-columns: minmax(0, auto) 1px auto 1px minmax(0, 1fr); gap: 0 16px; align-items: center }
        .site-band .band-rule { width: 1px; height: 40px; background: ${BORDER} }
        .site-band .band-contacts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0 }
        .site-band .band-more { display: none }
        @media (max-width: 640px) {
          .site-band { grid-template-columns: minmax(0, 1fr); gap: 10px }
          .site-band .band-rule { display: none }
          .site-band .band-devices { border-top: 1px solid ${BORDER}; padding-top: 10px }
          .site-band .band-contacts { border-top: 1px solid ${BORDER}; padding-top: 10px }
          .site-band .band-more { display: inline-flex }
          .band-contacts[data-contacts="closed"] .band-chip ~ .band-chip { display: none }
        }
      `}</style>

      {/* ① 업체 — 회사 » 사업장 ● 상태 ✎ / 아래 작은 줄에 주소·대리점·메모 */}
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
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: SUB }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot }} />
              {customer.status}
            </span>
          )}
          <EditIconButton label="사업장 정보 수정" onClick={onEdit} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginTop: 6, fontSize: 12, color: LABEL }}>
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
          <span><span style={{ color: MUTED }}>대리점</span> {agencyLabelOf(customer)}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ color: MUTED }}>메모</span>
            <MemoPopover title={customer?.company_name ?? '사업장'} value={customer?.note} label="사업장 메모" />
            <span style={{ color: hasMemo(customer?.note) ? LABEL : MUTED }}>
              {hasMemo(customer?.note) ? customer?.note : '없음'}
            </span>
          </span>
        </div>
      </div>

      <div className="band-rule" />

      {/* ② 장비 수 — 장비 pane 의 머리줄을 없애고 이 자리로 옮겼다. */}
      <div className="band-devices" style={{ fontSize: 12, color: SUB, whiteSpace: 'nowrap' }}>
        장비 <b style={{ fontSize: 16, fontWeight: 700, color: TEXT }}>{deviceCount}</b>
      </div>

      <div className="band-rule" />

      {/* ③ 담당자 — 칩과 + 하나. 좁은 화면에서는 첫 사람만 보이고 ▾ 로 펼친다. */}
      <div className="band-contacts" data-contacts={openContacts ? 'open' : 'closed'}>
        <b style={{ fontSize: 12, fontWeight: 700, color: SUB, flexShrink: 0 }}>담당자</b>
        {contacts.length === 0 && <span style={{ fontSize: 12, color: MUTED }}>없음</span>}
        {contacts.map(c => (
          <span key={c.contact_id} className="band-chip" style={{ minWidth: 0 }}>
            <ContactChip c={c} onEdit={() => onEditContact(c)} />
          </span>
        ))}
        {contacts.length > 1 && (
          <button type="button" className="band-more" onClick={() => setOpenContacts(v => !v)}
            style={{ alignItems: 'center', gap: 4, height: 34, padding: '0 10px', border: `1px solid ${BORDER}`, borderRadius: R.control, background: '#ffffff', color: SUB, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            {openContacts ? '접기 ▴' : `${contacts.length - 1}명 더 ▾`}
          </button>
        )}
        <AddIconButton label="담당자 추가" onClick={onAddContact} />
      </div>
    </section>
  )
}
