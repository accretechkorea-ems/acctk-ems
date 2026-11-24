/**
 * 명함 **여러 장 등록**의 규칙 한 곳 (2026-11-24).
 *
 * 라우트(app/api/cards/ocr-bulk)·화면(components/cards/BulkImportModal)·하네스가
 * 같은 값을 본다. 숫자와 문구가 세 군데로 갈리지 않게 한다.
 *
 * 화면도 함께 쓰므로 **서버 전용 코드를 넣지 않는다**(모델 호출은 lib/cardOcrServer.ts).
 */

/**
 * 한 요청에 보내는 파일 수.
 *
 * Vercel 함수의 제한 시간 때문이다. 한 장에 3~6초가 걸리므로 셋을 동시에 읽어도 한
 * 요청이 그 안에서 끝난다. 더 묶으면 한 요청이 통째로 죽으면서 그 안의 성공분까지
 * 잃는다 — 나눠 보내면 앞의 묶음은 이미 담긴 뒤다.
 */
export const MAX_PER_REQUEST = 3

/** 일괄로 담은 줄의 방식. db/business_cards_bulk_20261124.sql 이 CHECK 에 넣어 준다. */
export const BULK_METHOD = 'bulk'

/** 담지 못한 까닭. */
export type BulkReason =
  /** 읽힌 번호·메일이 이미 있는 명함과 같다. */
  | 'dup'
  /** 이름도 회사도 못 읽었다 — 빈 줄을 쌓지 않는다. */
  | 'empty'
  | 'no_key' | 'no_file' | 'too_big' | 'bad_type' | 'parse' | 'api'
  /** 읽기는 됐는데 담다가 실패했다. */
  | 'save'
  /**
   * 표가 아직 'bulk' 를 받지 않는다(CHECK 제약, 23514).
   * db/business_cards_bulk_20261124.sql 을 돌리기 전에는 **한 장도 담기지 않는다** —
   * 그냥 「담는 중 오류」로 두면 무엇을 해야 하는지 알 수 없어 따로 뗀다.
   */
  | 'schema'

/** 적용해야 하는 파일 — 화면이 그대로 보여 준다. */
export const BULK_SQL_FILE = 'db/business_cards_bulk_20261124.sql'

/** 사람에게 보여 줄 까닭. */
export const BULK_REASON_LABEL: Record<BulkReason, string> = {
  dup: '이미 있는 명함',
  empty: '이름·회사를 못 읽음',
  no_key: 'OCR 설정 없음',
  no_file: '파일을 받지 못함',
  too_big: '파일이 너무 큼',
  bad_type: '읽을 수 없는 형식',
  parse: '글자를 읽지 못함',
  api: '읽는 중 오류',
  save: '담는 중 오류',
  schema: `표 손질이 먼저 필요합니다 — ${BULK_SQL_FILE}`,
}

/** 한 장의 결과. index 는 **그 요청 안에서의 차례**(0‥2)다. */
export type BulkLine =
  | { index: number; ok: true; card_id: number }
  | { index: number; ok: false; reason: BulkReason; card_id?: number; name?: string | null }

/** 라우트의 응답. */
export type BulkResponse =
  | { ok: true; lines: BulkLine[]; usage: { input: number; output: number } }
  | { ok: false; reason: string; max?: number }

/** 진행 집계 — 화면이 한 줄로 보여 준다. */
export type BulkTally = { done: number; saved: number; dup: number; failed: number }

export const EMPTY_TALLY: BulkTally = { done: 0, saved: 0, dup: 0, failed: 0 }

/** 한 묶음의 결과를 집계에 더한다. */
export function addLines(tally: BulkTally, lines: readonly BulkLine[]): BulkTally {
  let { done, saved, dup, failed } = tally
  for (const l of lines) {
    done += 1
    if (l.ok) saved += 1
    else if (l.reason === 'dup') dup += 1
    else failed += 1
  }
  return { done, saved, dup, failed }
}

/** 「137 / 300」. */
export function progressLabel(done: number, total: number): string {
  return `${done} / ${total}`
}

/** 0‥100. 총 개수를 모르면 0. */
export function progressPercent(done: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(100, Math.round((done / total) * 100))
}

/** 끝났을 때 한 줄. */
export function summaryLabel(t: BulkTally): string {
  return `등록 ${t.saved} · 중복 ${t.dup} · 실패 ${t.failed}`
}

/** 진행 중에 닫으려 할 때 묻는 말 — 이미 담긴 것은 남는다는 사실을 먼저 적는다. */
export function stopQuestion(saved: number): string {
  return `지금까지 읽힌 ${saved}건은 저장되어 있습니다. 중단할까요?`
}

/** 파일을 세 개씩 끊는다. */
export function chunk<T>(items: readonly T[], size = MAX_PER_REQUEST): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
