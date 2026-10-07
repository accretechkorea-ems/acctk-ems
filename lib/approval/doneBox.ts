// 기결함(결재수신함)의 판정 — **순수 함수만**. 네트워크·DB·React 를 쓰지 않아 스크립트로 그대로 돈다.
//
// 기결함에는 항목이 셋이고 뜻이 서로 다르다. 이 파일은 그 차이를 한곳에 적어 둔다.
//
//   기결문서 · 기결문서(진행)  — **내가 처리한 문서**(옛 규칙 그대로). 내 줄에 도장이 찍혀 있어야 한다.
//   기결문서(종결)            — **종결된 내 문서**. 옛 그룹웨어와 같게 맞춘 것이 이쪽이다.
//
// 「기결문서(종결)」의 확정 기준:
//   · 종결 = 문서 상태가 '완료' 또는 '반려'. (회수·폐기는 넣지 않는다 — 결재가 돌지 않은 건이다.)
//   · 나오는 문서 = **내가 기안자이거나 결재선(결재·합의)에 들어 있는** 문서 중 종결된 것.
//     내 차례가 오기 전에 반려돼 내 줄이 '대기' 인 채 끝난 문서도 포함한다 — 결재자가
//     「그 건은 어떻게 됐나」를 찾는 자리라서, 내가 눌렀는지가 기준이 아니다.
//   · 참조(cc)로만 걸린 문서는 제외한다(수신참조문서 함에만 보인다).
//
// 왜 '대기' 인 줄도 세는가 — 옛 기결함 질의는 `state <> '대기'` 였다. 그러면 1번 결재자가 반려한
// 문서가 2·3번 결재자의 기결함에 영원히 나타나지 않는다. 기안자도 자기 결재선에는 없으므로
// 자기가 올린 완료·반려 건을 기결함에서 볼 수 없었다. 두 구멍이 이 파일의 이유다.

import type { ApprovalLine } from './types'

/** 종결로 보는 문서 상태. */
export const CLOSED_STATUSES = ['완료', '반려'] as const

export const isClosedStatus = (status: string | null | undefined): boolean =>
  (CLOSED_STATUSES as readonly string[]).includes(status ?? '')

/** 결재란에 칸으로 나오는 종류 — 참조는 기결함 판정에서 빠진다. */
const COUNTED_KINDS = ['approve', 'agree']

/** 판정에 필요한 문서 값만. 목록의 문서 객체를 그대로 넘기면 된다. */
export type DoneDoc = {
  status?: string | null
  requester_id?: number | null
  completed_at?: string | null
  updated_at?: string | null
  approval_lines?: ApprovalLine[] | null
}

/**
 * 내 결재선 줄이 있는 문서인가 — 결재(approve)·합의(agree)만. **상태는 보지 않는다**('대기' 포함).
 *
 * `acted_by` 도 함께 본다. 대결(위임받아 남의 차례를 처리한 건)은 approver_id 가 위임자이고
 * acted_by 만 나다 — 그 문서는 내가 실제로 결재한 문서라 기결함에서 빠지면 안 된다
 * (이 라우트가 애초에 service role 로 도는 이유다). 참조 줄은 영원히 '대기' 라
 * acted_by 가 채워지지 않으므로(engine 의 sequentialLines 가 cc 를 빼고 생략 처리한다) 섞이지 않는다.
 */
export function hasMyLine(lines: ApprovalLine[] | null | undefined, myId: number): boolean {
  return (lines ?? []).some(l =>
    (COUNTED_KINDS.includes(l.kind) && l.approver_id === myId) || l.acted_by === myId)
}

/** 내 줄에 도장이 찍혀 있는 문서인가 — 옛 「기결문서」(내가 처리한 문서)의 기준이다. */
export function hasMyActedLine(lines: ApprovalLine[] | null | undefined, myId: number): boolean {
  return (lines ?? []).some(l =>
    l.state !== '대기' && (l.approver_id === myId || l.acted_by === myId))
}

