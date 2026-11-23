// 리드 **회수**와 번호 재사용의 규칙 한 벌 (2026-11-23).
//
// ── 세 가지가 다르다 ──────────────────────────────────────────────────────
//   배정불가  상태다. 번호를 **쓴다** — 들어온 리드를 안 하기로 한 것이다.
//   미진행    상태다. 번호를 **쓴다** — 담당자가 진행하지 않기로 한 것이다.
//   회수      없던 일로 되돌린다. 번호를 **돌려받는다** — 중복·시험 등록처럼 애초에
//             번호를 줄 일이 아니었던 줄이다. 행과 내용(고객사·관심제품·배정 이력)은 남는다.
//
// ── 반납 목록은 따로 두지 않는다 ──────────────────────────────────────────
//   「lead_no 가 비어 있고 recalled_no 가 있는 줄」이 곧 반납된 번호다(db/lead_recall_20261123.sql).
//   표를 하나 더 두면 두 곳이 어긋난다.
//
// ── 그냥 비어 있는 번호는 건드리지 않는다 ────────────────────────────────
//   LD-26-001 처럼 **쓴 적도 반납한 적도 없는** 번호는 재사용 대상이 아니다. 사람이
//   「1번이 비었네」 하고 끼워 넣기 시작하면 번호가 시간 순서를 잃는다.
//
// 순수 모듈이다(import 가 없다) — 라우트·화면·하네스가 함께 읽는다.

/** 회수 사유 길이 — 배정불가 사유와 같은 기준이다(lib/leadOptions.ts 의 SKIP_REASON_MIN). */
export const RECALL_REASON_MIN = 5
export const RECALL_REASON_MAX = 200

/** 판정에 쓰는 리드 한 줄의 최소 모양. */
export type RecallableLead = {
  lead_id: number
  lead_no?: string | null
  recalled_no?: string | null
  recall_reason?: string | null
  recalled_at?: string | null
  status?: string | null
}

/** 회수된 줄인가 — 번호를 반납했고 원래 번호가 남아 있다. */
export function isRecalled(lead: RecallableLead | null | undefined): boolean {
  return !!lead && !lead.lead_no && !!lead.recalled_no
}

/** 'LD-26-027' → 27. 꼴이 아니면 null. */
export function seqOf(no: string | null | undefined, prefix: string): number | null {
  const s = (no ?? '').trim()
  if (!s.startsWith(prefix)) return null
  const n = Number(s.slice(prefix.length))
  return Number.isInteger(n) && n > 0 ? n : null
}

/** 번호 한 개를 글자로 — 세 자리로 채운다(999 를 넘으면 자릿수가 는다). */
export const formatLeadNo = (prefix: string, seq: number): string => prefix + String(seq).padStart(3, '0')

/**
 * 다음에 내줄 번호.
 *
 *   ① 그 해 **반납 목록**에 번호가 있으면 **가장 작은 것**부터 쓴다.
 *   ② 없으면 지금까지 쓴 번호의 최댓값 + 1.
 *
 * used     지금 살아 있는 번호(lead_no) 전부
 * returned 반납된 번호(recalled_no 중 lead_no 가 빈 줄) 전부
 * 둘 다 그 해 접두(prefix)로 거른 뒤 넘겨도 되고, 섞여 있어도 여기서 거른다.
 */
export function nextLeadNo(prefix: string, used: (string | null | undefined)[], returned: (string | null | undefined)[]): string {
  const usedSeq = new Set<number>()
  for (const u of used) {
    const n = seqOf(u, prefix)
    if (n != null) usedSeq.add(n)
  }
  // 반납된 번호라도 **이미 누가 다시 쓰고 있으면** 후보가 아니다(되살린 뒤 아직 목록에 남은 경우).
  const free: number[] = []
  for (const r of returned) {
    const n = seqOf(r, prefix)
    if (n != null && !usedSeq.has(n)) free.push(n)
  }
  if (free.length > 0) return formatLeadNo(prefix, Math.min(...free))
  const max = usedSeq.size === 0 ? 0 : Math.max(...usedSeq)
  return formatLeadNo(prefix, max + 1)
}

/** 회수할 수 있는가 — 없으면 왜 못 하는지 돌려준다. */
export function recallBlockedReason(lead: RecallableLead | null | undefined, reason: string): string | null {
  if (!lead) return '리드를 찾지 못했습니다'
  if (isRecalled(lead)) return '이미 회수된 리드입니다'
  if (!lead.lead_no) return '번호가 없는 리드입니다'
  const r = reason.trim()
  if (r.length < RECALL_REASON_MIN) return `회수 사유를 ${RECALL_REASON_MIN}자 이상 적어주세요`
  if (r.length > RECALL_REASON_MAX) return `회수 사유는 ${RECALL_REASON_MAX}자까지 적을 수 있습니다`
  return null
}

/**
 * 되돌릴 수 있는가 — **그 번호가 아직 반납 목록에 있을 때만**.
 * 다른 리드가 이미 그 번호를 받아 갔으면 되돌릴 수 없다(같은 번호가 둘이 된다).
 */
export function restoreBlockedReason(
  lead: RecallableLead | null | undefined,
  liveNumbers: (string | null | undefined)[],
): string | null {
  if (!lead) return '리드를 찾지 못했습니다'
  if (!isRecalled(lead)) return '회수된 리드가 아닙니다'
  const no = (lead.recalled_no ?? '').trim()
  if (!no) return '되돌릴 번호가 없습니다'
  const taken = liveNumbers.some(n => (n ?? '').trim() === no)
  return taken ? `${no} 번호를 다른 리드가 이미 쓰고 있습니다` : null
}

/** 목록에 적는 한 줄 — 「회수 (원래 LD-26-027) · 중복 등록 · 홍길동 · 2026-11-23」. */
export function recallLabel(lead: RecallableLead, actorName?: string | null): string {
  const bits = [`회수 (원래 ${lead.recalled_no ?? '-'})`]
  const reason = (lead.recall_reason ?? '').trim()
  if (reason) bits.push(reason)
  if (actorName) bits.push(actorName)
  const at = (lead.recalled_at ?? '').slice(0, 10)
  if (at) bits.push(at)
  return bits.join(' · ')
}

/**
 * 목록에 보일 줄만 — 기본은 회수를 **숨긴다**.
 * 실적·상태 집계도 같은 함수를 쓴다(회수는 세지 않는다).
 */
export function visibleLeads<T extends RecallableLead>(leads: T[], includeRecalled: boolean): T[] {
  return includeRecalled ? leads : leads.filter(l => !isRecalled(l))
}

/** 회수된 줄이 몇인가 — 「회수 포함」 토글 옆에 적는다. */
export const recalledCount = (leads: RecallableLead[]): number => leads.filter(isRecalled).length

/** 표에 컬럼이 아직 없다(SQL 적용 전)는 신호. 화면이 그 말을 그대로 보여 준다. */
export const RECALL_SCHEMA_MESSAGE =
  '회수 기능을 쓰려면 db/lead_recall_20261123.sql 을 먼저 적용해야 합니다'

/** 컬럼이 없을 때의 오류인가(42703 = 그런 칸 없음, PGRST204 = 스키마 캐시에 없음). */
export function isMissingRecallColumn(error: { code?: string | null; message?: string | null } | null): boolean {
  if (!error) return false
  if (error.code === '42703' || error.code === 'PGRST204') return true
  return /recalled_no|recall_reason|recalled_at|recalled_by/.test(error.message ?? '')
}
