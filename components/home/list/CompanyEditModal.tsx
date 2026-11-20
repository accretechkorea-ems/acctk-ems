'use client'

/**
 * 회사 수정 — 목록 보기의 회사 카드에서 「수정」을 누르면 열린다.
 *
 * ── 왜 모달인가 ───────────────────────────────────────────────────────────
 *   전에는 제목 옆 연필(이름·영문명)과 드롭다운(분류)으로 **칸마다 다른 방식**으로
 *   고쳤다. 사업장 표도 칸을 눌러 고쳤다. 같은 화면에서 고치는 방식이 셋이면 어디를
 *   눌러야 고쳐지는지 매번 다시 배워야 한다 — 전부 「수정 버튼 → 모달」 하나로 모았다.
 *
 * ── 문턱이 둘인 이유 ──────────────────────────────────────────────────────
 *   회사명·영문명은 그 아래 사업장 이름까지 전부 다시 만든다(라우트가 한다) —
 *   슈퍼관리자만 바꾼다. 분류·메모는 회사 줄 한 칸이라 고객사 메뉴를 보는 사람이면 된다
 *   (좌 패널의 「분류 일괄 지정」도 같은 문턱이다).
 */

import { useState, type CSSProperties } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import FormFocusStyle from '@/components/common/FormFocusStyle'
import { useFieldErrors, FieldError, errBorder } from '@/components/common/fieldErrors'
import { INDUSTRIES } from '@/lib/leadOptions'
import { MEMO_MAX } from '@/components/common/MemoPopover'
import { R } from '@/lib/radius'

const BORDER = '#ebebeb'
const TEXT = '#111827'
const SUB = '#6b7280'
const MUTED = '#9ca3af'
const BLUE = '#234ea2'

const labelStyle: CSSProperties = { fontSize: 13, fontWeight: 600, color: SUB, marginBottom: 6, display: 'block' }
const fieldStyle: CSSProperties = {
  width: '100%', padding: '11px 12px', border: `1px solid ${BORDER}`, borderRadius: R.icon,
  boxSizing: 'border-box', color: TEXT, background: '#fff', outline: 'none', fontSize: 14,
}

export type CompanyEditForm = {
  name: string
  nameEn: string
  industry: string
  note: string
  /** 주소 — **대리점 모드에서만** 쓴다(회사 줄은 주소를 갖지 않는다). */
  address?: string
}

/**
 * 어느 줄을 고치는가 — 같은 창을 **대리점**도 쓴다(2026-11-21).
 *
 *   company 회사(부모) 줄. 분류가 필수고, 이름을 바꾸면 아래 사업장 이름이 전부 바뀐다.
 *   agency  대리점 줄. **분류 칸이 없고 주소 칸이 있다.** 이름을 바꿔도 따라 바뀌는
 *           줄이 없다 — 사업장은 FK(agency_customer_id)로 가리키므로 이름을 베껴 두지
 *           않는다. 그래서 이름 문턱(canRename)도 걸지 않는다.
 */
export type CompanyEditKind = 'company' | 'agency'

type Props = {
  /** 열었을 때의 값. */
  initial: CompanyEditForm
  /** 무엇을 고치는가. 없으면 회사다(옛 호출부 그대로). */
  kind?: CompanyEditKind
  /** 사업장 수 — 이름을 바꾸면 함께 바뀌는 줄 수를 미리 알려 준다. */
  siteCount: number
  /** 회사명·영문명을 바꿀 수 있는가(슈퍼관리자). 아니면 그 두 칸만 잠근다. */
  canRename: boolean
  isSaving: boolean
  onClose: () => void
  onSave: (form: CompanyEditForm) => void
}

