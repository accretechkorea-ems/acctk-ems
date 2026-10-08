'use client'

// 결재 문서의 **처리 영역** — 의견·승인·반려와 회수·재작성·삭제.
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
//
// **삭제**(회수·폐기된 문서를 치운다)는 종류에 따라 가는 곳이 다르다 — 결재 문서만 지우는
// 종류는 /api/approval 의 delete 로, 원 문서까지 치워야 하는 종류는 업무별 라우트로 간다
// (원 문서의 참조·스토리지·감사를 함께 치워야 한다). 어디로 무엇을 보낼지는 **등록표**
// (lib/approval/docTypes.ts 의 deleteWhenClosed)가 말해 준다 — 여기에 유형 이름을 적지 않는다.

import { useEffect, useState } from 'react'
import { useToast } from '@/components/common/Toast'
import { MUTED, NEUTRAL_BG, SUB, btnDanger, btnGhost, btnPrimary, inputStyle } from '@/components/common/ui'
import { APPROVE_LABEL, approveLabelOf, canRejectDocument, DOC_TYPES } from '@/lib/approval/docTypes'
import { ownerActions, processedCount, type ActionDoc, type OwnerActions } from '@/lib/approval/docActions'
import { sendDocSignal, type DocAction } from '@/lib/approval/docSignal'

/** 「회수」는 두 번 눌러야 실행된다. 쇼룸·첨부와 같은 3초다. */
const CONFIRM_MS = 3000

export type DocActionScope = {
  /** 의견·승인·반려 줄을 그릴지. */
  approve: boolean
  /** 회수·재작성·삭제 줄을 그릴지(버튼이 없을 때의 안내 문구도 이 줄에 있다). */
  owner: boolean
}

export default function DocActions({
  doc, summary, scope, delegated, currentApproverId, nameOf, onChanged, onDeleted,
}: {
  doc: ActionDoc & { document_id: number; target_id?: number | null }
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
  /**
   * 문서가 **없어졌을 때** — 다시 읽을 것이 없으므로 부르는 쪽이 자리를 떠야 한다.
   * (목록은 목록을 다시 읽고, 문서 창은 창을 닫거나 결재함으로 간다.)
   * 주지 않으면 onChanged 를 부른다.
   */
  onDeleted?: () => void
}) {
  const toast = useToast()
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmWithdraw, setConfirmWithdraw] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!confirmWithdraw) return
    const t = setTimeout(() => setConfirmWithdraw(false), CONFIRM_MS)
    return () => clearTimeout(t)
  }, [confirmWithdraw])

  useEffect(() => {
    if (!confirmDelete) return
    const t = setTimeout(() => setConfirmDelete(false), CONFIRM_MS)
    return () => clearTimeout(t)
  }, [confirmDelete])

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

  /**
   * 삭제 — 회수·폐기된 문서를 치운다. 되돌릴 수 없어 3초 2단 확인을 둔다.
   *
   * 라우트·본문 열쇠·사유는 등록표가 준다(cd) — 종류에 따라 결재 문서만 지우거나 원 문서까지
   * 함께 지운다. 성공하면 **다시 읽지 않는다** — 문서가 없다.
   * 409·403 은 라우트의 문구를 그대로 보여 준다(판정은 그쪽이 최종이다).
   */
  const removeAll = async (cd: NonNullable<OwnerActions['deleteClosed']>) => {
    if (!confirmDelete) { setConfirmDelete(true); return }
    setConfirmDelete(false)
    // 보낼 id — 원 문서까지 지우는 종류는 target_id, 문서만 지우는 종류는 document_id.
    const id = cd.idFrom === 'target' ? doc.target_id : doc.document_id
    if (id == null) { toast.error('지울 대상을 알 수 없습니다'); return }
    setBusy(true)
    try {
      const res = await fetch(cd.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          [cd.idKey]: id,
          action: cd.action,
          ...(cd.reason ? { reason: cd.reason } : {}),
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) { toast.error(json?.error ?? '삭제하지 못했습니다'); return }
      toast.success('삭제했습니다')
      // 목록·다른 창에도 알린다 — 지워진 문서가 묵은 목록에 남지 않게.
      sendDocSignal(doc.document_id, 'delete')
      ;(onDeleted ?? onChanged)()
    } catch (e) {
      console.error('[approval/detail] delete failed', e)
      toast.error('삭제하지 못했습니다')
    } finally {
      setBusy(false)
    }
  }

  // 상신자가 할 수 있는 일 — 상태·결재선·유형만 보는 순수 판정(lib/approval/docActions.ts).
  const owner = ownerActions(doc)
  // 이미 결재한 사람 수. 종결 전이면 결재가 시작된 뒤에도 회수할 수 있으므로,
  // 「무엇이 무효가 되는지」를 누르기 전에 알린다(0 이면 지금까지와 같은 확인 문구만 나온다).
  const processed = processedCount(doc.approval_lines)

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
        <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          {/* 결재가 이미 시작된 문서를 회수하려 할 때 — 무엇이 무효가 되는지 먼저 말한다.
              시작 전(처리 0명) 회수는 지금까지와 같이 버튼의 2단 확인만 둔다. */}
          {owner.withdraw && confirmWithdraw && processed > 0 && (
            <span style={{ width: '100%', fontSize: 12, color: SUB, background: NEUTRAL_BG, borderRadius: 6, padding: '6px 10px' }}>
              이미 {processed}명이 결재했습니다. 회수하면 결재자에게 알림이 가고 결재가 중단됩니다
            </span>
          )}
          {owner.withdraw && (
            <button type="button" onClick={withdraw} disabled={busy}
              style={confirmWithdraw ? btnDanger(busy) : btnGhost(busy)}>
              {confirmWithdraw ? '한 번 더 누르면 회수' : '회수'}
            </button>
          )}
          {/* 재작성 — 반려·회수된 문서를 같은 문서로 다시 올린다(허용한 종류만). */}
          {owner.resubmit && (
            <button type="button" onClick={resubmit} disabled={busy} style={btnPrimary(busy)}>
              {busy ? '처리 중...' : '재작성'}
            </button>
          )}
          {/* 삭제 — 회수·폐기된 문서를 치운다. 어느 종류가 이 버튼을 갖는지는 등록표가 정한다
              (owner.deleteClosed 가 null 이면 없다). 반려·완료 문서에는 나오지 않는다. */}
          {owner.deleteClosed && (
            <>
              {confirmDelete && (
                <span style={{ width: '100%', fontSize: 12, color: SUB, background: NEUTRAL_BG, borderRadius: 6, padding: '6px 10px' }}>
                  {owner.deleteClosed.confirmText}
                </span>
              )}
              <button type="button" onClick={() => removeAll(owner.deleteClosed!)} disabled={busy}
                style={confirmDelete ? btnDanger(busy) : btnGhost(busy)}>
                {busy ? '처리 중...' : confirmDelete ? '한 번 더 누르면 삭제' : '삭제'}
              </button>
            </>
          )}
          {/* 반려 문서는 기록으로 남는다 — 치우는 버튼도, 지우는 버튼도 두지 않는다. */}
          {owner.rejectedNotice && (
            <span style={{ fontSize: 12, color: MUTED, background: NEUTRAL_BG, borderRadius: 6, padding: '6px 10px' }}>
              {owner.rejectedNotice}
            </span>
          )}

        </div>
      )}
    </>
  )
}
