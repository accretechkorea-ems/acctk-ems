'use client'

/**
 * **기록 추가** — 회사 화면에서 영업 활동·포캐스트·홀딩을 한 창에서 적는다.
 *
 * 왜 하나로 모았나: 전에는 활동 이력 머리줄에 「+ 영업 기록」이 있고, 포캐스트는
 * 요약 카드에서, 홀딩은 장비 카드에서 각각 다른 창으로 열렸다. 적는 자리를 매번 찾아야
 * 했다. 이제 「+ 기록」 하나에서 **위 세그먼트로 종류를 고른다.**
 *
 * ── 저장 경로는 그대로다 ───────────────────────────────────────────────────
 *   영업 활동 → hooks/customer/useSalesActivityCrud.ts (부르는 쪽이 넘긴 onSaveActivity)
 *   포캐스트  → hooks/customer/useOpportunityCrud.ts  (onSaveOpportunity)
 *   홀딩      → lib/holdingCreate.ts                  (장비 카드와 **같은 함수**)
 *   이 창은 칸을 모아 보여 줄 뿐이고, 무엇이 저장되는지는 그 세 곳이 정한다.
 *
 * ── 설계와 달라진 두 가지(자료가 그렇게 생겼다) ───────────────────────────
 *   ① 홀딩에는 **「해제 예정일」 칸이 없다.** holdings 에는 started_at(시작)과
 *      resolved_at(실제로 해제한 날)만 있다 — 예정일을 적을 칸이 없어 만들지 않았다.
 *   ② 홀딩은 **장비에 붙는다**(holdings.device_id). 그래서 사업장만 고르면 안 되고
 *      그 사업장의 장비를 함께 골라야 한다. 장비가 없는 사업장은 홀딩을 걸 수 없다.
 */

import { useMemo, useState } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import ModalCard from '@/components/common/ModalCard'
import { useEngineers } from '@/lib/appData/engineers'
import { selectableActivityTypes, useActivityTypes } from '@/lib/activityTypes'
import { todayKST } from '@/lib/date'
import { isClosed } from '../opportunity'
import { STAGES } from '../opportunity'
import { R } from '@/lib/radius'
import type { Contact, Device, OpportunityForm, SalesActivityForm, SalesOpportunity } from '../types'
import { LABEL_WEIGHT, TEXT_LABEL } from '@/lib/textTokens'

const BORDER = '#ebebeb'
const TEXT = '#111827'
const SUB = '#4b5563'
const MUTED = '#6b7280'
const BLUE = '#234ea2'
const DANGER = '#dc2626'

export type RecordKind = '영업 활동' | '포캐스트' | '홀딩'
const KINDS: RecordKind[] = ['영업 활동', '포캐스트', '홀딩']

export type HoldingDraft = {
  customerId: number
  deviceId: number
  title: string
  startedAt: string
  firstNote: string
}

type Props = {
  companyName: string
  /** 고를 수 있는 사업장. 하나뿐이면 고르는 칸을 잠근다. */
  sites: { id: number; name: string }[]
  /** 처음 고를 사업장 — 가장 최근에 움직인 곳이다. */
  defaultSiteId: number | null
  /** 사업장별 담당자·장비·기회 — 고른 사업장으로 걸러 쓴다. */
  contacts: Contact[]
  devices: Device[]
  opportunities: SalesOpportunity[]
  /** 지금 사람 — 포캐스트 담당자의 기본값이다. */
  myEngineerId: number | null
  isSaving: boolean
  onClose: () => void
  /** 영업 활동 — 사업장과 폼을 함께 넘긴다(저장은 부르는 쪽의 훅이 한다). */
  onSaveActivity: (siteId: number, form: SalesActivityForm) => void
  onSaveOpportunity: (siteId: number, form: OpportunityForm) => void
  onSaveHolding: (draft: HoldingDraft) => void
}

const labelStyle = { fontSize: 12, fontWeight: LABEL_WEIGHT, color: TEXT_LABEL, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 } as const

