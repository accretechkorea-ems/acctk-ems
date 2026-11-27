'use client'

/**
 * 장비 **라인업 · 모델 · 구성** 세 칸 — 마스터에서 고르거나 그냥 적는다 (2026-11-26).
 *
 * ── 고르되 가두지 않는다 ─────────────────────────────────────────────────
 *   목록(db/equipment_master_20261126.sql)은 가격표에서 만든 **정본**이고, 거기 없는
 *   기종도 그대로 적을 수 있다. 적어 넣으면 그 장비 줄에 `master_pending` 자국이 남아
 *   나중에 「마스터 밖 장비」만 모아 볼 수 있다. 막아 버리면 등록 자체를 못 한다 —
 *   현장에는 가격표에 없는 옛 기종이 많다.
 *
 * ── 표가 없거나 20(반도체)이면 ───────────────────────────────────────────
 *   마스터가 비어 있으면 세 칸이 **그냥 입력칸**처럼 돈다(지금까지와 같다).
 *
 * 세 칸은 **위에서 아래로** 좁혀진다 — 라인업을 고르면 그 라인업의 모델만, 모델을
 * 고르면 그 모델의 구성만 보인다. 손으로 적은 값이면 좁힐 것이 없으니 전부 보여 준다.
 */

import { useEffect, useId, useState } from 'react'
import SearchSelect from '@/components/common/SearchSelect'
import {
  EMPTY_MASTER, filterByQuery, loadEquipmentMaster,
  type EquipmentMaster, type MasterConfig, type MasterLineup, type MasterModel,
} from '@/lib/equipmentMaster'
import { BLUE, MUTED } from '@/components/common/ui'
import { LABEL_WEIGHT, TEXT_LABEL } from '@/lib/textTokens'
import type { CSSProperties } from 'react'

/**
 * 폰에서는 **세로 석 줄**이다 (2026-11-27).
 *
 * 세 칸을 390 에 1fr 셋으로 나누면 한 칸이 **109px**(350 에서는 95px)이 된다 —
 * 「라인업 (ex. SURFCOM NEX)」 가 「라인업 (ex.」 에서 잘리고, 빈 상자 셋으로 보인다.
 * 칸을 좁히는 것으로는 못 푼다(글자는 16px 아래로 내릴 수 없다 — iOS 가 확대한다).
 * 그래서 좁은 화면에서는 **한 줄에 한 칸**씩 놓고 칸마다 이름을 붙인다.
 * PC 는 지금 그대로 3열이다.
 */
const GRID_CSS = `
  .eqp-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
  .eqp-label { display: none; }
  @media (max-width: 768px) {
    .eqp-grid { grid-template-columns: 1fr; gap: 10px; }
    .eqp-cell { min-width: 0; }
    .eqp-label { display: block; margin-bottom: 4px; }
  }
`

export type EquipmentPickerProps = {
  lineup: string
  model: string
  config: string
  onChange: (next: { lineup?: string; model?: string; config?: string }) => void
  /** 칸 모양 — 부르는 창의 입력칸과 같게 받는다. */
  fieldStyle: CSSProperties
  /** 라인업 칸의 빨간 테두리(필수 미입력). */
  lineupInvalid?: boolean
  disabled?: boolean
}

export default function EquipmentPicker({
  lineup, model, config, onChange, fieldStyle, lineupInvalid, disabled,
}: EquipmentPickerProps) {
  const uid = useId()
  const [master, setMaster] = useState<EquipmentMaster>(EMPTY_MASTER)
  const [qL, setQL] = useState('')
  const [qM, setQM] = useState('')
  const [qC, setQC] = useState('')

  useEffect(() => { void loadEquipmentMaster().then(setMaster) }, [])

  const lu = master.lineups.find(l => l.name === lineup.trim()) ?? null
  const mo = lu?.models.find(m => m.name === model.trim()) ?? null
  const models: MasterModel[] = lu ? lu.models : master.lineups.flatMap(l => l.models)
  const configs: MasterConfig[] = mo ? mo.configs : models.flatMap(m => m.configs)

  const box = (invalid?: boolean): CSSProperties => ({
    ...fieldStyle,
    ...(invalid ? { borderColor: 'var(--color-danger)' } : null),
  })

  const labelStyle: CSSProperties = { fontSize: 12, fontWeight: LABEL_WEIGHT, color: TEXT_LABEL }

  return (
    <div className="eqp-grid">
      <style>{GRID_CSS}</style>
      <div className="eqp-cell">
      <label className="eqp-label" htmlFor={`${uid}-lineup`} style={labelStyle}>라인업</label>
      <SearchSelect<MasterLineup>
        inputId={`${uid}-lineup`}
        items={filterByQuery(master.lineups, qL || lineup)}
        itemKey={l => l.id}
        renderItem={l => (
          <span style={{ fontSize: 13 }}>
            {l.name}
            <span style={{ color: MUTED, marginLeft: 6, fontSize: 11 }}>{l.models.length}</span>
          </span>
        )}
        onSelect={l => { onChange({ lineup: l.name, model: '', config: '' }); setQL(''); setQM(''); setQC('') }}
        query={qL || lineup}
        onQueryChange={v => { setQL(v); onChange({ lineup: v }) }}
        placeholder="라인업 (ex. SURFCOM NEX)"
        inputStyle={box(lineupInvalid)}
        disabled={disabled}
        openWhenEmpty
        emptyText="목록에 없는 라인업입니다 — 적은 그대로 저장됩니다"
      />
      </div>
      <div className="eqp-cell">
      <label className="eqp-label" htmlFor={`${uid}-model`} style={labelStyle}>모델명</label>
      <SearchSelect<MasterModel>
        inputId={`${uid}-model`}
        items={filterByQuery(models, qM || model)}
        itemKey={m => m.id}
        renderItem={m => <span style={{ fontSize: 13 }}>{m.name}</span>}
        onSelect={m => { onChange({ model: m.name, config: '' }); setQM(''); setQC('') }}
        query={qM || model}
        onQueryChange={v => { setQM(v); onChange({ model: v }) }}
        placeholder="모델 (ex. 040)"
        inputStyle={box()}
        disabled={disabled}
        openWhenEmpty
        emptyText="목록에 없는 모델입니다 — 적은 그대로 저장됩니다"
      />
      </div>
      <div className="eqp-cell">
      <label className="eqp-label" htmlFor={`${uid}-config`} style={labelStyle}>옵션</label>
      <SearchSelect<MasterConfig>
        inputId={`${uid}-config`}
        items={filterByQuery(configs, qC || config)}
        itemKey={c => c.id}
        renderItem={c => <span style={{ fontSize: 13 }}>{c.name}</span>}
        onSelect={c => { onChange({ config: c.name }); setQC('') }}
        query={qC || config}
        onQueryChange={v => { setQC(v); onChange({ config: v }) }}
        placeholder="구성 (ex. DX2-12)"
        inputStyle={box()}
        disabled={disabled}
        openWhenEmpty
        emptyText="목록에 없는 구성입니다 — 적은 그대로 저장됩니다"
        note={master.empty
          ? <span style={{ fontSize: 11, color: MUTED }}>마스터가 없어 자유 입력으로 받습니다</span>
          : <span style={{ fontSize: 11, color: BLUE }}>목록에 없으면 그대로 적어도 됩니다</span>}
      />
      </div>
    </div>
  )
}
