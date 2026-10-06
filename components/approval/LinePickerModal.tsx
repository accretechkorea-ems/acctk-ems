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
import { isSuperAdmin } from '@/lib/permissions'
import { validateLineInput } from '@/lib/approval/engine'
import { DOC_TYPES } from '@/lib/approval/docTypes'
import { checkLineRules, lineRuleNotice, SUPERADMIN_LABEL } from '@/lib/approval/lineRules'
import {
  expandTeamCc, summarizeTeamCc, TEAM_CC_MAX, TEAM_CC_OVER_MESSAGE, TEAM_CC_PRESET_NOTICE,
} from '@/lib/approval/teamCc'
import type { LineInput, LineKind } from '@/lib/approval/types'

/** 직급 순서. 유지보수 화면과 같은 표를 쓴다(없는 직급은 맨 뒤). */
const POSITION_ORDER: Record<string, number> = {
  '사장': 0, '총괄': 1, '관리자': 2, '수석': 3, '책임': 4, '선임': 5, '사원': 6,
}

// permission_level 을 함께 읽는다 — 종류별 결재선 규칙(관리자 결재자 1명 이상)을 화면에서도 보려면
// 누가 그 등급인지 알아야 한다. 판정은 서버와 같은 함수(lib/approval/lineRules.ts)로 한다.
type Person = { engineer_id: number; name: string | null; position: string | null; teams: string | null; permission_level: string | null }
type Preset = { preset_id: number; name: string; doc_type: string | null; lines: LineInput[] }

/** 'superadmin' 등급 표시. 중립 pill — 색은 쓰지 않는다(디자인 규칙). */
function SuperBadge() {
  return (
    <span style={{
      flexShrink: 0, background: NEUTRAL_BG, borderRadius: 99, padding: '1px 7px',
      fontSize: 11, fontWeight: 700, color: SUB, whiteSpace: 'nowrap',
    }}>
      {SUPERADMIN_LABEL}
    </span>
  )
}

const KINDS: { key: LineKind; label: string }[] = [
  { key: 'approve', label: '결재' },
  { key: 'agree', label: '합의' },
  { key: 'cc', label: '참조' },
]

