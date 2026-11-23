'use client'

// 일괄 작업 **적용 모달** — 「선택한 N곳 · 지금 값 → 바꿀 값」 (2026-11-23).
//
// ── 왜 창인가 ─────────────────────────────────────────────────────────────
//   전에는 검은 바의 드롭다운에서 값을 고르는 **그 순간** 저장됐다. 몇 곳이 무엇에서
//   무엇으로 바뀌는지 보여 주지 않았고(지금 값을 모른 채 덮어썼다), 되돌리는 길도 없다.
//   게다가 그 드롭다운은 검은 바의 흰 글자를 물려받아 **흰 바탕에 흰 글자**였다.
//   이제 버튼 → 이 창이다. 창은 세 가지를 반드시 보여 준다.
//     ① 몇 곳을 고쳤는가        ② 그 줄들의 **지금 값**      ③ 무엇으로 바꾸는가
//
// ── 두 모양 ──────────────────────────────────────────────────────────────
//   chips  — 값이 서너 개뿐일 때(상태). 한눈에 보이고 한 번에 고른다.
//   search — 값이 많을 때(분류·대리점). 검색칸 + 목록이다.
//   고른 값은 푸터에 「N곳 → 값」으로 한 번 더 적힌다. 고르기 전에는 적용이 잠긴다.
//
// 저장은 **부르는 쪽**이 한다(onApply) — 이 창은 고르는 자리만 맡는다.

import { useMemo, useState } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import ModalCard, { keepPads } from '@/components/common/ModalCard'
import { R } from '@/lib/radius'
import { bulkFooterText, currentValueText, type BulkActionKey } from '@/lib/bulkActions'

import { BAND_BG, BLUE, BLUE_BORDER, BLUE_TINT, BORDER, CARD_BG, MUTED, SUB, TEXT } from '@/components/common/ui'

export type BulkOption = {
  value: string
  label: string
  /** 목록 오른쪽의 작은 글자(대리점 주소 같은 것). */
  hint?: string
}

export type BulkApplyModalProps = {
  actionKey: BulkActionKey
  title: string
  /** 고른 줄 수. */
  count: number
  /** 고른 줄들의 **지금 값** 묶음(lib/bulkActions.ts 의 currentValueCounts). */
  current: { label: string; n: number }[]
  /** 고를 수 있는 값. chips 는 서너 개, search 는 많아도 된다. */
  options: BulkOption[]
  mode: 'chips' | 'search'
  busy?: boolean
  onClose: () => void
  onApply: (value: string, label: string) => void
}

export default function BulkApplyModal({
  title, count, current, options, mode, busy = false, onClose, onApply,
}: BulkApplyModalProps) {
  const [picked, setPicked] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(o => o.label.toLowerCase().includes(q) || (o.hint ?? '').toLowerCase().includes(q))
  }, [options, query])

  const pickedLabel = options.find(o => o.value === picked)?.label ?? null

  return (
    <ModalOverlay onClose={busy ? () => {} : onClose} closeOn={busy ? 'none' : 'both'}>
      <ModalCard
        width={440}
        closeX
        {...keepPads({ x: 20, top: 16, bottom: 14 }, 16, 0)}
        headStyle={{ alignItems: 'center', padding: '16px 20px', borderBottom: `1px solid ${BORDER}` }}
        bodyStyle={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}
        footStyle={{ padding: '14px 20px', borderTop: `1px solid ${BORDER}`, background: BAND_BG }}
        title={<span style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>{title}</span>}
        footer={<>
          <span className="num" style={{ fontSize: 12, color: pickedLabel ? TEXT : MUTED, fontWeight: pickedLabel ? 700 : 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {bulkFooterText(count, pickedLabel)}
          </span>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose} disabled={busy}
            style={{
              height: 34, padding: '0 12px', borderRadius: R.control, border: `1px solid ${BORDER}`,
              background: CARD_BG, color: SUB, fontSize: 13, fontWeight: 600,
              cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit', flexShrink: 0,
            }}>
            취소
          </button>
          <button type="button" disabled={busy || !picked}
            onClick={() => { if (picked) onApply(picked, pickedLabel ?? picked) }}
            style={{
              height: 34, padding: '0 16px', borderRadius: R.control, border: 'none',
              background: BLUE, color: CARD_BG, fontSize: 13, fontWeight: 700,
              cursor: busy || !picked ? 'not-allowed' : 'pointer', opacity: busy || !picked ? 0.5 : 1,
              fontFamily: 'inherit', flexShrink: 0,
            }}>
            {busy ? '바꾸는 중…' : '적용'}
          </button>
        </>}
      >
        {/* ── 선택한 N곳 · 지금 값 ── */}
        <div style={{
          padding: '10px 12px', borderRadius: R.control, background: BAND_BG,
          border: `1px solid ${BORDER}`, fontSize: 12, color: SUB,
          display: 'flex', gap: 14, flexWrap: 'wrap',
        }}>
          <span>선택한 <b className="num" style={{ color: TEXT, fontWeight: 700 }}>{count.toLocaleString('ko-KR')}</b>곳</span>
          <span style={{ minWidth: 0 }}>지금 <b style={{ color: TEXT, fontWeight: 700 }}>{currentValueText(current)}</b></span>
        </div>

        {/* ── 바꿀 값 ── */}
        <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: SUB }}>바꿀 값</div>

          {mode === 'chips' ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {options.map(o => {
                const on = o.value === picked
                return (
                  <button key={o.value} type="button" onClick={() => setPicked(o.value)}
                    style={{
                      height: 34, padding: '0 14px', borderRadius: R.control,
                      border: `1px solid ${on ? BLUE_BORDER : BORDER}`,
                      background: on ? BLUE_TINT : CARD_BG,
                      color: on ? BLUE : TEXT, fontSize: 13, fontWeight: on ? 700 : 500,
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}>
                    {o.label}
                  </button>
                )
              })}
            </div>
          ) : (
            <>
              <input value={query} onChange={e => setQuery(e.target.value)}
                placeholder="이름으로 찾기" aria-label="이름으로 찾기"
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '9px 11px',
                  border: `1px solid ${BORDER}`, borderRadius: R.control,
                  color: TEXT, background: CARD_BG, fontSize: 13, outline: 'none', fontFamily: 'inherit',
                }} />
              <div style={{ maxHeight: 240, overflowY: 'auto', border: `1px solid ${BORDER}`, borderRadius: R.control }}>
                {shown.length === 0 ? (
                  <div style={{ padding: '14px 12px', fontSize: 13, color: MUTED, textAlign: 'center' }}>찾는 값이 없습니다</div>
                ) : shown.map(o => {
                  const on = o.value === picked
                  return (
                    <button key={o.value} type="button" onClick={() => setPicked(o.value)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                        padding: '9px 12px', border: 'none', borderBottom: `1px solid ${BORDER}`,
                        background: on ? BLUE_TINT : CARD_BG, cursor: 'pointer', fontFamily: 'inherit',
                      }}>
                      <span style={{ fontSize: 13, fontWeight: on ? 700 : 500, color: on ? BLUE : TEXT, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {o.label}
                      </span>
                      {o.hint && (
                        <span style={{ marginLeft: 'auto', fontSize: 11, color: MUTED, flexShrink: 0, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {o.hint}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </ModalCard>
    </ModalOverlay>
  )
}
