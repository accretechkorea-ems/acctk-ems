'use client'

// 전자결재 — 결재함 · 상신함 · 참조함 (superadmin 은 전체).
//
// 목록은 한 줄에 한 건이고, 누르면 그 자리에서 상세가 펼쳐진다(아코디언).
// 결재함에서는 목록을 떠나지 않고 승인·반려까지 끝낸다.
//
// 주소가 원본이다 — 탭은 ?tab= 에, 결재함의 완료 하위 탭은 ?sub=done 에 담는다(쇼룸과 같은 방식).
// 목록 자체는 /api/approval 이 service role 로 걸러 준다. 화면에서 직접 읽는 것은 이력과
// 직원 이름뿐이고, 둘 다 RLS 가 참여자에게만 열어 준다.

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { usePageGuard } from '@/hooks/usePageGuard'
import AccessGate from '@/components/common/AccessGate'
import SegmentedControl from '@/components/common/SegmentedControl'
import { useToast } from '@/components/common/Toast'
import { isSuperAdmin } from '@/lib/permissions'
import { SERVICE_TYPE_COLORS, TIMELINE_KIND_COLORS, getCategoryColor, type CategoryColor } from '@/lib/categoryColors'
import {
  FAINT, MUTED, NEUTRAL_BG, PAGE_BG, SUB, TEXT,
  PULSE_KEYFRAMES, btnGhost, cardStyle, cardHeader, cardTitle, countBadge,
  rowStyle, rowSub, skeletonBlock,
} from '@/components/common/ui'
import LinePickerModal from '@/components/approval/LinePickerModal'
import DocDetail, { type ApprovalDoc } from '@/components/approval/DocDetail'
import type { ProgressPerson } from '@/components/approval/LineProgress'
import { summaryLine } from '@/components/approval/summary'
import { DOC_TYPES } from '@/lib/approval/docTypes'
import type { LineInput } from '@/lib/approval/types'

const APPROVAL_PATH = '/approval'

type Box = 'inbox' | 'outbox' | 'cc' | 'all'

const TABS: { value: Box; label: string }[] = [
  { value: 'inbox', label: '결재함' },
  { value: 'outbox', label: '상신함' },
  { value: 'cc', label: '참조함' },
]

/**
 * 문서 유형 dot — 새 색을 만들지 않고 categoryColors.ts 의 값을 그대로 빌린다.
 * 견적은 타임라인의 견적색, 쇼룸은 방문(신규설치)색, 삭제 요청은 위험(B/S)색.
 */
const DOC_TYPE_COLORS: Record<string, CategoryColor> = {
  quote: TIMELINE_KIND_COLORS['견적'],
  showroom_usage: SERVICE_TYPE_COLORS['신규설치'],
  quote_delete: SERVICE_TYPE_COLORS['B/S'],
}

/** 문서 상태 dot — 글자는 중립으로 두고 색은 dot 에만 준다(디자인 규칙). */
const STATUS_DOT: Record<string, string> = {
  '진행중': '#234ea2',
  '완료': '#16a34a',
  '반려': '#ef4444',
  '회수': '#9ca3af',
  '임시저장': '#d1d5db',
}

const parseTab = (v: string | null): Box =>
  v === 'outbox' || v === 'cc' || v === 'all' ? v : 'inbox'

