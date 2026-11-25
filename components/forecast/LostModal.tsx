'use client'

/**
 * 실주·실패 **사유 창** — 한 벌만 있다 (2026-11-26, 시안 LostModal).
 *
 * 들어오는 자리가 셋이다.
 *   · 포캐스트 카드의 단계를 「실주」로 바꿀 때
 *   · 포캐스트를 접을(종료) 때
 *   · 견적을 「실패」로 바꿀 때 (자동 만료 건의 「사유 대기」를 채울 때도 같은 창)
 *
 * 창이 하는 일은 **고르게 하고 모자란 것을 한 가지만 말하는 것**이다. 저장은 부르는 쪽이
 * 한다(포캐스트는 영업기회 수정, 견적은 상태 변경 라우트 — 가는 길이 다르다).
 *
 * 규칙은 lib/lostReason.ts 에 있다. 목록은 표에서 읽고(lib/lostReasonList.ts), 표가 아직
 * 없으면 **같은 여덟 줄**로 돌면서 저장할 때 글자만 담는다.
 */

import { useEffect, useState, type CSSProperties } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import ModalCard from '@/components/common/ModalCard'
import SearchSelect from '@/components/common/SearchSelect'
import { BLUE, BLUE_BORDER, BLUE_TINT, BORDER, CARD_BG, DANGER, TEXT, btnDanger, btnGhost } from '@/components/common/ui'
import { LABEL_WEIGHT, TEXT_LABEL, TEXT_NOTE } from '@/lib/textTokens'
import { loadLostReasons } from '@/lib/lostReasonList'
import {
  FALLBACK_REASONS, LOST_SCHEMA_NOTE, emptyLostForm, lostBlockedReason, lostPatch,
  needsCompetitor, needsNote, type LostForm, type LostReason,
} from '@/lib/lostReason'
import { todayKST } from '@/lib/date'
import { R } from '@/lib/radius'

const field: CSSProperties = {
  width: '100%', padding: '9px 10px', border: `1px solid ${BORDER}`, borderRadius: R.control,
  fontSize: 13, color: TEXT, background: CARD_BG, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
}
const labelStyle: CSSProperties = {
  fontSize: 11, fontWeight: LABEL_WEIGHT, color: TEXT_LABEL, marginBottom: 5, display: 'block',
}

export type LostSave = ReturnType<typeof lostPatch>

