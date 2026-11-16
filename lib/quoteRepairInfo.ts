// 견적에 붙는 **수리 건 정보** — 고장 증상 · 고장 원인 · 처리 결과.
//
// ── 연결 축은 하나다 ────────────────────────────────────────────────────────
//   「이 견적이 어느 수리 건인가」는 **repairs.quote_id** 하나로만 적는다. 수리 목록에서
//   「견적서 작성」을 누르면 견적을 저장할 때 그 칸이 채워지고(create_quote 의 p_repair_id),
//   견적 화면에서 수리 건을 직접 고르는 길도 같은 칸으로 간다. quote_repair_info 에는
//   수리 건을 가리키는 칸을 두지 않았다 — 같은 사실이 두 곳에 있으면 어긋났을 때 어느
//   쪽이 맞는지 알 수 없다(db/quote_repair_info_schema.sql 머리말).
//
// ── 여기 있는 것 ────────────────────────────────────────────────────────────
//   순수 판정(상태·표시 글자)과 화면이 쓰는 **조회 함수**다. 조회는 서비스 롤 라우트를
//   거친다(/api/quote-repair-info) — repairs 는 견적 화면 사람들에게 열려 있지 않다.
//
// 순수 함수는 하네스가 그대로 돌린다(scripts/quote-repair-info-check.js).

/** 한 견적의 수리 정보. 비어 있는 칸은 null 이다. */
export type RepairInfoFields = {
  symptom: string | null
  cause: string | null
  result: string | null
}

/**
 * 작성 상태.
 *   none    아무것도 적지 않았다
 *   partial 셋 중 일부만 적었다
 *   done    증상·원인·결과를 **모두** 적었다
 *
 * 사진 조건은 아직 넣지 않는다(사진 기능이 다음 단계다 — 그때 done 기준에 1장 이상이 더해진다).
 */
export type RepairInfoState = 'none' | 'partial' | 'done'

const filled = (v: string | null | undefined): boolean => (v ?? '').trim() !== ''

export function repairInfoState(info: RepairInfoFields | null | undefined): RepairInfoState {
  if (!info) return 'none'
  const n = [info.symptom, info.cause, info.result].filter(filled).length
  if (n === 0) return 'none'
  return n === 3 ? 'done' : 'partial'
}

/** 뱃지 글자. */
export const REPAIR_INFO_LABEL: Record<RepairInfoState, string> = {
  none: '미작성',
  partial: '작성중',
  done: '완료',
}

/**
 * 뱃지 점 색. **글자는 중립색**이고 색은 점이 맡는다(디자인 규칙 — 배지에 상태색 틴트 배경 금지).
 * 값은 표에 있는 상태색 그대로다.
 */
export const REPAIR_INFO_DOT: Record<RepairInfoState, string> = {
  none: '#d1d5db',
  partial: '#f59e0b',
  done: '#16a34a',
}

/** 화면이 읽는 수리 건 한 줄(필요한 칸만). */
export type RepairBrief = {
  repair_id: number
  item_type: string | null
  serial_number: string | null
  received_date: string | null
  repair_done_at: string | null
  shipped_date: string | null
  status: string | null
  customer_name: string | null
  product_type: string | null
  /** 이미 다른 견적에 걸려 있나 — 고르기 목록에서 알려 준다(고를 수는 있다). */
  quote_id?: number | null
}

/** 날짜 한 칸 — 비어 있으면 '-'. 시각이 붙어 있으면 날짜만 남긴다. */
export const repairDate = (v: string | null | undefined): string => {
  const s = (v ?? '').trim()
  if (!s) return '-'
  return s.slice(0, 10)
}

/** 출고일 — 아직 안 나갔으면 **「미출고」**다('-' 로 두면 빠뜨린 것처럼 보인다). */
export const shippedLabel = (v: string | null | undefined): string =>
  (v ?? '').trim() === '' ? '미출고' : repairDate(v)

// ════════════════════════════════════════════════════════════════════════════
// 화면이 쓰는 조회 — 전부 /api/quote-repair-info 를 거친다
// ════════════════════════════════════════════════════════════════════════════

/** 목록 한 번에 물어보는 수 — 주소 길이를 넘기지 않게 끊는다. */
const BATCH = 100

export type RepairInfoRow = {
  /** 이 견적이 수리 건인가(repairs.quote_id 로 연결돼 있는가). */
  isRepair: boolean
  state: RepairInfoState
}

/**
 * 목록의 뱃지 — 견적 여러 건의 「수리 건인가 · 얼마나 적었나」를 한 번에 받는다.
 * 못 읽으면 **빈 표**를 돌려준다(뱃지가 안 보일 뿐, 목록은 그대로 그려진다).
 */
export async function fetchRepairInfoStates(quoteIds: number[]): Promise<Map<number, RepairInfoRow>> {
  const ids = [...new Set(quoteIds.filter(n => Number.isSafeInteger(n) && n > 0))]
  const out = new Map<number, RepairInfoRow>()
  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH)
    try {
      const res = await fetch('/api/quote-repair-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'states', quoteIds: slice }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { console.error('[quoteRepairInfo] 상태 조회 실패', { status: res.status, error: json?.error }); continue }
      for (const [k, v] of Object.entries((json?.states ?? {}) as Record<string, RepairInfoRow>)) {
        out.set(Number(k), v)
      }
    } catch (e) {
      console.error('[quoteRepairInfo] 상태 조회 예외', e)
    }
  }
  return out
}

export type RepairInfoDetail = {
  repair: RepairBrief | null
  info: RepairInfoFields | null
  /** 저장할 수 있는가 — 견적 작성자 또는 관리자(라우트가 판정한다). */
  canEdit: boolean
}

/** 견적 한 건의 수리 건 + 적어 둔 내용. 못 읽으면 null. */
export async function fetchRepairInfo(quoteId: number): Promise<RepairInfoDetail | null> {
  try {
    const res = await fetch('/api/quote-repair-info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'detail', quoteId }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { console.error('[quoteRepairInfo] 조회 실패', { quoteId, status: res.status, error: json?.error }); return null }
    return { repair: json.repair ?? null, info: json.info ?? null, canEdit: !!json.canEdit }
  } catch (e) {
    console.error('[quoteRepairInfo] 조회 예외', e)
    return null
  }
}

/** 수리 건 한 줄만 — 아직 저장하지 않은 견적(수리 목록에서 넘어온 길)이 쓴다. */
export async function fetchRepairBrief(repairId: number): Promise<RepairBrief | null> {
  try {
    const res = await fetch('/api/quote-repair-info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'repair', repairId }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return null
    return json.repair ?? null
  } catch { return null }
}

/** 수리 건 고르기 — 글자로 찾는다. 같은 고객사 건이 앞에 선다(라우트가 정렬한다). */
export async function searchRepairs(keyword: string, customerName: string | null): Promise<RepairBrief[]> {
  try {
    const res = await fetch('/api/quote-repair-info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'search', keyword, customerName }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return []
    return (json.repairs ?? []) as RepairBrief[]
  } catch { return [] }
}

/** 저장(덮어쓰기). 성공이면 true. */
export async function saveRepairInfo(quoteId: number, fields: RepairInfoFields): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/quote-repair-info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save', quoteId, ...fields }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: json?.error ?? '저장하지 못했습니다.' }
    return { ok: true }
  } catch {
    return { ok: false, error: '저장하지 못했습니다.' }
  }
}
