'use client'

// 결재 문서의 **처리 영역** — 의견·승인·반려와 회수·재작성·폐기.
//
// 목록에서 펼치는 상세(DocDetail)와 문서 양식 화면(app/approval/doc/[id])이 **이것을 함께 쓴다.**
// 승인·반려 로직을 두 벌로 두면 한쪽만 고쳐져 어긋난다 — 라우트 호출·2단 확인·토스트 문구·
// 버튼 자리까지 전부 이 한 곳에 있다.
//
// 어떤 줄을 그릴지는 부르는 쪽이 정한다(scope). 안쪽 조건은 종전 DocDetail 과 **같은 식**이다.
//   · 목록    — scope.approve = (미결함 && 진행중), scope.owner = (상신함)
//               함에 들어왔다는 사실이 곧 「내 차례다 / 내가 올린 문서다」였다(라우트가 걸러 준다).
//   · 양식 화면 — 함이 없으므로 /api/approval/doc 이 돌려준 플래그를 그대로 쓴다
//               (그 플래그도 lib/approval/docActions.ts 의 같은 함수로 만든다).
//
// 처리 자체는 지금까지와 똑같이 /api/approval 이 한다 — 최종 권한은 그쪽이고, 여기 버튼은
// 「누를 수 있게 보이는가」만 정한다.

import { useEffect, useState } from 'react'
import { useToast } from '@/components/common/Toast'
import { MUTED, NEUTRAL_BG, SUB, btnDanger, btnGhost, btnPrimary, inputStyle } from '@/components/common/ui'
import { APPROVE_LABEL, approveLabelOf, canRejectDocument, DOC_TYPES } from '@/lib/approval/docTypes'
import { ownerActions, type ActionDoc } from '@/lib/approval/docActions'
import { sendDocSignal, type DocAction } from '@/lib/approval/docSignal'

/** 「회수」는 두 번 눌러야 실행된다. 쇼룸·첨부와 같은 3초다. */
const CONFIRM_MS = 3000

export type DocActionScope = {
  /** 의견·승인·반려 줄을 그릴지. */
  approve: boolean
  /** 회수·재작성·폐기 줄을 그릴지(「폐기한 문서입니다」 같은 안내 문구도 이 줄에 있다). */
  owner: boolean
}

