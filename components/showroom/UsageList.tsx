'use client'

// 사용 기록 표 — 전체기록 탭. 한 줄 한 건이고, 행을 누르면 그 아래로 상세가 펼쳐진다(아코디언, 한 번에 한 건).
//   열: 날짜 · 목적 · 장비 · 대상 고객사 · 시간 · 참여 엔지니어 · 승인 · 결과 · (액션)
//   승인 — 데모 신청으로 만든 기록의 승인자(사후 신청이면 이름 뒤에 「확인」, 확인 전이면 「확인 대기」). 신청이 아니면 「-」.
//   상세: 프로젝트명 · 상세 내용 · 사용결과 · 문제/이상발생 · 후속조치 · 견적 연결 · 비고 — 값이 있는 것만
//         맨 아래 줄: 작성자 · 승인자와 승인일시 · [승인서 보기]
//
// 표 머리는 화면을 내려도 붙어 있다(sticky). 전역 헤더(components/home/Header.tsx — sticky, minHeight 44)
// 바로 아래에 붙인다. 가로 스크롤 상자를 두면 sticky 가 그 상자 기준이 되어 버려서 두지 않는다 —
// 대신 좁은 화면에서는 열을 줄인다(1023px 이하 참여 엔지니어·승인, 767px 이하 목적·시간·결과까지 뺀다).
// 액션은 행 hover·초점 때만 보인다(자리는 늘 잡아 둔다). 복사는 누구나, 수정·삭제는 권한 있는 행만.
// 삭제는 두 번 눌러야 실행된다(요청함과 같은 방식).

// 모바일 상단 바 높이 — 표 머리가 붙는 위치를 이 상수 하나로 맞춘다.
import { TOPBAR_HEIGHT } from '@/components/layout/Sidebar'
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react'
import { getCategoryColor } from '@/lib/categoryColors'
import { Z } from '@/lib/zIndex'
import { normTime } from '@/lib/workHours'
import { USAGE_PURPOSE_COLORS, type ShowroomUsageRow } from '@/lib/showroom'
import {
  TEXT, MUTED, SUB, DANGER, FAINT, BLUE, BORDER, CARD_BG, NEUTRAL_BG, ROW_HOVER_BG, skeletonBlock, countBadge,
} from '@/components/common/ui'
import { openApprovalPdf } from './openApprovalPdf'

/** 삭제는 두 번 눌러야 실행된다. 첫 클릭 뒤 이 시간이 지나면 원래대로 돌아간다(요청함과 같은 방식). */
const CONFIRM_MS = 3000
// 표 머리가 붙는 높이는 CSS(.sr-ut-head)가 정한다 — PC 는 상단 바가 없어 0, 모바일만 상단 바만큼 내린다.

const TABLE_CSS = `
  .sr-ut-head { position: sticky; top: 0; }
  @media (max-width: 768px) { .sr-ut-head { top: ${TOPBAR_HEIGHT}px; } }
  .sr-ut-row {
    display: grid; align-items: center; column-gap: 10px; padding: 0 12px;
    grid-template-columns: 92px 124px minmax(0, 1.4fr) minmax(0, 1.2fr) 148px minmax(0, 1fr) 88px 104px 76px;
  }
  .sr-ut-body { min-height: 40px; border-top: 1px solid ${BORDER}; cursor: pointer; transition: background 0.15s ease; }
  .sr-ut-body:hover, .sr-ut-body:focus-visible, .sr-ut-body[aria-expanded="true"] { background: ${ROW_HOVER_BG}; outline: none; }
  .sr-ut-act { visibility: hidden; }
  .sr-ut-body:hover .sr-ut-act, .sr-ut-body:focus-within .sr-ut-act, .sr-ut-act[data-keep="1"] { visibility: visible; }
  @media (max-width: 1023px) {
    .sr-ut-row { grid-template-columns: 92px 124px minmax(0, 1.4fr) minmax(0, 1.2fr) 148px 104px 76px; }
    /* !important — 몸통 칸은 안쪽 배치용 인라인 display(flex 등)가 있어 그냥 두면 이 규칙을 이긴다(머리만 숨고 칸이 밀린다). */
    .sr-ut-eng, .sr-ut-appr { display: none !important; }
  }
  @media (max-width: 767px) {
    .sr-ut-row { grid-template-columns: 84px minmax(0, 1fr) minmax(0, 1fr) 76px; }
    .sr-ut-purpose, .sr-ut-time, .sr-ut-eng, .sr-ut-appr, .sr-ut-result { display: none !important; }
  }
`