export default function CompanyEditModal({ initial, kind = 'company', siteCount, canRename, isSaving, onClose, onSave }: Props) {
  const [form, setForm] = useState<CompanyEditForm>(initial)
  const { errors, clearError, validate } = useFieldErrors<'name' | 'nameEn' | 'industry'>()

  const agency = kind === 'agency'
  // 대리점 이름은 따라 바뀌는 줄이 없다 — 문턱을 걸지 않는다(위 CompanyEditKind).
  const editName = agency || canRename

  const dirty = JSON.stringify(form) !== JSON.stringify(initial)
  const nameChanged = form.name.trim() !== initial.name.trim()

  const handleSave = () => {
    const ok = validate({
      name: form.name.trim() ? null : (agency ? '대리점명을 입력해주세요' : '회사명을 입력해주세요'),
      // 비어 있는 줄이 많지만, 고치러 들어온 김에 채우게 한다 — 이름을 다루는 자리다.
      // 대리점은 45곳 모두 영문명이 비어 있어(2026-11-21 실측) 강요하지 않는다.
      nameEn: !agency && canRename && !form.nameEn.trim() ? '영문명을 입력해주세요' : null,
      industry: agency || form.industry ? null : '분류를 선택해주세요',
    })
    if (!ok) return
    onSave(form)
  }

  const lockedHint = editName ? null : '회사명·영문명은 슈퍼관리자만 바꿀 수 있습니다'

  return (
    <ModalOverlay onClose={onClose} confirmClose dirty={dirty}>
      <div className="acc-form" onClick={e => e.stopPropagation()}
        style={{
          // 폭·높이는 등록 폼과 같은 규칙이다.
          width: 'min(92vw, 1100px)', maxWidth: 'min(92vw, 1100px)',
          maxHeight: '96vh', overflowY: 'auto',
          background: '#fff', borderRadius: R.control, padding: 24,
          boxShadow: '0 20px 60px rgba(0,0,0,0.22)', border: `1px solid ${BORDER}`,
          animation: 'modal-in 0.18s ease',
        }}>
        <FormFocusStyle />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: TEXT, letterSpacing: '-0.3px' }}>{agency ? '대리점 정보 수정' : '회사 정보 수정'}</div>
          <button onClick={onClose} title="닫기"
            style={{ width: 28, height: 28, borderRadius: '50%', background: '#f3f4f6', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: SUB }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div style={{ display: 'grid', gap: 14 }}>
          {/* 한 줄 세 칸 — 등록 폼의 업체 정보와 같은 리듬. */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, alignItems: 'start' }}>
          <div>
            <label style={labelStyle}>{agency ? '대리점명' : '회사명'}</label>
            <input value={form.name} disabled={!editName || isSaving}
              onChange={e => { setForm(p => ({ ...p, name: e.target.value })); clearError('name') }}
              placeholder={agency ? 'ex) 젠트' : 'ex) 현대자동차'}
              style={{
                ...fieldStyle,
                ...(errors.name ? { border: errBorder } : null),
                background: editName ? '#fff' : '#f9fafb', color: editName ? TEXT : MUTED,
              }} />
            <FieldError message={errors.name} />
            {/* 회사는 이름이 아래 사업장까지 번진다. 대리점은 번지지 않으므로 그 대신
                몇 곳이 이 대리점을 거치는지 알린다(합치거나 지울 때 가늠이 된다). */}
            {nameChanged && siteCount > 0 && (
              <div style={{ fontSize: 11, color: SUB, marginTop: 5 }}>
                {agency
                  ? `거래 사업장 ${siteCount}곳의 이름은 그대로입니다(대리점을 번호로 가리킵니다).`
                  : `사업장 ${siteCount}곳의 이름도 「새 회사명 사업장명」 으로 함께 바뀝니다.`}
              </div>
            )}
          </div>

          <div>
            <label style={labelStyle}>{agency ? '영문 대리점명' : '영문 회사명'}</label>
            <input value={form.nameEn} disabled={!editName || isSaving}
              onChange={e => setForm(p => ({ ...p, nameEn: e.target.value }))}
              placeholder={agency ? 'ex) ZENT' : 'ex) HYUNDAI MOTOR'}
              style={{ ...fieldStyle, background: editName ? '#fff' : '#f9fafb', color: editName ? TEXT : MUTED }} />
            <div style={{ fontSize: 11, color: MUTED, marginTop: 5 }}>
              {lockedHint ?? '검색이 한글 이름과 함께 봅니다.'}
            </div>
          </div>

          {/* 셋째 칸 — 회사는 분류, 대리점은 주소다(대리점에 분류는 뜻이 없고,
              주소는 45곳 중 31곳이 비어 있어 채울 자리가 필요하다). */}
          {agency ? (
            <div>
              <label style={labelStyle}>주소</label>
              <input value={form.address ?? ''} disabled={isSaving}
                onChange={e => setForm(p => ({ ...p, address: e.target.value }))}
                placeholder="ex) 대구 달서구 성서공단로 11길 32"
                style={fieldStyle} />
              <div style={{ fontSize: 11, color: MUTED, marginTop: 5 }}>대리점 화면의 둘째 줄에 그대로 보입니다.</div>
            </div>
          ) : (
            <div>
              <label style={labelStyle}>분류</label>
              <select value={form.industry} disabled={isSaving}
                onChange={e => { setForm(p => ({ ...p, industry: e.target.value })); clearError('industry') }}
                style={errors.industry ? { ...fieldStyle, border: errBorder, cursor: 'pointer' } : { ...fieldStyle, cursor: 'pointer' }}>
                <option value="" disabled hidden>분류 선택</option>
                {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
              <FieldError message={errors.industry} />
            </div>
          )}
          </div>

          <div>
            <label style={labelStyle}>메모</label>
            <textarea value={form.note} disabled={isSaving}
              onChange={e => setForm(p => ({ ...p, note: e.target.value.slice(0, MEMO_MAX) }))}
              placeholder={agency ? 'ex) 월말 정산 · 견적서는 대표가 직접 수신' : 'ex) 2026-03 사명 변경 · 본사 이전'}
              rows={3}
              style={{ ...fieldStyle, resize: 'vertical', fontSize: 13, lineHeight: 1.6, fontFamily: 'inherit' }} />
            <div style={{ fontSize: 10, color: MUTED, marginTop: 4, textAlign: 'right' }}>{`${form.note.length} / ${MEMO_MAX}`}</div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button onClick={onClose} disabled={isSaving}
            style={{ padding: '10px 15px', background: '#fff', color: SUB, borderRadius: R.icon, border: `1px solid ${BORDER}`, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>취소</button>
          <button onClick={handleSave} disabled={isSaving}
            style={{ padding: '10px 17px', background: BLUE, color: '#fff', borderRadius: R.icon, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, opacity: isSaving ? 0.6 : 1 }}>
            {isSaving ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}
