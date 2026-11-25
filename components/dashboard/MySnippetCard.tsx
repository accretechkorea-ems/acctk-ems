'use client'

/**
 * 홈의 **「내 문구」 카드** (2026-11-25).
 *
 * 격자의 마지막 칸에 선다(폰에서는 맨 아래). 카드가 말하는 것은 세 가지다 —
 *   · 몇 장 담아 두었나(개인 N · 공용 N)
 *   · 최근에 손댄 세 장(제목 + 용도 뱃지)
 *   · 바로 할 수 있는 두 가지(＋ 추가 · 전체 관리)
 *
 * 「전체 관리」는 **화면을 옮기지 않는다** — 내 정보의 「내 문구」 탭과 **같은 부품**
 * (components/account/MySnippets.tsx)을 모달 안에 그대로 끼운다. 두 자리가 갈리지 않는다.
 */

import { useEffect, useState } from 'react'
import DashCard from '@/components/dashboard/DashCard'
import ModalOverlay from '@/components/common/ModalOverlay'
import ModalCard from '@/components/common/ModalCard'
import MySnippets from '@/components/account/MySnippets'
import SnippetSaveModal from '@/components/common/SnippetSaveModal'
import { useSnippets, type SnippetForm } from '@/hooks/useSnippets'
import { useToast } from '@/components/common/Toast'
import { BLUE, BLUE_TINT, BORDER, CARD_BG, MUTED, NEUTRAL_BG, SUB, TEXT } from '@/components/common/ui'
import { R } from '@/lib/radius'
import { KIND_LABEL, SCOPE_LABEL, oneLine, type Snippet } from '@/lib/snippets'

/** 최근 몇 장을 보여 주나 — 카드 높이(330)에 들어가는 수. */
const RECENT = 3

const linkBtn = {
  height: 30, padding: '0 10px', border: `1px solid ${BORDER}`, borderRadius: R.control,
  background: CARD_BG, color: TEXT, fontSize: 12, fontWeight: 700,
  cursor: 'pointer', fontFamily: 'inherit',
} as const

export default function MySnippetCard({ me }: {
  me: { engineer_id: number | null; permission_level?: string | null }
}) {
  const snippets = useSnippets()
  const { load } = snippets
  const toast = useToast()
  const [manageOpen, setManageOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  // 카드가 뜰 때 한 번 읽는다 — load 는 상태와 무갈이라 되돌이가 생기지 않는다(useSnippets).
  useEffect(() => { void load() }, [load])

  const mine = snippets.rows.filter(s => s.scope === 'private').length
  const shared = snippets.rows.filter(s => s.scope === 'shared').length
  /** 최근에 손댄 것부터 — 고친 적이 없으면 담은 때를 본다. */
  const recent: Snippet[] = [...snippets.rows]
    .sort((a, b) => String(b.updated_at ?? b.created_at ?? '').localeCompare(String(a.updated_at ?? a.created_at ?? '')))
    .slice(0, RECENT)

  const save = async (form: SnippetForm) => {
    setBusy(true)
    const r = await snippets.create(form)
    setBusy(false)
    if (!r.ok) { toast.error(r.error); return }
    toast.success('문구를 담았습니다')
    setAddOpen(false)
  }

  return (
    <>
      <DashCard title="내 문구" loading={snippets.loading && snippets.rows.length === 0}>
        {snippets.notice ? (
          <div style={{ fontSize: 12, color: SUB, lineHeight: 1.8 }}>{snippets.notice}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, flex: 1 }}>
            {/* 건수 — 개인 · 공용 */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 13, color: SUB }}>
              <b className="num" style={{ fontSize: 20, fontWeight: 600, color: BLUE }}>{mine + shared}</b>
              <span>개인 {mine} · 공용 {shared}</span>
            </div>

            {/* 최근 세 장 — 제목 + 용도 뱃지 + 본문 한 줄 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minHeight: 0, overflow: 'hidden' }}>
              {recent.length === 0 && (
                <span style={{ fontSize: 12, color: MUTED }}>담아 둔 문구가 없습니다</span>
              )}
              {recent.map(s => (
                <div key={s.snippet_id} style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <span style={{
                      fontSize: 13, color: TEXT, fontWeight: 600, minWidth: 0,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {s.title}
                    </span>
                    <span style={{
                      flexShrink: 0, fontSize: 11, fontWeight: 600, borderRadius: R.tag, padding: '1px 6px',
                      background: s.scope === 'shared' ? NEUTRAL_BG : BLUE_TINT,
                      color: s.scope === 'shared' ? SUB : BLUE,
                    }}>
                      {KIND_LABEL[s.kind]}
                    </span>
                  </div>
                  <div style={{
                    fontSize: 11, color: MUTED, marginTop: 1,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {oneLine(s.body, 48)}
                  </div>
                </div>
              ))}
            </div>

            {/* 할 수 있는 두 가지 */}
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button type="button" style={{ ...linkBtn, color: BLUE }}
                onClick={e => { e.stopPropagation(); setAddOpen(true) }}>
                ＋ 추가
              </button>
              <button type="button" style={linkBtn}
                onClick={e => { e.stopPropagation(); setManageOpen(true) }}>
                전체 관리
              </button>
            </div>
          </div>
        )}
      </DashCard>

      {/* 전체 관리 — **내 정보의 「내 문구」 탭과 같은 부품**을 창 안에 그대로 끼운다. */}
      {manageOpen && (
        <ModalOverlay onClose={() => setManageOpen(false)}>
          <ModalCard
            width={760}
            onClose={() => setManageOpen(false)}
            title={<div style={{ fontSize: 16, fontWeight: 800, color: TEXT }}>내 문구</div>}
          >
            <MySnippets me={me} />
          </ModalCard>
        </ModalOverlay>
      )}

      {addOpen && (
        <SnippetSaveModal
          busy={busy}
          onClose={() => setAddOpen(false)}
          onSave={form => void save(form)}
        />
      )}
    </>
  )
}

/** 뱃지 글자 — 범위(개인·공용)를 쓰는 자리는 목록 쪽이다(여기서는 용도를 보여 준다). */
export const SCOPE_TEXT = SCOPE_LABEL
