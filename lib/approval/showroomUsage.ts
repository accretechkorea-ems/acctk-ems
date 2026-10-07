// 쇼룸 사용 신청 유형의 실행 함수. lib/approval/docTypes.ts 의 훅이 이 파일을 지연 import 해서 부른다.
//
// 서버 전용이다 — service role 로 쓰고 승인서 PDF(@react-pdf/renderer)를 만든다.
// 화면에서 import 하지 마라(docTypes.ts 가 훅 안에서만 불러오는 이유다).
//
// 사전/사후 갈림
//   사전 신청(계획일이 내일 이후) — 상신 때는 기록을 만들지 않고, 결재가 끝난 뒤 사용 기록을 만든다.
//     완료 직전에 겹침을 한 번 더 본다(beforeComplete) — 결재가 도는 동안 남이 그 시간을 쓸 수 있다.
//   사후 신청(계획일이 오늘 이하) — 이미 끝난 사용이라 상신 때 기록을 만들어 두었다(쇼룸 라우트가 한다).
//     결재는 「확인」일 뿐이므로 완료 시 기록에 손대지 않고 승인서에 도장만 찍는다.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { DemoRequestPayload } from '@/lib/showroom'
import {
  createUsageFromRequest, findOverlap, pdfDataFromPayload, renderApprovalPdf, dropApprovalPdf,
  type ApprovalStamp,
} from '@/app/api/showroom/requests/shared'
import type { ApprovalLine } from './types'

const TAG = 'approval/showroomUsage'

const admin = (): SupabaseClient => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

/**
 * 쇼룸 사용 신청 문서의 summary.
 * payload 는 신청 내용 전부(옛 요청함과 같은 모양) — 엔진은 원 테이블을 읽지 않으므로 여기 담아 둔다.
 * 그 위의 칸들은 목록·상세에 그대로 보여 주는 사람이 읽는 요약이다.
 */
export type ShowroomSummary = {
  device: string
  usage: string
  purpose: string
  customer: string
  kind: '사전 신청' | '사후 신청'
  is_retroactive: boolean
  /** 승인서 PDF 의 버킷 안 경로. 결재가 끝나면 도장이 찍힌 파일로 바뀐다. */
  pdf_url?: string | null
  /** 만들어진 사용 기록. 사후는 상신 때, 사전은 결재 완료 때 채워진다. */
  usage_id?: number | null
  payload: DemoRequestPayload
}

/** summary 를 쇼룸 모양으로 읽는다. 모양이 아니면 null — 부르는 쪽이 조용히 넘어간다. */
export function readSummary(summary: Record<string, unknown> | null | undefined): ShowroomSummary | null {
  const s = summary as ShowroomSummary | null | undefined
  if (!s || typeof s !== 'object' || !s.payload || typeof s.payload !== 'object') return null
  if (!s.payload.request_no || !s.payload.device_id) return null
  return s
}

/** 사후 신청인가 — 반려 가능 여부 판정에 쓴다(사후는 「확인」뿐이라 반려가 없다). */
export function isRetroactive(summary: Record<string, unknown> | null | undefined): boolean {
  const s = readSummary(summary)
  return s ? s.is_retroactive === true || s.payload.is_retroactive === true : false
}

/** 사람이 읽는 요약을 신청 내용에서 만든다. 상신하는 쪽(쇼룸 라우트)이 쓴다. */
export function buildSummary(p: DemoRequestPayload, opts?: { usageId?: number | null; pdfUrl?: string | null }): ShowroomSummary {
  return {
    device: p.device_name,
    usage: `${p.usage_date} ${p.start_time.slice(0, 5)}~${p.end_time.slice(0, 5)}`,
    purpose: p.purpose ?? '고객 데모',
    customer: p.customer_name ?? '',
    kind: p.is_retroactive ? '사후 신청' : '사전 신청',
    is_retroactive: p.is_retroactive,
    usage_id: opts?.usageId ?? null,
    pdf_url: opts?.pdfUrl ?? null,
    payload: p,
  }
}

/** summary 를 통째로 다시 쓴다(부분 갱신). 결재 문서의 summary 는 이 유형만 손댄다. */
async function patchSummary(sb: SupabaseClient, documentId: number, next: ShowroomSummary) {
  const { error } = await sb
    .from('approval_documents')
    .update({ summary: next, updated_at: new Date().toISOString() })
    .eq('document_id', documentId)
  if (error) console.error(`[${TAG}] summary update failed`, { documentId, error })
}