const ellipsis: CSSProperties = { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
/** 'YYYY-MM-DD HH:MM' (KST) — 승인일시. */
const fmtKst = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul', hour12: false }).slice(0, 16) : '-'
const headCell: CSSProperties = { fontSize: 11, fontWeight: 700, color: SUB, ...ellipsis }
const iconBtn = (color: string): CSSProperties => ({
  background: 'none', border: 'none', padding: 2, cursor: 'pointer', color, display: 'inline-flex', alignItems: 'center',
})

type Props = {
  /** 이 쪽에 그릴 행(이미 걸러지고 정렬된 것) */
  rows: ShowroomUsageRow[]
  deviceName: (id: number) => string
  usageEngineers: Record<number, number[]>
  engineerName: (id: number | null) => string
  loading: boolean
  /** 걸러진 결과가 없을 때 문구 */
  emptyText: string
  canEdit: (row: ShowroomUsageRow) => boolean
  onEdit: (row: ShowroomUsageRow) => void
  /** 이 행을 바탕으로 새 기록을 연다. 권한과 무관하다(자기 이름으로 새로 쓰는 것이다). */
  onCopy: (row: ShowroomUsageRow) => void
  onDelete: (row: ShowroomUsageRow) => Promise<string | null>
}

/** 상세(아코디언) — 값이 있는 항목만. 데모 신청으로 만든 기록이면 맨 아래에 승인자·승인일시와 [승인서 보기]. */
function Detail({ row, author, approval, onOpenPdf }: {
  row: ShowroomUsageRow
  author: string
  /** 「승인 홍길동 · 2026-09-15 14:30」 — 신청이 아니거나 아직 확인 전이면 null */
  approval: string | null
  onOpenPdf: () => void
}) {
  const items: { label: string; value: string; accent?: boolean }[] = [
    { label: '프로젝트명', value: row.project_name ?? '' },
    { label: '상세 내용', value: row.content ?? '' },
    { label: '사용결과', value: row.result ?? '' },
    { label: '문제 / 이상발생', value: row.issue ?? '' },
    { label: '후속조치', value: row.follow_up ?? '' },
    { label: '견적 연결', value: row.quote_id != null ? (row.quotes?.quote_number ?? '견적 연결됨') : '', accent: true },
    { label: '비고', value: row.note ?? '' },
  ].filter(i => i.value.trim() !== '')
  return (
    <div style={{ padding: '10px 12px 14px 114px', background: ROW_HOVER_BG, borderTop: `1px dashed ${BORDER}` }}>
      {items.length === 0 ? (
        <div style={{ fontSize: 12, color: MUTED }}>적힌 상세 내용이 없습니다</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '96px minmax(0, 1fr)', rowGap: 6, columnGap: 12 }}>
          {items.map(i => (
            <div key={i.label} style={{ display: 'contents' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: MUTED }}>{i.label}</span>
              <span style={{ fontSize: 13, color: i.accent ? BLUE : TEXT, fontWeight: i.accent ? 700 : 400, whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5 }}>
                {i.value}
              </span>
            </div>
          ))}
        </div>
      )}
      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 11, color: MUTED }}>작성 {author || '-'}</span>
        {approval && <span style={{ fontSize: 11, color: MUTED }}>{approval}</span>}
        {row.request_id != null && (
          <button type="button" onClick={onOpenPdf}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, fontWeight: 700, color: BLUE, fontFamily: 'inherit' }}>
            승인서 보기
          </button>
        )}
      </div>
    </div>
  )
}

