'use client'

// 가격표(price_list) 품목 검색 — **한 곳에서만 한다.**
//
// 예전에는 이 질의가 품목 행 훅(hooks/quote/useQuoteRows.ts) 안에 박혀 있어서, 장비 구성
// 모달이 같은 검색을 하려면 질의를 한 벌 더 써야 했다. 질의가 둘이 되면 찾는 범위가 조용히
// 갈라진다(한쪽만 모델명을 보고 다른 쪽은 품번만 보는 식으로). 그래서 함수로 뽑았다.
// 지금 이 함수를 쓰는 곳은 둘이다 — 견적 품목 행(useQuoteRows)과 장비 구성 모달(EquipAddRow).
//
// ── 찾는 범위: 세 열 ────────────────────────────────────────────────────────
//   item_code(품번) · item_name_jp(품명) · model_jp(모델) 부분 일치, 대소문자 무시.
//   세 열은 가격표 파서의 머리글 매핑과 같다(lib/priceListParse.ts 의 HEADER_COLUMN).
//
// ── 여러 단어는 **전부 포함(AND)** ─────────────────────────────────────────
//   사람은 「SNEX 100」·「스타일러스 거칠기」처럼 **띄어서** 친다. 예전에는 친 글자를
//   통째로 한 번 ilike 했기 때문에, 저장된 글자에 그 공백이 그대로 없으면
//   (예: 'SURFCOM NEX 100') 아무것도 안 나왔다. 지금은 단어마다 조건을 만들고
//   **모든 단어가** 세 열 중 어디든 걸려야 결과로 본다.
//   PostgREST 에서 or() 를 여러 번 부르면 서로 AND 로 묶인다 — 그 성질을 쓴다.
//
// ── 순서: 품번이 위로 ──────────────────────────────────────────────────────
//   품번 앞부분 일치 → 품번 포함 → 품명·모델만 일치. 사람이 품번을 치면 그게 맨 위에 와야 한다.
//   DB 는 순서를 보장하지 않으므로 **받아서 우리가 매긴다.** 그래서 보여 줄 수보다 넉넉히
//   받아 와 정렬한 뒤 자른다(안 그러면 DB 가 임의로 고른 20건 안에서만 순서를 바꾸게 된다).

import type { SupabaseClient } from '@supabase/supabase-js'
import type { PriceItem } from '@/app/quote/types'

/** 화면에 보여 주는 후보 수. 드롭다운이 읽히는 선이다(종전 값 그대로). */
export const PRICE_SEARCH_LIMIT = 20
/** DB 에서 받아 오는 수 — 정렬할 재료를 넉넉히 받는다. 받은 뒤 위 수만큼 자른다. */
const FETCH_LIMIT = PRICE_SEARCH_LIMIT * 3
/** 한 번에 보는 단어 수. 더 치면 뒤는 무시한다(조건이 끝없이 늘어나지 않게). */
const MAX_WORDS = 5

/** 검색할 세 열. 순서는 뜻이 없다. */
const COLUMNS = ['item_code', 'item_name_jp', 'model_jp'] as const

/**
 * 검색어를 단어로 쪼갠다.
 * PostgREST 의 or=(…) 는 **쉼표로 조건을 나눈다.** 검색어에 쉼표·괄호가 섞이면 필터가 깨져
 * 조회가 통째로 실패하므로(품번 두 개를 붙여 치는 일이 있다) 그런 글자는 공백으로 바꾼다.
 */
function words(q: string): string[] {
  return q
    .replace(/[,()%]/g, ' ')
    .split(/\s+/)
    .map(w => w.trim())
    .filter(Boolean)
    .slice(0, MAX_WORDS)
}

/**
 * 결과 순서 — 품번 일치가 위로.
 *   0 품번이 첫 단어로 시작  1 품번에 어느 단어든 들어 있음  2 품명·모델만 일치
 * 같은 등급이면 품번 오름차순으로 — 같은 검색어에 늘 같은 순서가 나와야 한다.
 */
function rank(item: PriceItem, ws: string[]): number {
  const code = (item.item_code ?? '').toLowerCase()
  if (ws.length > 0 && code.startsWith(ws[0])) return 0
  if (ws.some(w => code.includes(w))) return 1
  return 2
}

/**
 * 품번·품명·모델로 가격표를 찾는다.
 *
 * sheets — 찾을 **종류(sheet_name) 허용 목록**이다. 견적 양식이 20 이면 20 가격표만,
 *   80 이면 80 가격표만 본다(lib/priceListKinds.ts 의 sheetsForForm 이 그 목록을 만든다).
 *   null·빈 배열이면 **전체**에서 찾는다 — 양식을 아직 고르지 않았거나 사람이
 *   「전체 가격표에서 검색」을 켠 경우다.
 *
 * 빈 글자면 조회하지 않고 빈 배열을 돌려준다 — 한두 글자로 표 전체를 긁지 않게.
 * 실패해도 던지지 않는다(빈 배열) — 검색이 안 된다고 견적 작성을 멈출 이유가 없다.
 */
export async function searchPriceList(
  supabase: SupabaseClient, q: string, sheets?: readonly string[] | null,
): Promise<PriceItem[]> {
  const ws = words(q)
  if (ws.length === 0) return []

  let query = supabase.from('price_list').select('*')
  // 단어마다 조건 한 묶음 — or() 를 여러 번 부르면 서로 AND 로 묶인다.
  for (const w of ws) {
    query = query.or(COLUMNS.map(c => `${c}.ilike.%${w}%`).join(','))
  }
  // 허용 목록이 있으면 그 종류 안에서만 찾는다.
  if (sheets && sheets.length > 0) query = query.in('sheet_name', sheets)

  const { data, error } = await query.limit(FETCH_LIMIT)
  if (error) {
    console.error('[priceSearch] 조회 실패', { q, error })
    return []
  }

  const lower = ws.map(w => w.toLowerCase())
  return (data ?? [] as PriceItem[])
    .slice()
    .sort((a: PriceItem, b: PriceItem) => {
      const d = rank(a, lower) - rank(b, lower)
      if (d !== 0) return d
      return (a.item_code ?? '').localeCompare(b.item_code ?? '')
    })
    .slice(0, PRICE_SEARCH_LIMIT) as PriceItem[]
}
