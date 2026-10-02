'use client'

// 의뢰서 접수 창구 안내 — 일본 본사(計測社技術部門) 시트를 그대로 보여 주는 읽기 전용 화면.
//
// 왜 화면에 두는가 — 엑셀 파일을 찾아 열어야 알 수 있던 「어느 항목을 누구에게, 어떤 제목으로
// 보내는가」를 번호를 발급하는 자리 옆에 둔다. 제목 형식이 틀리면 본사가 접수하지 않는다.
//
// 데이터는 lib/inquiryDesk.ts 가 정본이다. 이 파일은 그리기만 한다 — DB·API 를 부르지 않는다.
//
// 번역 표시는 세 모드다. 일본어 원문을 지우지 않는 것이 중요하다: 메일 제목·이름·주소는
// 그대로 써야 본사에 닿는다. 그래서 「한국어」 모드에서도 제목 형식·메일·이름은 원문을 남긴다.

import { useEffect, useRef, useState } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import SegmentedControl from '@/components/common/SegmentedControl'
import { useToast } from '@/components/common/Toast'
import {
  CARD_BG, BORDER, TEXT, SUB, MUTED, NEUTRAL_BG, BLUE, FAINT,
  cardTitle, countBadge, btnGhost,
} from '@/components/common/ui'
import {
  DESK_AS_OF, DESK_PRODUCTS, DESK_TEXT, SUBJECT_86, SUBJECT_EXAMPLE, SUBJECT_FORMATS,
  deskMailto, deskSubject,
  type DeskPerson, type DeskProduct, type DeskRow, type DeskText,
} from '@/lib/inquiryDesk'

/** 표시 모드. 기본은 둘 다 보여 주는 「한·일」. */
type Mode = 'both' | 'ko' | 'ja'

/** 카드로 쌓는 폭 — 이 아래로 좁아지면 표를 세로로 편다(가로 스크롤을 만들지 않는다). */
const NARROW = 720

const CSS = `
  .dg-shell { container-type: inline-size; }
  .dg-row { display: grid; grid-template-columns: 56px minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1.3fr) 128px;
            gap: 10px; align-items: start; padding: 10px 0; border-top: 1px solid ${BORDER}; }
  .dg-row.head { border-top: none; padding-top: 0; }
  .dg-k { display: none; }
  @container (max-width: ${NARROW}px) {
    .dg-row { grid-template-columns: minmax(0, 1fr); gap: 6px; padding: 12px 0; }
    .dg-row.head { display: none; }
    /* 좁아지면 각 칸 앞에 이름표를 붙인다 — 표 머리가 사라지기 때문이다. */
    .dg-k { display: block; font-size: 11px; font-weight: 700; color: ${MUTED}; margin-bottom: 2px; }
  }
`

const mono: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: 13, color: TEXT, wordBreak: 'break-all',
}

/** 복사 버튼. 컴포넌트를 렌더 안에서 만들면 상태가 매번 초기화되므로 모듈 수준에 둔다. */
function CopyBtn({ text, what, onCopy }: { text: string; what: string; onCopy: (t: string, w: string) => void }) {
  return (
    <button
      type="button" onClick={() => onCopy(text, what)} aria-label={`${what} 복사`} title={`${what} 복사`}
      style={{
        border: `1px solid ${BORDER}`, background: CARD_BG, borderRadius: 6, padding: '2px 7px',
        fontSize: 11, fontWeight: 700, color: MUTED, cursor: 'pointer', fontFamily: 'inherit',
        flexShrink: 0, whiteSpace: 'nowrap',
      }}
    >
      복사
    </button>
  )
}