export default function UsageList({
  rows, deviceName, usageEngineers, engineerName, loading, emptyText, canEdit, onEdit, onCopy, onDelete,
}: Props) {
  const [openId, setOpenId] = useState<number | null>(null)
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [rowError, setRowError] = useState<Record<number, string>>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearConfirm = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    setConfirmId(null)
  }

  // 다른 곳을 클릭하면 확정 대기를 푼다. 버튼 자신의 클릭은 다음 틱부터 듣게 해 빠뜨리지 않는다.
  useEffect(() => {
    if (confirmId == null) return
    const off = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } setConfirmId(null) }
    const id = setTimeout(() => document.addEventListener('click', off), 0)
    return () => { clearTimeout(id); document.removeEventListener('click', off) }
  }, [confirmId])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const handleDelete = async (row: ShowroomUsageRow) => {
    setBusyId(row.usage_id)
    setRowError(prev => ({ ...prev, [row.usage_id]: '' }))
    const message = await onDelete(row)
    setBusyId(null)
    clearConfirm()
    if (message) setRowError(prev => ({ ...prev, [row.usage_id]: message }))
  }

  /** 승인서 열기 — 요청함·「내 신청」과 같은 경로(openApprovalPdf → /api/showroom/requests/pdf). 실패는 그 행 아래에. */
  const openPdf = async (row: ShowroomUsageRow) => {
    if (row.request_id == null) return
    setRowError(prev => ({ ...prev, [row.usage_id]: '' }))
    const message = await openApprovalPdf(row.request_id)
    if (message) setRowError(prev => ({ ...prev, [row.usage_id]: message }))
  }

  const toggle = (id: number) => setOpenId(cur => (cur === id ? null : id))
  /** 액션 버튼 클릭이 행 펼치기로 번지지 않게 한다. */
  const stop = (e: MouseEvent) => e.stopPropagation()

  return (
    <div>
      <style>{TABLE_CSS}</style>

      {/* 표 머리 — PC 는 화면 맨 위, 모바일은 상단 바 아래에 붙는다(.sr-ut-head) */}
      <div className="sr-ut-row sr-ut-head" style={{
        zIndex: Z.thead,
        height: 32, background: NEUTRAL_BG, borderRadius: 6,
      }}>
        <span style={headCell}>날짜</span>
        <span className="sr-ut-purpose" style={headCell}>목적</span>
        <span style={headCell}>장비</span>
        <span style={headCell}>대상 고객사</span>
        <span className="sr-ut-time" style={headCell}>시간</span>
        <span className="sr-ut-eng" style={headCell}>참여 엔지니어</span>
        <span className="sr-ut-appr" style={headCell}>승인</span>
        <span className="sr-ut-result" style={headCell}>결과</span>
        <span />
      </div>

      {loading ? (
        [0, 1, 2, 3, 4].map(i => (
          <div key={i} className="sr-ut-row" style={{ minHeight: 40, borderTop: i === 0 ? 'none' : `1px solid ${BORDER}` }}>
            {[70, 60, 120, 90, 110, 80, 56, 50].map((w, j) => <div key={j} style={skeletonBlock(w, 12)} />)}
            <span />
          </div>
        ))
      ) : rows.length === 0 ? (
        <div style={{ padding: '28px 0', textAlign: 'center', fontSize: 14, fontWeight: 600, color: SUB }}>{emptyText}</div>
      ) : (
        rows.map(r => {
          const color = getCategoryColor(USAGE_PURPOSE_COLORS, r.purpose)
          const editable = canEdit(r)
          const armed = confirmId === r.usage_id
          const busy = busyId === r.usage_id
          const open = openId === r.usage_id
          const names = (usageEngineers[r.usage_id] ?? []).map(id => engineerName(id)).filter(Boolean).join(', ')
          const err = rowError[r.usage_id]
          // 승인 — 신청으로 만든 기록만. 사후 신청은 「확인」(확인 전이면 승인자가 비어 「확인 대기」).
          const ar = r.approval_requests
          const retro = ar?.retro === true
          const approver = ar?.approver_id != null ? engineerName(ar.approver_id) || '-' : null
          const approval = approver && ar ? `${retro ? '확인' : '승인'} ${approver} · ${fmtKst(ar.decided_at)}` : null
          const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
            if (e.target !== e.currentTarget) return
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(r.usage_id) }
          }
          return (
            <div key={r.usage_id}>
              <div className="sr-ut-row sr-ut-body" role="button" tabIndex={0} aria-expanded={open}
                onClick={() => toggle(r.usage_id)} onKeyDown={onKey}>
                <span className="num" style={{ fontSize: 13, color: TEXT, ...ellipsis }}>{r.usage_date}</span>
                <span className="sr-ut-purpose" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: color.dot ?? color.text, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 500, color: TEXT, ...ellipsis }}>{r.purpose}</span>
                  {/* 데모 신청(승인·확인)을 거쳐 만들어진 기록 */}
                  {r.request_id != null && (
                    <span title="데모 신청으로 만든 기록" style={{ ...countBadge, padding: '1px 6px' }}>신청</span>
                  )}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: TEXT, ...ellipsis }} title={deviceName(r.device_id)}>
                  {deviceName(r.device_id)}
                </span>
                <span style={{ fontSize: 13, color: r.customers?.company_name ? SUB : FAINT, ...ellipsis }} title={r.customers?.company_name ?? undefined}>
                  {r.customers?.company_name ?? '-'}
                </span>
                <span className="sr-ut-time num" style={{ fontSize: 12, color: SUB, ...ellipsis }}>
                  {normTime(r.start_time)}~{normTime(r.end_time)} ({r.work_hours}h)
                </span>
                <span className="sr-ut-eng" style={{ fontSize: 12, color: names ? SUB : FAINT, ...ellipsis }} title={names || undefined}>
                  {names || '-'}
                </span>
                <span className="sr-ut-appr" style={{ display: 'flex', alignItems: 'baseline', gap: 4, minWidth: 0 }}>
                  {r.request_id == null ? (
                    <span style={{ fontSize: 12, color: MUTED }}>-</span>
                  ) : approver ? (
                    <>
                      <span style={{ fontSize: 12, color: SUB, ...ellipsis }} title={approval ?? undefined}>{approver}</span>
                      {retro && <span style={{ fontSize: 11, color: MUTED, flexShrink: 0 }}>확인</span>}
                    </>
                  ) : (
                    <span style={{ fontSize: 11, color: MUTED, ...ellipsis }}>{retro ? '확인 대기' : '-'}</span>
                  )}
                </span>
                <span className="sr-ut-result" style={{ minWidth: 0, display: 'flex' }}>
                  {r.result_category ? (
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 99, background: NEUTRAL_BG, color: SUB, ...ellipsis }}>
                      {r.result_category}
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, color: FAINT }}>미입력</span>
                  )}
                </span>
                {/* 액션 — hover·초점 때만 보인다(삭제 확정 대기·처리 중에는 계속 보인다) */}
                <span className="sr-ut-act" data-keep={armed || busy ? '1' : '0'} onClick={stop}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                  <button title="복사" disabled={busy} onClick={() => { clearConfirm(); onCopy(r) }}
                    style={iconBtn(MUTED)}
                    onMouseEnter={e => (e.currentTarget.style.color = BLUE)}
                    onMouseLeave={e => (e.currentTarget.style.color = MUTED)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  </button>
                  {editable && (<>
                    <button title="수정" disabled={busy} onClick={() => { clearConfirm(); onEdit(r) }}
                      style={iconBtn(MUTED)}
                      onMouseEnter={e => (e.currentTarget.style.color = BLUE)}
                      onMouseLeave={e => (e.currentTarget.style.color = MUTED)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                    {armed ? (
                      <button disabled={busy} onClick={() => handleDelete(r)}
                        style={{ padding: '3px 9px', borderRadius: 6, border: 'none', background: DANGER, color: CARD_BG, fontSize: 11, fontWeight: 700, cursor: busy ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
                        {busy ? '삭제 중' : '확정'}
                      </button>
                    ) : (
                      <button title="삭제" disabled={busy}
                        onClick={() => {
                          if (timer.current) clearTimeout(timer.current)
                          setConfirmId(r.usage_id)
                          timer.current = setTimeout(() => { timer.current = null; setConfirmId(null) }, CONFIRM_MS)
                        }}
                        style={iconBtn(MUTED)}
                        onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                        onMouseLeave={e => (e.currentTarget.style.color = MUTED)}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    )}
                  </>)}
                </span>
              </div>
              {err && <div style={{ padding: '0 12px 8px', fontSize: 12, fontWeight: 600, color: DANGER }}>{err}</div>}
              {open && <Detail row={r} author={engineerName(r.created_by)} approval={approval} onOpenPdf={() => openPdf(r)} />}
            </div>
          )
        })
      )}
    </div>
  )
}
