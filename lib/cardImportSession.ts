'use client'

/**
 * 읽은 묶음을 **검토 화면까지 들고 가는 자리** (2026-11-25).
 *
 * 쪽 이미지는 서버로 보내지 않는다(OCR 호출 때 한 번 보내고 끝이다). 그래서 검토
 * 화면이 쓸 이미지는 **브라우저 메모리**에만 둔다 — 이 모듈 변수다. 화면을 옮겨도
 * (같은 탭 안에서는) 살아 있고, 새로고침하면 사라진다. 그때는 이미지 없이 글자만
 * 보며 검토한다(「본인 PDF N쪽을 보며 검토해 주세요」).
 *
 * ⚠ 여기에 담은 Blob 은 **어디에도 올라가지 않는다.** object URL 로만 쓰고 창을
 *   닫을 때 거둔다(revoke).
 */

import type { BulkReason } from './businessCardBulk'

/** 한 쪽. */
export type ImportPage = {
  /** 전체에서 몇 쪽인가(0부터). */
  page: number
  /** 쪽 이미지 — PDF 한 장 또는 사진. **메모리에만** 둔다. */
  blob: Blob | null
  /** 읽은 결과의 판정. */
  reason: BulkReason | null
  /** 담긴 줄(있으면). */
  cardId: number | null
  /** 합쳐 들어간 명함의 쪽(있으면). */
  mergedIntoPage: number | null
}

export type ImportSession = {
  batchId: string
  fileName: string
  /** 전체 쪽 수. */
  total: number
  /** 이번 묶음에서 읽은 쪽들(앞에서부터). */
  pages: ImportPage[]
  /** 아직 읽지 않은 쪽의 파일 — 「다음 20쪽 읽기」가 쓴다. */
  rest: { page: number; file: File }[]
  usage: { input: number; output: number }
}

let session: ImportSession | null = null

export function putSession(next: ImportSession): void {
  session = next
}

export function getSession(): ImportSession | null {
  return session
}

/** 창을 닫을 때 — object URL 을 거두고 메모리를 비운다. */
export function clearSession(): void {
  session = null
}

/** 그 쪽의 보기 주소. 없으면 null(이미지 없이 검토한다). */
export function pageUrl(page: ImportPage | undefined | null): string | null {
  if (!page?.blob) return null
  return URL.createObjectURL(page.blob)
}
