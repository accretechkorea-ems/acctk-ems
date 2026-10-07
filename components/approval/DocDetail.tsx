'use client'

// 문서 상세 — 목록 행 아래에서 그대로 펼쳐진다(아코디언). 목록을 떠나지 않고 처리한다.
//
// 아마란스 문서 양식을 따른다. 위에서부터
//   머리(왼쪽 문서 정보 표 · 오른쪽 결재표) → 문서 내용(요약) → 이력
//   → 「상기와 같이 …를 제출합니다」 → 처리 버튼
// 처리 버튼은 미결함에서만 보이고, 상신함은 회수·재작성, 참조함은 아무 버튼도 두지 않는다.
//
// 이력은 **서버가 읽어 준다**(/api/approval/history) — 열람 권한을 그 라우트가 코드로 보고
// service role 로 읽는다. 브라우저로 직접 읽던 때는 approval_history 의 RLS·테이블 권한에 막히면
// 빈 배열이 되어, 막힌 것과 정말 0건인 것을 가를 수 없었다(상신 직후에도 「기록이 없습니다」).

import { useCallback, useEffect, useState } from 'react'
import { BORDER, DANGER, FAINT, MUTED, SUB, TEXT, btnGhost } from '@/components/common/ui'
import ApprovalTable, { type ProgressPerson } from './ApprovalTable'
import DocActions from './DocActions'
import DocInfo from './DocInfo'
import { summaryRows } from './summary'
import { panelOf } from './panels'
import { nextPendingLine } from '@/lib/approval/engine'
import { DOC_TYPES } from '@/lib/approval/docTypes'
import type { ApprovalLine, ApprovalDocument } from '@/lib/approval/types'

export type ApprovalDoc = ApprovalDocument & {
  approval_lines: ApprovalLine[]
  progress?: { total: number; done: number; currentStep: number | null; currentApproverId: number | null }
  delegated?: boolean
}

type HistoryRow = {
  history_id: number
  action: string
  actor_id: number
  step: number | null
  comment: string | null
  created_at: string
}

/** 「…을/를」 — 마지막 글자의 받침으로 고른다. 문서 종류 이름이 유형마다 달라 규칙으로 둔다. */
const objectParticle = (word: string): string => {
  const code = word.charCodeAt(word.length - 1)
  if (code < 0xac00 || code > 0xd7a3) return '를'
  return (code - 0xac00) % 28 === 0 ? '를' : '을'
}

