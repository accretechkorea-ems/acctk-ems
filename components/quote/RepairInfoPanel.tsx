'use client'

// **수리 건 정보 패널** — 견적 작성 화면과 견적 목록 드로어가 함께 쓴다.
//
// ── 두 자리, 한 컴포넌트 ────────────────────────────────────────────────────
//   견적 작성 화면 — 아직 저장되지 않은 견적이다. **저장할 곳(quote_id)이 없다.**
//                    그래서 글자는 화면이 들고 있다가(page.tsx 의 repairInfo 상태,
//                    임시저장에도 함께 담긴다) 확정할 때 한 번에 올린다.
//   견적 목록 드로어 — 이미 저장된 견적이다. 여기서는 **「저장」 버튼**이 바로 쓴다.
//   같은 칸을 두 번 그리지 않으려고 mode 로만 가른다.
//
// ── 위는 읽기, 아래는 입력 ──────────────────────────────────────────────────
//   위(구분·시리얼·입고·수리완료·출고)는 **수리 목록이 정본**이라 여기서 고치지 않는다.
//   한 사실을 두 곳에서 고칠 수 있게 두면 어느 쪽이 맞는지 알 수 없게 된다.
//
// 자동 저장은 없다 — 적다 만 글이 목록 뱃지를 「작성중」으로 바꿔 버리지 않게.

import { useState } from 'react'
import {
  REPAIR_INFO_DOT, REPAIR_INFO_LABEL, repairDate, repairInfoState, shippedLabel,
  type RepairBrief, type RepairInfoFields,
} from '@/lib/quoteRepairInfo'

const BORDER = '#ebebeb'
const MUTED = '#9ca3af'
const GRAY = '#6b7280'
const TEXT = '#111827'

export type RepairInfoPanelProps = {
  /** 연결된 수리 건. 없으면 위 읽기 줄을 내지 않는다. */
  repair: RepairBrief | null
  value: RepairInfoFields
  onChange: (v: RepairInfoFields) => void
  /**
   * 'draft' — 아직 저장되지 않은 견적. 저장 버튼 없이 안내만 둔다.
   * 'saved' — 저장된 견적. 「저장」 버튼이 바로 쓴다.
   */
  mode: 'draft' | 'saved'
  /** mode='saved' 에서만 쓴다. 저장하는 함수(성공 여부를 돌려준다). */
  onSave?: () => Promise<boolean>
  /** 고칠 수 있는가 — 견적 작성자·관리자가 아니면 읽기만 한다. */
  canEdit?: boolean
}

/** 위 읽기 줄의 한 칸. */
function ReadCell({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11, color: MUTED, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12, color: TEXT, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {value}
      </div>
    </div>
  )
}

/** 여러 줄 입력 한 칸. */
function Field({
  label, placeholder, value, onChange, disabled,
}: { label: string; placeholder: string; value: string; onChange: (v: string) => void; disabled: boolean }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11, color: GRAY, fontWeight: 600, marginBottom: 3 }}>{label}</div>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        rows={3}
        style={{
          width: '100%', boxSizing: 'border-box', resize: 'vertical',
          padding: '7px 9px', borderRadius: 6, border: `1px solid ${BORDER}`,
          fontSize: 12, lineHeight: 1.5, color: TEXT, outline: 'none', fontFamily: 'inherit',
          background: disabled ? '#f8fafc' : '#fff',
        }}
      />
    </div>
  )
}

export default function RepairInfoPanel({ repair, value, onChange, mode, onSave, canEdit = true }: RepairInfoPanelProps) {
  const [saving, setSaving] = useState(false)
  const state = repairInfoState(value)
  const set = (k: keyof RepairInfoFields) => (v: string) => onChange({ ...value, [k]: v })

  return (
    <div>
      {/* 수리 목록이 정본인 칸 — 여기서는 보기만 한다. */}
      {repair && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8,
          padding: '9px 10px', borderRadius: 6, background: '#fafbfc', border: `1px solid ${BORDER}`,
          marginBottom: 10,
        }}>
          <ReadCell label="구분" value={(repair.item_type ?? '').trim() || '-'} />
          <ReadCell label="시리얼번호" value={(repair.serial_number ?? '').trim() || '-'} />
          <ReadCell label="입고일" value={repairDate(repair.received_date)} />
          <ReadCell label="수리완료일" value={repairDate(repair.repair_done_at)} />
          <ReadCell label="출고일" value={shippedLabel(repair.shipped_date)} />
        </div>
      )}

      <Field label="고장 증상" placeholder="예: 전원이 들어오지 않음" value={value.symptom ?? ''} onChange={set('symptom')} disabled={!canEdit} />
      <Field label="고장 원인" placeholder="예: 전원부 기판 소손" value={value.cause ?? ''} onChange={set('cause')} disabled={!canEdit} />
      <Field label="처리 결과" placeholder="예: 전원부 기판 교체 후 정상 동작 확인" value={value.result ?? ''} onChange={set('result')} disabled={!canEdit} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
        {/* 지금 상태 — 목록 뱃지와 **같은 판정**이다(lib/quoteRepairInfo.ts). */}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: GRAY }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: REPAIR_INFO_DOT[state], flexShrink: 0 }} />
          수리정보 {REPAIR_INFO_LABEL[state]}
        </span>
        <span style={{ flex: 1 }} />
        {mode === 'draft' ? (
          <span style={{ fontSize: 11, color: MUTED }}>견적을 확정하면 함께 저장됩니다</span>
        ) : canEdit ? (
          <button
            onClick={async () => {
              if (saving || !onSave) return
              setSaving(true)
              try { await onSave() } finally { setSaving(false) }
            }}
            disabled={saving}
            style={{
              height: 30, padding: '0 14px', borderRadius: 6, border: 'none',
              background: '#234ea2', color: '#fff', fontSize: 12, fontWeight: 700,
              cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? '저장 중…' : '저장'}
          </button>
        ) : (
          <span style={{ fontSize: 11, color: MUTED }}>작성자만 고칠 수 있습니다</span>
        )}
      </div>
    </div>
  )
}