export default function LinePickerModal({
  open, onClose, onConfirm, myId, docType, initial = [], serverError = null, busy = false,
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
  /**
   * 서버가 돌려준 사유. 모달을 닫지 않고 그 자리에 보여 준다 —
   * 견적서 상신은 결재선을 확정전에 서버로 한 번 확인하므로(번호가 소진되지 않게),
   * 막혔을 때 사용자가 같은 창에서 바로 고칠 수 있어야 한다.
   */
  serverError?: string | null
  /** 서버에 묻는 중 — [확인]을 잠근다. */
  busy?: boolean
}) {
  const toast = useToast()
  const [people, setPeople] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [team, setTeam] = useState<string | null>(null)
  const [picked, setPicked] = useState<LineInput[]>(initial)
  const [presets, setPresets] = useState<Preset[]>([])
  const [presetName, setPresetName] = useState('')
  const [saving, setSaving] = useState(false)
  // 「팀으로 참조 추가」의 결과 한 줄(추가·제외 인원 또는 상한 안내). 다음 추가 때 갈아끼운다.
  const [teamCcResult, setTeamCcResult] = useState<string | null>(null)

  // 열릴 때마다 처음 상태로 — 닫았다 다시 열면 지난 선택이 남아 있지 않게 한다.
  useEffect(() => {
    if (!open) return
    setPicked(initial)
    setPresetName('')
    setTeamCcResult(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const run = async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('engineers')
        .select('engineer_id, name, position, teams, permission_level')
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

  // 팀별 재직 인원 수. people 은 이미 `resigned_date is null` 로 걸러 읽으므로 그대로 센다.
  // 팀 목록(teams)이 people 에서 나오므로 **인원 0명인 팀은 애초에 들어오지 않는다.**
  const teamCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of people) if (p.teams) m.set(p.teams, (m.get(p.teams) ?? 0) + 1)
    return m
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

  /**
   * 팀 하나를 참조(cc)로 펼친다 — **그 시점의 재직 인원이 개별 참조로 들어간다.**
   * 팀은 저장되지 않는다(lib/approval/teamCc.ts 머리말). 들어간 사람은 오른쪽 목록에서
   * 하나씩 뺄 수 있고, 같은 팀을 다시 골라도 taken 에 걸려 빠진 사람만 채워진다.
   */
  const addTeamCc = (teamName: string) => {
    const roster = people.filter(p => p.teams === teamName)
    const res = expandTeamCc({
      // people 은 재직자만이라 resigned_date 를 넘기지 않는다 — 'resigned' 는 여기서 나오지 않는다.
      members: roster.map(p => ({ engineer_id: p.engineer_id })),
      requesterId: myId,
      // 종류를 가리지 않는다 — 결재·합의로 이미 고른 사람도 중복이라 건너뛴다(engine 의 중복 금지).
      taken: new Set(picked.map(l => l.approverId)),
      max: TEAM_CC_MAX,
    })
    if (res.overLimit) { setTeamCcResult(TEAM_CC_OVER_MESSAGE); return }
    if (res.added.length > 0) {
      setPicked(prev => renumber([
        ...prev,
        ...res.added.map(id => ({ step: 0, kind: 'cc' as LineKind, approverId: id, isDelegatedAuthority: false })),
      ]))
    }
    setTeamCcResult(summarizeTeamCc(res) ?? '추가할 사람이 없습니다')
  }
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

  // ── 종류별 결재선 규칙 ──
  // 정의표(DOC_TYPES.lineRules)를 읽어 서버와 **같은 함수**로 본다. 규칙이 바뀌면 정의표만 고치면
  // 화면과 서버가 함께 따라온다.
  const rules = docType ? DOC_TYPES[docType]?.lineRules : undefined
  const isSuper = (id: number) => isSuperAdmin(people.find(p => p.engineer_id === id) ?? null)
  // 상신자가 관리자면 면제된다 — 본인은 자기 결재선에 들어갈 수 없기 때문이다(lineRules.ts 설명).
  const iAmSuper = myId != null && isSuper(myId)
  const notice = lineRuleNotice(rules, iAmSuper)

  // 서버와 같은 검증. 재직 여부는 이미 목록에서 걸렀으므로 고른 사람 전부를 재직자로 넘긴다.
  const shapeProblem = useMemo(
    () => validateLineInput(renumber(picked), myId ?? -1, new Set(picked.map(l => l.approverId))),
    [picked, myId],
  )
  const ruleResult = checkLineRules({
    lines: renumber(picked),
    rules,
    requesterIsSuperadmin: iAmSuper,
    isSuperadmin: isSuper,
  })
  // 모양이 먼저다 — 결재자가 아예 없는 결재선에 「관리자를 넣으세요」라고 하면 순서가 뒤집힌다.
  const problem = shapeProblem ?? (ruleResult.ok ? null : ruleResult.message)
  // 안내 줄을 빨갛게 바꾸는 시점 — 결재자를 **고른 뒤에** 규칙에 어긋날 때다. 열자마자(아무도 고르지
  // 않았을 때) 실패로 보이면 아직 하지 않은 일을 틀렸다고 말하는 셈이다.
  const ruleFailing = !ruleResult.ok && picked.some(l => l.kind === 'approve')

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
      {/* 외곽 크기를 **고정**한다 — 예전에는 높이가 내용에 따라 정해져(maxHeight 만 있었다)
          고른 팀의 인원 수에 따라 창이 커졌다 작아졌다 했다. 사람을 고르는 동안 창이 움직이면
          다음에 누를 자리가 매번 달라진다.
          작은 화면에서는 vw·vh 상한으로만 줄어든다(그때도 가운데 칸이 줄어들 뿐 줄 구성은 같다). */}
      <div style={{
        background: CARD_BG, borderRadius: 8, padding: 20,
        width: 1000, maxWidth: '94vw',
        height: 720, maxHeight: '92vh',
        display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.22)',
      }}>
        {/* 위쪽 줄들과 아래 줄은 **크기 고정**(flexShrink: 0) — 가운데가 남는 높이를 가져간다.
            고정하지 않으면 높이가 정해진 상자 안에서 flex 가 이 줄들을 눌러 글자가 잘린다. */}
        <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: TEXT, letterSpacing: '-0.3px' }}>결재선 지정</div>
          <button type="button" onClick={onClose} style={{ ...btnGhost(), padding: '5px 12px' }}>닫기</button>
        </div>

        {/* 개인 결재선 */}
        <div style={{ flexShrink: 0, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
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
          {/* 저장되는 것은 **지금 펼쳐진 개별 참조자**다(팀이 아니다 — lib/approval/teamCc.ts). */}
          <span style={{ fontSize: 11, color: MUTED, lineHeight: 1.6 }}>{TEAM_CC_PRESET_NOTICE}</span>
        </div>

        {/* 팀으로 참조 추가 — 고른 팀의 재직 인원이 개별 참조로 펼쳐진다. */}
        <div style={{ flexShrink: 0, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <select
            defaultValue=""
            disabled={loading || teams.length === 0}
            onChange={e => { const v = e.target.value; if (v) addTeamCc(v); e.currentTarget.value = '' }}
            style={{ ...inputStyle, minWidth: 200, cursor: loading ? 'default' : 'pointer' }}
          >
            <option value="">팀으로 참조 추가</option>
            {teams.map(t => (
              <option key={t} value={t}>{t} ({teamCounts.get(t) ?? 0}명)</option>
            ))}
          </select>
          {teamCcResult && (
            <span style={{ fontSize: 11, color: teamCcResult === TEAM_CC_OVER_MESSAGE ? DANGER : SUB, lineHeight: 1.6 }}>
              {teamCcResult}
            </span>
          )}
        </div>

        {/* 종류별 결재선 규칙 안내 — 짜기 전에 무엇이 필요한지 알린다. 규칙을 만족하지 않는 동안은
            같은 자리에 실패 사유가 보이고 아래 [확인]이 잠긴다. 관리자가 올리는 문서에는 안 뜬다. */}
        {notice && (
          <div style={{
            flexShrink: 0,
            marginBottom: 12, padding: '8px 10px', borderRadius: 6,
            background: NEUTRAL_BG, fontSize: 12, fontWeight: 600,
            color: ruleFailing ? DANGER : SUB,
          }}>
            {ruleFailing && !ruleResult.ok ? ruleResult.message : notice}
          </div>
        )}

        {/* 서버가 돌려준 사유 — 화면 검증이 통과했는데도 막힌 경우다(퇴사·등급 변경 등
            화면이 모르는 사정). 같은 자리에 두면 아래 [확인]과 가까워 바로 고칠 수 있다. */}
        {serverError && (
          <div style={{
            flexShrink: 0,
            marginBottom: 12, padding: '8px 10px', borderRadius: 6,
            background: NEUTRAL_BG, fontSize: 12, fontWeight: 600, color: DANGER,
          }}>
            {serverError}
          </div>
        )}

        {/* 가운데 — **남는 높이를 전부 가져간다**(flex 1 + minHeight 0).
            gridTemplateRows 를 적는 이유: 줄 높이를 적지 않으면 grid 의 한 줄이 auto 로 잡혀
            내용만큼 늘어나고, 그러면 안쪽 칸이 아니라 모달 바깥이 밀린다.
            minmax(0, 1fr) 은 '남는 높이까지만, 그 이상은 안쪽에서 스크롤' 을 뜻한다. */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1.2fr', gridTemplateRows: 'minmax(0, 1fr)',
          gap: 12, flex: 1, minHeight: 0,
        }}>
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
            <div style={{ flex: 1, overflowY: 'auto', minWidth: 0, minHeight: 0 }}>
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
                  {/* 등급 뱃지 — 직급에도 「관리자」가 있어 글자만으로는 구분되지 않는다.
                      규칙이 요구하는 사람이 누구인지 보이게 pill 로 따로 세운다. */}
                  {isSuperAdmin(p) && <SuperBadge />}
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
                {isSuper(l.approverId) && <SuperBadge />}
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

        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
          <span style={{ fontSize: 12, color: problem ? DANGER : MUTED }}>
            {problem ?? `결재 ${picked.filter(l => l.kind === 'approve').length}명 · 합의 ${picked.filter(l => l.kind === 'agree').length}명 · 참조 ${picked.filter(l => l.kind === 'cc').length}명`}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button type="button" onClick={onClose} disabled={busy} style={btnGhost(busy)}>취소</button>
            <button type="button" onClick={confirm} disabled={!!problem || busy} style={btnPrimary(!!problem || busy)}>
              {busy ? '확인 중...' : '확인'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
