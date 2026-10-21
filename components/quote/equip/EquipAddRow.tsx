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
// ── 「직접 추가」 ───────────────────────────────────────────────────────────
//   가격표에 없는 항목이다. 누르면 검색창 자리에 **품번 · 품명 · 수량**(+ 금액) 칸이 나오고,
//   확인(엔터 또는 「추가」)해야 줄이 생긴다. 예전에는 검색창에 친 글자가 그대로 품명이 된
//   줄이 **바로** 생겨서, 검색하려다 줄이 생기는 일이 있었다.
//   취소(ESC 또는 「취소」)하면 칸이 닫힌다. 품번은 비워도 된다(표·견적서에 「-」로 나간다).
//
//   금액 칸은 묶음에 따라 뜻이 다르다 — 본체·옵션은 **구입가(엔)**, 포함사항은 **원가(원)**.
//   포함사항의 원가는 매출에 들어가지 않고 총 구입원가·이익률에만 들어간다(lineFromManual 참조).

import { useCallback, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { searchPriceList } from '@/lib/priceSearch'
import { sheetsForLine } from '@/lib/priceListKinds'
import type { PriceItem } from '@/app/quote/types'
import { C, S, num, parseNum } from './equipStyles'
import { isPriceless } from './equipLines'
import type { EquipGroup } from './equipLines'
import type { ManualInput } from './useEquipConfig'

/** 장비 구성은 80 가격표만 쓴다. 한 번 만들어 두고 같은 배열을 넘긴다. */
const EQUIP_SHEETS = sheetsForLine('80')

export type EquipAddRowProps = {
  group: EquipGroup
  onAddPriceItem: (item: PriceItem) => void
  onAddManual: (input: ManualInput) => void
  /** 줄 수 상한에 닿았다 — 더 넣지 못한다. */
  full: boolean
}

export default function EquipAddRow({ group, onAddPriceItem, onAddManual, full }: EquipAddRowProps) {
  const supabase = useRef(createClient()).current
  const [q, setQ] = useState('')
  const [found, setFound] = useState<PriceItem[]>([])
  const [open, setOpen] = useState(false)
  const [manual, setManual] = useState(false)
  const [mCode, setMCode] = useState('')
  const [mName, setMName] = useState('')
  const [mQty, setMQty] = useState('1')
  const [mAmount, setMAmount] = useState('')

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

  /** 칸을 비우고 폼을 닫는다. */
  const closeManual = () => {
    setManual(false)
    setMCode('')
    setMName('')
    setMQty('1')
    setMAmount('')
  }

  /** 확인 — 품명이 있어야 줄이 생긴다. 나머지는 비어도 된다. */
  const addManual = () => {
    if (!mName.trim()) return
    onAddManual({
      partCode: mCode,
      name: mName,
      qty: parseNum(mQty) || 1,
      amount: parseNum(mAmount),
    })
    closeManual()
  }

  /** 엔터로 확인, ESC 로 취소. 칸마다 걸지 않고 폼 전체에 한 번 건다. */
  const onManualKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); addManual() }
    if (e.key === 'Escape') { e.preventDefault(); closeManual() }
  }

  // 금액 칸 — 묶음에 따라 뜻이 다르다. 넷 다 비워 둘 수 있다(비우면 0).
  const amountLabel = isPriceless(group) ? '원가(원)' : '구입가(엔)'

  return (
    <div style={S.addWrap}>
      <div style={S.addRow}>
      {!manual && (
        <>
          <input
            value={q}
            onChange={e => void run(e.target.value)}
            onBlur={() => window.setTimeout(() => setOpen(false), 150)}
            onFocus={() => { if (found.length > 0) setOpen(true) }}
            disabled={full}
            placeholder={full ? '줄 수 상한에 닿았습니다' : '+ 가격표에서 검색해 이 묶음에 추가 (품번 · 품명 · 모델)'}
            style={{ ...S.input, flex: 1, minWidth: 0, background: full ? '#f3f4f6' : '#fff' }}
          />
          <button type="button" onClick={() => setManual(true)} disabled={full} style={full ? S.btnOff : S.miniBtn}>
            직접 추가
          </button>
        </>
      )}

      {manual && (
        <>
          <input
            value={mCode}
            onChange={e => setMCode(e.target.value)}
            onKeyDown={onManualKey}
            placeholder="품번 (없으면 비움)"
            aria-label="품번"
            style={{ ...S.input, width: 110, flexShrink: 0 }}
          />
          <input
            value={mName}
            onChange={e => setMName(e.target.value)}
            onKeyDown={onManualKey}
            placeholder="품명"
            aria-label="품명"
            autoFocus
            style={{ ...S.input, flex: 1, minWidth: 0 }}
          />
          <input
            value={mQty}
            onChange={e => setMQty(e.target.value)}
            onKeyDown={onManualKey}
            placeholder="수량"
            aria-label="수량"
            style={{ ...S.qty, flexShrink: 0 }}
          />
          <input
            value={mAmount}
            onChange={e => setMAmount(e.target.value)}
            onKeyDown={onManualKey}
            placeholder={amountLabel}
            aria-label={amountLabel}
            style={{ ...S.num, flexShrink: 0 }}
          />
          <button type="button" onClick={addManual} disabled={!mName.trim()} style={mName.trim() ? S.miniBtn : S.btnOff}>
            추가
          </button>
          <button type="button" onClick={closeManual} style={{ ...S.miniBtn, color: C.MUT }}>
            취소
          </button>
        </>
      )}

      {!manual && <span style={S.hint}>검색 결과에 시트(계열) 표시</span>}
      {manual && <span style={S.hint}>엔터로 추가 · ESC 로 취소</span>}
      </div>

      {/* 검색 결과 — 흐름 안에 쌓는다(절대 위치로 띄우면 묶음 칸에 잘린다. equipStyles 참조). */}
      {!manual && open && found.length > 0 && (
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
      {!manual && open && found.length === 0 && q.trim() !== '' && (
        <div style={{ ...S.dropdown, padding: '10px 12px', fontSize: 12, color: C.MUT }}>
          가격표에서 찾지 못했습니다 — 「직접 추가」로 넣을 수 있습니다
        </div>
      )}
    </div>
  )
}
