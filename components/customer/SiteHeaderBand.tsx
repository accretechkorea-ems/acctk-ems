'use client'

/**
 * 사업장 화면 **맨 위 카드 한 장** — 좌(업체)·우(담당자·메모)를 5:5 로 나눈다.
 *
 * ── 왜 이 모양인가(2026-11-20) ────────────────────────────────────────────
 *   세로 카드 둘을 왼쪽에 쌓던 때는 그 열이 가져간 300px 만큼 장비가 좁았다.
 *   가로로 눕히고 나서도 「주소·대리점·메모·장비 수·담당자」가 한 줄에 몰려
 *   줄이 어디서 끊길지 알 수 없었다. 이제 **두 칸**이다 —
 *     좌: 누구인가(회사 » 사업장 · 상태 / 주소 / 대리점)
 *     우: 누구와 일하는가(담당자 칩 / 메모)
 *
 *   틀·우 칸·높이는 **대리점 화면과 같은 부품**이다(components/customer/HeaderBand.tsx).
 *   이 파일은 좌 칸 세 줄만 그린다.
 *
 * 구분자는 » 다 — › 는 「다음」이고 » 는 「안으로」다. 회사 안의 사업장이라는 뜻.
 *
 * 「장비 N」과 「폐기 포함」 토글은 여기 두지 않는다 — 장비 수는 카드를 세면
 * 보이고, 폐기 포함은 **사업장 수정 모달 안의 체크**로 옮겼다(2026-11-20).
 */

import { useState } from 'react'
import BackIconButton from '@/components/common/BackIconButton'
import HeaderBand from '@/components/customer/HeaderBand'
import { agencyLabelOf } from '@/lib/customerAgency'
import CompanyLink from '@/components/customer/CompanyLink'
import { R } from '@/lib/radius'
import type { Contact, Customer } from './types'

const TEXT = '#111827'
const LABEL = '#374151'
const SUB = '#6b7280'
const MUTED = '#9ca3af'
const DANGER = '#ef4444'

const STATUS_DOT: Record<string, string> = { '활성': '#16a34a', '잠재': '#f59e0b', '이탈': '#ef4444' }

/**
 * 사업장명 글자 크기 — 회사명(20)보다 **한 단 작다**.
 *
 * 디자인 시스템의 스케일(11·12·13·14·15·16·17·20)에는 없는 값이다. 두 이름을 한 줄에
 * 세우려면 20 과 17 은 차이가 약해 「회사 » 사업장」의 층이 보이지 않았고, 17 아래로는
 * 사업장명이 주소줄과 섞였다. 2026-11-20 사용자 지시로 이 자리에만 둔다
 * (.claude/rules/design-system.md 의 예외 항목에 적었다).
 */
const SITE_NAME_SIZE = 18

type Props = {
  customer: Customer | null
  /** 회사 이름 — 카드의 첫 글자이자 회사 보기로 가는 길이다. */
  companyName?: string | null
  contacts: Contact[]
  onBack?: () => void
  /**
   * 회사 보기로 — **분할 보기 안에서만** 온다(우측 pane 을 갈아 끼운다).
   * 상세 페이지에서는 이것이 없고, 대신 회사 id 로 목록 보기로 옮겨 간다(CompanyLink).
   */
  onOpenCompany?: () => void
  onEdit: () => void
  onAddContact: () => void
  onEditContact: (c: Contact) => void
}

export default function SiteHeaderBand({
  customer, companyName, contacts, onBack, onOpenCompany, onEdit, onAddContact, onEditContact,
}: Props) {
  const [copied, setCopied] = useState(false)

  const dot = STATUS_DOT[customer?.status ?? ''] ?? MUTED
  const title = companyName?.trim() || customer?.company_name || '사업장 정보 없음'
  /** 묶인 회사의 id — 상세 페이지에서 회사 보기로 가는 길이 이 값이다(없으면 단독 업체다). */
  const companyId = customer?.parent_customer_id ?? null

  const copy = () => {
    if (!customer?.address) return
    navigator.clipboard.writeText(customer.address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <HeaderBand
      className="site-band"
      contacts={contacts}
      memoTitle={customer?.company_name ?? '사업장'}
      memo={customer?.note}
      onEdit={onEdit}
      editLabel="사업장 정보 수정"
      onAddContact={onAddContact}
      onEditContact={onEditContact}
      left={<>
        {/* 1줄 — 회사명 20 » 사업장명 18 · 상태.
            기준선(baseline)으로 맞춘다 — 크기가 다른 두 이름이 **글자 밑선**에서 만나야
            한 이름처럼 읽힌다. 상태 dot·글자도 그 줄(사업장명 기준선)에 선다.
            「»」만 세로 중앙이다 — 글자 밑선에 맞추면 두 이름 사이에서 아래로 처진다. */}
        <div className="band-name" style={{ display: 'flex', alignItems: 'baseline', gap: 7, flexWrap: 'wrap', minWidth: 0 }}>
          {onBack && (
            <span style={{ alignSelf: 'center', display: 'inline-flex' }}>
              <BackIconButton onClick={onBack} label="이전 화면으로" />
            </span>
          )}
          {/* 분할 보기 안이면 pane 을 갈아 끼우고, 상세 페이지에서는 목록 보기로 옮겨 간다 —
              한 부품이 두 경우를 맡는다(components/customer/CompanyLink.tsx). */}
          <CompanyLink name={title} companyId={companyId} onOpen={onOpenCompany} />
          <span aria-hidden style={{ alignSelf: 'center', fontSize: 15, color: MUTED, fontWeight: 700 }}>»</span>
          {customer?.site_name?.trim()
            ? <b style={{ fontSize: SITE_NAME_SIZE, fontWeight: 700, color: TEXT, letterSpacing: '-0.3px' }}>{customer.site_name.trim()}</b>
            : <span style={{ fontSize: 11, fontWeight: 700, color: DANGER, background: '#fef2f2', borderRadius: R.tag, padding: '2px 7px' }}>사업장명 입력 필요</span>}
          {customer?.status && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, color: SUB }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot }} />
              {customer.status}
            </span>
          )}
        </div>

        {/* 2줄 — 주소 ⧉. 한 줄을 다 쓴다(대리점과 나란히 두던 때는 긴 주소가 대리점을
            밀어 아랫줄로 보냈고, 그때마다 카드 높이가 들쭉날쭉했다). */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 10, paddingLeft: 38, fontSize: 13, color: LABEL, minWidth: 0 }}>
          <span style={{ color: MUTED, flexShrink: 0 }}>주소</span>
          <span style={{ color: customer?.address ? LABEL : DANGER, fontWeight: customer?.address ? 400 : 600, wordBreak: 'break-all', minWidth: 0 }}>
            {customer?.address ?? '주소 없음 — 수정 필요'}
          </span>
          {customer?.address && (
            <button onClick={copy} title="주소 복사" aria-label="주소 복사"
              style={{ padding: 2, background: 'none', border: 'none', cursor: 'pointer', color: copied ? '#16a34a' : MUTED, display: 'inline-flex', flexShrink: 0 }}>
              {copied ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
              )}
            </button>
          )}
        </div>

        {/* 3줄 — 대리점. 직판이면 「ACCT-K」다(lib/customerAgency.ts 의 DIRECT_SALE_LABEL). */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6, paddingLeft: 38, fontSize: 13, color: LABEL, minWidth: 0 }}>
          <span style={{ color: MUTED, flexShrink: 0 }}>대리점</span>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{agencyLabelOf(customer)}</span>
        </div>
      </>}
    />
  )
}
