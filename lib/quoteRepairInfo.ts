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
 *   none    아무것도 없다 — 글자도 사진도
 *   partial 적다 말았다
 *   done    증상·원인·결과를 **모두** 적고 **사진이 한 장 이상** 있다
 *
 * 사진까지 봐야 완료인 까닭 — 이 정보는 수리 보고의 근거다. 글만 적고 사진이 없으면
 * 「무엇을 고쳤는지」를 나중에 아무도 확인할 수 없다. 글 셋이 다 차도 사진이 없으면
 * 작성중으로 둔다.
 */
export type RepairInfoState = 'none' | 'partial' | 'done'

const filled = (v: string | null | undefined): boolean => (v ?? '').trim() !== ''

export function repairInfoState(
  info: RepairInfoFields | null | undefined,
  photoCount = 0,
): RepairInfoState {
  const n = info ? [info.symptom, info.cause, info.result].filter(filled).length : 0
  const photos = Math.max(0, photoCount)
  if (n === 0 && photos === 0) return 'none'
  return n === 3 && photos >= 1 ? 'done' : 'partial'
}

// ════════════════════════════════════════════════════════════════════════════
// 사진
// ════════════════════════════════════════════════════════════════════════════

/** 한 견적에 붙일 수 있는 사진 수. 다섯 장째는 받지 않는다. */
export const MAX_PHOTOS = 4
/**
 * 줄인 **뒤**의 상한. 긴 변 1,600 · 품질 0.8 로 줄이면 폰 사진도 보통 300~700KB 다 —
 * 2MB 를 넘는다면 사진이 아니라 다른 것이 들어온 것으로 본다(스크린샷 수십 장을 이어
 * 붙인 그림 등). 라우트도 같은 수로 다시 센다.
 */
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024

export type RepairPhoto = {
  photo_id: number
  storage_path: string
  caption: string | null
  sort_order: number
  /** 보여 줄 주소 — 라우트가 1시간짜리 서명 URL 로 만들어 준다(버킷이 비공개다). */
  url?: string | null
}

/** 더 올릴 수 있나. */
export const canAddPhoto = (count: number): boolean => count < MAX_PHOTOS

/** 몇 장까지 받을 수 있나 — 한 번에 여러 장을 고른 경우에 쓴다. */
export const photoRoom = (count: number): number => Math.max(0, MAX_PHOTOS - count)

/**
 * 순서 바꾸기 — **한 칸 위/아래**. 끝에서 더 밀면 그대로 둔다(되돌려 주는 것이 아니라
 * 같은 배열을 준다 — 부르는 쪽이 「바뀐 것이 없다」를 알 수 있게 길이·차례로 견준다).
 */
export function movePhoto<T extends { photo_id: number }>(list: T[], photoId: number, dir: -1 | 1): T[] {
  const i = list.findIndex(p => p.photo_id === photoId)
  if (i < 0) return list
  const j = i + dir
  if (j < 0 || j >= list.length) return list
  const next = [...list]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
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
  /** 사진 — sort_order 순. 서명 URL 이 함께 온다. */
  photos: RepairPhoto[]
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
    return { repair: json.repair ?? null, info: json.info ?? null, photos: json.photos ?? [], canEdit: !!json.canEdit }
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

/**
 * 저장(덮어쓰기). 사진 설명도 함께 보낸다 — 사진 자체는 고를 때 바로 올라가지만(파일이다),
 * **설명 글자는 저장 버튼이 쓴다**(글자마다 쓰면 한 자 칠 때마다 서버에 간다).
 */
export async function saveRepairInfo(
  quoteId: number,
  fields: RepairInfoFields,
  captions?: Record<number, string | null>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/quote-repair-info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save', quoteId, ...fields, captions: captions ?? null }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: json?.error ?? '저장하지 못했습니다.' }
    return { ok: true }
  } catch {
    return { ok: false, error: '저장하지 못했습니다.' }
  }
}

/**
 * 사진 올리기 — 브라우저에서 **줄인 뒤** data URL 로 보낸다(원본을 보내지 않는다).
 *
 * 줄이는 규칙은 명함 사진과 **같은 것을 쓴다**(lib/leadCardImage.ts — 긴 변 1,600 ·
 * 품질 0.8 · EXIF 회전 반영 후 재인코딩이라 EXIF 는 사라진다). 같은 규칙을 두 벌 두면
 * 한쪽만 고쳐지는 날이 온다.
 *
 * HEIC(아이폰 기본 형식)는 브라우저가 디코딩하지 못하는 경우가 많다 — 그때는 줄이기가
 * 실패하므로 **바꿔서 올려 달라고** 알린다(여기서 변환해 주지는 못한다).
 */
export async function uploadRepairPhotos(
  quoteId: number,
  files: File[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ ok: boolean; error?: string; photos?: RepairPhoto[] }> {
  const { downsizeImage, dataUrlBytes } = await import('@/lib/leadCardImage')
  const items: { dataUrl: string }[] = []
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    let shrunk
    try {
      shrunk = await downsizeImage(f)
    } catch {
      const heic = /heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name)
      return { ok: false, error: heic ? 'JPG/PNG로 변환해 올려주세요' : '이미지를 읽지 못했습니다' }
    }
    if (dataUrlBytes(shrunk.dataUrl) > PHOTO_MAX_BYTES) {
      return { ok: false, error: '사진이 너무 큽니다(줄인 뒤 2MB 이하만 올릴 수 있습니다)' }
    }
    items.push({ dataUrl: shrunk.dataUrl })
    onProgress?.(i + 1, files.length)
  }
  try {
    const res = await fetch('/api/quote-repair-info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'photo-add', quoteId, items }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: json?.error ?? '사진을 올리지 못했습니다.' }
    return { ok: true, photos: json.photos ?? [] }
  } catch {
    return { ok: false, error: '사진을 올리지 못했습니다.' }
  }
}

/** 사진 지우기 — 저장소 파일까지 함께 지운다(라우트가 한다). */
export async function deleteRepairPhoto(quoteId: number, photoId: number): Promise<{ ok: boolean; error?: string; photos?: RepairPhoto[] }> {
  try {
    const res = await fetch('/api/quote-repair-info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'photo-delete', quoteId, photoId }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: json?.error ?? '사진을 지우지 못했습니다.' }
    return { ok: true, photos: json.photos ?? [] }
  } catch {
    return { ok: false, error: '사진을 지우지 못했습니다.' }
  }
}

/** 차례 바꾸기 — 보이는 순서를 그대로 보낸다(0,1,2,3 으로 다시 매긴다). */
export async function orderRepairPhotos(quoteId: number, photoIds: number[]): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/quote-repair-info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'photo-order', quoteId, photoIds }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: json?.error ?? '순서를 바꾸지 못했습니다.' }
    return { ok: true }
  } catch {
    return { ok: false, error: '순서를 바꾸지 못했습니다.' }
  }
}