const dateText = (iso: string | null): string => {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`
}

function ApprovalPageInner() {
  const router = useRouter()
  const params = useSearchParams()
  const toast = useToast()
  const { engineer: me, loading: guardLoading, authorized } = usePageGuard()
  const admin = isSuperAdmin(me)
  const myId = me?.engineer_id ?? null

  const tab = parseTab(params.get('tab'))
  const doneSub = tab === 'inbox' && params.get('sub') === 'done'

  const switchTab = (next: string) => {
    const q = new URLSearchParams()
    if (next !== 'inbox') q.set('tab', next)
    const s = q.toString()
    router.replace(s ? `${APPROVAL_PATH}?${s}` : APPROVAL_PATH, { scroll: false })
  }
  const switchSub = (next: string) => {
    const q = new URLSearchParams(params.toString())
    if (next === 'done') q.set('sub', 'done')
    else q.delete('sub')
    const s = q.toString()
    router.replace(s ? `${APPROVAL_PATH}?${s}` : APPROVAL_PATH, { scroll: false })
  }

  // ── 목록 ── 처리 뒤에는 reloadKey 를 올려 다시 읽는다.
  const [docs, setDocs] = useState<ApprovalDoc[]>([])
  const [reloadKey, setReloadKey] = useState(0)
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const queryKey = `${tab}:${doneSub}:${reloadKey}`
  // 읽는 중인지는 키 비교로 알아낸다 — 효과 안에서 곧바로 상태를 바꾸지 않기 위해서다.
  const listLoading = authorized && loadedKey !== queryKey

  useEffect(() => {
    if (!authorized) return
    let cancelled = false
    const run = async () => {
      const url = doneSub ? '/api/approval/done' : `/api/approval?box=${tab}`
      try {
        const res = await fetch(url)
        const json = await res.json().catch(() => null)
        if (cancelled) return
        if (!res.ok) {
          console.error('[approval] list failed', json)
          setDocs([])
        } else {
          setDocs((json?.documents ?? []) as ApprovalDoc[])
        }
      } catch (e) {
        if (cancelled) return
        console.error('[approval] list failed', e)
        setDocs([])
      }
      setOpenId(null)
      setLoadedKey(queryKey)
    }
    run()
    return () => { cancelled = true }
  }, [authorized, tab, doneSub, queryKey])

  // ── 직원 이름 ── 진행도·이력에서 번호를 이름으로 바꾼다. 한 번만 읽는다.
  const [people, setPeople] = useState<Record<number, ProgressPerson>>({})
  useEffect(() => {
    if (!authorized) return
    let cancelled = false
    const run = async () => {
      const supabase = createClient()
      const { data, error } = await supabase.from('engineers').select('engineer_id, name, position')
      if (cancelled) return
      if (error) {
        console.error('[approval] engineers load failed', error)
        return
      }
      const map: Record<number, ProgressPerson> = {}
      for (const e of (data ?? []) as { engineer_id: number; name: string | null; position: string | null }[]) {
        map[e.engineer_id] = { name: e.name, position: e.position }
      }
      setPeople(map)
    }
    run()
    return () => { cancelled = true }
  }, [authorized])

  // ── 시험 문서 상신 ──
  // TODO(4단계): 견적 결재가 붙으면 이 버튼과 아래 submitTest 를 통째로 지운다.
  //             쇼룸 유형으로 임시 문서를 만들어 결재 흐름을 눈으로 확인하기 위한 것뿐이다.
  const [pickerOpen, setPickerOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const submitTest = async (lines: LineInput[]) => {
    setPickerOpen(false)
    setSubmitting(true)
    try {
      const now = new Date()
      const res = await fetch('/api/approval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'submit',
          docType: 'showroom_usage',
          docNo: `TEST-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours())}${String(now.getMinutes()).padStart(2, '0')}`,
          title: '시험 상신 — 쇼룸 사용 신청',
          summary: { device: '시험 장비', period: dateText(now.toISOString()), purpose: '결재 흐름 확인' },
          targetTable: 'showroom_usage',
          targetId: null,
          lines,
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) { toast.error(json?.error ?? '상신하지 못했습니다'); return }
      toast.success('시험 문서를 상신했습니다')
      setReloadKey(k => k + 1)
    } catch (e) {
      console.error('[approval] test submit failed', e)
      toast.error('상신하지 못했습니다')
    } finally {
      setSubmitting(false)
    }
  }

  const tabOptions = useMemo(
    () => (admin ? [...TABS, { value: 'all' as Box, label: '전체' }] : TABS),
    [admin],
  )

  if (!authorized) return <AccessGate loading={guardLoading} />

  const title = doneSub ? '내가 처리한 문서'
    : tab === 'inbox' ? '내가 결재할 문서'
      : tab === 'outbox' ? '내가 올린 문서'
        : tab === 'cc' ? '참조된 문서' : '전체 문서'
  const emptyText = doneSub ? '처리한 문서가 없습니다'
    : tab === 'inbox' ? '결재할 문서가 없습니다'
      : tab === 'outbox' ? '올린 문서가 없습니다'
        : tab === 'cc' ? '참조된 문서가 없습니다' : '문서가 없습니다'

  return (
    <main style={{ padding: '24px 28px', background: PAGE_BG, minHeight: '100vh' }}>
      <style>{PULSE_KEYFRAMES}</style>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <SegmentedControl value={tab} options={tabOptions} onChange={switchTab} />
        {tab === 'inbox' && (
          <SegmentedControl
            value={doneSub ? 'done' : 'pending'}
            options={[{ label: '대기', value: 'pending' }, { label: '완료', value: 'done' }]}
            onChange={switchSub}
          />
        )}
        {/* TODO(4단계): 제거 대상 — 시험 상신 버튼 */}
        {admin && (
          <button type="button" onClick={() => setPickerOpen(true)} disabled={submitting}
            style={{ ...btnGhost(submitting), marginLeft: 'auto' }}>
            {submitting ? '상신 중...' : '시험 문서 상신'}
          </button>
        )}
      </div>

      <div style={cardStyle}>
        <div style={cardHeader}>
          <span style={cardTitle}>{title}</span>
          <span style={countBadge}>{listLoading ? '...' : `${docs.length}건`}</span>
        </div>

        {listLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <div style={skeletonBlock(9, 9)} />
                <div style={skeletonBlock('40%', 14)} />
                <div style={skeletonBlock('20%', 12)} />
              </div>
            ))}
          </div>
        ) : docs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '36px 0', fontSize: 13, color: MUTED }}>{emptyText}</div>
        ) : (
          docs.map((d, i) => {
            const color = getCategoryColor(DOC_TYPE_COLORS, d.doc_type)
            const type = DOC_TYPES[d.doc_type]?.label ?? d.doc_type
            const summary = summaryLine(d.doc_type, d.summary)
            const open = openId === d.document_id
            const currentName = d.progress?.currentApproverId != null
              ? (people[d.progress.currentApproverId]?.name ?? `#${d.progress.currentApproverId}`)
              : null
            return (
              <div key={d.document_id} style={rowStyle(i === 0)}>
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : d.document_id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                    border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: color.dot ?? color.text, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: SUB, background: NEUTRAL_BG, borderRadius: 99, padding: '2px 8px', whiteSpace: 'nowrap' }}>
                    {type}
                  </span>
                  <span style={{ fontSize: 12, color: MUTED, whiteSpace: 'nowrap' }}>{d.doc_no}</span>
                  <span style={{ fontSize: 15, fontWeight: 600, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.title}
                  </span>
                  {d.delegated && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: SUB, background: NEUTRAL_BG, borderRadius: 99, padding: '2px 8px', whiteSpace: 'nowrap' }}>
                      대결
                    </span>
                  )}
                  <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    {tab !== 'inbox' && (
                      <>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_DOT[d.status] ?? FAINT }} />
                        <span style={{ fontSize: 12, color: SUB }}>{d.status}</span>
                      </>
                    )}
                    <span style={{ fontSize: 12, color: MUTED }}>{dateText(d.submitted_at ?? d.created_at)}</span>
                  </span>
                </button>
                <div style={{ ...rowSub, marginTop: 3, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span>{people[d.requester_id]?.name ?? `#${d.requester_id}`}</span>
                  {summary && (<><span style={{ color: FAINT }}>·</span><span>{summary}</span></>)}
                  {tab === 'outbox' && d.status === '진행중' && currentName && (
                    <><span style={{ color: FAINT }}>·</span><span>현재 {currentName} 차례</span></>
                  )}
                </div>
                {open && (
                  <div style={{ marginTop: 10, marginLeft: -12, marginRight: -12 }}>
                    <DocDetail
                      doc={d}
                      people={people}
                      box={doneSub ? 'done' : tab}
                      onChanged={() => setReloadKey(k => k + 1)}
                    />
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* TODO(4단계): 시험 상신과 함께 제거. 그때는 견적 화면이 이 모달을 직접 연다. */}
      <LinePickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onConfirm={submitTest}
        myId={myId}
        docType="showroom_usage"
      />
    </main>
  )
}

// useSearchParams 는 Suspense 경계가 필요하다(쇼룸·견적 화면과 같은 방식).
export default function ApprovalPage() {
  return (
    <Suspense fallback={null}>
      <ApprovalPageInner />
    </Suspense>
  )
}
