/**
 * 명함 한 장을 **모델에게 읽힌다** — 서버에서만 (2026-11-24).
 *
 * 한 장짜리 라우트(/api/cards/ocr)와 여러 장 라우트(/api/cards/ocr-bulk)가 같은 길을
 * 쓰도록 여기로 모았다. 읽는 규칙이 두 군데로 갈리면 결과가 달라진다.
 *
 * ── 무엇을 받나 ──────────────────────────────────────────────────────────
 *   · 사진 — jpg · png · webp · gif (브라우저가 긴 변 1,200px 로 줄여 보낸다)
 *   · PDF  — **한 페이지짜리** (명함 스캐너가 페이지당 한 장으로 만든다).
 *     PDF 는 줄이지 않는다 — 브라우저에서 페이지만 떼어 그대로 보내고,
 *     모델에는 document 블록으로 넘긴다.
 *
 * ── 사진·PDF 는 남기지 않는다 ────────────────────────────────────────────
 * 메모리에서 base64 로 바꿔 모델에 넘기고 버린다. 디스크·Storage·로그 어디에도
 * 적지 않는다(파일 이름·바이트·base64 모두). 남기는 것은 **토큰 수**뿐이다.
 *
 * ── 모델 설정에서 지시와 다른 두 곳 ──────────────────────────────────────
 *   ① `temperature: 0` 을 보내지 않는다 — claude-haiku-5-5 는 기본값이 아닌
 *      temperature·top_p·top_k 를 **400 으로 거절한다.**
 *   ② 그 모델은 적응형 사고가 기본이고 사고 토큰도 max_tokens 에서 깎인다.
 *      600 토큰 안에 JSON 을 받으려면 꺼야 한다(`thinking: disabled`).
 */

import Anthropic from '@anthropic-ai/sdk'
import { OCR_KEYS, fieldsFromJson, parseOcrJson, type OcrKey } from '@/lib/businessCardOcr'

/** 받는 파일의 한도. */
export const MAX_BYTES = 10 * 1024 * 1024

export const MODEL = 'claude-haiku-5-5'
export const MAX_TOKENS = 600

type Media = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'

/** 사진 — 받는 형식과 모델에 적어 줄 이름. */
const MEDIA: Record<string, Media> = {
  'image/jpeg': 'image/jpeg', 'image/jpg': 'image/jpeg', 'image/pjpeg': 'image/jpeg',
  'image/png': 'image/png', 'image/webp': 'image/webp', 'image/gif': 'image/gif',
}

/** PDF — 스캐너가 만든 것. 페이지 하나에 명함 하나다. */
const PDF = 'application/pdf'

/** 이 파일을 읽을 수 있나 — 읽을 수 있으면 종류를, 아니면 null. */
export function kindOf(type: string | null | undefined): 'image' | 'pdf' | null {
  const t = String(type ?? '').toLowerCase().split(';')[0].trim()
  if (t === PDF) return 'pdf'
  return MEDIA[t] ? 'image' : null
}

/** 화면이 파일 고르기에 적을 값 — 사진과 PDF 둘 다. */
export const ACCEPT = 'image/*,application/pdf'

const SYSTEM = '명함 이미지에서 정보를 추출해 JSON 만 반환한다. 추측하지 말고 없는 값은 null.'

const ASK = [
  '이 명함에서 아래 칸을 읽어 JSON 하나로만 답하라. 설명·머리말·코드펜스 없이 JSON 만.',
  '',
  '{',
  '  "name": "한글(또는 현지어) 이름",',
  '  "name_en": "영문 이름",',
  '  "position": "직급·직책",',
  '  "department": "부서·팀",',
  '  "company": "회사명",',
  '  "company_en": "영문 회사명",',
  '  "phone": "대표·사무실 전화",',
  '  "mobile": "휴대폰",',
  '  "fax": "팩스",',
  '  "email": "이메일",',
  '  "address": "주소",',
  '  "website": "홈페이지"',
  '}',
  '',
  '규칙',
  '· 명함에 없는 값은 null. 추측하지 말 것.',
  '· 전화·휴대폰·팩스는 숫자와 하이픈만. 국가번호 +82 는 0 으로 바꾼다(+82-10-… → 010-…).',
  '· 한국어·영어·일본어 명함 모두 같은 칸에 담는다. 앞뒤 양면이 한 장에 있으면 둘 다 본다.',
  '· 한 줄에 두 값이 있으면(「M. 010-… hong@…」) 각자의 칸으로 나눈다.',
].join('\n')

export type OcrUsage = { input: number; output: number }
export type ReadFail = 'no_key' | 'no_file' | 'too_big' | 'bad_type' | 'parse' | 'api'
export type ReadResult =
  | { ok: true; fields: Record<OcrKey, string>; usage: OcrUsage }
  | { ok: false; reason: ReadFail; usage: OcrUsage }

const NO_USAGE: OcrUsage = { input: 0, output: 0 }

/** 응답에서 글자만 모은다. */
const textOf = (res: Anthropic.Message) =>
  res.content.filter(b => b.type === 'text').map(b => b.text).join('\n')

/**
 * 한 장을 읽는다. 던지지 않는다 — 실패도 값으로 돌려준다(여러 장을 한꺼번에 돌릴 때
 * 하나가 깨져도 나머지가 살아야 한다).
 */
export async function readCard(file: unknown, apiKey: string): Promise<ReadResult> {
  if (!(file instanceof File)) return { ok: false, reason: 'no_file', usage: NO_USAGE }
  if (file.size > MAX_BYTES) return { ok: false, reason: 'too_big', usage: NO_USAGE }
  const kind = kindOf(file.type)
  if (!kind) return { ok: false, reason: 'bad_type', usage: NO_USAGE }

  // 파일은 여기서만 산다 — 이 변수 밖으로 나가지 않는다.
  const data = Buffer.from(await file.arrayBuffer()).toString('base64')
  const block: Anthropic.ContentBlockParam = kind === 'pdf'
    ? { type: 'document', source: { type: 'base64', media_type: PDF, data } }
    : { type: 'image', source: { type: 'base64', media_type: MEDIA[file.type.toLowerCase()], data } }

  const client = new Anthropic({ apiKey })
  const usage: OcrUsage = { input: 0, output: 0 }

  try {
    // 한 번 부르고, JSON 이 아니면 **한 번만** 더 묻는다.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        thinking: { type: 'disabled' },
        system: SYSTEM,
        messages: [{ role: 'user', content: [block, { type: 'text', text: ASK }] }],
      })
      usage.input += res.usage.input_tokens
      usage.output += res.usage.output_tokens
      const json = parseOcrJson(textOf(res))
      if (json) return { ok: true, fields: fieldsFromJson(json), usage }
      console.warn('[cards-ocr] JSON 으로 읽지 못했다', { attempt, kind })
    }
    return { ok: false, reason: 'parse', usage }
  } catch (e) {
    // 까닭은 로그에만. 화면에는 「읽지 못했습니다」만 간다.
    console.error('[cards-ocr] 모델 호출 실패', e instanceof Error ? e.message : e)
    return { ok: false, reason: 'api', usage }
  }
}

/** 채운 칸 수 — 로그에 남기는 숫자(값은 남기지 않는다). */
export function filledCount(fields: Record<OcrKey, string>): number {
  return OCR_KEYS.filter(k => fields[k] !== '').length
}