/** 결재선을 승인서 결재란으로 바꾼다 — 순서대로, 처리 전 칸은 날짜를 비운다. */
async function stampsOf(sb: SupabaseClient, lines: ApprovalLine[]): Promise<ApprovalStamp[]> {
  const ordered = lines
    .filter(l => l.kind !== 'cc')
    .sort((a, b) => (a.step ?? 0) - (b.step ?? 0) || a.line_id - b.line_id)
  const ids = [...new Set(ordered.flatMap(l => (l.acted_by != null ? [l.approver_id, l.acted_by] : [l.approver_id])))]
  const names = new Map<number, { name: string; position: string }>()
  if (ids.length > 0) {
    const { data, error } = await sb.from('engineers').select('engineer_id, name, position').in('engineer_id', ids)
    if (error) console.error(`[${TAG}] engineer lookup failed`, error)
    for (const e of (data ?? []) as { engineer_id: number; name: string | null; position: string | null }[]) {
      names.set(e.engineer_id, { name: e.name ?? '', position: e.position ?? '' })
    }
  }
  const ymd = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : '')
  return ordered.map(l => {
    // 도장에는 실제로 누른 사람 이름을 찍는다(대결이면 대리인). 칸 제목은 원래 결재자다.
    const owner = names.get(l.approver_id) ?? { name: '', position: '' }
    const actor = l.acted_by != null ? names.get(l.acted_by) ?? owner : owner
    const done = l.state === '승인' || l.state === '전결' || l.state === '대결'
    return {
      name: done ? (actor.name || '-') : owner.name,
      position: owner.position,
      date: done ? ymd(l.acted_at) : '',
      label: l.state === '대기' ? '' : l.state,
    }
  })
}

/** 승인서 PDF 를 지금 상태로 다시 만들고 summary.pdf_url 을 바꾼다. 옛 파일은 지운다. */
async function refreshPdf(
  sb: SupabaseClient, documentId: number, s: ShowroomSummary, lines: ApprovalLine[],
  o: { statusLabel: string; tag: string; opinion: string },
): Promise<void> {
  const data = pdfDataFromPayload(s.payload, {
    requestDate: new Date().toISOString().slice(0, 10),
    statusLabel: o.statusLabel,
    stamps: await stampsOf(sb, lines),
    opinion: o.opinion,
  })
  const path = await renderApprovalPdf(sb, `${s.payload.request_no}-${o.tag}`, data)
  if (!path) {
    // PDF 는 결재 결과가 아니다 — 실패해도 결재는 그대로 두고 기록만 남긴다.
    console.error(`[${TAG}] pdf refresh failed`, { documentId })
    return
  }
  const old = s.pdf_url ?? null
  await patchSummary(sb, documentId, { ...s, pdf_url: path })
  if (old && old !== path) await dropApprovalPdf(sb, old)
}

/**
 * 완료 직전 점검 — 사전 신청만 본다. 겹치는 사용 기록이 있으면 사람이 읽을 메시지를 돌려주고,
 * 그러면 마지막 승인이 막힌다 — 결재자에게 「기록을 정리한 뒤 결재해주세요」로 돌려준다.
 */
export async function beforeCompleteShowroom(ctx: { documentId: number; summary: Record<string, unknown> }): Promise<string | null> {
  const s = readSummary(ctx.summary)
  if (!s || s.is_retroactive) return null
  const p = s.payload
  const sb = admin()
  const ov = await findOverlap(sb, p.device_id, p.usage_date, p.start_time, p.end_time)
  if (ov.error) return '사용 기록을 확인하지 못했습니다. 잠시 뒤 다시 시도해주세요.'
  if (ov.clash) return `같은 장비·같은 날 겹치는 사용 기록이 있습니다 (${ov.clash}). 기록을 정리한 뒤 결재해주세요.`
  return null
}

/**
 * 결재 완료 — 사전 신청이면 사용 기록을 만들고, 두 경우 모두 승인서에 도장을 찍는다.
 * 여기서 실패해도 결재 자체는 이미 끝났다(라우트가 기록만 남긴다).
 */
