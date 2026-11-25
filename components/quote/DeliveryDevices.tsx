'use client'

/**
 * 발주서 등록 창의 **납품 예정 장비** 섹션 (2026-11-26).
 *
 * 수주가 끝나면 그 사업장에 **곧 들어올 장비**가 정해진다. 지금까지는 설치가 끝나고
 * 누군가 손으로 등록할 때까지 그 장비가 어디에도 없었다 — 「언제 무엇이 들어오나」를
 * 묻는 자리가 답할 수 없었다. 발주를 올리는 그 자리에서 함께 받는다.
 *
 * ── 받는 것 ─────────────────────────────────────────────────────────────
 *   장비명(라인업·모델·구성) · 사업장 · 설치 예정월. **셋 다 채워야 저장된다.**
 *   S/N·납입일·사진은 비워 둔다 — 물건이 와서 설치 레포트를 쓸 때 채운다.
 *
 * 견적 품목에서 **미리 채운다**(수량만큼 줄을 만든다). 지우고 더할 수 있다.
 */

import { useEffect, useState } from 'react'
import EquipmentPicker from '@/components/customer/modals/EquipmentPicker'
import { EMPTY_DRAFT, type DeliveryDraft } from '@/lib/deliveryPending'
import { isMasterPending, loadEquipmentMaster, EMPTY_MASTER, type EquipmentMaster } from '@/lib/equipmentMaster'
import { BORDER, CARD_BG, MUTED, SUB, TEXT } from '@/components/common/ui'
import { R } from '@/lib/radius'

export type DeliveryDevicesProps = {
  drafts: DeliveryDraft[]
  onChange: (next: DeliveryDraft[]) => void
  /** 고를 수 있는 사업장 — 견적의 사업장과 그 회사의 형제 사업장. */
  sites: { customer_id: number; label: string }[]
  /** 못 저장하는 까닭(있으면 바닥에 적는다). */
  blocked: string | null
  disabled?: boolean
}

const field: React.CSSProperties = {
  width: '100%', height: 34, padding: '0 8px', boxSizing: 'border-box',
  border: `1px solid ${BORDER}`, borderRadius: R.control, fontSize: 12,
  background: CARD_BG, color: TEXT, outline: 'none', fontFamily: 'inherit',
}

export default function DeliveryDevices({ drafts, onChange, sites, blocked, disabled }: DeliveryDevicesProps) {
  const [master, setMaster] = useState<EquipmentMaster>(EMPTY_MASTER)
  useEffect(() => { void loadEquipmentMaster().then(setMaster) }, [])

  const set = (i: number, patch: Partial<DeliveryDraft>) => {
    const next = drafts.map((d, k) => (k === i ? { ...d, ...patch } : d))
    // 마스터 밖 값인지 그때그때 센다 — 저장할 때 그 자국이 장비 줄에 남는다.
    next[i].master_pending = isMasterPending(master, next[i].device_name, next[i].device_name2, next[i].option)
    onChange(next)
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: SUB, fontWeight: 700 }}>납품 예정 장비</span>
        <span style={{ fontSize: 10, color: MUTED }}>장비명 · 사업장 · 설치 예정월을 모두 적어야 등록됩니다</span>
        <span style={{ flex: 1 }} />
        <button type="button" disabled={disabled}
          onClick={() => onChange([...drafts, { ...EMPTY_DRAFT, customer_id: sites[0]?.customer_id ?? null }])}
          style={{ height: 24, padding: '0 8px', borderRadius: R.control, border: `1px solid ${BORDER}`, background: CARD_BG, color: SUB, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
          ＋ 줄 추가
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {drafts.map((d, i) => (
          <div key={i} style={{ border: `1px solid ${BORDER}`, borderRadius: R.control, padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="num" style={{ fontSize: 11, color: MUTED, fontWeight: 700 }}>{i + 1}</span>
              <span style={{ flex: 1 }} />
              <button type="button" disabled={disabled} onClick={() => onChange(drafts.filter((_, k) => k !== i))}
                aria-label={`${i + 1}번째 줄 지우기`}
                style={{ width: 22, height: 22, borderRadius: R.icon, border: `1px solid ${BORDER}`, background: CARD_BG, color: MUTED, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1 }}>
                ×
              </button>
            </div>
            <EquipmentPicker
              lineup={d.device_name} model={d.device_name2} config={d.option}
              onChange={next => set(i, {
                device_name: next.lineup ?? d.device_name,
                device_name2: next.model ?? d.device_name2,
                option: next.config ?? d.option,
              })}
              fieldStyle={field}
              lineupInvalid={!d.device_name.trim()}
              disabled={disabled}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 6 }}>
              <select value={d.customer_id ?? ''} disabled={disabled}
                onChange={e => set(i, { customer_id: e.target.value ? Number(e.target.value) : null })}
                style={field}>
                <option value="">사업장 고르기</option>
                {sites.map(s => <option key={s.customer_id} value={s.customer_id}>{s.label}</option>)}
              </select>
              <input type="month" value={d.install_due_month} disabled={disabled}
                onChange={e => set(i, { install_due_month: e.target.value })}
                style={field} />
            </div>
          </div>
        ))}
        {drafts.length === 0 && (
          <div style={{ fontSize: 11, color: MUTED, padding: '8px 0' }}>
            견적 품목에서 장비를 찾지 못했습니다 — 「＋ 줄 추가」로 적어 주세요.
          </div>
        )}
      </div>

      {blocked && (
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--color-danger)', fontWeight: 600 }}>{blocked}</div>
      )}
    </div>
  )
}
