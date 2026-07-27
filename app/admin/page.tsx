'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const BLUE = '#234ea2'
const GREEN = '#16a34a'
const PAGE_BG = '#f4f5f7'
const CARD_BG = '#ffffff'
const BORDER = '#e5e7eb'
const TEXT = '#111113'
const GRAY = '#6b7280'
const DANGER = '#dc2626'
const PURPLE = '#7c3aed'

type Quote = {
  quote_id: number
  quote_number: string
  quote_date: string
  total_supply: number
  status: string
  subject: string | null
  pdf_url?: string | null
  customer_id?: number | null
  engineers?: { name: string } | null
  customers?: { company_name: string } | null
}

type Engineer = {
  engineer_id: number
  name: string
  position: string | null
  teams: string | null
  email: string | null
  initials: string | null
  is_admin: boolean
  permission_level: string
  is_inventory_manager: boolean
  resigned_date: string | null
}

type SalesTarget = {
  target_id: number
  engineer_id: number | null
  year: number
  quarter: number | null
  target_amount: number
}

type Team = {
  id: number
  name: string
  is_special: boolean
  display_order: number
}

const numKR = (n: number) => Math.round(n).toLocaleString('ko-KR')

const STATUS_COLORS: Record<string, string> = {
  '견적중': '#f59e0b', '수주': '#3b82f6', '매출완료': '#16a34a', '실패': '#dc2626', '보류': '#9ca3af',
}

const POSITION_ORDER: Record<string, number> = {
  '총괄': 0, '관리자': 1, '수석': 2, '책임': 3, '선임': 4, '사원': 5,
}

const POSITIONS = ['사장', '총괄', '수석', '책임', '선임', '사원']
const TEAMS = ['임원', '영업관리', '1', '2', '3', '4', 'Apps.']

