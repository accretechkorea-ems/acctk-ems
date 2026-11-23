'use client'

/**
 * 사후 실적 입력 창 — **슈퍼관리자만** (2026-11-23).
 *
 * EMS 밖에서 끝난 건을 한 줄로 적어 넣는다. 규칙은 lib/quoteBackfill.ts 에 있다.
 * 칸은 위에서 아래로 읽히는 차례대로 서고, 못 누르는 까닭도 그 차례로 한 번에 하나만 뜬다.
 *
 *   회사 → 사업장(필수) · 양식 · 담당자 · 상태 → 상태가 쓰는 날짜 · 금액(통화·환율)
 *   · 견적번호(자동/수기) · PDF(필수) · 비고
 *
 * 회사·사업장 고르기는 의뢰서와 **같은 부품**이다(components/inquiry/SitePicker.tsx) —
 * 자리마다 다른 방식으로 고르게 하지 않는다.
 */

import { useMemo, useState, type CSSProperties } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import ModalCard, { keepPads } from '@/components/common/ModalCard'
import SitePicker, { type PickedDevice, type PickedSite } from '@/components/inquiry/SitePicker'
import { BLUE, BORDER, MUTED, SUB, TEXT } from '@/components/common/ui'
import { LABEL_WEIGHT, TEXT_LABEL } from '@/lib/textTokens'
import { FORM_KINDS, FORM_LABELS } from '@/lib/quoteForms'
import {
  BACKFILL_STATUSES, CURRENCIES, EMPTY_BACKFILL, NOTE_MAX,
  amountKrw, backfillBlockedReason, statusDateLabel, type BackfillForm,
} from '@/lib/quoteBackfill'
import { numKR } from '@/components/customer/constants'
import { R } from '@/lib/radius'

const PADS = keepPads({ x: 22, top: 22, bottom: 22 }, 0, 18)

const field: CSSProperties = {
  width: '100%', padding: '9px 10px', border: `1px solid ${BORDER}`, borderRadius: R.control,
  fontSize: 13, color: TEXT, background: '#fff', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
}
const labelStyle: CSSProperties = {
  fontSize: 11, fontWeight: LABEL_WEIGHT, color: TEXT_LABEL, marginBottom: 5, display: 'block',
}

function Row({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={labelStyle} htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  )
}

export type EngineerOption = { engineer_id: number; name: string | null; initials: string | null }

