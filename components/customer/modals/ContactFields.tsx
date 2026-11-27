'use client'

/**
 * 담당자 **칸 한 벌** — 추가 창과 수정 창이 같이 쓴다 (2026-11-25).
 *
 * 명함과 같은 아홉 칸이다(회사·주소·홈페이지는 사업장 것이라 없다).
 *
 * ── 필수 다섯은 처음부터 보인다 ─────────────────────────────────────────
 *   이름 · 직급 · 부서 · 휴대폰(또는 전화) · 이메일.
 *   비어 있으면 **테두리가 빨강**이고, 값이 들어오면 테마 파랑이 된다. 눌러 봐야
 *   아는 일이 없게 처음부터 그렇게 둔다. 라벨 옆의 별표도 같은 뜻이다.
 *   사진에서 읽혀 찬 칸도 규칙이 같다 — 차 있으면 파랑이다.
 */

import type { CSSProperties } from 'react'
import { BLUE, BLUE_BORDER, BORDER, CARD_BG, TEXT } from '@/components/common/ui'
import { LABEL_WEIGHT, TEXT_LABEL } from '@/lib/textTokens'
import SearchSelect from '@/components/common/SearchSelect'
import { R } from '@/lib/radius'
import {
  CONTACT_FIELDS, CONTACT_INPUT_TYPE, CONTACT_LABEL, REQUIRED_CONTACT_FIELDS, REQUIRED_MARK,
  borderKind, positionMatches, type ContactField, type ContactValues,
} from '@/lib/contactForm'

/**
 * 비어 있는 필수 칸의 **테두리** — 고객사 규칙의 위험색 그대로.
 * 이것은 「아직 안 적었다」는 **오류 표시**라 빨강이 맞다.
 */
const REQUIRED_BORDER = '#ef4444'

/**
 * 필수 **별표**의 색 — **파랑**이다(2026-11-25 결정, 2026-11-27 묶음5 13 에서 통일).
 * 별표는 「꼭 적어 주세요」라는 **안내**지 오류가 아니다. 창을 열자마자 빨간 별이
 * 다섯 개 떠 있으면, 아무것도 틀리지 않았는데 이미 틀린 것처럼 보인다.
 * 틀렸다는 말은 **빈 칸의 빨간 테두리**가 따로 한다.
 */
const REQUIRED_STAR = BLUE

const labelStyle: CSSProperties = {
  fontSize: 12, fontWeight: LABEL_WEIGHT, color: TEXT_LABEL, marginBottom: 4, display: 'block',
}

export function contactFieldBorder(values: ContactValues, f: ContactField): string {
  const kind = borderKind(values, f)
  if (kind === 'required') return REQUIRED_BORDER
  if (kind === 'ok') return BLUE_BORDER
  return BORDER
}

const field = (values: ContactValues, f: ContactField): CSSProperties => ({
  width: '100%', height: 40, padding: '0 10px', boxSizing: 'border-box',
  border: `1px solid ${contactFieldBorder(values, f)}`, borderRadius: R.control,
  background: CARD_BG, fontSize: 14, color: TEXT, outline: 'none', fontFamily: 'inherit',
})

export default function ContactFields({ values, onChange }: {
  values: ContactValues
  onChange: (f: ContactField, v: string) => void
}) {
  const one = (f: ContactField, wide = false) => (
    <div key={f} style={{ gridColumn: wide ? '1 / -1' : undefined, minWidth: 0 }}>
      <label style={labelStyle} htmlFor={`ct-${f}`}>
        {CONTACT_LABEL[f]}
        {REQUIRED_CONTACT_FIELDS.includes(f) && (
          <span style={{ color: REQUIRED_STAR, marginLeft: 3 }}>{REQUIRED_MARK}</span>
        )}
      </label>
      {f === 'memo' ? (
        <textarea id={`ct-${f}`} value={values[f] ?? ''}
          onChange={e => onChange(f, e.target.value)} placeholder="만난 자리 · 특이사항"
          style={{ ...field(values, f), height: 60, padding: '9px 10px', resize: 'vertical' }} />
      ) : f === 'position' ? (
        /* 직급은 **고르거나 적는다**(2026-11-26) — 자주 쓰는 값은 목록에서 고르고,
           없으면 그대로 적으면 된다. 가두지 않는 까닭은 회사마다 직급이 다르기 때문이고,
           목록을 두는 까닭은 「과장」이 「과장님」·「과 장」으로 갈려 쌓이지 않게 하려는 것이다. */
        <SearchSelect<string>
          items={positionMatches(values[f] ?? '')}
          itemKey={p => p}
          renderItem={p => <span style={{ fontSize: 13 }}>{p}</span>}
          onSelect={p => onChange(f, p)}
          query={values[f] ?? ''}
          onQueryChange={v => onChange(f, v)}
          inputId={`ct-${f}`}
          placeholder="과장 · 대리 …"
          openWhenEmpty
          inputStyle={field(values, f)}
          emptyText="목록에 없는 직급입니다 — 적은 그대로 저장됩니다"
        />
      ) : (
        <input id={`ct-${f}`} value={values[f] ?? ''} type={CONTACT_INPUT_TYPE[f] ?? 'text'}
          onChange={e => onChange(f, e.target.value)}
          style={field(values, f)} />
      )}
    </div>
  )

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      {one('name')}
      {one('name_en')}
      {one('position')}
      {one('department')}
      {one('mobile')}
      {one('phone')}
      {one('fax')}
      {one('email')}
      {one('memo', true)}
      <div style={{ gridColumn: '1 / -1', fontSize: 12, color: TEXT_LABEL }}>
        <span style={{ color: REQUIRED_STAR }}>{REQUIRED_MARK}</span> 표가 붙은 칸은 꼭 적어 주세요.
        휴대폰이 없으면 전화만 적어도 됩니다.
      </div>
    </div>
  )
}

/** 빈 폼 — 두 창이 같은 것을 쓴다. */
export const EMPTY_CONTACT: Record<ContactField, string> =
  Object.fromEntries(CONTACT_FIELDS.map(f => [f, ''])) as Record<ContactField, string>
