'use client'

// 결재 문서 한 건의 **전용 화면** — 옛 그룹웨어 품의서 모양의 문서 양식.
//
// 목록에서 펼치는 상세(DocDetail)와 다른 자리다. 그쪽은 목록을 떠나지 않고 처리하는 아코디언이고,
// 이쪽은 주소가 있는 한 장의 문서다(링크로 주고받고, 새 창으로 띄울 수 있다).
// **DocDetail 은 한 글자도 바뀌지 않았다** — 처리 영역만 둘이 같은 컴포넌트를 쓴다(DocActions).
//
// 양식 구성(위에서부터)
//   양식 제목 → [머리 표 | 결재란] → 합의 줄(있을 때만) → 수신·참조 → 제목 → 본문 → 첨부 → 이력 → 처리
// 옛 양식의 시행자·시행일자·문서유형·긴급도·보안등급·보존연한·문서함 항목은 두지 않는다.
//
// 본문은 **등록표가 갈아 끼운다**(components/approval/panels.ts 의 FormBody).
// 등록이 없는 유형(쇼룸·견적 삭제)은 기존 요약 표(summaryRows)를 본문 자리에 그린다 —
// 그래서 이 파일에 문서 종류 이름이 하나도 없다(DocDetail 과 같은 규칙).
//
// ?popup=1 — 사이드바·상단 틀 없이 문서만 그린다. 앱 껍데기(HeaderWrapper)는 경로로만 판정해
// 쿼리를 보지 못하므로(lib/publicPaths.ts 는 경로 목록이다), 여기서 화면을 덮는 층으로 그린다.
// 루트 레이아웃에 useSearchParams 를 넣으면 모든 페이지가 동적 렌더가 되어 그 길을 택하지 않았다.

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { usePageGuard } from '@/hooks/usePageGuard'
import AccessGate from '@/components/common/AccessGate'
import {
  BLUE, BORDER, CARD_BG, DANGER, FAINT, MUTED, NEUTRAL_BG, PAGE_BG, SKELETON, SUB, TEXT, btnGhost,
} from '@/components/common/ui'
import ApprovalTable, { type ProgressPerson } from '@/components/approval/ApprovalTable'
import DocActions from '@/components/approval/DocActions'
import { FormRow, formTable, formTd, formTh, scrollBox } from '@/components/approval/formStyles'
import { formBodyOf, formTitleOf } from '@/components/approval/panels'
import { summaryRows } from '@/components/approval/summary'
import { attachmentCount, statusText } from '@/components/approval/boxes'
import type { ApprovalDoc } from '@/components/approval/DocDetail'
import { progressCount } from '@/lib/approval/tableCells'
import { ccSummary, isSettled, type FormResponse } from '@/lib/approval/formDoc'
import { DOC_TYPES } from '@/lib/approval/docTypes'
import { nextPendingLine } from '@/lib/approval/engine'
import { APPROVAL_PATH } from '@/lib/approval/types'

type HistoryRow = {
  history_id: number
  action: string
  actor_id: number
  step: number | null
  comment: string | null
  created_at: string
}

/** 무엇이 잘못됐는지 — 셋을 가른다. 「불러오는 중」과 「없다」와 「서버가 답을 못 줬다」는 다른 말이다. */
type LoadState =
  | { kind: 'loading' }
  | { kind: 'ok'; data: FormResponse }
  /** 권한 없음·문서 없음·잘못된 id — 다시 시도해도 같다. */
  | { kind: 'denied'; message: string }
  /** 서버 오류·네트워크 — 다시 시도할 값이 있다. */
  | { kind: 'error'; message: string }

