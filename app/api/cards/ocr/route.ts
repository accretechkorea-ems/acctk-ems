// 명함 사진을 **읽는다** — Claude 비전 (2026-11-23).
//
// ── 왜 바꿨나 ────────────────────────────────────────────────────────────
//   2026-11-23 까지는 브라우저에서 돌리는 공개 OCR 패키지가 읽었다. 내가 그린 또렷한 샘플에서는
//   10/10 이었지만 **실제 사진 4장에서는 쓸 수 없는 수준**이었다. 모델로 바꾼다.
//
// ── 사진은 남기지 않는다 ─────────────────────────────────────────────────
//   받은 파일은 메모리에서 base64 로 바꿔 모델에 넘기고 버린다. 디스크에도, Storage 에도,
//   로그에도 적지 않는다(파일 이름·바이트·base64 모두). 남기는 것은 **토큰 수**뿐이다.
//
// ── 누가 ─────────────────────────────────────────────────────────────────
//   로그인한 직원이면 된다. 명함 등록과 같은 문턱이다.
//
// ── 열쇠가 없을 때 ───────────────────────────────────────────────────────
//   500 으로 떨어뜨리지 않는다. `{ ok:false, reason:'no_key' }` 로 조용히 알려 주고,
//   화면이 「OCR 설정이 안 되어 있습니다 — 관리자에게 문의」를 띄운 뒤 직접 입력으로 간다.
//
// ── 모델 쪽에서 지시와 다르게 간 두 곳(보고에 적었다) ────────────────────
//   ① `temperature: 0` 을 보내지 않는다 — claude-haiku-5-5 는 기본값이 아닌
//      temperature·top_p·top_k 를 **400 으로 거절한다.** 대신 `thinking: disabled` 로
//      흔들림을 줄였다.
//   ② 그 모델은 적응형 사고가 기본이고 **사고 토큰도 max_tokens 에서 깎인다.**
//      600 토큰 안에 JSON 을 받으려면 사고를 꺼야 한다(위와 같은 설정).

import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { loadCaller } from '@/lib/apiCaller'
import { OCR_KEYS, fieldsFromJson, parseOcrJson } from '@/lib/businessCardOcr'

const TAG = 'cards-ocr'

/** 받는 사진의 한도 — 이보다 크면 읽지 않는다(브라우저가 이미 줄여 보낸다). */
const MAX_BYTES = 10 * 1024 * 1024

const MODEL = 'claude-haiku-5-5'
const MAX_TOKENS = 600

type Media = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
const MEDIA: Record<string, Media> = {
  'image/jpeg': 'image/jpeg', 'image/jpg': 'image/jpeg', 'image/pjpeg': 'image/jpeg',
  'image/png': 'image/png', 'image/webp': 'image/webp', 'image/gif': 'image/gif',
}

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
  '  "memo_hint": "위 칸에 들어가지 않는 쓸모 있는 한 줄(없으면 null)"',
  '}',
  '',
  '규칙',
  '· 명함에 없는 값은 null. 추측하지 말 것.',
  '· 전화·휴대폰·팩스는 숫자와 하이픈만. 국가번호 +82 는 0 으로 바꾼다(+82-10-… → 010-…).',
  '· 한국어·영어·일본어 명함 모두 같은 칸에 담는다. 앞뒤 양면이 한 장에 있으면 둘 다 본다.',
  '· 한 줄에 두 값이 있으면(「M. 010-… hong@…」) 각자의 칸으로 나눈다.',
].join('\n')

type Ok = { ok: true; fields: Record<string, string>; usage: { input: number; output: number } }
type Fail = { ok: false; reason: 'no_key' | 'no_file' | 'too_big' | 'bad_type' | 'parse' | 'api' }

export async function POST(req: Request) {
  const { error: authErr } = await loadCaller({ kind: 'login' }, { tag: TAG, req, method: 'POST' })
  if (authErr) return authErr

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) {
    console.error(`[${TAG}] ANTHROPIC_API_KEY 가 없다 — 읽기를 건너뛴다`)
    return NextResponse.json<Fail>({ ok: false, reason: 'no_key' })
  }

  const form = await req.formData().catch(() => null)
  const file = form?.get('image')
  if (!(file instanceof File)) return NextResponse.json<Fail>({ ok: false, reason: 'no_file' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json<Fail>({ ok: false, reason: 'too_big' }, { status: 413 })

  const media = MEDIA[String(file.type || '').toLowerCase()]
  if (!media) return NextResponse.json<Fail>({ ok: false, reason: 'bad_type' }, { status: 415 })

  // 사진은 여기서만 산다 — 변수 밖으로 나가지 않는다.
  const base64 = Buffer.from(await file.arrayBuffer()).toString('base64')

  const client = new Anthropic({ apiKey: key })
  const ask = async () => client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    // 뽑아내기만 하는 일이다. 사고를 끄면 600 토큰이 전부 JSON 에 쓰인다.
    thinking: { type: 'disabled' },
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: media, data: base64 } },
        { type: 'text', text: ASK },
      ],
    }],
  })

  /** 응답에서 글자만 모은다. */
  const textOf = (res: Anthropic.Message) =>
    res.content.filter(b => b.type === 'text').map(b => b.text).join('\n')

  let input = 0
  let output = 0
  try {
    // 한 번 부르고, JSON 이 아니면 **한 번만** 더 묻는다.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const res = await ask()
      input += res.usage.input_tokens
      output += res.usage.output_tokens
      const json = parseOcrJson(textOf(res))
      if (json) {
        const fields = fieldsFromJson(json)
        const filled = OCR_KEYS.filter(k => fields[k] !== '').length
        // 남기는 것은 토큰 수와 채운 칸 수뿐이다 — 사진도, 읽은 값도 적지 않는다.
        console.log(`[${TAG}] read`, { attempt, input, output, filled })
        return NextResponse.json<Ok>({ ok: true, fields, usage: { input, output } })
      }
      console.warn(`[${TAG}] JSON 으로 읽지 못했다`, { attempt })
    }
    return NextResponse.json<Fail>({ ok: false, reason: 'parse' })
  } catch (e) {
    // 열쇠·한도·네트워크 — 까닭은 로그에만, 화면에는 「읽지 못했습니다」만.
    console.error(`[${TAG}] 모델 호출 실패`, e instanceof Error ? e.message : e)
    return NextResponse.json<Fail>({ ok: false, reason: 'api' }, { status: 502 })
  }
}
