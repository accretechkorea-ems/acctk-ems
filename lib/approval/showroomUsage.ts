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
 * 그러면 마지막 승인이 막힌다(지금 요청함의 「기록을 정리한 뒤 승인해주세요」와 같은 동작).
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
    const made = await createUsageFromRequest(sb, null, s.payload, ctx.requesterId)
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

/** 결재란 아래 의견 — 마지막으로 처리한 사람의 의견을 싣는다. */
function lastComment(lines: ApprovalLine[]): string {
  const acted = lines
    .filter(l => l.kind !== 'cc' && l.acted_at && l.comment)
    .sort((a, b) => String(a.acted_at).localeCompare(String(b.acted_at)))
  return acted.length > 0 ? (acted[acted.length - 1].comment ?? '') : ''
}