const when = (iso: string | null): string => {
  if (!iso) return '-'
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 상태 dot 색 — 결재함 목록과 같은 값이다. */
const STATUS_DOT: Record<string, string> = {
  '진행중': '#234ea2',
  '완료': '#16a34a',
  '반려': '#ef4444',
  '회수': '#9ca3af',
  '임시저장': '#d1d5db',
  '폐기': '#d1d5db',
}

function Shell({ popup, children }: { popup: boolean; children: React.ReactNode }) {
  // popup 이면 화면을 덮어 사이드바·상단 틀을 가린다. 아니면 지금 앱 틀 안에 그대로 그린다.
  const base: React.CSSProperties = popup
    ? { position: 'fixed', inset: 0, overflowY: 'auto', background: PAGE_BG, zIndex: 100 }
    : { background: PAGE_BG, minHeight: '100vh' }
  return (
    <main style={{ ...base, padding: '20px 16px' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>{children}</div>
    </main>
  )
}

function DocPageInner() {
  const params = useParams<{ id: string }>()
  const search = useSearchParams()
  const router = useRouter()
  const { loading: guardLoading, authorized } = usePageGuard()
  const popup = search.get('popup') === '1'

  const raw = params?.id ?? ''
  // 주소의 id — 숫자가 아니면 서버에 묻지 않고 바로 안내한다.
  const documentId = /^\d+$/.test(raw) ? Number(raw) : NaN
  const badId = !Number.isSafeInteger(documentId) || documentId <= 0

  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [history, setHistory] = useState<HistoryRow[] | null>(null)
  const [historyFailed, setHistoryFailed] = useState(false)
  // 처리한 뒤 다시 읽는 열쇠.
  const [reloadKey, setReloadKey] = useState(0)

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(`/api/approval/doc?document_id=${documentId}`, { signal })
      const json = await res.json().catch(() => null)
      if (signal?.aborted) return
      if (res.status === 403 || res.status === 404 || res.status === 400) {
        setState({ kind: 'denied', message: json?.error ?? '문서를 볼 수 없습니다.' })
        return
      }
      if (!res.ok || !json?.doc) {
        setState({ kind: 'error', message: json?.error ?? '문서를 불러오지 못했습니다.' })
        return
      }
      setState({ kind: 'ok', data: json as FormResponse })
    } catch (e) {
      if (signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) return
      console.error('[approval/doc] load failed', { documentId, error: e })
      setState({ kind: 'error', message: '문서를 불러오지 못했습니다.' })
    }
  }, [documentId])

  const loadHistory = useCallback(async (signal?: AbortSignal) => {
    setHistory(null)
    setHistoryFailed(false)
    try {
      const res = await fetch(`/api/approval/history?document_id=${documentId}`, { signal })
      const json = await res.json().catch(() => null)
      if (signal?.aborted) return
      if (!res.ok || !Array.isArray(json?.history)) { setHistoryFailed(true); return }
      setHistory(json.history as HistoryRow[])
    } catch (e) {
      if (signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) return
      setHistoryFailed(true)
    }
  }, [documentId])

  useEffect(() => {
    if (!authorized || badId) return
    const ac = new AbortController()
    // 두 요청은 시작하면서 앞 문서의 결과를 **먼저 비운다** — 비우지 않으면 문서를 바꿀 때
    // 남의 내용이 한 프레임 보인다. 저장소의 같은 규칙 선례와 같은 방식으로 적어 둔다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(ac.signal)
    loadHistory(ac.signal)
    return () => ac.abort()
  }, [authorized, badId, load, loadHistory, reloadKey])

  if (!authorized) return <AccessGate loading={guardLoading} />

  // 창 닫기 — 새 창이 아니면 닫히지 않는다. 그때는 결재함으로 보낸다.
  const closeWindow = () => {
    window.close()
    setTimeout(() => { if (!window.closed) router.push(APPROVAL_PATH) }, 150)
  }

  const backLink = (
    <Link href={APPROVAL_PATH} style={{ ...btnGhost(), padding: '5px 12px', fontSize: 12, textDecoration: 'none' }}>
      결재함으로
    </Link>
  )

  if (badId) {
    return (
      <Shell popup={popup}>
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '18px 20px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: DANGER, marginBottom: 8 }}>
            문서 번호가 올바르지 않습니다
          </div>
          <div style={{ fontSize: 12, color: SUB, marginBottom: 12 }}>주소를 다시 확인해 주세요.</div>
          {backLink}
        </div>
      </Shell>
    )
  }

  if (state.kind === 'loading') {
    return (
      <Shell popup={popup}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ height: 28, width: 180, background: SKELETON, borderRadius: 6 }} />
          <div style={{ height: 150, background: SKELETON, borderRadius: 8 }} />
          <div style={{ height: 220, background: SKELETON, borderRadius: 8 }} />
        </div>
      </Shell>
    )
  }

  if (state.kind !== 'ok') {
    const retryable = state.kind === 'error'
    return (
      <Shell popup={popup}>
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '18px 20px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: DANGER, marginBottom: 8 }}>{state.message}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {retryable && (
              <button type="button" onClick={() => setReloadKey(k => k + 1)}
                style={{ ...btnGhost(), padding: '5px 12px', fontSize: 12 }}>
                다시 시도
              </button>
            )}
            {backLink}
            {popup && (
              <button type="button" onClick={closeWindow} style={{ ...btnGhost(), padding: '5px 12px', fontSize: 12 }}>
                창 닫기
              </button>
            )}
          </div>
        </div>
      </Shell>
    )
  }

  const { doc, people, can } = state.data
  const nameOf = (id: number) => people[id]?.name ?? `#${id}`
  const withPos = (id: number) => [nameOf(id), people[id]?.position ?? ''].filter(Boolean).join(' ')
  const typeLabel = DOC_TYPES[doc.doc_type]?.label ?? doc.doc_type
  // 양식 제목·본문은 등록표가 고른다 — 여기에 문서 종류 이름을 적지 않는다.
  const formTitle = formTitleOf(doc.doc_type, typeLabel)
  const FormBody = formBodyOf(doc.doc_type)

  const lines = doc.approval_lines
  const agree = lines.filter(l => l.kind === 'agree')
  const cc = lines.filter(l => l.kind === 'cc')
  const ccNames = cc.map(l => withPos(l.approver_id))
  const current = nextPendingLine(lines)
  const files = attachmentCount(doc.summary)
  const rows = summaryRows(doc.doc_type, doc.summary)

  // 진행 표기·상태 글자는 **기존 규칙을 그대로** 쓴다(components/approval/boxes.ts·tableCells.ts).
  const progress = progressCount(doc)
  const statusLine = statusText(doc as unknown as ApprovalDoc, people as Record<number, ProgressPerson>)
  const settled = isSettled(doc.status)

  return (
    <Shell popup={popup}>
      {/* ── 양식 제목 ── 문서 종류별 이름. 오른쪽에 돌아가기·창 닫기. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: TEXT, letterSpacing: '-0.5px', margin: 0 }}>
          {formTitle}
        </h1>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_DOT[doc.status] ?? FAINT }} />
          <span style={{ fontSize: 12, color: SUB }}>
            {settled ? statusLine : `진행(${progress.done}/${progress.total})`}
          </span>
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {!popup && backLink}
          {popup && (
            <button type="button" onClick={closeWindow} style={{ ...btnGhost(), padding: '5px 12px', fontSize: 12 }}>
              창 닫기
            </button>
          )}
        </span>
      </div>

      {/* 끝난 문서는 상태를 한 줄로 알린다 — 지금 할 수 있는 일이 없다는 뜻이다. */}
      {settled && (
        <div style={{
          border: `1px solid ${BORDER}`, borderRadius: 8, background: NEUTRAL_BG,
          padding: '8px 12px', marginBottom: 12, fontSize: 12, fontWeight: 700, color: SUB,
        }}>
          {statusLine}
          {doc.completed_at && <span style={{ fontWeight: 500, color: MUTED }}>　{when(doc.completed_at)}</span>}
        </div>
      )}

      <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '16px 18px' }}>
        {/* ── 머리 ── 왼쪽 문서 정보 표, 오른쪽 결재란. 좁으면 결재란이 아래로 내려간다. */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 300px', minWidth: 0, border: `1px solid ${BORDER}`, borderRadius: 6, overflow: 'hidden' }}>
            <FormRow label="문서번호" first>{doc.doc_no}</FormRow>
            <FormRow label="작성일시">{when(doc.submitted_at ?? doc.created_at)}</FormRow>
            <FormRow label="기안부서">{people[doc.requester_id]?.teams?.trim() || '-'}</FormRow>
            <FormRow label="기안자">{withPos(doc.requester_id)}</FormRow>
          </div>
          {/* 맨 앞 기안자 칸은 결재선이 아니라 문서 값으로 그린다 — 결재함 상세와 같은 결재란이다. */}
          <ApprovalTable
            lines={lines}
            people={people as Record<number, ProgressPerson>}
            currentLineId={current?.line_id ?? null}
            requesterId={doc.requester_id}
            submittedAt={doc.submitted_at}
          />
        </div>

        {/* ── 합의 · 수신및참조 · 제목 ── 합의는 있을 때만 줄을 만든다. */}
        <div style={{ marginTop: 12, border: `1px solid ${BORDER}`, borderRadius: 6, overflow: 'hidden' }}>
          {agree.length > 0 && (
            <FormRow label="합　　의" first>{agree.map(l => withPos(l.approver_id)).join(' · ')}</FormRow>
          )}
          <FormRow
            label="수신및참조"
            first={agree.length === 0}
            title={ccNames.length > 0 ? ccNames.join(' · ') : undefined}
          >
            {ccSummary(ccNames)}
          </FormRow>
          <FormRow label="제　　목">
            <span style={{ fontWeight: 700 }}>{doc.title}</span>
          </FormRow>
        </div>

        {/* ── 본문 ── 등록된 유형은 그 본문, 없으면 기존 요약 표를 양식 표 모양으로. */}
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, marginBottom: 6 }}>본문</div>
          {FormBody ? (
            /* FormBody 는 등록표의 **모듈 수준 컴포넌트**다 — 렌더마다 새로 만들지 않는다. */
            /* eslint-disable-next-line react-hooks/static-components */
            <FormBody doc={doc} />
          ) : rows.length === 0 ? (
            <div style={{ fontSize: 12, color: MUTED }}>내용이 없습니다</div>
          ) : (
            <div style={scrollBox}>
              <table style={formTable}>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.label}>
                      <th style={{ ...formTh, width: 128, borderTop: i === 0 ? 'none' : `1px solid ${BORDER}`, borderBottom: 'none' }}>
                        {r.label}
                      </th>
                      <td style={{ ...formTd, borderTop: i === 0 ? 'none' : `1px solid ${BORDER}` }}>{r.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── 첨부 ── 요약에 담긴 파일 수. 유형별 본문이 자기 첨부를 따로 그리기도 한다. */}
        <div style={{ marginTop: 12, border: `1px solid ${BORDER}`, borderRadius: 6, overflow: 'hidden' }}>
          <FormRow label="첨　　부" first>
            {files > 0 ? `${files}건` : '없음'}
          </FormRow>
        </div>

        {/* ── 이력 ── 서버가 읽어 준다(/api/approval/history). 셋을 가른다. */}
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, marginBottom: 5 }}>이력</div>
          {historyFailed ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: DANGER, fontWeight: 600 }}>이력을 불러오지 못했습니다</span>
              <button type="button" onClick={() => { void loadHistory() }}
                style={{ ...btnGhost(), padding: '4px 10px', fontSize: 12 }}>
                다시 시도
              </button>
            </div>
          ) : history === null ? (
            <div style={{ fontSize: 12, color: MUTED }}>불러오는 중...</div>
          ) : history.length === 0 ? (
            <div style={{ fontSize: 12, color: MUTED }}>기록이 없습니다</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {history.map(h => (
                <div key={h.history_id} style={{ fontSize: 12, color: SUB, lineHeight: 1.6 }}>
                  <span style={{ color: MUTED }}>{when(h.created_at)}</span>
                  <span style={{ color: FAINT }}> · </span>
                  <span style={{ fontWeight: 700, color: TEXT }}>{nameOf(h.actor_id)}</span>
                  <span style={{ color: FAINT }}> · </span>
                  <span style={{ fontWeight: 600 }}>{h.action}</span>
                  {h.comment && <span> — {h.comment}</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── 처리 ── 결재함 상세와 **같은 컴포넌트**다. 어느 줄을 그릴지는 라우트가 준 플래그로 정한다. */}
        <DocActions
          doc={doc}
          summary={doc.summary}
          scope={{ approve: can.approve, owner: can.isOwner }}
          delegated={can.delegated}
          currentApproverId={can.currentApproverId}
          nameOf={nameOf}
          onChanged={() => setReloadKey(k => k + 1)}
        />
      </div>

      {/* 결재함 목록의 강조 색과 같은 토큰을 쓴다(링크 한 곳) */}
      <div style={{ marginTop: 12, fontSize: 11, color: FAINT }}>
        <Link href={APPROVAL_PATH} style={{ color: BLUE, textDecoration: 'none' }}>결재함</Link>
      </div>
    </Shell>
  )
}

export default function ApprovalDocPage() {
  // useSearchParams 를 쓰므로 Suspense 로 감싼다(결재함·의뢰서 목록과 같은 방식).
  return (
    <Suspense fallback={null}>
      <DocPageInner />
    </Suspense>
  )
}