export default function BackfillModal({ engineers, busy, onSave, onClose }: {
  /** 실적을 받을 수 있는 사람들(재직자). */
  engineers: EngineerOption[]
  busy: boolean
  onSave: (form: BackfillForm, pdf: File) => void
  onClose: () => void
}) {
  const [form, setForm] = useState<BackfillForm>(EMPTY_BACKFILL)
  const [site, setSite] = useState<PickedSite>(null)
  const [device, setDevice] = useState<PickedDevice>(null)
  const [pdf, setPdf] = useState<File | null>(null)

  const set = <K extends keyof BackfillForm>(k: K, v: BackfillForm[K]) => setForm(p => ({ ...p, [k]: v }))

  /**
   * 고른 사업장·파일까지 합친 **지금의 값**. 효과로 폼에 비추지 않는다 —
   * 렌더 중에 상태를 또 바꾸면 한 번 그린 뒤 다시 그리게 된다(react-hooks/set-state-in-effect).
   */
  const full: BackfillForm = { ...form, customerId: site?.id ?? null, hasPdf: pdf != null }

  const dateLabel = statusDateLabel(form.status)
  const krw = useMemo(
    () => amountKrw(form.amount, form.currency, form.exchangeRate),
    [form.amount, form.currency, form.exchangeRate],
  )
  const blocked = backfillBlockedReason(full)
  const dirty = site != null || form.amount > 0 || form.note.trim() !== '' || pdf != null

  return (
    <ModalOverlay onClose={onClose} confirmClose dirty={dirty}>
      <ModalCard
        width={520}
        closeX={false}
        {...PADS}
        title={<>
          <div style={{ fontSize: 17, fontWeight: 800, color: TEXT, marginBottom: 6 }}>사후 실적 입력</div>
          <div style={{ fontSize: 12, color: SUB, lineHeight: 1.7, marginBottom: 14 }}>
            EMS 밖에서 끝난 건을 실적에 넣습니다. 목록에는 <b style={{ color: TEXT }}>사후 입력</b> 으로 표시됩니다.
          </div>
        </>}
        footer={<>
          <button type="button" onClick={onClose} disabled={busy}
            style={{ padding: '9px 15px', background: '#fff', color: SUB, borderRadius: R.icon, border: `1px solid ${BORDER}`, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
            닫기
          </button>
          <button type="button" onClick={() => { if (!blocked && pdf) onSave(full, pdf) }} disabled={blocked != null || busy}
            style={{
              padding: '9px 17px', background: blocked || busy ? '#e5e7eb' : BLUE, color: blocked || busy ? MUTED : '#fff',
              borderRadius: R.icon, border: 'none', cursor: blocked || busy ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 13,
            }}>
            {busy ? '담는 중…' : '실적 담기'}
          </button>
        </>}
      >
        {/* 회사 → 사업장 → 장비. 장비는 쓰지 않지만 같은 부품을 그대로 쓴다. */}
        <SitePicker site={site} setSite={setSite} device={device} setDevice={setDevice} />

        <Row label="양식" htmlFor="bf-form">
          <select id="bf-form" value={form.formKind} onChange={e => set('formKind', e.target.value)} style={field}>
            <option value="" disabled hidden>양식을 고르세요</option>
            {FORM_KINDS.map(k => <option key={k} value={k}>{FORM_LABELS[k]}</option>)}
          </select>
        </Row>

        <Row label="담당자" htmlFor="bf-owner">
          <select id="bf-owner" value={form.engineerId ?? ''} style={field}
            onChange={e => set('engineerId', e.target.value ? Number(e.target.value) : null)}>
            <option value="" disabled hidden>실적을 받을 사람을 고르세요</option>
            {engineers.map(e => (
              <option key={e.engineer_id} value={e.engineer_id}>
                {e.name ?? `#${e.engineer_id}`}{e.initials ? ` (${e.initials})` : ''}
              </option>
            ))}
          </select>
        </Row>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Row label="상태" htmlFor="bf-status">
            <select id="bf-status" value={form.status} style={field}
              onChange={e => { set('status', e.target.value); set('statusDate', '') }}>
              <option value="" disabled hidden>상태를 고르세요</option>
              {BACKFILL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Row>
          <Row label="견적일" htmlFor="bf-qdate">
            <input id="bf-qdate" type="date" value={form.quoteDate} onChange={e => set('quoteDate', e.target.value)} style={field} />
          </Row>
        </div>

        {/* 상태가 쓰는 날짜 — 이 칸이 비면 그 지표의 어느 기간에도 잡히지 않는다. */}
        {dateLabel && (
          <Row label={dateLabel} htmlFor="bf-sdate">
            <input id="bf-sdate" type="date" value={form.statusDate} onChange={e => set('statusDate', e.target.value)} style={field} />
          </Row>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 110px', gap: 10 }}>
          <Row label="금액" htmlFor="bf-amount">
            <input id="bf-amount" inputMode="numeric" value={form.amount || ''} placeholder="0" style={field}
              onChange={e => set('amount', Number(e.target.value.replace(/[^\d.]/g, '')) || 0)} />
          </Row>
          <Row label="통화" htmlFor="bf-cur">
            <select id="bf-cur" value={form.currency} onChange={e => set('currency', e.target.value)} style={field}>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Row>
          <Row label="환율" htmlFor="bf-rate">
            <input id="bf-rate" inputMode="numeric" value={form.exchangeRate || ''} placeholder="원화면 비움"
              disabled={form.currency === 'KRW'} style={{ ...field, background: form.currency === 'KRW' ? '#f9fafb' : '#fff' }}
              onChange={e => set('exchangeRate', Number(e.target.value.replace(/[^\d.]/g, '')) || 0)} />
          </Row>
        </div>
        <div style={{ fontSize: 12, color: SUB, marginTop: -4, marginBottom: 12 }}>
          실적에 들어가는 금액 <b style={{ color: TEXT }}>₩{numKR(krw)}</b>
        </div>

        <Row label="견적번호">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: form.autoNumber ? BLUE : SUB, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={form.autoNumber} onChange={e => set('autoNumber', e.target.checked)}
                style={{ width: 14, height: 14, accentColor: BLUE, cursor: 'pointer' }} />
              자동으로 받기
            </label>
            <input value={form.quoteNumber} disabled={form.autoNumber}
              placeholder={form.autoNumber ? '담당자 이니셜로 자동 발급됩니다' : '옛 견적서의 번호를 그대로'}
              onChange={e => set('quoteNumber', e.target.value)}
              style={{ ...field, flex: 1, background: form.autoNumber ? '#f9fafb' : '#fff' }} />
          </div>
        </Row>

        <Row label="PDF" htmlFor="bf-pdf">
          <input id="bf-pdf" type="file" accept="application/pdf" style={{ ...field, padding: '7px 10px' }}
            onChange={e => setPdf(e.target.files?.[0] ?? null)} />
          <div style={{ fontSize: 12, color: SUB, marginTop: 5 }}>
            근거 문서를 붙여야 담깁니다 — 옛 견적서나 품의서를 올리세요.
          </div>
        </Row>

        <Row label="비고" htmlFor="bf-note">
          <textarea id="bf-note" value={form.note} maxLength={NOTE_MAX} onChange={e => set('note', e.target.value)}
            placeholder="왜 사후에 넣는지 한 줄 적어 두면 나중에 되짚기 쉽습니다"
            style={{ ...field, minHeight: 60, resize: 'vertical' }} />
        </Row>

        {/* 왜 못 누르는지 — 한 번에 하나만. 비활성 버튼만 두면 까닭을 찾아 헤맨다. */}
        {blocked && <div style={{ fontSize: 12, color: SUB }}>{blocked}</div>}
      </ModalCard>
    </ModalOverlay>
  )
}