export async function onCompleteShowroom(ctx: {
  documentId: number
  summary: Record<string, unknown>
  requesterId: number
  lines: ApprovalLine[]
}): Promise<void> {
  const s = readSummary(ctx.summary)
  if (!s) {
    console.error(`[${TAG}] summary 모양이 아니다 — 아무것도 하지 않는다`, { documentId: ctx.documentId })
    return
  }
  const sb = admin()
  let next = s

  if (!s.is_retroactive && s.usage_id == null) {
    // 사전 신청 — 계획 시간을 실제 시간으로 넣는다(나중에 신청자가 고친다). 작성자는 신청자.
    // 문서가 이미 있으므로 document_id 를 넣으면서 만든다(기록 → 문서 연결).
    const made = await createUsageFromRequest(sb, null, s.payload, ctx.requesterId, ctx.documentId)
    if ('error' in made) {
      console.error(`[${TAG}] usage 생성 실패`, { documentId: ctx.documentId, error: made.error })
      // 기록 없이 완료로 남는다 — 결재를 되돌릴 수는 없으므로 상신자에게 알려 손으로 처리하게 한다.
      const { error } = await sb.from('notifications').insert({
        engineer_id: ctx.requesterId,
        title: '쇼룸 사용 기록을 만들지 못했습니다',
        message: `[${s.payload.request_no}] 결재는 완료됐지만 사용 기록 생성에 실패했습니다 (${made.error}). 기록을 직접 추가해주세요.`,
        type: 'approval_completed',
        link: '/showroom?tab=usage',
        is_read: false,
      })
      if (error) console.error(`[${TAG}] 실패 알림 insert failed`, error)
    } else {
      next = { ...s, usage_id: made.usageId }
      await patchSummary(sb, ctx.documentId, next)
      // 문서 → 기록 연결. showroom_usage.request_id 는 옛 표를 가리키는 FK 라 여기로 잡는다.
      const { error } = await sb
        .from('approval_documents')
        .update({ target_id: made.usageId })
        .eq('document_id', ctx.documentId)
      if (error) console.error(`[${TAG}] target_id update failed`, { documentId: ctx.documentId, error })
    }
  }

  await refreshPdf(sb, ctx.documentId, next, ctx.lines, {
    statusLabel: s.is_retroactive ? '확인' : '승인',
    tag: s.is_retroactive ? 'confirmed' : 'approved',
    opinion: lastComment(ctx.lines),
  })
}

/**
 * 결재가 완료되지 않고 끝났을 때 — **사후 신청의 사용 기록을 치운다.**
 *
 * 반려·회수·폐기 세 경우에 모두 불린다(app/api/approval/route.ts 의 runRevert). 셋을 나누지 않는
 * 이유는 handlers.ts 의 설명과 같다 — 원 기록 쪽에서 보면 「상신 때 만들어 둔 것을 되돌린다」 한 가지다.
 *   · 사전 신청 — 기록이 아직 없다. 아무것도 하지 않는다.
 *   · 사후 신청 — 상신 때 만든 기록을 지운다. **반려·회수·폐기 모두 같은 길로 온다**
 *     (사후 신청의 반려는 docTypes.ts 에서 열려 있다). 상신자는 「재작성」으로 고쳐 다시 올리고,
 *     그때 사용 기록이 다시 만들어진다(app/api/showroom/requests PATCH).
 *
 * **여러 번 불려도 탈이 없어야 한다** — 폐기는 반려·회수된 문서에만 할 수 있어 이 훅이 두 번 불린다.
 * 그래서 summary.usage_id 를 비우고 target_id 를 null 로 만든 뒤 지운다. 두 번째 호출은 읽을 id 가
 * 없어 그대로 돌아간다.
 *
 * 실패해도 던지지 않는다 — 회수·폐기 전이는 이미 끝났고, runRevert 가 기록만 남긴다
 * (quote_delete 의 onRevertQuoteDelete 와 같은 규칙).
 */
