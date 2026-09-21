// 서비스 레포트 첨부파일 — 브라우저 쪽 공용 로직.
// UI(ServiceAttachments.tsx)와 훅(useServiceCrud·useCustomerCrud)이 함께 쓴다.
//
// 업로드·삭제는 전부 /api/service-attachment(service role)를 거친다. 브라우저에서
// 스토리지를 직접 건드리지 않는다 — 버킷이 비공개고 파일명도 서버가 정한다.
import { downsizeImage } from '@/lib/leadCardImage'
import type { ServiceAttachment } from './types'

/** 서비스 기록 1건당 첨부 상한. 라우트의 MAX_PER_SERVICE 와 같은 값이어야 한다. */
export const ATTACH_MAX = 10
/** 파일 하나의 상한. 라우트의 MAX_BYTES 와 같다. */
export const ATTACH_MAX_BYTES = 20 * 1024 * 1024
/** 패킹리스트와 같은 화이트리스트(pdf·엑셀·워드·이미지). */
export const ATTACH_ACCEPT = '.pdf,.xlsx,.xls,.doc,.docx,.png,.jpg,.jpeg'

/** 업로드 최대 시도 횟수(첫 시도 포함). 버튼에 「올리는 중... (2/3)」 로 보여준다. */
export const UPLOAD_TRIES = 3
/** 재시도 간격. */
const RETRY_DELAY_MS = 2000
/**
 * 시도 하나의 제한 시간. 첫 요청이 콜드 스타트에 걸리면 응답이 오지 않고 매달릴 수 있어
 * 스스로 끊고 다시 건다. 20MB 를 느린 회선으로 올리는 경우까지 감안해 넉넉히 잡았다.
 */
const ATTEMPT_TIMEOUT_MS = 120_000

const ALLOWED_EXT = ['pdf', 'xlsx', 'xls', 'doc', 'docx', 'png', 'jpg', 'jpeg']

const API = '/api/service-attachment'

export type AttachmentPayload = { name: string; dataUrl: string }
type Fail = { ok: false; error: string }

/** 업로드 진행 알림 — (몇 번째 시도, 전체 시도 수). 버튼 문구에 쓴다. */
export type UploadProgress = (attempt: number, total: number) => void

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i + 1).toLowerCase()
}

/** 파일 하나를 그대로 data URL 로 읽는다(문서용 — 줄이지 않는다). */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

/**
 * 고른 파일들을 업로드용 data URL 로 바꾼다.
 * 이미지는 명함과 같은 방식으로 브라우저에서 줄인다(긴 변 1600px, JPEG 0.8) —
 * lib/leadCardImage.ts 의 downsizeImage 를 그대로 쓴다.
 * PDF·엑셀·워드는 손대지 않고 그대로 보낸다.
 */
export async function toAttachmentPayload(files: File[]): Promise<{ ok: true; items: AttachmentPayload[] } | Fail> {
  const items: AttachmentPayload[] = []
  for (const file of files) {
    const ext = extOf(file.name)
    if (!ALLOWED_EXT.includes(ext)) {
      return { ok: false, error: 'PDF, 엑셀, 워드, 이미지 파일만 올릴 수 있습니다.' }
    }
    const isImage = ext === 'png' || ext === 'jpg' || ext === 'jpeg'
    try {
      if (isImage) {
        // 줄인 뒤의 크기만 보면 된다. 원본이 커도 canvas 를 거치면 대개 수백 KB 다.
        const r = await downsizeImage(file)
        items.push({ name: file.name, dataUrl: r.dataUrl })
      } else {
        if (file.size > ATTACH_MAX_BYTES) {
          return { ok: false, error: `${file.name} 은(는) 20MB 를 넘습니다.` }
        }
        items.push({ name: file.name, dataUrl: await readAsDataUrl(file) })
      }
    } catch (e) {
      console.error('[첨부] 파일을 읽지 못했다', { name: file.name, error: e })
      return { ok: false, error: `${file.name} 을(를) 읽지 못했습니다.` }
    }
  }
  return { ok: true, items }
}

async function errorOf(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null) as { error?: string } | null
  return body?.error || fallback
}

/**
 * 다시 걸어 볼 가치가 있는 실패인지.
 *   · 5xx — 서버가 아직 깨어나지 않았거나 일시적인 문제다
 *   · 408·429 — 시간 초과·혼잡. 잠시 뒤면 통한다
 * 400(검증 실패)·401·403·404 는 몇 번을 걸어도 같은 답이 온다 — 그대로 알린다.
 */
const worthRetry = (status: number) => status >= 500 || status === 408 || status === 429

/**
 * 업로드 한 건. 실패하면 2초 간격으로 최대 UPLOAD_TRIES 번까지 다시 건다.
 * 처음 한두 번 실패하다 뒤늦게 붙는 콜드 스타트를 사용자가 겪지 않게 하려는 것이다.
 */