/** {ja, ko} 한 쌍을 모드에 맞게. 「한·일」이면 원문 위, 번역 아래(작게). */
function T({ v, mode, size = 13, bold }: { v: DeskText; mode: Mode; size?: number; bold?: boolean }) {
  if (mode === 'ko') return <span style={{ fontSize: size, color: TEXT, fontWeight: bold ? 700 : 400 }}>{v.ko}</span>
  if (mode === 'ja') return <span style={{ fontSize: size, color: TEXT, fontWeight: bold ? 700 : 400 }}>{v.ja}</span>
  return (
    <span style={{ display: 'block' }}>
      <span style={{ fontSize: size, color: TEXT, fontWeight: bold ? 700 : 400 }}>{v.ja}</span>
      <span style={{ display: 'block', fontSize: Math.max(11, size - 2), color: SUB, lineHeight: 1.5 }}>{v.ko}</span>
    </span>
  )
}

/** 사람 이름은 모드와 무관하게 일본어 + 한글을 함께 — 본사에 말할 때는 원문이 필요하다. */
function Person({ p }: { p: DeskPerson }) {
  return (
    <span style={{ display: 'block', lineHeight: 1.5 }}>
      <span style={{ fontSize: 13, color: TEXT, fontWeight: 600 }}>{p.ja}</span>
      <span style={{ fontSize: 11, color: SUB }}> {p.ko}</span>
      <span style={{ display: 'block', fontSize: 11, color: MUTED }}>내선 {p.ext}</span>
    </span>
  )
}

function Mail({ mail, onCopy }: { mail: string; onCopy: (t: string, w: string) => void }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
      <a href={`mailto:${mail}`} style={{ ...mono, fontSize: 12, color: BLUE, textDecoration: 'none' }}>{mail}</a>
      <CopyBtn text={mail} what="메일 주소" onCopy={onCopy} />
    </span>
  )
}

/**
 * 리드타임 띠 — 연속한 행의 lead 가 바뀔 때만 한 번 그린다(원본이 그룹 위에 적은 방식).
 * 앞 행과 견주기만 하므로 순수하다.
 */
function leadBand(rows: DeskRow[], i: number): DeskText | null {
  const row = rows[i]
  if (!row.lead) return null
  const prev = i > 0 ? rows[i - 1] : null
  return prev?.lead?.ja === row.lead.ja ? null : row.lead
}

