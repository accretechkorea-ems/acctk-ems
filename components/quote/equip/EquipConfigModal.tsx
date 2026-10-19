'use client'

// 장비 구성 선택 모달 — 껍데기와 연결만 한다(상태는 useEquipConfig, 숫자는 calc.ts).
//
// 장비 양식(equip80)에서만 열린다. 이미 적어 둔 품목은 **건드리지 않는다** —
// 「견적에 추가」는 기존 줄 **뒤에 붙이기**이고, 줄이 있을 때는 한 번 물어본다.
//
// ── 환율·관세율을 어떻게 다루는가 ───────────────────────────────────────────
//   관세율은 **줄마다** 저장되는 값이라(QuoteRow.tariff_rate) 모달에서 고른 값이 그 줄에
//   그대로 붙는다 — 견적의 다른 줄과 달라도 된다.
//   환율은 그렇지 않다. 견적 화면이 환율이 바뀔 때마다 **모든 줄을 하나의 환율로 다시
//   계산**하기 때문에(app/quote/page.tsx:464) 줄마다 다른 환율은 유지되지 못한다.
//   그래서 모달에서 환율을 고쳤다면 「견적에 추가」할 때 **견적 전체 환율을 그 값으로 맞춘다.**
//   그 사실을 바닥글에 먼저 알려 준다(모르는 사이에 기존 줄 금액이 바뀌지 않게).

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { QuoteRow } from '@/app/quote/types'
import { Z } from '@/lib/zIndex'
import { TEMPLATE_ITEM_MAX, isMyTemplate } from '@/lib/quoteTemplates'
import type { QuoteTemplate } from '@/lib/quoteTemplates'
import { C, S, parseNum } from './equipStyles'
import { EQUIP_GROUPS } from './equipLines'
import { useEquipConfig } from './useEquipConfig'
import EquipTemplateList from './EquipTemplateList'
import EquipGroupTable from './EquipGroupTable'
import EquipSummary from './EquipSummary'
import { DeleteTemplateDialog, SaveTemplateDialog } from './SaveTemplateDialog'

export type EquipConfigModalProps = {
  onClose: () => void
  /** 내 engineer_id·표시 이름. */
  myId: number | null
  myName: string
  /** 지금 견적의 분류 — 템플릿에 함께 저장된다. */
  category: string | null
  /** 견적 화면의 환율과 줄 관세율. 모달 안에서만 고칠 수 있다. */
  exchangeRate: number
  tariffRate: number
  /** 이미 적어 둔 품목 수 — 0 이 아니면 추가 전에 한 번 묻는다. */
  existingRowCount: number
  /** 이미 할인 줄이 있는가 — 할인은 견적당 1건이라 겹치면 알려 준다. */
  hasDiscountRow: boolean
  /** 체크한 줄을 견적에 붙인다. discount 는 있으면 할인 줄 하나다. */
  onAdd: (rows: QuoteRow[], discount: QuoteRow | null) => void
  /** 모달에서 환율을 고쳤을 때 견적 전체 환율을 맞춘다. */
  onExchangeRate: (rate: number) => void
}

