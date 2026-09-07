// 이니셜 중복 판정.
//
// 견적번호가 No.<이니셜><날짜>-<순번> 라서 같은 이니셜을 쓰는 재직자가 둘이면
// 같은 날 같은 번호가 나온다. quotes.quote_number 에는 unique 제약이 없어 두 건 모두 저장되고,
// PDF 는 번호로 파일명을 지어 앞사람 것이 덮어써진다.
//
// DB 의 부분 unique 인덱스(재직자 기준)가 최종 방어선이고, 여기 있는 것은
// "저장을 눌러보기 전에 알려주는" 화면·라우트 쪽 검사다. 둘 다 같은 문구를 쓴다.

export const INITIALS_TAKEN_MESSAGE = '이미 사용 중인 이니셜입니다'

/** 판정에 필요한 최소 형태. engineers 행을 그대로 넘길 수 있게 느슨하게 둔다. */
export type InitialsRow = {
  engineer_id: number
  initials?: string | null
  resigned_date?: string | null
}

/** 비교용으로 다듬는다 — 저장할 때도 대문자로 바꾸므로 판정도 같은 형태로 한다. */
export const normalizeInitials = (v: string | null | undefined): string =>
  (v ?? '').trim().toUpperCase()

/**
 * 이 이니셜을 이미 쓰는 재직자가 있는지.
 * 퇴사자는 세지 않는다 — 퇴사하면 그 이니셜을 다시 쓸 수 있다(DB 인덱스도 같은 기준이다).
 * selfId 를 주면 그 사람은 뺀다(수정할 때 자기 값을 자기와 비교하지 않도록).
 */
export function isInitialsTaken(
  list: InitialsRow[] | null | undefined,
  value: string | null | undefined,
  selfId?: number | null,
): boolean {
  const target = normalizeInitials(value)
  if (!target) return false   // 빈 값은 중복 판정 대상이 아니다(필수 여부는 각 화면이 따로 본다)
  return (list ?? []).some(e =>
    e.engineer_id !== selfId &&
    !e.resigned_date &&
    normalizeInitials(e.initials) === target
  )
}

/**
 * DB 가 튕겨낸 오류가 이니셜 unique 위반인지.
 * 인덱스 이름에 기대지 않고 23505 + 메시지에 initials 가 있는지로 본다
 * (이름이 바뀌어도 계속 잡히도록).
 */
export function isInitialsUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { code?: string; message?: string; details?: string }
  if (e.code !== '23505') return false
  return `${e.message ?? ''} ${e.details ?? ''}`.toLowerCase().includes('initials')
}
