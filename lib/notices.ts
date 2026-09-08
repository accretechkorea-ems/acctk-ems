// 오늘 날짜는 공용 유틸(lib/date.ts)에서 가져온다 — 화면·서버가 같은 기준을 쓰게 한다.
import { todayKST } from './date'

// 공지 팝업 공용 상수·판정. 화면(관리자 폼·팝업)과 API 라우트가 같은 값을 본다.

/** 스토리지 버킷(공개). 팝업이 서명 URL 없이 바로 그리도록 공개로 둔다. */
export const NOTICE_BUCKET = 'notices'

/** 한 공지에 붙일 수 있는 이미지 수. */
export const NOTICE_MAX_IMAGES = 3

/**
 * 서버가 받는 이미지 한 장의 최대 바이트.
 * 화면이 긴 변 1600px · JPEG 0.8 로 줄여 보내면 보통 200~500KB 라 2MB 면 충분하고,
 * 화면을 거치지 않는 호출로 큰 파일이 들어오는 것을 막는 상한이다(명함과 같은 기준).
 */
export const NOTICE_IMAGE_MAX_BYTES = 2 * 1024 * 1024

export const NOTICE_TITLE_MAX = 100
export const NOTICE_BODY_MAX = 4000

/** 목록 한 줄. 관리자 화면과 팝업이 같은 모양을 쓴다. */
export type Notice = {
  notice_id: number
  title: string
  body: string | null
  image_urls: string[] | null
  starts_at: string   // YYYY-MM-DD
  ends_at: string     // YYYY-MM-DD
  created_at: string
}


/** 게시 상태 — 목록 탭과 팝업 노출 판정에 같은 함수를 쓴다. */
export type NoticePhase = 'upcoming' | 'active' | 'ended'

export function noticePhase(n: Pick<Notice, 'starts_at' | 'ends_at'>, today = todayKST()): NoticePhase {
  if (today < n.starts_at) return 'upcoming'
  if (today > n.ends_at) return 'ended'
  return 'active'
}

// ── 「보지 않기」 — localStorage 에만 남긴다 ────────────────────────────────
// 누가 봤는지 확인할 일이 없어 DB 에 쓰지 않는다. 공지마다 따로 관리한다.
// 값은 "다시 볼 수 있게 되는 시각(ms)" 이고, 영구 숨김은 Infinity 대신 큰 수를 쓴다
// (JSON 이 Infinity 를 못 담아 localStorage 에서 null 로 돌아온다).
const KEY = (noticeId: number) => `notice:dismiss:${noticeId}`
const FOREVER = 8640000000000000   // Date 가 표현할 수 있는 최대치

export type DismissKind = 'day' | 'week' | 'forever'

export function dismissNotice(noticeId: number, kind: DismissKind): void {
  const until =
    kind === 'day' ? Date.now() + 24 * 60 * 60 * 1000
    : kind === 'week' ? Date.now() + 7 * 24 * 60 * 60 * 1000
    : FOREVER
  try { localStorage.setItem(KEY(noticeId), String(until)) } catch { /* 저장 못 해도 팝업 동작은 유지 */ }
}

/** 지금 이 공지를 숨겨야 하는지. 값이 없거나 기한이 지났으면 다시 보여준다. */
export function isDismissed(noticeId: number): boolean {
  try {
    const raw = localStorage.getItem(KEY(noticeId))
    if (!raw) return false
    const until = Number(raw)
    return Number.isFinite(until) && Date.now() < until
  } catch {
    return false
  }
}

/** 공지를 지울 때 남은 찌꺼기를 치운다(관리자 화면에서 삭제 후 호출). */
export function clearDismiss(noticeId: number): void {
  try { localStorage.removeItem(KEY(noticeId)) } catch { /* 무시 */ }
}