export default function LostModal({ title, what = '실주', busy, onClose, onSave }: {
  /** 무엇을 실주 처리하는지 — 「세현정밀(주) » 본사 · 조도계 교체」. */
  title: string
  /** 창 머리와 단추의 글자. 견적에서는 「실패」다. */
  what?: '실주' | '실패' | '종료'
  busy?: boolean
  onClose: () => void
  /** 고른 값. 표가 없으면 lost_reason_id 가 null 이고 글자만 들어 있다. */
  onSave: (patch: LostSave) => void
}) {
  const [reasons, setReasons] = useState<readonly LostReason[]>(FALLBACK_REASONS)
  const [fallback, setFallback] = useState(false)
  const [form, setForm] = useState<LostForm>(() => emptyLostForm(todayKST()))
  const [query, setQuery] = useState('')
  const [tried, setTried] = useState(false)

  useEffect(() => {
    let cancelled = false
    void loadLostReasons().then(list => {
      if (cancelled) return
      setReasons(list.rows)
      setFallback(list.fallback)
    })
    return () => { cancelled = true }
  }, [])

  const blocked = lostBlockedReason(form, reasons)
  const dirty = !!form.label || !!form.note.trim() || !!form.competitor.trim()
  const askNote = needsNote(reasons, form.label)
  const askCompetitor = needsCompetitor(reasons, form.label)

  const save = () => {
    setTried(true)
    if (blocked) return
    onSave(lostPatch(form, reasons))
  }

  return (
    <ModalOverlay onClose={onClose} confirmClose dirty={dirty}>
      <ModalCard
        title={`${what} 처리 — ${title}`}
        width={480}
        footer={
          <>
            <span style={{ fontSize: 11, color: TEXT_NOTE, marginRight: 'auto' }}>
              사유 목록은 관리 메뉴에서 편집합니다(준비 중)
            </span>
            <button type="button" onClick={onClose} style={btnGhost()}>취소</button>
            <button type="button" onClick={save} disabled={!!busy} style={btnDanger(!!busy)}>
              {busy ? '처리 중…' : `${what} 처리`}
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelStyle}>
              {what} 사유<span style={{ color: DANGER, marginLeft: 3 }}>*</span>
            </label>
            {/* 고르는 칸은 공용 콤보박스다 — 목록이 여덟 줄이지만 늘어날 자리고,
                조작(↑↓·Enter·Esc)을 자리마다 다르게 만들지 않는다. */}
            <SearchSelect<LostReason>
              items={reasons.filter(r => {
                const q = (query || form.label).trim()
                return !q || r.label.includes(q)
              })}
              itemKey={r => r.label}
              renderItem={r => (
                <span style={{ fontSize: 13 }}>
                  {r.label}
                  {r.requires_note && <span style={{ color: TEXT_NOTE, marginLeft: 6, fontSize: 11 }}>설명 필수</span>}
                  {r.requires_competitor && <span style={{ color: TEXT_NOTE, marginLeft: 6, fontSize: 11 }}>경쟁사 필수</span>}
                </span>
              )}
              onSelect={r => { setForm(p => ({ ...p, label: r.label })); setQuery('') }}
              query={query || form.label}
              onQueryChange={v => { setQuery(v); setForm(p => ({ ...p, label: v })) }}
              placeholder="사유 고르기"
              inputStyle={tried && blocked && !form.label ? { ...field, borderColor: DANGER } : field}
              openOnFocus
              openWhenEmpty
              emptyText="목록에 없는 사유입니다 — 목록에서 고르세요"
            />
            {fallback && (
              <div style={{ fontSize: 11, color: TEXT_NOTE, marginTop: 5 }}>{LOST_SCHEMA_NOTE}</div>
            )}
          </div>

          {/* 경쟁사 — 「경쟁사」를 골랐을 때만 나타난다(시안). */}
          {askCompetitor && (
            <div style={{ padding: '10px 12px', borderRadius: R.control, background: BLUE_TINT, border: `1px solid ${BLUE_BORDER}` }}>
              <label style={{ ...labelStyle, color: BLUE }} htmlFor="lost-competitor">
                경쟁사<span style={{ color: DANGER, marginLeft: 3 }}>*</span>
              </label>
              <input
                id="lost-competitor" value={form.competitor} autoFocus
                onChange={e => setForm(p => ({ ...p, competitor: e.target.value }))}
                placeholder="ex. 미쓰토요"
                style={tried && askCompetitor && !form.competitor.trim() ? { ...field, borderColor: DANGER } : field}
              />
            </div>
          )}

          <div>
            <label style={labelStyle} htmlFor="lost-note">
              부연 설명{askNote ? <span style={{ color: DANGER, marginLeft: 3 }}>*</span> : <span style={{ color: TEXT_NOTE, marginLeft: 4, fontWeight: 400 }}>(선택)</span>}
            </label>
            <textarea
              id="lost-note" value={form.note} rows={3}
              onChange={e => setForm(p => ({ ...p, note: e.target.value }))}
              placeholder="가격 차이·재접촉 계획 같은 한두 줄"
              style={{
                ...(tried && askNote && !form.note.trim() ? { ...field, borderColor: DANGER } : field),
                resize: 'vertical', lineHeight: 1.5,
              }}
            />
          </div>

          <div>
            <label style={labelStyle} htmlFor="lost-at">{what}일</label>
            <input
              id="lost-at" type="date" value={form.lostAt}
              onChange={e => setForm(p => ({ ...p, lostAt: e.target.value }))}
              style={{ ...field, width: 170 }}
            />
          </div>

          {/* 모자란 것은 **한 번에 하나만** 말한다 — 눌러 본 뒤에 뜬다. */}
          {tried && blocked && <div style={{ fontSize: 12, color: DANGER }}>{blocked}</div>}
        </div>
      </ModalCard>
    </ModalOverlay>
  )
}
