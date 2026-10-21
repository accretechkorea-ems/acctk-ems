'use client'

// 견적 작성 화면의 **조건 편집** — 「조건 변경」을 체크했을 때만 열리는 네 줄.
//
// app/quote/page.tsx → CustomerCard 를 거쳐 **그대로 옮겨 온 것**이다(분리 리팩터 3a).
// JSX·스타일·문구·주석을 한 글자도 바꾸지 않았다(들여쓰기 2칸만 덜어냈다).
//
// 라벨·순서·길이 상한은 등록표(lib/quoteTerms.ts) 한 곳에서 읽는다 — PDF 와 같은 값이다.
// 열고 닫는 체크박스는 카드에 남아 있다(서명란 체크와 한 줄이라 함께 두는 편이 맞다).

import {
  TERM_LABELS, TERM_MAX_LEN, defaultTermsFor,
  termKeysFor, type SetTerms, type Terms,
} from '@/lib/quoteTerms'

export type TermsEditorProps = {
  termsOpen: boolean
  terms: Terms
  setTerms: SetTerms
  /** 견적서 양식. 「보증」은 장비(equip80)에서만 보인다. */
  formKind: string
}

export default function TermsEditor({ termsOpen, terms, setTerms, formKind }: TermsEditorProps) {
  // 입력칸 설명 — **그 양식의 기본 문구**다(20 견적서는 지불조건이 다르다).
  const placeholders = defaultTermsFor(formKind)
  // 조건 편집 — 체크했을 때만 열린다. 네 줄의 라벨·순서는 PDF 와 같다(등록표에서 읽는다).
  return (
  <div
    className="q-terms-wrap"
    style={{ gridTemplateRows: termsOpen ? '1fr' : '0fr', opacity: termsOpen ? 1 : 0 }}
    aria-hidden={!termsOpen}
  >
    <div className="q-terms-inner">
      <div style={{
        marginTop: 8, border: '1px solid #ebebeb', borderRadius: 8, padding: '10px 12px',
        display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        {termKeysFor(formKind).map(key => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 56, flexShrink: 0, fontSize: 11, fontWeight: 700, color: '#6b7280' }}>
              {TERM_LABELS[key]}
            </span>
            <input
              className="q-term-input"
              value={terms[key]}
              maxLength={TERM_MAX_LEN}
              placeholder={placeholders[key]}
              tabIndex={termsOpen ? 0 : -1}
              onChange={e => setTerms(prev => ({ ...prev, [key]: e.target.value }))}
            />
          </div>
        ))}
        {/* 견적유효 아래 보조 글씨 — 문구를 고쳐도 만료 판정은 바뀌지 않는다. */}
        <span style={{ fontSize: 11, color: '#9ca3af', lineHeight: 1.6, paddingLeft: 64 }}>
          문구만 바뀝니다. 자동 만료 판정은 작성일로부터 1개월 기준입니다.
        </span>
      </div>
    </div>
  </div>
  )
}