export async function onRevertShowroom(ctx: {
  documentId: number
  docNo: string
  targetId: number | null
  summary: Record<string, unknown>
  /** 상신자 — 기록이 지워졌다는 보조 알림을 받는 사람. */
  requesterId: number
  /** 이 되돌리기를 일으킨 사람. 상신자와 다르면 반려다(회수·폐기는 본인만 할 수 있다). */
  actorId: number
}): Promise<void> {
  const s = readSummary(ctx.summary)
  if (!s) {
    console.error(`[${TAG}] summary 모양이 아니다 — 되돌릴 것을 알 수 없다`, { documentId: ctx.documentId })
    return
  }
  // 사전 신청은 상신 때 기록을 만들지 않는다. 완료 뒤에 만들어진 기록은 회수·폐기 대상이 아니다
  // (완료된 문서는 회수·폐기할 수 없다 — 라우트가 '진행중'·'반려'·'회수' 만 받는다).
  if (!s.is_retroactive) return

  const usageId = s.usage_id ?? ctx.targetId
  if (usageId == null) return   // 이미 치웠다(두 번째 호출)

  const sb = admin()

  // 방어 — 이 기록이 **정말 이 문서의 것인가**. 옛 요청함 건(request_id)이거나 남의 문서에 묶인
  // 기록이면 손대지 않는다. document_id 가 아직 null 인 과거 기록은 target_id 로만 이어져 있어
  // 통과시킨다(그 경우에도 document 쪽이 이 기록을 가리키고 있는 것은 위에서 확인했다).
  const { data: row, error: readErr } = await sb
    .from('showroom_usage')
    .select('usage_id, document_id, request_id, device_id, usage_date, start_time, end_time')
    .eq('usage_id', usageId)
    .maybeSingle()
  if (readErr) {
    console.error(`[${TAG}] usage lookup failed`, { documentId: ctx.documentId, usageId, error: readErr })
    return
  }
  const usage = (row ?? null) as {
    usage_id: number; document_id: number | null; request_id: number | null
    device_id: number; usage_date: string; start_time: string; end_time: string
  } | null
  if (!usage) {
    // 사람이 먼저 지웠다. summary 만 비워 두고 끝낸다.
    await clearUsageLink(sb, ctx.documentId, s)
    return
  }
  if (usage.request_id != null || (usage.document_id != null && usage.document_id !== ctx.documentId)) {
    console.error(`[${TAG}] 이 문서의 기록이 아니다 — 지우지 않는다`, {
      documentId: ctx.documentId, usageId, usageDocumentId: usage.document_id, requestId: usage.request_id,
    })
    return
  }

  // 지우기 전에 감사 기록. 무엇이 사라지는지(장비·사용일·시간)를 남긴다 — 사용 기록은 장비 가동률의
  // 원본이라 「왜 줄었는지」를 나중에 설명할 수 있어야 한다. 실패해도 삭제는 막지 않는다.
  await writeRevertAudit(sb, {
    documentId: ctx.documentId, docNo: ctx.docNo, actorId: ctx.actorId,
    usage: {
      usage_id: usage.usage_id, device_id: usage.device_id,
      usage_date: usage.usage_date, start_time: usage.start_time, end_time: usage.end_time,
    },
  })

  // 문서 → 기록 연결을 먼저 끊는다. 지우기가 실패해도 문서가 없는 기록을 가리키지 않게.
  await clearUsageLink(sb, ctx.documentId, s)

  // 참여 엔지니어(showroom_usage_engineers)는 usage_id 가 ON DELETE CASCADE 라 함께 사라진다.
  const { error: delErr } = await sb.from('showroom_usage').delete().eq('usage_id', usageId)
  if (delErr) {
    console.error(`[${TAG}] usage delete failed`, { documentId: ctx.documentId, usageId, error: delErr })
    return
  }

  // 도장 없는 승인서 PDF 를 치운다. 재작성하면 새로 만들어지므로(makePdf, tag 'rev') 남길 이유가 없다.
  // 실패해도 회수·폐기는 그대로다 — 파일 하나가 남는 것과 결재가 안 되는 것은 다른 일이다.
  if (s.pdf_url) await dropApprovalPdf(sb, s.pdf_url)

  console.log(`[${TAG}] 사후 신청 기록 정리`, { documentId: ctx.documentId, docNo: ctx.docNo, usageId })

  await notifyUsageRemoved(sb, ctx, s)
}

