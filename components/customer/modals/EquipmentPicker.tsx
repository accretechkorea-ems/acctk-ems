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

import { useEffect, useState } from 'react'
import SearchSelect from '@/components/common/SearchSelect'
import {
  EMPTY_MASTER, filterByQuery, loadEquipmentMaster,
  type EquipmentMaster, type MasterConfig, type MasterLineup, type MasterModel,
} from '@/lib/equipmentMaster'
import { BLUE, MUTED } from '@/components/common/ui'
import type { CSSProperties } from 'react'

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

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
      <SearchSelect<MasterLineup>
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
      <SearchSelect<MasterModel>
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
      <SearchSelect<MasterConfig>
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
  )
}
