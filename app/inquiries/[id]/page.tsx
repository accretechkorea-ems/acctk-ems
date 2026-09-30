'use client'

// 의뢰서 상세 — 보기 + 제목·상태 수정 + 취소.
//
// 레일은 두지 않는다. 목록(/inquiries)이 레일을 갖고, 여기는 한 건만 보는 자리다.
// 그래도 메인 사이드바는 접힌 채다 — lib/railPaths.ts 의 RAIL_PATHS 가 하위 경로까지 보기 때문이다.
//
// 읽기는 브라우저 supabase 클라이언트가 직접 한다(RLS inquiries_select).
// 쓰기(수정·취소)는 전부 /api/inquiry 를 거친다 — inquiries 에는 쓰기 정책이 없다.
//
// 취소는 두 갈래로 끝난다. 어느 쪽인지는 서버(DB 함수 cancel_inquiry)가 판정한다.
//   released  — 마지막 번호라 반환했다. 행이 지워졌으므로 이 화면은 더 존재하지 않는다 → 목록으로.
//   abandoned — 뒤에 이미 다른 번호가 나가 버렸다. 취소 상태로 남는다 → 그대로 다시 읽는다.
// 화면은 어느 쪽인지 미리 단정하지 않는다.

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { usePageGuard } from '@/hooks/usePageGuard'
import AccessGate from '@/components/common/AccessGate'
import SegmentedControl from '@/components/common/SegmentedControl'
import { useConfirm } from '@/components/common/ConfirmDialog'
import { useToast } from '@/components/common/Toast'
import {
  PAGE_BG, CARD_BG, BORDER, TEXT, MUTED, SUB, NEUTRAL_BG, BLUE,
  cardStyle, cardHeader, cardTitle, btnPrimary, btnGhost, btnDanger,
} from '@/components/common/ui'
import {
  EDITABLE_STATUSES, INQUIRY_STATUS_DOT, INQUIRY_TYPE_LABEL,
  inquiryStatusLabel, type InquiryType,
} from '@/lib/inquiries'

const TITLE_MAX = 200

/** 취소 확인 문구 — 어느 쪽으로 끝날지 단정하지 않는다. 판정은 서버가 한다. */
const CANCEL_MESSAGE =
  '이 번호가 마지막으로 발급된 번호이면 반환되어 다음 작성 때 다시 쓰입니다. '
  + '이후 번호가 이미 발급됐다면 취소 상태로 남고 다시 쓰이지 않습니다.'

type Detail = {
  id: string
  inquiry_no: string
  inquiry_type: string
  equipment_series: string | null
  title: string | null
  status: string
  issued_date: string
  cancelled_at: string | null
  created_by: number | null
  engineers: { name: string | null } | null
}

// 목록과 같은 이유로 제약 이름을 명시한다(engineers 를 여러 번 참조하게 될 표다).
const SELECT_COLUMNS =
  'id, inquiry_no, inquiry_type, equipment_series, title, status, issued_date, cancelled_at, created_by,'
  + ' engineers!inquiries_created_by_fkey(name)'

const dateText = (ymd: string | null): string => (ymd ? ymd.replace(/-/g, '.') : '')

/** timestamptz → 'YYYY.MM.DD HH:mm'(KST). 취소 시각은 분까지 보이면 충분하다. */
const stampText = (iso: string | null): string => {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  const kst = new Date(d.getTime() + 9 * 3600_000)
  return `${kst.getUTCFullYear()}.${p(kst.getUTCMonth() + 1)}.${p(kst.getUTCDate())}`
    + ` ${p(kst.getUTCHours())}:${p(kst.getUTCMinutes())}`
}