const fieldStyle = {
  width: '100%', height: 38, padding: '0 11px', border: `1px solid ${BORDER}`, borderRadius: R.control,
  boxSizing: 'border-box' as const, color: TEXT, background: '#ffffff', outline: 'none',
  fontSize: 13, fontFamily: 'inherit',
}
const areaStyle = {
  ...fieldStyle, height: 'auto' as const, minHeight: 96, padding: '10px 11px',
  resize: 'vertical' as const, lineHeight: 1.6,
}

const Req = () => <span style={{ color: DANGER }}>*</span>

export default function RecordAddModal({
  companyName, sites, defaultSiteId, contacts, devices, opportunities, myEngineerId,
  isSaving, onClose, onSaveActivity, onSaveOpportunity, onSaveHolding,
}: Props) {
  const [kind, setKind] = useState<RecordKind>('영업 활동')
  const [siteId, setSiteId] = useState<number | null>(defaultSiteId ?? sites[0]?.id ?? null)
  const [date, setDate] = useState(todayKST())
  const [err, setErr] = useState<string | null>(null)

  const types = useActivityTypes()
  const typeOptions = useMemo(() => selectableActivityTypes(types).map(t => t.label), [types])
  const { engineers } = useEngineers()

  // 영업 활동
  const [activityType, setActivityType] = useState('')
  const [oppId, setOppId] = useState<number | null>(null)
  const [contactId, setContactId] = useState<number | null>(null)
  const [content, setContent] = useState('')

  // 포캐스트
  const [title, setTitle] = useState('')
  const [stage, setStage] = useState<string>(STAGES[0])
  const [amount, setAmount] = useState('')
  const [month, setMonth] = useState('')
  const [ownerId, setOwnerId] = useState<number | null>(myEngineerId)

  // 홀딩
  const [deviceId, setDeviceId] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [firstNote, setFirstNote] = useState('')

  /** 고른 사업장에 딸린 것만 보여 준다 — 다른 사업장의 담당자·장비를 고를 수는 없다. */
  const siteContacts = useMemo(() => contacts.filter(c => c.customer_id === siteId), [contacts, siteId])
  const siteDevices = useMemo(() => devices.filter(d => d.customer_id === siteId), [devices, siteId])
  const siteOpps = useMemo(
    () => opportunities.filter(o => o.customer_id === siteId && !isClosed(o)),
    [opportunities, siteId],
  )

  const pickedType = activityType || typeOptions[0] || ''

  const submit = () => {
    setErr(null)
    if (siteId == null) { setErr('사업장을 골라주세요'); return }
    if (!date) { setErr('날짜를 골라주세요'); return }

    if (kind === '영업 활동') {
      if (!pickedType) { setErr('활동 종류를 골라주세요'); return }
      if (!content.trim()) { setErr('내용을 적어주세요'); return }
      onSaveActivity(siteId, {
        opportunity_id: oppId,
        activity_date: date,
        activity_type: pickedType,
        contact_id: contactId,
        content: content.trim(),
      })
      return
    }

    if (kind === '포캐스트') {
      if (!title.trim()) { setErr('제목을 적어주세요'); return }
      onSaveOpportunity(siteId, {
        customer_id: siteId,
        title: title.trim(),
        stage,
        expected_amount: amount,
        expected_close: month,
        engineer_id: ownerId ?? myEngineerId,
        lost_reason: '',
        lost_note: '',
      })
      return
    }

    if (deviceId == null) { setErr('장비를 골라주세요 — 홀딩은 장비에 걸립니다'); return }
    if (!reason.trim()) { setErr('사유를 적어주세요'); return }
    onSaveHolding({ customerId: siteId, deviceId, title: reason.trim(), startedAt: date, firstNote })
  }

  const dateLabel = kind === '영업 활동' ? '활동일' : kind === '홀딩' ? '시작일' : '등록일'

  return (
    <ModalOverlay onClose={onClose}>
      {/* 공용 카드로 옮겼다(2026-11-26, 지시 P) — 열림 모션 150ms · Esc·바깥 클릭·✕ 가
          한 함수를 지난다. 겉모양은 그대로다: 폭 560 · 최대 높이 92vh · 제목 17/800 ·
          머리·발의 여백과 바닥 선. 전에는 **카드 전체가** 구르고 머리·바닥도 함께 올라갔다 —
          지금은 본문만 구르고 그 둘이 제자리에 있는다(그 점만 달라졌다).
          보조 기술에 알리던 세 칸(role·aria)도 그대로 넘긴다. */}
      <ModalCard
        width={560}
        closeX={false}
        role="dialog" ariaModal ariaLabel="기록 추가"
        style={{ maxHeight: '92vh', border: `1px solid ${BORDER}` }}
        headStyle={{ padding: '18px 22px 0', alignItems: 'center', gap: 10 }}
        bodyStyle={{ padding: '16px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}
        footStyle={{ padding: '14px 22px 18px', borderTop: `1px solid ${BORDER}`, justifyContent: 'flex-start' }}
        title={<>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: TEXT, letterSpacing: '-0.3px' }}>기록 추가</h2>
          <span style={{ fontSize: 12, color: SUB }}>{companyName}</span>
        </>}
        footer={<>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose} disabled={isSaving}
            style={{ height: 36, padding: '0 14px', background: '#ffffff', color: SUB, borderRadius: R.control, border: `1px solid ${BORDER}`, cursor: 'pointer', fontWeight: 600, fontSize: 13, fontFamily: 'inherit' }}>
            취소
          </button>
          <button type="button" onClick={submit} disabled={isSaving}
            style={{ height: 36, padding: '0 16px', background: BLUE, color: '#ffffff', borderRadius: R.control, border: 'none', cursor: isSaving ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 13, fontFamily: 'inherit', opacity: isSaving ? 0.6 : 1 }}>
            {isSaving ? '저장 중…' : '저장'}
          </button>
        </>}
      >
        <>
          {/* 종류 — 고르면 아래 칸이 바뀐다. 공통 칸(사업장·날짜)은 그대로 남는다. */}
          <div style={{ display: 'flex', background: '#f3f4f6', borderRadius: R.control, padding: 3, gap: 2 }}>
            {KINDS.map(k => (
              <button key={k} type="button" onClick={() => { setKind(k); setErr(null) }}
                style={{
                  flex: 1, height: 34, border: 'none', borderRadius: R.icon, cursor: 'pointer', fontFamily: 'inherit',
                  background: kind === k ? '#ffffff' : 'transparent',
                  color: kind === k ? TEXT : MUTED,
                  fontSize: 13, fontWeight: kind === k ? 700 : 500,
                  boxShadow: kind === k ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                }}>
                {k}
              </button>
            ))}
          </div>

          {/* 공통 — 사업장·날짜 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>사업장 <Req /></label>
              <select value={siteId ?? ''} disabled={sites.length <= 1}
                onChange={e => { setSiteId(e.target.value ? Number(e.target.value) : null); setDeviceId(null); setContactId(null); setOppId(null) }}
                style={{ ...fieldStyle, color: siteId == null ? MUTED : TEXT }}>
                <option value="" disabled hidden>고르기</option>
                {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>{dateLabel} <Req /></label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                style={{ ...fieldStyle, colorScheme: 'light' }} />
            </div>
          </div>

          {kind === '영업 활동' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelStyle}>활동 종류 <Req /></label>
                  <select value={pickedType} onChange={e => setActivityType(e.target.value)} style={fieldStyle}>
                    {typeOptions.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>연결 포캐스트</label>
                  <select value={oppId ?? ''} onChange={e => setOppId(e.target.value ? Number(e.target.value) : null)}
                    style={{ ...fieldStyle, color: oppId == null ? MUTED : TEXT }}>
                    <option value="">{siteOpps.length > 0 ? '진행 중인 포캐스트 선택' : '진행 중인 포캐스트 없음'}</option>
                    {siteOpps.map(o => <option key={o.opportunity_id} value={o.opportunity_id}>{o.title || '(제목 없음)'}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label style={labelStyle}>만난 고객 담당자</label>
                <select value={contactId ?? ''} onChange={e => setContactId(e.target.value ? Number(e.target.value) : null)}
                  style={{ ...fieldStyle, color: contactId == null ? MUTED : TEXT }}>
                  <option value="">{siteContacts.length > 0 ? '담당자 선택 (고른 사업장 기준)' : '등록된 담당자 없음'}</option>
                  {siteContacts.map(c => (
                    <option key={c.contact_id} value={c.contact_id}>{`${c.name ?? ''} ${c.position ?? ''}`.trim()}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>내용 <Req /></label>
                <textarea value={content} onChange={e => setContent(e.target.value)}
                  placeholder="방문 목적 · 논의 내용 · 다음 할 일" style={areaStyle} />
              </div>
            </>
          )}

          {kind === '포캐스트' && (
            <>
              <div>
                <label style={labelStyle}>제목 <Req /></label>
                <input value={title} onChange={e => setTitle(e.target.value)}
                  placeholder="예) 삼차원 측정기 교체" style={fieldStyle} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelStyle}>단계 <Req /></label>
                  <select value={stage} onChange={e => setStage(e.target.value)} style={fieldStyle}>
                    {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>예상 금액</label>
                  <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="numeric"
                    placeholder="원 단위" style={fieldStyle} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelStyle}>예정 시기</label>
                  {/* 달 단위로만 받는다 — 저장할 때 그 달 말일이 된다(opportunity.ts monthToDate). */}
                  <input type="month" value={month} onChange={e => setMonth(e.target.value)}
                    style={{ ...fieldStyle, colorScheme: 'light' }} />
                </div>
                <div>
                  <label style={labelStyle}>담당자</label>
                  <select value={ownerId ?? ''} onChange={e => setOwnerId(e.target.value ? Number(e.target.value) : null)}
                    style={fieldStyle}>
                    <option value="">고르기</option>
                    {engineers.filter(e => !e.resigned_date).map(e => (
                      <option key={e.engineer_id} value={e.engineer_id}>{`${e.name ?? ''} ${e.position ?? ''}`.trim()}</option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          )}

          {kind === '홀딩' && (
            <>
              <div>
                <label style={labelStyle}>장비 <Req /></label>
                <select value={deviceId ?? ''} onChange={e => setDeviceId(e.target.value ? Number(e.target.value) : null)}
                  style={{ ...fieldStyle, color: deviceId == null ? MUTED : TEXT }}>
                  <option value="" disabled hidden>{siteDevices.length > 0 ? '장비 선택 (고른 사업장 기준)' : '등록된 장비 없음'}</option>
                  {siteDevices.map(d => (
                    <option key={d.device_id} value={d.device_id}>
                      {[d.device_name, d.device_name2].filter(Boolean).join(' ') || `장비 ${d.device_id}`}
                    </option>
                  ))}
                </select>
                <div style={{ fontSize: 11, color: MUTED, marginTop: 5 }}>홀딩은 장비에 걸립니다 — 어느 장비가 멈춰 있는지가 홀딩의 뜻입니다.</div>
              </div>
              <div>
                <label style={labelStyle}>사유 <Req /></label>
                <input value={reason} onChange={e => setReason(e.target.value)}
                  placeholder="예) 스케일 보드 교체 대기" style={fieldStyle} />
              </div>
              <div>
                <label style={labelStyle}>첫 메모</label>
                <textarea value={firstNote} onChange={e => setFirstNote(e.target.value)}
                  placeholder="지금까지 확인한 것 · 다음 할 일" style={areaStyle} />
              </div>
            </>
          )}

          {err && <div style={{ fontSize: 12, fontWeight: 600, color: DANGER }}>{err}</div>}
        </>
      </ModalCard>
    </ModalOverlay>
  )
}