export default function DeskGuideModal({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const [mode, setMode] = useState<Mode>('both')
  const [productKey, setProductKey] = useState(DESK_PRODUCTS[0].key)
  const product = DESK_PRODUCTS.find(p => p.key === productKey) ?? DESK_PRODUCTS[0]
  const panelRef = useRef<HTMLDivElement>(null)

  // ModalOverlay 는 바깥 클릭만 닫는다 — Esc 는 여기서 받는다(명함 뷰어와 같은 방식).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // 열리면 패널로 포커스를 옮긴다(키보드로 바로 스크롤·Esc 가 되게).
  useEffect(() => { panelRef.current?.focus() }, [])

  /** 상세 화면의 「번호 복사」와 같은 방식. 실패하면 직접 고르라고 알린다. */
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${what}를 복사했습니다`)
    } catch {
      toast.error('복사하지 못했습니다. 글자를 직접 선택해 복사해주세요')
    }
  }

  const box: React.CSSProperties = {
    border: `1px solid ${BORDER}`, borderRadius: 8, padding: '12px 14px', marginBottom: 12,
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div
        ref={panelRef} tabIndex={-1}
        role="dialog" aria-modal="true" aria-labelledby="dg-title"
        style={{
          background: CARD_BG, borderRadius: 8, width: '100%', maxWidth: 980, maxHeight: '90vh',
          display: 'flex', flexDirection: 'column', outline: 'none',
          boxShadow: '0 20px 60px rgba(0,0,0,0.22)',
        }}
      >
        <style>{CSS}</style>

        {/* 머리 — 고정. 본문만 스크롤한다. */}
        <div style={{ padding: '14px 16px', borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div id="dg-title" style={{ ...cardTitle, fontSize: 17 }}>{DESK_TEXT.title.ko}</div>
              <div style={{ fontSize: 12, color: SUB, lineHeight: 1.6, marginTop: 2 }}>
                {DESK_TEXT.title.ja}
                <span style={{ color: FAINT }}> · </span>
                {DESK_TEXT.sub.ja}
                <span style={{ color: FAINT }}> / </span>
                {DESK_TEXT.sub.ko}
              </div>
            </div>
            <span style={{ ...countBadge, flexShrink: 0 }}>{DESK_AS_OF} 기준</span>
            <button type="button" onClick={onClose} style={{ ...btnGhost(), flexShrink: 0 }}>닫기</button>
          </div>

          <div style={{ marginTop: 10 }}>
            <SegmentedControl
              options={[{ label: '한·일', value: 'both' }, { label: '한국어', value: 'ko' }, { label: '日本語', value: 'ja' }]}
              value={mode}
              onChange={v => setMode(v as Mode)}
            />
          </div>
        </div>

        {/* 본문 */}
        <div className="dg-shell" style={{ padding: '14px 16px', overflowY: 'auto', flex: 1, minHeight: 0 }}>

          {/* ① 쓰는 법 — 원본에 없는 한국어 전용 안내다. */}
          <div style={{ ...box, background: NEUTRAL_BG, border: 'none' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: MUTED, marginBottom: 6 }}>쓰는 법</div>
            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: TEXT, lineHeight: 1.8 }}>
              <li>제품 탭을 고르고 항목 행의 <b>[메일 작성]</b>을 누르세요.</li>
              <li>메일창이 열리면 제목의 <span style={mono}>依頼書No</span>에는 EMS에서 발급받은 의뢰서 번호를,
                {' '}<span style={mono}>客先名</span>에는 고객사명을 넣으세요.</li>
              <li>안내된 제목 형식 이외에는 접수되지 않습니다.</li>
            </ol>
          </div>

          {/* ② 메일 제목 규칙 */}
          <div style={box}>
            <div style={{ fontSize: 12, fontWeight: 700, color: MUTED, marginBottom: 8 }}>메일 제목 형식</div>
            <div style={{ marginBottom: 8 }}><T mode={mode} v={DESK_TEXT.subjectNote} /></div>
            <div style={{ marginBottom: 10 }}><T mode={mode} v={DESK_TEXT.subjectRule} /></div>

            {SUBJECT_FORMATS.map(f => (
              <div key={f.subject} style={{
                display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                padding: '7px 0', borderTop: `1px solid ${BORDER}`,
              }}>
                <span style={{ ...mono, flex: '1 1 320px' }}>{f.subject}</span>
                <span style={{ fontSize: 12, color: SUB, flex: '1 1 200px' }}>{f.ko}</span>
                <CopyBtn onCopy={copy} text={f.subject} what="제목 형식" />
              </div>
            ))}

            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <T mode={mode} v={DESK_TEXT.subjectExample} size={12} />
              <span style={{ ...mono, background: NEUTRAL_BG, borderRadius: 6, padding: '4px 8px' }}>{SUBJECT_EXAMPLE}</span>
              <CopyBtn onCopy={copy} text={SUBJECT_EXAMPLE} what="예시 제목" />
            </div>
          </div>

          {/* ③ 접수 메일 주소 */}
          <div style={box}>
            <div style={{ fontSize: 12, fontWeight: 700, color: MUTED, marginBottom: 8 }}>접수 메일 주소</div>
            <div style={{ marginBottom: 8 }}><T mode={mode} v={DESK_TEXT.listIntro} /></div>
            {DESK_PRODUCTS.filter(p => p.listMail).map(p => (
              <div key={p.key} style={{ padding: '7px 0', borderTop: `1px solid ${BORDER}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: TEXT, flexShrink: 0 }}>
                    {mode === 'ko' ? p.ko : mode === 'ja' ? p.ja : `${p.ja} / ${p.ko}`}
                  </span>
                  <a href={`mailto:${p.listMail}`} style={{ ...mono, color: BLUE, textDecoration: 'none' }}>{p.listMail}</a>
                  <CopyBtn onCopy={copy} text={p.listMail ?? ''} what="접수 주소" />
                </div>
                {p.listNote && <div style={{ marginTop: 3 }}><T mode={mode} v={p.listNote} size={12} /></div>}
              </div>
            ))}
            <div style={{ paddingTop: 8, borderTop: `1px solid ${BORDER}`, marginTop: 4 }}>
              <T mode={mode} v={DESK_TEXT.listOnly} size={12} />
            </div>
            {/* 원본에 없는 한국어 전용 안내 — 86 제품만 동작이 다르다. */}
            <div style={{ fontSize: 12, color: SUB, lineHeight: 1.7, marginTop: 8 }}>
              86 제품은 접수 메일링 리스트가 없습니다. [메일 작성]은 담당자에게 직접 보내고
              책임자를 참조(CC)로 넣으며 제목은 <span style={mono}>{SUBJECT_86}</span> 형식입니다.
            </div>
          </div>

          {/* ④ 제품별 */}
          <div style={{ marginBottom: 10 }}>
            <SegmentedControl
              options={DESK_PRODUCTS.map(p => ({
                label: mode === 'ja' ? p.ja : p.ko,
                value: p.key,
              }))}
              value={productKey}
              onChange={v => setProductKey(v as DeskProduct['key'])}
            />
          </div>

          {/* 책임자 */}
          <div style={{ ...box, background: NEUTRAL_BG, border: 'none' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: MUTED, marginBottom: 8 }}>
              {mode === 'ja' ? DESK_TEXT.owner.ja : mode === 'ko' ? DESK_TEXT.owner.ko : `${DESK_TEXT.owner.ja} / ${DESK_TEXT.owner.ko}`}
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {product.owners.map(o => (
                <div key={o.person.mail} style={{ minWidth: 200 }}>
                  {o.label && <div style={{ marginBottom: 2 }}><T mode={mode} v={o.label} size={12} /></div>}
                  <Person p={o.person} />
                  <Mail onCopy={copy} mail={o.person.mail} />
                </div>
              ))}
            </div>
          </div>

          {/* 항목 표 */}
          <div className="dg-row head">
            <span style={{ fontSize: 11, fontWeight: 700, color: MUTED }}>분류</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: MUTED }}>항목</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: MUTED }}>담당자</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: MUTED }}>메일</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: MUTED }}>작업</span>
          </div>

          {product.rows.map((row, i) => {
            const band = leadBand(product.rows, i)
            return (
              <div key={`${product.key}-${row.code ?? 'qc'}-${i}`}>
                {band && (
                  <div style={{
                    background: NEUTRAL_BG, borderRadius: 6, padding: '5px 10px', marginTop: 8,
                    fontSize: 12, color: SUB, lineHeight: 1.6,
                  }}>
                    <T mode={mode} v={band} size={12} />
                  </div>
                )}
                <div className="dg-row">
                  <span>
                    <span className="dg-k">분류</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: row.code ? TEXT : FAINT }}>
                      {row.code ?? ''}
                    </span>
                  </span>
                  <span>
                    <span className="dg-k">항목</span>
                    <T mode={mode} v={{ ja: row.ja, ko: row.ko }} bold />
                  </span>
                  <span>
                    <span className="dg-k">담당자</span>
                    {row.people.map(p => <Person key={p.mail} p={p} />)}
                  </span>
                  <span>
                    <span className="dg-k">메일</span>
                    {row.people.map(p => <Mail key={p.mail} mail={p.mail} onCopy={copy} />)}
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                    <span className="dg-k">작업</span>
                    <a
                      href={deskMailto(product, row)}
                      style={{
                        border: `1px solid ${BORDER}`, background: CARD_BG, borderRadius: 6,
                        padding: '4px 9px', fontSize: 11, fontWeight: 700, color: BLUE,
                        textDecoration: 'none', whiteSpace: 'nowrap',
                      }}
                    >
                      메일 작성
                    </a>
                    <CopyBtn onCopy={copy} text={deskSubject(product.key, row)} what="메일 제목" />
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </ModalOverlay>
  )
}