/**
 * 「사용 기록도 지워졌다」 보조 알림 — **남이 끝낸 경우에만** 보낸다.
 *
 * 왜 여기서 보내는가. 결재 라우트의 반려 알림은 「제목 — 사유」 한 줄이고 문서 유형을 모른다
 * (app/api/approval/route.ts 의 reject). 그 문구에 쇼룸 사정을 넣으려면 라우트에 유형 분기가
 * 생긴다 — 그러지 않기로 한 구조라서, 쇼룸 훅이 자기 몫을 한 줄 더 보낸다.
 *
 * 왜 actorId !== requesterId 로 가르는가. **회수·폐기는 상신자 본인만 할 수 있다**(라우트가
 * 403 으로 막는다). 그래서 남이 끝낸 경우는 반려뿐이고, 자기가 치운 것을 자기에게 알리지 않는다.
 * 훅은 여러 번 불릴 수 있지만 이 함수는 **기록을 실제로 지운 호출에서만** 지나간다(두 번째 호출은
 * 읽을 usage_id 가 없어 그 전에 돌아간다).
 *
 * best-effort 다 — 실패해도 결재 상태와 기록 정리는 이미 끝났다.
 */
async function notifyUsageRemoved(
  sb: SupabaseClient,
  ctx: { documentId: number; docNo: string; requesterId: number; actorId: number },
  s: ShowroomSummary,
): Promise<void> {
  if (ctx.actorId === ctx.requesterId) return
  const { error } = await sb.from('notifications').insert({
    engineer_id: ctx.requesterId,
    title: '쇼룸 사용 기록이 정리되었습니다',
    message: `[${s.payload.request_no}] 사후 신청이 반려되어 사용 기록을 지웠습니다. `
      + '내용을 고쳐 「재작성」으로 다시 올리면 기록이 다시 만들어집니다.',
    type: 'approval_rejected',
    link: '/showroom?tab=usage',
    is_read: false,
  })
  if (error) console.error(`[${TAG}] 기록 정리 알림 insert failed`, { documentId: ctx.documentId, error })
}

/**
 * summary.usage_id·pdf_url 과 문서의 target_id 를 비운다.
 * 두 번째 호출(폐기)이 같은 기록을 또 지우려 하지 않게 하고, 재작성 때 기록을 다시 만들게 한다
 * (PATCH 가 before.usage_id 가 null 인지로 그 판단을 한다).
 */
async function clearUsageLink(sb: SupabaseClient, documentId: number, s: ShowroomSummary) {
  await patchSummary(sb, documentId, { ...s, usage_id: null, pdf_url: null })
  const { error } = await sb.from('approval_documents').update({ target_id: null }).eq('document_id', documentId)
  if (error) console.error(`[${TAG}] target_id clear failed`, { documentId, error })
}

/**
 * 사용 기록 삭제 감사 기록. 방식은 lib/approval/quoteDelete.ts 의 writeDeleteAudit 과 같다 —
 * 행위자 이메일·이름을 붙이고, 무엇을 어떤 절차로 지웠는지 new_data 에 남긴다.
 * best-effort 다(실패해도 회수·폐기는 이미 끝났다).
 */
async function writeRevertAudit(sb: SupabaseClient, o: {
  documentId: number
  docNo: string
  actorId: number
  usage: { usage_id: number; device_id: number; usage_date: string; start_time: string; end_time: string }
}) {
  const { data: actor, error: actorErr } = await sb
    .from('engineers').select('email, name').eq('engineer_id', o.actorId).maybeSingle()
  if (actorErr) console.error(`[${TAG}] actor lookup failed`, { actorId: o.actorId, error: actorErr })
  const who = (actor ?? null) as { email: string | null; name: string | null } | null

  const { error } = await sb.from('audit_log').insert({
    actor_email: who?.email ?? null,
    action: 'SHOWROOM_USAGE_REVERT_DELETE',
    table_name: 'showroom_usage',
    row_id: String(o.usage.usage_id),
    old_data: o.usage,
    new_data: {
      reason: '사후 신청 회수·폐기',
      document_id: o.documentId,
      doc_no: o.docNo,
      deleted_by: o.actorId,
      deleted_by_name: who?.name ?? null,
    },
  })
  if (error) console.error(`[${TAG}] revert audit insert failed`, { documentId: o.documentId, error })
}

/** 결재란 아래 의견 — 마지막으로 처리한 사람의 의견을 싣는다. */
function lastComment(lines: ApprovalLine[]): string {
  const acted = lines
    .filter(l => l.kind !== 'cc' && l.acted_at && l.comment)
    .sort((a, b) => String(a.acted_at).localeCompare(String(b.acted_at)))
  return acted.length > 0 ? (acted[acted.length - 1].comment ?? '') : ''
}
