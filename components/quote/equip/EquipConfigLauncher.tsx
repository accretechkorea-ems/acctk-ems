'use client'

// 「장비 구성 선택」 버튼과 모달의 **연결 고리**.
//
// 견적 화면(app/quote/page.tsx)은 이 조각 하나만 놓는다 — 모달 상태와 줄 합치기 규칙이
// 화면 파일로 흘러들지 않게 한다. 장비 양식(equip80)이 아니면 **아무것도 그리지 않는다.**
//
// ── 줄을 합치는 규칙 ────────────────────────────────────────────────────────
//   · 고른 줄은 **기존 줄 뒤에** 붙는다. 이미 적어 둔 줄은 손대지 않는다.
//   · 할인은 견적당 1건이다(RowAddButtons 와 같은 규칙). 이미 할인 줄이 있으면
//     모달의 특별 할인은 붙이지 않는다 — 두 줄이 되면 총액에서 두 번 빠진다.
//   · 환율은 견적당 하나다. 모달에서 고쳤다면 견적 전체 환율을 그 값으로 맞춘다
//     (그 뒤 page.tsx 의 환율 효과가 모든 줄을 같은 환율로 다시 계산한다).

import { useState } from 'react'
import { isEquipForm } from '@/lib/quoteForms'
import type { QuoteRow } from '@/app/quote/types'
import EquipConfigModal from './EquipConfigModal'

export type EquipConfigLauncherProps = {
  formKind: string
  category: string | null
  exchangeRate: number
  setExchangeRate: (rate: number) => void
  rows: QuoteRow[]
  setRows: React.Dispatch<React.SetStateAction<QuoteRow[]>>
  myId: number | null
  myName: string
}

export default function EquipConfigLauncher(props: EquipConfigLauncherProps) {
  const { formKind, category, exchangeRate, setExchangeRate, rows, setRows, myId, myName } = props
  const [open, setOpen] = useState(false)

  if (!isEquipForm(formKind)) return null

  const hasDiscountRow = rows.some(r => r.row_kind === 'discount')
  // 관세율 기본값은 **지금 견적이 쓰는 값**을 따른다. 줄이 없으면 calc.ts 의 기본값(1.13)이
  // 모달 안에서 쓰인다(useEquipConfig 의 DEFAULT_TARIFF).
  const tariffRate = rows.find(r => r.tariff_rate > 0)?.tariff_rate ?? 0

  const handleAdd = (added: QuoteRow[], discount: QuoteRow | null) => {
    setRows(prev => {
      const next = [...prev, ...added]
      // 할인 줄은 이미 있으면 더하지 않는다(모달 바닥글이 그 사실을 미리 알린다).
      return discount && !prev.some(r => r.row_kind === 'discount') ? [...next, discount] : next
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="기종 구성을 골라 품목을 한 번에 넣습니다"
        style={{
          marginLeft: 'auto', padding: '6px 12px', background: '#fff', color: '#234ea2',
          border: '1px solid #ebebeb', borderRadius: 6, fontWeight: 700, fontSize: 12,
          cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background 0.15s ease',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = '#f3f4f6')}
        onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
      >
        장비 구성 선택
      </button>

      {open && (
        <EquipConfigModal
          onClose={() => setOpen(false)}
          myId={myId}
          myName={myName}
          category={category}
          exchangeRate={exchangeRate}
          tariffRate={tariffRate}
          existingRowCount={rows.length}
          hasDiscountRow={hasDiscountRow}
          onAdd={handleAdd}
          onExchangeRate={setExchangeRate}
        />
      )}
    </>
  )
}
