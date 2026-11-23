// 고객사 **지우기**의 규칙과 글자 한 벌 (2026-11-23).
//
// ── 지우기는 숨기기다 ────────────────────────────────────────────────────
//   사업장·회사·대리점·담당자·장비를 지우면 **deleted_at 이 채워질 뿐** 줄은 남는다.
//   그래서 되돌릴 수 있고(복구), 그 줄을 가리키던 견적·서비스·영업활동도 끊기지 않는다.
//   전에는 견적이 없는 사업장을 **진짜 DELETE** 했다 — 다섯 표를 차례로 지우다 중간에
//   실패하면 되돌릴 수 없었고, 영업활동이 있으면 FK 에 막혀 아예 지워지지 않았다.
//
// ── 지우기 전에 한 번 더 묻는 까닭 ───────────────────────────────────────
//   「거래가 끊긴 업체」를 지우는 일이 잦았다. 그것은 지울 일이 아니라 **상태를 이탈로**
//   바꿀 일이다 — 지우면 지난 거래까지 목록·통계에서 사라진다. 모달이 그 말을 먼저 한다.
//
// 순수 모듈이다(import 가 없다) — 라우트·화면·하네스가 함께 읽는다.

export const DELETE_TARGETS = ['site', 'company', 'agency', 'contact', 'device'] as const
export type DeleteTarget = (typeof DELETE_TARGETS)[number]

/** 지우는 까닭의 길이 상한. */
export const DELETE_REASON_MAX = 200

/** 대상 이름 — 모달 제목·문구가 쓴다. */
export const TARGET_LABEL: Record<DeleteTarget, string> = {
  site: '사업장', company: '회사', agency: '대리점', contact: '담당자', device: '장비',
}

/** 모달 맨 위의 안내 — **지우지 말라**는 말이 먼저다. */
export const DELETE_ADVICE = '거래가 안 되는 업체는 삭제가 아니라 상태를 이탈로 바꾸세요.'

/** 지워도 기록은 남는다는 한 줄. */
export const DELETE_NOTE = '지워도 줄은 남습니다 — 목록·지도·통계에서만 빠지고, 슈퍼관리자가 되돌릴 수 있습니다.'

/** 연결 기록 수 — 라우트가 세어 보내는 모양. */
export type DeleteCounts = {
  activity: number
  service: number
  quote: number
  inquiry: number
  device: number
  contact: number
}

export const EMPTY_COUNTS: DeleteCounts = { activity: 0, service: 0, quote: 0, inquiry: 0, device: 0, contact: 0 }

/** 세는 차례 — 모달에 이 순서로 적는다. */
export const COUNT_LABELS: readonly { key: keyof DeleteCounts; label: string }[] = [
  { key: 'activity', label: '영업활동' },
  { key: 'service', label: '서비스' },
  { key: 'quote', label: '견적' },
  { key: 'inquiry', label: '의뢰' },
  { key: 'device', label: '장비' },
  { key: 'contact', label: '담당자' },
]

/**
 * 「영업활동 3 · 서비스 1 · 장비 2 가 함께 숨겨집니다」.
 * 0 인 것은 적지 않는다 — 0 을 늘어놓으면 **있는 것**이 눈에 안 띈다.
 * 하나도 없으면 빈 글자다(부르는 쪽이 줄을 내지 않는다).
 */
export function hiddenWithText(counts: DeleteCounts): string {
  const parts = COUNT_LABELS
    .filter(({ key }) => (counts[key] ?? 0) > 0)
    .map(({ key, label }) => `${label} ${counts[key]}`)
  return parts.length === 0 ? '' : `${parts.join(' · ')} 가 함께 숨겨집니다`
}

/** 연결된 기록이 하나라도 있는가. */
export const hasLinked = (counts: DeleteCounts): boolean =>
  COUNT_LABELS.some(({ key }) => (counts[key] ?? 0) > 0)

// ── 삭제 요청 — 지우지 못하는 사람이 지워 달라고 하는 길 (2026-11-23) ─────
// 사업장 0곳 회사를 지우는 것은 슈퍼관리자의 일이다. 그런데 그 줄을 **찾아내는** 사람은
// 자기 회사를 정리하는 담당자다. 전에는 그 사람에게 「삭제」 버튼이 보였고 누르면 403 이었다.
// 이제 그 자리에 **삭제 요청**을 둔다 — 까닭을 적으면 슈퍼관리자에게 알림이 가고,
// 정리 필요 탭의 그 줄에 「삭제 요청됨」이 붙는다.

/** 버튼 글자 — 지울 수 있는 사람과 요청하는 사람이 다른 말을 본다. */
export const DELETE_REQUEST_LABEL = '삭제 요청'
/** 이미 요청된 줄에 붙는 꼬리표. */
export const DELETE_REQUESTED_LABEL = '삭제 요청됨'
/** 요청 창의 한 줄 안내. */
export const DELETE_REQUEST_NOTE =
  '슈퍼관리자에게 알림이 갑니다. 지워지기 전까지 이 회사는 목록에 그대로 있습니다.'

/** 요청할 수 있는가 — 지우기와 같은 기준으로 까닭을 받는다. */
export function requestBlockedReason(reason: string, busy: boolean): string | null {
  if (busy) return '보내는 중입니다'
  if (!reason.trim()) return '지워야 하는 까닭을 적어주세요'
  if (reason.trim().length > DELETE_REASON_MAX) return `까닭은 ${DELETE_REASON_MAX}자까지 적을 수 있습니다`
  return null
}

/** 지울 수 있는가 — 까닭이 있어야 한다. 없으면 왜 못 누르는지 돌려준다. */
export function deleteBlockedReason(reason: string, busy: boolean): string | null {
  if (busy) return '지우는 중입니다'
  if (!reason.trim()) return '지우는 까닭을 적어주세요'
  if (reason.trim().length > DELETE_REASON_MAX) return `까닭은 ${DELETE_REASON_MAX}자까지 적을 수 있습니다`
  return null
}
