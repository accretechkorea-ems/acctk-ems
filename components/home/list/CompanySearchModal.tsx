'use client'

// 회사 하나를 고르는 작은 창 — 「다른 회사로 이동」과 「회사 병합」이 함께 쓴다.
//
// 두 자리 모두 **되돌리기가 없거나 번거로운 일**이라, 고르는 단계와 확인하는 단계를
// 나눈다. 이 창은 고르는 단계만 맡는다(확인 문구는 부르는 쪽이 만든다).

import { useMemo, useState, type CSSProperties } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import ModalCard, { keepPads } from '@/components/common/ModalCard'
import { useParents } from '@/components/home/list/useParents'
import { matchesCompanyPick } from '@/lib/companySearch'
import { R } from '@/lib/radius'

const BORDER = '#ebebeb'
const TEXT = '#111827'
const SUB = '#4b5563'
const MUTED = '#6b7280'
const BLUE = '#234ea2'

/** 옛 카드의 여백을 그대로 지킨다(padding 22 · 머리 아래 10 · 바닥 위 14). */
const PADS = keepPads({ x: 22, top: 22, bottom: 22 }, 10, 14)

const fieldStyle: CSSProperties = {
  width: '100%', padding: '10px 12px', border: `1px solid ${BORDER}`, borderRadius: R.icon,
  boxSizing: 'border-box', color: TEXT, background: '#fff', outline: 'none', fontSize: 14,
}

export type CompanySearchModalProps = {
  title: string
  /** 창 위쪽에 두는 한 줄 설명. */
  hint?: string
  /** 목록에서 뺄 회사(자기 자신). */
  excludeId?: number | null
  confirmText?: string
  onPick: (companyId: number, companyName: string) => void
  onClose: () => void
}

export default function CompanySearchModal({
  title, hint, excludeId, confirmText = '선택', onPick, onClose,
}: CompanySearchModalProps) {
  const companies = useParents()
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<number | null>(null)

  const matches = useMemo(() => {
    return companies
      .filter(c => c.customer_id !== excludeId)
      .filter(c => matchesCompanyPick(c, query))
      .slice(0, 50)
  }, [companies, query, excludeId])

  const pickedRow = companies.find(c => c.customer_id === picked) ?? null

  return (
    <ModalOverlay onClose={onClose}>
      {/* 공용 카드로 옮겼다(2026-11-26, 지시 P) — 열림 모션 150ms(옛 modal-in 0.18s 를
          대신한다) · Esc·바깥 클릭·✕ 가 한 함수를 지난다. 겉모양은 그대로다: 폭 460 ·
          radius control · 여백 22 · 최대 높이 76vh. 제목 17/800 도 그대로 넘긴다. */}
      <ModalCard
        width={460}
        {...PADS}
        style={{ borderRadius: R.control, maxHeight: '76vh' }}
        headStyle={{ ...PADS.headStyle, alignItems: 'center' }}
        title={<div style={{ fontSize: 17, fontWeight: 800, color: TEXT, letterSpacing: '-0.3px' }}>{title}</div>}
        footer={
          <>
            <button onClick={onClose}
              style={{ padding: '9px 15px', background: '#fff', color: SUB, borderRadius: R.icon, border: `1px solid ${BORDER}`, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>취소</button>
            <button
              disabled={!pickedRow}
              onClick={() => { if (pickedRow) onPick(pickedRow.customer_id, pickedRow.company_name) }}
              style={{ padding: '9px 17px', background: pickedRow ? BLUE : '#e5e7eb', color: pickedRow ? '#fff' : MUTED, borderRadius: R.icon, border: 'none', cursor: pickedRow ? 'pointer' : 'not-allowed', fontWeight: 700, fontSize: 13 }}>
              {confirmText}
            </button>
          </>
        }
      >
        {hint && <div style={{ fontSize: 12, color: SUB, lineHeight: 1.7, marginBottom: 12 }}>{hint}</div>}

        <input value={query} autoFocus onChange={e => setQuery(e.target.value)}
          placeholder="회사명 · 영문 회사명" style={fieldStyle} />

        <div style={{ marginTop: 10, overflowY: 'auto', border: `1px solid ${BORDER}`, borderRadius: R.icon, flex: 1, minHeight: 120 }}>
          {matches.length === 0 ? (
            <div style={{ padding: 28, textAlign: 'center', color: MUTED, fontSize: 13 }}>찾는 회사가 없습니다</div>
          ) : matches.map(c => {
            const on = picked === c.customer_id
            return (
              <button key={c.customer_id} type="button" onClick={() => setPicked(c.customer_id)}
                style={{
                  width: '100%', textAlign: 'left', border: 'none', borderBottom: `1px solid ${BORDER}`,
                  background: on ? '#eff4ff' : '#fff', cursor: 'pointer', padding: '9px 11px',
                  fontSize: 13, color: TEXT, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 7,
                }}>
                <span style={{ fontWeight: on ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.company_name}</span>
                {c.name_en && <span style={{ fontSize: 11, color: MUTED }}>{c.name_en}</span>}
                <span style={{ flex: 1 }} />
                {c.industry
                  ? <span style={{ fontSize: 11, color: SUB }}>{c.industry}</span>
                  : <span style={{ fontSize: 11, color: '#b45309' }}>분류 없음</span>}
              </button>
            )
          })}
        </div>

      </ModalCard>
    </ModalOverlay>
  )
}
