'use client'

// 묶음 표 하나 — 본체+기본 / 옵션 / 포함사항 / 국내조달품이 **같은 표**를 쓴다.
//
// 칸은 시안 그대로다: 체크 · 품번 · 품명/규격 · 수량 · 구입가(원) · 판매단가 · 이익률.
// 숫자는 모두 calc.ts 가 낸 값을 읽기만 한다(여기서 계산하지 않는다).
//   구입가  = row.product_price  (원가 JPY × 환율 × 관세 × 수량. 근거가 없으면 「-」)
//   이익률  = row.realized_profit_rate (올림·직접입력이 반영된 실현 이익률)
//
// 국내조달품은 **판매단가 칸이 없다.** 그 줄의 입력값은 자사 부담 원가라서 구입가 칸에
// 그대로 적는다(calc.ts 의 domestic 분기가 manual_unit_price 를 원가로 쓴다).

import type { PriceItem } from '@/app/quote/types'
import { C, S, num, parseNum } from './equipStyles'
import EquipAddRow from './EquipAddRow'
import { GROUP_HINTS, GROUP_TITLES, hasCost, isFromPriceList, isPriceless, isQtyLocked } from './equipLines'
import type { EquipGroup, EquipLine } from './equipLines'
import type { ManualInput } from './useEquipConfig'

export type EquipGroupTableProps = {
  group: EquipGroup
  lines: EquipLine[]
  full: boolean
  onToggle: (id: string, checked: boolean) => void
  onToggleGroup: (group: EquipGroup, checked: boolean) => void
  onQty: (id: string, qty: number) => void
  onPrice: (id: string, price: number) => void
  onText: (id: string, field: 'itemText' | 'partCode', value: string) => void
  onRemove: (id: string) => void
  onAddPriceItem: (group: EquipGroup, item: PriceItem) => void
  onAddManual: (group: EquipGroup, input: ManualInput) => void
}

export default function EquipGroupTable(props: EquipGroupTableProps) {
  const { group, lines, full, onToggle, onToggleGroup, onQty, onPrice, onText, onRemove } = props
  const allOn = lines.length > 0 && lines.every(l => l.checked)
  const domestic = group === 'domestic'

  return (
    <div style={S.sec}>
      <div style={S.secHead}>
        <input
          type="checkbox"
          checked={allOn}
          onChange={e => onToggleGroup(group, e.target.checked)}
          aria-label={`${GROUP_TITLES[group]} 전체 선택`}
        />
        <span>{GROUP_TITLES[group]}</span>
        <span style={S.secHint}>{GROUP_HINTS[group]}</span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => onToggleGroup(group, true)} style={S.miniBtn}>전체선택</button>
        <button type="button" onClick={() => onToggleGroup(group, false)} style={S.miniBtn}>해제</button>
      </div>

      <table style={S.table}>
        <thead>
          <tr>
            <th style={{ ...S.th, width: 30 }} />
            <th style={{ ...S.th, width: 118 }}>품번</th>
            <th style={S.th}>품명 / 규격</th>
            <th style={{ ...S.th, width: 56, textAlign: 'center' }}>수량</th>
            <th style={{ ...S.th, width: 104, textAlign: 'right' }}>{domestic ? '금액(원가)' : '구입가(원)'}</th>
            <th style={{ ...S.th, width: 112, textAlign: 'right' }}>판매단가</th>
            <th style={{ ...S.th, width: 56, textAlign: 'right' }}>이익률</th>
            <th style={{ ...S.th, width: 30 }} />
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 && (
            <tr>
              <td style={{ ...S.tdOff, textAlign: 'center' }} colSpan={8}>
                아래에서 가격표를 검색해 추가하세요
              </td>
            </tr>
          )}
          {lines.map(line => {
            const td = line.checked ? S.td : S.tdOff
            const cost = hasCost(line) ? num(line.row.product_price) : '-'
            const rate = hasCost(line) && line.row.supply_price > 0
              ? `${line.row.realized_profit_rate.toFixed(1)}%`
              : ''
            return (
              <tr key={line.row.id}>
                <td style={td}>
                  <input
                    type="checkbox"
                    checked={line.checked}
                    onChange={e => onToggle(line.row.id, e.target.checked)}
                    aria-label={`${line.row.itemText || line.row.partCode} 선택`}
                  />
                </td>
                <td style={td}>
                  {isFromPriceList(line) ? (
                    <span>{line.row.partCode || '-'}</span>
                  ) : (
                    <input
                      value={line.row.partCode}
                      onChange={e => onText(line.row.id, 'partCode', e.target.value)}
                      placeholder="-"
                      style={{ ...S.qty, width: '100%', textAlign: 'left' }}
                    />
                  )}
                </td>
                <td style={td}>
                  {isFromPriceList(line) ? (
                    <span>{line.row.itemText}</span>
                  ) : (
                    <input
                      value={line.row.itemText}
                      onChange={e => onText(line.row.id, 'itemText', e.target.value)}
                      style={{ ...S.qty, width: '100%', textAlign: 'left' }}
                    />
                  )}
                  {/* 가격표에서 사라진 품번 — 체크를 풀어 두고 그 사실을 보여 준다. */}
                  {line.missing && (
                    <span style={{ fontSize: 11, fontWeight: 600, color: C.RED, marginLeft: 6 }}>
                      가격표에서 찾을 수 없음
                    </span>
                  )}
                </td>
                <td style={{ ...td, textAlign: 'center' }}>
                  {isQtyLocked(group) ? (
                    <span style={{ color: C.MUT }}>{line.row.quantity}</span>
                  ) : (
                    <input
                      value={line.row.quantity}
                      onChange={e => onQty(line.row.id, parseNum(e.target.value))}
                      aria-label="수량"
                      style={S.qty}
                    />
                  )}
                </td>
                <td style={{ ...td, textAlign: 'right', color: C.MUT }}>
                  {domestic ? (
                    <input
                      value={line.row.manual_unit_price || ''}
                      onChange={e => onPrice(line.row.id, parseNum(e.target.value))}
                      aria-label="금액(원가)"
                      style={S.num}
                    />
                  ) : cost}
                </td>
                <td style={{ ...td, textAlign: 'right' }}>
                  {domestic || isPriceless(group) ? (
                    <span style={{ color: C.FAINT }}>-</span>
                  ) : (
                    <input
                      value={line.row.unit_price || ''}
                      onChange={e => onPrice(line.row.id, parseNum(e.target.value))}
                      aria-label="판매단가"
                      style={S.num}
                    />
                  )}
                </td>
                <td style={{ ...td, textAlign: 'right', color: C.MUT }}>{rate}</td>
                <td style={{ ...td, textAlign: 'center' }}>
                  <button
                    type="button"
                    onClick={() => onRemove(line.row.id)}
                    title="이 줄 빼기"
                    style={{ border: 'none', background: 'none', color: C.DIM, cursor: 'pointer', fontSize: 12, padding: 0 }}
                  >
                    ×
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <EquipAddRow
        group={group}
        full={full}
        onAddPriceItem={item => props.onAddPriceItem(group, item)}
        onAddManual={input => props.onAddManual(group, input)}
      />
    </div>
  )
}
