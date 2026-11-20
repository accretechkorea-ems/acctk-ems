'use client'

import { useState } from 'react'
import BackIconButton from '@/components/common/BackIconButton'
import MemoPopover, { hasMemo } from '@/components/common/MemoPopover'
import { agencyLabelOf } from '@/lib/customerAgency'
import type { Customer } from './types'

const STATUS_CFG: Record<string, string> = {
  '활성': '#22c55e',
  '잠재': '#f59e0b',
  '이탈': '#ef4444',
}

type Props = {
  customer: Customer | null

  onEdit: () => void
  /**
   * 목록으로 돌아가기 — 제목 앞 화살표가 부른다.
   *
   * 화면 맨 위에 「고객사 / 회사명」 한 줄을 두던 자리를 걷고 이 카드가 그 길을 맡는다
   * (의뢰서 상세와 같은 방식). 저장된 목록 상태를 지우고 갈지는 **화면이 정한다** —
   * 이 카드는 누른 사실만 알린다.
   */
  /** 분할 보기에서는 회사 보기로 돌아간다. 돌아갈 곳이 없으면 화살표를 내지 않는다. */
  onBack?: () => void
  /**
   * 회사 이름 — 제목은 **회사명**이고 사업장명은 아래 한 줄로 내린다.
   * 전에는 제목이 「회사명 사업장명」을 합친 값이라, 사업장명이 비면 회사명만 보이고
   * 들어 있으면 제목이 길어져 어디까지가 회사 이름인지 알 수 없었다.
   */
  companyName?: string | null
}

export default function CustomerInfoPanel({ customer, onEdit, onBack, companyName }: Props) {
  const [copied, setCopied] = useState(false)
  const sc = STATUS_CFG[customer?.status ?? ''] ?? '#9ca3af'
  // 대리점 경유 견적이 섞여 있을 때만 내역을 덧붙인다 (직판만 있으면 군더더기라 감춘다)

  const handleCopy = () => {
    if (!customer?.address) return
    navigator.clipboard.writeText(customer.address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    // 카드 사이 간격은 이 카드가 아니라 왼쪽 열의 gap(app/customer/[id]/page.tsx .cust-left)이 정한다.
    <div style={{
      background: '#ffffff', border: '1px solid #ebebeb', borderRadius: 8,
      padding: '14px 16px', position: 'relative',
    }}>
      {/* 수정 — 아이콘만. 라벨 없이도 뜻이 통하고 좁은 열에서 회사명 자리를 덜 뺏는다 */}
      <button
        onClick={onEdit}
        title="사업장 정보 수정"
        aria-label="사업장 정보 수정"
        onMouseEnter={e => { e.currentTarget.style.borderColor = '#234ea2'; e.currentTarget.style.color = '#234ea2' }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = '#ebebeb'; e.currentTarget.style.color = '#6b7280' }}
        style={{
          position: 'absolute', top: 14, right: 16,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 6,
          background: '#fff', border: '1px solid #ebebeb', borderRadius: 6,
          cursor: 'pointer', color: '#6b7280',
          transition: 'border-color 0.15s ease, color 0.15s ease',
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      </button>

      {/* 화살표 + 회사명 + 상태 배지 — 좁은 열에서 수정 버튼과 겹치지 않도록 오른쪽을 비워둔다.
          화살표는 줄바꿈에 끌려가지 않게 flexWrap 바깥(첫 칸)에 둔다. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap', paddingRight: 34 }}>
        {onBack && <BackIconButton onClick={onBack} label="고객사 목록으로" />}
        <h1 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#111827', lineHeight: 1.3, letterSpacing: '-0.3px', wordBreak: 'break-all' }}>
          {companyName?.trim() || customer?.company_name || '사업장 정보 없음'}
        </h1>
        {customer?.status && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 12, color: '#6b7280', flexShrink: 0,
          }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: sc, flexShrink: 0 }} />
            {customer.status}
          </span>
        )}
      </div>

      {/* 정보 행 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* 사업장명 — 비어 있는 줄이 많아 자리를 늘 둔다(있는지 없는지가 정보다). */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#9ca3af', width: 44, flexShrink: 0 }}>사업장</span>
          {customer?.site_name?.trim() ? (
            <span style={{
              fontSize: 13, minWidth: 0, color: '#111827',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {customer.site_name.trim()}
            </span>
          ) : (
            /* 비면 빨간 태그 — 적어야 할 칸이라는 뜻이다(주소 없음과 같은 결). */
            <span style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', background: '#fef2f2', borderRadius: 6, padding: '2px 7px' }}>입력 필요</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#9ca3af', width: 44, flexShrink: 0, lineHeight: '20px' }}>주소</span>
          <span style={{
            fontSize: 13, flex: 1, minWidth: 0, lineHeight: '20px', wordBreak: 'break-all',
            color: customer?.address ? '#111827' : '#ef4444',
            fontWeight: customer?.address ? 400 : 600,
          }}>
            {customer?.address ?? '주소 정보 없음 — 수정 필요'}
          </span>
          {customer?.address && (
            <button onClick={handleCopy}
              title="주소 복사"
              onMouseEnter={e => { if (!copied) e.currentTarget.style.color = '#234ea2' }}
              onMouseLeave={e => { if (!copied) e.currentTarget.style.color = '#9ca3af' }}
              style={{
                display: 'inline-flex', alignItems: 'center', padding: 0,
                background: 'none', border: 'none', cursor: 'pointer',
                color: copied ? '#22c55e' : '#9ca3af',
                transition: 'color 0.15s ease', flexShrink: 0, marginTop: 3,
              }}>
              {copied ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#9ca3af', width: 44, flexShrink: 0 }}>대리점</span>
          {/* 이름은 대리점 줄에서 조인해 온다. 없으면 「직판」(lib/customerAgency.ts). */}
          <span style={{ fontSize: 13, color: '#111827' }}>{agencyLabelOf(customer)}</span>
        </div>

        {/* 메모 — 「일본 직수입」·「인천 서구 이전」처럼 이 사업장의 한 줄 사정.
            자리는 늘 둔다(아이콘 색으로 있는지 없는지 알린다 — MemoPopover 규칙).
            고치는 길은 [정보 수정] 폼이다. 여기서는 읽기만 한다. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#9ca3af', width: 44, flexShrink: 0 }}>메모</span>
          <MemoPopover
            title={customer?.company_name ?? '사업장'}
            value={customer?.note}
            label="사업장 메모"
          />
          <span style={{
            fontSize: 13, color: hasMemo(customer?.note) ? '#111827' : '#d1d5db',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {hasMemo(customer?.note) ? customer?.note : '없음'}
          </span>
        </div>
      </div>

      {/* 거래 이력은 여기 두지 않는다 — 요약 패널의 [견적] 줄이 그 진입점이다. */}
    </div>
  )
}