export default function EquipConfigModal(props: EquipConfigModalProps) {
  const {
    onClose, myId, myName, category, exchangeRate, tariffRate,
    existingRowCount, hasDiscountRow, onAdd, onExchangeRate,
  } = props

  const [supabase] = useState(() => createClient())
  const cfg = useEquipConfig({
    supabase, open: true, myId, myName, category,
    defaultExchangeRate: exchangeRate, defaultTariff: tariffRate,
  })

  const [saveOpen, setSaveOpen] = useState(false)
  const [delTarget, setDelTarget] = useState<QuoteTemplate | null>(null)
  const [askAppend, setAskAppend] = useState(false)

  const full = cfg.lines.length >= TEMPLATE_ITEM_MAX
  const rateChanged = cfg.exRate > 0 && cfg.exRate !== exchangeRate
  const mine = cfg.picked ? isMyTemplate(cfg.picked, myId) : true
  const defaultName = cfg.defaultName(myName)

  /** 실제로 붙이는 일 — 환율을 맞춘 뒤 줄을 넘기고 모달을 닫는다. */
  const commit = () => {
    const { rows, discount } = cfg.takeRows()
    if (rateChanged) onExchangeRate(cfg.exRate)
    onAdd(rows, discount)
    onClose()
  }

  const addToQuote = () => {
    if (cfg.checkedCount === 0) return
    if (existingRowCount > 0) setAskAppend(true)
    else commit()
  }

  return (
    <div style={S.backdrop}>
      <div style={S.modal}>
        {/* ── 머리 ── */}
        <div style={S.head}>
          <h2 style={S.title}>장비 구성 선택</h2>
          <div style={S.headFields}>
            <span>환율 (JPY→KRW)</span>
            <input
              value={cfg.exRate || ''}
              onChange={e => cfg.setExRate(Number(e.target.value) || 0)}
              aria-label="환율"
              style={S.numSmall}
            />
            <span>관세율</span>
            <input
              value={cfg.tariff || ''}
              onChange={e => cfg.setTariff(Number(e.target.value) || 0)}
              aria-label="관세율"
              style={S.numSmall}
            />
            <span>장비 수량</span>
            <input
              value={cfg.machineQty || ''}
              onChange={e => cfg.setMachineQty(Math.max(1, Math.min(999, parseNum(e.target.value))))}
              aria-label="장비 수량"
              style={{ ...S.numSmall, width: 46, textAlign: 'center' }}
            />
          </div>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose} aria-label="닫기" style={S.closeBtn}>×</button>
        </div>

        {/* ── 몸통 ── */}
        <div style={S.body}>
          <div style={{ ...S.col, ...S.left }}>
            <EquipTemplateList
              templates={cfg.templates}
              counts={cfg.counts}
              loading={cfg.listLoading}
              myId={myId}
              pickedId={cfg.picked?.id ?? null}
              onPick={t => void cfg.selectTemplate(t)}
              onEmpty={cfg.startEmpty}
              onAskDelete={setDelTarget}
            />
          </div>

          <div style={{ ...S.col, ...S.mid }}>
            {cfg.error && (
              <div style={{ margin: '12px 16px 0', fontSize: 12, fontWeight: 600, color: C.RED }}>{cfg.error}</div>
            )}
            {cfg.missingCount > 0 && (
              <div style={{ margin: '12px 16px 0', fontSize: 12, fontWeight: 500, color: C.MUT }}>
                가격표에서 찾을 수 없는 품번이 {cfg.missingCount}개 있습니다 — 체크가 풀려 있습니다.
              </div>
            )}
            {EQUIP_GROUPS.map(group => (
              <EquipGroupTable
                key={group}
                group={group}
                lines={cfg.linesOf(cfg.lines, group)}
                full={full}
                onToggle={cfg.toggleLine}
                onToggleGroup={cfg.toggleGroup}
                onQty={cfg.setLineQty}
                onPrice={cfg.setLinePrice}
                onText={cfg.setLineText}
                onRemove={cfg.removeLine}
                onAddPriceItem={cfg.addPriceItem}
                onAddManual={cfg.addManualItem}
              />
            ))}
            {full && (
              <div style={{ margin: '12px 16px 0', fontSize: 12, fontWeight: 500, color: C.RED }}>
                한 구성에 넣을 수 있는 줄은 {TEMPLATE_ITEM_MAX}개까지입니다.
              </div>
            )}
          </div>

          <div style={{ ...S.col, ...S.right }}>
            <EquipSummary
              modelKey={cfg.modelKey}
              machineQty={cfg.machineQty}
              lines={cfg.lines}
              discount={cfg.discount}
              setDiscount={cfg.setDiscount}
              totals={cfg.totals}
            />
          </div>
        </div>

        {/* ── 바닥 ── */}
        <div style={S.foot}>
          <span style={{ fontSize: 12, fontWeight: 500, color: C.MUT }}>
            체크한 항목이 묶음(1 본체+기본 / 2 옵션 / 3 포함사항)으로 견적서에 들어갑니다. 추가한 뒤에도 줄 단위로 고칠 수 있습니다.
            {rateChanged && ' · 환율을 고쳤으므로 견적 전체 환율도 이 값으로 맞춰집니다.'}
            {hasDiscountRow && cfg.discount > 0 && ' · 견적에 이미 할인 줄이 있어 이번 할인은 붙지 않습니다.'}
          </span>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => setSaveOpen(true)}
            disabled={cfg.lines.length === 0}
            style={cfg.lines.length === 0 ? S.btnOff : S.btn}
          >
            템플릿으로 저장
          </button>
          <button type="button" onClick={onClose} style={{ ...S.btn, color: C.MUT }}>취소</button>
          <button
            type="button"
            onClick={addToQuote}
            disabled={cfg.checkedCount === 0}
            style={cfg.checkedCount === 0 ? S.btnOff : S.btnPri}
          >
            견적에 추가 ({cfg.checkedCount})
          </button>
        </div>
      </div>

      {saveOpen && (
        <SaveTemplateDialog
          picked={cfg.picked}
          mine={mine}
          defaultName={defaultName}
          modelKey={cfg.modelKey}
          setModelKey={cfg.setModelKey}
          itemCount={cfg.lines.length}
          busy={cfg.busy}
          onSave={cfg.saveTemplate}
          onClose={() => setSaveOpen(false)}
        />
      )}

      {delTarget && (
        <DeleteTemplateDialog
          target={delTarget}
          busy={cfg.busy}
          onDelete={() => cfg.removeTemplate(delTarget.id)}
          onClose={() => setDelTarget(null)}
        />
      )}

      {askAppend && (
        <div style={{ ...S.backdrop, zIndex: Z.subModal }} onClick={() => setAskAppend(false)}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 8, padding: 24, width: '100%', maxWidth: 420,
              boxShadow: '0 20px 60px rgba(0,0,0,0.22)', animation: 'modal-in 0.18s ease',
            }}
          >
            <div style={{ fontSize: 17, fontWeight: 800, color: C.INK, letterSpacing: '-0.3px', marginBottom: 4 }}>
              기존 품목 뒤에 추가합니다
            </div>
            <div style={{ fontSize: 12, fontWeight: 500, color: C.MUT }}>
              이미 적어 둔 품목 {existingRowCount}줄은 그대로 두고, 고른 {cfg.checkedCount}줄을 그 뒤에 붙입니다.
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setAskAppend(false)} style={{ ...S.btn, color: C.MUT }}>취소</button>
              <button type="button" onClick={() => { setAskAppend(false); commit() }} style={S.btnPri}>추가</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
