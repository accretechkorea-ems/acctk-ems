'use client'

/**
 * 사업장 화면의 **왼쪽 한 열**(PC) — 사업장 정보 카드 + 담당자 카드 (2026-11-25, V8).
 *
 * ── 왜 다시 세로인가 ──────────────────────────────────────────────────────
 *   2026-11-20 에는 왼쪽 열을 걷고 **가로 띠**(HeaderBand)로 눕혔다. 그 열이 가져간
 *   300px 만큼 장비 카드가 좁아 1366 에서 두 대만 보였기 때문이다. 그런데 띠는 담당자를
 *   **칩 두 줄**로 접어야 했다 — 다섯 명이 있으면 「더보기 +3」이 되고, 전화·이메일은
 *   칩 안에서 자리를 다퉜다. 사업장 화면에서 가장 자주 하는 일이 「담당자에게 전화」다.
 *
 *   그래서 열을 되살리되 **340px**로 못 박았다(장비 카드와 같은 폭이다). 1440 에서
 *   오른쪽에 장비 카드 셋이 서고, 열은 **따라 내려온다**(sticky) — 장비를 훑는 동안에도
 *   주소와 담당자가 눈에 남는다.
 *
 * ── 폰은 이 열을 쓰지 않는다 ──────────────────────────────────────────────
 *   ≤767 에서는 지난 회차의 가로 띠(SiteHeaderBand)가 그대로 선다. 둘은 CSS 로 갈린다
 *   (.site-col / .site-band-phone — components/customer/CustomerDetailBody.tsx).
 *   같은 내용을 두 모양으로 그리는 자리라, 한쪽만 고치지 않게 하네스가 둘을 함께 본다
 *   (scripts/site-v8-check.js).
 */

import { useState } from 'react'
import BackIconButton from '@/components/common/BackIconButton'
import { EditIconButton } from '@/components/common/IconButton'
import ContactList from '@/components/customer/ContactList'
import MemoHoverText from '@/components/common/MemoHoverText'
import { hasMemo } from '@/components/common/MemoPopover'
import CompanyLink from '@/components/customer/CompanyLink'
import { STATUS_DOT } from '@/components/customer/HeaderBand'
import { agencyLabelOf } from '@/lib/customerAgency'
import { R } from '@/lib/radius'
import { BORDER, CARD_BG, MUTED, SUB, TEXT } from '@/components/common/ui'
import { TEXT_LABEL } from '@/lib/textTokens'
import type { Contact, Customer } from './types'


/** 열의 폭 — 장비 카드와 같다(그래서 1440 에서 열 + 카드 셋이 딱 선다). */
export const SITE_COL_W = 340

/**
 * 사업장명 글자 크기 — 회사명(18)보다 한 단 작다.
 * 디자인 스케일 밖의 18 은 **이 자리 하나**에만 둔다(.claude/rules/design-system.md 의 예외).
 */
const COMPANY_NAME_SIZE = 18

/** 라벨 열의 폭 — 주소·대리점·메모의 값이 같은 x 에서 시작한다. */
const KEY_W = 44




function CopyGlyph({ done }: { done: boolean }) {
  return done ? (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
  ) : (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
  )
}

/** 라벨 + 값 한 줄 — 주소·대리점·메모가 같은 틀을 쓴다. */
function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `${KEY_W}px minmax(0, 1fr)`, gap: '0 6px', alignItems: 'start', fontSize: 13, color: TEXT_LABEL }}>
      <span style={{ color: MUTED, fontSize: 12, lineHeight: 1.5 }}>{label}</span>
      <div style={{ minWidth: 0, lineHeight: 1.5 }}>{children}</div>
    </div>
  )
}

/**
 * 담당자 한 사람 = **두 줄 블록**.
 *   윗줄  이름(600) + 직급 · 부서
 *   아랫줄 휴대폰(tel) / 이메일(mailto) — 한 줄에 하나씩이라 손가락·눈이 헷갈리지 않는다.
 * 휴대폰이 없으면 **회사 전화**를 같은 자리에 놓는다(아이콘만 다르다). 이메일이 없으면 「—」.
 */

export type SiteInfoColumnProps = {
  customer: Customer | null
  /** 회사 이름 — 카드의 첫 글자이자 회사 보기로 가는 길이다. */
  companyName?: string | null
  contacts: Contact[]
  onBack?: () => void
  /** 회사 보기로 — **분할 보기 안에서만** 온다(우측 pane 을 갈아 끼운다). */
  onOpenCompany?: () => void
  onEdit: () => void
  onAddContact: () => void
  onEditContact: (c: Contact) => void
}