async function postWithRetry(
  payload: { serviceId: number; files: AttachmentPayload[] },
  onAttempt?: UploadProgress,
): Promise<{ ok: true; attachments: ServiceAttachment[] } | Fail> {
  let lastDetail = ''

  for (let attempt = 1; attempt <= UPLOAD_TRIES; attempt++) {
    onAttempt?.(attempt, UPLOAD_TRIES)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS)
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      if (res.ok) {
        const body = await res.json().catch(() => null) as { attachments?: ServiceAttachment[] } | null
        if (body?.attachments) return { ok: true, attachments: body.attachments }
        lastDetail = '응답을 읽지 못했습니다'
        console.error('[첨부] 업로드 응답이 비어 있다', { attempt, serviceId: payload.serviceId })
      } else {
        const detail = await errorOf(res, res.statusText || '알 수 없는 오류')
        console.error('[첨부] 업로드 실패(서버 응답)', {
          attempt, tries: UPLOAD_TRIES, serviceId: payload.serviceId,
          status: res.status, statusText: res.statusText, detail,
        })
        // 검증 실패처럼 다시 걸어도 결과가 같은 것은 즉시 돌려준다.
        if (!worthRetry(res.status)) return { ok: false, error: detail }
        lastDetail = `${res.status} ${detail}`
      }
    } catch (e) {
      // AbortError = 위 타이머가 끊은 것(시간 초과). 그 밖은 네트워크 단절이다.
      const timedOut = e instanceof DOMException && e.name === 'AbortError'
      lastDetail = timedOut ? `응답 시간 초과(${ATTEMPT_TIMEOUT_MS / 1000}초)` : (e instanceof Error ? e.message : String(e))
      console.error('[첨부] 업로드 실패(네트워크)', {
        attempt, tries: UPLOAD_TRIES, serviceId: payload.serviceId, timedOut, error: e,
      })
    } finally {
      clearTimeout(timer)
    }

    if (attempt < UPLOAD_TRIES) await sleep(RETRY_DELAY_MS)
  }

  return { ok: false, error: `첨부파일을 올리지 못했습니다. ${UPLOAD_TRIES}번 시도했습니다 (${lastDetail}).` }
}

/** 서비스 기록에 파일 여러 개를 올린다. 실패는 재시도를 거친 뒤의 결과다. */
export async function uploadAttachments(
  serviceId: number,
  files: File[],
  onAttempt?: UploadProgress,
): Promise<{ ok: true; attachments: ServiceAttachment[] } | Fail> {
  if (files.length === 0) return { ok: true, attachments: [] }
  const prepared = await toAttachmentPayload(files)
  if (!prepared.ok) return prepared
  return postWithRetry({ serviceId, files: prepared.items }, onAttempt)
}

/** 첨부 1건 삭제. 권한(올린 사람·superadmin)은 서버가 본다. */
export async function deleteAttachment(attachmentId: number): Promise<{ ok: true } | Fail> {
  try {
    const res = await fetch(API, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attachmentId }),
    })
    if (!res.ok) return { ok: false, error: await errorOf(res, '첨부파일을 지우지 못했습니다.') }
    return { ok: true }
  } catch (e) {
    console.error('[첨부] 삭제 요청 실패', e)
    return { ok: false, error: '첨부파일을 지우지 못했습니다.' }
  }
}

/**
 * 서비스 기록에 달린 첨부를 파일까지 전부 지운다.
 * 서비스 기록·고객사를 지우기 전에 부른다 — DB 행은 CASCADE 로 사라지지만
 * 스토리지 파일은 그대로 남기 때문이다.
 */
export async function deleteServiceAttachments(serviceId: number): Promise<{ ok: true; removed: number } | Fail> {
  try {
    const res = await fetch(API, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceId }),
    })
    if (!res.ok) return { ok: false, error: await errorOf(res, '첨부파일을 지우지 못했습니다.') }
    const body = await res.json().catch(() => ({})) as { removed?: number }
    return { ok: true, removed: body.removed ?? 0 }
  } catch (e) {
    console.error('[첨부] 정리 요청 실패', e)
    return { ok: false, error: '첨부파일을 지우지 못했습니다.' }
  }
}

/** 첨부를 새 탭에서 연다(1시간짜리 서명 URL). */
export async function openAttachment(attachmentId: number): Promise<{ ok: true } | Fail> {
  try {
    const res = await fetch(`${API}?attachmentId=${attachmentId}`)
    if (!res.ok) return { ok: false, error: await errorOf(res, '첨부파일을 열 수 없습니다.') }
    const body = await res.json() as { signedUrl?: string }
    if (!body.signedUrl) return { ok: false, error: '첨부파일을 열 수 없습니다.' }
    window.open(body.signedUrl, '_blank', 'noopener')
    return { ok: true }
  } catch (e) {
    console.error('[첨부] 열기 요청 실패', e)
    return { ok: false, error: '첨부파일을 열 수 없습니다.' }
  }
}
