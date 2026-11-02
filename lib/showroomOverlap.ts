// 쇼룸 사용 시간이 **겹치는가** — 판정과 문구를 한곳에 둔다.
//
// 겹침을 보는 자리가 넷이다.
//   · 사용 기록 등록(POST /api/showroom/usage)        — 겹치면 막는다(409)
//   · 사후 신청 상신                                   — 겹치면 막는다(409). 기록을 바로 만들기 때문이다
//   · **사전 신청 상신**                               — 막지 않고 **경고**한다(2026-11-02 추가)
//   · 사전 신청의 마지막 승인 직전                      — 겹치면 승인을 막는다
//
// ── 왜 사전 신청은 경고인가 ─────────────────────────────────────────────────
//   예약을 올리는 시점에는 아직 아무 기록도 만들지 않는다. 그리고 「겹친다」의 상대가
//   **확정 기록**일 수도 있고 **아직 결재중인 다른 예약**일 수도 있다. 뒤쪽은 반려될 수도
//   있어 막을 근거가 약하다 — 둘 다 올려 두고 먼저 승인된 쪽이 기록을 갖는다(마지막 승인
//   직전 판정이 그 뒤를 지킨다). 다만 **올리는 사람이 모르는 채로 올리는 일**은 없어야
//   해서, 상신 전에 겹치는 시간대·사람·결재 상태를 보여 주고 한 번 더 묻는다.
//
// ── 남의 신청에서 보여 주는 것 ──────────────────────────────────────────────
//   시간대 · 신청자 이름 · 결재 상태. **그것만이다.** 목적·고객사·내용은 남의 영업 정보라
//   경고 문구에 넣지 않는다(결재선에 든 사람만 결재 화면에서 본다).
//
// 순수 함수만 둔다 — 하네스(scripts/showroom-overlap-check.js)가 그대로 돌린다.

/** 겹친 상대가 무엇인가 — 확정된 사용 기록인가, 아직 결재중인 다른 신청인가. */
export type ClashKind = 'record' | 'request'

/** 겹친 한 건. 남의 신청에서 가져오는 것은 시간·이름·상태뿐이다. */
export type Clash = {
  kind: ClashKind
  /** 'HH:MM' */
  start: string
  end: string
  /** 신청자 이름(기록 겹침은 null). */
  who: string | null
  /** 결재 상태(기록 겹침은 null). */
  status: string | null
}

/** 'HH:MM:SS' · 'HH:MM' · 빈 값을 'HH:MM' 로 눕힌다. 비교와 표시가 같은 모양을 쓴다. */
export const hhmm = (t: string | null | undefined): string => (t ?? '').slice(0, 5)

/**
 * 두 시간 구간이 겹치는가.
 *
 * **경계가 닿는 것은 겹침이 아니다** — 09:00~12:00 과 12:00~15:00 은 이어 쓰는 것이고,
 * 쇼룸은 한 장비를 앞사람이 끝낸 시각부터 쓰는 일이 흔하다. DB 쪽 판정
 * (기존.시작 < 신규.종료 and 기존.종료 > 신규.시작)과 **같은 규칙**이다.
 */
export function timesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const [as, ae, bs, be] = [hhmm(aStart), hhmm(aEnd), hhmm(bStart), hhmm(bEnd)]
  if (!as || !ae || !bs || !be) return false
  return as < be && ae > bs
}

/** 찾는 대상 — 같은 장비·같은 날의 이 시간대. */
export type OverlapTarget = {
  deviceId: number
  date: string
  start: string
  end: string
  /** 수정(재상신) 중인 자기 문서 — 자기 자신과 겹친다고 하지 않는다. */
  excludeDocumentId?: number | null
}

/** 사용 기록 한 줄 — 겹침 판정에 쓰는 칸만. */
export type UsageRowLike = { start_time: string | null; end_time: string | null }

/** 결재 문서 한 줄 — 겹침 판정에 쓰는 칸만(summary 는 쇼룸 신청 모양). */
export type DocRowLike = {
  document_id: number
  status: string | null
  summary: {
    is_retroactive?: boolean
    payload?: {
      device_id?: number
      usage_date?: string
      start_time?: string
      end_time?: string
      requester_name?: string
      is_retroactive?: boolean
    } | null
  } | null
}

/** 확정된 사용 기록 중 겹치는 것. 장비·날짜는 부르는 쪽이 이미 걸러 온다. */
export function recordClashes(rows: readonly UsageRowLike[], t: OverlapTarget): Clash[] {
  return rows
    .filter(r => timesOverlap(r.start_time ?? '', r.end_time ?? '', t.start, t.end))
    .map(r => ({ kind: 'record' as const, start: hhmm(r.start_time), end: hhmm(r.end_time), who: null, status: null }))
}

/**
 * 결재가 **아직 돌고 있는 사전 신청** 중 겹치는 것.
 *
 *   · 사후 신청은 보지 않는다 — 그쪽은 상신 때 기록을 이미 만들었고, 그 기록이 위에서 잡힌다
 *     (두 번 세면 같은 사용이 두 줄로 보인다).
 *   · 자기 문서는 뺀다(재상신).
 *   · 장비·날짜는 문서 안(summary.payload)으로 한 번 더 확인한다 — DB 질의로 좁혔더라도
 *     summary 모양이 아닌 옛 문서가 섞일 수 있다.
 */
export function requestClashes(docs: readonly DocRowLike[], t: OverlapTarget): Clash[] {
  const out: Clash[] = []
  for (const d of docs) {
    if (t.excludeDocumentId != null && d.document_id === t.excludeDocumentId) continue
    const p = d.summary?.payload
    if (!p) continue
    if (d.summary?.is_retroactive === true || p.is_retroactive === true) continue
    if (Number(p.device_id) !== t.deviceId) continue
    if (String(p.usage_date ?? '') !== t.date) continue
    if (!timesOverlap(p.start_time ?? '', p.end_time ?? '', t.start, t.end)) continue
    out.push({
      kind: 'request',
      start: hhmm(p.start_time),
      end: hhmm(p.end_time),
      who: p.requester_name ?? null,
      status: d.status ?? null,
    })
  }
  return out
}

/** 이른 시간 순으로. 같은 시작이면 기록을 먼저 — 확정된 쪽이 더 무겁다. */
export function sortClashes(list: readonly Clash[]): Clash[] {
  return [...list].sort((a, b) => (
    a.start !== b.start ? (a.start < b.start ? -1 : 1)
      : a.kind === b.kind ? 0 : a.kind === 'record' ? -1 : 1
  ))
}

/**
 * 경고 한 줄 — 「09:00~12:00 (홍길동 책임, 결재중)」 · 「09:00~12:00 (확정된 사용 기록)」.
 * 이름이 없으면 사람 자리를 비운다(옛 문서에 requester_name 이 없을 수 있다).
 */
export function clashLabel(c: Clash): string {
  const time = `${c.start}~${c.end}`
  if (c.kind === 'record') return `${time} (확정된 사용 기록)`
  const who = c.who?.trim()
  const status = c.status?.trim() === '진행중' ? '결재중' : (c.status?.trim() || '결재중')
  return `${time} (${[who, status].filter(Boolean).join(', ')})`
}

/** 확인창에 그대로 넣는 줄들. 겹치는 것이 없으면 빈 배열. */
export function warningLines(list: readonly Clash[]): string[] {
  return sortClashes(list).map(clashLabel)
}
