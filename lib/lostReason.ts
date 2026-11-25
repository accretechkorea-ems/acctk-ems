// 실주 사유의 **규칙** — 순수 함수만 둔다(DB·화면을 모른다).
//
// 목록은 표에 있다(db/lost_reasons_20261126.sql). 여기서 정하는 것은 셋이다.
//   ① 무엇을 더 받아야 하는가 — 「기타」는 설명, 「경쟁사」는 회사 이름.
//   ② 무엇이 모자라서 저장을 막는가(한 번에 **한 가지만** 말한다).
//   ③ 「사유 대기」는 무엇인가 — 실패·실주인데 사유가 비어 있는 건.
//
// ── 막지 않는다 ─────────────────────────────────────────────────────────────
// 사유가 비었다고 **다른 일을 막지 않는다**(지시 L3). 막으면 사람들은 아무 사유나 골라
// 통계를 더 망친다. 그래서 「사유 대기」는 목록·할 일에 한 줄로 **안내만** 한다.
// 막는 자리는 딱 하나다 — 사람이 **지금 실주 창을 띄워 고르고 있을 때** 빈 채로 저장하는 것.

/** lost_reasons 한 줄. */
export type LostReason = {
  reason_id: number
  label: string
  sort: number
  active: boolean
  requires_note: boolean
  requires_competitor: boolean
}

/**
 * 표가 아직 없을 때 쓰는 **같은 여덟 줄**(SQL 의 시드와 글자가 같다).
 *
 * 왜 두는가 — 적용 전에도 실주 처리는 돌아야 한다. 그때는 id 없이 **글자만** 저장한다
 * (옛 sales_opportunities.lost_reason 칸이 그대로 받는다). 적용 뒤에는 id 가 함께 들어간다.
 */
export const FALLBACK_REASONS: readonly LostReason[] = [
  { reason_id: 0, label: '가격', sort: 10, active: true, requires_note: false, requires_competitor: false },
  { reason_id: 0, label: '경쟁사', sort: 20, active: true, requires_note: false, requires_competitor: true },
  { reason_id: 0, label: '예산 없음·보류', sort: 30, active: true, requires_note: false, requires_competitor: false },
  { reason_id: 0, label: '시기 안 맞음', sort: 40, active: true, requires_note: false, requires_competitor: false },
  { reason_id: 0, label: '사양·요구 불일치', sort: 50, active: true, requires_note: false, requires_competitor: false },
  { reason_id: 0, label: '무응답·연락 두절', sort: 60, active: true, requires_note: false, requires_competitor: false },
  { reason_id: 0, label: '프로젝트 취소', sort: 70, active: true, requires_note: false, requires_competitor: false },
  { reason_id: 0, label: '기타', sort: 80, active: true, requires_note: true, requires_competitor: false },
]

/** 표를 아직 안 만들었을 때 창이 한 줄로 띄우는 글. 고르기는 그래도 된다. */
export const LOST_SCHEMA_NOTE = '사유 목록을 아직 표로 옮기지 않았습니다 — 고른 글자만 저장됩니다(db/lost_reasons_20261126.sql)'

/** 자동 실주가 넣는 글자 — **사유가 아니다**(lib/quoteStatus.ts 의 AUTO_FAIL_REASON 과 같은 값). */
export const NOT_A_REASON = '유효기간 만료'

/** 「사유 대기」로 보여 주는 글자 — 목록·할 일 줄이 같은 말을 쓴다. */
export const PENDING_LABEL = '실주 사유 입력 필요'

/** 창이 들고 있는 값. */
export type LostForm = {
  /** 고른 사유의 글자. 빈 글자면 아직 고르지 않았다. */
  label: string
  note: string
  competitor: string
  /** 실주일 'YYYY-MM-DD'. */
  lostAt: string
}

export const emptyLostForm = (today: string): LostForm => ({ label: '', note: '', competitor: '', lostAt: today })

/** 고른 줄 — 글자로 찾는다(표가 없을 때도 같은 길이다). */
export const findReason = (reasons: readonly LostReason[], label: string): LostReason | null =>
  reasons.find(r => r.label === label.trim()) ?? null

export const needsNote = (reasons: readonly LostReason[], label: string): boolean =>
  findReason(reasons, label)?.requires_note ?? false
export const needsCompetitor = (reasons: readonly LostReason[], label: string): boolean =>
  findReason(reasons, label)?.requires_competitor ?? false

/**
 * 저장을 막는 까닭 **한 가지**(위에서 아래 차례로 본다). 없으면 null.
 * 창에서 고르고 있을 때만 쓴다 — 목록·카드는 이것으로 아무것도 막지 않는다.
 */
export function lostBlockedReason(form: LostForm, reasons: readonly LostReason[]): string | null {
  const label = form.label.trim()
  if (!label) return '실주 사유를 고르세요'
  if (!findReason(reasons, label)) return '목록에 없는 사유입니다'
  if (needsNote(reasons, label) && !form.note.trim()) return '「기타」는 설명을 적어주세요'
  if (needsCompetitor(reasons, label) && !form.competitor.trim()) return '어느 경쟁사인지 적어주세요'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.lostAt)) return '실주일을 고르세요'
  return null
}

/** 저장할 값 — 표가 없으면 id 는 비우고 글자만 담는다. */
export function lostPatch(form: LostForm, reasons: readonly LostReason[]): {
  lost_reason: string
  lost_reason_id: number | null
  lost_note: string | null
  competitor: string | null
  lost_at: string
} {
  const row = findReason(reasons, form.label)
  return {
    lost_reason: form.label.trim(),
    lost_reason_id: row && row.reason_id > 0 ? row.reason_id : null,
    lost_note: form.note.trim() || null,
    competitor: needsCompetitor(reasons, form.label) ? (form.competitor.trim() || null) : null,
    lost_at: form.lostAt,
  }
}

/**
 * 사유를 기다리는 건인가 — **끝났는데 사유가 비어 있다**.
 * 자동 실주가 넣은 「유효기간 만료」는 사유로 세지 않는다(그것은 사유가 아니다).
 */
export function isReasonPending(row: {
  lost_reason?: string | null
  fail_reason?: string | null
  lost_reason_id?: number | null
}): boolean {
  if (row.lost_reason_id != null) return false
  const text = (row.lost_reason ?? row.fail_reason ?? '').trim()
  if (!text) return true
  return text === NOT_A_REASON
}

/** 목록·카드에 보여 줄 사유 글자 — 사유가 없으면 「사유 대기」 글자다. */
export function reasonLabelOf(row: {
  lost_reason?: string | null
  fail_reason?: string | null
  lost_reason_id?: number | null
  competitor?: string | null
}, reasons: readonly LostReason[] = []): string {
  if (isReasonPending(row)) return PENDING_LABEL
  if (row.lost_reason_id != null) {
    const byId = reasons.find(r => r.reason_id === row.lost_reason_id)
    if (byId) return row.competitor ? `${byId.label} · ${row.competitor}` : byId.label
  }
  const text = (row.lost_reason ?? row.fail_reason ?? '').trim()
  return row.competitor ? `${text} · ${row.competitor}` : text
}