const when = (iso: string | null): string => {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function DocDetail({
  doc, people, box, onChanged,
}: {
  doc: ApprovalDoc
  people: Record<number, ProgressPerson>
  /** 어느 함에서 펼쳤는가 — 버튼 구성이 갈린다. */
  box: 'pending' | 'done' | 'outbox' | 'cc' | 'all'
  /** 처리 성공 — 목록을 다시 읽게 한다. */
  onChanged: () => void
}) {
  // null = 불러오는 중, [] = 정말 0건. 실패는 따로 둔다 — 셋이 전혀 다른 말이다.
  const [history, setHistory] = useState<HistoryRow[] | null>(null)
  const [historyFailed, setHistoryFailed] = useState(false)

  /**
   * 이력을 읽는다. **서버가 읽어 준다**(/api/approval/history) — 브라우저로 직접 읽던 때는
   * approval_history 의 RLS·테이블 권한에 걸리면 빈 배열이 되어, 막힌 것인지 정말 없는 것인지
   * 가를 수 없었다(상신 직후에도 「기록이 없습니다」로 보였다).
   *
   * 캐시는 두지 않는다 — 승인·반려·회수를 누르면 이력이 바로 늘어나는 값이라, 묵은 것을 보여 주면
   * 방금 한 일이 빠져 보인다.
   */
  const loadHistory = useCallback(async (signal?: AbortSignal) => {
    setHistory(null)
    setHistoryFailed(false)
    try {
      const res = await fetch(`/api/approval/history?document_id=${doc.document_id}`, { signal })
      const json = await res.json().catch(() => null)
      if (signal?.aborted) return
      if (!res.ok || !Array.isArray(json?.history)) {
        console.error('[approval/detail] history load failed', { documentId: doc.document_id, status: res.status, error: json?.error })
        setHistoryFailed(true)
        return
      }
      setHistory(json.history as HistoryRow[])
    } catch (e) {
      // 문서를 바꿔 펼치면 앞 요청이 취소된다 — 그것은 실패가 아니다(늦은 응답을 버리는 길이다).
      if (signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) return
      console.error('[approval/detail] history load failed', { documentId: doc.document_id, error: e })
      setHistoryFailed(true)
    }
  }, [doc.document_id])

  useEffect(() => {
    // 문서가 바뀌면 앞 요청을 끊는다 — 늦게 온 남의 문서 이력이 화면에 들어오지 않게.
    //
    // loadHistory 는 시작하면서 history 를 null(= 불러오는 중)로 되돌린다. 그 자리를 효과 밖으로
    // 옮길 수 없다 — 문서를 바꾸는 순간 앞 문서의 이력을 **먼저** 지워야 남의 기록이 한 프레임
    // 보이지 않는다. 저장소의 같은 규칙 선례(app/approval/page.tsx·app/activity/page.tsx)와 같다.
    const ac = new AbortController()
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadHistory(ac.signal)
    return () => ac.abort()
  }, [loadHistory])

  const nameOf = (id: number) => people[id]?.name ?? `#${id}`
  const current = nextPendingLine(doc.approval_lines)
  // 요약·유형 이름에 쓰는 등록표. 반려 가능 여부·버튼 이름은 DocActions 가 같은 등록표로 본다.
  const def = DOC_TYPES[doc.doc_type]
  const rows = summaryRows(doc.doc_type, doc.summary)
  const docLabel = def?.label ?? doc.doc_type
  // 유형별 추가 패널(견적서 검토표 등). 등록표가 고른다 — 여기에 유형 이름을 적지 않는다.
  const Panel = panelOf(doc.doc_type)

  const rejectedLine = doc.approval_lines.find(l => l.state === '반려')

  return (
    <div style={{ padding: '12px 12px 14px', background: '#fafafa', borderTop: `1px solid ${BORDER}` }}>
      {/* 머리 — 왼쪽 문서 정보, 오른쪽 결재표. 좁으면 결재표가 아래로 내려간다. */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 300px', minWidth: 0 }}>
          <DocInfo
            docNo={doc.doc_no}
            submittedAt={doc.submitted_at ?? doc.created_at}
            requesterId={doc.requester_id}
            title={doc.title}
            lines={doc.approval_lines}
            people={people}
          />
        </div>
        {/* 맨 앞 기안자 칸은 결재선이 아니라 문서 값으로 그린다 — 판정이 기안자를 결재자로 세지 않는다. */}
        <ApprovalTable
          lines={doc.approval_lines}
          people={people}
          currentLineId={current?.line_id ?? null}
          requesterId={doc.requester_id}
          submittedAt={doc.submitted_at}
        />
      </div>

      {/* 문서 내용 — 유형별 항목은 summary.ts 가 뽑는다. */}
      {rows.length > 0 && (
        <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 12px' }}>
          {rows.map(r => (
            <div key={r.label} style={{ display: 'contents' }}>
              <span style={{ fontSize: 12, color: MUTED }}>{r.label}</span>
              <span style={{ fontSize: 13, color: TEXT, wordBreak: 'break-word' }}>{r.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* 유형별 추가 패널 — 등록표(panels.ts)가 고른다. `if (doc_type === …)` 분기를 두지 않는다
          (summary.ts 와 같은 방식). 등록되지 않은 유형은 Panel 이 null 이라 아무것도 그리지 않는다.
          패널이 실패해도 아래 처리 버튼은 그대로 동작한다 — 자기 영역에서만 오류를 알린다. */}
      {/* Panel 은 panelOf 가 등록표에서 꺼내 온 **모듈 수준 컴포넌트**다 — 렌더마다 새로 만들지
          않으므로 상태가 초기화되지 않는다. 규칙이 panelOf 안을 들여다볼 수 없어 경고만 남는다. */}
      {/* eslint-disable-next-line react-hooks/static-components */}
      {Panel && <Panel documentId={doc.document_id} />}

      {/* 반려 사유는 눈에 띄게 따로 */}
      {doc.status === '반려' && rejectedLine?.comment && (
        <div style={{ marginTop: 12, border: `1px solid ${BORDER}`, borderRadius: 6, padding: '8px 10px' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: DANGER }}>반려 사유</span>
          <div style={{ fontSize: 13, color: TEXT, marginTop: 3, wordBreak: 'break-word' }}>{rejectedLine.comment}</div>
        </div>
      )}

      {/* 이력 */}
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, marginBottom: 5 }}>이력</div>
        {/* 세 상태를 가른다 — 못 읽은 것을 「기록이 없습니다」로 적지 않는다. */}
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

      {/* 문서를 닫는 한 줄 — 아마란스 문서 맨 아래에 늘 붙는 문구다. */}
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${BORDER}`, textAlign: 'center', fontSize: 12, color: SUB }}>
        상기와 같이 {docLabel}{objectParticle(docLabel)} 제출합니다
      </div>

      {/* 처리 — 의견·승인·반려와 회수·재작성·폐기. **문서 양식 화면과 같은 컴포넌트다**
          (components/approval/DocActions.tsx). 어느 줄을 그릴지만 여기서 정한다:
          미결함에 들어온 진행중 문서면 승인·반려, 상신함이면 회수·재작성·폐기.
          그 함에 들어왔다는 사실이 곧 「내 차례다 / 내가 올린 문서다」다(라우트가 걸러 준다). */}
      <DocActions
        doc={doc}
        summary={doc.summary}
        scope={{ approve: box === 'pending' && doc.status === '진행중', owner: box === 'outbox' }}
        delegated={doc.delegated}
        currentApproverId={current?.approver_id ?? null}
        nameOf={nameOf}
        onChanged={onChanged}
      />
    </div>
  )
}
