/**
 * 회사 영문명(`customers.name_en`) — **칸이 아직 없어도 화면이 멈추지 않게** 하는 한 곳.
 *
 * 이 칸은 db/customer_name_en_20261119.sql 로 더한다. 코드가 먼저 배포되거나 SQL 이
 * 아직 안 돌았으면 PostgREST 는 모르는 칸이 섞인 **조회 전체를 400 으로** 돌려보낸다.
 * 그러면 영문명 한 칸 때문에 견적 고객사 찾기·쇼룸 찾기·회사 목록이 통째로 빈다.
 *
 * 그래서 이 파일은 두 가지만 한다.
 *   · `searchOr` — 검색 조건을 영문명을 보는 판과 안 보는 판으로 만든다.
 *   · `withNameEnFallback` — 첫 조회가 「그런 칸 없다」로 실패하면 **한 번만** 영문명
 *     없이 다시 돌린다(영문명으로는 안 걸리고, 나머지는 그대로 걸린다).
 *
 * 칸이 생긴 뒤에는 첫 시도가 바로 성공하므로 이 되돌이길은 지나가지 않는다.
 * 칸이 자리를 잡으면 이 파일을 지우고 호출부를 평범한 조회로 되돌리면 된다.
 */

/** PostgREST 가 돌려주는 오류의 최소 모양 — supabase-js 의 PostgrestError 를 포함한다. */
type PgErrorLike = { code?: string | null; message?: string | null } | null | undefined

/** 「그런 칸 없다」인가. 42703 은 postgres 의 undefined_column 이다. */
export function isMissingNameEn(error: PgErrorLike): boolean {
  if (!error) return false
  return error.code === '42703' || /name_en/.test(error.message ?? '')
}

/**
 * 고객사 검색의 or 조건. 회사명·사업장명은 늘 보고, 영문명은 칸이 있을 때만 본다.
 * (합친 이름이 company_name 에 들어 있지만 사업장명만으로 찾는 사람도 있어 둘 다 건다.)
 */
export function searchOr(q: string, withNameEn: boolean): string {
  const base = `company_name.ilike.%${q}%,site_name.ilike.%${q}%`
  return withNameEn ? `${base},name_en.ilike.%${q}%` : base
}

/** select 문자열에 영문명을 붙일지 — 칸이 없으면 빼고 읽는다. */
export function colsWithNameEn(cols: string, withNameEn: boolean): string {
  return withNameEn ? `${cols}, name_en` : cols
}

/**
 * 영문명 칸이 없으면 **한 번만** 그 칸 없이 다시 돌린다.
 * `run(true)` 가 영문명을 보는 조회, `run(false)` 가 안 보는 조회다.
 */
export async function withNameEnFallback<R extends { error: PgErrorLike }>(
  run: (withNameEn: boolean) => PromiseLike<R>,
): Promise<R> {
  const first = await run(true)
  if (!isMissingNameEn(first.error)) return first
  console.warn('[name_en] 칸이 아직 없다 — 영문명 없이 다시 읽는다 (db/customer_name_en_20261119.sql 을 적용해라)')
  return run(false)
}
