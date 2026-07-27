'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// ── 색상 (기존 페이지 컨벤션과 동일) ──
const BLUE = '#234ea2'
const GREEN = '#15803d'
const ORANGE = '#d97706'
const RED = '#dc2626'
const PAGE_BG = '#f4f5f7'
const CARD_BG = '#ffffff'
const BORDER = '#e2e4e9'
const TEXT = '#111113'
const GRAY = '#6b7280'
const MUTED = '#9ca3af'

const ITEM_TYPES = ['게이지', '앰프'] as const
type ItemType = (typeof ITEM_TYPES)[number]

type RepairStatus = '수리중' | '출고대기' | '출고완료'
const STATUSES: RepairStatus[] = ['수리중', '출고대기', '출고완료']

const STATUS_STYLE: Record<RepairStatus, { bg: string; color: string; border: string }> = {
  '수리중': { bg: '#fffbeb', color: ORANGE, border: '#fde68a' },
  '출고대기': { bg: '#eff4ff', color: BLUE, border: '#bfd3f2' },
  '출고완료': { bg: '#f0fdf4', color: GREEN, border: '#bbf7d0' },
}

type Repair = {
  repair_id: number
  received_date: string
  customer_name: string | null
  item_type: string
  quantity: number
  repair_content: string | null
  expected_done_date: string | null
  status: RepairStatus
  shipped_date: string | null
  created_by: number | null
  created_at: string
}

type Engineer = {
  engineer_id: number
  name: string
  teams: string | null
  permission_level: string | null
}

