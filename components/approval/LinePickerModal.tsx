'use client'

// 결재선 지정 모달.
//
// 왼쪽에서 팀을 고르면 그 팀 사람이 직급 순으로 나오고, 누르면 오른쪽 결재선에 붙는다.
// 오른쪽에서 순서·종류·전결을 바꾸고 삭제한다. 위에서 개인 결재선을 불러오거나 지금 구성을 저장한다.
//
// 검증은 서버(lib/approval/engine.ts 의 validateLineInput)와 같은 함수를 쓴다 —
// 화면에서 통과한 결재선이 상신에서 다시 막히는 일이 없게 하기 위해서다.

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/common/Toast'
import { Z } from '@/lib/zIndex'
import {
  BLUE, BORDER, CARD_BG, DANGER, FAINT, MUTED, NEUTRAL_BG, SUB, TEXT,
  btnGhost, btnPrimary, inputStyle,
} from '@/components/common/ui'
import { validateLineInput } from '@/lib/approval/engine'
import type { LineInput, LineKind } from '@/lib/approval/types'

/** 직급 순서. 유지보수 화면과 같은 표를 쓴다(없는 직급은 맨 뒤). */
const POSITION_ORDER: Record<string, number> = {
  '사장': 0, '총괄': 1, '관리자': 2, '수석': 3, '책임': 4, '선임': 5, '사원': 6,
}

type Person = { engineer_id: number; name: string | null; position: string | null; teams: string | null }
type Preset = { preset_id: number; name: string; doc_type: string | null; lines: LineInput[] }

const KINDS: { key: LineKind; label: string }[] = [
  { key: 'approve', label: '결재' },
  { key: 'agree', label: '합의' },
  { key: 'cc', label: '참조' },
]