/** 「기결문서(종결)」에 나오는 문서인가. */
export function inClosedBox(doc: DoneDoc, myId: number | null): boolean {
  if (myId == null) return false
  if (!isClosedStatus(doc.status)) return false
  if (doc.requester_id === myId) return true
  return hasMyLine(doc.approval_lines, myId)
}

/**
 * 종결 시각 — 정렬과 기간 필터의 기준이다.
 *
 *   '완료' → approval_documents.completed_at.
 *       '완료' 인 행에는 반드시 있다(DB CHECK `ad_completed_fields` — approval_schema.sql:43).
 *   '반려' → 그 문서의 **반려 줄의 acted_at**. 반려 라우트가 그 자리에서 찍는 값이다
 *       (app/api/approval/route.ts 의 reject).
 *
 * **updated_at 을 쓰지 않는 이유.** 반려 뒤에도 그 칸은 계속 올라간다 — 쇼룸 사후 신청은 반려
 * 직후 onRevert 가 summary 를 고쳐 쓰면서 updated_at 을 다시 찍는다
 * (lib/approval/showroomUsage.ts 의 patchSummary·clearUsageLink). 그러면 「반려된 시각」이 아니라
 * 「마지막으로 뭔가 손댄 시각」이 되어 정렬·기간이 어긋난다.
 * 둘 다 없을 때만 updated_at 으로 떨어진다(옛 데이터 방어 — 그때도 빈 값보다는 낫다).
 */
export function closedAtOf(doc: DoneDoc): string | null {
  if (doc.status === '완료') return doc.completed_at ?? doc.updated_at ?? null
  if (doc.status === '반려') {
    const rejected = (doc.approval_lines ?? [])
      .filter(l => l.state === '반려' && l.acted_at)
      .map(l => l.acted_at as string)
      .sort()
    return rejected[rejected.length - 1] ?? doc.updated_at ?? null
  }
  return doc.completed_at ?? doc.updated_at ?? null
}

/** 종결 시각이 from~to(양 끝 포함, YYYY-MM-DD) 안인가. 시각을 모르는 문서는 거르지 않는다. */
export function closedInPeriod(doc: DoneDoc, from: string, to: string): boolean {
  const at = closedAtOf(doc)
  if (!at) return true
  const ymd = at.slice(0, 10)
  return ymd >= from && ymd <= to
}

/** 종결 시각 최신순. 같은 시각이면 번호가 큰 쪽(나중 문서)이 먼저 — 순서가 흔들리지 않게 고정한다. */
export function sortByClosedAt<T extends DoneDoc & { document_id: number }>(docs: T[]): T[] {
  return [...docs].sort((a, b) => {
    const av = closedAtOf(a) ?? ''
    const bv = closedAtOf(b) ?? ''
    if (av !== bv) return bv.localeCompare(av)
    return b.document_id - a.document_id
  })
}

/**
 * 기결함 한 벌을 「기결문서(종결)」 규칙으로 고르고 세운다 — 서버가 쓰는 길이다.
 * 중복은 document_id 로 지운다(기안자이면서 결재자였던 문서가 두 질의에서 함께 올 수 있다).
 */
export function closedBoxRows<T extends DoneDoc & { document_id: number; doc_type?: string }>(
  docs: T[],
  opts: { myId: number | null; from?: string; to?: string; docType?: string | null },
): T[] {
  const seen = new Set<number>()
  const kept: T[] = []
  for (const d of docs) {
    if (seen.has(d.document_id)) continue
    if (!inClosedBox(d, opts.myId)) continue
    if (opts.docType && d.doc_type !== opts.docType) continue
    if (opts.from && opts.to && !closedInPeriod(d, opts.from, opts.to)) continue
    seen.add(d.document_id)
    kept.push(d)
  }
  return sortByClosedAt(kept)
}
