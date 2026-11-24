// 명함 **한 장**을 읽는다 — Claude 비전 (2026-11-23, PDF 2026-11-24).
//
// ── 왜 있나 ──────────────────────────────────────────────────────────────
//   2026-11-23 까지는 브라우저에서 돌리는 공개 OCR 패키지가 읽었다. 내가 그린 또렷한
//   샘플에서는 10/10 이었지만 **실제 사진 4장에서는 쓸 수 없는 수준**이었다. 모델로 바꿨다.
//
// ── 무엇을 받나 ──────────────────────────────────────────────────────────
//   사진(jpg·png·webp·gif) 또는 **한 페이지짜리 PDF**. 스캐너가 페이지당 명함 하나로
//   만들어 주므로, 브라우저가 페이지를 떼어 한 장씩 보낸다(2026-11-24).
//   읽는 규칙은 lib/cardOcrServer.ts 하나다 — 여러 장 라우트와 같은 길을 쓴다.
//
// ── 사진은 남기지 않는다 ─────────────────────────────────────────────────
//   메모리에서 base64 로 바꿔 모델에 넘기고 버린다. 디스크에도, Storage 에도,
//   로그에도 적지 않는다. 남기는 것은 **토큰 수**뿐이다.
//
// ── 누가 ─────────────────────────────────────────────────────────────────
//   로그인한 직원이면 된다. 명함 등록과 같은 문턱이다.
//
// ── 열쇠가 없을 때 ───────────────────────────────────────────────────────
//   500 으로 떨어뜨리지 않는다. `{ ok:false, reason:'no_key' }` 로 조용히 알려 주고,
//   화면이 「OCR 설정이 안 되어 있습니다 — 관리자에게 문의」를 띄운 뒤 직접 입력으로 간다.

import { NextResponse } from 'next/server'
import { loadCaller } from '@/lib/apiCaller'
import { filledCount, readCard, type ReadFail } from '@/lib/cardOcrServer'

const TAG = 'cards-ocr'

/** 까닭마다 알맞은 응답 번호 — 열쇠 없음만 200 으로 조용히 알린다. */
const STATUS: Record<ReadFail, number> = {
  no_key: 200, no_file: 400, too_big: 413, bad_type: 415, parse: 200, api: 502,
}

export async function POST(req: Request) {
  const { error: authErr } = await loadCaller({ kind: 'login' }, { tag: TAG, req, method: 'POST' })
  if (authErr) return authErr

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) {
    console.error(`[${TAG}] ANTHROPIC_API_KEY 가 없다 — 읽기를 건너뛴다`)
    return NextResponse.json({ ok: false, reason: 'no_key' as const })
  }

  const form = await req.formData().catch(() => null)
  const got = await readCard(form?.get('image'), key)
  if (!got.ok) {
    return NextResponse.json({ ok: false, reason: got.reason }, { status: STATUS[got.reason] })
  }
  // 남기는 것은 토큰 수와 채운 칸 수뿐이다 — 파일도, 읽은 값도 적지 않는다.
  console.log(`[${TAG}] read`, { ...got.usage, filled: filledCount(got.fields) })
  return NextResponse.json({ ok: true, fields: got.fields, usage: got.usage })
}
