/**
 * 직원 재직/퇴사 표시 규칙.
 *
 * 퇴사자는 행이 삭제되지 않고 `resigned_date`(YYYY-MM-DD)가 기록된다.
 * 어떤 조회 기간에 대해, 그 기간 시작일까지 재직 중이었으면 목록에 표시한다.
 *
 *   - resigned_date 가 없으면(재직 중) 항상 표시
 *   - resigned_date >= periodStart 이면 표시 (그 기간에 일부라도 재직)
 *   - resigned_date <  periodStart 이면 숨김 (기간 시작 전에 이미 퇴사)
 *
 * 예) 7/10 퇴사 → 6·7월(시작일 6/1, 7/1) 조회엔 표시, 8월(시작일 8/1) 조회엔 숨김.
 *
 * 현재 팀원 목록(담당자 선택 등)에서는 periodStart 에 오늘 날짜를 넘기면 된다.
 */
export function isActiveInPeriod(
  resignedDate: string | null | undefined,
  periodStart: string
): boolean {
  if (!resignedDate) return true
  return resignedDate >= periodStart
}

/** 오늘(YYYY-MM-DD) 기준 현재 재직 중인지 — 현재 팀원 목록/담당자 선택용. */
export function isCurrentlyEmployed(
  resignedDate: string | null | undefined,
  today: string
): boolean {
  return isActiveInPeriod(resignedDate, today)
}

/**
 * 화면에 보이는 직원 이름 — 「이름 직급」(한 칸 띄움). 직급이 없으면 이름만.
 *
 * 같은 식(`${name} ${position ?? ''}`.trim())이 화면 곳곳에 흩어져 있었다.
 * 한 곳에서만 정해야 「권재원 선임」과 「권재원  선임」(두 칸)이 섞이지 않는다.
 * 직급 컬럼은 engineers.position 이다.
 *
 * 이름이 비어 있으면 빈 문자열을 돌려준다 — 부르는 쪽이 '-' 같은 자리표시를 고른다.
 */
export function engineerLabel(
  e: { name?: string | null; position?: string | null } | null | undefined,
): string {
  const name = (e?.name ?? '').trim()
  if (!name) return ''
  const position = (e?.position ?? '').trim()
  return position ? `${name} ${position}` : name
}