/** 「이름 : 값」 한 줄. 값이 없으면 부르는 쪽이 아예 그리지 않는다. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '9px 0', borderTop: `1px solid ${BORDER}` }}>
      <span style={{ width: 96, flexShrink: 0, fontSize: 12, fontWeight: 700, color: MUTED }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: TEXT, lineHeight: 1.6 }}>{children}</span>
    </div>
  )
}

export default function InquiryDetailPage() {
  const { loading: guardLoading, authorized } = usePageGuard()
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const id = typeof params?.id === 'string' ? params.id : ''
  const toast = useToast()
  const confirmDialog = useConfirm()

  const [row, setRow] = useState<Detail | null>(null)
  // null = 아직 읽는 중, 'gone' = 없다(처음부터 없거나 반환되어 지워졌다)
  const [state, setState] = useState<'loading' | 'ready' | 'gone'>('loading')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    if (!id) { setState('gone'); return }
    const supabase = createClient()
    const { data, error } = await supabase.from('inquiries').select(SELECT_COLUMNS).eq('id', id).maybeSingle()
    if (error) {
      console.error('[inquiries] 상세 조회 실패', { id, error })
      setState('gone')
      return
    }
    if (!data) { setState('gone'); return }
    const d = data as unknown as Detail
    setRow(d)
    setTitle(d.title ?? '')
    setState('ready')
  }, [id])

  useEffect(() => { if (authorized) load() }, [authorized, load])

  const cancelled = row?.status === 'cancelled'

  /** 제목·상태 저장. 취소된 건은 서버도 조건부 UPDATE 로 막지만 화면에서도 잠근다. */
  const save = async (patch: { title?: string; status?: string }) => {
    if (!row || cancelled || busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update', id: row.id, ...patch }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(json.error || `저장하지 못했습니다 (${res.status})`); return }
      toast.success('저장했습니다')
      await load()
    } catch (e) {
      console.error('[inquiries] 저장 실패', e)
      toast.error('저장하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const cancelInquiry = async () => {
    if (!row || cancelled || busy) return
    const ok = await confirmDialog({
      title: '의뢰서 취소',
      message: CANCEL_MESSAGE,
      confirmText: '취소하기',
      variant: 'danger',
    })
    if (!ok) return
    setBusy(true)
    try {
      const res = await fetch('/api/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', id: row.id }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(json.error || `취소하지 못했습니다 (${res.status})`); return }

      const no = json.inquiryNo ?? row.inquiry_no
      if (json.outcome === 'released') {
        toast.success(`번호 ${no}가 반환되었습니다. 다음 새 작성 때 다시 쓰입니다.`)
        // 행이 지워졌다 — 이 주소에는 더 볼 것이 없다.
        router.replace('/inquiries')
        return
      }
      if (json.outcome === 'abandoned') {
        // 버림이 된 이유는 둘이다(뒤에 다른 번호가 이미 나갔거나, 소급 등록 건이거나).
        // 서버는 어느 쪽인지 알려주지 않으므로 이유를 단정하지 않는다.
        toast.success(`취소되었습니다. ${no}는 재사용되지 않습니다.`)
      } else if (json.outcome === 'already_cancelled') {
        toast.error('이미 취소된 의뢰서입니다')
      }
      await load()
    } catch (e) {
      console.error('[inquiries] 취소 실패', e)
      toast.error('취소하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!row) return
    try {
      await navigator.clipboard.writeText(row.inquiry_no)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('복사하지 못했습니다. 번호를 직접 선택해 복사해주세요')
    }
  }

  if (!authorized) return <AccessGate loading={guardLoading} />

  const back = (
    <button
      type="button"
      onClick={() => router.push('/inquiries')}
      style={{
        border: 'none', background: 'transparent', cursor: 'pointer', padding: '0 0 12px',
        fontSize: 13, fontWeight: 700, color: SUB, fontFamily: 'inherit',
      }}
    >
      ← 목록
    </button>
  )

  return (
    <main style={{ padding: '24px 28px', background: PAGE_BG, minHeight: '100vh' }}>
      <div style={{ maxWidth: 680, margin: '0 auto' }}>
        {back}

        {state === 'loading' ? (
          <div style={{ ...cardStyle, textAlign: 'center', padding: 40, color: MUTED, fontSize: 13 }}>불러오는 중...</div>
        ) : state === 'gone' || !row ? (
          <div style={{ ...cardStyle, textAlign: 'center', padding: 40, color: MUTED, fontSize: 13, lineHeight: 1.7 }}>
            찾을 수 없습니다<br />
            <span style={{ fontSize: 12 }}>취소되어 번호가 반환된 의뢰서일 수 있습니다.</span>
          </div>
        ) : (
          <div style={cardStyle}>
            <div style={cardHeader}>
              <span style={cardTitle}>{INQUIRY_TYPE_LABEL[row.inquiry_type as InquiryType] ?? row.inquiry_type}</span>
              {!cancelled && (
                <button
                  type="button" onClick={cancelInquiry} disabled={busy}
                  style={{ ...btnDanger(busy), marginLeft: 'auto' }}
                >
                  취소하기
                </button>
              )}
            </div>

            {/* 번호 — 사람이 받아 적는 값이라 크게. 취소된 건은 취소선을 긋는다. */}
            <div style={{
              background: NEUTRAL_BG, borderRadius: 8, padding: '16px', display: 'flex',
              alignItems: 'center', gap: 12,
            }}>
              <span style={{
                flex: 1, minWidth: 0, fontSize: 20, fontWeight: 800, letterSpacing: '-0.5px',
                color: cancelled ? MUTED : BLUE, wordBreak: 'break-all',
                textDecoration: cancelled ? 'line-through' : 'none',
              }}>
                {row.inquiry_no}
              </span>
              <button type="button" onClick={copy} style={{ ...btnGhost(), flexShrink: 0 }}>
                {copied ? '복사했습니다' : '번호 복사'}
              </button>
            </div>

            {cancelled && (
              <div style={{
                marginTop: 12, fontSize: 12, lineHeight: 1.7, color: MUTED,
                background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '8px 10px',
              }}>
                취소된 의뢰서입니다. 번호는 재사용되지 않으며 내용을 고칠 수 없습니다.
              </div>
            )}

            <div style={{ marginTop: 14 }}>
              {row.equipment_series && <Field label="장비 계열">{row.equipment_series}</Field>}
              <Field label="발행일">{dateText(row.issued_date)}</Field>
              <Field label="담당자">{row.engineers?.name ?? '-'}</Field>
              {cancelled && row.cancelled_at && <Field label="취소 시각">{stampText(row.cancelled_at)}</Field>}

              <Field label="상태">
                {cancelled ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: SUB }}>
                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: INQUIRY_STATUS_DOT.cancelled }} />
                    {inquiryStatusLabel(row.status)}
                  </span>
                ) : (
                  <SegmentedControl
                    options={EDITABLE_STATUSES.map(v => ({ label: inquiryStatusLabel(v), value: v }))}
                    value={row.status}
                    onChange={v => { if (v !== row.status) save({ status: v }) }}
                  />
                )}
              </Field>

              <Field label="제목">
                {cancelled ? (
                  <span style={{ color: row.title?.trim() ? TEXT : MUTED }}>
                    {row.title?.trim() || '(제목 없음)'}
                  </span>
                ) : (
                  <span style={{ display: 'flex', gap: 8 }}>
                    <input
                      value={title} maxLength={TITLE_MAX} placeholder="제목을 입력하세요"
                      onChange={e => setTitle(e.target.value)}
                      style={{
                        flex: 1, minWidth: 0, padding: '8px 10px', border: `1px solid ${BORDER}`,
                        borderRadius: 6, fontSize: 13, color: TEXT, background: CARD_BG,
                        outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => save({ title })}
                      disabled={busy || title.trim() === (row.title ?? '').trim()}
                      style={{ ...btnPrimary(busy || title.trim() === (row.title ?? '').trim()), flexShrink: 0 }}
                    >
                      저장
                    </button>
                  </span>
                )}
              </Field>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
