'use client'

// 묶음 표 맨 아래의 **추가 줄** — 가격표 검색 하나와 「직접 추가」 하나.
//
// 검색은 lib/priceSearch.ts 의 searchPriceList 를 쓴다 — 견적 화면의 품목 검색과 **같은 함수**다.
// 품번·품명·모델 세 열을 보고, 띄어 쓴 단어는 전부 포함(AND)으로 찾는다.
// 결과에는 시트(계열) 이름을 함께 보여 준다(같은 품번이 계열마다 다른 값을 갖는 일이 있다).
//
// 찾는 범위는 **80 가격표뿐**이다 — 이 모달은 장비 양식(equip80) 전용이고, 20 가격표
// 품목이 장비 구성에 섞이면 단가 기준이 달라진다(lib/priceListKinds.ts 의 sheetsForLine).
//
// 「직접 추가」는 가격표에 없는 항목이다. 국내조달품에서는 금액칸이 **원가**이고
// 그 밖의 묶음에서는 **판매단가**다 — 칸 이름을 묶음에 따라 바꿔 적는다.

import { useCallback, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { searchPriceList } from '@/lib/priceSearch'
import { sheetsForLine } from '@/lib/priceListKinds'
import type { PriceItem } from '@/app/quote/types'
import { C, S, num, parseNum } from './equipStyles'
import { isPriceless } from './equipLines'
import type { EquipGroup } from './equipLines'

/** 장비 구성은 80 가격표만 쓴다. 한 번 만들어 두고 같은 배열을 넘긴다. */
const EQUIP_SHEETS = sheetsForLine('80')

export type EquipAddRowProps = {
  group: EquipGroup
  onAddPriceItem: (item: PriceItem) => void
  onAddManual: (name: string, price: number) => void
  /** 줄 수 상한에 닿았다 — 더 넣지 못한다. */
  full: boolean
}

export default function EquipAddRow({ group, onAddPriceItem, onAddManual, full }: EquipAddRowProps) {
  const supabase = useRef(createClient()).current
  const [q, setQ] = useState('')
  const [found, setFound] = useState<PriceItem[]>([])
  const [open, setOpen] = useState(false)
  const [manual, setManual] = useState(false)
  const [mName, setMName] = useState('')
  const [mPrice, setMPrice] = useState('')

  const run = useCallback(async (text: string) => {
    setQ(text)
    if (!text.trim()) {
      setFound([])
      setOpen(false)
      return
    }
    const list = await searchPriceList(supabase, text, EQUIP_SHEETS)
    setFound(list)
    setOpen(true)
  }, [supabase])

  const pick = (item: PriceItem) => {
    onAddPriceItem(item)
    setQ('')
    setFound([])
    setOpen(false)
  }

  const addManual = () => {
    if (!mName.trim()) return
    onAddManual(mName, parseNum(mPrice))
    setMName('')
    setMPrice('')
    setManual(false)
  }

  const priceLabel = group === 'domestic' ? '금액(원가)' : '판매단가'

  return (
    <div style={S.addRow}>
      {!manual && (
        <>
          <input
            value={q}
            onChange={e => void run(e.target.value)}
            onBlur={() => window.setTimeout(() => setOpen(false), 150)}
            onFocus={() => { if (found.length > 0) setOpen(true) }}
            disabled={full}
            placeholder={full ? '줄 수 상한에 닿았습니다' : '+ 가격표에서 검색해 이 묶음에 추가 (품번 · 모델명)'}
            style={{ ...S.input, flex: 1, minWidth: 0, background: full ? '#f3f4f6' : '#fff' }}
          />
          <button type="button" onClick={() => setManual(true)} disabled={full} style={full ? S.btnOff : S.miniBtn}>
            직접 추가
          </button>
          {open && found.length > 0 && (
            <div style={S.dropdown}>
              {found.map(item => (
                <button key={item.id} type="button" onMouseDown={() => pick(item)} style={S.dropItem}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: C.INK }}>{item.item_code}</span>
                  <span style={{ fontSize: 11, fontWeight: 500, color: C.DIM, marginLeft: 6 }}>{item.sheet_name}</span>
                  <span style={{ display: 'block', fontSize: 11, fontWeight: 500, color: C.MUT, marginTop: 2 }}>
                    {[item.item_name_jp, item.model_jp].filter(Boolean).join(' · ') || '품명 없음'}
                    {item.cost_jpy ? ` · 구입가 ¥${num(item.cost_jpy)}` : ' · 구입가 없음'}
                  </span>
                </button>
              ))}
            </div>
          )}
          {open && found.length === 0 && q.trim() && (
            <div style={{ ...S.dropdown, padding: '10px 12px', fontSize: 12, color: C.MUT }}>
              가격표에서 찾지 못했습니다 — 「직접 추가」로 넣을 수 있습니다
            </div>
          )}
        </>
      )}

      {manual && (
        <>
          <input
            value={mName}
            onChange={e => setMName(e.target.value)}
            placeholder="품명 (가격표에 없는 항목)"
            style={{ ...S.input, flex: 1, minWidth: 0 }}
          />
          {!isPriceless(group) && (
            <input
              value={mPrice}
              onChange={e => setMPrice(e.target.value)}
              placeholder={priceLabel}
              style={S.num}
            />
          )}
          <button type="button" onClick={addManual} style={S.miniBtn}>추가</button>
          <button type="button" onClick={() => { setManual(false); setMName(''); setMPrice('') }} style={{ ...S.miniBtn, color: C.MUT }}>
            취소
          </button>
        </>
      )}

      {!manual && <span style={S.hint}>검색 결과에 시트(계열) 표시</span>}
    </div>
  )
}