export default function SiteInfoColumn({
  customer, companyName, contacts, onBack, onOpenCompany, onEdit, onAddContact, onEditContact,
}: SiteInfoColumnProps) {
  const [copied, setCopied] = useState(false)

  /**
   * 중복 의심 — **목록에서 한 번** 센다(줄마다 세면 n² 번 돈다).
   * 휴대폰·이메일만 본다. 회사 전화는 같은 사무실이면 같은 것이 정상이라 보지 않는다.
   */

  const title = companyName?.trim() || customer?.company_name || '사업장 정보 없음'
  /** 묶인 회사의 id — 상세 페이지에서 회사 보기로 가는 길이 이 값이다(없으면 단독 업체다). */
  const companyId = customer?.parent_customer_id ?? null
  const status = customer?.status ?? null

  const copy = () => {
    if (!customer?.address) return
    navigator.clipboard.writeText(customer.address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="site-col" style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      <style>{`
        /* 연필은 **호버·포커스에서만** 보이고 자리는 늘 차지한다 — 나타날 때 글자가 밀리지 않게. */
        .site-col .card-edit, .site-col .ct-edit { opacity: 0; transition: opacity 0.15s ease }
        .site-col .site-info:hover .card-edit, .site-col .site-info:focus-within .card-edit { opacity: 1 }
        .site-col .ct-row:hover .ct-edit, .site-col .ct-row:focus-within .ct-edit { opacity: 1 }
        /* 전화·이메일은 **누를 수 있는 글자**다 — 올리면 밑줄이 선다(2026-11-26).
           색은 이미 테마 파랑이라, 움직이는 것은 밑줄 하나다(표의 줄과 같은 규칙:
           app/globals.css 의 .ems-row-hover a:hover). */
        .site-col .ct-row a:hover { text-decoration: underline }
      `}</style>

      {/* ── 사업장 정보 ── */}
      <section className="site-info"
        style={{
          position: 'relative', background: CARD_BG, border: `1px solid ${BORDER}`,
          borderRadius: R.card, padding: '14px 16px', boxSizing: 'border-box',
        }}>
        <span className="card-edit" style={{ position: 'absolute', top: 10, right: 10, zIndex: 1 }}>
          <EditIconButton label="사업장 정보 수정" onClick={onEdit} />
        </span>

        {/* 1줄 — ← 회사명 » 사업장명 ● 상태. 길면 줄바꿈한다(wrap). */}
        <div className="site-title"
          style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0, paddingRight: 30 }}>
          {onBack && (
            <span style={{ display: 'inline-flex' }}>
              <BackIconButton onClick={onBack} label="이전 화면으로" />
            </span>
          )}
          <CompanyLink name={title} companyId={companyId} onOpen={onOpenCompany} fontSize={COMPANY_NAME_SIZE} />
          <span aria-hidden style={{ fontSize: 15, color: MUTED, fontWeight: 700 }}>»</span>
          {customer?.site_name?.trim()
            ? <b style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>{customer.site_name.trim()}</b>
            : <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-danger)', background: 'var(--color-danger-tint)', borderRadius: R.tag, padding: '2px 7px' }}>사업장명 입력 필요</span>}
          {status && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: SUB, whiteSpace: 'nowrap' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_DOT[status] ?? MUTED }} />
              {status}
            </span>
          )}
        </div>

        {/* 주소 · 대리점 · 메모 — 세로로 쌓는다(한 줄에 몰아 두면 어디서 끊길지 알 수 없다). */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 10 }}>
          <InfoRow label="주소">
            <span style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 5, minWidth: 0 }}>
              <span style={{ color: customer?.address ? TEXT_LABEL : 'var(--color-danger)', fontWeight: customer?.address ? 400 : 600, wordBreak: 'break-all', minWidth: 0 }}>
                {customer?.address ?? '주소 없음 — 수정 필요'}
              </span>
              {customer?.address && (
                <button onClick={copy} title="주소 복사" aria-label="주소 복사"
                  style={{ padding: 2, background: 'none', border: 'none', cursor: 'pointer', color: copied ? 'var(--color-success)' : MUTED, display: 'inline-flex', flexShrink: 0 }}>
                  <CopyGlyph done={copied} />
                </button>
              )}
            </span>
          </InfoRow>
          <InfoRow label="대리점">
            <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {agencyLabelOf(customer)}
            </span>
          </InfoRow>
          <InfoRow label="메모">
            {hasMemo(customer?.note) ? (
              <MemoHoverText
                title={customer?.company_name ?? '사업장'}
                value={customer?.note}
                style={{
                  display: 'block', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  color: TEXT_LABEL, outline: 'none', cursor: 'default',
                }}
              />
            ) : <span style={{ color: MUTED }}>—</span>}
          </InfoRow>
        </div>
      </section>

      {/* ── 담당자 ── **공용 부품 하나**다(2026-11-27, 묶음4 B) — 폰의 띠도 같은 것을 쓴다. */}
      <section
        style={{
          background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: R.card,
          padding: '10px 6px 8px', boxSizing: 'border-box',
        }}>
        <ContactList contacts={contacts} onAdd={onAddContact} onEdit={onEditContact} />
      </section>
    </div>
  )
}