export default function LinePickerModal({
  open, onClose, onConfirm, myId, docType, initial = [],
}: {
  open: boolean
  onClose: () => void
  /** 확정한 결재선. step 은 이 모달이 1부터 다시 매겨 넘긴다. */
  onConfirm: (lines: LineInput[]) => void
  /** 상신자 본인 — 목록에서 빼고 검증에도 쓴다. */
  myId: number | null
  /** 개인 결재선 저장·불러오기에 함께 쓸 유형(없으면 모든 유형용으로 저장). */
  docType?: string
  initial?: LineInput[]
}) {
  const toast = useToast()
  const [people, setPeople] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [team, setTeam] = useState<string | null>(null)
  const [picked, setPicked] = useState<LineInput[]>(initial)
  const [presets, setPresets] = useState<Preset[]>([])
  const [presetName, setPresetName] = useState('')
  const [saving, setSaving] = useState(false)

  // 열릴 때마다 처음 상태로 — 닫았다 다시 열면 지난 선택이 남아 있지 않게 한다.
  useEffect(() => {
    if (!open) return
    setPicked(initial)
    setPresetName('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const run = async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('engineers')
        .select('engineer_id, name, position, teams')
        .is('resigned_date', null)
        .order('name')
      if (cancelled) return
      if (error) {
        console.error('[approval/linePicker] engineers load failed', error)
        toast.error('직원 목록을 불러오지 못했습니다')
        setPeople([]); setLoading(false)
        return
      }
      setPeople((data ?? []) as Person[])
      setLoading(false)
    }
    run()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const run = async () => {
      try {
        const res = await fetch('/api/approval/presets')
        const json = await res.json().catch(() => null)
        if (!cancelled && res.ok) setPresets((json?.presets ?? []) as Preset[])
      } catch (e) {
        console.error('[approval/linePicker] presets load failed', e)
      }
    }
    run()
    return () => { cancelled = true }
  }, [open])

  const teams = useMemo(() => {
    const names = [...new Set(people.map(p => p.teams).filter((t): t is string => !!t))]
    return names.sort((a, b) => a.localeCompare(b, 'ko'))
  }, [people])

  const members = useMemo(() => {
    const rank = (p: Person) => POSITION_ORDER[p.position ?? ''] ?? 99
    return people
      .filter(p => p.teams === team && p.engineer_id !== myId)
      .sort((a, b) => rank(a) - rank(b) || (a.name ?? '').localeCompare(b.name ?? '', 'ko'))
  }, [people, team, myId])

  const nameOf = (id: number) => people.find(p => p.engineer_id === id)?.name ?? `#${id}`
  const posOf = (id: number) => people.find(p => p.engineer_id === id)?.position ?? ''
  const chosen = new Set(picked.map(l => l.approverId))

  /** 결재·합의는 1부터 다시 매기고 참조는 순서를 갖지 않는다. 화면 순서가 곧 결재 순서다. */
  const renumber = (list: LineInput[]): LineInput[] => {
    let n = 0
    return list.map(l => (l.kind === 'cc' ? { ...l, step: 0 } : { ...l, step: ++n }))
  }

  const add = (p: Person) => {
    if (chosen.has(p.engineer_id)) return
    setPicked(prev => renumber([...prev, { step: 0, kind: 'approve', approverId: p.engineer_id, isDelegatedAuthority: false }]))
  }
  const remove = (id: number) => setPicked(prev => renumber(prev.filter(l => l.approverId !== id)))
  const move = (idx: number, dir: -1 | 1) => {
    setPicked(prev => {
      const next = [...prev]
      const to = idx + dir
      if (to < 0 || to >= next.length) return prev
      ;[next[idx], next[to]] = [next[to], next[idx]]
      return renumber(next)
    })
  }
  const setKind = (id: number, kind: LineKind) =>
    setPicked(prev => renumber(prev.map(l => (l.approverId === id
      ? { ...l, kind, isDelegatedAuthority: kind === 'approve' ? l.isDelegatedAuthority : false }
      : l))))
  const toggleAuthority = (id: number) =>
    setPicked(prev => prev.map(l => (l.approverId === id ? { ...l, isDelegatedAuthority: !l.isDelegatedAuthority } : l)))

  // 서버와 같은 검증. 재직 여부는 이미 목록에서 걸렀으므로 고른 사람 전부를 재직자로 넘긴다.
  const problem = useMemo(
    () => validateLineInput(renumber(picked), myId ?? -1, new Set(picked.map(l => l.approverId))),
    [picked, myId],
  )

  const loadPreset = (presetId: number) => {
    const p = presets.find(x => x.preset_id === presetId)
    if (!p) return
    const alive = new Set(people.map(x => x.engineer_id))
    const usable = (p.lines ?? []).filter(l => alive.has(l.approverId) && l.approverId !== myId)
    if (usable.length < (p.lines ?? []).length) toast.error('퇴사했거나 쓸 수 없는 사람은 빼고 불러왔습니다')
    setPicked(renumber(usable))
  }

  const savePreset = async () => {
    const name = presetName.trim()
    if (!name) { toast.error('개인 결재선 이름을 입력해주세요'); return }
    if (problem) { toast.error(problem); return }
    setSaving(true)
    try {
      const res = await fetch('/api/approval/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, docType: docType ?? null, lines: renumber(picked) }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) { toast.error(json?.error ?? '저장하지 못했습니다'); return }
      setPresets(prev => [json.preset as Preset, ...prev])
      setPresetName('')
      toast.success('개인 결재선을 저장했습니다')
    } catch (e) {
      console.error('[approval/linePicker] preset save failed', e)
      toast.error('저장하지 못했습니다')
    } finally {
      setSaving(false)
    }
  }

  const confirm = () => {
    if (problem) { toast.error(problem); return }
    onConfirm(renumber(picked))
  }

  if (!open) return null

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: Z.subModal,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div style={{
        background: CARD_BG, borderRadius: 8, padding: 20, width: '100%', maxWidth: 760,
        maxHeight: '86vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.22)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: TEXT, letterSpacing: '-0.3px' }}>결재선 지정</div>
          <button type="button" onClick={onClose} style={{ ...btnGhost(), padding: '5px 12px' }}>닫기</button>
        </div>

        {/* 개인 결재선 */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <select
            defaultValue=""
            onChange={e => { const v = Number(e.target.value); if (v) loadPreset(v); e.currentTarget.value = '' }}
            style={{ ...inputStyle, minWidth: 160, cursor: 'pointer' }}
          >
            <option value="">개인 결재선 불러오기</option>
            {presets.map(p => <option key={p.preset_id} value={p.preset_id}>{p.name}</option>)}
          </select>
          <input
            value={presetName}
            onChange={e => setPresetName(e.target.value)}
            placeholder="저장할 이름"
            maxLength={40}
            style={{ ...inputStyle, width: 150 }}
          />
          <button type="button" onClick={savePreset} disabled={saving || picked.length === 0}
            style={btnGhost(saving || picked.length === 0)}>
            {saving ? '저장 중...' : '현재 구성 저장'}
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 12, flex: 1, minHeight: 0 }}>
          {/* 왼쪽 — 팀 → 사람 */}
          <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, display: 'flex', minHeight: 0 }}>
            <div style={{ width: 110, borderRight: `1px solid ${BORDER}`, overflowY: 'auto' }}>
              {loading ? (
                <div style={{ padding: 12, fontSize: 12, color: MUTED }}>불러오는 중...</div>
              ) : teams.map(t => (
                <button key={t} type="button" onClick={() => setTeam(t)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '9px 10px', border: 'none',
                    background: team === t ? NEUTRAL_BG : 'transparent', color: team === t ? TEXT : SUB,
                    fontSize: 13, fontWeight: team === t ? 700 : 500, cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                  {t}
                </button>
              ))}
            </div>
            <div style={{ flex: 1, overflowY: 'auto', minWidth: 0 }}>
              {!team ? (
                <div style={{ padding: 12, fontSize: 12, color: MUTED }}>팀을 고르세요</div>
              ) : members.length === 0 ? (
                <div style={{ padding: 12, fontSize: 12, color: MUTED }}>이 팀에 지정할 사람이 없습니다</div>
              ) : members.map(p => (
                <button key={p.engineer_id} type="button" onClick={() => add(p)} disabled={chosen.has(p.engineer_id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left',
                    padding: '9px 10px', border: 'none', background: 'transparent',
                    color: chosen.has(p.engineer_id) ? FAINT : TEXT,
                    cursor: chosen.has(p.engineer_id) ? 'default' : 'pointer',
                    fontSize: 13, fontFamily: 'inherit',
                  }}>
                  <span style={{ fontWeight: 600 }}>{p.name}</span>
                  <span style={{ fontSize: 11, color: MUTED }}>{p.position}</span>
                  {chosen.has(p.engineer_id) && <span style={{ fontSize: 11, color: MUTED, marginLeft: 'auto' }}>추가됨</span>}
                </button>
              ))}
            </div>
          </div>

          {/* 오른쪽 — 지정한 결재선 */}
          <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, overflowY: 'auto', minHeight: 0 }}>
            {picked.length === 0 ? (
              <div style={{ padding: 12, fontSize: 12, color: MUTED }}>왼쪽에서 사람을 골라 추가하세요</div>
            ) : picked.map((l, i) => (
              <div key={l.approverId} style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '9px 10px',
                borderTop: i === 0 ? 'none' : `1px solid ${BORDER}`,
              }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: SUB, width: 16 }}>
                  {l.kind === 'cc' ? '·' : l.step}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: TEXT, whiteSpace: 'nowrap' }}>{nameOf(l.approverId)}</span>
                <span style={{ fontSize: 11, color: MUTED, whiteSpace: 'nowrap' }}>{posOf(l.approverId)}</span>
                <select value={l.kind} onChange={e => setKind(l.approverId, e.target.value as LineKind)}
                  style={{ ...inputStyle, padding: '4px 6px', fontSize: 12, marginLeft: 'auto', cursor: 'pointer' }}>
                  {KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
                </select>
                {l.kind === 'approve' && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: SUB, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    <input type="checkbox" checked={l.isDelegatedAuthority === true} onChange={() => toggleAuthority(l.approverId)}
                      style={{ width: 13, height: 13, accentColor: BLUE, cursor: 'pointer' }} />
                    전결
                  </label>
                )}
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                  style={{ ...btnGhost(i === 0), padding: '3px 7px', fontSize: 11 }}>↑</button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === picked.length - 1}
                  style={{ ...btnGhost(i === picked.length - 1), padding: '3px 7px', fontSize: 11 }}>↓</button>
                <button type="button" onClick={() => remove(l.approverId)}
                  style={{ border: 'none', background: 'transparent', color: DANGER, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  삭제
                </button>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
          <span style={{ fontSize: 12, color: problem ? DANGER : MUTED }}>
            {problem ?? `결재 ${picked.filter(l => l.kind === 'approve').length}명 · 합의 ${picked.filter(l => l.kind === 'agree').length}명 · 참조 ${picked.filter(l => l.kind === 'cc').length}명`}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button type="button" onClick={onClose} style={btnGhost()}>취소</button>
            <button type="button" onClick={confirm} disabled={!!problem} style={btnPrimary(!!problem)}>확인</button>
          </div>
        </div>
      </div>
    </div>
  )
}
