'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { createClient } from '@/lib/supabase/client'
import { canViewQuote } from '@/lib/permissions'
import { withTeamPerms } from '@/lib/teamPerms'
import { Z } from '@/lib/zIndex'

/**
 * 견적 대필 — 실적을 받을 담당자를 고르는 모달.
 *
 * 후보는 "견적 권한이 있는 재직자 전원". 팀 이름이 아니라 teams 플래그로 판정하므로
 * 팀이 늘어도 이 파일은 손대지 않는다(리드 배정 후보 선별과 같은 규칙).
 *
 * 드롭다운이 아니라 이름 검색인 이유: 후보가 스무 명을 넘어 목록에서 눈으로 찾기 느리다.
 * 검색어가 없으면 팀별로 묶어 전원을 보여준다 — 이름을 정확히 몰라도 고를 수 있어야 한다.
 */

export type Assignee = { engineer_id: number; name: string; position: string | null; teams: string | null }

const BLUE = '#234ea2', TEXT = '#111827', GRAY = '#6b7280', MUTED = '#9ca3af', BORDER = '#ebebeb'

const inputStyle: CSSProperties = {
  width: '100%', padding: '10px 12px', border: `1px solid ${BORDER}`, borderRadius: 6,
  boxSizing: 'border-box', color: TEXT, background: '#fff', outline: 'none', fontSize: 14,
}

type Row = Assignee & { resigned_date: string | null; permission_level: string | null }

export default function AssigneePicker({ open, onClose, onPick }: {
  open: boolean
  onClose: () => void
  onPick: (assignee: Assignee) => void
}) {
  const [list, setList] = useState<Assignee[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')

  // 열릴 때마다 새로 읽지 않는다 — 팀 플래그는 세션 캐시라 첫 조회 한 번이면 충분하다.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    const run = async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('engineers')
        .select('engineer_id, name, position, teams, permission_level, resigned_date')
        .is('resigned_date', null)
        .order('name')
      if (error) {
        console.error('[assignee] load failed', error)
        if (!cancelled) { setList([]); setLoading(false) }
        return
      }
      const withPerm = await withTeamPerms((data ?? []) as Row[])
      if (cancelled) return
      setList(withPerm.filter(e => canViewQuote(e)).map(e => ({
        engineer_id: e.engineer_id, name: e.name, position: e.position, teams: e.teams,
      })))
      setLoading(false)
    }
    run()
    return () => { cancelled = true }
  }, [open])

  // 모달을 닫을 때 검색어를 버린다(다음에 열면 전원 목록부터).
  useEffect(() => { if (!open) setQuery('') }, [open])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return list
    return list.filter(e =>
      e.name.toLowerCase().includes(q) ||
      (e.teams ?? '').toLowerCase().includes(q)
    )
  }, [list, query])

  if (!open) return null

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: Z.modal, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
    >
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 400, padding: 28, boxShadow: '0 12px 48px rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column', maxHeight: '80vh' }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: TEXT, marginBottom: 4 }}>견적서 대필</div>
        <div style={{ fontSize: 12, color: GRAY, marginBottom: 16, lineHeight: 1.6 }}>
          실적을 받을 담당자를 고르면 견적 작성 화면으로 넘어갑니다.<br />
          견적번호는 작성하는 본인 이니셜로 발급됩니다.
        </div>

        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="담당자 이름 검색"
          autoFocus
          style={inputStyle}
        />

        <div style={{ flex: 1, minHeight: 120, overflowY: 'auto', marginTop: 12, border: `1px solid ${BORDER}`, borderRadius: 6 }}>
          {loading ? (
            <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: MUTED }}>불러오는 중...</div>
          ) : matches.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: MUTED }}>
              {list.length === 0 ? '고를 수 있는 담당자가 없습니다' : '검색 결과가 없습니다'}
            </div>
          ) : matches.map(e => (
            <div key={e.engineer_id}
              onClick={() => onPick(e)}
              style={{ padding: '10px 12px', cursor: 'pointer', display: 'flex', alignItems: 'baseline', gap: 6, borderBottom: `1px solid ${BORDER}` }}
              onMouseEnter={ev => { ev.currentTarget.style.background = '#f5f5f5' }}
              onMouseLeave={ev => { ev.currentTarget.style.background = 'transparent' }}
            >
              <span style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>{e.name}</span>
              <span style={{ fontSize: 12, color: GRAY }}>{e.position ?? ''}</span>
              <span style={{ fontSize: 11, color: MUTED, marginLeft: 'auto' }}>{e.teams ?? '미배정'}</span>
            </div>
          ))}
        </div>

        <button onClick={onClose}
          style={{ marginTop: 16, padding: 10, background: '#f3f4f6', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13, color: GRAY }}>
          취소
        </button>
        <span style={{ display: 'none', color: BLUE }} />
      </div>
    </div>
  )
}
