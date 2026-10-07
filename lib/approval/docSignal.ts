// 문서 창 ↔ 결재함 목록 사이의 **새로고침 신호**.
//
// 새 창에서 승인·반려·회수·재작성·폐기를 하면 뒤에 열려 있는 결재함 목록은 그 사실을 모른다.
// 사용자가 새로고침할 때까지 「아직 내 차례인」 문서가 목록에 남아 있다 — 눌러 보면 409 다.
// 그래서 처리에 성공한 창이 같은 출처의 다른 탭·창에 한 줄을 보낸다.
//
// 길은 둘이고, 되는 쪽을 쓴다.
//   ① BroadcastChannel — 같은 출처의 모든 탭이 받는다. 요즘 브라우저는 다 된다.
//   ② storage 이벤트 — ①이 없을 때. localStorage 에 썼다 지우면 **다른** 탭에서 이벤트가 난다
//      (쓴 탭에서는 나지 않는다 — 어차피 그 탭은 자기가 한 일을 안다).
// 둘 다 **같은 출처 안에서만** 동작한다. 서버를 거치지 않는다.
//
// 신호에는 **문서 id 와 동작 이름만** 담는다. 제목·금액·사람 같은 내용은 넣지 않는다 —
// 다른 탭에 어떤 화면이 떠 있을지 모르고, 알림창 하나 띄우는 데 문서 내용이 필요하지도 않다.
//
// 새 패키지는 쓰지 않는다.

/** 채널·저장소 열쇠 이름. **한 곳에만 적는다** — 보내는 쪽과 받는 쪽이 어긋나면 조용히 아무 일도 안 난다. */
export const DOC_SIGNAL_CHANNEL = 'acctk:approval:doc'

/** storage 폴백이 쓰는 열쇠. 값은 바로 지운다(남겨 두면 다음 탭이 옛 신호를 읽는다). */
const STORAGE_KEY = DOC_SIGNAL_CHANNEL

/** 보낼 수 있는 동작 — 결재 라우트의 action 이름과 같다. */
export const DOC_ACTIONS = ['approve', 'reject', 'withdraw', 'resubmit', 'discard'] as const
export type DocAction = typeof DOC_ACTIONS[number]

export type DocSignal = {
  /** 메시지 모양을 가리는 표. 다른 용도로 쓰는 신호와 섞이지 않게 한다. */
  kind: 'approval-doc-changed'
  documentId: number
  action: DocAction
  /** 보낸 시각(ms). 같은 문서를 연달아 처리했을 때 중복을 가릴 수 있게 둔다. */
  at: number
}

/**
 * 받은 값이 우리 신호인가 — **모양을 반드시 검사한다.**
 * BroadcastChannel·storage 는 같은 출처의 아무 코드나 쓸 수 있는 통로다. 모양이 아니면 버린다.
 */
export function readDocSignal(raw: unknown): DocSignal | null {
  if (!raw || typeof raw !== 'object') return null
  const v = raw as Partial<DocSignal>
  if (v.kind !== 'approval-doc-changed') return null
  if (!Number.isSafeInteger(v.documentId) || (v.documentId as number) <= 0) return null
  if (typeof v.action !== 'string' || !(DOC_ACTIONS as readonly string[]).includes(v.action)) return null
  return {
    kind: 'approval-doc-changed',
    documentId: v.documentId as number,
    action: v.action as DocAction,
    at: Number.isFinite(v.at) ? (v.at as number) : Date.now(),
  }
}

/** 문자열(storage 값)에서 신호를 읽는다. 깨진 JSON 은 조용히 버린다. */
export function parseDocSignal(raw: string | null): DocSignal | null {
  if (!raw) return null
  try {
    return readDocSignal(JSON.parse(raw) as unknown)
  } catch {
    return null
  }
}

/** 보낼 신호 한 줄을 만든다(순수). */
export const makeDocSignal = (documentId: number, action: DocAction, at = Date.now()): DocSignal =>
  ({ kind: 'approval-doc-changed', documentId, action, at })

/**
 * 신호를 보낸다. 실패해도 조용히 넘어간다 — 목록이 새로고침되지 않는 것과
 * 결재가 안 되는 것은 전혀 다른 일이다(알림 실패와 같은 규칙).
 */
export function sendDocSignal(documentId: number, action: DocAction): void {
  if (typeof window === 'undefined') return
  const msg = makeDocSignal(documentId, action)
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const ch = new BroadcastChannel(DOC_SIGNAL_CHANNEL)
      ch.postMessage(msg)
      ch.close()
      return
    }
  } catch (e) {
    console.error('[approval/doc] broadcast 실패 — storage 로 보낸다', e)
  }
  try {
    // 쓰고 바로 지운다. 다른 탭에서 storage 이벤트가 두 번 나지만(쓰기·지우기) 지우기는 newValue 가
    // null 이라 parseDocSignal 이 버린다.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(msg))
    localStorage.removeItem(STORAGE_KEY)
  } catch { /* 비공개 모드·저장소 차단. 신호를 못 보내도 처리는 끝났다 */ }
}

/**
 * 신호를 듣는다. 돌려주는 함수를 부르면 멈춘다(효과의 정리 함수로 그대로 쓴다).
 * 목록이 열려 있지 않으면 아무 일도 일어나지 않는다 — 듣는 쪽이 없을 뿐이다.
 */
export function listenDocSignal(onSignal: (s: DocSignal) => void): () => void {
  if (typeof window === 'undefined') return () => {}

  const stops: (() => void)[] = []

  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const ch = new BroadcastChannel(DOC_SIGNAL_CHANNEL)
      const onMessage = (e: MessageEvent) => {
        const s = readDocSignal(e.data as unknown)
        if (s) onSignal(s)
      }
      ch.addEventListener('message', onMessage)
      stops.push(() => { ch.removeEventListener('message', onMessage); ch.close() })
    }
  } catch (e) {
    console.error('[approval/doc] broadcast 수신 실패 — storage 로 듣는다', e)
  }

  // storage 는 BroadcastChannel 이 있어도 함께 듣는다 — 보내는 탭이 옛 브라우저일 수 있다.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return
    const s = parseDocSignal(e.newValue)
    if (s) onSignal(s)
  }
  window.addEventListener('storage', onStorage)
  stops.push(() => window.removeEventListener('storage', onStorage))

  return () => { for (const stop of stops) stop() }
}