// ── 날짜 유틸 ──
const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const monthKey = (dateStr: string | null) => (dateStr ? dateStr.slice(0, 7) : '') // YYYY-MM
const fmtMonthLabel = (ym: string) => `${Number(ym.slice(5, 7))}월`
const shiftMonth = (ym: string, delta: number) => {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function RepairPage() {
  const supabase = createClient()
  const router = useRouter()

  const [currentEngineer, setCurrentEngineer] = useState<Engineer | null>(null)
  const [authorized, setAuthorized] = useState<boolean | null>(null) // null=확인중
  const [repairs, setRepairs] = useState<Repair[]>([])
  const [loading, setLoading] = useState(true)

  // ── 접수 등록 폼 ──
  const [receivedDate, setReceivedDate] = useState(todayStr())
  const [customerName, setCustomerName] = useState('')
  const [itemType, setItemType] = useState<ItemType>('게이지')
  const [quantity, setQuantity] = useState(1)
  const [repairContent, setRepairContent] = useState('')
  const [expectedDate, setExpectedDate] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  // ── 목록 필터 ──
  const [statusFilter, setStatusFilter] = useState<'전체' | RepairStatus>('전체')

  // ── KPI '출고완료' 카드 + 그래프 기준 월 ──
  const [viewMonth, setViewMonth] = useState(monthKey(todayStr()))

  // ── 인증 & 데이터 로드 ──
  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.auth.getUser()
      if (!data.user?.email) { router.replace('/'); return }

      const { data: eng } = await supabase
        .from('engineers')
        .select('engineer_id, name, teams, permission_level')
        .eq('email', data.user.email)
        .single()

      const ok = !!eng && (
        eng.permission_level === 'superadmin' ||
        eng.permission_level === 'manager' ||
        eng.teams === '20'
      )
      if (!ok) { setAuthorized(false); return }

      setCurrentEngineer(eng as Engineer)
      setAuthorized(true)
      await fetchRepairs()
    }
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchRepairs = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('repairs')
      .select('*')
      .order('received_date', { ascending: false })
      .order('repair_id', { ascending: false })
    setRepairs((data as Repair[]) ?? [])
    setLoading(false)
  }

  // ── 접수 등록 ──
  const handleSubmit = async () => {
    if (!currentEngineer) return
    if (!customerName.trim()) { alert('고객사를 입력해주세요.'); return }
    if (quantity < 1) { alert('수량은 1개 이상이어야 합니다.'); return }
    setIsSaving(true)
    const { error } = await supabase.from('repairs').insert({
      received_date: receivedDate,
      customer_name: customerName.trim(),
      item_type: itemType,
      quantity,
      repair_content: repairContent.trim() || null,
      expected_done_date: expectedDate || null,
      status: '수리중',
      created_by: currentEngineer.engineer_id,
    })
    setIsSaving(false)
    if (error) { alert('등록 중 오류가 발생했습니다: ' + error.message); return }
    // 폼 초기화
    setCustomerName('')
    setItemType('게이지')
    setQuantity(1)
    setRepairContent('')
    setExpectedDate('')
    setReceivedDate(todayStr())
    await fetchRepairs()
  }

  // ── 상태 변경 ──
  const handleStatusChange = async (r: Repair, next: RepairStatus) => {
    if (next === r.status) return
    const patch: Partial<Repair> = { status: next }
    // 출고완료로 바뀌면 출고일 기록, 그 외 상태면 출고일 해제
    patch.shipped_date = next === '출고완료' ? todayStr() : null
    const { error } = await supabase.from('repairs').update(patch).eq('repair_id', r.repair_id)
    if (error) { alert('상태 변경 실패: ' + error.message); return }
    await fetchRepairs()
  }

  const handleDelete = async (r: Repair) => {
    if (!confirm(`'${r.customer_name ?? ''} / ${r.item_type} ${r.quantity}개' 접수 건을 삭제하시겠습니까?`)) return
    const { error } = await supabase.from('repairs').delete().eq('repair_id', r.repair_id)
    if (error) { alert('삭제 실패: ' + error.message); return }
    await fetchRepairs()
  }

  // ── KPI (수량 합계 기준) ──
  const sumQty = (pred: (r: Repair) => boolean) =>
    repairs.filter(pred).reduce((s, r) => s + (r.quantity || 0), 0)

  const kpiHeld = sumQty(r => r.status === '수리중' || r.status === '출고대기') // 보유 수리품
  const kpiRepairing = sumQty(r => r.status === '수리중')
  const kpiWaiting = sumQty(r => r.status === '출고대기')
  const kpiShippedThisMonth = sumQty(r => r.status === '출고완료' && monthKey(r.shipped_date) === viewMonth)

  // ── 목록 필터 ──
  const filteredRepairs = useMemo(
    () => (statusFilter === '전체' ? repairs : repairs.filter(r => r.status === statusFilter)),
    [repairs, statusFilter]
  )

  // ── 월별 집계 (건수 기준, 최근 6개월) ──
  const monthlyStats = useMemo(() => {
    const months: string[] = []
    for (let i = 5; i >= 0; i--) months.push(shiftMonth(viewMonth, -i))
    return months.map(ym => ({
      ym,
      label: fmtMonthLabel(ym),
      received: repairs.filter(r => monthKey(r.received_date) === ym).length,
      shipped: repairs.filter(r => r.status === '출고완료' && monthKey(r.shipped_date) === ym).length,
    }))
  }, [repairs, viewMonth])

  const maxMonthly = Math.max(1, ...monthlyStats.map(m => Math.max(m.received, m.shipped)))

  // ── 렌더 게이트 ──
  if (authorized === null) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh', fontSize: 16, color: GRAY }}>확인 중...</div>
  }
  if (authorized === false) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, justifyContent: 'center', alignItems: 'center', height: '60vh', color: GRAY }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: TEXT }}>접근 권한이 없습니다</div>
        <div style={{ fontSize: 14 }}>이 페이지는 20팀 담당자와 관리자만 열람할 수 있습니다.</div>
        <button onClick={() => router.push('/')} style={{ marginTop: 8, padding: '8px 18px', border: 'none', borderRadius: 8, background: BLUE, color: '#fff', fontWeight: 700, cursor: 'pointer' }}>홈으로</button>
      </div>
    )
  }

  const card: React.CSSProperties = { background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 18 }
  const inp: React.CSSProperties = { width: '100%', padding: '9px 11px', border: `1px solid ${BORDER}`, borderRadius: 9, fontSize: 14, outline: 'none', background: '#fff', color: TEXT, boxSizing: 'border-box' }
  const label: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: GRAY, marginBottom: 6, display: 'block' }

  return (
    <div style={{ background: PAGE_BG, minHeight: 'calc(100vh - 44px)', padding: 20, boxSizing: 'border-box' }}>
      <style jsx global>{`
        select { appearance: none; -webkit-appearance: none; -moz-appearance: none; }
      `}</style>

      <div style={{ maxWidth: 1080, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── KPI 카드 ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }} className="repair-kpi">
          <KpiCard title="보유 수리품" value={kpiHeld} unit="개" color={BLUE} sub="수리중 + 출고대기" />
          <KpiCard title="수리중" value={kpiRepairing} unit="개" color={BLUE} />
          <KpiCard title="출고 대기" value={kpiWaiting} unit="개" color={BLUE} sub="수리 완료" />
          <div style={{ ...card, padding: 16, position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: GRAY }}>{fmtMonthLabel(viewMonth)} 출고완료</span>
              <span style={{ display: 'flex', gap: 4 }}>
                <MonthBtn onClick={() => setViewMonth(m => shiftMonth(m, -1))}>◀</MonthBtn>
                <MonthBtn onClick={() => setViewMonth(m => shiftMonth(m, 1))}>▶</MonthBtn>
              </span>
            </div>
            <div style={{ fontSize: 28, fontWeight: 900, color: BLUE, lineHeight: 1 }}>
              {kpiShippedThisMonth}<span style={{ fontSize: 14, fontWeight: 700, color: MUTED, marginLeft: 3 }}>개</span>
            </div>
          </div>
        </div>

        {/* ── 새 수리품 접수 등록 ── */}
        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: 800, color: TEXT, marginBottom: 14 }}>새 수리품 접수 등록</div>

          {/* 1줄: 접수일 · 고객사 · 품목 · 수량 · 완료예정일 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr 1fr 1fr 1fr', gap: 12, marginBottom: 12 }} className="repair-form-row">
            <div>
              <label style={label}>접수일</label>
              <input type="date" value={receivedDate} onChange={e => setReceivedDate(e.target.value)} style={inp} />
            </div>
            <div>
              <label style={label}>고객사</label>
              <input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="고객사명 입력" style={inp} />
            </div>
            <div>
              <label style={label}>품목</label>
              <div style={{ position: 'relative' }}>
                <select value={itemType} onChange={e => setItemType(e.target.value as ItemType)} style={{ ...inp, paddingRight: 30, cursor: 'pointer' }}>
                  {ITEM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <span style={{ position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: GRAY, fontSize: 10 }}>▼</span>
              </div>
            </div>
            <div>
              <label style={label}>수량</label>
              <QtyStepper value={quantity} onChange={setQuantity} />
            </div>
            <div>
              <label style={label}>수리 완료 예정일</label>
              <input type="date" value={expectedDate} onChange={e => setExpectedDate(e.target.value)} style={inp} />
            </div>
          </div>

          {/* 2줄: 수리내용 · 접수등록 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 12, alignItems: 'flex-end' }} className="repair-form-row">
            <div>
              <label style={label}>수리 내용</label>
              <input value={repairContent} onChange={e => setRepairContent(e.target.value)} placeholder="수리 내용을 입력하세요" style={inp} />
            </div>
            <div>
              <button onClick={handleSubmit} disabled={isSaving}
                style={{ width: '100%', padding: '9px 0', border: 'none', borderRadius: 9, background: isSaving ? MUTED : BLUE, color: '#fff', fontSize: 14.5, fontWeight: 800, cursor: isSaving ? 'default' : 'pointer' }}>
                {isSaving ? '등록 중...' : '접수 등록'}
              </button>
            </div>
          </div>
        </div>

        {/* ── 수리품 목록 ── */}
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: TEXT }}>수리품 목록 <span style={{ color: MUTED, fontWeight: 700 }}>({filteredRepairs.length})</span></div>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['전체', ...STATUSES] as const).map(s => {
                const active = statusFilter === s
                return (
                  <button key={s} onClick={() => setStatusFilter(s)}
                    style={{
                      padding: '6px 13px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                      border: `1px solid ${active ? BLUE : BORDER}`,
                      background: active ? BLUE : '#fff',
                      color: active ? '#fff' : GRAY,
                    }}>
                    {s}
                  </button>
                )
              })}
            </div>
          </div>

          {loading ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: MUTED, fontSize: 14 }}>불러오는 중...</div>
          ) : filteredRepairs.length === 0 ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: MUTED, fontSize: 14 }}>접수된 수리품이 없습니다.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5, minWidth: 760 }}>
                <thead>
                  <tr style={{ borderBottom: `1.5px solid ${BORDER}`, color: GRAY, fontSize: 12.5 }}>
                    <th style={th}>접수일</th>
                    <th style={th}>고객사</th>
                    <th style={th}>품목</th>
                    <th style={{ ...th, textAlign: 'center' }}>수량</th>
                    <th style={th}>수리 내용</th>
                    <th style={{ ...th, textAlign: 'center' }}>완료 예정</th>
                    <th style={{ ...th, textAlign: 'center' }}>출고일</th>
                    <th style={{ ...th, textAlign: 'center' }}>상태</th>
                    <th style={{ ...th, textAlign: 'center' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRepairs.map(r => (
                    <tr key={r.repair_id} style={{ borderBottom: `1px solid #f0f1f4` }}>
                      <td style={td}>{r.received_date}</td>
                      <td style={{ ...td, fontWeight: 700, color: TEXT }}>{r.customer_name}</td>
                      <td style={td}>{r.item_type}</td>
                      <td style={{ ...td, textAlign: 'center', fontWeight: 700 }}>{r.quantity}</td>
                      <td style={{ ...td, maxWidth: 240, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: GRAY }} title={r.repair_content ?? ''}>{r.repair_content || '-'}</td>
                      <td style={{ ...td, textAlign: 'center', color: GRAY }}>{r.expected_done_date || '-'}</td>
                      <td style={{ ...td, textAlign: 'center', color: GRAY }}>{r.shipped_date || '-'}</td>
                      <td style={{ ...td, textAlign: 'center' }}>
                        <div style={{ position: 'relative', display: 'inline-block' }}>
                          <select
                            value={r.status}
                            onChange={e => handleStatusChange(r, e.target.value as RepairStatus)}
                            style={{
                              appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none',
                              padding: '4px 22px 4px 10px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                              background: STATUS_STYLE[r.status].bg, color: STATUS_STYLE[r.status].color,
                              border: `1px solid ${STATUS_STYLE[r.status].border}`,
                            }}>
                            {STATUSES.map(s => <option key={s} value={s} style={{ background: '#fff', color: TEXT }}>{s}</option>)}
                          </select>
                          <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', fontSize: 8, color: STATUS_STYLE[r.status].color }}>▼</span>
                        </div>
                      </td>
                      <td style={{ ...td, textAlign: 'center' }}>
                        <button onClick={() => handleDelete(r)} title="삭제"
                          style={{ border: 'none', background: 'none', cursor: 'pointer', color: MUTED, fontSize: 15, lineHeight: 1 }}>🗑</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── 월별 접수/출고 그래프 (건수) ── */}
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: TEXT }}>월별 접수 / 출고 현황 <span style={{ color: MUTED, fontWeight: 700, fontSize: 13 }}>(건수, 최근 6개월)</span></div>
            <div style={{ display: 'flex', gap: 16 }}>
              <Legend color={BLUE} label="접수" />
              <Legend color={GREEN} label="출고" />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 0, height: 200, paddingTop: 10 }}>
            {monthlyStats.map(m => (
              <div key={m.ym} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, height: '100%' }}>
                <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 6, width: '100%' }}>
                  <Bar value={m.received} max={maxMonthly} color={BLUE} />
                  <Bar value={m.shipped} max={maxMonthly} color={GREEN} />
                </div>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: GRAY }}>{m.label}</div>
              </div>
            ))}
          </div>
        </div>

      </div>

      <style>{`
        @media (max-width: 768px) {
          .repair-kpi { grid-template-columns: 1fr 1fr !important; }
          .repair-form-row { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  )
}

const th: React.CSSProperties = { textAlign: 'left', padding: '9px 10px', fontWeight: 700, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '10px', color: TEXT, verticalAlign: 'middle' }

// ── 서브 컴포넌트 ──
function KpiCard({ title, value, unit, color, sub }: { title: string; value: number; unit: string; color: string; sub?: string }) {
  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: GRAY, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 28, fontWeight: 900, color, lineHeight: 1 }}>
        {value}<span style={{ fontSize: 14, fontWeight: 700, color: MUTED, marginLeft: 3 }}>{unit}</span>
      </div>
      {sub && <div style={{ fontSize: 11.5, color: MUTED, marginTop: 6, fontWeight: 600 }}>{sub}</div>}
    </div>
  )
}

function MonthBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick}
      style={{ width: 22, height: 22, borderRadius: 6, border: `1px solid ${BORDER}`, background: '#fff', color: GRAY, cursor: 'pointer', fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
      {children}
    </button>
  )
}

function QtyStepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const btn: React.CSSProperties = {
    width: 40, height: 40, flexShrink: 0, border: `1px solid ${BORDER}`, background: '#f8f9fb',
    color: BLUE, fontSize: 16, fontWeight: 900, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <button type="button" onClick={() => onChange(Math.max(1, value - 1))} style={{ ...btn, borderRadius: '9px 0 0 9px' }}>▼</button>
      <input
        type="number" min={1} value={value}
        onChange={e => onChange(Math.max(1, Number(e.target.value) || 1))}
        style={{ width: '100%', height: 40, textAlign: 'center', border: `1px solid ${BORDER}`, borderLeft: 'none', borderRight: 'none', fontSize: 15, fontWeight: 800, color: TEXT, outline: 'none', boxSizing: 'border-box', appearance: 'textfield', MozAppearance: 'textfield' }}
      />
      <button type="button" onClick={() => onChange(value + 1)} style={{ ...btn, borderRadius: '0 9px 9px 0' }}>▲</button>
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: GRAY }}>
      <span style={{ width: 12, height: 12, borderRadius: 3, background: color, display: 'inline-block' }} />
      {label}
    </span>
  )
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const h = value === 0 ? 0 : Math.max(4, Math.round((value / max) * 100))
  return (
    <div style={{ flex: 1, maxWidth: 34, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: value === 0 ? MUTED : TEXT, marginBottom: 4 }}>{value}</div>
      <div style={{ width: '100%', height: `${h}%`, background: color, borderRadius: '5px 5px 0 0', minHeight: value === 0 ? 0 : 4, transition: 'height 0.2s' }} />
    </div>
  )
}