export default function AdminPage() {
  const supabase = createClient()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [currentEngineer, setCurrentEngineer] = useState<Engineer | null>(null)

  // 견적서 삭제
  const [showQuoteModal, setShowQuoteModal] = useState(false)
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [deleting, setDeleting] = useState<number | null>(null)

  // 목표 금액 관리
  const [showTargetModal, setShowTargetModal] = useState(false)
  const [targets, setTargets] = useState<SalesTarget[]>([])
  const [targetLoading, setTargetLoading] = useState(false)
  const thisYear = new Date().getFullYear()
  const [targetYear, setTargetYear] = useState(thisYear)
  const [editingTarget, setEditingTarget] = useState<{ engineerId: number | null; amount: string } | null>(null)
  const [savingTarget, setSavingTarget] = useState(false)

  // 직원 관리
  const [showEngineerModal, setShowEngineerModal] = useState(false)
  const [engineers, setEngineers] = useState<Engineer[]>([])
  const [engineerLoading, setEngineerLoading] = useState(false)
  const [showAddEngineer, setShowAddEngineer] = useState(false)
  const [addForm, setAddForm] = useState({ name: '', position: '사원', teams: '1', email: '', initials: '', password: '' })
  const [addLoading, setAddLoading] = useState(false)
  const [editEngineer, setEditEngineer] = useState<Engineer | null>(null)
  const [editForm, setEditForm] = useState({ name: '', position: '', teams: '', email: '', initials: '', permission_level: 'member', is_inventory_manager: false })
  const [editLoading, setEditLoading] = useState(false)
  const [deleteEngineer, setDeleteEngineer] = useState<Engineer | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [resignDate, setResignDate] = useState<string>('')
  const [showLogModal, setShowLogModal] = useState(false)

  // 팀 관리
  const [showTeamModal, setShowTeamModal] = useState(false)
  const [teamsList, setTeamsList] = useState<Team[]>([])
  const [teamLoading, setTeamLoading] = useState(false)
  const [newTeamName, setNewTeamName] = useState('')
  const [newTeamIsSpecial, setNewTeamIsSpecial] = useState(false)
  const [addTeamLoading, setAddTeamLoading] = useState(false)
  const [deletingTeam, setDeletingTeam] = useState<number | null>(null)
  const [logs, setLogs] = useState<any[]>([])
  const [logLoading, setLogLoading] = useState(false)

  useEffect(() => {
    const check = async () => {
      const { data } = await supabase.auth.getUser()
      if (!data.user?.email) { router.replace('/'); return }

      const { data: engData } = await supabase
        .from('engineers')
        .select('*')
        .eq('email', data.user.email)
        .single()

      if (engData && ['superadmin', 'manager'].includes(engData.permission_level)) {
        setCurrentEngineer(engData)
        setAuthorized(true)
      } else {
        router.replace('/')
      }
      setLoading(false)
    }
    check()
  }, [])

  const fetchLogs = async () => {
    setLogLoading(true)
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const { data } = await supabase
      .from('download_logs')
      .select('*, engineers(name)')
      .gte('downloaded_at', sevenDaysAgo.toISOString())
      .order('downloaded_at', { ascending: false })
      .limit(1000)
    setLogs(data || [])
    setLogLoading(false)
  }
  // ── 견적서 ──────────────────────────────────────────────────────────────────
  const fetchQuotes = async (q?: string) => {
    setQuoteLoading(true)
    let query = supabase.from('quotes').select('*, engineers(name)').order('quote_date', { ascending: false }).limit(50)
    if (q && q.trim()) query = query.or(`quote_number.ilike.%${q}%,subject.ilike.%${q}%`)
    const { data: qData } = await query
    const rows = (qData || []) as Quote[]
    const customerIds = [...new Set(rows.map(r => r.customer_id).filter((id): id is number => id != null))]
    const { data: custData } = customerIds.length > 0
      ? await supabase.from('customers').select('customer_id, company_name').in('customer_id', customerIds)
      : { data: [] }
    const custMap: Record<number, string> = {}
    for (const c of custData || []) custMap[c.customer_id] = c.company_name
    const merged = rows.map(r => ({
      ...r,
      customers: r.customer_id ? { company_name: custMap[r.customer_id] ?? null } : null,
    }))
    setQuotes(merged)
    setQuoteLoading(false)
  }

  const handleDeleteQuote = async (quote: Quote) => {
    const ok = confirm(`견적서 ${quote.quote_number}을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)
    if (!ok) return
    setDeleting(quote.quote_id)
    await supabase.from('quote_items').delete().eq('quote_id', quote.quote_id)
    await supabase.from('quotes').delete().eq('quote_id', quote.quote_id)
   if (quote.pdf_url) {
      const filePath = quote.pdf_url.replace('quote-pdfs/', '')
      await fetch('/api/delete-quote-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath }),
      })
    }
    setDeleting(null)
    fetchQuotes(searchQuery)
  }

  // ── 목표 금액 ───────────────────────────────────────────────────────────────
  const fetchTargetData = async () => {
    setTargetLoading(true)
    const [{ data: eData }, { data: tData }] = await Promise.all([
      supabase.from('engineers').select('*').order('engineer_id'),
      supabase.from('sales_targets').select('*').eq('year', targetYear).is('quarter', null),
    ])
    const sorted = (eData || []).sort((a: Engineer, b: Engineer) =>
      (POSITION_ORDER[a.position ?? ''] ?? 99) - (POSITION_ORDER[b.position ?? ''] ?? 99)
    )
    setEngineers(sorted)
    setTargets(tData || [])
    setTargetLoading(false)
  }

  useEffect(() => { if (showTargetModal) fetchTargetData() }, [targetYear])

  const getTarget = (engineerId: number | null) => targets.find(t => t.engineer_id === engineerId) ?? null

  const handleSaveTarget = async () => {
    if (!editingTarget) return
    if (!editingTarget.amount.trim()) {
      const existing = getTarget(editingTarget.engineerId)
      if (existing) await supabase.from('sales_targets').delete().eq('target_id', existing.target_id)
      setEditingTarget(null)
      fetchTargetData()
      return
    }
    const amount = Number(editingTarget.amount.replace(/,/g, ''))
    if (isNaN(amount) || amount < 0) { alert('올바른 금액을 입력해주세요.'); return }
    setSavingTarget(true)
    const existing = getTarget(editingTarget.engineerId)
    if (existing) {
      await supabase.from('sales_targets').update({ target_amount: amount }).eq('target_id', existing.target_id)
    } else {
      await supabase.from('sales_targets').insert({ engineer_id: editingTarget.engineerId, year: targetYear, quarter: null, target_amount: amount })
    }
    setSavingTarget(false)
    setEditingTarget(null)
    fetchTargetData()
  }

  // ── 직원 관리 ───────────────────────────────────────────────────────────────
  const fetchEngineers = async () => {
    setEngineerLoading(true)
    const { data } = await supabase.from('engineers').select('*').order('engineer_id')
    const sorted = (data || []).sort((a: Engineer, b: Engineer) =>
      (POSITION_ORDER[a.position ?? ''] ?? 99) - (POSITION_ORDER[b.position ?? ''] ?? 99)
    )
    setEngineers(sorted)
    setEngineerLoading(false)
  }

  const handleAddEngineer = async () => {
    if (!addForm.name.trim()) { alert('이름을 입력해주세요.'); return }
    if (!addForm.email.trim()) { alert('이메일을 입력해주세요.'); return }
    if (!addForm.password.trim()) { alert('초기 비밀번호를 입력해주세요.'); return }
    if (!addForm.initials.trim()) { alert('이니셜을 입력해주세요.'); return }
    setAddLoading(true)
    try {
      const res = await fetch('/api/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: addForm.email.trim(),
          password: addForm.password.trim(),
          name: addForm.name.trim(),
          position: addForm.position,
          teams: addForm.teams,
          initials: addForm.initials.trim().toUpperCase(),
        }),
      })
      if (!res.ok) {
        const result = await res.json().catch(() => ({ error: `서버 오류 (${res.status})` }))
        alert(`오류: ${result.error ?? '알 수 없는 오류'}`)
        setAddLoading(false)
        return
      }
      const result = await res.json()
      if (result.error) { alert(`오류: ${result.error}`); setAddLoading(false); return }
      alert(`✅ ${addForm.name} 직원이 등록되었습니다!`)
      setShowAddEngineer(false)
      setAddForm({ name: '', position: '사원', teams: '1', email: '', initials: '', password: '' })
      fetchEngineers()
    } catch (e) {
      alert('오류가 발생했습니다.')
    }
    setAddLoading(false)
  }

  const handleUpdateEngineer = async () => {
    if (!editEngineer) return
    if (!editForm.name.trim()) { alert('이름을 입력해주세요.'); return }
    setEditLoading(true)
    try {
      const res = await fetch('/api/update-engineer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          engineer_id: editEngineer.engineer_id,
          name: editForm.name.trim(),
          position: editForm.position,
          teams: editForm.teams,
          email: editForm.email.trim(),
          initials: editForm.initials.trim().toUpperCase(),
          is_inventory_manager: editForm.is_inventory_manager,
          permission_level: editForm.permission_level,
        }),
      })
      const result = await res.json().catch(() => ({ error: `서버 오류 (${res.status})` }))
      if (!res.ok || result.error) { alert(`오류: ${result.error ?? '알 수 없는 오류'}`); setEditLoading(false); return }
      alert('직원 정보가 수정되었습니다.')
      setEditEngineer(null)
      fetchEngineers()
    } catch {
      alert('오류가 발생했습니다.')
    }
    setEditLoading(false)
  }

  const handleDeleteEngineer = async () => {
    if (!deleteEngineer) return
    if (!resignDate) { alert('퇴사일을 선택해주세요.'); return }
    setDeleteLoading(true)
    try {
      const res = await fetch('/api/delete-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engineer_id: deleteEngineer.engineer_id, email: deleteEngineer.email, resigned_date: resignDate }),
      })
      if (!res.ok) {
        const result = await res.json().catch(() => ({ error: `서버 오류 (${res.status})` }))
        alert(`오류: ${result.error ?? '알 수 없는 오류'}`)
        setDeleteLoading(false)
        return
      }
      const result = await res.json()
      if (result.error) { alert(`오류: ${result.error}`); setDeleteLoading(false); return }
      alert(`${deleteEngineer.name} 직원이 퇴사 처리되었습니다. (퇴사일 ${resignDate})\n과거 기록은 그대로 보존됩니다.`)
      setDeleteEngineer(null)
      fetchEngineers()
    } catch (e) {
      alert('오류가 발생했습니다.')
    }
    setDeleteLoading(false)
  }

  // 복직 처리 — 퇴사일을 비워 다시 재직 상태로
  const handleRestoreEngineer = async (eng: Engineer) => {
    if (!confirm(`${eng.name} 직원을 복직 처리하시겠습니까?\n(로그인 계정은 '직원 등록'에서 다시 생성해야 합니다.)`)) return
    try {
      const res = await fetch('/api/update-engineer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          engineer_id: eng.engineer_id, name: eng.name, position: eng.position,
          teams: eng.teams, email: eng.email, initials: eng.initials,
          is_inventory_manager: eng.is_inventory_manager, resigned_date: null,
        }),
      })
      const result = await res.json().catch(() => ({ error: `서버 오류 (${res.status})` }))
      if (!res.ok || result.error) { alert(`오류: ${result.error ?? '알 수 없는 오류'}`); return }
      alert(`${eng.name} 직원이 복직 처리되었습니다.`)
      fetchEngineers()
    } catch {
      alert('오류가 발생했습니다.')
    }
  }

  // ── 팀 관리 ────────────────────────────────────────────────────────────────
  const getTeamDisplay = (name: string, list: Team[] = teamsList) => {
    if (!name) return '-'
    const t = list.find(t => t.name === name)
    if (t) return t.is_special ? t.name : t.name + '팀'
    return ['임원', '영업관리', 'Apps.'].includes(name) ? name : name + '팀'
  }

  const fetchTeams = async () => {
    setTeamLoading(true)
    const { data } = await supabase.from('teams').select('*').order('display_order')
    setTeamsList((data as Team[]) ?? [])
    setTeamLoading(false)
  }

  const handleAddTeam = async () => {
    if (!newTeamName.trim()) { alert('팀 이름을 입력해주세요.'); return }
    setAddTeamLoading(true)
    const maxOrder = teamsList.length > 0 ? Math.max(...teamsList.map(t => t.display_order)) : 0
    const { error } = await supabase.from('teams').insert({
      name: newTeamName.trim(),
      is_special: newTeamIsSpecial,
      display_order: maxOrder + 1,
    })
    setAddTeamLoading(false)
    if (error) { alert(error.message); return }
    setNewTeamName('')
    setNewTeamIsSpecial(false)
    fetchTeams()
  }

  const handleDeleteTeam = async (team: Team) => {
    const { count } = await supabase
      .from('engineers')
      .select('engineer_id', { count: 'exact', head: true })
      .eq('teams', team.name)
    if (count && count > 0) {
      alert(`이 팀에 ${count}명의 직원이 배정되어 있습니다. 먼저 직원 팀을 변경해주세요.`)
      return
    }
    if (!confirm(`'${getTeamDisplay(team.name)}' 팀을 삭제하시겠습니까?`)) return
    setDeletingTeam(team.id)
    await supabase.from('teams').delete().eq('id', team.id)
    setDeletingTeam(null)
    fetchTeams()
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchTeams() }, [])

  const teamsOptions = teamsList.length > 0 ? teamsList.map(t => t.name) : TEAMS

  const inp: React.CSSProperties = {
    padding: '8px 12px', border: `1px solid ${BORDER}`, borderRadius: 8,
    fontSize: 13, outline: 'none', background: '#fff', boxSizing: 'border-box', width: '100%',
  }

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh', fontSize: 16, color: GRAY }}>확인 중...</div>
  if (!authorized) return null

  // 팀별 그룹핑 (목표 금액용)
  const teamGroups = engineers.reduce((acc, eng) => {
    const team = eng.teams ?? '미배정'
    if (!acc[team]) acc[team] = []
    acc[team].push(eng)
    return acc
  }, {} as Record<string, Engineer[]>)

  const teamOrder = Object.keys(teamGroups).sort((a, b) => {
    if (a === '미배정') return 1
    if (b === '미배정') return -1
    return a.localeCompare(b)
  })

  const getTeamTotal = (teamEngineers: Engineer[]) =>
    teamEngineers.reduce((s, e) => s + (getTarget(e.engineer_id)?.target_amount || 0), 0)
  const totalAllTarget = engineers.reduce((s, e) => s + (getTarget(e.engineer_id)?.target_amount || 0), 0)

  return (
    <div style={{ background: PAGE_BG, minHeight: '100vh', padding: 24, fontFamily: 'Malgun Gothic, sans-serif' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>

        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: TEXT, margin: 0 }}>⚙️ 관리자</h1>
          <p style={{ fontSize: 13, color: GRAY, marginTop: 6 }}>시스템 운영 및 유지보수 기능</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>

          <div style={{ background: CARD_BG, borderRadius: 16, padding: 24, border: `1px solid ${BORDER}` }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>🎯</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: TEXT, marginBottom: 8 }}>목표 금액 관리</div>
            <div style={{ fontSize: 13, color: GRAY, marginBottom: 20, lineHeight: 1.6 }}>연간 목표 금액을 개인별 / 팀별로 설정하고 수정합니다.</div>
            <button style={{ width: '100%', padding: '10px', background: BLUE, color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
              onClick={() => { setShowTargetModal(true); setEditingTarget(null); fetchTargetData() }}>관리하기</button>
          </div>

          <div style={{ background: CARD_BG, borderRadius: 16, padding: 24, border: `1px solid ${BORDER}` }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>🗑️</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: TEXT, marginBottom: 8 }}>견적서 삭제</div>
            <div style={{ fontSize: 13, color: GRAY, marginBottom: 20, lineHeight: 1.6 }}>실수로 저장된 견적서를 조회하고 삭제합니다.</div>
            <button style={{ width: '100%', padding: '10px', background: BLUE, color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
              onClick={() => { setShowQuoteModal(true); setSearchQuery(''); fetchQuotes() }}>관리하기</button>
          </div>

          <div style={{ background: CARD_BG, borderRadius: 16, padding: 24, border: `1px solid ${BORDER}` }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>👥</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: TEXT, marginBottom: 8 }}>직원 관리</div>
            <div style={{ fontSize: 13, color: GRAY, marginBottom: 20, lineHeight: 1.6 }}>직원 등록, 정보 수정, 관리자 권한, 계정 삭제를 관리합니다.</div>
            <button
              onClick={() => { setShowEngineerModal(true); fetchEngineers(); fetchTeams() }}
              disabled={currentEngineer?.permission_level !== 'superadmin'}
              style={{ width: '100%', padding: '10px', background: currentEngineer?.permission_level === 'superadmin' ? BLUE : '#9ca3af', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: currentEngineer?.permission_level === 'superadmin' ? 'pointer' : 'not-allowed' }}>
              관리하기
            </button>
          </div>

          <div style={{ background: CARD_BG, borderRadius: 16, padding: 24, border: `1px solid ${BORDER}` }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>🏷️</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: TEXT, marginBottom: 8 }}>팀 관리</div>
            <div style={{ fontSize: 13, color: GRAY, marginBottom: 20, lineHeight: 1.6 }}>팀을 추가하거나 삭제합니다. 직원 등록·수정 시 팀 목록에 즉시 반영됩니다.</div>
            <button
              onClick={() => { setShowTeamModal(true); fetchTeams() }}
              disabled={currentEngineer?.permission_level !== 'superadmin'}
              style={{ width: '100%', padding: '10px', background: currentEngineer?.permission_level === 'superadmin' ? BLUE : '#9ca3af', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: currentEngineer?.permission_level === 'superadmin' ? 'pointer' : 'not-allowed' }}>
              관리하기
            </button>
          </div>

          <div style={{ background: CARD_BG, borderRadius: 16, padding: 24, border: `1px solid ${BORDER}` }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>📊</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: TEXT, marginBottom: 8 }}>가격표 업로드</div>
            <div style={{ fontSize: 13, color: GRAY, marginBottom: 20, lineHeight: 1.6 }}>엑셀 파일을 업로드해서 견적서 가격표를 최신 버전으로 업데이트합니다.</div>
            <button style={{ width: '100%', padding: '10px', background: BLUE, color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
              onClick={() => alert('준비 중입니다.')}>업로드하기</button>
          </div>

          <div style={{ background: CARD_BG, borderRadius: 16, padding: 24, border: `1px solid ${BORDER}` }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>💱</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: TEXT, marginBottom: 8 }}>환율 수동 설정</div>
            <div style={{ fontSize: 13, color: GRAY, marginBottom: 20, lineHeight: 1.6 }}>자동 갱신이 안 될 때 JPY 환율을 수동으로 입력합니다.</div>
            <button style={{ width: '100%', padding: '10px', background: BLUE, color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
              onClick={() => alert('준비 중입니다.')}>설정하기</button>
          </div>

 <div style={{ background: CARD_BG, borderRadius: 16, padding: 24, border: `1px solid ${BORDER}`, display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>📋</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: TEXT, marginBottom: 8 }}>다운로드 로그</div>
            <div style={{ fontSize: 13, color: GRAY, marginBottom: 20, lineHeight: 1.6 }}>견적서 PDF 다운로드 이력을 조회합니다.</div>
            <div style={{ flex: 1 }} />
            <button style={{ width: '100%', padding: '10px', background: BLUE, color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
              onClick={() => { setShowLogModal(true); fetchLogs() }}>조회하기</button>
          </div>

        </div>
      </div>

      {/* ── 목표 금액 모달 ── */}
      {showTargetModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: CARD_BG, borderRadius: 18, padding: 24, width: '100%', maxWidth: 680, maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: TEXT }}>🎯 목표 금액 관리</div>
              <button onClick={() => setShowTargetModal(false)} style={{ width: 32, height: 32, borderRadius: '50%', background: '#f3f4f6', border: 'none', cursor: 'pointer', fontSize: 16 }}>✕</button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span style={{ fontSize: 13, color: GRAY, fontWeight: 600 }}>연도</span>
              <select value={targetYear} onChange={e => setTargetYear(Number(e.target.value))} style={{ ...inp, width: 100 }}>
                {[thisYear - 1, thisYear, thisYear + 1].map(y => <option key={y} value={y}>{y}년</option>)}
              </select>
              <span style={{ fontSize: 12, color: GRAY }}>연간 목표 기준 (월/분기는 자동 계산)</span>
            </div>
            <div style={{ background: '#eff6ff', borderRadius: 10, padding: '12px 16px', marginBottom: 16, border: '1px solid #bfdbfe', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: BLUE }}>계측부 전체 목표</span>
              <span style={{ fontSize: 18, fontWeight: 800, color: BLUE }}>₩{numKR(totalAllTarget)}</span>
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {targetLoading ? <div style={{ textAlign: 'center', padding: 40, color: GRAY }}>불러오는 중...</div> : (
                teamOrder.map(team => (
                  <div key={team} style={{ marginBottom: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, padding: '6px 0', borderBottom: `2px solid ${BORDER}` }}>
                      <span style={{ fontSize: 14, fontWeight: 800, color: TEXT }}>{team === '미배정' ? '미배정' : `${team}팀`}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: GRAY }}>소계 ₩{numKR(getTeamTotal(teamGroups[team]))}</span>
                    </div>
                    {teamGroups[team].map(eng => {
                      const target = getTarget(eng.engineer_id)
                      const isEditing = editingTarget?.engineerId === eng.engineer_id
                      return (
                        <div key={eng.engineer_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', borderBottom: `1px solid #f3f4f6` }}>
                          <div style={{ width: 120, flexShrink: 0 }}>
                            <span style={{ fontSize: 14, fontWeight: 700, color: TEXT }}>{eng.name}</span>
                            <span style={{ fontSize: 11, color: GRAY, marginLeft: 6 }}>{eng.position}</span>
                          </div>
                          {isEditing ? (
                            <div style={{ flex: 1, display: 'flex', gap: 6 }}>
                              <input type="number" value={editingTarget.amount}
                                onChange={e => setEditingTarget(prev => prev ? { ...prev, amount: e.target.value } : null)}
                                onKeyDown={e => e.key === 'Enter' && handleSaveTarget()}
                                placeholder="금액 입력 (비우면 삭제)" style={{ ...inp, flex: 1 }} autoFocus />
                              <button onClick={handleSaveTarget} disabled={savingTarget}
                                style={{ padding: '6px 14px', background: BLUE, color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer', opacity: savingTarget ? 0.7 : 1 }}>
                                {savingTarget ? '...' : '저장'}
                              </button>
                              <button onClick={() => setEditingTarget(null)}
                                style={{ padding: '6px 10px', background: '#f3f4f6', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>취소</button>
                            </div>
                          ) : (
                            <>
                              <div style={{ flex: 1 }}>
                                {target
                                  ? <div><span style={{ fontSize: 14, fontWeight: 700, color: TEXT }}>₩{numKR(target.target_amount)}</span><span style={{ fontSize: 11, color: GRAY, marginLeft: 8 }}>월 ₩{numKR(Math.round(target.target_amount / 12))}</span></div>
                                  : <span style={{ fontSize: 13, color: '#d1d5db' }}>미설정</span>}
                              </div>
                              <button onClick={() => setEditingTarget({ engineerId: eng.engineer_id, amount: target ? String(target.target_amount) : '' })}
                                style={{ padding: '5px 12px', background: '#f3f4f6', border: `1px solid ${BORDER}`, borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: TEXT, whiteSpace: 'nowrap' }}>
                                {target ? '수정' : '설정'}
                              </button>
                            </>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ))
              )}
            </div>
            <div style={{ marginTop: 12, fontSize: 12, color: GRAY }}>* 금액을 비운 채 저장하면 해당 목표가 삭제됩니다</div>
          </div>
        </div>
      )}

      {/* ── 견적서 삭제 모달 ── */}
      {showQuoteModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: CARD_BG, borderRadius: 18, padding: 24, width: '100%', maxWidth: 1000, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: TEXT }}>🗑️ 견적서 삭제</div>
              <button onClick={() => setShowQuoteModal(false)} style={{ width: 32, height: 32, borderRadius: '50%', background: '#f3f4f6', border: 'none', cursor: 'pointer', fontSize: 16 }}>✕</button>
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && fetchQuotes(searchQuery)}
                placeholder="견적번호 또는 견적 내용으로 검색" style={inp} />
              <button onClick={() => fetchQuotes(searchQuery)}
                style={{ padding: '8px 16px', background: BLUE, color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>검색</button>
            </div>
            <div style={{ overflowY: 'auto', overflowX: 'auto', flex: 1 }}>
              {quoteLoading ? <div style={{ textAlign: 'center', padding: 40, color: GRAY }}>불러오는 중...</div> : quotes.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: GRAY }}>견적서가 없습니다</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 800 }}>
                  <thead style={{ position: 'sticky', top: 0, background: CARD_BG }}>
                    <tr style={{ borderBottom: `2px solid ${BORDER}` }}>
                      {['견적번호', '날짜', '담당자', '고객사', '금액', '상태', '삭제'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: GRAY, fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {quotes.map(q => (
                      <tr key={q.quote_id} style={{ borderBottom: `1px solid ${BORDER}` }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                        onMouseLeave={e => (e.currentTarget.style.background = '')}>
                        <td style={{ padding: '10px 12px', fontWeight: 700, color: BLUE, whiteSpace: 'nowrap' }}>{q.quote_number}</td>
                        <td style={{ padding: '10px 12px', color: GRAY, whiteSpace: 'nowrap' }}>{q.quote_date}</td>
                        <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{q.engineers?.name || '-'}</td>
                        <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{q.customers?.company_name || '-'}</td>
                        <td style={{ padding: '10px 12px', fontWeight: 700, whiteSpace: 'nowrap' }}>₩{numKR(q.total_supply)}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700, background: (STATUS_COLORS[q.status] || GRAY) + '22', color: STATUS_COLORS[q.status] || GRAY }}>{q.status}</span>
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <button onClick={() => handleDeleteQuote(q)} disabled={deleting === q.quote_id}
                            style={{ padding: '4px 12px', background: DANGER, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700, opacity: deleting === q.quote_id ? 0.6 : 1 }}>
                            {deleting === q.quote_id ? '삭제 중...' : '삭제'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div style={{ marginTop: 12, fontSize: 12, color: GRAY }}>* 최근 50건 표시 / 검색으로 더 찾을 수 있습니다</div>
          </div>
        </div>
      )}

      {/* ── 다운로드 로그 모달 ── */}
      {showLogModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: CARD_BG, borderRadius: 18, padding: 24, width: '100%', maxWidth: 1100, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: TEXT }}>📋 다운로드 로그</div>
              <button onClick={() => setShowLogModal(false)} style={{ width: 32, height: 32, borderRadius: '50%', background: '#f3f4f6', border: 'none', cursor: 'pointer', fontSize: 16 }}>✕</button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {logLoading ? <div style={{ textAlign: 'center', padding: 40, color: GRAY }}>불러오는 중...</div> : logs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: GRAY }}>로그가 없습니다</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead style={{ position: 'sticky', top: 0, background: CARD_BG }}>
                    <tr style={{ borderBottom: `2px solid ${BORDER}` }}>
                      {['일시', '담당자', '견적번호', '고객사', '구분'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: GRAY, fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map(log => (
                      <tr key={log.log_id} style={{ borderBottom: `1px solid ${BORDER}` }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                        onMouseLeave={e => (e.currentTarget.style.background = '')}>
                        <td style={{ padding: '10px 12px', color: GRAY, whiteSpace: 'nowrap' }}>
                          {new Date(log.downloaded_at).toLocaleString('ko-KR')}
                        </td>
                        <td style={{ padding: '10px 12px', fontWeight: 700, whiteSpace: 'nowrap' }}>
  {log.engineers?.name || (log.action === 'view' ? '(열람자 미확인)' : '-')}
</td>
                        <td style={{ padding: '10px 12px', color: BLUE, fontWeight: 700, whiteSpace: 'nowrap' }}>{log.quote_number}</td>
                        <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{log.company_name || '-'}</td>
                        <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
  <span style={{
    padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700,
    background: log.action === 'view' ? '#eff6ff' : '#f0fdf4',
    color: log.action === 'view' ? '#234ea2' : '#16a34a',
  }}>
    {log.action === 'view' ? '열람' : '다운로드'}
  </span>
</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div style={{ marginTop: 12, fontSize: 12, color: GRAY }}>* 최근 7일 이내 · 최대 1000건 표시 / 전체 기록은 Supabase에 보관됩니다</div>
          </div>
        </div>
      )}

      {/* ── 직원 관리 모달 ── */}
      {showEngineerModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: CARD_BG, borderRadius: 18, padding: 24, width: '100%', maxWidth: 1000, maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
             <div style={{ fontSize: 18, fontWeight: 800, color: TEXT }}>👥 직원 관리</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setShowAddEngineer(true)}
                  style={{ padding: '7px 16px', background: BLUE, color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>+ 직원 등록</button>
                <button onClick={() => setShowEngineerModal(false)}
                  style={{ width: 32, height: 32, borderRadius: '50%', background: '#f3f4f6', border: 'none', cursor: 'pointer', fontSize: 16 }}>✕</button>
              </div>
            </div>
            <div style={{ overflowY: 'auto', overflowX: 'auto', flex: 1 }}>
              {engineerLoading ? <div style={{ textAlign: 'center', padding: 40, color: GRAY }}>불러오는 중...</div> : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 800 }}>
                  <thead style={{ position: 'sticky', top: 0, background: CARD_BG }}>
                    <tr style={{ borderBottom: `2px solid ${BORDER}` }}>
                      {['이름', '직책', '팀', '이메일', '이니셜', '권한', '수정', '관리'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: GRAY, fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {engineers.map(eng => (
                      <tr key={eng.engineer_id} style={{ borderBottom: `1px solid ${BORDER}`, opacity: eng.resigned_date ? 0.55 : 1 }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                        onMouseLeave={e => (e.currentTarget.style.background = '')}>
                        <td style={{ padding: '10px 12px', fontWeight: 700, whiteSpace: 'nowrap' }}>
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
    {eng.name}
    {eng.resigned_date && (
      <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: '#fef2f2', color: DANGER, whiteSpace: 'nowrap' }}>
        퇴사 {eng.resigned_date}
      </span>
    )}
  </span>
</td>
                        <td style={{ padding: '10px 12px', color: GRAY, whiteSpace: 'nowrap' }}>{eng.position || '-'}</td>
                        <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                          {eng.teams ? getTeamDisplay(eng.teams) : '-'}
                        </td>
                        <td style={{ padding: '10px 12px', color: GRAY, whiteSpace: 'nowrap' }}>{eng.email || '-'}</td>
                        <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{eng.initials || '-'}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {(() => {
                              const level = eng.permission_level || 'member'
                              const badges: { label: string; bg: string; color: string }[] = []
                              if (level === 'superadmin') badges.push({ label: '최고관리자', bg: '#faf5ff', color: PURPLE })
                              else if (level === 'manager') badges.push({ label: '팀장', bg: '#eff6ff', color: BLUE })
                              else badges.push({ label: '팀원', bg: '#f3f4f6', color: GRAY })
                              if (eng.is_inventory_manager) badges.push({ label: '재고관리자', bg: '#f0fdf4', color: GREEN })
                              return badges.map(b => (
                                <span key={b.label} style={{ padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700, background: b.bg, color: b.color, whiteSpace: 'nowrap' }}>
                                  {b.label}
                                </span>
                              ))
                            })()}
                          </div>
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <button onClick={() => { setEditEngineer(eng); setEditForm({ name: eng.name, position: eng.position || '사원', teams: eng.teams || '1', email: eng.email || '', initials: eng.initials || '', permission_level: eng.permission_level || 'member', is_inventory_manager: eng.is_inventory_manager || false }) }}
                            style={{ padding: '4px 12px', background: '#f3f4f6', border: `1px solid ${BORDER}`, borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>수정</button>
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          {eng.resigned_date ? (
                            <button onClick={() => handleRestoreEngineer(eng)}
                              style={{ padding: '4px 12px', background: '#ecfdf5', color: GREEN, border: `1px solid ${GREEN}`, borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>복직</button>
                          ) : (
                            <button onClick={() => { const t = new Date().toISOString().slice(0, 10); setResignDate(t); setDeleteEngineer(eng) }}
                              style={{ padding: '4px 12px', background: DANGER, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>퇴사</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 직원 등록 모달 ── */}
      {showAddEngineer && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: CARD_BG, borderRadius: 18, padding: 28, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: TEXT, marginBottom: 20 }}>직원 등록</div>
            <div style={{ display: 'grid', gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, color: GRAY, marginBottom: 5 }}>이름 *</div>
                <input value={addForm.name} onChange={e => setAddForm(p => ({ ...p, name: e.target.value }))} placeholder="예: 홍길동" style={inp} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 12, color: GRAY, marginBottom: 5 }}>직책 *</div>
                  <select value={addForm.position} onChange={e => setAddForm(p => ({ ...p, position: e.target.value }))} style={inp}>
                    {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: GRAY, marginBottom: 5 }}>팀 *</div>
                  <select value={addForm.teams} onChange={e => setAddForm(p => ({ ...p, teams: e.target.value }))} style={inp}>
                    {teamsOptions.map(t => <option key={t} value={t}>{getTeamDisplay(t)}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: GRAY, marginBottom: 5 }}>이메일 * (로그인 ID)</div>
                <input value={addForm.email} onChange={e => setAddForm(p => ({ ...p, email: e.target.value }))} placeholder="예: hong@accretechkorea.com" style={inp} />
              </div>
              <div>
                <div style={{ fontSize: 12, color: GRAY, marginBottom: 5 }}>초기 비밀번호 *</div>
                <input type="password" value={addForm.password} onChange={e => setAddForm(p => ({ ...p, password: e.target.value }))} placeholder="8자 이상" style={inp} />
              </div>
              <div>
                <div style={{ fontSize: 12, color: GRAY, marginBottom: 5 }}>이니셜 * (견적번호용)</div>
                <input value={addForm.initials} onChange={e => setAddForm(p => ({ ...p, initials: e.target.value }))} placeholder="예: HGD" style={inp} maxLength={5} />
                <div style={{ fontSize: 11, color: GRAY, marginTop: 3 }}>견적번호에 사용됩니다 (예: No.HGD20260511-A)</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
              <button onClick={() => { setShowAddEngineer(false); setAddForm({ name: '', position: '사원', teams: '1', email: '', initials: '', password: '' }) }}
                style={{ flex: 1, padding: '11px', background: '#f3f4f6', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer' }}>취소</button>
              <button onClick={handleAddEngineer} disabled={addLoading}
                style={{ flex: 1, padding: '11px', background: BLUE, color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer', opacity: addLoading ? 0.7 : 1 }}>
                {addLoading ? '등록 중...' : '등록'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 직원 수정 모달 ── */}
      {editEngineer && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: CARD_BG, borderRadius: 18, padding: 28, width: '100%', maxWidth: 640, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: TEXT, marginBottom: 20 }}>직원 정보 수정</div>
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 12, color: GRAY, marginBottom: 5 }}>이름 *</div>
                  <input value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} style={inp} />
                </div>
                <div>
                  <div style={{ fontSize: 12, color: GRAY, marginBottom: 5 }}>직책</div>
                  <select value={editForm.position} onChange={e => setEditForm(p => ({ ...p, position: e.target.value }))} style={inp}>
                    {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: GRAY, marginBottom: 5 }}>팀</div>
                  <select value={editForm.teams} onChange={e => setEditForm(p => ({ ...p, teams: e.target.value }))} style={inp}>
                    {teamsOptions.map(t => <option key={t} value={t}>{getTeamDisplay(t)}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: GRAY, marginBottom: 5 }}>이메일</div>
                <input value={editForm.email} onChange={e => setEditForm(p => ({ ...p, email: e.target.value }))} style={inp} />
              </div>
              {currentEngineer?.permission_level === 'superadmin' && (
                <div>
                  <div style={{ fontSize: 12, color: GRAY, marginBottom: 8, fontWeight: 700 }}>권한</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                    {([
                      { key: 'superadmin', label: '최고관리자', desc: '전체 조회 및 관리자 접근', color: PURPLE, bg: '#faf5ff', border: '#d8b4fe' },
                      { key: 'manager',    label: '팀장',       desc: '본인 팀 전체 실적 조회', color: BLUE,   bg: '#eff6ff', border: '#bfdbfe' },
                    ] as const).map(({ key, label, desc, color, bg, border }) => {
                      const checked = editForm.permission_level === key
                      return (
                        <label key={key} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', padding: '10px 12px', background: checked ? bg : '#f8fafc', borderRadius: 8, border: `1px solid ${checked ? border : BORDER}`, transition: 'all 0.15s' }}>
                          <input type="checkbox" checked={checked}
                            onChange={e => setEditForm(p => ({ ...p, permission_level: e.target.checked ? key : 'member' }))}
                            style={{ width: 15, height: 15, accentColor: color, cursor: 'pointer', marginTop: 2, flexShrink: 0 }} />
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: checked ? color : TEXT }}>{label}</div>
                            <div style={{ fontSize: 11, color: GRAY, marginTop: 2, lineHeight: 1.4 }}>{desc}</div>
                          </div>
                        </label>
                      )
                    })}
                    {(() => {
                      const checked = editForm.is_inventory_manager
                      return (
                        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', padding: '10px 12px', background: checked ? '#f0fdf4' : '#f8fafc', borderRadius: 8, border: `1px solid ${checked ? '#86efac' : BORDER}`, transition: 'all 0.15s' }}>
                          <input type="checkbox" checked={checked}
                            onChange={e => setEditForm(p => ({ ...p, is_inventory_manager: e.target.checked }))}
                            style={{ width: 15, height: 15, accentColor: GREEN, cursor: 'pointer', marginTop: 2, flexShrink: 0 }} />
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: checked ? GREEN : TEXT }}>재고관리자</div>
                            <div style={{ fontSize: 11, color: GRAY, marginTop: 2, lineHeight: 1.4 }}>출고 요청 승인·반려 가능</div>
                          </div>
                        </label>
                      )
                    })()}
                  </div>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
              <button onClick={() => setEditEngineer(null)}
                style={{ flex: 1, padding: '11px', background: '#f3f4f6', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer' }}>취소</button>
              <button onClick={handleUpdateEngineer} disabled={editLoading}
                style={{ flex: 1, padding: '11px', background: BLUE, color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer', opacity: editLoading ? 0.7 : 1 }}>
                {editLoading ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 팀 관리 모달 ── */}
      {showTeamModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: CARD_BG, borderRadius: 18, padding: 24, width: '100%', maxWidth: 480, maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: TEXT }}>🏷️ 팀 관리</div>
              <button onClick={() => setShowTeamModal(false)} style={{ width: 32, height: 32, borderRadius: '50%', background: '#f3f4f6', border: 'none', cursor: 'pointer', fontSize: 16 }}>✕</button>
            </div>

            {/* 팀 추가 폼 */}
            <div style={{ background: '#f8fafc', borderRadius: 12, padding: '14px 16px', marginBottom: 16, border: `1px solid ${BORDER}` }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, marginBottom: 10 }}>새 팀 추가</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <input value={newTeamName} onChange={e => setNewTeamName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddTeam()}
                  placeholder="팀 이름 (예: Apps., 5)" style={{ ...inp, flex: 1 }} />
                <button onClick={handleAddTeam} disabled={addTeamLoading || !newTeamName.trim()}
                  style={{ padding: '8px 18px', background: BLUE, color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap', opacity: (addTeamLoading || !newTeamName.trim()) ? 0.6 : 1 }}>
                  {addTeamLoading ? '...' : '추가'}
                </button>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: GRAY, cursor: 'pointer', userSelect: 'none' }}>
                <input type="checkbox" checked={newTeamIsSpecial} onChange={e => setNewTeamIsSpecial(e.target.checked)} />
                "팀" 접미사 없이 표시 (임원, 영업관리 등 특수 팀에 사용)
              </label>
            </div>

            {/* 팀 목록 */}
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {teamLoading ? (
                <div style={{ textAlign: 'center', padding: 40, color: GRAY }}>불러오는 중...</div>
              ) : teamsList.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: GRAY }}>등록된 팀이 없습니다</div>
              ) : teamsList.map(team => (
                <div key={team.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 4px', borderBottom: `1px solid ${BORDER}` }}>
                  <div>
                    <span style={{ fontWeight: 700, fontSize: 15, color: TEXT }}>{getTeamDisplay(team.name)}</span>
                    {team.is_special && <span style={{ fontSize: 11, color: GRAY, marginLeft: 6 }}>(접미사 없음)</span>}
                  </div>
                  <button onClick={() => handleDeleteTeam(team)} disabled={deletingTeam === team.id}
                    style={{ padding: '4px 14px', background: DANGER, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700, opacity: deletingTeam === team.id ? 0.6 : 1 }}>
                    {deletingTeam === team.id ? '삭제 중...' : '삭제'}
                  </button>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12, fontSize: 11, color: GRAY }}>* 직원이 배정된 팀은 삭제할 수 없습니다</div>
          </div>
        </div>
      )}

      {/* ── 직원 퇴사 처리 모달 ── */}
      {deleteEngineer && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: CARD_BG, borderRadius: 16, padding: 28, width: '100%', maxWidth: 400, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: TEXT, marginBottom: 12 }}>직원 퇴사 처리</div>
            <div style={{ fontSize: 14, color: GRAY, lineHeight: 1.8, marginBottom: 16 }}>
              <b style={{ color: TEXT }}>{deleteEngineer.name}</b> ({deleteEngineer.position}) 을 퇴사 처리하시겠습니까?<br />
              <span style={{ fontSize: 12, color: GRAY }}>· 과거 서비스·견적·실적 기록은 그대로 보존됩니다.<br />
              · 퇴사일 이후 기간의 활동/실적 목록과 담당자 선택에서 제외됩니다.<br />
              · 로그인 계정은 삭제되어 더 이상 로그인할 수 없습니다.</span>
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 13, fontWeight: 700, color: TEXT, display: 'block', marginBottom: 6 }}>퇴사일</label>
              <input type="date" value={resignDate} onChange={e => setResignDate(e.target.value)}
                style={{ ...inp, width: '100%', colorScheme: 'light' }} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setDeleteEngineer(null)}
                style={{ flex: 1, padding: '11px', background: '#f3f4f6', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer' }}>취소</button>
              <button onClick={handleDeleteEngineer} disabled={deleteLoading}
                style={{ flex: 1, padding: '11px', background: DANGER, color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer', opacity: deleteLoading ? 0.7 : 1 }}>
                {deleteLoading ? '처리 중...' : '퇴사 처리'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
