// 메모를 **누가 고칠 수 있나** — 자리마다 다른 규칙을 한곳에 적어 둔다.
//
// 화면 조각마다 조건을 다시 적으면 곧 갈린다(발주 요청 메모가 그랬다 — 쓴 사람이
// 자기 메모를 다시 열 길조차 없었다). 판정만 여기 두고, 화면은 결과를 받아 쓴다.
//
// 열람은 따로 두지 않는다 — **그 목록을 볼 수 있으면 그 줄의 메모도 본다**가 규칙이다.

/** 판정에 필요한 지금 사용자. */
export type MemoUser = {
  engineerId: number | null
  /** 발주 메뉴(영업관리)를 볼 수 있는가 — superadmin 도 여기에 들어온다. */
  isPurchaseTeam: boolean
}

/**
 * 발주 **요청 메모**(quotes.order_request_memo) — 견적 작성자가 발주서를 올리며 적는 글.
 * 작성자 본인은 어디서든 고칠 수 있어야 한다(내 견적에서도, 발주 목록에서도).
 * 영업관리는 받은 요청을 손질할 수 있다.
 */
export function canEditRequestMemo(user: MemoUser, quoteOwnerId: number | null | undefined): boolean {
  if (user.isPurchaseTeam) return true
  if (user.engineerId == null || quoteOwnerId == null) return false
  return user.engineerId === quoteOwnerId
}

/**
 * **영업관리 메모**(quotes.order_memo) — 발주를 처리하는 쪽이 적는 글.
 * 견적 작성자는 읽기만 한다(서로의 칸을 덮어쓰지 않는다).
 */
export function canEditOrderMemo(user: MemoUser): boolean {
  return user.isPurchaseTeam
}

/**
 * 수리 메모(repairs.repair_content) — 입고 등록 때 적는 자유 메모.
 * 수리 목록을 보는 사람이면 고친다(지금 규칙 그대로 — 수정 모달도 같은 문턱이다).
 */
export function canEditRepairMemo(canSeeRepairList: boolean): boolean {
  return canSeeRepairList
}

// ── 서버가 메모 저장 요청을 받아들일지 ─────────────────────────────────────
//   화면이 아니라 **서버의 판정**이다. 화면은 못 고치는 메모의 편집을 아예 열지 않지만,
//   요청은 화면을 거치지 않고도 올 수 있으므로 같은 규칙을 여기서 한 번 더 본다.
//   규칙을 라우트 안에 적어 두면 화면 쪽 규칙과 조용히 갈린다 — 그래서 한 함수다.

export type MemoSaveRequest = {
  /** 발주 메뉴가 있는 사람인가(영업관리·superadmin). */
  privileged: boolean
  /** 그 견적의 임자인가(quotes.engineer_id = 부른 사람). */
  isOwner: boolean
  /** 요청 메모를 보냈는가(보낸 칸만 갱신한다). */
  hasRequestMemo: boolean
  /** 영업관리 메모를 보냈는가. */
  hasOrderMemo: boolean
}

export type MemoSaveVerdict =
  | { ok: true }
  | { ok: false; status: 400 | 403; reason: string }

/** 메모 저장 요청 한 건의 판정. 거절이면 그대로 돌려줄 메시지까지 담는다. */
export function memoSaveVerdict(req: MemoSaveRequest): MemoSaveVerdict {
  if (!req.hasRequestMemo && !req.hasOrderMemo) {
    return { ok: false, status: 400, reason: '저장할 메모가 없습니다.' }
  }
  // 남의 견적은 발주 담당자만 만진다(요청 메모도 마찬가지다).
  if (!req.privileged && !req.isOwner) {
    return { ok: false, status: 403, reason: 'Forbidden' }
  }
  // 영업관리 메모는 발주 담당자 전용 — 견적 임자여도 못 고친다.
  if (req.hasOrderMemo && !req.privileged) {
    return { ok: false, status: 403, reason: '영업관리 메모는 발주 담당자만 고칠 수 있습니다.' }
  }
  return { ok: true }
}