export default function DocActions({
  doc, summary, scope, delegated, currentApproverId, nameOf, onChanged,
}: {
  doc: ActionDoc & { document_id: number }
  /** 유형별 반려 가능 여부·버튼 이름 판정에 쓴다(등록표가 읽는다). */
  summary: Record<string, unknown> | null | undefined
  scope: DocActionScope
  /** 위임받아 남의 차례를 처리하는가. 안내 한 줄을 띄운다. */
  delegated?: boolean
  /** 지금 차례인 결재자 — 위임 안내에 이름을 넣는다. */
  currentApproverId?: number | null
  nameOf: (id: number) => string
  /** 처리 성공 — 부르는 쪽이 다시 읽는다. */
  onChanged: () => void
}) {
  const toast = useToast()
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmWithdraw, setConfirmWithdraw] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  useEffect(() => {
    if (!confirmWithdraw) return
    const t = setTimeout(() => setConfirmWithdraw(false), CONFIRM_MS)
    return () => clearTimeout(t)
  }, [confirmWithdraw])

  useEffect(() => {
    if (!confirmDiscard) return
    const t = setTimeout(() => setConfirmDiscard(false), CONFIRM_MS)
    return () => clearTimeout(t)
  }, [confirmDiscard])

  // 반려 가능 여부와 승인 버튼 이름은 **따로** 본다.
  //   · rejectable — 반려 버튼을 그릴지. 판정은 서버 반려 라우트와 **같은 함수**다
  //     (화면에 보이는 버튼과 서버가 받는 것이 어긋나지 않게).
  //   · approveLabel — 쇼룸 사후 신청은 이미 끝난 사용이라 「확인」이다. 그래도 반려는 할 수 있다.
  // 어느 유형이 무엇인지는 등록표(lib/approval/docTypes.ts)가 안다 — 여기에 유형 이름을 적지 않는다.
  const def = DOC_TYPES[doc.doc_type]
  const rejectable = def ? canRejectDocument(def, summary) : true
  const approveLabel = def ? approveLabelOf(def, summary) : APPROVE_LABEL

  /**
   * 라우트 호출 공통 — 409 는 「이미 처리되었습니다」로 알리고 목록을 다시 읽는다.
   *
   * 성공하면 같은 출처의 다른 탭·창에 한 줄을 보낸다(lib/approval/docSignal.ts) — 문서 창에서
   * 처리했을 때 뒤에 열려 있는 결재함 목록이 묵은 상태로 남지 않게 한다. 듣는 쪽이 없으면
   * 아무 일도 일어나지 않는다. 보내는 것은 문서 id 와 동작 이름뿐이다.
   */
  const call = async (body: Record<string, unknown>, okText: string) => {
    setBusy(true)
    try {
      const res = await fetch('/api/approval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => null)
      if (res.status === 409) {
        toast.error('이미 처리된 결재입니다')
        onChanged()
        return
      }
      if (!res.ok) { toast.error(json?.error ?? '처리하지 못했습니다'); return }
      toast.success(okText)
      sendDocSignal(doc.document_id, body.action as DocAction)
      onChanged()
    } catch (e) {
      console.error('[approval/detail] action failed', e)
      toast.error('처리하지 못했습니다')
    } finally {
      setBusy(false)
    }
  }

  // 성공 토스트도 버튼 이름을 따라간다 — 「확인」을 눌렀는데 「결재했습니다」가 뜨면 말이 어긋난다.
  const approvedText = approveLabel === APPROVE_LABEL ? '결재했습니다' : `${approveLabel}했습니다`
  const approve = () => call({ action: 'approve', documentId: doc.document_id, comment: comment.trim() || undefined }, approvedText)
  const reject = () => {
    if (!comment.trim()) { toast.error('반려 사유를 입력해주세요'); return }
    call({ action: 'reject', documentId: doc.document_id, comment: comment.trim() }, '반려했습니다')
  }
  const withdraw = () => {
    if (!confirmWithdraw) { setConfirmWithdraw(true); return }
    setConfirmWithdraw(false)
    call({ action: 'withdraw', documentId: doc.document_id }, '회수했습니다')
  }
  const resubmit = () => call({ action: 'resubmit', documentId: doc.document_id }, '다시 올렸습니다')
  // 폐기 — 되돌릴 수 없으니 회수와 같은 3초 2단 확인을 둔다.
  const discard = () => {
    if (!confirmDiscard) { setConfirmDiscard(true); return }
    setConfirmDiscard(false)
    call({ action: 'discard', documentId: doc.document_id }, '폐기했습니다')
  }

  // 상신자가 할 수 있는 일 — 상태·결재선·유형만 보는 순수 판정(lib/approval/docActions.ts).
  const owner = ownerActions(doc)

  return (
    <>
      {/* 처리 */}
      {scope.approve && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* 위임받아 들어온 건 — 누구를 대신해 누르는지 먼저 알린다. 기록에는 「대결」로 남고
              결재란에는 원래 결재자의 칸에 내 이름이 찍힌다. */}
          {delegated && currentApproverId != null && (
            <div style={{ fontSize: 12, color: SUB, background: NEUTRAL_BG, borderRadius: 6, padding: '6px 10px' }}>
              {nameOf(currentApproverId)}님을 대신하여 결재합니다
            </div>
          )}
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder={rejectable ? '의견 (반려는 사유 필수)' : '의견 (선택)'}
            rows={2}
            maxLength={500}
            style={{ ...inputStyle, width: '100%', resize: 'vertical', fontSize: 13 }}
          />
          {/* 처리 버튼은 **오른쪽 아래**다 — 의견을 적고 눈이 내려오는 끝자리에 둔다.
              순서는 왼쪽 [반려] · 오른쪽 [승인] — 되돌릴 수 없는 쪽(승인)을 커서가 마지막에 닿는 자리에 둔다.
              반려를 그리지 않는 유형(쇼룸 사후 신청)에서는 [확인] 하나만 오른쪽 끝에 남는다. */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            {rejectable && (
              <button type="button" onClick={reject} disabled={busy || !comment.trim()} style={btnDanger(busy || !comment.trim())}>
                반려
              </button>
            )}
            <button type="button" onClick={approve} disabled={busy} style={btnPrimary(busy)}>
              {busy ? '처리 중...' : approveLabel}
            </button>
          </div>
        </div>
      )}

      {scope.owner && (
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          {owner.withdraw && (
            <button type="button" onClick={withdraw} disabled={busy}
              style={confirmWithdraw ? btnDanger(busy) : btnGhost(busy)}>
              {confirmWithdraw ? '한 번 더 누르면 회수' : '회수'}
            </button>
          )}
          {/* 재작성·폐기는 같은 조건에서 함께 나온다 — 다시 올리거나, 치우거나 둘 중 하나다.
              폐기한 문서에는 둘 다 나오지 않는다(되살리려면 새로 상신한다). */}
          {owner.discard && (
            <>
              {owner.resubmit && (
                <button type="button" onClick={resubmit} disabled={busy} style={btnPrimary(busy)}>
                  {busy ? '처리 중...' : '재작성'}
                </button>
              )}
              <button type="button" onClick={discard} disabled={busy}
                style={confirmDiscard ? btnDanger(busy) : btnGhost(busy)}>
                {confirmDiscard ? '한 번 더 누르면 폐기' : '폐기'}
              </button>
            </>
          )}
          {doc.status === '폐기' && (
            <span style={{ fontSize: 12, color: MUTED, background: NEUTRAL_BG, borderRadius: 6, padding: '6px 10px' }}>
              폐기한 문서입니다. 다시 올리려면 새로 상신해주세요
            </span>
          )}
          {doc.status === '진행중' && !owner.withdraw && (
            <span style={{ fontSize: 12, color: MUTED, background: NEUTRAL_BG, borderRadius: 6, padding: '6px 10px' }}>
              이미 결재가 시작되어 회수할 수 없습니다
            </span>
          )}
        </div>
      )}
    </>
  )
}
