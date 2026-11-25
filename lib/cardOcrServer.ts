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
import {
  OCR_KEYS, backSideFromJson, fieldsFromJson, parseOcrJson, upsideDownFromJson, type OcrKey,
} from '@/lib/businessCardOcr'

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
  '  "website": "홈페이지",',
  '  "is_back_side": false,',
  '  "text_upside_down": false',
  '}',
  '',
  '인쇄된 글자 그대로 — **번역·음차·로마자화·한글화 금지**',
  '· 모든 칸은 명함에 **인쇄된 글자를 그 문자 그대로** 옮긴다.',
  '· 영문만 있으면 **영문 그대로**, 일본어만 있으면 **일본어 그대로** 적는다.',
  '· 명함에 **없는 글자를 만들면 안 된다.** 아래는 모두 틀린 답이다 —',
  '  高橋秀明 → 「고교시」 · ACCRETECH KOREA → 「아크리테크코리아」 ·',
  '  JD Kim → 「김재동」 · Auditor → 「심사원」.',
  '· 직함(Manager·Auditor·CEO 등)도 **번역하지 않는다** — 인쇄된 그대로 적는다.',
  '',
  '어느 칸에 넣나',
  '· name · company · department · position = **그 면에 인쇄된 주 표기** 그대로.',
  '· name_en · company_en = **같은 면에 로마자 표기가 따로 있을 때만** 채운다. 없으면 null.',
  '  (영문만 적힌 명함이면 name·company 에 영문을 넣고 name_en·company_en 은 null 이다)',
  '',
  '규칙',
  '· 명함에 없는 값은 null. 추측하지 말 것.',
  '· 전화·휴대폰·팩스는 숫자와 하이픈만. 국가번호 +82 는 0 으로 바꾼다(+82-10-… → 010-…).',
  '· 번호에 「~」·「-」로 **범위**가 적혀 있으면(031-8059-5155~8) **앞 번호만** 넣는다',
  '  (→ 031-8059-5155). 끝 숫자를 이어 붙이지 않는다.',
  '· 이메일은 @ 앞부분을 **빠뜨리지 말고** 명함에 보이는 그대로 적는다',
  '  (yuto.nishimura@… 를 nishimura@… 로 줄이지 않는다). 확신이 없으면 null.',
  '· 이름은 **인쇄된 글자 그대로**. 비슷한 글자로 바꾸지 않는다(종↔제, 준↔춘 같은 것).',
  '· 한국어·영어·일본어 명함 모두 같은 칸에 담는다.',
  '· 한 줄에 두 값이 있으면(「M. 010-… hong@…」) 각자의 칸으로 나눈다.',
  '',
  'name 은 **사람 이름만** 넣는다',
  '· 회사명·부서명·슬로건·광고 문구를 name 에 넣지 않는다. 사람 이름이 없으면 name 은 null.',
  '· 「코디」·「담당」·「매니저」·「실장」 같은 직함은 **회사명이 아니다** — company 에 넣지 않는다.',
  '· 「예금주 홍길동」·「대표 홍길동」의 홍길동은 그 면의 주인이 아닐 수 있다 —',
  '  명함의 주인으로 적힌 이름이 아니면 name 에 넣지 않는다.',
  '· 계좌번호·사업자등록번호·법인번호는 **어떤 칸에도 넣지 않는다**(전화·팩스에도 아니다).',
  '',
  'is_back_side — 이 면이 **명함의 뒷면·보조면**인가',
  '· true: 사람 이름도 휴대폰도 이메일도 없고, 로고·슬로건·본사 주소·계좌번호·예금주·',
  '  취급 품목 같은 보조 정보만 있는 면.',
  '· false: 사람의 연락처가 있는 면. 한 쪽에 앞뒤가 같이 찍혔으면(돌아가 있어도) 둘을 합쳐',
  '  한 장으로 보고 false.',
  '· 빈 면·무늬만 있는 면·광고 스티커는 읽지 않는다 — name 과 company 를 둘 다 null 로 둔다.',
  '',
  'text_upside_down — **글자가 거꾸로 놓여** 읽기 어려운가',
  '· true 는 글자 방향 때문에 못 읽을 때만. 돌려 놓으면 읽히겠다 싶은 면이다.',
  '· 뒷면이라서·빈 면이라서 못 읽은 것은 **false** 다 — 돌려도 달라지지 않는다.',
  '· 글자를 읽어 칸을 채웠으면 false.',
  '',
  '전화번호의 나라',
  '· 우리나라 번호(+82)만 0 으로 바꾼다. 다른 나라 번호는 「+81-42-642-1701」처럼 그대로 둔다.',
  '· **일본 명함**(주소가 일본이거나 회사명이 일본어)의 전화·팩스에 국가번호가 없으면',
  '  **+81** 을 붙이고 앞의 0 을 뗀다: 042-642-0381 → +81-42-642-0381.',
  '  한국 명함의 번호는 그대로 둔다.',
].join('\n')

export type OcrUsage = { input: number; output: number }
export type ReadFail = 'no_key' | 'no_file' | 'too_big' | 'bad_type' | 'parse' | 'api'
export type ReadResult =
  /** `back` 이 참이면 **명함의 뒷면·보조면**이다 — 새 명함으로 담지 않는다.
   *  `upsideDown` 이 참이면 **글자가 거꾸로** 놓여 읽지 못했다 — 돌려서 다시 읽어 볼 값어치가 있다. */
  | { ok: true; fields: Record<OcrKey, string>; back: boolean; upsideDown: boolean; usage: OcrUsage }
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
      if (json) {
        return {
          ok: true, fields: fieldsFromJson(json),
          back: backSideFromJson(json), upsideDown: upsideDownFromJson(json), usage,
        }
      }
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
